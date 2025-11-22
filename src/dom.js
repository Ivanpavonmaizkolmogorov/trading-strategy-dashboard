// Este archivo centraliza todas las referencias a los elementos del DOM.
// Facilita el mantenimiento, ya que si un ID cambia, solo se modifica aquí.

export const dom = {
    // Controles principales (Barra Superior y Modal Config)
    tradesFileInput: document.getElementById('tradesFiles'),
    benchmarkFileInput: document.getElementById('benchmarkFile'),
    tradesFilesListEl: document.getElementById('tradesFilesList'),
    benchmarkFileNameEl: document.getElementById('benchmarkFileName'),
    analyzeBtn: document.getElementById('analyzeBtn'),
    analyzeBtnSpinner: document.getElementById('analyzeBtnSpinner'), // Nuevo spinner
    resetBtn: document.getElementById('resetBtn'),
    exportBtn: document.getElementById('exportBtn'),
    importFile: document.getElementById('importFile'),

    // Configuración (Modal)
    configModal: document.getElementById('config-modal'),
    closeConfigBtn: document.getElementById('close-config-btn'),
    configModalBackdrop: document.getElementById('config-modal-backdrop'),

    // Parámetros de Optimización
    optimizationMetricSelect: document.getElementById('optimization-metric-select'),
    optimizationGoalSelect: document.getElementById('optimization-goal-select'),
    correlationFilterInput: document.getElementById('correlation-filter'),
    minWeightFilter: document.getElementById('min-weight-filter'),

    // Inputs Ocultos / Compatibilidad
    searchThresholdInput: document.getElementById('search-threshold'),
    analysisModeSelect: document.getElementById('analysis-mode-select'),

    // Normalización de Riesgo (Barra Superior)
    normalizeRiskCheckbox: document.getElementById('normalize-risk-checkbox'),
    targetMaxDDInput: document.getElementById('target-max-dd'),
    normalizationMetricSelect: document.getElementById('normalization-metric-select'),
    applyNormalizationBtn: document.getElementById('apply-normalization-btn'),
    restoreNormalizationBtn: document.getElementById('restore-normalization-btn'),

    // Sidebar Navigation
    navAnalysis: document.getElementById('nav-analysis'),
    navConfig: document.getElementById('nav-config'),
    navHelp: document.getElementById('nav-help'),

    // Layout Panels
    viewerContainer: document.getElementById('viewer-container'),
    sourcePanel: document.getElementById('source-panel'),
    panelResizer: document.getElementById('panel-resizer'),

    // Bottom Panel Tabs
    panelTabs: document.querySelectorAll('.tab-btn'), // NodeList

    // DataBank (Tab Content)
    findDatabankPortfoliosBtn: document.getElementById('findDatabankPortfoliosBtn'),
    databankContent: document.getElementById('databank-content'), // Replaces databankSection
    databankSizeInput: document.getElementById('databank-size'), // Hidden/Removed in new UI? Check index.html
    databankStatus: document.getElementById('databank-status'), // Hidden
    pauseSearchBtn: document.getElementById('pause-search-btn'), // Hidden
    stopSearchBtn: document.getElementById('stop-search-btn'), // Hidden
    clearDatabankBtn: document.getElementById('clear-databank-btn'), // Hidden
    databankTableBody: document.getElementById('databank-table-body'),
    databankTableHeader: document.getElementById('databank-table-header'),
    databankEmptyRow: document.getElementById('databank-empty-row'),
    databankSaveSelectedBtn: document.getElementById('databank-save-selected-btn'),

    // Portafolios Guardados (Tab Content)
    savedPortfoliosContent: document.getElementById('saved-portfolios-content'), // Replaces savedPortfoliosSection
    savedPortfoliosHeader: document.getElementById('saved-portfolios-header'),
    savedPortfoliosBody: document.getElementById('saved-portfolios-body'),
    savedPortfoliosCount: document.getElementById('saved-portfolios-count'),

    // Gráficos
    portfolioComparisonChartSection: document.getElementById('viewer-container'), // Re-mapped to viewer

    // Secciones Obsoletas / Ocultas (Mantener referencias si JS antiguo las usa para evitar null pointer, pero apuntar a hidden)
    resultsDiv: document.getElementById('results'), // Hidden
    errorMessageDiv: document.getElementById('toast-container'), // Re-purpose toast container or keep hidden
    featuredPortfolioSection: document.getElementById('featured-portfolio-section'), // Hidden/Removed

    // Pestañas de análisis (Resultados detallados - Oculto por ahora)
    tabNav: document.getElementById('tab-nav'), // Hidden
    tabContentArea: document.getElementById('tab-content-area'), // Hidden
    redrawChartsBtn: document.getElementById('redraw-charts-btn'), // Hidden

    // Gestor de Vistas (View Manager) - Hidden
    manageViewsBtn: document.getElementById('manage-views-btn'),
    savedManageViewsBtn: document.getElementById('saved-manage-views-btn'),
    viewManagerModal: document.getElementById('view-manager-modal'),
    closeViewManagerBtn: document.getElementById('close-view-manager-btn'),
    viewManagerBackdrop: document.getElementById('view-manager-backdrop'),
    viewManagerContent: document.getElementById('view-manager-content'),
    viewSelector: document.getElementById('view-selector'),
    savedViewSelector: document.getElementById('saved-view-selector'),

    // Índice Rápido - Removed
    toggleQuickIndexBtn: document.getElementById('toggle-quick-index'),
    quickIndexContent: document.getElementById('quick-index-content'),
};