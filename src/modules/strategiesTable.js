import { state, saveMagicNumbers } from '../state.js';
import { formatMetricForDisplay } from '../utils.js';
import { focusMode } from './focusMode.js';
import { CustomizableTable } from './tableEngine.js';
import { openSearchConfigModal } from './searchConfig.js';
import { analyzeCustomPortfolio } from './portfolioBuilder.js?v=2';
import { showToast } from './notifications.js';
import { calculateSQMetrics } from './sqAnalysis_v2.js?v=11';

// Column definitions
const AVAILABLE_COLUMNS = [
    { id: 'name', label: 'Strategy Name', minWidth: 200 },
    { id: 'totalTrades', label: 'Trades', minWidth: 80 },
    { id: 'totalProfit', label: 'Net Profit', minWidth: 100 },
    { id: 'returnDD', label: 'Ret/DD', minWidth: 80 },
    { id: 'upi', label: 'UPI', minWidth: 80 },
    { id: 'sortinoRatio', label: 'Sortino', minWidth: 80 },
    { id: 'sharpeRatio', label: 'Sharpe', minWidth: 80 },
    { id: 'sharpeRatioTrade', label: 'Sharpe (Trade)', minWidth: 80 },
    { id: 'maxDrawdownInDollars', label: 'Max DD $', minWidth: 100 },
    { id: 'maxStagnationTrades', label: 'Stag. Trades', minWidth: 100 },
    { id: 'maxStagnationDays', label: 'Stag. Days', minWidth: 100 },
    { id: 'winningPercentage', label: 'Win %', minWidth: 80 },
    { id: 'profitFactor', label: 'Profit Factor', minWidth: 100 },
    { id: 'sqn', label: 'SQN', minWidth: 80 },
    { id: 'maxDrawdown', label: 'Max DD %', minWidth: 100 }, // Extra but useful
    { id: 'cagr', label: 'CAGR %', minWidth: 80 },
    { id: 'avgTrade', label: 'Avg Trade', minWidth: 100 },
    { id: 'maxConsecutiveLosses', label: 'Max Cons. Losses', minWidth: 100 },
    { id: 'gammaFlowScore', label: 'Gamma Flow Score', minWidth: 100 }
];

// Default configuration
const DEFAULT_CONFIG = {
    visibleColumns: ['name', 'gammaFlowScore', 'totalTrades', 'totalProfit', 'returnDD', 'upi', 'sortinoRatio', 'sharpeRatio', 'maxDrawdownInDollars', 'maxStagnationTrades', 'maxStagnationDays', 'winningPercentage', 'profitFactor', 'sqn', 'maxConsecutiveLosses'],
    columnWidths: {}
};

// Create table instance
export const strategiesTable = new CustomizableTable({
    id: 'strategies',
    storageKey: 'strategiesTableConfig_v10', // Force reset for new columns
    columns: AVAILABLE_COLUMNS,
    defaultConfig: DEFAULT_CONFIG,
    containerId: 'strategies-content',
    buttonLabel: 'Columns',
    modalTitle: 'Configure Strategies Columns',
    onConfigChange: () => renderStrategiesTable()
});

// Sorting state
let sortConfig = {
    column: null,
    direction: 'asc'
};

// Selection state
export const selectedStrategies = new Set();

// Floating action bar state
let floatingActionBar = null;

export const initStrategiesTable = () => {
    strategiesTable.init();
};

export const renderStrategiesTable = () => {
    const tableHead = document.querySelector('#strategies-content thead tr');
    const tableBody = document.getElementById('strategies-table-body');
    if (!tableBody || !tableHead) return;

    // 0. Pre-computation: Identify Linked Strategies
    // Map: originalIndex -> Array of Portfolio Names
    const linkedStrategiesMap = new Map();
    // Map: Strategy Name -> Array of Portfolio Names (For strategies with virtual indices)
    const linkedStrategyNamesMap = new Map();
    // Map: Normalized Name -> Array (Fuzzy)
    const linkedStrategyNormalizedNamesMap = new Map();

    // Helper for normalization
    // Helper for normalization
    const normalizeName = (name) => {
        if (!name) return '';
        return name.toLowerCase()
            .replace('.csv', '')
            .replace(/\(\d+\)/g, '')   // Remove (1), (2)
            // .replace(/ - improved \d+(\.\d+)?/gi, '') // KEEP optimization suffix for strict matching
            .replace(/[\s\._\-]/g, ''); // Remove spaces, dots, underscores, dashes
    };

    // Helper for fuzzy matching (Duplicated from focusMode.js for independence)
    const findBestMatch = (strategyName, availableKeys) => {
        if (!availableKeys || availableKeys.length === 0) return null;
        const cleanTarget = normalizeName(strategyName);

        let bestMatch = null;
        let highestScore = 0;

        availableKeys.forEach(key => {
            const cleanKey = normalizeName(key);
            let score = 0;
            if (cleanKey === cleanTarget) score = 100;
            else if (cleanKey.includes(cleanTarget) || cleanTarget.includes(cleanKey)) score = 50;

            if (score > highestScore) {
                highestScore = score;
                bestMatch = key;
            }
        });
        return bestMatch;
    };

    if (state.savedPortfolios) {
        state.savedPortfolios.forEach(p => {
            // Debug Linked Logic
            // console.log(`[StrategiesTable] Processing Portfolio for Links: ${p.name}`);

            // Hybrid Linking Logic:
            // If we have explicit Strategy Names, rely on them implicitly as they are stable.
            // Only fall back to Indices if Names are missing (legacy portfolios).
            const hasNames = p.strategyNames && Array.isArray(p.strategyNames) && p.strategyNames.length > 0;

            if (p.indices && !hasNames) {
                p.indices.forEach((idx, internalIdx) => {
                    // VALIDATION: If we have strategy names, check if this index makes sense
                    // This is heuristic: if p.strategyNames exists, we should ideally rely on it or cross-check
                    // But indices are supposedly the specific global index source.
                    // Risk: global indices shift if files are added/removed/filtered.

                    if (!linkedStrategiesMap.has(idx)) {
                        linkedStrategiesMap.set(idx, []);
                    }
                    linkedStrategiesMap.get(idx).push(p.name);
                });
            } else if (p.indices && hasNames) {
                // console.log(`[StrategiesTable] Skipping indices for ${p.name} in favor of names.`);
            }
            // Also map by name
            if (p.strategyNames && Array.isArray(p.strategyNames)) {
                p.strategyNames.forEach(name => {
                    if (!linkedStrategyNamesMap.has(name)) {
                        linkedStrategyNamesMap.set(name, []);
                    }
                    // Avoid duplicates
                    const list = linkedStrategyNamesMap.get(name);
                    if (!list.includes(p.name)) list.push(p.name);
                    if (!list.includes(p.name)) list.push(p.name);

                    // Populate Normalized Map
                    const norm = normalizeName(name);
                    if (!linkedStrategyNormalizedNamesMap.has(norm)) {
                        linkedStrategyNormalizedNamesMap.set(norm, []);
                    }
                    const nList = linkedStrategyNormalizedNamesMap.get(norm);
                    if (!nList.includes(p.name)) nList.push(p.name);
                });
            }
        });
    }

    console.log(`[StrategiesTable] Linked Strategies Map created. Size: ${linkedStrategiesMap.size}`);
    console.log(`[StrategiesTable] Linked Strategy Names Map created. Size: ${linkedStrategyNamesMap.size}`);

    const config = strategiesTable.getConfig();

    // 1. Render Headers
    tableHead.innerHTML = '';

    // Checkbox Header
    const thCheckbox = document.createElement('th');
    thCheckbox.className = 'px-4 py-3 w-28 text-left text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10 flex items-center gap-2';

    let btnText = 'All';
    let btnClass = 'bg-gray-800 border-gray-600 text-gray-400 hover:text-white';
    let btnTitle = 'Show All Strategies';

    // Load filter from storage if not set yet (init)
    if (!state.linkedStrategiesFilterInitialized) {
        // DISABLED: localStorage usage exterminated.
        state.linkedStrategiesFilter = 'all';

        // UX IMPROVEMENT: If we have NO saved portfolios, forcing 'only' (Linked) makes no sense as it hides everything.
        // Force reset to 'all' in this case to ensure users see their imported files.
        if (!state.savedPortfolios || state.savedPortfolios.length === 0) {
            state.linkedStrategiesFilter = 'all';
            // Optional: update storage too so it persists for this session context
            // localStorage.setItem('linkedStrategiesFilter', 'all'); // DISABLED
        }

        state.linkedStrategiesFilterInitialized = true;
    }

    if (state.linkedStrategiesFilter === 'hide') {
        btnText = 'Unused';
        btnClass = 'bg-red-900/40 border-red-500 text-red-300 hover:bg-red-900/60';
        btnTitle = 'Showing Only UNUSED (Hiding Linked)';
    } else if (state.linkedStrategiesFilter === 'only') {
        btnText = 'Linked';
        btnClass = 'bg-teal-900/40 border-teal-500 text-teal-300 hover:bg-teal-900/60';
        btnTitle = 'Showing Only LINKED Strategies';
    }

    thCheckbox.innerHTML = `
        <input type="checkbox" id="select-all-strategies" class="form-checkbox h-4 w-4 text-blue-500 rounded border-gray-600 bg-gray-700 cursor-pointer" title="Select/Deselect All">
        <button id="toggle-linked-strategies" class="flex items-center justify-center px-2 py-0.5 h-6 text-[10px] font-bold uppercase rounded border transition-colors ${btnClass}" title="${btnTitle}">
            ${btnText}
        </button>
    `;
    tableHead.appendChild(thCheckbox);

    // Bind toggle event
    setTimeout(() => {
        const toggleBtn = document.getElementById('toggle-linked-strategies');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Cycle: all -> only (Used) -> hide (Unused) -> all
                let nextState = 'all';
                if (state.linkedStrategiesFilter === 'all') nextState = 'only';
                else if (state.linkedStrategiesFilter === 'only') nextState = 'hide';
                else nextState = 'all';

                console.log(`[StrategiesTable] 🔘 Button Clicked. Current: ${state.linkedStrategiesFilter} -> Next: ${nextState}`);

                state.linkedStrategiesFilter = nextState;
                // localStorage.setItem('linkedStrategiesFilter', nextState); // DISABLED

                renderStrategiesTable();
            });
        }
    }, 0);

    config.visibleColumns.forEach(colId => {
        const colDef = AVAILABLE_COLUMNS.find(c => c.id === colId);
        if (!colDef) return;

        const th = document.createElement('th');
        th.className = 'px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10 relative group select-none cursor-pointer hover:text-white transition-colors';

        // Sort Indicator
        let label = colDef.label;
        if (sortConfig.column === colId) {
            label += sortConfig.direction === 'asc' ? ' ▲' : ' ▼';
            th.className += ' text-blue-400';
        }
        th.textContent = label;
        th.dataset.colId = colId;

        // Click to sort
        th.addEventListener('click', (e) => {
            if (e.target.classList.contains('cursor-col-resize')) return;

            if (sortConfig.column === colId) {
                sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
            } else {
                sortConfig.column = colId;
                sortConfig.direction = 'desc';
            }
            renderStrategiesTable();
        });

        // Apply saved width OR auto-fit if first time
        if (config.columnWidths[colId]) {
            th.style.width = config.columnWidths[colId];
            th.style.minWidth = config.columnWidths[colId];
        } else {
            // First time: auto-fit after table is rendered
            setTimeout(() => autoFitColumn(th, colId), 0);
        }

        // Resizer handle
        const resizer = document.createElement('div');
        resizer.className = 'absolute right-0 top-0 bottom-0 w-1 cursor-col-resize bg-gray-600 hover:bg-blue-500 transition-colors';
        resizer.addEventListener('mousedown', initResize);
        resizer.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            autoFitColumn(th, colId);
        });
        th.appendChild(resizer);

        tableHead.appendChild(th);
    });

    // 2. Render Body
    tableBody.innerHTML = '';

    if (!window.analysisResults || window.analysisResults.length === 0) {
        const colSpan = config.visibleColumns.length + 1;
        tableBody.innerHTML = `<tr><td colspan="${colSpan}" class="p-4 text-center text-gray-500">No hay resultados de análisis disponibles.</td></tr>`;
        return;
    }

    let strategies = [];

    // MODIFICATION: Source strategies from Saved Portfolios in Reality Check mode
    // This supports showing the ACTUAL strategies (Xausdjpy...) instead of global defaults (BTC...)
    let sourcedFromPortfolios = false;
    if (state.activeViewMode === 'reality-check' && state.savedPortfolios && state.savedPortfolios.length > 0) {
        console.log(`[StrategiesTable] ⚡ DEBUG: Attempting to source from ${state.savedPortfolios.length} saved portfolios.`);

        const seenNames = new Set();

        state.savedPortfolios.forEach((p, pIdx) => {
            // Processing helper
            // Processing helper
            const processStrategy = (name) => {
                if (seenNames.has(name)) return;
                seenNames.add(name);

                // Try to find the FULL strategy object from state.strategies (Backtest Data Source)
                let stratObj = null;
                if (state.strategies && state.strategies.length > 0) {
                    // Try exact match first
                    stratObj = state.strategies.find(s => s.name === name);
                    if (!stratObj) {
                        // Try normalized match
                        const normName = normalizeName(name);
                        stratObj = state.strategies.find(s => normalizeName(s.name) === normName);
                    }
                }

                // If not found, create a shell object
                if (!stratObj) {
                    stratObj = { name: name, metrics: {}, originalIndex: -1 };
                } else {
                    // Clone it to safely attach realMetrics
                    stratObj = { ...stratObj };
                }

                // Attach Source Portfolio Index for Modal Context
                stratObj.sourcePortfolioIndex = pIdx;

                // Calculate Real Metrics if available
                // Calculate Real Metrics if available
                if (p.realMetrics && p.realMetrics._tradesById) {
                    let trades = [];
                    let matchSource = '';

                    // Robust Normalizer (locally scoped for this logic)
                    const getCleanName = (n) => {
                        return n.replace(/\.csv$/i, '')
                            .replace(/\(\d+\)/g, '') // Remove (1), (2)
                            .replace(/ - Improved \d+(\.\d+)?/gi, '') // Remove optimization suffix
                            .trim();
                    };

                    const cleanName = getCleanName(name);

                    // --- ROBUST ID LOOKUP (Ported from ui.js) ---
                    // 1. Resolve Strategy ID from loaded files matching the name
                    let strategyId = name;
                    const normalizeForId = s => s.replace(/\.csv$/i, '').trim().toLowerCase().replace(/\s+/g, ' ');
                    const normalizedName = normalizeForId(name);

                    if (state.loadedStrategyFiles) {
                        const file = state.loadedStrategyFiles.find(f => normalizeForId(f.name) === normalizedName);
                        if (file && file.strategyId) {
                            strategyId = file.strategyId;
                            console.log(`[StrategiesTable] 🆔 Resolved Strategy ID for '${name}': ${strategyId}`);
                        } else {
                            // console.log(`[StrategiesTable] ❌ File not found for '${name}' (Norm: ${normalizedName})`);
                        }
                    } else {
                        console.warn('[StrategiesTable] ⚠️ state.loadedStrategyFiles is missing!');
                    }

                    // 1. Try Explicit Magic Number Mapping (Priority)
                    // Robust Lookup Keys
                    const mapById = state.magicNumberMap ? state.magicNumberMap[strategyId] : null;     // Key: STRAT_ID
                    const mapByName = state.magicNumberMap ? state.magicNumberMap[name] : null;         // Key: Original Name
                    const mapByClean = state.magicNumberMap ? state.magicNumberMap[cleanName] : null;   // Key: Clean Name
                    const mapByNorm = state.magicNumberMap ? state.magicNumberMap[normalizedName] : null; // Key: Normalized Name

                    // Merge all potential lookups (Priority: ID > Name > Clean)
                    let mapEntry = mapById || mapByName || mapByClean || mapByNorm;

                    if (!mapEntry) {
                        console.warn(`[StrategiesTable] ⚠️ No Mapping found for '${name}' (ID: ${strategyId})`);
                    } else {
                        console.log(`[StrategiesTable] ✅ Mapping found for '${name}':`, mapEntry);
                    }

                    if (mapEntry) {
                        const mappedKeys = Array.isArray(mapEntry) ? mapEntry : [mapEntry];

                        // DEBUG: Inspect what is inside realMetrics to see why we fail
                        const availableKeys = p.realMetrics && p.realMetrics._tradesById ? Object.keys(p.realMetrics._tradesById) : [];
                        // Only log ONCE per portfolio/loop to avoid spam
                        if (availableKeys.length > 0 && Math.random() < 0.05) {
                            console.log(`[StrategiesTable] 🔍 Available Keys in Portfolio '${p.name}':`, availableKeys.slice(0, 5), `... (${availableKeys.length} total)`);
                        }

                        mappedKeys.forEach(k => {
                            // Ensure key is string
                            const keyStr = String(k).trim();

                            // LOGIC UPDATE: Support Account-Namespaced Keys (AccountId::Magic)
                            let foundTrades = null;
                            let usedKey = keyStr;

                            // 1. Try Compound Key first if linked account exists
                            if (p.linkedAccountId) {
                                const compoundKey = `${p.linkedAccountId}::${keyStr}`;
                                if (p.realMetrics._tradesById[compoundKey]) {
                                    foundTrades = p.realMetrics._tradesById[compoundKey];
                                    usedKey = compoundKey;
                                    // console.log(`[StrategiesTable] 🎯 Found trades via Compound Key: ${compoundKey}`);
                                }
                            }

                            // 2. Fallback to Raw Key (Legacy or Direct Map)
                            if (!foundTrades && p.realMetrics._tradesById[keyStr]) {
                                foundTrades = p.realMetrics._tradesById[keyStr];
                                usedKey = keyStr;
                            }

                            if (foundTrades) {
                                trades = trades.concat(foundTrades);
                                console.log(`[StrategiesTable] 💰 Found ${foundTrades.length} trades for key '${usedKey}'`);
                            } else {
                                // Detailed mismatch log for the first few errors
                                // console.warn(`[StrategiesTable] ⚠️ Key '${keyStr}' NOT found. Best match?`, availableKeys.find(ak => ak.includes(keyStr.substring(0, 10)) || keyStr.includes(ak.substring(0, 10))));
                            }
                        });

                        if (trades.length === 0) {
                            console.warn(`[StrategiesTable] ❌ Mapped Strategy '${name}' had KEYS ${JSON.stringify(mappedKeys)} but found NO TRADES in Portfolio '${p.name}'.`);
                            // Force dump of keys if we fail completely on a known mapped strategy
                            if (availableKeys.length < 20) console.log('   -> ALL Available Keys:', availableKeys);
                        } else {
                            matchSource = 'Map';
                        }
                    }

                    // 2. Fallback to Fuzzy Match
                    if (trades.length === 0) {
                        const availableKeys = Object.keys(p.realMetrics._tradesById);
                        // Enhance findBestMatch usage with clean name? 
                        // Our local findBestMatch uses 'normalizeName' which is weak. 
                        // Let's rely on the fuzzy matcher but maybe pass the Clean Name?
                        // Actually, let's keep it as is but rely on improved normalization?
                        // No, let's just run findBestMatch with the original name, but update findBestMatch below to be better.
                        const matchKey = findBestMatch(name, availableKeys);
                        if (matchKey && p.realMetrics._tradesById[matchKey]) {
                            trades = p.realMetrics._tradesById[matchKey];
                            matchSource = 'Fuzzy';
                        }
                    }

                    if (trades.length > 0) {
                        // 3. Normalize Trades for Engine (calculateSQMetrics expects specific format)
                        const parseDate = (d) => {
                            if (!d) return null;
                            // Fix dot notation if present: 01.09.2026 -> 01/09/2026 so Date() understands it
                            const clean = typeof d === 'string' ? d.replace(/\./g, '/') : d;
                            const dateObj = new Date(clean);
                            return isNaN(dateObj.getTime()) ? null : dateObj;
                        };

                        const normalizedTrades = trades.map(t => {
                            const parsedClose = parseDate(t.closeTime || t.closeDate); // Support both keys
                            const parsedOpen = parseDate(t.openTime || t.openDate);
                            const pnl = parseFloat(t.profit) + parseFloat(t.commission || 0) + parseFloat(t.swap || 0);

                            // Fix for Open Trades (which have no closeTime):
                            // We set 'exitTime' (for Engine Calcs) to openTime so they are processed.
                            // We keep 'closeTime' (for UI) as null so it correctly shows as Open ("-").
                            const effectiveExit = parsedClose || parsedOpen;

                            // --- REALITY CHECK GLOBAL LOOKUP (UNCONDITIONAL) ---
                            // User Directive: Do not check for linked portfolios. Always look up real data if available.
                            if (state.activeViewMode === 'reality-check') {
                                const normalize = s => (s || '').replace(/\.csv$/i, '').trim().toLowerCase().replace(/\s+/g, ' ');

                                // 1. Identify Strategy Name/ID
                                let rawName = stratObj.name; // Use stratObj.name as it's the current strategy being processed
                                let sId = stratObj.strategyId || stratObj.name; // Assuming stratObj might have strategyId

                                // If it's a "STRAT_" ID, try to find a real name from loaded files
                                if (sId.startsWith('STR_')) { // Corrected from STRAT_ to STR_ based on common usage
                                    const file = state.loadedStrategyFiles.find(f => f.strategyId === sId);
                                    if (file) rawName = file.name;
                                }

                                console.log(`[RealKPI] Processing Strategy: ${rawName} (ID: ${sId})`);

                                const cleanName = rawName.replace(/\.csv$/i, '').trim();
                                const normalizedName = normalize(rawName);

                                // 2. Resolve Mapped Keys (Robust Lookup)
                                // Priority: Name (Strict) > Clean Name > ID > Normalized
                                const mapByName = state.magicNumberMap[rawName];
                                const mapByClean = state.magicNumberMap[cleanName];
                                const mapById = state.magicNumberMap[sId];
                                const mapByNorm = state.magicNumberMap[normalizedName];

                                let magics = [];

                                // A. Name-based lookup
                                if (state.magicNumberMap[normalizedName]) magics = magics.concat(state.magicNumberMap[normalizedName]);

                                // B. Clean Name lookup
                                const normalizedClean = normalize(cleanName);
                                if (state.magicNumberMap[normalizedClean]) magics = magics.concat(state.magicNumberMap[normalizedClean]);

                                // C. ID-based lookup
                                if (state.magicNumberMap[sId]) magics = magics.concat(state.magicNumberMap[sId]);

                                // Allow for string/number mismatch in map keys
                                const numericId = Number(sId);
                                if (!isNaN(numericId) && state.magicNumberMap[numericId]) magics = magics.concat(state.magicNumberMap[numericId]);

                                // Dedup
                                magics = [...new Set(magics)];

                                console.log(`[RealKPI] Resolved Magics for ${rawName}:`, magics);

                                // 3. Fetch Trades from DeepScanData (Global Cache)
                                let allRealTrades = [];
                                if (state.deepScanData) {
                                    // Debug deepScanData keys once to avoid spam, or check if specific keys exist
                                    console.log('[RealKPI] deepScanData Keys:', Object.keys(state.deepScanData));

                                    if (magics.length > 0) {
                                        Object.values(state.deepScanData).forEach(accountData => {
                                            if (!accountData._tradesById) {
                                                console.warn('[RealKPI] Account Data missing _tradesById:', accountData);
                                                return;
                                            }
                                            magics.forEach(m => {
                                                const magicStr = String(m).trim();
                                                // Try finding by magicStr directly or within the keys
                                                if (accountData._tradesById[magicStr]) {
                                                    allRealTrades = allRealTrades.concat(accountData._tradesById[magicStr]);
                                                }
                                            });
                                        });
                                    }
                                } else {
                                    console.warn('[RealKPI] state.deepScanData is undefined or null');
                                }

                                console.log(`[RealKPI] Found ${allRealTrades.length} trades for ${rawName}`);

                                // 4. Calculate & Assign Metrics
                                if (allRealTrades.length > 0) {
                                    const metrics = calculateSQMetrics(allRealTrades, 10000); // Assuming 10k start balance for KPI
                                    stratObj.realMetrics = metrics;
                                    stratObj.realMetrics.trades = allRealTrades.length;
                                    stratObj.realMetrics.profit = metrics.totalNetProfit;
                                    stratObj.realMetrics.drawdown = metrics.maxDrawdownInDollars;
                                } else {
                                    // console.warn(`[StrategiesTable] ⚠️ No Real Trades found for '${rawName}' (Magics: ${magics})`);
                                }
                            } else {
                                // Debug why it failed
                                // console.warn(`[StrategiesTable] ⚠️ No Real Metrics found for '${name}' (Clean: '${cleanName}') in portfolio '${p.name}'. MapEntry: ${JSON.stringify(mapEntry)}`);
                            }

                            return {
                                ...t,
                                pnl: pnl,
                                closeTime: parsedClose, // Keep null if missing (UI will show "-")
                                openTime: parsedOpen,
                                exitTime: effectiveExit, // Engine requires a timestamp to sequence trades
                                duration: (parsedClose && parsedOpen) ? (parsedClose - parsedOpen) : 0,
                                isOpen: !parsedClose // Internal flag
                            };
                        }).filter(t => {
                            // Filter valid trades (Must have at least an Open Time and valid PnL)
                            const isValid = t.exitTime && !isNaN(t.pnl);
                            if (!isValid && Math.random() < 0.01) {
                                console.warn('[StrategiesTable] 🗑️ Trade Dropped:', {
                                    reason: !t.exitTime ? 'Missing Dates' : 'Invalid PnL',
                                    rawClose: t.closeTime || t.closeDate,
                                    parsedExit: t.exitTime,
                                    pnl: t.pnl
                                });
                            }
                            return isValid;
                        });

                        // 4. Calculate Full Suite of Metrics using the Engine
                        const engineMetrics = calculateSQMetrics(normalizedTrades);

                        // 5. Store in realMetrics
                        if (engineMetrics) {
                            stratObj.realMetrics = {
                                ...engineMetrics, // Spread all engine metrics (sharpeRatio, sqn, etc.)
                                // Explicit overrides/mappings if names differ
                                totalProfit: engineMetrics.totalProfit,
                                totalTrades: engineMetrics.totalTrades,
                                maxDrawdownInDollars: engineMetrics.maxDD,
                                winningPercentage: engineMetrics.winRate,
                                profitFactor: engineMetrics.profitFactor,
                                returnDD: engineMetrics.returnDDRatio,
                                avgTrade: engineMetrics.avgTrade,
                                _aggregatedTrades: normalizedTrades, // Store for chart generation
                                isAggregated: true // Mark as aggregated data
                            };
                        } else {
                            // Fallback: If engine failed (e.g. only Open Trades), still show the strategy!
                            // We can at least show the Trade Count from the raw found trades.
                            console.warn(`[StrategiesTable] ⚠️ Engine Metrics Verification Failed for '${name}'. Using Fallback (Open Trades Only?).`);

                            // Calculate simple sums from raw trades if possible
                            const rawCount = trades.length;
                            const rawProfit = trades.reduce((sum, t) => sum + (parseFloat(t.profit) || 0) + (parseFloat(t.swap) || 0) + (parseFloat(t.commission) || 0), 0);

                            stratObj.realMetrics = {
                                totalTrades: rawCount,
                                totalProfit: rawProfit, // Show current floating PnL if only open trades
                                maxDrawdownInDollars: 0,
                                winningPercentage: 0,
                                profitFactor: 0,
                                returnDD: 0,
                                avgTrade: rawCount > 0 ? (rawProfit / rawCount) : 0,
                                isFloatingOnly: true // Flag to potentially UI hint
                            };
                        }
                    } else {
                        // Debug why it failed
                        // console.warn(`[StrategiesTable] ⚠️ No Real Metrics found for '${name}' (Clean: '${cleanName}') in portfolio '${p.name}'. MapEntry: ${JSON.stringify(mapEntry)}`);
                    }
                }
                strategies.push(stratObj);
            };

            // 1. Try strategies array (full objects) - usually not populated in this context, but check
            if (p.strategies && Array.isArray(p.strategies) && p.strategies.length > 0) {
                // Strategies objects might exist but names are key
                p.strategies.forEach((s) => {
                    const name = (typeof s === 'object') ? (s.name || s.id) : s;
                    if (name) processStrategy(name);
                });
            }
            // 2. Fallback: Try strategyNames array
            else if (p.strategyNames && Array.isArray(p.strategyNames) && p.strategyNames.length > 0) {
                p.strategyNames.forEach(name => processStrategy(name));
            }
        });

        if (strategies.length > 0) {
            sourcedFromPortfolios = true;
            console.log(`[StrategiesTable] Reality Check: Sourced ${strategies.length} unique strategies from Saved Portfolios.`);
        } else {
            console.warn(`[StrategiesTable] ⚠️ Failed to source any strategies from saved portfolios despite having them in state.`);
        }
    }

    // Standard sourcing (non-Reality-Check, or Reality-Check fallback if no portfolios)
    if (!sourcedFromPortfolios && window.analysisResults) {
        window.analysisResults.forEach((r, i) => {
            if (!r.is_saved_portfolio && !r.is_databank_portfolio && !r.isSavedPortfolio && !r.isPortfolio) {
                r.originalIndex = i; // Ensure index is available for filtering
                strategies.push(r);
            }
        });
    }

    // REALITY CHECK ENHANCEMENT: Also include strategies from analysisResults that have magic mappings
    // even if they're NOT in a portfolio. This ensures standalone mapped strategies (like BTC) appear.
    if (state.activeViewMode === 'reality-check' && sourcedFromPortfolios && window.analysisResults && state.magicNumberMap) {
        // Normalize names by removing .csv extension for proper duplicate detection
        const normalizeForComparison = (name) => name.replace(/\.csv$/i, '').trim().toLowerCase();
        const existingNamesNormalized = new Set(strategies.map(s => normalizeForComparison(s.name)));

        console.log(`[StrategiesTable] 🔍 ADDITIONAL MAPPED STRATEGIES CHECK ===============`);
        console.log(`[StrategiesTable]    - Already have ${strategies.length} strategies from portfolios`);
        console.log(`[StrategiesTable]    - Existing names (normalized): `, [...existingNamesNormalized].slice(0, 5));
        console.log(`[StrategiesTable]    - Checking ${window.analysisResults.length} strategies from analysisResults for standalone mappings`);

        let addedCount = 0;
        window.analysisResults.forEach((r, i) => {
            if (r.is_saved_portfolio || r.is_databank_portfolio || r.isSavedPortfolio || r.isPortfolio) return;

            // Normalize name for comparison
            const normalizedName = normalizeForComparison(r.name);
            if (existingNamesNormalized.has(normalizedName)) {
                console.log(`[StrategiesTable]    ⏭️ Skipping duplicate: ${r.name} (normalized: ${normalizedName})`);
                return; // Skip if already included (normalized match)
            }

            // Check if this strategy has a magic number mapping
            const rawName = r.name;
            const cleanName = rawName.replace(/\.csv$/i, '').trim();
            const file = state.loadedStrategyFiles ? state.loadedStrategyFiles[i] : null;
            const stratId = file ? (file.strategyId || file.name) : r.name;

            const hasMapping =
                (state.magicNumberMap[stratId] && state.magicNumberMap[stratId].length > 0) ||
                (state.magicNumberMap[rawName] && state.magicNumberMap[rawName].length > 0) ||
                (state.magicNumberMap[cleanName] && state.magicNumberMap[cleanName].length > 0);

            if (hasMapping) {
                console.log(`[StrategiesTable]    ✅ Adding standalone mapped strategy: ${r.name}`);
                r.originalIndex = i;
                strategies.push(r);
                existingNamesNormalized.add(normalizedName); // Add to set to prevent future duplicates
                addedCount++;
            }
        });

        console.log(`[StrategiesTable]    - Added ${addedCount} additional standalone mapped strategies`);
        console.log(`[StrategiesTable]    - Total strategies now: ${strategies.length}`);
        console.log(`[StrategiesTable] 🔍 END ADDITIONAL MAPPED STRATEGIES CHECK ===============`);
    }

    // --- LATE BINDING / METRIC PRE-CALCULATION ---
    // We must calculate Real KPIs BEFORE filtering, otherwise filters like "Zero Trades" 
    // will hide strategies that haven't been processed yet.
    if (state.activeViewMode === 'reality-check') {
        strategies.forEach((strategy, index) => {
            // Calculate hasDirectMap for use in filters
            const rawName = strategy.name;
            const cleanName = rawName.replace(/\.csv$/i, '').trim();
            const file = state.loadedStrategyFiles[strategy.originalIndex];
            const id = file ? (file.strategyId || file.name) : strategy.name;

            // Check ID, Raw Name, and Clean Name for mapping existence
            const hasDirectMap = state.magicNumberMap && (
                (state.magicNumberMap[id] && state.magicNumberMap[id].length > 0) ||
                (state.magicNumberMap[rawName] && state.magicNumberMap[rawName].length > 0) ||
                (state.magicNumberMap[cleanName] && state.magicNumberMap[cleanName].length > 0)
            );

            strategy._hasMap = hasDirectMap; // TAG FOR FILTERS

            // Execute Late Binding if needed
            if (!strategy.realMetrics && state.deepScanData) {
                try {
                    // 1. Resolve Identity (Duplicated from original block, but needed here)
                    const normalize = s => (s || '').replace(/\.csv$/i, '').trim().toLowerCase().replace(/\s+/g, ' ');
                    let sId = strategy.strategyId || strategy.name;
                    let resolvedFileName = null; // Store resolved file name for map lookup

                    if (state.loadedStrategyFiles) {
                        // FIX: Robust matching (Ignore .csv diff)
                        const f = state.loadedStrategyFiles.find(f => {
                            // strict match
                            if (f.name === rawName) return true;
                            // loose match (ignore .csv)
                            if (f.name.replace(/\.csv$/i, '').trim() === rawName.replace(/\.csv$/i, '').trim()) return true;
                            return false;
                        });

                        if (f) {
                            if (f.strategyId) sId = f.strategyId;
                            resolvedFileName = f.name; // Capture filename (likely has .csv)
                        }
                    }

                    // 2. Resolve Magics
                    const cleanName = rawName.replace(/\.csv$/i, '').trim();
                    const normalizedName = normalize(rawName);
                    let magics = [];

                    // CRITICAL FIX: Lookup by Raw Name first
                    if (state.magicNumberMap[rawName]) {
                        console.log(`[RealKPI] ✅ Matched via RawName: '${rawName}'`);
                        magics = magics.concat(state.magicNumberMap[rawName]);
                    }
                    if (state.magicNumberMap[normalizedName]) {
                        console.log(`[RealKPI] ✅ Matched via NormName: '${normalizedName}'`);
                        magics = magics.concat(state.magicNumberMap[normalizedName]);
                    }
                    if (state.magicNumberMap[cleanName]) {
                        console.log(`[RealKPI] ✅ Matched via CleanName: '${cleanName}'`);
                        magics = magics.concat(state.magicNumberMap[cleanName]);
                    }
                    if (state.magicNumberMap[sId]) {
                        console.log(`[RealKPI] ✅ Matched via ID: '${sId}'`);
                        magics = magics.concat(state.magicNumberMap[sId]);
                    }

                    // Add Resolved File Name Lookup
                    if (resolvedFileName && state.magicNumberMap[resolvedFileName]) {
                        console.log(`[RealKPI] ✅ Matched via ResolvedFile: '${resolvedFileName}'`);
                        magics = magics.concat(state.magicNumberMap[resolvedFileName]);
                    } else if (resolvedFileName) {
                        console.log(`[RealKPI] ❌ Failed via ResolvedFile: '${resolvedFileName}' (Map has it? ${!!state.magicNumberMap[resolvedFileName]})`);
                    }

                    console.log(`[RealKPI] Strategy '${rawName}' (File: '${resolvedFileName}') -> Keys Checked:`,
                        { raw: rawName, clean: cleanName, norm: normalizedName, id: sId, file: resolvedFileName });

                    const numericId = Number(sId);
                    if (!isNaN(numericId) && state.magicNumberMap[numericId]) magics = magics.concat(state.magicNumberMap[numericId]);
                    magics = [...new Set(magics)];



                    if (magics.length > 0) {
                        // 3. Fetch Trades
                        let allRealTrades = [];
                        Object.entries(state.deepScanData).forEach(([accountId, accountData]) => {
                            const tradesMap = accountData.tradesById || accountData._tradesById;
                            if (!tradesMap) return;

                            magics.forEach(m => {
                                const magicStr = String(m).trim();
                                let lookupKey = magicStr;
                                if (magicStr.includes('::')) {
                                    const [linkedAcctId, realMagic] = magicStr.split('::');
                                    if (String(linkedAcctId) !== String(accountId)) return;
                                    lookupKey = realMagic;
                                }
                                const availableKeys = Object.keys(tradesMap);
                                if (tradesMap[lookupKey]) allRealTrades = allRealTrades.concat(tradesMap[lookupKey]);
                                else if (tradesMap[magicStr]) allRealTrades = allRealTrades.concat(tradesMap[magicStr]);
                                else {
                                    const lowerLookup = lookupKey.toLowerCase();
                                    const match = availableKeys.find(k => k.toLowerCase() === lowerLookup);
                                    if (match) allRealTrades = allRealTrades.concat(tradesMap[match]);
                                }
                            });
                        });

                        // Normalize and Calculate
                        if (allRealTrades.length > 0) {
                            const normalizedTrades = allRealTrades.map(trade => {
                                // Basic normalization for engine
                                const p = parseFloat(trade.profit) || 0;
                                const s = parseFloat(trade.swap) || 0;
                                const c = parseFloat(trade.commission) || 0;
                                const pnl = p + s + c;
                                let closeDate = trade.closeTime ? new Date(trade.closeTime) : null;
                                if (trade.closeDate) closeDate = new Date(trade.closeDate); // Fallback
                                // If invalid date, try to parse string "DD.MM.YYYY HH:mm"
                                if (!closeDate || isNaN(closeDate.getTime())) {
                                    // Assuming ISO for now or handled by Date()
                                }

                                return {
                                    ...trade,
                                    pnl: pnl,
                                    closeTime: closeDate,
                                    exitTime: closeDate // for engine
                                };
                            }).filter(t => t.exitTime && !isNaN(t.pnl)); // Filter invalid

                            const metrics = calculateSQMetrics(normalizedTrades, 10000); // 10k dummy balance
                            strategy.realMetrics = metrics;
                            strategy.realMetrics.trades = normalizedTrades.length;
                            strategy.realMetrics._aggregatedTrades = normalizedTrades; // Store for chart generation
                            strategy.realMetrics.isAggregated = true; // Mark as aggregated data
                            // Fix Max DD Persistence: Map generic maxDD to table column ID
                            strategy.realMetrics.maxDrawdownInDollars = metrics.maxDD;
                            strategy.realMetrics.profit = metrics.totalNetProfit; // Aliasing just in case
                            // We don't overwrite profit/drawdown here to keep Backtest metrics visible?
                            // User wants Real KPIs "populated".
                            // So we SHOULD overwrite for display in columns that use generic keys, 
                            // OR reliance on `getMetricValue` handling `realMetrics`.
                            // `getMetricValue` prioritizes `realMetrics` if activeViewMode is reality-check.
                            // So just attaching `realMetrics` is enough.
                        }
                    }
                } catch (err) {
                    console.error('[PreCalc] Error:', err);
                }
            }
        });
    }

    // FILTER: Linked Strategies (3-state)
    console.log(`[StrategiesTable] 🛡️ Applying Filter: ${state.linkedStrategiesFilter.toUpperCase()}`);
    console.log(`[StrategiesTable]    - Total Before: ${strategies.length}`);
    console.log(`[StrategiesTable]    - Linked Map Size: ${linkedStrategiesMap.size}`);
    console.log(`[StrategiesTable]    - Linked Names Size: ${linkedStrategyNamesMap.size}`);

    if (state.linkedStrategiesFilter === 'hide') {
        strategies = strategies.filter(s => {
            const norm = normalizeName(s.name);
            return !linkedStrategiesMap.has(s.originalIndex) &&
                !linkedStrategyNamesMap.has(s.name) &&
                !linkedStrategyNormalizedNamesMap.has(norm);
        });
    } else if (state.linkedStrategiesFilter === 'only') {
        strategies = strategies.filter(s => {
            const norm = normalizeName(s.name);
            const isLiked = linkedStrategiesMap.has(s.originalIndex) ||
                linkedStrategyNamesMap.has(s.name) ||
                linkedStrategyNormalizedNamesMap.has(norm);

            // Debug failure slightly
            // if (!isLiked && strategies.length < 100) console.log(`[Filter] Failed: ${s.name} -> Norm: ${norm}`);
            return isLiked;
        });
    } else {
        console.log(`[StrategiesTable]    - Showing ALL.`);
    }
    console.log(`[StrategiesTable]    - Total After: ${strategies.length}`);

    // FILTER: Reality Check Mode (Only if NOT sourced from portfolios directly)
    // If we sourced from portfolios, we already have the correct set.
    // NEW LOGIC: Do NOT require strategies to be in a portfolio. 
    // Only filter by whether they have real trades (done in Zero Trades filter below).
    if (state.activeViewMode === 'reality-check' && !sourcedFromPortfolios) {
        console.log(`[StrategiesTable] 🔍 REALITY CHECK FILTER DEBUG ===============`);
        console.log(`[StrategiesTable]    - Strategies BEFORE any filter: ${strategies.length}`);
        console.log(`[StrategiesTable]    - sourcedFromPortfolios: ${sourcedFromPortfolios}`);
        console.log(`[StrategiesTable]    - magicNumberMap keys: ${state.magicNumberMap ? Object.keys(state.magicNumberMap).length : 0}`);
        console.log(`[StrategiesTable]    - deepScanData accounts: ${state.deepScanData ? Object.keys(state.deepScanData).length : 0}`);

        // DEBUG: Log first 5 strategies to see their state
        strategies.slice(0, 5).forEach((s, i) => {
            console.log(`[StrategiesTable] 📋 Strategy[${i}]: ${s.name}`);
            console.log(`[StrategiesTable]    _hasMap: ${s._hasMap}`);
            console.log(`[StrategiesTable]    realMetrics?: ${!!s.realMetrics}`);
            if (s.realMetrics) {
                console.log(`[StrategiesTable]    realMetrics.trades: ${s.realMetrics.trades || s.realMetrics.totalTrades}`);
            }
        });

        // OLD LOGIC REMOVED: We no longer require strategies to be in a linked portfolio.
        // The ONLY filter should be: does this strategy have real trades?
        // That filter is applied below in "Zero Trades Cleanup".

        console.log(`[StrategiesTable] ✅ Portfolio-association filter DISABLED. Strategies passed through: ${strategies.length}`);
        console.log(`[StrategiesTable] 🔍 END REALITY CHECK FILTER DEBUG ===============`);
    }


    // FILTER: Reality Check Mode - Zero Trades Cleanup
    // User Request: "habria k filtrar akellas k trades sea 0 (en este modo)"
    if (state.activeViewMode === 'reality-check') {
        console.log(`[StrategiesTable] 🧹 ZERO TRADES FILTER DEBUG ===============`);
        console.log(`[StrategiesTable]    - Strategies BEFORE Zero Trade filter: ${strategies.length}`);

        const hasMappings = state.magicNumberMap && Object.keys(state.magicNumberMap).length > 0;
        const hasLinkedPortfolios = state.savedPortfolios && state.savedPortfolios.some(p => p.linkedAccountId);
        const isSystemConfigured = hasMappings || hasLinkedPortfolios;
        console.log(`[StrategiesTable]    - hasMappings: ${hasMappings}`);
        console.log(`[StrategiesTable]    - hasLinkedPortfolios: ${hasLinkedPortfolios}`);
        console.log(`[StrategiesTable]    - isSystemConfigured: ${isSystemConfigured}`);

        const preFilterCount = strategies.length;
        const droppedStrategies = [];
        const passedStrategies = [];

        strategies = strategies.filter(s => {
            let trades = getMetricValue(s, 'totalTrades');
            let tradesSource = 'getMetricValue';

            // STRICT MODE: If system is configured (not clean slate), force check on Real Metrics only.
            // Do not fall back to Backtest trades if Real Trades are missing/zero.
            if (isSystemConfigured) {
                trades = s.realMetrics ? (s.realMetrics.totalTrades || s.realMetrics.trades) : 0;
                tradesSource = 'realMetrics';
            }

            const passed = trades && trades > 0;

            if (!passed) {
                droppedStrategies.push({
                    name: s.name,
                    trades: trades,
                    tradesSource: tradesSource,
                    hasRealMetrics: !!s.realMetrics,
                    _hasMap: s._hasMap
                });
            } else {
                passedStrategies.push({
                    name: s.name,
                    trades: trades
                });
            }

            return passed;
        });

        console.log(`[StrategiesTable] ✅ PASSED (${passedStrategies.length}):`);
        passedStrategies.slice(0, 10).forEach(s => {
            console.log(`[StrategiesTable]    ✅ ${s.name} (${s.trades} trades)`);
        });
        if (passedStrategies.length > 10) {
            console.log(`[StrategiesTable]    ... and ${passedStrategies.length - 10} more`);
        }

        console.log(`[StrategiesTable] ❌ DROPPED (${droppedStrategies.length}):`);
        droppedStrategies.forEach(s => {
            console.log(`[StrategiesTable]    ❌ ${s.name} | trades=${s.trades} | src=${s.tradesSource} | hasRealMetrics=${s.hasRealMetrics} | _hasMap=${s._hasMap}`);
        });

        console.log(`[StrategiesTable] 🧹 END ZERO TRADES FILTER DEBUG ===============`);
    }

    // Update count badge
    const countBadge = document.getElementById('strategies-count');
    if (countBadge) {
        countBadge.textContent = strategies.length;
        countBadge.classList.remove('hidden');
    }

    // EXPOSE FOR NAVIGATION CONTROLS
    window.currentTableStrategies = strategies;

    if (strategies.length === 0) {
        // FAILSAFE: If filtered to 0 because of 'linked only' but we have no portfolios, AUTO RESET immediately.
        if (state.linkedStrategiesFilter === 'only' && (!state.savedPortfolios || state.savedPortfolios.length === 0)) {
            console.warn('[StrategiesTable] ⚠️ Auto-Resetting Filter from ONLY to ALL because no portfolios exist.');
            state.linkedStrategiesFilter = 'all';
            localStorage.setItem('linkedStrategiesFilter', 'all');
            // Prevent infinite loop if something else is wrong? 
            // We trust renderStrategiesTable will find strategies next time if they exist.
            // Using setTimeout to break stack
            setTimeout(() => renderStrategiesTable(), 0);
            return;
        }

        const colSpan = config.visibleColumns.length + 1;
        let msg = "No se encontraron estrategias individuales.";
        if (state.linkedStrategiesFilter === 'only') {
            msg = `No encontre estrategias vinculadas para este modo. <br>
                   <button id="reset-filter-btn" class="mt-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold transition-colors">
                       Ver Todas (Reset Filtro)
                   </button>`;
        } else if (state.linkedStrategiesFilter === 'hide') {
            msg = "No se encontraron estrategias no vinculadas. (Filtro 'Unused' activo)";
        }
        tableBody.innerHTML = `<tr><td colspan="${colSpan}" class="p-8 text-center text-gray-400">${msg}</td></tr>`;

        // Bind Reset Button if it exists
        setTimeout(() => {
            const resetBtn = document.getElementById('reset-filter-btn');
            if (resetBtn) {
                resetBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    console.log('[StrategiesTable] Resetting filter to ALL via user action.');
                    state.linkedStrategiesFilter = 'all';
                    localStorage.setItem('linkedStrategiesFilter', 'all');
                    renderStrategiesTable();
                });
            }
        }, 0);

        return;
    }

    // Sort strategies
    if (sortConfig.column) {
        strategies.sort((a, b) => {
            const valA = getMetricValue(a, sortConfig.column);
            const valB = getMetricValue(b, sortConfig.column);

            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    strategies.forEach((strategy, index) => {
        // CRITICAL FIX: ALWAYS find index in state.loadedStrategyFiles by name
        // strategy.originalIndex from analysisResults may be wrong due to different ordering
        const stratName = strategy.name;
        const originalIndex = state.loadedStrategyFiles.findIndex(f =>
            f.name === stratName ||
            f.name.replace(/\.csv$/i, '') === stratName.replace(/\.csv$/i, '')
        );
        console.log(`[StrategiesTable DEBUG] Row ${index}: strategy.name='${strategy.name}', originalIndex=${originalIndex}, foundFile='${state.loadedStrategyFiles[originalIndex]?.name}'`);



        const metrics = strategy.analysis?.metrics || strategy.analysis || strategy.metrics || {};
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-700/50 transition-colors cursor-pointer border-b border-gray-700 last:border-0';
        row.dataset.originalIndex = originalIndex; // ADD THIS for selectAll() to work

        // Checkbox Cell
        const tdCheckbox = document.createElement('td');
        tdCheckbox.className = 'px-4 py-3 w-28';
        tdCheckbox.innerHTML = `
            <input type="checkbox" class="form-checkbox h-4 w-4 text-blue-500 rounded border-gray-600 bg-gray-700 focus:ring-offset-gray-800"
                ${(originalIndex !== -1 && selectedStrategies.has(originalIndex)) ? 'checked' : ''}>
        `;
        tdCheckbox.querySelector('input').addEventListener('change', (e) => {
            e.stopPropagation();
            if (originalIndex === -1) return; // Cannot select virtual strategies yet
            const strategyName = strategy.name || 'unknown';
            if (e.target.checked) {
                selectedStrategies.add(originalIndex);
                console.log(`[StrategiesTable DEBUG] ✅ SELECTED: index=${originalIndex}, name='${strategyName}'`);
            } else {
                selectedStrategies.delete(originalIndex);
                console.log(`[StrategiesTable DEBUG] ❌ DESELECTED: index=${originalIndex}, name='${strategyName}'`);
            }
            console.log(`[StrategiesTable DEBUG] Current selection:`, [...selectedStrategies]);
            updateFloatingActionBar();
        });
        tdCheckbox.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT') {
                const checkbox = tdCheckbox.querySelector('input');
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            }
        });
        row.appendChild(tdCheckbox);

        // Data Cells
        // if (index === 0) { ... } // Debug removed

        config.visibleColumns.forEach(colId => {
            const td = document.createElement('td');
            td.className = 'px-4 py-3 text-gray-300 truncate';

            let value = getMetricValue(strategy, colId);

            if (colId === 'name') {
                td.className += ' font-medium text-white';
                td.title = value; // Tooltip for full name

                // Render Name with Potential Link Tag
                let html = `<span>${value}</span>`;

                // 2. Optimized Link Check using both Maps and Normalization
                let linkedPortfolios = linkedStrategiesMap.get(originalIndex) || linkedStrategyNamesMap.get(strategy.name);

                // Fallback: Normalized Name Lookup
                if (!linkedPortfolios) {
                    const normName = normalizeName(strategy.name);
                    linkedPortfolios = linkedStrategyNormalizedNamesMap.get(normName);
                    // DEBUG NORMALIZATION
                    // if (index < 3) console.log(`[StrategiesTable] Norm Lookup: '${strategy.name}' -> '${normName}' found? ${!!linkedPortfolios}`);
                }

                // DEBUG BADGE:
                if (index < 5) {
                    console.log(`[StrategiesTable] Badge Check for '${strategy.name}': Found? ${!!linkedPortfolios} (via Index ${originalIndex}? ${linkedStrategiesMap.has(originalIndex)}, via Name? ${linkedStrategyNamesMap.has(strategy.name)})`);
                    if (!linkedPortfolios) {
                        console.log('   -> Name Map Keys Sample:', Array.from(linkedStrategyNamesMap.keys()).slice(0, 5));
                    }
                }

                if (linkedPortfolios && linkedPortfolios.length > 0) {
                    const validLinks = linkedPortfolios.filter(p => p); // Remove null/undefined
                    if (validLinks.length > 0) {
                        const tooltip = `Linked to: ${validLinks.join(', ')}`;
                        // Improved Visibility: removed opacity /50, added whitespace-nowrap
                        html += `
                            <div class="inline-flex items-center ml-2 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-teal-900 text-teal-200 border border-teal-600 cursor-help whitespace-nowrap" title="${tooltip}">
                                🔗 ${validLinks.length > 1 ? validLinks.length + ' Portfolios' : validLinks[0]}
                            </div>
                        `;
                    }
                }

                // FEATURE: View Trades Button (Reality Check OR Backtest Mode)
                if (state.activeViewMode === 'reality-check' || state.activeViewMode === 'backtest') {
                    // Logic: If we have an index (0+), use it. If not (-1), use the Strategy Name string.
                    // ROBUST ESCAPING:
                    // 1. If using index, it's a number. Safe.
                    // 2. If using name, we must quote it as a JS string argument inside the HTML attribute.
                    //    We use JSON.stringify to get a valid JS string literal (e.g. "Name"), 
                    //    then escape double quotes for HTML attribute safety (&quot;) or use single quotes for attribute.

                    let targetRef;
                    if (originalIndex !== -1 && originalIndex !== undefined) {
                        targetRef = originalIndex;
                    } else {
                        // It's a string argument. JSON.stringify gives ( "Name" )
                        // We need to pass it to openRealTradesModal( "Name", ... ) inside onclick='...'.
                        // onclick='func("Name")' -> OK.
                        // If name contains ", JSON gives "Na\"me". onclick='func("Na\"me")' -> OK.
                        // If name contains ', JSON gives "Na'me". onclick='func("Na'me")' -> OK.
                        // We just need to Replace double quotes with &quot; if we use double quotes for attribute?
                        // Actually, simpler: escape single quotes for JS string if wrapping in single quotes.
                        // BUT user names can be messy.
                        // Best way: encodeURIComponent? No, readability.
                        // Let's use the replace method but careful about the outer quote.
                        const safeNameJS = strategy.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                        targetRef = `'${safeNameJS}'`;
                    }

                    const pIdxParam = strategy.sourcePortfolioIndex !== undefined ? strategy.sourcePortfolioIndex : 'null';

                    // Determine type based on mode
                    const type = state.activeViewMode === 'backtest' ? 'backtest' : 'strategy';
                    const title = state.activeViewMode === 'backtest' ? 'View Backtest Trades' : 'View Real Trades';

                    // Always show if in reality check (as we filtered out 0-trade strategies)
                    html += `
                        <button onclick="event.stopPropagation(); window.openRealTradesModal(${targetRef}, '${type}', ${pIdxParam})" 
                            class="ml-2 text-gray-400 hover:text-white transition-colors" title="${title}">
                            🔍
                        </button>
                    `;


                    // Backtest Overlay Toggle (Reality Check Only)
                    if (state.activeViewMode === 'reality-check') {
                        const isOverlayOn = strategy.showBacktestOverlay !== false; // Default true
                        // Use same safe name logic logic
                        const safeNameJS = strategy.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                        html += `
                            <button onclick="event.stopPropagation(); window.toggleStrategyOverlay('${safeNameJS}', this)"
                                class="ml-2 transition-all duration-200 transform hover:scale-110 ${isOverlayOn ? 'text-blue-500 opacity-100' : 'text-gray-600 opacity-50'}" 
                                title="${isOverlayOn ? 'Ocultar Backtest (Overlay)' : 'Mostrar Backtest (Overlay)'}">
                                ${isOverlayOn ? '👁️' : '🚫'}
                            </button>
                        `;
                    }

                    // Quarantine Button
                    // Use same safe name logic
                    const safeNameJS = strategy.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                    html += `
                        <button onclick="event.stopPropagation(); window.addStrategyToQuarantine('${safeNameJS}')" 
                            class="ml-2 text-red-500 hover:text-red-400 transition-colors" title="Mover a Cuarentena">
                            ☣️
                        </button>
                    `;
                }

                td.innerHTML = html;
            } else {
                td.className += ' text-right';
                td.textContent = formatMetricForDisplay(value, colId);

                // Color positive/negative
                if (typeof value === 'number' && !['totalTrades', 'maxStagnationTrades', 'maxStagnationDays', 'maxConsecutiveLosingMonths'].includes(colId)) {
                    td.className += value >= 0 ? ' text-green-400' : ' text-red-400';
                }
            }
            row.appendChild(td);
        });

        // Row click handler
        row.addEventListener('click', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.closest('td').classList.contains('w-10')) {
                return;
            }
            console.log('Strategy clicked:', strategy);
        });

        // Focus Mode Click
        row.addEventListener('click', (e) => {
            // Ignore if clicking on checkbox or actions (if any)
            if (e.target.closest('input[type="checkbox"]') || e.target.closest('button') || e.target.closest('.cursor-col-resize')) return;

            focusMode.enable(strategy, 'strategy', row);
        });

        tableBody.appendChild(row);
    });

    // Update floating action bar visibility
    updateFloatingActionBar();

    // Select All Checkbox Functionality
    const selectAllCheckbox = document.getElementById('select-all-strategies');
    if (selectAllCheckbox) {
        // Get all individual row checkboxes
        const rowCheckboxes = tableBody.querySelectorAll('input[type="checkbox"]');

        // Update select all checkbox state based on individual checkboxes
        const updateSelectAllState = () => {
            const allChecked = Array.from(rowCheckboxes).every(cb => cb.checked);
            const someChecked = Array.from(rowCheckboxes).some(cb => cb.checked);
            selectAllCheckbox.checked = allChecked;
            selectAllCheckbox.indeterminate = someChecked && !allChecked;
        };

        // Set initial state
        updateSelectAllState();

        // Handle select all checkbox click
        selectAllCheckbox.addEventListener('change', () => {
            const shouldCheck = selectAllCheckbox.checked;
            rowCheckboxes.forEach(cb => {
                if (cb.checked !== shouldCheck) {
                    cb.checked = shouldCheck;
                    // Dispatch change event to trigger the existing logic
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        });

        // Update select all state when individual checkboxes change
        rowCheckboxes.forEach(cb => {
            cb.addEventListener('change', updateSelectAllState);
        });
    }
};

// Helper: Get metric value from strategy object
const getMetricValue = (strategy, metricKey) => {
    // 1. Determine where metrics are stored
    let source = strategy;
    if (strategy.analysis && strategy.analysis.metrics) source = strategy.analysis.metrics;
    else if (strategy.analysis) source = strategy.analysis;
    else if (strategy.metrics) source = strategy.metrics;

    // 2. Extract value with mappings
    let val = source[metricKey];

    if (metricKey === 'returnDD') val = source['profitMaxDD_Ratio'];
    if (metricKey === 'avgTrade') {
        const p = source['totalProfit'] || 0;
        const t = source['totalTrades'] || 0;
        val = t > 0 ? p / t : 0;
    }

    // 3. Fallback to strategy root if not found in source (and source was nested)
    if (val === undefined && source !== strategy) {
        val = strategy[metricKey];
        if (metricKey === 'returnDD') val = strategy['profitMaxDD_Ratio'];
    }

    // 4. REALITY CHECK OVERRIDE
    if (state.activeViewMode === 'reality-check' && strategy.realMetrics) {
        if (strategy.realMetrics[metricKey] !== undefined) {
            return strategy.realMetrics[metricKey];
        }
    }

    return val ?? (metricKey === 'name' ? strategy.fileName : 0);
};

// Auto-fit column to content
function autoFitColumn(th, colId) {
    const tableBody = document.getElementById('strategies-table-body');
    if (!tableBody) return;

    const rows = tableBody.querySelectorAll('tr');
    let maxWidth = 50; // Minimum width

    // Create temporary element to measure text
    const tempSpan = document.createElement('span');
    tempSpan.style.visibility = 'hidden';
    tempSpan.style.position = 'absolute';
    tempSpan.style.whiteSpace = 'nowrap';
    tempSpan.className = 'px-4 py-3 text-xs'; // Same padding as cells
    document.body.appendChild(tempSpan);

    // Measure header
    tempSpan.textContent = th.textContent;
    maxWidth = Math.max(maxWidth, tempSpan.offsetWidth + 20); // +20 for resizer

    // Measure all cells in this column
    const config = strategiesTable.getConfig();
    const colIndex = config.visibleColumns.indexOf(colId) + 1; // +1 for checkbox column

    rows.forEach(row => {
        const cell = row.children[colIndex];
        if (cell) {
            tempSpan.textContent = cell.textContent;
            maxWidth = Math.max(maxWidth, tempSpan.offsetWidth);
        }
    });

    document.body.removeChild(tempSpan);

    // Apply the width
    const newWidth = maxWidth + 'px';
    th.style.width = newWidth;
    th.style.minWidth = newWidth;

    // Save to config
    const tableConfig = strategiesTable.getConfig();
    tableConfig.columnWidths[colId] = newWidth;
    localStorage.setItem('strategiesTableConfig', JSON.stringify(tableConfig));
}

// Resizer functionality
let resizeData = null;

function initResize(e) {
    resizeData = {
        th: e.target.parentElement,
        startX: e.pageX,
        startWidth: e.target.parentElement.offsetWidth
    };
    document.addEventListener('mousemove', doResize);
    document.addEventListener('mouseup', stopResize);
    e.preventDefault();
}

function doResize(e) {
    if (!resizeData) return;
    const delta = e.pageX - resizeData.startX;
    const newWidth = Math.max(50, resizeData.startWidth + delta);
    resizeData.th.style.width = newWidth + 'px';
    resizeData.th.style.minWidth = newWidth + 'px';
}

function stopResize() {
    if (resizeData) {
        const colId = resizeData.th.dataset.colId;
        const newWidth = resizeData.th.style.width;

        const config = strategiesTable.getConfig();
        config.columnWidths[colId] = newWidth;
        localStorage.setItem('strategiesTableConfig', JSON.stringify(config));

        resizeData = null;
    }
    document.removeEventListener('mousemove', doResize);
    document.removeEventListener('mouseup', stopResize);
}

// Floating Action Bar
export const updateFloatingActionBar = () => {
    const count = selectedStrategies.size;

    if (count === 0) {
        if (floatingActionBar) {
            floatingActionBar.remove();
            floatingActionBar = null;
        }
        return;
    }

    if (!floatingActionBar) {
        floatingActionBar = document.createElement('div');
        floatingActionBar.id = 'strategies-floating-action-bar';
        floatingActionBar.className = 'fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-4 z-50 animate-slide-up';
        document.body.appendChild(floatingActionBar);
    }

    floatingActionBar.innerHTML = `
        <span class="font-bold text-lg">${count} ${count === 1 ? 'strategy' : 'strategies'} selected</span>
        <button id="fab-find-team-btn" class="bg-white text-purple-600 px-4 py-2 rounded-full font-bold hover:bg-gray-100 transition-all flex items-center gap-2">
            <span>⚡</span>
            <span>Find Team</span>
        </button>
        <button id="fab-test-selection" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-full font-bold transition-all flex items-center gap-2" title="Probar combinación seleccionada">
            <span>🧪</span>
            <span>Test Selection</span>
        </button>
        <button id="fab-delete-selection" class="bg-red-500 hover:bg-red-600 px-3 py-2 rounded-full font-bold transition-all text-white flex items-center gap-2" title="Delete selected strategies permanently">
            <span>🗑️</span>
        </button>
        <button id="fab-deselect-all-btn" class="bg-gray-500 hover:bg-gray-600 px-3 py-2 rounded-full font-bold transition-all">
            Clear
        </button>
    `;

    document.getElementById('fab-find-team-btn').addEventListener('click', () => {
        const selectedIndices = Array.from(selectedStrategies);
        openSearchConfigModal(selectedIndices);
    });

    document.getElementById('fab-test-selection').addEventListener('click', () => {
        const selectedIndices = Array.from(selectedStrategies);
        console.log('[StrategiesTable DEBUG] === CREATE PORTFOLIO CLICKED ===');
        console.log('[StrategiesTable DEBUG] selectedStrategies Set:', [...selectedStrategies]);
        console.log('[StrategiesTable DEBUG] selectedIndices Array:', selectedIndices);
        selectedIndices.forEach((idx, i) => {
            const file = state.loadedStrategyFiles[idx];
            const result = window.analysisResults?.[idx];
            console.log(`[StrategiesTable DEBUG] Index ${idx} -> file: ${file?.name}, result: ${result?.name}`);
        });
        analyzeCustomPortfolio(selectedIndices);
    });

    document.getElementById('fab-delete-selection').addEventListener('click', () => {
        deleteSelectedStrategies();
    });

    document.getElementById('fab-deselect-all-btn').addEventListener('click', () => {
        selectedStrategies.clear();
        renderStrategiesTable();
    });
};

const deleteSelectedStrategies = () => {
    const indicesToDelete = Array.from(selectedStrategies).sort((a, b) => b - a); // Sort descending to splice correctly
    if (indicesToDelete.length === 0) return;

    if (!confirm(`Are you sure you want to PERMANENTLY delete ${indicesToDelete.length} strategies? This cannot be undone.`)) {
        return;
    }

    // 1. Remove from State
    indicesToDelete.forEach(originalIndex => {
        if (state.loadedStrategyFiles[originalIndex]) {
            state.loadedStrategyFiles.splice(originalIndex, 1);
        }
        if (state.rawStrategiesData[originalIndex]) {
            state.rawStrategiesData.splice(originalIndex, 1);
        }
    });

    // 2. Remove from Analysis Results
    if (window.analysisResults) {
        window.analysisResults = window.analysisResults.filter(r =>
            // Keep if it's NOT a strategy strategy with an index in our delete list
            // OR if it's a portfolio/special item
            (r.originalIndex === undefined) || (!indicesToDelete.includes(r.originalIndex))
        );

        // 3. Re-index remaining strategies
        // We only need to shift indices for items that were originally AFTER the deleted ones.
        // But since we just filtered, the simplest way is to re-assign based on new order 
        // assuming window.analysisResults maintains order relative to state.loadedStrategyFiles for strategies.
        // Strategies are usually at the beginning of window.analysisResults.

        // Better approach: Re-map window.analysisResults originalIndex for ALL strategies
        // because loadedStrategyFiles has shifted.
        let strategyCount = 0;
        window.analysisResults.forEach(r => {
            if (r.originalIndex !== undefined && !r.isSavedPortfolio && !r.isDatabankPortfolio && !r.isCurrentPortfolio) {
                // Verify if this matches the file at the new index (sanity check not exhaustive here)
                r.originalIndex = strategyCount++;
            }
        });
    }

    // 4. Update UI
    selectedStrategies.clear();
    renderStrategiesTable();
    showToast(`${indicesToDelete.length} strategies deleted`, 'success');

    // 5. Notify other modules (e.g. to update File List in Config)
    window.dispatchEvent(new CustomEvent('strategies-deleted'));
};
