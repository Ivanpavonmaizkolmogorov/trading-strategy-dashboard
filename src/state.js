// Este archivo gestiona el estado global de la aplicación.
// Usar un único objeto 'state' exportado asegura que todos los módulos compartan y modifiquen la misma fuente de verdad.

export const state = {
    chartInstances: {},
    loadedStrategyFiles: [],
    rawBenchmarkData: null,
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
            'default': { name: 'Vista por Defecto', columns: ['name', 'metricValue', ...[ 'profitMaxDD_Ratio', 'upi', 'sortinoRatio', 'sharpeRatio', 'maxDrawdownInDollars', 'maxConsecutiveLosingMonths', 'maxStagnationTrades', 'maxStagnationDays', 'winningPercentage', 'ulcerIndexInDollars', 'sqn', 'profitFactor' ]] },
            'risk': { name: 'Vista de Riesgo', columns: ['name', 'maxDrawdown', 'maxDrawdownInDollars', 'maxConsecutiveLosingMonths', 'sortinoRatio', 'upi'] },
            'profit': { name: 'Vista de Beneficio', columns: ['name', 'profitFactor', 'monthlyAvgProfit', 'profitMaxDD_Ratio', 'monthlyProfitToDollarDD'] }
        },
        saved: {
            'default': { name: 'Vista por Defecto', columns: ['name', ...[ 'profitMaxDD_Ratio', 'upi', 'sortinoRatio', 'sharpeRatio', 'maxDrawdownInDollars', 'maxConsecutiveLosingMonths', 'maxStagnationTrades', 'maxStagnationDays', 'winningPercentage', 'ulcerIndexInDollars', 'sqn', 'profitFactor' ]] },
            'risk': { name: 'Vista de Riesgo', columns: ['name', 'maxDrawdown', 'maxDrawdownInDollars', 'maxConsecutiveLosingMonths', 'sortinoRatio', 'upi'] },
            'profit': { name: 'Vista de Beneficio', columns: ['name', 'profitFactor', 'monthlyAvgProfit', 'profitMaxDD_Ratio', 'monthlyProfitToDollarDD'] }
        }
    },
    activeViews: { databank: 'default', saved: 'default' },
    currentEditingViewSet: 'databank', // 'databank' or 'saved'
};