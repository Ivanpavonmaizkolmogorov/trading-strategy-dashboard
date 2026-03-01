import { state, saveMagicNumbers } from '../state.js';
import { showToast } from './notifications.js';
import { renderLiveMonitor } from './liveMonitor.js';
import { fetchLinkedAccountData, normalizeComment, cleanMetrics, recalculateStrategyBreakdown } from './myfxbookUI.js';

// Helper for fuzzy matching
function calculateMatchScore(strategyName, idStr) {
    const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const sName = normalize(strategyName);
    const sId = normalize(idStr);

    // 1. Exact containment (Strongest)
    if (sId.includes(sName) || sName.includes(sId)) return 1.0;

    // 2. Common Typos & Abbreviations Specific to this user's data
    // Handle 'long' vs 'log', 'buy' vs 'by', 'stop' vs 'stp', 'plus' vs 'pls'
    const clean = (s) => s.toLowerCase()
        .replace(/long/g, 'l')
        .replace(/log/g, 'l')
        .replace(/buy/g, 'b')
        .replace(/by/g, 'b')
        .replace(/stop/g, 's')
        .replace(/stp/g, 's')
        .replace(/plus/g, 'p')
        .replace(/pls/g, 'p')
        .replace(/[^a-z0-9]/g, ''); // Remove all other non-alphanumeric

    const cName = clean(strategyName);
    const cId = clean(idStr);

    // If cleaned versions match or are contained
    if (cId.includes(cName) || cName.includes(cId)) return 0.95;

    // 3. Date Pattern Matching (High confidence if numbers match)
    // Extract sequences of digits, e.g. "10523" from "10.5.23"
    const extractDigits = (s) => s.match(/\d+/g)?.join('') || '';
    const digitsName = extractDigits(strategyName);
    const digitsId = extractDigits(idStr);

    // If significant digits match (at least 4 digits to avoid random small number matches)
    if (digitsName.length >= 4 && digitsId.length >= 4) {
        if (digitsId.includes(digitsName) || digitsName.includes(digitsId)) return 0.9;
    }

    // 4. Consonants-only match (Fallback for heavy abbreviations)
    const consonants = (s) => s.toLowerCase().replace(/[aeiou]/g, '').replace(/[^a-z0-9]/g, '');
    const consName = consonants(strategyName);
    const consId = consonants(idStr);

    if (consName.length > 5 && (consId.includes(consName) || consName.includes(consId))) return 0.85;

    return 0.0;
}

let mapperModal = null;
let currentPortfolio = null; // Can be null in Global Mode
let selectedStrategyId = null;
let tempMapping = {};
let searchTerm = '';
let strategySearchTerm = ''; // New: Filter strategies
let selectedSourceFilter = 'all'; // New: Filter IDs by Source
let globalUniqueIds = []; // Cache for global mode
let availableSources = new Set(); // New: Track available sources

export function openMagicMapper(portfolio = null) {
    currentPortfolio = portfolio;
    const isGlobal = !portfolio;

    // Initialize tempMapping from GLOBAL state
    tempMapping = {};
    if (state.magicNumberMap) {
        Object.keys(state.magicNumberMap).forEach(key => {
            const val = state.magicNumberMap[key];
            tempMapping[key] = Array.isArray(val) ? [...val] : (val ? [String(val)] : []);
        });
    }

    availableSources.clear();

    // Prepare Data Source
    if (isGlobal) {
        // AGGREGATE ALL IDs from ALL Portfolios + Track Sources
        const allStats = {};

        // 1. Saved Portfolios
        state.savedPortfolios.forEach(p => {
            availableSources.add(p.name); // Track Source Name
            if (p.realMetrics && p.realMetrics.magicStats) {
                Object.values(p.realMetrics.magicStats).forEach(stat => {
                    const id = String(stat.id);
                    if (!allStats[id]) {
                        allStats[id] = { ...stat, sources: new Set([p.name]) }; // Init with Source
                    } else {
                        // Merge counts
                        allStats[id].tradesCount += stat.tradesCount;
                        allStats[id].totalProfit += stat.totalProfit;
                        allStats[id].sources.add(p.name); // Add Source
                    }
                });
            }
        });

        // 2. Deep Scan Data (All Accounts)
        // Iterate over ALL accounts in deepScanData (multi-account persistence)
        // IMPORTANT: Keep trades from different accounts SEPARATE even if same magic number
        if (state.deepScanData && Object.keys(state.deepScanData).length > 0) {
            Object.entries(state.deepScanData).forEach(([accountId, accountData]) => {
                if (!accountData.processedStats) return;

                const sourceName = accountData.sourceName || `Account ${accountId}`;
                const accountLabel = accountData.accountInfo?.name || accountId;
                availableSources.add(sourceName);

                Object.values(accountData.processedStats).forEach(stat => {
                    const baseId = String(stat.id);
                    // Create a UNIQUE ID per account to prevent mixing trades
                    const uniqueId = `${accountId}::${baseId}`;

                    allStats[uniqueId] = {
                        ...stat,
                        id: baseId,  // Keep original ID for display
                        uniqueId: uniqueId,  // Used internally for mapping
                        accountId: accountId,
                        accountName: accountLabel,
                        sources: new Set([sourceName])
                    };
                });
            });
        }
        // Fallback: also check sandboxData for backwards compatibility
        else if (state.sandboxData && state.sandboxData.processedStats) {
            const sandboxName = state.sandboxData.sourceName || 'Sandbox';
            availableSources.add(sandboxName);

            Object.values(state.sandboxData.processedStats).forEach(stat => {
                const id = String(stat.id);
                if (!allStats[id]) {
                    allStats[id] = { ...stat, sources: new Set([sandboxName]) };
                } else {
                    allStats[id].tradesCount += stat.tradesCount;
                    allStats[id].totalProfit += stat.totalProfit;
                    allStats[id].sources.add(sandboxName);
                }
            });
        }

        globalUniqueIds = Object.values(allStats);
    } else {
        // Single Portfolio Mode
        availableSources.add(currentPortfolio.name);
        if (cleanMetrics(currentPortfolio)) {
            showToast('Optimized trade identifiers', 'info');
        }
    }

    if (!mapperModal) {
        mapperModal = createMapperModal();
        document.body.appendChild(mapperModal);
    }

    // Populate Source Filter
    const sourceSelect = mapperModal.querySelector('#mapper-source-filter');
    if (sourceSelect) {
        sourceSelect.innerHTML = `<option value="all">All Sources (${availableSources.size})</option>`;
        availableSources.forEach(source => {
            sourceSelect.innerHTML += `<option value="${source}">${source}</option>`;
        });
        sourceSelect.value = 'all';
    }

    // Reset Filters
    strategySearchTerm = '';
    const stratInput = mapperModal.querySelector('#mapper-strategy-search');
    if (stratInput) stratInput.value = '';

    searchTerm = '';
    const idInput = mapperModal.querySelector('#mapper-search-input');
    if (idInput) idInput.value = '';

    // Title update
    const title = mapperModal.querySelector('#mapper-title');
    if (title) title.innerHTML = isGlobal ? '<span>💊</span> Global Strategy DNA Mapper' : `<span>🔗</span> Mapping: ${portfolio.name}`;

    // Select first strategy by default
    const strategies = getStrategies();
    if (strategies.length > 0) {
        const first = strategies[0];
        selectedStrategyId = first.strategyId || first.name;
    }

    renderMapperContent();
    mapperModal.classList.remove('hidden');

    // Listener for Sandbox Updates
    if (!mapperModal._sandboxListener) {
        mapperModal._sandboxListener = () => {
            console.log('[Magic Mapper] Strategies/IDs updated from Sandbox');
            renderMapperContent();
        };
        window.addEventListener('sandbox-data-updated', mapperModal._sandboxListener);
    }
}

function getStrategies() {
    let list = [];
    if (!currentPortfolio) {
        // Global Mode: Aggregate ALL unique strategies known to the system
        const candidates = [];

        // 0. Analysis Results (Clean Slate / Lab Mode)
        if (window.analysisResults && Array.isArray(window.analysisResults)) {
            // console.log(`[MagicMapper] Found ${window.analysisResults.length} items in window.analysisResults`);
            window.analysisResults.forEach((s, idx) => {
                // S might be the strategy object itself
                if (s && typeof s === 'object') {
                    const stratName = s.name || s.strategyId || `Strategy ${idx + 1}`;
                    candidates.push({ strat: { ...s, name: stratName }, source: 'Analysis Results' });
                }
            });
        }


        // 1. Loaded Files
        if (state.loadedStrategyFiles) {
            state.loadedStrategyFiles.forEach(s => {
                // Ensure 'name' is present (File objects have .name, placeholders may not)
                const stratWithName = { ...s, name: s.name || s.fileName || 'Unknown' };
                candidates.push({ strat: stratWithName, source: 'Uploaded Files' });
            });
        }
        // 2. Raw Data - Only include valid strategy objects (not arrays of trades)
        if (state.rawStrategiesData) {
            state.rawStrategiesData.forEach(s => {
                // rawStrategiesData can contain arrays of trades OR strategy objects
                // Only add if it's an object with a 'name' property (not an array)
                if (s && typeof s === 'object' && !Array.isArray(s) && s.name) {
                    candidates.push({ strat: s, source: 'Raw Data' });
                }
            });
        }

        // 3. Databank
        if (state.databankPortfolios) {
            state.databankPortfolios.forEach(p => {
                if (p.strategies && Array.isArray(p.strategies)) {
                    p.strategies.forEach(s => candidates.push({ strat: s, source: `Databank: ${p.id || 'Unnamed'}` }));
                }
            });
        }
        // 4. Saved Portfolios
        if (state.savedPortfolios) {
            state.savedPortfolios.forEach(p => {
                let strategies = [];
                if (p.strategies && Array.isArray(p.strategies)) {
                    strategies = p.strategies;
                } else if (p.indices && Array.isArray(p.indices)) {
                    // Reconstruct from indices
                    strategies = p.indices.map(idx => state.loadedStrategyFiles[idx]).filter(Boolean);
                }

                strategies.forEach(s => candidates.push({ strat: s, source: p.name || 'Unnamed Portfolio' }));
            });
        }

        // Deduplicate by name and MERGE sources
        const seen = new Map();
        candidates.forEach(item => {
            const s = item.strat;
            // DEBUG: Log candidates with undefined/null name
            if (!s || !s.name) {
                console.warn('[MagicMapper] ⚠️ Candidate with undefined/null strat or name:', {
                    source: item.source,
                    strat: s,
                    stratKeys: s ? Object.keys(s) : 'N/A'
                });
            }
            if (s && s.name) {
                if (!seen.has(s.name)) {
                    // Create a shallow copy to attach metadata without mutating original
                    seen.set(s.name, { ...s, _sources: [item.source] });
                } else {
                    const existing = seen.get(s.name);
                    if (!existing._sources.includes(item.source)) {
                        existing._sources.push(item.source);
                    }
                }
            }
        });

        list = Array.from(seen.values());
        console.log(`[MagicMapper] Global getStrategies: ${candidates.length} candidates -> ${list.length} unique strategies`);

    } else {
        // Portfolio Mode: Only strategies in this portfolio
        // We verify that indices map to valid loaded files
        // For consistency, we attach a source here too
        const sourceName = `Current: ${currentPortfolio.name || 'Portfolio'}`;

        console.log('[MagicMapper] Portfolio Mode. Indices:', currentPortfolio.indices);
        console.log('[MagicMapper] loadedStrategyFiles count:', state.loadedStrategyFiles?.length);

        list = currentPortfolio.indices.map(idx => {
            const s = state.loadedStrategyFiles[idx];
            if (!s) {
                console.warn(`[MagicMapper] ⚠️ Index ${idx} not found in loadedStrategyFiles`);
            }
            return s ? { ...s, _sources: [sourceName] } : null;
        }).filter(Boolean);

        // Fallback: If indices fail (reloaded state?), try matching names if available in portfolio
        if (list.length === 0 && currentPortfolio.strategyNames) {
            console.log('[MagicMapper] Using strategyNames fallback:', currentPortfolio.strategyNames);
            list = currentPortfolio.strategyNames.map(name => ({ name, _sources: [sourceName] }));
        }
    }

    // Filter by Search Term
    if (strategySearchTerm) {
        const term = strategySearchTerm.toLowerCase();
        list = list.filter(s => s.name && s.name.toLowerCase().includes(term));
    }

    // Final check for undefined names
    const withoutName = list.filter(s => !s.name);
    if (withoutName.length > 0) {
        console.error('[MagicMapper] ❌ Found strategies WITHOUT name after processing:', withoutName);
    }

    return list;
}

function closeMapperModal() {
    if (mapperModal) {
        mapperModal.classList.add('hidden');
    }
}

function createMapperModal() {
    const modal = document.createElement('div');
    modal.id = 'magic-mapper-modal';
    modal.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 hidden p-4';

    modal.innerHTML = `
        <div class="bg-gray-800 rounded-xl border border-gray-700 w-[95vw] max-w-7xl shadow-2xl h-[85vh] flex flex-col">
            <!-- Header -->
            <div class="flex justify-between items-center p-6 border-b border-gray-700">
                <div>
                    <h2 id="mapper-title" class="text-2xl font-bold text-white flex items-center gap-2">
                        <span>💊</span> Strategy DNA Mapper
                    </h2>
                    <p class="text-gray-400 text-sm mt-1">Associate unique trade signatures to strategies. Changes apply globally.</p>
                </div>
                <div class="flex items-center gap-4">
                    <button id="close-mapper-modal" class="text-gray-400 hover:text-white text-3xl">×</button>
                </div>
            </div>
            
            <!-- Content -->
            <div class="flex flex-1 overflow-hidden" id="mapper-content-area">
                <!-- Left Column: Strategies -->
                <div class="w-1/4 border-r border-gray-700 flex flex-col bg-gray-900/30 min-w-[300px]">
                    <div class="p-3 border-b border-gray-700 bg-gray-900/50 flex flex-col gap-2">
                         <div class="font-bold text-gray-400 text-xs uppercase tracking-wider flex justify-between items-center">
                            <span>Strategies</span>
                            <span id="mapper-strategy-count" class="bg-gray-800 px-1.5 rounded text-[10px]">0</span>
                         </div>
                         <!-- Strategy Search Input -->
                         <div class="relative">
                            <input type="text" id="mapper-strategy-search" 
                                class="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:border-purple-500 focus:outline-none"
                                placeholder="Filter strategies...">
                            <span class="absolute right-2 top-1.5 text-gray-500 text-xs">🔍</span>
                         </div>
                         <!-- Strategy Source Filter -->
                         <div class="flex items-center gap-2 mt-2">
                            <select id="mapper-strategy-source-filter" class="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:border-purple-500 focus:outline-none">
                                <option value="all">All Sources</option>
                            </select>
                         </div>
                    </div>
                    <div id="mapper-strategies-list" class="overflow-y-auto flex-1 p-2 space-y-1">
                        <!-- Strategies list -->
                    </div>
                </div>

                <!-- Right Column: Available IDs -->
                <div class="flex-1 flex flex-col bg-gray-800">
                    <div class="p-3 border-b border-gray-700 flex flex-col gap-3 bg-gray-800 z-10 shadow-md">
                        <!-- Filter Bar -->
                        <div class="flex items-center gap-4">
                             <!-- Search Input -->
                            <div class="relative flex-1 max-w-md">
                                <span class="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">🔍</span>
                                <input type="text" id="mapper-search-input" 
                                    class="w-full bg-gray-700 border border-gray-600 rounded-lg pl-9 pr-3 py-1.5 text-sm text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    placeholder="Search IDs, symbols...">
                            </div>
                            
                            <!-- Source Filter -->
                            <div class="flex items-center gap-2">
                                <label class="text-xs text-gray-400 font-bold uppercase">Source:</label>
                                <select id="mapper-source-filter" class="bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-sm text-white focus:ring-2 focus:ring-blue-500 focus:outline-none max-w-[200px]">
                                    <option value="all">All Sources</option>
                                    <!-- Populated dynamically -->
                                </select>
                            </div>

                            <button id="mapper-auto-link-all" class="text-xs text-green-400 hover:text-green-300 font-medium px-2 py-1 rounded hover:bg-gray-700 border border-green-900/50 flex items-center gap-1 ml-auto" title="Automatically link strategies to best matching IDs">
                                <span>✨</span> Auto-Link
                            </button>
                        </div>
                    </div>
                    
                    <div id="mapper-ids-list" class="overflow-y-auto flex-1 p-4 flex flex-col gap-6">
                        <!-- IDs list -->
                    </div>
                </div>
            </div>
            
            <!-- Footer -->
            <div class="p-6 border-t border-gray-700 flex justify-between gap-3 bg-gray-800/50">
                <button id="clear-all-mapper-btn" class="px-4 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-900/50 rounded-lg font-semibold transition-colors flex items-center gap-2" title="Remove all mappings (Reset)">
                    <span>🗑️</span> Clear All
                </button>
                <div class="flex gap-3">
                    <button id="cancel-mapper-btn" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold transition-colors">
                        Close
                    </button>
                    <button id="save-mapper-btn" class="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold shadow-lg shadow-purple-900/20 transition-all transform hover:scale-105 flex items-center gap-2">
                        <span>💾</span> Save All Mappings
                    </button>
                </div>
            </div>
        </div>
    `;

    modal.querySelector('#close-mapper-modal').onclick = closeMapperModal;
    modal.querySelector('#cancel-mapper-btn').onclick = closeMapperModal;

    modal.querySelector('#save-mapper-btn').onclick = () => {
        saveMappings();
    };

    modal.querySelector('#clear-all-mapper-btn').onclick = () => {
        if (confirm('Are you sure you want to DELETE ALL mappings? This will reset all strategy associations.\n(Click Save afterwards to make it permanent)')) {
            console.log('[Magic Mapper] Clearing all mappings');
            tempMapping = {};
            selectedStrategyId = null; // Reset selection
            renderMapperContent();
            showToast('All mappings cleared. Click Save to persist.', 'warning');
        }
    };

    // ID Search Listener
    const searchInput = modal.querySelector('#mapper-search-input');
    searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value.toLowerCase();
        renderIdsList();
    });

    // Strategy Search Listener
    const stratInput = modal.querySelector('#mapper-strategy-search');
    stratInput.addEventListener('input', (e) => {
        strategySearchTerm = e.target.value;
        renderStrategiesList();
    });

    // Source Filter Listener
    const sourceSelect = modal.querySelector('#mapper-source-filter');
    sourceSelect.addEventListener('change', (e) => {
        selectedSourceFilter = e.target.value;
        renderIdsList();
    });

    modal.querySelector('#mapper-auto-link-all').onclick = autoLinkIds;

    // Close on backdrop
    modal.onclick = (e) => {
        if (e.target === modal) closeMapperModal();
    };

    return modal;
}

function saveMappings() {
    console.log('[Magic Mapper] Saving GLOBAL mappings:', JSON.stringify(tempMapping));

    // Update state.magicNumberMap logic similar to before but preserving structure
    const newMap = JSON.parse(JSON.stringify(tempMapping));

    // Ensure bidirectional mapping (Name <-> ID safety)
    // iterate ALL loaded strategies
    state.loadedStrategyFiles.forEach(strat => {
        const sId = strat.strategyId || strat.name;
        const sName = strat.name;

        if (newMap[sId]) {
            const magics = newMap[sId];
            if (sName && sName !== sId) newMap[sName] = magics;
            const cleanName = sName.replace(/\.csv$/i, '').trim();
            if (cleanName !== sName) newMap[cleanName] = magics;
        }
    });

    state.magicNumberMap = newMap;
    saveMagicNumbers(); // Persist to valid_magic_numbers.json

    // Refresh ALL portfolios
    state.savedPortfolios.forEach(p => {
        if (p.realMetrics) {
            recalculateStrategyBreakdown(p);
        }
    });

    showToast('Mappings saved globally. All portfolios updated.', 'success');
    renderLiveMonitor(); // Refresh UI if open
    closeMapperModal();
}

function autoLinkIds() {
    const strategies = getStrategies();
    const visibleIds = getVisibleIds(); // Helper to get IDs being shown

    let linkedCount = 0;

    // We want to link ANY unmapped ID to a strategy if score is high
    visibleIds.forEach(stat => {
        const idStr = String(stat.id);

        // Skip if already mapped (unless we want to re-evaluate? Better safe than sorry, skip)
        // Actually user wants to fix issues, so let's check if it finds a BETTER match than current?
        // For now, let's just try to map unmapped ones or ones that look wrong.

        // Find best matching strategy
        let bestScore = 0;
        let bestStratId = null;

        strategies.forEach(strat => {
            const stratName = strat.name;
            const stratId = strat.strategyId || strat.name;

            const score = calculateMatchScore(stratName, idStr);
            if (score > bestScore) {
                bestScore = score;
                bestStratId = stratId;
            }
        });

        // Threshold 0.8 is good for fuzzy matches
        if (bestScore >= 0.8 && bestStratId) {
            if (!tempMapping[bestStratId]) tempMapping[bestStratId] = [];

            // Logic: Is this ID already mapped to THIS strategy?
            if (!tempMapping[bestStratId].includes(idStr)) {

                // Is it mapped to ANOTHER strategy?
                // If so, we only steal if score is MUCH higher (e.g. 1.0 vs 0.8)
                // But for now, let's assume "Auto Link" implies "Fix my mappings".
                // So strict "Steal" logic:

                // Remove from others
                let stolen = false;
                Object.keys(tempMapping).forEach(otherId => {
                    if (otherId !== bestStratId && tempMapping[otherId].includes(idStr)) {
                        tempMapping[otherId] = tempMapping[otherId].filter(x => x !== idStr);
                        stolen = true;
                    }
                });

                tempMapping[bestStratId].push(idStr);
                linkedCount++;
            }
        }
    });

    renderMapperContent();
    if (linkedCount > 0) {
        showToast(`✨ Auto-linked ${linkedCount} trade signatures! Don't forget to SAVE.`, 'success');
    } else {
        showToast('No new matching strategies found.', 'info');
    }
}

function getVisibleIds() {
    let availableIds = [];
    if (currentPortfolio) {
        availableIds = Object.values(currentPortfolio.realMetrics?.magicStats || {});
    } else {
        availableIds = globalUniqueIds;
    }

    // Source Filter
    if (selectedSourceFilter !== 'all') {
        availableIds = availableIds.filter(stat =>
            stat.sources && stat.sources.has(selectedSourceFilter)
        );
    }

    // Search Filter
    if (searchTerm) {
        availableIds = availableIds.filter(stat =>
            String(stat.id).toLowerCase().includes(searchTerm) ||
            String(stat.symbol).toLowerCase().includes(searchTerm)
        );
    }

    // Default Sort (Trades Count)
    // availableIds.sort((a, b) => b.tradesCount - a.tradesCount);

    return availableIds;
}

function renderStrategiesList() {
    const strategiesList = mapperModal.querySelector('#mapper-strategies-list');
    strategiesList.innerHTML = '';

    const strategies = getStrategies();

    // Populate Source Filter if empty
    const sourceFilter = document.getElementById('mapper-strategy-source-filter');
    const selectedSource = sourceFilter ? sourceFilter.value : 'all';

    // always refresh options to capture new sources (e.g. newly loaded portfolios)
    if (sourceFilter) {
        const currentSelection = sourceFilter.value;
        const allSources = new Set();

        strategies.forEach(s => {
            if (s._sources) s._sources.forEach(src => allSources.add(src));
        });

        // Clear existing options except "All"
        // (Assuming first option is 'all')
        while (sourceFilter.options.length > 1) {
            sourceFilter.remove(1);
        }

        // Sort and add options
        Array.from(allSources).sort().forEach(src => {
            const opt = document.createElement('option');
            opt.value = src;
            opt.textContent = src;
            sourceFilter.appendChild(opt);
        });

        // Restore selection if possible, else default to 'all'
        if (Array.from(sourceFilter.options).some(o => o.value === currentSelection)) {
            sourceFilter.value = currentSelection;
        } else {
            sourceFilter.value = 'all';
        }

        // Ensure listener is attached (idempotent)
        sourceFilter.onchange = () => renderStrategiesList();
    }

    if (strategies.length === 0) { // Check original strategies length
        strategiesList.innerHTML = `
            <div class="p-4 text-center text-gray-500 text-xs flex flex-col gap-2">
                <span>No local strategies found.</span>
                <span class="text-orange-400">Please import your Strategy Analysis JSON or load strategies first.</span>
                <p class="opacity-50 mt-2 text-[10px]">The mapper connects your <b>Local Strategies</b> to Myfxbook IDs.</p>
            </div>
        `;
        // Update count
        const countSpan = mapperModal.querySelector('#mapper-strategy-count');
        if (countSpan) countSpan.textContent = "0";
        return;
    }

    // Filter by Source
    const filteredStrategies = (selectedSource === 'all')
        ? strategies
        : strategies.filter(s => s._sources && s._sources.includes(selectedSource));

    // Update count based on filtered strategies
    const countSpan = mapperModal.querySelector('#mapper-strategy-count');
    if (countSpan) countSpan.textContent = filteredStrategies.length;

    filteredStrategies.forEach(strategy => {
        // DEBUG: Log strategies with undefined/null name
        if (!strategy.name) {
            console.warn('[MagicMapper] ⚠️ Strategy with undefined name:', {
                strategy,
                sources: strategy._sources,
                strategyId: strategy.strategyId,
                symbol: strategy.symbol,
                keys: Object.keys(strategy)
            });
        }

        const strategyId = strategy.strategyId || strategy.name;
        const mappedIds = tempMapping[strategyId] || [];
        const isSelected = strategyId === selectedStrategyId;

        const div = document.createElement('div');
        div.className = `p-3 rounded-lg cursor-pointer transition-colors flex flex-col gap-1 border border-transparent ${isSelected ? 'bg-purple-900/50 border-purple-500 shadow-md ring-1 ring-purple-500/20' : 'hover:bg-gray-700/50 text-gray-400 border-gray-800'}`;

        // Safe name display - ALWAYS prefer descriptive name over STRAT_ IDs
        let displayName = strategy.name;

        // If name looks like an internal ID (STRAT_XXX), try to find the real name
        if (!displayName || displayName.startsWith('STRAT_')) {
            // 1. Search in loadedStrategyFiles by strategyId
            const foundStrat = state.loadedStrategyFiles?.find(s => s.strategyId === (strategy.strategyId || strategy.name));
            if (foundStrat && foundStrat.name && !foundStrat.name.startsWith('STRAT_')) {
                displayName = foundStrat.name;
            }

            // 2. Search in savedPortfolios' strategyNames
            if (!displayName || displayName.startsWith('STRAT_')) {
                for (const p of (state.savedPortfolios || [])) {
                    if (p.strategyIds && p.strategyNames) {
                        const idx = p.strategyIds.indexOf(strategy.strategyId || strategy.name);
                        if (idx !== -1 && p.strategyNames[idx]) {
                            displayName = p.strategyNames[idx];
                            break;
                        }
                    }
                }
            }

            // 3. Fallback to cleaned up name or ID
            if (!displayName || displayName.startsWith('STRAT_')) {
                displayName = strategy.name || strategy.strategyId || '[No Name]';
            }
        }

        div.innerHTML = `
            <div class="font-medium text-sm leading-tight break-words ${isSelected ? 'text-white' : ''}">${displayName}</div>
            <div class="flex justify-between items-center mt-1">
                <span class="text-xs opacity-70">${strategy.symbol || 'Unknown'}</span>
                ${mappedIds.length > 0 ? `<span class="text-[10px] bg-purple-500 text-white px-2 py-0.5 rounded-full font-bold shadow-sm">${mappedIds.length}</span>` : ''}
            </div>
        `;
        div.onclick = () => {
            selectedStrategyId = strategyId;
            renderStrategiesList();
            renderIdsList();
        };
        strategiesList.appendChild(div);
    });
}

function renderIdsList() {
    const idsList = mapperModal.querySelector('#mapper-ids-list');
    idsList.innerHTML = '';

    if (!selectedStrategyId) {
        // Allow rendering IDs even without selection (View Only Mode)
        // idsList.innerHTML = `<div class="text-center py-10 text-gray-500 italic">Select a strategy to begin mapping.</div>`;
        // return;
    }

    let allIds = getVisibleIds(); // All filtered IDs

    // Sort: 
    // 1. Assigned to THIS strategy
    // 2. Recommended (High Similarity)
    // 3. Trade Count Desc
    const currentMapped = tempMapping[selectedStrategyId] || [];

    // Find name for Similarity
    const strategies = getStrategies();
    const currentStrat = strategies.find(s => (s.strategyId || s.name) === selectedStrategyId);
    const stratName = currentStrat ? currentStrat.name : '';

    allIds.sort((a, b) => {
        const idA = String(a.id);
        const idB = String(b.id);

        const inA = currentMapped.includes(idA);
        const inB = currentMapped.includes(idB);

        if (inA !== inB) return inA ? -1 : 1; // Mapped first

        const scoreA = calculateMatchScore(stratName, idA);
        const scoreB = calculateMatchScore(stratName, idB);

        if (Math.abs(scoreA - scoreB) > 0.1) return scoreB - scoreA; // Similarity second

        return b.tradesCount - a.tradesCount; // Count third
    });

    // We don't want "Buckets" anymore (requested by user). Just one list.
    // BUT we need to indicate ownership.

    allIds.forEach(stat => {
        const idStr = String(stat.id);  // Display ID (magic number)
        const uniqueIdStr = stat.uniqueId || idStr;  // Unique ID for mapping (includes accountId)
        const isChecked = currentMapped.includes(uniqueIdStr);
        const similarity = calculateMatchScore(stratName, idStr);
        const isRecommended = similarity > 0.8;

        // Find owner if not this strategy
        let ownerId = null;
        let ownerName = null;
        if (!isChecked) {
            ownerId = Object.keys(tempMapping).find(sId => tempMapping[sId] && tempMapping[sId].includes(uniqueIdStr));
            if (ownerId && ownerId !== selectedStrategyId) {
                // Find descriptive name - search in multiple places
                // 1. loadedStrategyFiles by strategyId
                let ownerStrat = state.loadedStrategyFiles.find(s => (s.strategyId || s.name) === ownerId);

                // 2. If not found, search by name (ownerId might be the name itself)
                if (!ownerStrat) {
                    ownerStrat = state.loadedStrategyFiles.find(s => s.name === ownerId);
                }

                // 3. Search in saved portfolios' strategies
                if (!ownerStrat && state.savedPortfolios) {
                    for (const p of state.savedPortfolios) {
                        if (p.strategyNames && p.strategyNames.includes(ownerId)) {
                            ownerName = ownerId; // It's already the name
                            break;
                        }
                        // Also check strategyIds to find matching name
                        const idx = p.strategyIds?.indexOf(ownerId);
                        if (idx !== -1 && p.strategyNames?.[idx]) {
                            ownerName = p.strategyNames[idx];
                            break;
                        }
                    }
                }

                // Use found name, or show the ID key directly
                if (!ownerName) {
                    if (ownerStrat) {
                        ownerName = ownerStrat.name;
                    } else if (ownerId.startsWith('STRAT_')) {
                        // Strategy NOT found in loaded sessions but link exists in Cache -> Orphaned
                        ownerName = `Orphaned Link (${ownerId})`;
                    } else {
                        ownerName = ownerId;
                    }
                }
            }
        }

        const label = document.createElement('label');
        label.className = `flex items-center gap-3 p-2 rounded border transition-all cursor-pointer group relative
            ${isChecked
                ? 'bg-purple-900/20 border-purple-500/50 hover:bg-purple-900/30'
                : 'bg-gray-800 border-gray-700 hover:bg-gray-700'}
            ${isRecommended && !isChecked ? 'ring-1 ring-green-500/40 bg-green-900/5' : ''}
        `;

        // Show account badge if from deepScanData (has accountName)
        const accountBadge = stat.accountName
            ? `<span class="text-[9px] bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded border border-blue-800 ml-1" title="Account: ${stat.accountName}">${stat.accountName}</span>`
            : '';

        label.innerHTML = `
            <input type="checkbox" class="form-checkbox h-4 w-4 text-purple-500 rounded border-gray-600 bg-gray-800 focus:ring-purple-500 focus:ring-offset-gray-900 transition-colors z-10" ${isChecked ? 'checked' : ''}>
            
            <div class="flex-1 min-w-0 flex flex-col gap-0.5 z-0">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-mono text-xs font-bold ${isChecked ? 'text-purple-200' : 'text-gray-300'} truncate" title="${stat.exampleRaw || stat.id}">
                        ${stat.exampleRaw && stat.exampleRaw !== stat.id ? stat.exampleRaw : stat.id}
                    </span>
                    ${stat.exampleRaw && stat.exampleRaw !== stat.id ? `<span class="text-[9px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded border border-gray-600" title="Normalized Group ID">≡ ${stat.id}</span>` : ''}
                    ${accountBadge}
                    ${isRecommended ? '<span class="text-[9px] bg-green-900/50 text-green-400 px-1 rounded border border-green-800 animate-pulse">MATCH</span>' : ''}
                </div>
                
                ${ownerName ? `
                <div class="text-[10px] text-orange-400 flex items-center gap-1 bg-orange-900/10 px-1.5 py-0.5 rounded w-fit border border-orange-900/30">
                    <span>🔗</span> Linked to: <span class="font-bold truncate max-w-[200px]">${ownerName}</span>
                </div>` : ''}
            </div>

            <!-- Metrics -->
            <div class="flex items-center gap-4 text-xs whitespace-nowrap z-0">
                <span class="font-bold text-gray-500 w-12 text-right">${stat.symbol || '???'}</span>
                <span class="font-mono w-16 text-right ${(Number(stat.totalProfit) || 0) >= 0 ? 'text-green-400' : 'text-red-400'}">$${(Number(stat.totalProfit) || 0).toFixed(0)}</span>
                <span class="bg-gray-800 text-gray-400 px-2 py-0.5 rounded text-[10px] min-w-[24px] text-center border border-gray-700">${stat.tradesCount}</span>

                <!-- Inspect Button -->
                <button class="p-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white rounded transition-colors shadow-sm border border-gray-600 z-20"
                    title="Inspect Trades"
                    onclick="event.preventDefault(); window.MagicMapper_inspectTrades('${stat.uniqueId || stat.id}')">
                    🔍
                </button>
            </div>
        `;

        const checkbox = label.querySelector('input');
        checkbox.onchange = (e) => {
            if (e.target.checked) {
                // Steal logic: Remove from anyone else (using uniqueIdStr)
                Object.keys(tempMapping).forEach(sId => {
                    if (sId !== selectedStrategyId && tempMapping[sId]) {
                        tempMapping[sId] = tempMapping[sId].filter(x => x !== uniqueIdStr);
                    }
                });

                // Add to Current (store uniqueIdStr which includes accountId)
                if (!tempMapping[selectedStrategyId]) tempMapping[selectedStrategyId] = [];
                tempMapping[selectedStrategyId].push(uniqueIdStr);
            } else {
                // Remove
                if (tempMapping[selectedStrategyId]) {
                    tempMapping[selectedStrategyId] = tempMapping[selectedStrategyId].filter(x => x !== uniqueIdStr);
                }
            }
            // Re-render to update UI (steal status, counts)
            renderStrategiesList();
            renderIdsList();
        };

        idsList.appendChild(label);
    });
}

// Global Inspector Function
window.MagicMapper_inspectTrades = (magicId) => {
    console.log(`[MagicMapper] Inspecting trades for ID: ${magicId}`);

    // Parse uniqueId format (accountId::magicNumber) vs legacy (just magicNumber)
    let targetAccountId = null;
    let actualMagicId = magicId;

    if (magicId.includes('::')) {
        [targetAccountId, actualMagicId] = magicId.split('::');
        console.log(`[MagicMapper] Parsed uniqueId: account=${targetAccountId}, magic=${actualMagicId}`);
    }

    // Aggregate trades
    let allTrades = [];

    // If targeting specific account, only search there
    if (targetAccountId && state.deepScanData && state.deepScanData[targetAccountId]) {
        const accountData = state.deepScanData[targetAccountId];
        if (accountData.tradesById && accountData.tradesById[actualMagicId]) {
            const accTrades = accountData.tradesById[actualMagicId].map(t => ({
                ...t,
                _accountName: t._sourceAccount?.name || accountData.sourceName || `Account ${targetAccountId}`
            }));
            allTrades = allTrades.concat(accTrades);
        }
    } else {
        // Legacy mode: search everywhere
        state.linkedAccounts.forEach(acc => {
            if (acc.metrics && acc.metrics._tradesById && acc.metrics._tradesById[actualMagicId]) {
                const accountTrades = acc.metrics._tradesById[actualMagicId].map(t => ({
                    ...t,
                    _accountName: acc.name
                }));
                allTrades = allTrades.concat(accountTrades);
            }
        });

        // Check ALL Deep Scan Accounts (Multi-Account)
        if (state.deepScanData && Object.keys(state.deepScanData).length > 0) {
            Object.entries(state.deepScanData).forEach(([accountId, accountData]) => {
                if (accountData.tradesById && accountData.tradesById[actualMagicId]) {
                    const accTrades = accountData.tradesById[actualMagicId].map(t => ({
                        ...t,
                        _accountName: t._sourceAccount?.name || accountData.sourceName || `Account ${accountId}`
                    }));
                    allTrades = allTrades.concat(accTrades);
                }
            });
        }
        // Fallback: Sandbox Data for backwards compatibility
        else if (state.sandboxData && state.sandboxData.tradesById && state.sandboxData.tradesById[actualMagicId]) {
            const sandboxTrades = state.sandboxData.tradesById[actualMagicId].map(t => ({
                ...t,
                _accountName: t._sourceAccount?.name || 'Sandbox / Deep Scan'
            }));
            allTrades = allTrades.concat(sandboxTrades);
        }
    }

    // Sort desc by date
    allTrades.sort((a, b) => new Date(b.closeTime) - new Date(a.closeTime));

    // Render Modal (Reuse simple modal logic or create new)
    let modal = document.getElementById('trade-inspector-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'trade-inspector-modal';
        modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[70] hidden';
        modal.innerHTML = `
            <div class="bg-gray-900 rounded-xl shadow-2xl border border-gray-700 w-full max-w-4xl max-h-[90vh] flex flex-col">
                <div class="flex justify-between items-center p-4 border-b border-gray-700 bg-gray-800 rounded-t-xl">
                    <h3 class="text-lg font-bold text-white flex items-center gap-2">
                        <span>🔍</span> Trade Inspector: <span id="inspector-magic-id" class="text-sky-400 font-mono"></span>
                    </h3>
                    <button onclick="document.getElementById('trade-inspector-modal').classList.add('hidden')" class="text-gray-400 hover:text-white">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div class="flex-1 overflow-auto p-0 custom-scrollbar">
                    <table class="w-full text-left text-xs text-gray-300">
                        <thead class="bg-gray-800 text-gray-400 sticky top-0 uppercase font-medium">
                            <tr>
                                <th class="p-3">Open Date</th>
                                <th class="p-3">Close Date</th>
                                <th class="p-3">Type</th>
                                <th class="p-3">Size</th>
                                <th class="p-3">Symbol</th>
                                <th class="p-3 text-right">Profit</th>
                                <th class="p-3 text-right">Pips</th>
                                <th class="p-3">Comment</th>
                            </tr>
                        </thead>
                        <tbody id="inspector-table-body" class="divide-y divide-gray-800">
                            <tr><td colspan="8" class="p-8 text-center text-gray-500 italic">Loading...</td></tr>
                        </tbody>
                    </table>
                </div>
                <div class="p-2 border-t border-gray-700 bg-gray-800/50 rounded-b-xl text-xs text-gray-500 text-right">
                    Total Trades: <span id="inspector-total-count" class="text-white font-bold">0</span>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
    }

    // Populate
    modal.querySelector('#inspector-magic-id').textContent = magicId;
    const tbody = modal.querySelector('#inspector-table-body');
    const countSpan = modal.querySelector('#inspector-total-count');

    tbody.innerHTML = '';

    if (allTrades.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-gray-500 italic">No trades found for this ID.</td></tr>`;
    } else {
        allTrades.forEach(t => {
            const profitVal = typeof t.profit === 'number' ? t.profit : parseFloat(String(t.profit).replace(/[^0-9.-]/g, '')) || 0;
            const isWin = profitVal >= 0;
            const safe = (val) => (val === undefined || val === null || val === 'undefined' || val === '') ? '-' : val;

            const row = document.createElement('tr');
            row.className = 'hover:bg-gray-800/50 transition-colors';
            row.innerHTML = `
                <td class="p-3 whitespace-nowrap text-gray-400">${safe(t.openTime)}</td>
                <td class="p-3 whitespace-nowrap text-gray-400">${safe(t.closeTime)}</td>
                <td class="p-3 font-bold ${String(t.action).includes('Buy') ? 'text-emerald-500' : 'text-red-500'}">${t.action}</td>
                <td class="p-3">${safe(t.lots)}</td>
                <td class="p-3 font-bold text-gray-300">${t.symbol}</td>
                <td class="p-3 text-right font-bold ${isWin ? 'text-emerald-400' : 'text-red-400'}">$${profitVal.toFixed(2)}</td>
                <td class="p-3 text-right ${t.pips >= 0 ? 'text-green-500' : 'text-red-500'}">${safe(t.pips)}</td>
                <td class="p-3 text-gray-400 max-w-[200px] truncate" title="${t.comment}">${t.comment}</td>
            `;
            tbody.appendChild(row);
        });
    }

    countSpan.textContent = allTrades.length;
    modal.classList.remove('hidden');
};

function renderMapperContent() {
    renderStrategiesList();
    renderIdsList();
}


