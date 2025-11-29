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
    isSearchStopped: false,

    // --- NUEVO: Cuentas vinculadas de Myfxbook ---
    linkedAccounts: [], // { myfxbookId, accountId, name, broker, portfolioId, lastSyncDate, metrics: {...} }
    myfxbookCredentials: null, // { email, password } - Session only, not persisted to localStorage for security (or optional)


    // Configuraciones de ordenamiento
    databankSortConfig: { key: 'metricValue', order: 'desc' },
    savedPortfoliosSortConfig: { key: 'savedIndex', order: 'asc' },
    summarySortConfig: { key: 'name', order: 'asc' }, // <-- ESTA LÍNEA ESTABA AUSENTE

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
};

// Funciones de persistencia para Magic Numbers
export const loadMagicNumbers = () => {
    try {
        const stored = localStorage.getItem('magicNumberMap');
        if (stored) {
            state.magicNumberMap = JSON.parse(stored);
            console.log('[State] Magic Numbers loaded:', Object.keys(state.magicNumberMap).length);
        }
    } catch (e) {
        console.error('[State] Error loading Magic Numbers:', e);
    }
};

export const saveMagicNumbers = () => {
    try {
        localStorage.setItem('magicNumberMap', JSON.stringify(state.magicNumberMap));
        console.log('[State] Magic Numbers saved.');
    } catch (e) {
        console.error('[State] Error saving Magic Numbers:', e);
    }
};

export const loadSavedPortfolios = () => {
    // Disabled by user request for clean slate on reload
    /*
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
    */
    console.log('[State] Saved Portfolios auto-load disabled.');
};

export const saveSavedPortfolios = () => {
    try {
        localStorage.setItem('savedPortfolios', JSON.stringify(state.savedPortfolios));
        console.log('[State] Saved Portfolios saved.');
    } catch (e) {
        console.error('[State] Error saving Saved Portfolios:', e);
    }
};