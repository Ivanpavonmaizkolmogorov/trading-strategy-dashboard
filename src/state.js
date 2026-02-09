// Este archivo gestiona el estado global de la aplicación.
// Usar un único objeto 'state' exportado asegura que todos los módulos compartan y modifiquen la misma fuente de verdad.

export const state = {
    chartInstances: {},
    loadedStrategyFiles: [],
    rawStrategiesData: [],
    selectedPortfolioIndices: new Set(),
    savedPortfolios: [],
    featuredPortfolioIndex: null,
    currentOptimizationData: {},
    portfolioActionTargetIndex: null,
    comparisonPortfolioIndex: null,
    databankPortfolios: [],
    nextPortfolioId: 0,
    selectedRows: { databank: [], saved: [] },
    isSearchPaused: false,
    isSearchPaused: false,
    isSearchStopped: false,
    searchBasePortfolioIndex: null, // Index of the Saved Portfolio used as base
    searchBaseStrategyIndices: new Set(), // Indices of strategies from the base portfolio to lock

    // --- NUEVO: Global Ban Tracking ---
    bannedStrategiesCount: 0,
    quarantinedStrategyNames: new Set(), // Set of strategy names permanently excluded
    linkedStrategiesFilter: 'all', // 'all', 'hide', 'only'

    // Advanced Filters (Persistence)
    advancedFilters: {
        searchText: '',
        mt5Only: false,
        magicMissingOnly: false, // New filter: Linked but No Magic
        selectedPortfolioId: 'all',
        showQuarantined: false
    },

    // --- NUEVO: Configuración de Riesgo ---
    stagnationMode: 'days', // 'days', 'trades'

    // --- NUEVO: Tab Activo ---
    activeTab: 'strategies', // 'strategies', 'saved-portfolios', 'databank'

    // --- NUEVO: Cuentas vinculadas de Myfxbook ---
    linkedAccounts: [], // { myfxbookId, accountId, name, broker, portfolioId, lastSyncDate, metrics: {...} }
    myfxbookCredentials: null, // { email, password } - Session only, not persisted to localStorage for security (or optional)

    // --- NUEVO: Deep Scan Data (Multi-Account) ---
    // Estructura: { [accountId]: { accountInfo, processedStats, tradesById } }
    // Cada deep scan de un account SOBRESCRIBE los datos de ese account
    // Pero deep scans de accounts DIFERENTES conviven
    deepScanData: {},


    // Configuraciones de ordenamiento
    databankSortConfig: { key: 'metricValue', order: 'desc' },
    savedPortfoliosSortConfig: { key: 'savedIndex', order: 'asc' },
    summarySortConfig: { key: 'name', order: 'asc' }, // <-- ESTA LÍNEA ESTABA AUSENTE

    // UI State
    databankPanelExpanded: true, // Default to expanded

    // --- NUEVO: Vista por defecto centralizada ---
    // Esta es la lista de KPIs que has definido como la vista estándar.
    defaultMetricColumns: [
        'profitMaxDD_Ratio',            // Ret/DD
        'upi',                          // UPI
        'sortinoRatio',                 // Sortino
        'sharpeRatio',                  // Sharpe
        'maxDrawdownInDollars',         // Max DD ($)
        'maxConsecutiveLosingMonths',   // Meses Pérdida Cons.
        'maxStagnationTrades',          // Stagnation (Trades)
        'maxStagnationDays',            // Stagnation (Días)
        'winningPercentage',            // Win %
        'ulcerIndexInDollars',          // Ulcer Index $ <-- AÑADIDO
        'sqn',                          // SQN
        'profitFactor',                 // Profit Factor
    ],

    // Vistas de tablas
    tableViews: {
        databank: {
            'default': { name: 'Vista por Defecto', columns: ['name', 'metricValue', ...['profitMaxDD_Ratio', 'upi', 'sortinoRatio', 'sharpeRatio', 'maxDrawdownInDollars', 'maxConsecutiveLosingMonths', 'maxStagnationTrades', 'maxStagnationDays', 'winningPercentage', 'ulcerIndexInDollars', 'sqn', 'profitFactor']] },
            'risk': { name: 'Vista de Riesgo', columns: ['name', 'maxDrawdown', 'maxDrawdownInDollars', 'maxConsecutiveLosingMonths', 'sortinoRatio', 'upi'] },
            'profit': { name: 'Vista de Beneficio', columns: ['name', 'profitFactor', 'monthlyAvgProfit', 'profitMaxDD_Ratio', 'monthlyProfitToDollarDD'] }
        },
        saved: {
            'default': { name: 'Vista por Defecto', columns: ['name', ...['profitMaxDD_Ratio', 'upi', 'sortinoRatio', 'sharpeRatio', 'maxDrawdownInDollars', 'maxConsecutiveLosingMonths', 'maxStagnationTrades', 'maxStagnationDays', 'winningPercentage', 'ulcerIndexInDollars', 'sqn', 'profitFactor']] },
            'risk': { name: 'Vista de Riesgo', columns: ['name', 'maxDrawdown', 'maxDrawdownInDollars', 'maxConsecutiveLosingMonths', 'sortinoRatio', 'upi'] },
            'profit': { name: 'Vista de Beneficio', columns: ['name', 'profitFactor', 'monthlyAvgProfit', 'profitMaxDD_Ratio', 'monthlyProfitToDollarDD'] }
        }
    },
    activeViews: { databank: 'default', saved: 'default' },
    currentEditingViewSet: 'databank', // 'databank' or 'saved'

    // --- NUEVO: Mapeo de Magic Numbers ---
    magicNumberMap: {}, // { strategyId (or filename): magicNumber }

    // --- NUEVO: Modo de Vista (Backtest vs Reality Check) ---
    activeViewMode: 'backtest', // 'backtest' | 'reality-check'

    // --- NUEVO: Trade PnL Overrides (manual edits) ---
    // Estructura: { "strategyId::timestamp": { realPnL: number|null, btPnL: number|null, neutralized: boolean, originalReal: number, originalBT: number } }
    tradePnlOverrides: {},
};

// Funciones de persistencia para Magic Numbers
export const loadMagicNumbers = () => {
    // DISABLED: Auto-loading from localStorage is disabled per user request ("NO CACHE").
    // Every session starts fresh. Use Import/Export to persist data manually if needed.
    console.log('[State] Magic Numbers Auto-Load: DISABLED (Fresh Session).');

    // Explicitly ensure it's empty in state just in case
    state.magicNumberMap = {};
};

export const saveMagicNumbers = () => {
    try {
        localStorage.setItem('magicNumberMap', JSON.stringify(state.magicNumberMap));
        console.log('[State] Magic Numbers saved.');
    } catch (e) {
        console.error('[State] Error saving Magic Numbers:', e);
    }
};

// Funciones de persistencia para Cuarentena (Global Ban)
// NOTA: La persistencia en localStorage se ha ELIMINADO intencionalmente.
// La lista de cuarentena ahora solo vive en el estado de la sesión y se guarda/carga vía JSON (Exportar/Importar Estado).
export const loadQuarantineList = () => {
    // No-op: Se carga vía importState()
    console.log('[State] Quarantine List init: Relying on session/imported state only.');
};

export const saveQuarantineList = () => {
    // No-op: Se guarda vía exportState()
    // Solo logueamos para confirmar cambios en memoria
    console.log(`[State] Quarantine List updated (Memory): ${state.quarantinedStrategyNames.size} strategies.`);
};

export const loadSavedPortfolios = () => {
    // Disabled by user request for clean slate on reload
    try {
        const stored = localStorage.getItem('savedPortfolios');
        if (stored) {
            state.savedPortfolios = JSON.parse(stored);
            console.log('[State] Saved Portfolios loaded:', state.savedPortfolios.length);
            // Ensure nextPortfolioId is updated
            if (state.savedPortfolios.length > 0) {
                const maxId = Math.max(...state.savedPortfolios.map(p => p.id || 0));
                state.nextPortfolioId = maxId + 1;
            }
        }
    } catch (e) {
        console.error('[State] Error loading Saved Portfolios:', e);
    }
    // console.log('[State] Saved Portfolios auto-load disabled.');
};

export const saveSavedPortfolios = () => {
    try {
        const minimizedPortfolios = state.savedPortfolios.map(p => ({
            id: p.id,
            name: p.name,
            indices: p.indices, // Or strategyIds if available
            weights: p.weights,
            comments: p.comments,
            linkedAccountId: p.linkedAccountId,
            linkedAccountName: p.linkedAccountName,
            // Exclude 'analysis', 'metrics', 'realMetrics' (heavy data)
            // We expect the app to re-calculate or re-fetch analysis on load if needed,
            // or at least not crash storage.
        }));
        localStorage.setItem('savedPortfolios', JSON.stringify(minimizedPortfolios));
        console.log('[State] Saved Portfolios saved (Minified).');
    } catch (e) {
        console.error('[State] Error saving Saved Portfolios:', e);
    }
};