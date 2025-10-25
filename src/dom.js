// Este archivo centraliza todas las referencias a los elementos del DOM.
// Facilita el mantenimiento, ya que si un ID cambia, solo se modifica aquí.

export const dom = {
    // Controles principales
    tradesFileInput: document.getElementById('tradesFiles'),
    benchmarkFileInput: document.getElementById('benchmarkFile'),
    tradesFilesListEl: document.getElementById('tradesFilesList'),
    benchmarkFileNameEl: document.getElementById('benchmarkFileName'),
    analyzeBtn: document.getElementById('analyzeBtn'),
    resetBtn: document.getElementById('resetBtn'),
    exportBtn: document.getElementById('exportBtn'),
    importFile: document.getElementById('importFile'),
    optimizationMetricSelect: document.getElementById('optimization-metric-select'),
    optimizationGoalSelect: document.getElementById('optimization-goal-select'),
    correlationFilterInput: document.getElementById('correlation-filter'),
    minWeightFilter: document.getElementById('min-weight-filter'),
    searchThresholdInput: document.getElementById('search-threshold'),
    analysisModeSelect: document.getElementById('analysis-mode-select'),
    normalizeRiskCheckbox: document.getElementById('normalize-risk-checkbox'),
    riskPerTradeInput: document.getElementById('risk-per-trade'), // <-- NUEVO
    targetMaxDDSlider: document.getElementById('target-max-dd-slider'),
    targetMaxDDInput: document.getElementById('target-max-dd'),
    riskNormalizationControls: document.getElementById('risk-normalization-controls'),

    // Secciones y mensajes
    resultsDiv: document.getElementById('results'),
    errorMessageDiv: document.getElementById('error-message'),
    featuredPortfolioSection: document.getElementById('featured-portfolio-section'),

    // Pestañas de análisis
    tabNav: document.getElementById('tab-nav'),
    tabContentArea: document.getElementById('tab-content-area'),
    redrawChartsBtn: document.getElementById('redraw-charts-btn'),

    // DataBank
    findDatabankPortfoliosBtn: document.getElementById('findDatabankPortfoliosBtn'),
    databankSection: document.getElementById('databank-section'),
    databankSizeInput: document.getElementById('databank-size'),
    databankStatus: document.getElementById('databank-status'),
    pauseSearchBtn: document.getElementById('pause-search-btn'),
    stopSearchBtn: document.getElementById('stop-search-btn'),
    clearDatabankBtn: document.getElementById('clear-databank-btn'),
    databankTableBody: document.getElementById('databank-table-body'),
    databankTableHeader: document.getElementById('databank-table-header'),
    databankEmptyRow: document.getElementById('databank-empty-row'),
    databankSaveSelectedBtn: document.getElementById('databank-save-selected-btn'),

    // Portafolios Guardados
    savedPortfoliosSection: document.getElementById('saved-portfolios-section'),
    savedPortfoliosHeader: document.getElementById('saved-portfolios-header'),
    savedPortfoliosBody: document.getElementById('saved-portfolios-body'),
    savedPortfoliosCount: document.getElementById('saved-portfolios-count'),
    portfolioComparisonChartSection: document.getElementById('portfolio-comparison-chart-section'),

    // Gestor de Vistas (View Manager)
    manageViewsBtn: document.getElementById('manage-views-btn'),
    savedManageViewsBtn: document.getElementById('saved-manage-views-btn'),
    viewManagerModal: document.getElementById('view-manager-modal'),
    closeViewManagerBtn: document.getElementById('close-view-manager-btn'),
    viewManagerBackdrop: document.getElementById('view-manager-backdrop'),
    viewManagerContent: document.getElementById('view-manager-content'),
    viewSelector: document.getElementById('view-selector'),
    savedViewSelector: document.getElementById('saved-view-selector'),

    // Índice Rápido
    toggleQuickIndexBtn: document.getElementById('toggle-quick-index'),
    quickIndexContent: document.getElementById('quick-index-content'),
};