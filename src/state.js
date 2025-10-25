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

    // Vistas de tablas
    tableViews: {
        databank: {
            'default': { name: 'Vista por Defecto', columns: ['name', 'metricValue', 'profitFactor', 'sortinoRatio', 'maxDrawdown', 'monthlyAvgProfit', 'maxConsecutiveLosingMonths'] },
            'risk': { name: 'Vista de Riesgo', columns: ['name', 'maxDrawdown', 'maxDrawdownInDollars', 'maxConsecutiveLosingMonths', 'sortinoRatio', 'upi'] },
            'profit': { name: 'Vista de Beneficio', columns: ['name', 'profitFactor', 'monthlyAvgProfit', 'profitMaxDD_Ratio', 'monthlyProfitToDollarDD'] }
        },
        saved: {
            'default': { name: 'Vista por Defecto', columns: ['name', 'profitFactor', 'sortinoRatio', 'upi', 'maxDrawdown', 'monthlyAvgProfit', 'maxConsecutiveLosingMonths'] },
            'risk': { name: 'Vista de Riesgo', columns: ['name', 'maxDrawdown', 'maxDrawdownInDollars', 'maxConsecutiveLosingMonths', 'sortinoRatio', 'upi'] },
            'profit': { name: 'Vista de Beneficio', columns: ['name', 'profitFactor', 'monthlyAvgProfit', 'profitMaxDD_Ratio', 'monthlyProfitToDollarDD'] }
        }
    },
    activeViews: { databank: 'default', saved: 'default' },
    currentEditingViewSet: 'databank', // 'databank' or 'saved'
};