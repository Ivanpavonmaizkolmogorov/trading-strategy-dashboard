import { state, saveMagicNumbers } from '../state.js';
import { formatMetricForDisplay } from '../utils.js';
import { focusMode } from './focusMode.js';
import { CustomizableTable } from './tableEngine.js';
import { openSearchConfigModal } from './searchConfig.js';
import { analyzeCustomPortfolio } from './portfolioBuilder.js?v=2';
import { showToast } from './notifications.js';
import { calculateSQMetrics, filterTradesByDate } from './sqAnalysis_v2.js?v=11'; // [MOD] Added filterTradesByDate import
import { TradeSeries } from '../models/TradeSeries.js';

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

// --- ADVANCED FILTER PANEL ---
const renderAdvancedFilterPanel = () => {
    const container = document.getElementById('strategies-content');
    if (!container) return;

    // Safety Init
    if (!state.advancedFilters) {
        state.advancedFilters = { searchText: '', mt5Only: false, linkedOnly: false, selectedPortfolioId: 'all', showQuarantined: false };
    }

    let panel = document.getElementById('strategies-advanced-filters');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'strategies-advanced-filters';
        panel.className = 'bg-gray-800 p-4 border-b border-gray-700 flex flex-wrap gap-4 items-center justify-between shrink-0';

        // Insert before the table controls or table wrapper
        const tableControls = document.getElementById('strategies-table-controls');
        if (tableControls) {
            container.insertBefore(panel, tableControls);
        } else {
            container.prepend(panel);
        }
    }

    // Determine values from state
    const searchText = state.advancedFilters.searchText || '';
    const mt5Active = state.advancedFilters.mt5Only;
    const linkedActive = state.advancedFilters.linkedOnly;
    const quarantineActive = state.advancedFilters.showQuarantined;
    const selectedPortfolio = state.advancedFilters.selectedPortfolioId || 'all';

    // Build Portfolio Options
    let portfolioOptions = '<option value="all">Todos los Portafolios</option>';
    if (state.savedPortfolios) {
        state.savedPortfolios.forEach((p, idx) => {
            const isSel = selectedPortfolio === String(idx) ? 'selected' : '';
            portfolioOptions += `<option value="${idx}" ${isSel}>${p.name}</option>`;
        });
    }

    // Render Inner HTML
    panel.innerHTML = `
        <div class="flex items-center gap-4 flex-1">
            <!-- Search -->
            <div class="relative flex-1 max-w-md">
                <span class="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                </span>
                <input type="text" id="adv-filter-search" value="${searchText}" placeholder="Buscar estrategia..." 
                    class="w-full bg-gray-900 border border-gray-600 rounded-lg py-1.5 pl-10 pr-4 text-sm text-gray-200 focus:border-blue-500 focus:outline-none placeholder-gray-500">
            </div>

            <!-- MT5 Filter -->
            <button id="adv-filter-mt5" class="flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${mt5Active ? 'bg-indigo-900/60 border-indigo-500 text-indigo-200 shadow-sm shadow-indigo-900/20' : 'bg-gray-700 border-gray-600 text-gray-400 hover:text-gray-200'}">
                <span class="text-xs font-bold">⚡ MT5</span>
            </button>

            <!-- Magic Missing Filter (Linked but No Magic) -->
            <button id="adv-filter-magic-missing" class="flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${state.advancedFilters.magicMissingOnly ? 'bg-yellow-900/60 border-yellow-500 text-yellow-200 shadow-sm shadow-yellow-900/20' : 'bg-gray-700 border-gray-600 text-gray-400 hover:text-gray-200'}">
                <span class="text-xs font-bold">⚠️ Sin Magic</span>
            </button>
            
            <!-- Linked / Portfolio Filter Group -->
            <div class="flex items-center gap-2 bg-gray-900/50 p-1 rounded-lg border border-gray-700/50">
                <select id="adv-filter-portfolio" class="bg-transparent border-none text-xs text-gray-300 focus:ring-0 cursor-pointer py-1">
                    ${portfolioOptions}
                </select>
            </div>
        </div>

        <div class="flex items-center gap-3 border-l border-gray-700 pl-4">
             <!-- Global Date Filter Buttons -->
             <button id="adv-filter-date-all" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-gray-700 border-gray-600 text-gray-400 hover:text-blue-300 hover:border-blue-500 transition-all" title="Aplicar filtro de fecha a TODAS las estrategias">
                 <span class="text-sm">📅</span><span class="text-xs font-bold">Filtrar Todas</span>
             </button>
             <button id="adv-filter-date-reset-all" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-red-900/30 border-red-800/50 text-red-400 hover:text-red-200 hover:border-red-500 transition-all ${(state.strategyDateRanges && Object.keys(state.strategyDateRanges).length > 0) ? '' : 'hidden'}" title="Quitar TODOS los filtros de fecha activos">
                 <span class="text-xs font-bold">✕ Reset Fechas</span>
                 <span class="bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">${state.strategyDateRanges ? Math.floor(Object.keys(state.strategyDateRanges).length / 2) || Object.keys(state.strategyDateRanges).length : 0}</span>
             </button>

             <!-- Quarantine Toggle -->
             <label class="flex items-center gap-2 cursor-pointer group">
                <div class="relative">
                    <input type="checkbox" id="adv-filter-quarantine" class="sr-only" ${quarantineActive ? 'checked' : ''}>
                    <div class="block bg-gray-700 w-8 h-5 rounded-full border border-gray-600 group-hover:border-gray-500 transition-colors"></div>
                    <div class="dot absolute left-1 top-1 bg-gray-400 w-3 h-3 rounded-full transition ${quarantineActive ? 'translate-x-full bg-red-400' : ''}"></div>
                </div>
                <span class="text-xs text-gray-400 group-hover:text-red-300 transition-colors">Ver Cuarentena</span>
            </label>
        </div>
    `;

    // Bind Events
    // 1. Search (Debounced)
    const searchInput = document.getElementById('adv-filter-search');
    searchInput.addEventListener('input', (e) => {
        state.advancedFilters.searchText = e.target.value;
        renderStrategiesTable(); // Re-render triggers filter logic
    });
    searchInput.focus(); // Maintain focus ? No, rerender kills it.
    // FIX: Don't re-render the whole panel on input, just the table? 
    // Actually, calling renderStrategiesTable re-runs the logic. 
    // We should separate panel rendering from table rendering to avoid losing focus.

    // 2. MT5 Toggle
    const mt5Btn = document.getElementById('adv-filter-mt5');
    if (mt5Btn) {
        mt5Btn.addEventListener('click', () => {
            state.advancedFilters.mt5Only = !state.advancedFilters.mt5Only;
            renderAdvancedFilterPanel(); // Update button state
            renderStrategiesTable();
        });
    }

    // 3. Magic Missing Toggle
    const magicMissingBtn = document.getElementById('adv-filter-magic-missing');
    if (magicMissingBtn) {
        magicMissingBtn.addEventListener('click', () => {
            state.advancedFilters.magicMissingOnly = !state.advancedFilters.magicMissingOnly;
            // Mutually exclusive with MT5 Only?? Not necessarily, but logically yes.
            // If MT5 Only is ON, showing "Missing Magic" yields 0 results. 
            // We won't enforce UI exclusion, user will just see empty table if both on.
            renderAdvancedFilterPanel(); // Update button state
            renderStrategiesTable();
        });
    }

    // 3. Portfolio Select
    document.getElementById('adv-filter-portfolio').addEventListener('change', (e) => {
        state.advancedFilters.selectedPortfolioId = e.target.value;
        // If specific portfolio selected, imply 'linkedOnly' logic or specific logic
        renderStrategiesTable();
    });

    // 4. Quarantine Toggle
    document.getElementById('adv-filter-quarantine').addEventListener('change', (e) => {
        state.advancedFilters.showQuarantined = e.target.checked;
        renderAdvancedFilterPanel(); // Update toggle visual
        renderStrategiesTable();
    });

    // 5. Global Date Filter - Apply to All
    const dateAllBtn = document.getElementById('adv-filter-date-all');
    if (dateAllBtn) {
        dateAllBtn.addEventListener('click', () => {
            window.openGlobalDateFilterModal();
        });
    }

    // 6. Global Date Filter - Reset All
    const dateResetAllBtn = document.getElementById('adv-filter-date-reset-all');
    if (dateResetAllBtn) {
        dateResetAllBtn.addEventListener('click', () => {
            window.resetAllStrategyDateFilters();
        });
    }
};

export const initStrategiesTable = () => {
    strategiesTable.init();
    // Initialize Panel
    renderAdvancedFilterPanel();
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
        // Self-Healing: If we have raw data but no analysis results, trigger re-analysis
        if (state.rawStrategiesData && state.rawStrategiesData.length > 0) {
            console.warn('[StrategiesTable] ⚠️ Missing analysisResults but raw data exists. Triggering Self-Healing...');
            const colSpan = config.visibleColumns.length + 1;

            // Show Loading State
            tableBody.innerHTML = `
                <tr>
                    <td colspan="${colSpan}" class="p-8 text-center text-gray-400">
                        <div class="flex flex-col items-center justify-center animate-pulse">
                            <div class="h-8 w-8 mb-4 border-4 border-t-blue-500 border-gray-700 rounded-full animate-spin"></div>
                            <p class="font-medium text-blue-400">Recuperando resultados de análisis...</p>
                            <p class="text-xs text-gray-500 mt-2">Sincronizando métricas globales</p>
                        </div>
                    </td>
                </tr>
            `;

            // Dynamic import to avoid circular dependency (StrategiesTable -> Analysis -> UI -> StrategiesTable)
            import('../analysis.js').then(({ reAnalyzeAllData }) => {
                reAnalyzeAllData();
            }).catch(err => console.error("[StrategiesTable] Self-healing failed:", err));

            return;
        }

        const colSpan = config.visibleColumns.length + 1;
        tableBody.innerHTML = `<tr><td colspan="${colSpan}" class="p-4 text-center text-gray-500">No hay resultados de análisis disponibles.</td></tr>`;
        return;
    }

    let strategies = [];

    // --- MOCK INJECTION FOR VERIFICATION start (Forced Early) ---
    // REMOVED
    // --- MOCK INJECTION FOR VERIFICATION end ---

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

                            // --- REALITY CHECK GLOBAL LOOKUP REMOVED (Redundant/Buggy) ---
                            // ui.js already hydrates the portfolio with global data, and the primary loop
                            // in this function correctly finds those trades. The removed block was:
                            // 1. Running O(N) times (inside map)
                            // 2. Using strict _tradesById check which failed
                            // 3. Trying to write stratObj.realMetrics which gets overwritten anyway

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

                        // Normalize and Calculate using TradeSeries PnL object
                        if (allRealTrades.length > 0) {
                            const rawSeries = new TradeSeries(allRealTrades, state.tradePnlOverrides);
                            let filteredSeries = rawSeries;
                            let dateRangeApplied = false;

                            if (state.strategyDateRanges && state.strategyDateRanges[id]) {
                                const range = state.strategyDateRanges[id];
                                filteredSeries = rawSeries.filterByDateRange(range.start, range.end);
                                dateRangeApplied = true;
                                strategy._dateRange = range;
                            } else if (state.strategyDateRanges && state.strategyDateRanges[strategy.name]) {
                                const range = state.strategyDateRanges[strategy.name];
                                filteredSeries = rawSeries.filterByDateRange(range.start, range.end);
                                dateRangeApplied = true;
                                strategy._dateRange = range;
                            }

                            strategy.realSeries = filteredSeries;

                            // Ensure object compatibility with existing UI columns
                            strategy.realMetrics = {
                                trades: filteredSeries.totalTrades,
                                totalTrades: filteredSeries.totalTrades,
                                totalProfit: filteredSeries.totalProfit,
                                profit: filteredSeries.totalProfit,
                                maxDrawdownInDollars: filteredSeries.maxDrawdown,
                                winningPercentage: filteredSeries.winRate,
                                profitFactor: filteredSeries.profitFactor,
                                returnDD: filteredSeries.returnDD,
                                avgTrade: filteredSeries.totalTrades > 0 ? filteredSeries.totalProfit / filteredSeries.totalTrades : 0,
                                maxConsecutiveLosses: filteredSeries.maxConsecutiveLosses,
                                maxStagnationDays: filteredSeries.maxStagnationDays,
                                maxStagnationTrades: filteredSeries.maxStagnationTrades,
                                upi: filteredSeries.upi,
                                cagr: filteredSeries.cagr,
                                sharpeRatio: filteredSeries.sharpeRatio,
                                sharpeRatioTrade: filteredSeries.sharpeRatioTrade,
                                sortinoRatio: filteredSeries.sortinoRatio,
                                sqn: filteredSeries.sqn,
                                gammaFlowScore: filteredSeries.gammaFlowScore,
                                maxDrawdown: filteredSeries.maxDrawdownPct,

                                _aggregatedTrades: filteredSeries.trades, // For chart backwards compat
                                isAggregated: true,
                                isDateFiltered: dateRangeApplied
                            };
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

    // UNIFIED FILTERING PIPELINE
    // Applies filters in sequence: Quarantine -> Search -> MT5 -> Portfolio -> Linked Status

    // --- ADVANCED FILTERING LOGIC ---
    const { searchText, mt5Only, magicMissingOnly, showQuarantined, selectedPortfolioId } = state.advancedFilters;
    const startCount = strategies.length;

    strategies = strategies.filter(s => {
        // 1. Quarantine Check (Priority)
        const isQuarantined = state.quarantinedStrategyNames.has(s.name);

        // Logic: Match MT5 Filter Logic.
        // - Toggle OFF: Show EVERYTHING (Quarantined + Non-Quarantined mixed).
        // - Toggle ON: Show ONLY Quarantined.
        if (showQuarantined) {
            if (!isQuarantined) return false;
        }
        // If OFF, we show isQuarantined too (mixed).

        // 2. Text Search (Fuzzy)
        if (searchText) {
            const searchLower = searchText.toLowerCase();
            const nameMatch = s.name.toLowerCase().includes(searchLower);
            const idMatch = s.id && s.id.toLowerCase().includes(searchLower);
            if (!nameMatch && !idMatch) return false;
        }

        // 3. MT5 Only
        if (mt5Only) {
            const hasMagic = state.magicNumberMap && (
                state.magicNumberMap[s.name] ||
                state.magicNumberMap[normalizeName(s.name)] ||
                state.magicNumberMap[s.id]
            );
            if (!hasMagic) return false;
        }

        // 3.5 Magic Missing Only (Linked but NO Magic)
        if (magicMissingOnly) {
            const hasMagic = state.magicNumberMap && (
                state.magicNumberMap[s.name] ||
                state.magicNumberMap[normalizeName(s.name)] ||
                state.magicNumberMap[s.id]
            );

            // Debug Log for first few items
            if (strategies.indexOf(s) < 5) {
                console.log(`[FilterDebug] Strat: ${s.name} | HasMagic: ${!!hasMagic} | IsLinkedIdx: ${linkedStrategiesMap.has(s.originalIndex)} | IsLinkedName: ${linkedStrategyNamesMap.has(s.name)}`);
            }

            // Must NOT have magic
            if (hasMagic) return false;

            // Must BE Linked to some portfolio
            // Use our calculated maps (s.originalIndex or s.name OR NORMALIZED NAME)
            const isLinked = linkedStrategiesMap.has(s.originalIndex) ||
                linkedStrategyNamesMap.has(s.name) ||
                linkedStrategyNormalizedNamesMap.has(normalizeName(s.name));

            if (!isLinked) return false;
        }

        // 4. Portfolio Filter (Enhanced Linked)
        if (selectedPortfolioId !== 'all') {
            const pIndex = parseInt(selectedPortfolioId);
            const portfolio = state.savedPortfolios[pIndex];
            if (portfolio) {
                // ROBUST MATCHING
                const norm = normalizeName(s.name);
                const cleanName = s.name.replace(/\.csv$/i, '').trim();

                // PRIORITY 1: Strategy IDs (Most Reliable)
                if (portfolio.strategyIds && portfolio.strategyIds.length > 0) {
                    if (s.id && portfolio.strategyIds.includes(s.id)) return true;
                    // If IDs are present but no match, DO NOT fallback to weak indices.
                    // However, we might check names in case ID is missing on strategy object?
                    // Let's allow Name matching as secondary check if IDs exist but don't match (migration),
                    // but definitely NOT indices.
                }

                // PRIORITY 2: Strategy Names (Reliable if file names unchanged)
                if (portfolio.strategyNames && portfolio.strategyNames.length > 0) {
                    const match = portfolio.strategyNames.some(pn => {
                        const normPn = normalizeName(pn);
                        return normPn === norm || pn.replace(/\.csv$/i, '').trim() === cleanName || pn === s.name;
                    });
                    if (match) return true;

                    // If names loop finishes without match, and we had names, return false (don't use indices).
                    // BUT only if we didn't have IDs. If we had IDs and failed, we should have returned false already?
                    // Let's simplify: If either IDs or Names exist, we use them and IGNORE indices.
                    if ((portfolio.strategyIds && portfolio.strategyIds.length > 0) || (portfolio.strategyNames && portfolio.strategyNames.length > 0)) {
                        return false;
                    }
                }

                // PRIORITY 3: Indices (Legacy/Fallback - Volatile across sessions)
                // Only used if NO IDs and NO Names are stored in portfolio.
                if (portfolio.indices && portfolio.indices.length > 0) {
                    if (portfolio.indices.includes(s.originalIndex)) return true;
                }

                return false;

                return false;
            }
        }

        // 5. Linked Strategies Filter (Legacy/UI Toggle)
        if (state.linkedStrategiesFilter === 'hide') {
            const norm = normalizeName(s.name);
            const isLinked = linkedStrategiesMap.has(s.originalIndex) ||
                linkedStrategyNamesMap.has(s.name) ||
                linkedStrategyNormalizedNamesMap.has(norm);
            if (isLinked) return false;
        } else if (state.linkedStrategiesFilter === 'only' || (selectedPortfolioId === 'all' && state.advancedFilters.linkedOnly)) { // Fallback for header toggle
            const norm = normalizeName(s.name);
            const isLinked = linkedStrategiesMap.has(s.originalIndex) ||
                linkedStrategyNamesMap.has(s.name) ||
                linkedStrategyNormalizedNamesMap.has(norm);
            if (!isLinked) return false;
        }

        return true;
    });

    if (strategies.length < startCount) {
        console.log(`[StrategiesTable] 🔍 Advanced Filter Active. Dropped ${startCount - strategies.length} items.`);
    }

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

    // --- MOCK INJECTION FOR VERIFICATION start ---
    if (!strategies || strategies.length === 0) {
        console.warn('[StrategiesTable] ⚠️ Empty Table: Injecting MOCK STRATEGY for Verification');
        strategies = [{
            id: 'mock_strat_01',
            name: 'MOCKED_STRATEGY_MT5',
            fileName: 'MOCKED_STRATEGY_MT5.csv',
            metrics: { netProfit: 999, totalTrades: 50 },
            analysis: {}
        }];
        // Force Map Match
        if (!state.magicNumberMap) state.magicNumberMap = {};
        state.magicNumberMap['MOCKED_STRATEGY_MT5'] = ['999999'];
        state.magicNumberMap['mock_strat_01'] = ['999999'];
    }
    // --- MOCK INJECTION FOR VERIFICATION end ---

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
            td.className = 'px-4 py-3 text-gray-300 whitespace-nowrap';

            let value = getMetricValue(strategy, colId);

            if (colId === 'name') {
                const isQuarantined = state.quarantinedStrategyNames.has(strategy.name);
                if (isQuarantined) {
                    row.classList.add('bg-red-900/20'); // Subtle red tint for row
                }

                td.className += ' font-medium text-white';
                // td.title = value; // REMOVED: User reported annoying "black container" on hover



                // Helper GLOBAL para copiar nombre
                window.copyStrategyName = (name) => {
                    // 1. Quitar extensión .csv (case insensitive)
                    const cleanName = name.replace(/\.csv$/i, '');

                    // 2. Copiar al portapapeles
                    navigator.clipboard.writeText(cleanName).then(() => {
                        showToast(`Copiado: "${cleanName}"`, 'success');
                    }).catch(err => {
                        console.error('Error al copiar:', err);
                        showToast('Error al copiar al portapapeles', 'error');
                    });
                };

                // Render Name with Potential Link Tag AND Copy Button
                let html = `
                    <div class="flex items-center gap-2 group">
                        <span>${isQuarantined ? '☣️ ' : ''}${value}</span>
                        
                        <!-- COPY BUTTON (Visible on Hover of row/name) -->
                        <button onclick="event.stopPropagation(); window.copyStrategyName('${value}')" 
                                class="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-blue-400 transition-all rounded hover:bg-gray-700/50" 
                                title="Copiar nombre (sin .csv)">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                        </button>
                    </div>
                `;

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

                // Feature: MT5 Indicator (Magic Number Map)
                // Check if strategy has a mapping in state.magicNumberMap
                let hasMagicNumber = false;

                // DIAGNOSTIC LOG (Run ONCE)
                if (index === 0) {
                    console.log('[StrategiesTable DIAG] Checking Magic Number Map:', state.magicNumberMap);
                    if (state.magicNumberMap) {
                        console.log('[StrategiesTable DIAG] Map Keys Sample:', Object.keys(state.magicNumberMap).slice(0, 10));
                    } else {
                        console.warn('[StrategiesTable DIAG] state.magicNumberMap is UNDEFINED or NULL');
                    }
                }

                if (state.magicNumberMap) {
                    // Try all robust keys
                    const keysToCheck = [
                        strategy.id,
                        strategy.name,
                        normalizeName(strategy.name),
                        String(strategy.name).replace(/\.csv$/i, '').trim()
                    ];

                    hasMagicNumber = keysToCheck.some(k => k && state.magicNumberMap[k]);

                    // DIAGNOSTIC LOG for specific strategy (or first few)
                    if (index < 3) {
                        console.log(`[StrategiesTable DIAG] Strat check '${strategy.name}':`, {
                            keys: keysToCheck,
                            found: hasMagicNumber,
                            mapData: keysToCheck.map(k => state.magicNumberMap[k])
                        });
                    }
                }

                if (hasMagicNumber) {
                    // APPEND MT5 BADGE
                    html += `
                        <div class="inline-flex items-center ml-2 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-indigo-900 text-indigo-200 border border-indigo-600 cursor-help" title="Strategy has associated Magic Number (MT5)">
                            ⚡ MT5
                        </div>
                    `;
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

                    // [NEW] Drawdown Analysis Button
                    // Shows the modal with the drawdown chart and stats.
                    html += `
                        <button class="view-dd-analysis-btn ml-1 text-gray-400 hover:text-red-400 transition-colors" title="Análisis de Drawdown" data-index="${targetRef}" data-source="strategies">
                            📉
                        </button>
                    `;

                    // [NEW] Date Range Button
                    // Shows calendar icon. If active, shows highlighted color.
                    const isFiltered = (strategy.realMetrics && strategy.realMetrics.isDateFiltered) ||
                        !!(state.strategyDateRanges && (state.strategyDateRanges[strategy.id] || state.strategyDateRanges[strategy.name]));
                    const dateBtnClass = isFiltered ? 'text-amber-400 hover:text-amber-300' : 'text-gray-500 hover:text-blue-400 transition-all rounded hover:bg-gray-700/50';
                    const dateBtnTitle = isFiltered ? `Rango Activo: ${strategy._dateRange?.start || '*'} - ${strategy._dateRange?.end || '*'}` : 'Filtrar por Fecha';

                    // Use safe name for JS
                    const safeNameJSForDate = strategy.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                    const stratIdJS = strategy.id ? `'${strategy.id}'` : 'null';

                    html += `
                        <button onclick="event.stopPropagation(); window.openStrategyDateConfig('${safeNameJSForDate}', ${stratIdJS})" 
                            class="${dateBtnClass} p-1 ml-1" title="${dateBtnTitle}">
                           📅
                        </button>
                    `;

                    // [NEW] Inline Reset Button - appears only when filter is active
                    if (isFiltered) {
                        html += `
                            <button onclick="event.stopPropagation(); window.resetStrategyDateFilter('${safeNameJSForDate}', ${stratIdJS})" 
                                class="text-red-400 hover:text-red-300 hover:bg-red-900/30 p-0.5 rounded transition-colors" 
                                title="Quitar filtro de fecha (volver a backtest completo)">
                                ✕
                            </button>
                        `;
                    }


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
                    if (isQuarantined) {
                        // Show "Remove/Restore" button
                        html += `
                        <button onclick="event.stopPropagation(); window.removeStrategyFromQuarantine('${safeNameJS}')" 
                            class="ml-2 text-green-500 hover:text-green-400 transition-colors" title="Restaurar (Sacar de Cuarentena)">
                            ♻️
                        </button>
                        `;
                    } else {
                        // Show "Add" button
                        html += `
                        <button onclick="event.stopPropagation(); window.addStrategyToQuarantine('${safeNameJS}')" 
                            class="ml-2 text-red-500 hover:text-red-400 transition-colors" title="Mover a Cuarentena">
                            ☣️
                        </button>
                        `;
                    }
                }

                td.innerHTML = html;
            } else {
                td.className += ' text-right';
                td.textContent = formatMetricForDisplay(value, colId);

                // Color positive/negative (Gray out if quarantined?)
                if (state.quarantinedStrategyNames.has(strategy.name)) {
                    td.className += ' text-gray-500 opacity-60'; // Dimmed
                } else if (typeof value === 'number' && !['totalTrades', 'maxStagnationTrades', 'maxStagnationDays', 'maxConsecutiveLosingMonths'].includes(colId)) {
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

/**
 * [NEW] Helper to recalculate metrics locally using TradeSeries when date filters change
 */
const applyDateFilterToStrategy = (sName, range, strategyObj) => {
    console.log(`[DateFilter] 🔧 applyDateFilterToStrategy called. sName="${sName}", range=`, range, ', strategyObj?', !!strategyObj);

    const analysisResult = window.analysisResults?.find(r => r.name === sName && !r.isPortfolio);
    if (!analysisResult) {
        console.warn(`[DateFilter] ❌ analysisResult NOT FOUND for "${sName}". window.analysisResults length:`, window.analysisResults?.length);
        if (window.analysisResults?.length > 0) {
            console.log('[DateFilter] First 3 names:', window.analysisResults.slice(0, 3).map(r => r.name));
        }
        return;
    }
    console.log(`[DateFilter] ✅ analysisResult found. Has analysis?`, !!analysisResult.analysis, ', Has analysis.metrics?', !!(analysisResult.analysis?.metrics));

    let tradesForEngine = null;
    if (analysisResult.realMetrics?.trades) tradesForEngine = analysisResult.realMetrics.trades;
    else if (analysisResult.trades) tradesForEngine = analysisResult.trades;
    else if (strategyObj?.analysis?.trades) tradesForEngine = strategyObj.analysis.trades;

    // [FIX] Critical fallback: trades are stored in state.rawStrategiesData as parsed CSV rows
    // This is where SQ Analysis loads them from (via parseTradesFromContent/parseTradesFromData)
    if (!tradesForEngine || tradesForEngine.length === 0) {
        const stratIdx = state.loadedStrategyFiles?.findIndex(f => f.name === sName);
        if (stratIdx !== -1 && stratIdx !== undefined) {
            const rawData = state.rawStrategiesData?.[stratIdx];
            if (rawData && rawData.length > 0) {
                tradesForEngine = rawData;
                console.log(`[DateFilter] ✅ Found ${rawData.length} trades from state.rawStrategiesData[${stratIdx}]`);
            }
        }
    }

    console.log(`[DateFilter] Trades source: ${tradesForEngine ? tradesForEngine.length + ' trades' : 'NO TRADES FOUND'}`);

    if (tradesForEngine && tradesForEngine.length > 0) {
        const rawSeries = new TradeSeries(tradesForEngine, state.tradePnlOverrides);
        const filteredSeries = range && (range.start || range.end)
            ? rawSeries.filterByDateRange(range.start, range.end)
            : rawSeries;

        console.log(`[DateFilter] Raw trades: ${rawSeries.totalTrades}, Filtered trades: ${filteredSeries.totalTrades}, Filtered profit: ${filteredSeries.totalProfit?.toFixed(2)}`);

        const newMetrics = {
            netProfit: filteredSeries.totalProfit,
            totalProfit: filteredSeries.totalProfit,
            NetProfit: filteredSeries.totalProfit,
            maxDrawdownInDollars: filteredSeries.maxDrawdown,
            maxDD: filteredSeries.maxDrawdown,
            MaxDD: filteredSeries.maxDrawdown,
            drawdown: filteredSeries.maxDrawdown,
            totalTrades: filteredSeries.totalTrades,
            TotalTrades: filteredSeries.totalTrades,
            winningPercentage: filteredSeries.winRate,
            winRate: filteredSeries.winRate,
            profitFactor: filteredSeries.profitFactor,
            returnDD: filteredSeries.returnDD,
            avgTrade: filteredSeries.totalTrades > 0 ? filteredSeries.totalProfit / filteredSeries.totalTrades : 0,
            maxConsecutiveLosses: filteredSeries.maxConsecutiveLosses,
            maxStagnationDays: filteredSeries.maxStagnationDays,
            maxStagnationTrades: filteredSeries.maxStagnationTrades,
            upi: filteredSeries.upi,
            cagr: filteredSeries.cagr,
            sharpeRatio: filteredSeries.sharpeRatio,
            sharpeRatioTrade: filteredSeries.sharpeRatioTrade,
            sortinoRatio: filteredSeries.sortinoRatio,
            sqn: filteredSeries.sqn,
            gammaFlowScore: filteredSeries.gammaFlowScore,
            maxDrawdown: filteredSeries.maxDrawdownPct,
            avgTrade: filteredSeries.avgTrade,
            isDateFiltered: range && (range.start || range.end) ? true : false
        };

        analysisResult.metrics = { ...analysisResult.metrics, ...newMetrics };
        console.log(`[DateFilter] ✅ Updated analysisResult.metrics. isDateFiltered=${newMetrics.isDateFiltered}`);

        // [FIX] Also update analysis.metrics - this is what getMetricValue reads FIRST
        if (analysisResult.analysis && analysisResult.analysis.metrics) {
            Object.assign(analysisResult.analysis.metrics, newMetrics);
            console.log(`[DateFilter] ✅ Updated analysisResult.analysis.metrics`);
        } else {
            console.warn(`[DateFilter] ⚠️ analysisResult.analysis.metrics does NOT exist! Creating it.`);
            if (!analysisResult.analysis) analysisResult.analysis = {};
            analysisResult.analysis.metrics = { ...newMetrics };
        }

        if (strategyObj) {
            if (strategyObj.analysis) {
                strategyObj.analysis.metrics = { ...strategyObj.analysis.metrics, ...newMetrics };
            }
            if (strategyObj.metrics) {
                Object.assign(strategyObj.metrics, newMetrics);
            }
            // [FIX] Update the pnlSeries so Focus Mode charts/metrics use the filtered data
            strategyObj.pnlSeries = filteredSeries;
            console.log(`[DateFilter] ✅ Updated strategyObj metrics`);
        }
        console.log(`[DateFilter] 🏁 Date filter applied successfully for "${sName}"`);
    } else {
        console.warn(`[DateFilter] ❌ No trades found for engine. Cannot apply filter.`);
    }
};

/**
 * [NEW] Open Strategy Date Configuration Modal
 */
window.openStrategyDateConfig = (strategyName, strategyId) => {
    // 1. Check existing global state or init
    if (!state.strategyDateRanges) state.strategyDateRanges = {};

    // Key resolution
    const key = strategyId || strategyName;
    const currentRange = state.strategyDateRanges[key] || { start: '', end: '' };

    // 2. Create Modal using simple prompt or SweetAlert if available. 
    // Using custom modal DOM for consistency with existing UI style.
    const modalId = 'strat-date-modal';
    let modal = document.getElementById(modalId);
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[70] animate-fade-in';
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-xl border border-gray-700 w-96 p-6 shadow-2xl transform scale-100 transition-transform">
            <h3 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <span>📅</span> Rango de Fechas
            </h3>
            <p class="text-xs text-gray-400 mb-4 truncate" title="${strategyName}">${strategyName}</p>
            
            <div class="space-y-3">
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Inicio</label>
                    <input type="date" id="sd-start" value="${currentRange.start || ''}" class="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm focus:border-blue-500">
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Fin</label>
                    <input type="date" id="sd-end" value="${currentRange.end || ''}" class="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm focus:border-blue-500">
                </div>
            </div>

            <div class="flex gap-2 mt-6">
                 <button id="sd-clear" class="px-3 py-2 text-xs font-bold text-red-400 hover:text-white border border-red-900/50 hover:bg-red-900/50 rounded transition-colors mr-auto">
                    Limpiar Filtro
                </button>
                <button id="sd-cancel" class="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancelar</button>
                <button id="sd-save" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-bold shadow-lg shadow-blue-900/30">
                    Aplicar
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Handlers
    const close = () => modal.remove();
    document.getElementById('sd-cancel').onclick = close;

    document.getElementById('sd-clear').onclick = () => {
        delete state.strategyDateRanges[key];
        // Also try name if ID used
        if (strategyId) delete state.strategyDateRanges[strategyName];

        // Ensure metrics are restored locally
        const strategyObj = state.loadedStrategyFiles?.find(s => s.name === strategyName);
        applyDateFilterToStrategy(strategyName, null, strategyObj);

        close();
        renderStrategiesTable(); // Re-render triggers calculation loop

        // Trigger global update (Portfolios etc)
        document.dispatchEvent(new CustomEvent('strategy-date-updated', { detail: { name: strategyName, id: strategyId } })); // [MOD] Enabled Dispatch
    };

    document.getElementById('sd-save').onclick = () => {
        const start = document.getElementById('sd-start').value;
        const end = document.getElementById('sd-end').value;

        if (!start && !end) {
            // Treat as clear
            document.getElementById('sd-clear').click();
            return;
        }

        state.strategyDateRanges[key] = { start, end };
        // Fallback: If ID is used, also set Name key to ensure UI consistently finds it
        if (strategyId && strategyName) state.strategyDateRanges[strategyName] = { start, end };

        // Apply filtering locally
        const strategyObj = state.loadedStrategyFiles?.find(s => s.name === strategyName);
        applyDateFilterToStrategy(strategyName, { start, end }, strategyObj);

        close();
        renderStrategiesTable();

        // Trigger global update
        document.dispatchEvent(new CustomEvent('strategy-date-updated', { detail: { name: strategyName, id: strategyId } })); // [MOD] Enabled Dispatch
    };
};

/**
 * [NEW] One-click reset of strategy date filter (from inline ✕ button)
 */
window.resetStrategyDateFilter = (strategyName, strategyId) => {
    if (!state.strategyDateRanges) return;

    const key = strategyId || strategyName;
    delete state.strategyDateRanges[key];
    if (strategyId) delete state.strategyDateRanges[strategyName];

    const strategyObj = state.loadedStrategyFiles?.find(s => s.name === strategyName);
    applyDateFilterToStrategy(strategyName, null, strategyObj);
    renderStrategiesTable();

    document.dispatchEvent(new CustomEvent('strategy-date-updated', { detail: { name: strategyName, id: strategyId } }));
    console.log(`[DateFilter] ✅ Filter reset for "${strategyName}" (one-click)`);
};

/**
 * [NEW] Reset ALL strategy date filters at once
 */
window.resetAllStrategyDateFilters = () => {
    if (!state.strategyDateRanges || Object.keys(state.strategyDateRanges).length === 0) return;

    const keys = Object.keys(state.strategyDateRanges);
    console.log(`[DateFilter] 🗑️ Resetting ALL date filters (${keys.length} entries)`);

    // Reset each strategy's metrics to full backtest
    const processedNames = new Set();
    keys.forEach(key => {
        // Find strategy by key (could be id or name)
        const strategyObj = state.loadedStrategyFiles?.find(s => s.name === key || s.strategyId === key);
        const stratName = strategyObj?.name || key;
        if (!processedNames.has(stratName)) {
            processedNames.add(stratName);
            applyDateFilterToStrategy(stratName, null, strategyObj);
        }
    });

    // Clear all ranges
    state.strategyDateRanges = {};

    renderAdvancedFilterPanel();
    renderStrategiesTable();

    document.dispatchEvent(new CustomEvent('strategy-date-updated', { detail: { name: '__ALL__', id: null } }));
    console.log(`[DateFilter] ✅ All date filters cleared`);
};

/**
 * [NEW] Open modal to apply the same date range to ALL strategies
 */
window.openGlobalDateFilterModal = () => {
    if (!state.strategyDateRanges) state.strategyDateRanges = {};

    const modalId = 'strat-date-global-modal';
    let modal = document.getElementById(modalId);
    if (modal) modal.remove();

    // Pre-fill with existing global range if any strategy has one
    const existingKeys = Object.keys(state.strategyDateRanges);
    let prefillStart = '';
    let prefillEnd = '';
    if (existingKeys.length > 0) {
        const first = state.strategyDateRanges[existingKeys[0]];
        if (first) { prefillStart = first.start || ''; prefillEnd = first.end || ''; }
    }

    const stratCount = state.loadedStrategyFiles?.length || 0;

    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[70] animate-fade-in';
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-xl border border-gray-700 w-96 p-6 shadow-2xl">
            <h3 class="text-lg font-bold text-white mb-2 flex items-center gap-2">
                <span>📅</span> Filtrar TODAS las Estrategias
            </h3>
            <p class="text-xs text-gray-400 mb-4">Se aplicará el mismo rango a las <strong class="text-blue-400">${stratCount}</strong> estrategias cargadas.</p>
            
            <div class="space-y-3">
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Inicio</label>
                    <input type="date" id="gd-start" value="${prefillStart}" class="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm focus:border-blue-500">
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Fin</label>
                    <input type="date" id="gd-end" value="${prefillEnd}" class="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm focus:border-blue-500">
                </div>
            </div>

            <div class="flex gap-2 mt-6">
                <button id="gd-cancel" class="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancelar</button>
                <button id="gd-apply" class="ml-auto px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-bold shadow-lg shadow-blue-900/30">
                    Aplicar a Todas
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    document.getElementById('gd-cancel').onclick = close;

    document.getElementById('gd-apply').onclick = () => {
        const start = document.getElementById('gd-start').value;
        const end = document.getElementById('gd-end').value;

        if (!start && !end) { close(); return; }

        const range = { start, end };
        let applied = 0;

        (state.loadedStrategyFiles || []).forEach(file => {
            if (!file) return;
            const name = file.name;
            const id = file.strategyId;
            const key = id || name;

            state.strategyDateRanges[key] = range;
            if (id && name) state.strategyDateRanges[name] = range;

            applyDateFilterToStrategy(name, range, file);
            applied++;
        });

        close();
        renderAdvancedFilterPanel();
        renderStrategiesTable();

        document.dispatchEvent(new CustomEvent('strategy-date-updated', { detail: { name: '__ALL__', id: null } }));
        console.log(`[DateFilter] ✅ Global filter applied to ${applied} strategies: ${start} → ${end}`);
    };
};

/**
 * [EXISTING] Open Bulk Strategy Date Configuration Modal
 */
window.openBulkStrategyDateConfig = (selectedIndices) => {
    if (!selectedIndices || selectedIndices.length === 0) return;

    // 1. Check existing global state or init
    if (!state.strategyDateRanges) state.strategyDateRanges = {};

    // 2. Create Modal
    const modalId = 'strat-date-bulk-modal';
    let modal = document.getElementById(modalId);
    if (modal) modal.remove();

    const count = selectedIndices.length;

    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[70] animate-fade-in';
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-xl border border-gray-700 w-96 p-6 shadow-2xl transform scale-100 transition-transform">
            <h3 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <span>📅</span> Rango de Fechas (Bulk)
            </h3>
            <p class="text-xs text-amber-400 mb-4 font-bold">Aplicando a ${count} estrategias seleccionadas</p>
            
            <div class="space-y-3">
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Inicio</label>
                    <input type="date" id="sd-bulk-start" class="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm focus:border-blue-500">
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Fin</label>
                    <input type="date" id="sd-bulk-end" class="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm focus:border-blue-500">
                </div>
            </div>

            <div class="flex gap-2 mt-6">
                 <button id="sd-bulk-clear" class="px-3 py-2 text-xs font-bold text-red-400 hover:text-white border border-red-900/50 hover:bg-red-900/50 rounded transition-colors mr-auto">
                    Limpiar Todos
                </button>
                <button id="sd-bulk-cancel" class="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancelar</button>
                <button id="sd-bulk-save" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-bold shadow-lg shadow-blue-900/30">
                    Aplicar a Todos
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Handlers
    const close = () => modal.remove();
    document.getElementById('sd-bulk-cancel').onclick = close;

    const processBulkUpdate = (range) => {
        console.log(`[BulkUpdate] Processing ${count} strategies with range:`, range);

        selectedIndices.forEach(idx => {
            const strategy = state.loadedStrategyFiles[idx];
            if (!strategy) return;

            const sName = strategy.name;
            const sId = strategy.id || sName; // Fallback to name if ID missing

            // 1. Update Date Range State
            if (range) {
                state.strategyDateRanges[sName] = range;
                if (strategy.id) state.strategyDateRanges[strategy.id] = range;
            } else {
                delete state.strategyDateRanges[sName];
                if (strategy.id) delete state.strategyDateRanges[strategy.id];
            }

            // 2. Perform Recalculation using TradeSeries (Frontend local calculation)
            applyDateFilterToStrategy(sName, range, strategy);
        });

        close();
        renderStrategiesTable();
        showToast(`Actualizadas ${count} estrategias con nuevo filtro`, 'success');

        // Notify
        window.dispatchEvent(new CustomEvent('strategies-bulk-updated'));
    };

    document.getElementById('sd-bulk-clear').onclick = () => {
        if (confirm('¿Eliminar filtro de fecha para las estrategias seleccionadas?')) {
            processBulkUpdate(null);
        }
    };

    document.getElementById('sd-bulk-save').onclick = () => {
        const start = document.getElementById('sd-bulk-start').value;
        const end = document.getElementById('sd-bulk-end').value;

        if (!start && !end) {
            processBulkUpdate(null);
            return;
        }

        processBulkUpdate({ start, end });
    };
};

// Helper: Get metric value from strategy object
const getMetricValue = (strategy, metricKey) => {
    // 1. Determine where metrics are stored
    let source = strategy;

    // [FIX] If a date filter has been applied, prefer the top-level strategy.metrics
    // because applyDateFilterToStrategy writes filtered values there, NOT to analysis.metrics
    if (strategy.metrics && strategy.metrics.isDateFiltered) {
        source = strategy.metrics;
    } else if (strategy.analysis && strategy.analysis.metrics) {
        source = strategy.analysis.metrics;
    } else if (strategy.analysis) {
        source = strategy.analysis;
    } else if (strategy.metrics) {
        source = strategy.metrics;
    }

    // 2. Extract value with mappings
    let val = source[metricKey];

    if (metricKey === 'returnDD') val = source['profitMaxDD_Ratio'] ?? source['returnDD'];
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
        <button id="fab-apply-filter" class="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-full font-bold transition-all flex items-center gap-2" title="Apply Date Filter / Scaling to Selected">
            <span>📅</span>
            <span>Apply Filter</span>
        </button>
        <button id="fab-deselect-all-btn" class="bg-gray-500 hover:bg-gray-600 px-3 py-2 rounded-full font-bold transition-all">
            Clear
        </button>
    `;

    document.getElementById('fab-find-team-btn').addEventListener('click', () => {
        const selectedIndices = Array.from(selectedStrategies);
        openSearchConfigModal(selectedIndices, { isStrategyIndices: true });
    });

    document.getElementById('fab-apply-filter').addEventListener('click', () => {
        const selectedIndices = Array.from(selectedStrategies);
        openBulkStrategyDateConfig(selectedIndices);
    });

    document.getElementById('fab-test-selection').addEventListener('click', () => {
        const selectedIndices = Array.from(selectedStrategies);

        // ========== DIAGNOSTIC LOGS ==========
        console.log('%c[DIAG-FAB] ═══════════════════════════════════════', 'color: #00ff00; font-weight: bold');
        console.log('%c[DIAG-FAB] TEST SELECTION CLICKED', 'color: #00ff00; font-weight: bold');
        console.log('%c[DIAG-FAB] ═══════════════════════════════════════', 'color: #00ff00; font-weight: bold');
        console.log('[DIAG-FAB] activeViewMode:', state.activeViewMode);
        console.log('[DIAG-FAB] selectedStrategies Set:', [...selectedStrategies]);
        console.log('[DIAG-FAB] state.loadedStrategyFiles.length:', state.loadedStrategyFiles?.length);
        console.log('[DIAG-FAB] window.currentTableStrategies.length:', window.currentTableStrategies?.length);

        console.log('[DIAG-FAB] --- Index Resolution Check ---');
        selectedIndices.forEach((idx, i) => {
            const loadedFile = state.loadedStrategyFiles[idx];
            const rawData = state.rawStrategiesData?.[idx];
            const tableStrategy = window.currentTableStrategies?.[idx];

            console.log(`[DIAG-FAB] Selected[${i}] idx=${idx}:`);
            console.log(`   loadedFile: ${loadedFile?.name || '❌ UNDEFINED (INDEX OUT OF BOUNDS)'}, strategyId: ${loadedFile?.strategyId || 'N/A'}`);
            console.log(`   rawData: ${rawData ? '✅ EXISTS' : '❌ MISSING'}`);
            console.log(`   tableStrategy[${idx}]: ${tableStrategy?.name || '❌ UNDEFINED'}`);

            // Check if indices match expectations
            if (!loadedFile) {
                console.warn(`[DIAG-FAB] ⚠️ WARNING: Index ${idx} has NO loaded file! This will cause portfolio creation to fail.`);
            }
        });
        console.log('[DIAG-FAB] --- End Index Check ---');
        // ========== END DIAGNOSTIC LOGS ==========

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

    // ========== DIAGNOSTIC LOGS ==========
    console.log('%c[DIAG-DELETE] ═══════════════════════════════════════', 'color: #ff0000; font-weight: bold');
    console.log('%c[DIAG-DELETE] deleteSelectedStrategies CALLED', 'color: #ff0000; font-weight: bold');
    console.log('[DIAG-DELETE] indicesToDelete:', indicesToDelete);
    console.log('[DIAG-DELETE] state.loadedStrategyFiles.length BEFORE:', state.loadedStrategyFiles?.length);
    console.log('[DIAG-DELETE] state.rawStrategiesData.length BEFORE:', state.rawStrategiesData?.length);
    // ========== END DIAGNOSTIC LOGS ==========

    if (indicesToDelete.length === 0) {
        console.log('[DIAG-DELETE] No indices to delete, returning.');
        return;
    }

    if (!confirm(`Are you sure you want to PERMANENTLY delete ${indicesToDelete.length} strategies? This cannot be undone.`)) {
        console.log('[DIAG-DELETE] User cancelled deletion.');
        return;
    }

    console.log('[DIAG-DELETE] User confirmed. Deleting...');

    // CRITICAL FIX: Collect NAMES of strategies to delete BEFORE modifying arrays
    // This ensures we can identify them in window.analysisResults regardless of index changes
    const namesToDelete = new Set();
    indicesToDelete.forEach(originalIndex => {
        const file = state.loadedStrategyFiles[originalIndex];
        if (file) {
            namesToDelete.add(file.name);
            console.log(`[DIAG-DELETE] Will delete: "${file.name}" (index ${originalIndex})`);
        }
    });

    // 1. Remove from State arrays (using indices, sorted descending so splice works correctly)
    indicesToDelete.forEach(originalIndex => {
        if (state.loadedStrategyFiles[originalIndex]) {
            state.loadedStrategyFiles.splice(originalIndex, 1);
        }
        if (state.rawStrategiesData[originalIndex]) {
            state.rawStrategiesData.splice(originalIndex, 1);
        }
    });

    console.log('[DIAG-DELETE] state.loadedStrategyFiles.length AFTER:', state.loadedStrategyFiles?.length);
    console.log('[DIAG-DELETE] state.rawStrategiesData.length AFTER:', state.rawStrategiesData?.length);

    // 2. Remove from Analysis Results using NAMES (more reliable than indices)
    if (window.analysisResults) {
        const beforeCount = window.analysisResults.length;
        window.analysisResults = window.analysisResults.filter(r => {
            // Keep if it's a portfolio/special item
            if (r.isSavedPortfolio || r.isDatabankPortfolio || r.isCurrentPortfolio || r.is_saved_portfolio || r.is_databank_portfolio) {
                return true;
            }
            // Delete if name matches
            if (r.name && namesToDelete.has(r.name)) {
                console.log(`[DIAG-DELETE] Removing from analysisResults: "${r.name}"`);
                return false;
            }
            return true;
        });
        console.log(`[DIAG-DELETE] window.analysisResults: ${beforeCount} -> ${window.analysisResults.length}`);

        // 3. Re-index remaining strategies to match new loadedStrategyFiles positions
        window.analysisResults.forEach(r => {
            if (r.name && !r.isSavedPortfolio && !r.isDatabankPortfolio && !r.isCurrentPortfolio) {
                // Find new index by name
                const newIndex = state.loadedStrategyFiles.findIndex(f => f.name === r.name);
                if (newIndex !== -1) {
                    r.originalIndex = newIndex;
                }
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
