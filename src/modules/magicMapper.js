import { state, saveMagicNumbers } from '../state.js';
import { showToast } from './notifications.js';
import { renderLiveMonitor } from './liveMonitor.js';
import { fetchLinkedAccountData, normalizeComment, cleanMetrics, recalculateStrategyBreakdown } from './myfxbookUI.js';

// Helper for fuzzy matching
function calculateMatchScore(strategyName, idStr) {
    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const sName = normalize(strategyName);
    const sId = normalize(idStr);

    // Exact containment
    if (sId.includes(sName) || sName.includes(sId)) return 1.0;

    // Check for specific date patterns often mangled (e.g. 1.5.23 vs 1_5_2)
    const extractDigits = (s) => s.match(/\d+/g)?.join('') || '';
    const digitsName = extractDigits(strategyName);
    const digitsId = extractDigits(idStr);

    if (digitsName.length > 3 && digitsId.includes(digitsName)) return 0.9;
    if (digitsId.length > 3 && digitsName.includes(digitsId)) return 0.9;

    // Consonants-only match (Handles abbreviations like BuyStopPlus -> ByStpPls)
    const consonants = (s) => s.toLowerCase().replace(/[aeiou]/g, '').replace(/[^a-z0-9]/g, '');
    const cName = consonants(strategyName);
    const cId = consonants(idStr);

    // High threshold for consonant match
    if (cId.length > 4 && (cId.includes(cName) || cName.includes(cId))) return 0.85;

    return 0.0;
}

let mapperModal = null;
let currentPortfolio = null;
let selectedStrategyId = null;
let tempMapping = {};
let searchTerm = '';

export function openMagicMapper(portfolio) {
    currentPortfolio = portfolio;

    // Ensure metrics are clean before displaying
    if (cleanMetrics(currentPortfolio)) {
        showToast('Optimized trade identifiers for better grouping', 'info');
        // Trigger a save of the portfolios if possible, or just rely on memory for now
        // Ideally we would emit an event to save
        document.dispatchEvent(new CustomEvent('requestSavePortfolios'));
    }

    // Initialize tempMapping from state
    tempMapping = {};
    Object.keys(state.magicNumberMap).forEach(key => {
        const val = state.magicNumberMap[key];
        tempMapping[key] = Array.isArray(val) ? [...val] : (val ? [String(val)] : []);
    });

    // Enforce uniqueness on load (clean up existing conflicts)
    const seenIds = new Set();
    Object.keys(tempMapping).forEach(stratId => {
        const ids = tempMapping[stratId];
        const uniqueIds = [];
        ids.forEach(id => {
            if (!seenIds.has(id)) {
                seenIds.add(id);
                uniqueIds.push(id);
            }
        });
        tempMapping[stratId] = uniqueIds;
    });

    if (!mapperModal) {
        mapperModal = createMapperModal();
        document.body.appendChild(mapperModal);
    }

    // Select first strategy by default
    if (portfolio.indices.length > 0) {
        const firstStrat = state.loadedStrategyFiles[portfolio.indices[0]];
        if (firstStrat) {
            selectedStrategyId = firstStrat.strategyId || firstStrat.name;
        }
    }

    searchTerm = '';
    const searchInput = mapperModal.querySelector('#mapper-search-input');
    if (searchInput) searchInput.value = '';

    renderMapperContent();
    mapperModal.classList.remove('hidden');
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
                    <h2 class="text-2xl font-bold text-white flex items-center gap-2">
                        <span>🔗</span>
                        <span>Link Strategies to Myfxbook IDs</span>
                    </h2>
                    <p class="text-gray-400 text-sm mt-1">Select a strategy on the left, then check the corresponding Myfxbook IDs on the right.</p>
                </div>
                <div class="flex items-center gap-4">
                     <button id="mapper-debug-btn" class="text-gray-500 hover:text-yellow-400 transition-colors" title="Show Raw IDs">
                        🐞
                    </button>
                    <button id="close-mapper-modal" class="text-gray-400 hover:text-white text-3xl">×</button>
                </div>
            </div>
            
            <!-- Unmapped Alert (Dynamic) -->
            <div id="mapper-unmapped-alert" class="hidden mx-6 mt-4 bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 flex items-start gap-3">
                <span class="text-xl">⚠️</span>
                <div class="flex-1">
                    <h4 class="text-sm font-bold text-yellow-200">Unmapped Myfxbook Comments Detected</h4>
                    <p class="text-xs text-yellow-100/70 mt-1">
                        There are <span id="mapper-unmapped-count" class="font-bold text-white">0</span> unique comments in your Myfxbook data that are not linked to any strategy. 
                        Please review the "Available" list to ensure all trades are accounted for.
                    </p>
                </div>
            </div>
            
            <!-- Content -->
            <div class="flex flex-1 overflow-hidden" id="mapper-content-area">
                <!-- Left Column: Strategies -->
                <div class="w-1/4 border-r border-gray-700 flex flex-col bg-gray-900/30 min-w-[300px]">
                    <div class="p-3 border-b border-gray-700 font-bold text-gray-400 text-xs uppercase tracking-wider">
                        Strategies
                    </div>
                    <div id="mapper-strategies-list" class="overflow-y-auto flex-1 p-2 space-y-1">
                        <!-- Strategies list -->
                    </div>
                </div>

                <!-- Right Column: Available IDs -->
                <div class="flex-1 flex flex-col bg-gray-800">
                    <div class="p-3 border-b border-gray-700 flex justify-between items-center gap-4 bg-gray-800 z-10">
                        <div class="flex items-center gap-4 flex-1">
                            <div class="relative flex-1 max-w-md">
                                <span class="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">🔍</span>
                                <input type="text" id="mapper-search-input" 
                                    class="w-full bg-gray-700 border border-gray-600 rounded-lg pl-9 pr-3 py-1.5 text-sm text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    placeholder="Search IDs, symbols...">
                            </div>
                            <div class="flex gap-2">
                                <button id="mapper-auto-link-all" class="text-xs text-green-400 hover:text-green-300 font-medium px-2 py-1 rounded hover:bg-gray-700 border border-green-900/50 flex items-center gap-1" title="Automatically link strategies to best matching IDs">
                                    <span>✨</span> Auto-Link
                                </button>
                                <div class="w-px bg-gray-700 mx-1"></div>
                                <button id="mapper-select-all" class="text-xs text-blue-400 hover:text-blue-300 font-medium px-2 py-1 rounded hover:bg-gray-700">Select All</button>
                                <button id="mapper-deselect-all" class="text-xs text-gray-400 hover:text-gray-300 font-medium px-2 py-1 rounded hover:bg-gray-700">Deselect All</button>
                            </div>
                        </div>
                        <span class="text-xs font-normal text-gray-500">Sorted by Similarity & Trades</span>
                    </div>
                    
                    <div id="mapper-ids-list" class="overflow-y-auto flex-1 p-4 flex flex-col gap-6">
                        <!-- IDs list -->
                    </div>
                </div>
            </div>
            
            <!-- Footer -->
            <div class="p-6 border-t border-gray-700 flex justify-end gap-3 bg-gray-800/50">
                <button id="cancel-mapper-btn" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold transition-colors">
                    Cancel
                </button>
                <button id="save-mapper-btn" class="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-lg shadow-blue-900/20 transition-all transform hover:scale-105">
                    Save Mappings
                </button>
            </div>
        </div>
    `;

    modal.querySelector('#close-mapper-modal').onclick = closeMapperModal;
    modal.querySelector('#cancel-mapper-btn').onclick = closeMapperModal;

    modal.querySelector('#save-mapper-btn').onclick = () => {
        console.log('[Magic Mapper DEBUG] Saving with tempMapping:', JSON.stringify(tempMapping));

        // Update state.magicNumberMap with both ID and Name keys for Robustness
        const newMap = JSON.parse(JSON.stringify(tempMapping));

        // iterate strategies in current portfolio to finding matching names for IDs
        currentPortfolio.indices.forEach(idx => {
            const strat = state.loadedStrategyFiles[idx];
            if (!strat) return;
            const sId = strat.strategyId || strat.name;
            const sName = strat.name;

            // If we have a mapping for the ID...
            if (newMap[sId]) {
                const magics = newMap[sId];
                // ... ensure we also map the Name to it
                if (sName && sName !== sId) {
                    newMap[sName] = magics;

                    // Also Map the Clean Name (no csv) just in case
                    const cleanName = sName.replace(/\.csv$/i, '').trim();
                    if (cleanName !== sName) {
                        newMap[cleanName] = magics;
                    }
                }
            }
        });

        state.magicNumberMap = newMap;
        saveMagicNumbers();

        // Recalculate metrics based on new mapping
        recalculateStrategyBreakdown(currentPortfolio);

        showToast('Mappings saved successfully', 'success');
        renderLiveMonitor();
        closeMapperModal();
    };

    const searchInput = modal.querySelector('#mapper-search-input');
    searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value.toLowerCase();
        renderIdsList();
    });

    // Debug Button
    const debugBtn = modal.querySelector('#mapper-debug-btn');
    if (debugBtn) {
        debugBtn.onclick = () => {
            const magicStats = currentPortfolio.realMetrics?.magicStats || {};
            const keys = Object.keys(magicStats);
            const msg = `Found ${keys.length} IDs:\n\n${keys.join('\n')}`;
            console.log('[Magic Mapper DEBUG] Keys:', keys);
            alert(msg);
        };
    }

    modal.querySelector('#mapper-auto-link-all').onclick = () => {
        const magicStats = currentPortfolio.realMetrics?.magicStats || {};
        const potentialMatches = [];

        // 1. Find all potential matches
        currentPortfolio.indices.forEach(idx => {
            const strategy = state.loadedStrategyFiles[idx];
            if (!strategy) return;

            const strategyId = strategy.strategyId || strategy.name;
            const strategyName = strategy.name;

            Object.values(magicStats).forEach(stat => {
                // Use improved calculateMatchScore instead of generic calculateSimilarity
                const score = calculateMatchScore(strategyName, String(stat.id));
                // Lower threshold slightly as calculateMatchScore is stricter
                if (score >= 0.8) {
                    potentialMatches.push({ strategyId, id: String(stat.id), score });
                }
            });
        });

        // 2. Sort by score descending to prioritize best matches
        potentialMatches.sort((a, b) => b.score - a.score);

        // 3. Assign exclusively (First-Come-First-Served based on score)
        // We respect existing mappings, so we first mark currently mapped IDs as taken
        const assignedIds = new Set();
        Object.values(tempMapping).forEach(ids => {
            if (Array.isArray(ids)) {
                ids.forEach(id => assignedIds.add(id));
            }
        });

        let linkedCount = 0;
        potentialMatches.forEach(match => {
            if (!assignedIds.has(match.id)) {
                if (!tempMapping[match.strategyId]) tempMapping[match.strategyId] = [];
                // Double check if we are not adding duplicates (though Set handles it)
                if (!tempMapping[match.strategyId].includes(match.id)) {
                    tempMapping[match.strategyId].push(match.id);
                    assignedIds.add(match.id);
                    linkedCount++;
                }
            }
        });

        renderMapperContent();
        if (linkedCount > 0) {
            showToast(`Auto-linked ${linkedCount} strategies based on name similarity`, 'success');
        } else {
            showToast('No new high-confidence matches found', 'info');
        }
    };

    modal.querySelector('#mapper-select-all').onclick = () => {
        if (!selectedStrategyId) return;
        const visibleIds = getVisibleIds();
        if (!tempMapping[selectedStrategyId]) tempMapping[selectedStrategyId] = [];

        visibleIds.forEach(stat => {
            const idStr = String(stat.id);
            if (!tempMapping[selectedStrategyId].includes(idStr)) {
                tempMapping[selectedStrategyId].push(idStr);
            }
        });
        renderMapperContent();
    };

    modal.querySelector('#mapper-deselect-all').onclick = () => {
        if (!selectedStrategyId || !tempMapping[selectedStrategyId]) return;
        const visibleIds = getVisibleIds().map(s => String(s.id));

        tempMapping[selectedStrategyId] = tempMapping[selectedStrategyId].filter(id => !visibleIds.includes(id));
        renderMapperContent();
    };

    modal.onclick = (e) => {
        if (e.target === modal) closeMapperModal();
    };

    return modal;
}

// Helper: Calculate similarity between two strings (0 to 1)
function calculateSimilarity(s1, s2) {
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    if (longer.length === 0) return 1.0;

    const editDistance = (s1, s2) => {
        s1 = s1.toLowerCase();
        s2 = s2.toLowerCase();
        const costs = new Array();
        for (let i = 0; i <= s1.length; i++) {
            let lastValue = i;
            for (let j = 0; j <= s2.length; j++) {
                if (i == 0) costs[j] = j;
                else {
                    if (j > 0) {
                        let newValue = costs[j - 1];
                        if (s1.charAt(i - 1) != s2.charAt(j - 1))
                            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                        costs[j - 1] = lastValue;
                        lastValue = newValue;
                    }
                }
            }
            if (i > 0) costs[s2.length] = lastValue;
        }
        return costs[s2.length];
    }

    return (longer.length - editDistance(longer, shorter)) / longer.length;
}

function getVisibleIds() {
    const magicStats = currentPortfolio.realMetrics?.magicStats || {};
    let availableIds = Object.values(magicStats);

    // Filter by search term
    if (searchTerm) {
        availableIds = availableIds.filter(stat =>
            String(stat.id).toLowerCase().includes(searchTerm) ||
            String(stat.symbol).toLowerCase().includes(searchTerm)
        );
    }

    // Sort by similarity to selected strategy if available
    if (selectedStrategyId) {
        // Find strategy name
        const strategyIdx = currentPortfolio.indices.find(idx => {
            const s = state.loadedStrategyFiles[idx];
            return (s.strategyId || s.name) === selectedStrategyId;
        });
        const strategyName = strategyIdx ? state.loadedStrategyFiles[strategyIdx].name : '';

        availableIds.sort((a, b) => {
            const simA = calculateMatchScore(strategyName, String(a.id));
            const simB = calculateMatchScore(strategyName, String(b.id));
            // Sort descending by similarity
            if (Math.abs(simA - simB) > 0.1) return simB - simA;
            // Fallback to trade count
            return b.tradesCount - a.tradesCount;
        });

        // Add similarity score to objects for highlighting
        availableIds.forEach(stat => {
            stat._similarity = calculateMatchScore(strategyName, String(stat.id));
        });
    } else {
        // Default sort by trade count
        availableIds.sort((a, b) => b.tradesCount - a.tradesCount);
    }

    return availableIds;
}

function renderIdsList() {
    const idsList = mapperModal.querySelector('#mapper-ids-list');
    idsList.innerHTML = '';

    // Remove grid classes, ensure flex column
    idsList.className = 'overflow-y-auto flex-1 p-4 flex flex-col gap-6';

    if (!selectedStrategyId) {
        idsList.innerHTML = `
            <div class="text-center py-10 text-gray-500">
                <p>Select a strategy on the left to start mapping.</p>
            </div>
        `;
        return;
    }

    const availableIds = getVisibleIds();

    if (availableIds.length === 0) {
        idsList.innerHTML = `
            <div class="text-center py-10 text-gray-500">
                <div class="text-4xl mb-4">📭</div>
                <h3 class="text-xl font-bold text-gray-300">No IDs Found</h3>
                <p>${searchTerm ? 'Try a different search term.' : 'Sync your Myfxbook account first.'}</p>
            </div>
        `;
        return;
    }

    const currentMappedIds = tempMapping[selectedStrategyId] || [];


    // Split into 3 Categories
    const assignedItems = []; // Assigned to THIS strategy
    const unassignedItems = []; // Globally available (not assigned to anyone)
    const otherAssignedItems = []; // Assigned to other strategies (stealable)

    // Collect all IDs assigned to OTHER strategies
    const otherAssignedIds = new Set();
    Object.keys(tempMapping).forEach(sId => {
        if (sId !== selectedStrategyId && tempMapping[sId]) {
            tempMapping[sId].forEach(id => otherAssignedIds.add(String(id)));
        }
    });

    availableIds.forEach(stat => {
        const idStr = String(stat.id);
        if (currentMappedIds.includes(idStr)) {
            assignedItems.push(stat);
        } else if (otherAssignedIds.has(idStr)) {
            otherAssignedItems.push(stat);
        } else {
            unassignedItems.push(stat);
        }
    });

    // Helper to render a section
    const renderSection = (title, items, type) => {
        if (items.length === 0 && type !== 'unassigned') return; // Skip empty assigned sections

        const section = document.createElement('div');
        section.className = 'flex flex-col gap-2';

        const header = document.createElement('div');
        header.className = `flex items-center gap-2 pb-2 border-b ${type === 'current' ? 'border-blue-500/50' : 'border-gray-700/50'} mt-2`;

        let titleColor = 'text-gray-400';
        if (type === 'current') titleColor = 'text-blue-400';
        if (type === 'unassigned') titleColor = 'text-green-400';

        header.innerHTML = `
            <h3 class="text-sm font-bold ${titleColor} uppercase tracking-wider">${title}</h3>
            <span class="text-xs bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full">${items.length}</span>
        `;
        section.appendChild(header);

        const list = document.createElement('div');
        list.className = 'flex flex-col gap-1';

        if (items.length === 0) {
            list.innerHTML = `<div class="text-xs text-gray-600 italic p-2">No unassigned items available.</div>`;
        } else {
            items.forEach(stat => {
                const idStr = String(stat.id);
                const isChecked = type === 'current';
                const isRecommended = (stat._similarity || 0) > 0.8;

                // Determine Owner if Other
                let ownerName = null;
                if (type === 'other') {
                    const ownerStrategyId = Object.keys(tempMapping).find(sId =>
                        sId !== selectedStrategyId &&
                        tempMapping[sId] &&
                        tempMapping[sId].includes(idStr)
                    );
                    if (ownerStrategyId) {
                        const strategyIdx = currentPortfolio.indices.find(idx => {
                            const s = state.loadedStrategyFiles[idx];
                            return (s.strategyId || s.name) === ownerStrategyId;
                        });
                        ownerName = strategyIdx !== undefined ? state.loadedStrategyFiles[strategyIdx].name : ownerStrategyId;
                    }
                }

                const label = document.createElement('label');
                // Compact Row Styles
                label.className = `flex items-center gap-3 p-2 rounded border transition-all cursor-pointer group
                    ${isChecked
                        ? 'bg-blue-900/20 border-blue-500/50 hover:bg-blue-900/30'
                        : type === 'unassigned' ? 'bg-gray-800 border-gray-700 hover:bg-gray-700' : 'opacity-70 border-dashed border-gray-700 hover:opacity-100'}
                    ${isRecommended && !isChecked ? 'ring-1 ring-green-500/50 bg-green-900/10' : ''}
                `;

                label.innerHTML = `
                    <input type="checkbox" class="form-checkbox h-4 w-4 text-blue-500 rounded border-gray-600 bg-gray-800 focus:ring-blue-500 focus:ring-offset-gray-900 transition-colors" ${isChecked ? 'checked' : ''}>
                    
                    <div class="flex-1 min-w-0 flex items-center gap-3 overflow-hidden">
                        <!-- ID / Comment -->
                        <div class="flex flex-col min-w-0 flex-1">
                            <div class="flex items-center gap-2">
                                <span class="font-mono text-xs font-bold ${isChecked ? 'text-blue-200' : 'text-gray-300'} truncate" title="${stat.exampleRaw || stat.id}">
                                    ${stat.id}
                                </span>
                                ${isRecommended ? '<span class="text-[9px] bg-green-900/50 text-green-400 px-1 rounded border border-green-800 animate-pulse">RECOMMENDED</span>' : ''}
                                ${ownerName ? `<span class="text-[9px] bg-orange-900/30 text-orange-300 px-1.5 py-0.5 rounded border border-orange-800/50 truncate max-w-[150px]" title="Linked to: ${ownerName}">🔗 ${ownerName}</span>` : ''}
                            </div>
                        </div>
                    </div>

                    <!-- Metrics -->
                    <div class="flex items-center gap-3 text-xs whitespace-nowrap">
                        <span class="font-medium text-gray-500 w-12 text-right">${stat.symbol}</span>
                         <span class="font-mono w-16 text-right ${stat.totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}">$${stat.totalProfit.toFixed(0)}</span>
                        <span class="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded text-[10px] min-w-[24px] text-center">${stat.tradesCount}</span>
                    </div>
                `;

                const checkbox = label.querySelector('input');
                checkbox.onchange = (e) => {
                    if (e.target.checked) {
                        // Steal logic
                        Object.keys(tempMapping).forEach(sId => {
                            if (sId !== selectedStrategyId && tempMapping[sId]) {
                                if (tempMapping[sId].includes(idStr)) {
                                    tempMapping[sId] = tempMapping[sId].filter(id => id !== idStr);
                                }
                            }
                        });
                        if (!tempMapping[selectedStrategyId]) tempMapping[selectedStrategyId] = [];
                        if (!tempMapping[selectedStrategyId].includes(idStr)) {
                            tempMapping[selectedStrategyId].push(idStr);
                        }
                        console.log(`[Magic Mapper DEBUG] Added ${idStr} to ${selectedStrategyId}. New list:`, tempMapping[selectedStrategyId]);
                    } else {
                        if (tempMapping[selectedStrategyId]) {
                            tempMapping[selectedStrategyId] = tempMapping[selectedStrategyId].filter(id => id !== idStr);
                        }
                    }
                    renderStrategiesList();
                    renderIdsList();
                };

                list.appendChild(label);
            });
        }
        section.appendChild(list);
        idsList.appendChild(section);
    };

    // Find strategy name for title
    const strategyIdx = currentPortfolio.indices.find(idx => {
        const s = state.loadedStrategyFiles[idx];
        return (s.strategyId || s.name) === selectedStrategyId;
    });
    const strategyName = strategyIdx !== undefined ? state.loadedStrategyFiles[strategyIdx].name : 'Current Strategy';

    // 1. Assigned (Current) - Top priority
    renderSection(`Assigned to: ${strategyName}`, assignedItems, 'current');

    // 2. Unassigned (Available) - Main pool
    renderSection('Available (Unassigned)', unassignedItems, 'unassigned');

    // 3. Assigned to Others (Stealable) - Bottom
    renderSection('Assigned to Other Strategies', otherAssignedItems, 'other');

    // Hide Auto-Link button as requested
    const autoLinkBtn = mapperModal.querySelector('#mapper-auto-link-all');
    if (autoLinkBtn) autoLinkBtn.classList.add('hidden');
}

function renderStrategiesList() {
    const strategiesList = mapperModal.querySelector('#mapper-strategies-list');
    strategiesList.innerHTML = '';

    currentPortfolio.indices.forEach(idx => {
        const strategy = state.loadedStrategyFiles[idx];
        if (!strategy) return;

        const strategyId = strategy.strategyId || strategy.name;
        const mappedIds = tempMapping[strategyId] || [];
        const isSelected = strategyId === selectedStrategyId;

        const div = document.createElement('div');
        div.className = `p-3 rounded-lg cursor-pointer transition-colors flex flex-col gap-1 border border-transparent ${isSelected ? 'bg-blue-600 text-white border-blue-400 shadow-lg' : 'hover:bg-gray-700 text-gray-300 border-gray-700/50'}`;
        div.innerHTML = `
            <div class="font-medium text-sm leading-tight break-words">${strategy.name}</div>
            <div class="flex justify-between items-center mt-1">
                <span class="text-xs opacity-70">${strategy.symbol || 'Unknown'}</span>
                ${mappedIds.length > 0 ? `<span class="text-xs bg-black/30 px-2 py-0.5 rounded-full font-mono">${mappedIds.length} linked</span>` : ''}
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

function renderMapperContent() {
    // 1. Calculate Unmapped Count
    const magicStats = currentPortfolio.realMetrics?.magicStats || {};
    const allAvailableIds = Object.keys(magicStats);

    // Collect all assigned IDs across all strategies
    const assignedIds = new Set();
    Object.values(tempMapping).forEach(ids => {
        if (Array.isArray(ids)) {
            ids.forEach(id => assignedIds.add(String(id)));
        }
    });

    const unmappedCount = allAvailableIds.filter(id => !assignedIds.has(String(id))).length;

    // 2. Update Alert
    const alertBox = mapperModal.querySelector('#mapper-unmapped-alert');
    const countSpan = mapperModal.querySelector('#mapper-unmapped-count');

    if (alertBox && countSpan) {
        if (unmappedCount > 0) {
            alertBox.classList.remove('hidden');
            countSpan.textContent = unmappedCount;
        } else {
            alertBox.classList.add('hidden');
        }
    }

    renderStrategiesList();
    renderIdsList();
}
