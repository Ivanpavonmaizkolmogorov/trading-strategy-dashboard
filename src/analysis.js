import { state } from './state.js';
import { dom } from './dom.js';
import { displayError, toggleLoading, parseCsv } from './utils.js';
import { displayResults, updateAnalysisModeSelector, renderPortfolioComparisonCharts, renderFeaturedPortfolio } from './ui.js';

/**
 * Inicia el proceso de análisis principal. Carga los archivos y lanza el primer análisis.
 */
export const runAnalysis = async () => {
    displayError(''); // Ocultar errores previos
    // destroyAllCharts(); // Se gestiona dentro de displayResults

    if (state.loadedStrategyFiles.length === 0 || !dom.benchmarkFileInput.files[0]) {
        displayError('Por favor, selecciona al menos un archivo de estrategia y un archivo de benchmark.');
        return;
    }

    toggleLoading(true, 'analyzeBtn', 'analyzeBtnText', 'analyzeBtnSpinner');
    dom.resultsDiv.classList.add('hidden');

    try {
        state.rawBenchmarkData = await parseCsv(dom.benchmarkFileInput.files[0]);
        if (!state.rawBenchmarkData[0].hasOwnProperty('date') || !state.rawBenchmarkData[0].hasOwnProperty('price')) {
            throw new Error(`El archivo de benchmark debe tener columnas de fecha y precio. Detectadas: [${Object.keys(state.rawBenchmarkData[0]).join(', ')}]`);
        }
        const strategiesPromises = state.loadedStrategyFiles.map(file => parseCsv(file));
        state.rawStrategiesData = await Promise.all(strategiesPromises);

        await reAnalyzeAllData(); // Análisis inicial
    } catch (error) {
        console.error("Error en el proceso de análisis:", error);
        displayError(error.message);
    } finally {
        toggleLoading(false, 'analyzeBtn', 'analyzeBtnText', 'analyzeBtnSpinner');
    }
};

/**
 * Calcula el factor de escala de riesgo basado en el input del usuario.
 * @returns {number} El factor de escala (ej: 1.5 para 150$).
 */
const getRiskScaleFactor = () => {
    if (!dom.riskPerTradeInput) return 1.0;
    const riskPerTrade = parseFloat(dom.riskPerTradeInput.value);
    return (riskPerTrade > 0) ? riskPerTrade / 100.0 : 1.0;
};

/**
 * Llama al backend para obtener un análisis completo de todas las estrategias y portafolios.
 * @param {Array} strategies - Array de datos de trades de las estrategias.
 * @param {Array} benchmark - Datos del benchmark.
 * @returns {Promise<Array>} - Promesa que resuelve a un array de resultados de análisis del backend.
 */
const getFullAnalysisFromBackend = async (strategies, benchmark, portfolios) => {
    try {
        const response = await fetch('http://localhost:8001/analysis/full', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                strategies_data: strategies,
                benchmark_data: benchmark,
                portfolios_to_analyze: portfolios // <-- NUEVO: Enviamos los portafolios a analizar
            })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Error en la respuesta del backend');
        }
        return await response.json();
    } catch (error) {
        console.error("Error al obtener análisis del backend:", error);
        displayError(`No se pudo conectar con el backend para el análisis: ${error.message}`);
        return [];
    }
};
/**
 * Vuelve a calcular y mostrar todos los resultados basándose en el estado actual (filtros, selecciones, etc.).
 */
export const reAnalyzeAllData = async () => {
    state.selectedPortfolioIndices.clear();
    document.querySelectorAll('.portfolio-checkbox:checked').forEach(cb => {
        state.selectedPortfolioIndices.add(parseInt(cb.dataset.index));
    });

    updateAnalysisModeSelector();

    // --- NUEVO: Construir la lista de portafolios a analizar ---
    const portfoliosToAnalyze = [];
    state.savedPortfolios.forEach((p, i) => {
        // Si el portafolio NO tiene métricas precalculadas, pedimos al backend que las calcule.
        // Esto ocurre con portafolios viejos o importados.
        if (!p.precomputedMetrics) {
            portfoliosToAnalyze.push({
                indices: p.indices,
                weights: p.weights,
                is_saved_portfolio: true,
                saved_index: i,
                name: p.name
            });
        }
    });

    if (state.selectedPortfolioIndices.size > 0) {
        portfoliosToAnalyze.push({
            indices: Array.from(state.selectedPortfolioIndices),
            weights: null, // El backend calculará equal weight
            is_current_portfolio: true,
            name: 'Portafolio Actual'
        });
    }

    // 1. Obtener todos los análisis base desde el backend.
    const backendAnalyses = await getFullAnalysisFromBackend(state.rawStrategiesData, state.rawBenchmarkData, portfoliosToAnalyze);
    if (!backendAnalyses || backendAnalyses.length === 0) return;

    // 2. Mapear los resultados del backend al formato que espera el frontend.
    let allAnalysisResults = [];
    
    // Primero, procesamos los resultados que vinieron del backend
    let backendIndex = 0;
    backendAnalyses.forEach(result => {
        if (result && (result.is_saved_portfolio || result.is_current_portfolio)) {
            const trades = result.indices.flatMap(idx => state.rawStrategiesData[idx]);
            allAnalysisResults.push({ name: result.name, analysis: processStrategyData(trades, state.rawBenchmarkData, null, result.metrics), isSavedPortfolio: result.is_saved_portfolio, savedIndex: result.saved_index, isPortfolio: result.is_current_portfolio, isCurrentPortfolio: result.is_current_portfolio, indices: result.indices, weights: result.weights });
        } else if (result) { // Estrategia individual
            allAnalysisResults.push({ name: state.loadedStrategyFiles[backendIndex].name.replace('.csv', ''), analysis: processStrategyData(state.rawStrategiesData[backendIndex], state.rawBenchmarkData, null, result), originalIndex: backendIndex });
            backendIndex++;
        }
    });

    // Segundo, añadimos los portafolios guardados que ya tenían métricas
    state.savedPortfolios.forEach((p, i) => {
        if (p.precomputedMetrics) {
            const trades = p.indices.flatMap(idx => state.rawStrategiesData[idx]);
            allAnalysisResults.push({ name: p.name, analysis: processStrategyData(trades, state.rawBenchmarkData, null, p.precomputedMetrics), isSavedPortfolio: true, savedIndex: i, indices: p.indices, weights: p.weights });
            // Limpiamos las métricas precalculadas para que la próxima vez se actualicen si es necesario
            delete p.precomputedMetrics;
        }
    });

    displayResults(allAnalysisResults);
};

/**
 * Procesa un conjunto de trades y datos de benchmark para calcular todas las métricas y curvas.
 * @param {Array} tradesToAnalyze - Array de objetos de trade.
 * @param {Array} benchmark - Array de datos del benchmark.
 * @param {Array|null} filterSourceTrades - Trades para filtrar el tiempo de análisis.
 * @returns {Object|null} Objeto con los resultados del análisis o null si no es posible.
 * @note Esta función ya no se preocupa por el `size`. Recibe los trades con el PnL ya ajustado.
 */
export const processStrategyData = (tradesToAnalyze, benchmark, filterSourceTrades = null, precomputedMetrics = null) => {
    if (!tradesToAnalyze || tradesToAnalyze.length === 0) return null;

    let benchmarkToUse = benchmark;
    // Las métricas ahora SIEMPRE vienen precalculadas desde el backend o se pasan como un objeto.
    // Esta función se enfoca en preparar los datos para los GRÁFICOS.
    // Si no se pasan métricas, se crea un objeto vacío para evitar errores.
    const metrics = precomputedMetrics || {};

    if (filterSourceTrades) {
        const inTradeDates = new Set();
        filterSourceTrades.forEach(trade => {
            let currentDate = new Date(trade.entry_date);
            const endDate = new Date(trade.exit_date);
            if (isNaN(currentDate.getTime()) || isNaN(endDate.getTime())) return;
            while (currentDate <= endDate) {
                inTradeDates.add(currentDate.toISOString().split('T')[0]);
                currentDate.setDate(currentDate.getDate() + 1);
            }
        });
        benchmarkToUse = benchmark.filter(row => inTradeDates.has(new Date(row.date).toISOString().split('T')[0]));
        if (benchmarkToUse.length < 2) return null;
    };

    const dailyPnl = new Map();
    tradesToAnalyze.forEach(trade => {
        const pnl = parseFloat(trade.pnl);
        const exitDate = new Date(trade.exit_date);

        if (!isNaN(pnl) && !isNaN(exitDate.getTime())) {
            const dateStr = exitDate.toISOString().split('T')[0];
            dailyPnl.set(dateStr, (dailyPnl.get(dateStr) || 0) + pnl);
        }
    });

    if (dailyPnl.size === 0) return null;

    const tradeDates = Array.from(dailyPnl.keys()).sort();
    const startDate = new Date(tradeDates[0]);
    const endDate = new Date(tradeDates[tradeDates.length - 1]);

    const fullDateRange = [];
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
        fullDateRange.push(currentDate.toISOString().split('T')[0]);
        currentDate.setDate(currentDate.getDate() + 1);
    }

    let currentEquity = 10000;
    const equityCurveData = [];
    fullDateRange.forEach(date => {
        if (dailyPnl.has(date)) currentEquity += dailyPnl.get(date);
        equityCurveData.push({ x: date, y: currentEquity });
    });

    const labels = equityCurveData.map(p => p.x);
    const portfolioValues = equityCurveData.map(p => p.y);

    const benchmarkPrices = new Map();
    benchmarkToUse.forEach(row => {
        const date = new Date(row.date);
        const price = parseFloat(row.price);
        if (!isNaN(date.getTime()) && !isNaN(price)) benchmarkPrices.set(date.toISOString().split('T')[0], price);
    });
    const benchmarkData = labels.map(date => ({ x: date, y: benchmarkPrices.get(date) }));

    const portfolioReturns = [], benchmarkReturns = [];
    let lastPortfolioValue = portfolioValues.length > 0 ? portfolioValues[0] : 0;
    let lastBenchmarkValue = benchmarkData.length > 0 ? benchmarkData[0].y : 0;
    for (let i = 1; i < labels.length; i++) {
        const pReturn = (lastPortfolioValue > 0) ? (portfolioValues[i] / lastPortfolioValue) - 1 : 0;
        const bReturn = (lastBenchmarkValue > 0 && benchmarkData[i]?.y != null) ? (benchmarkData[i].y / lastBenchmarkValue) - 1 : 0;
        portfolioReturns.push(pReturn);
        benchmarkReturns.push(bReturn);
        lastPortfolioValue = portfolioValues[i];
        if (benchmarkData[i]?.y != null) lastBenchmarkValue = benchmarkData[i].y;
    }

     // --- CÁLCULOS DE MÉTRICAS ELIMINADOS ---
    // El frontend ya no calcula ninguna métrica, solo prepara datos para gráficos.
    // Las métricas se reciben del backend.
    const positivePnlTrades = tradesToAnalyze.filter(t => t.pnl > 0).sort((a, b) => a.pnl - b.pnl);
    const totalProfit = positivePnlTrades.reduce((sum, t) => sum + t.pnl, 0);
    let cumulativeProfit = 0;
    const lorenzData = [{ x: 0, y: 0 }];
    if (totalProfit > 0) {
        positivePnlTrades.forEach((trade, index) => {
            cumulativeProfit += trade.pnl;
            lorenzData.push({ x: (index + 1) / positivePnlTrades.length * 100, y: (cumulativeProfit / totalProfit) * 100 });
        });
    }

    return {
        labels, portfolioValues, benchmarkData,
        returnsData: portfolioReturns.map((p, i) => ({ x: benchmarkReturns[i] * 100, y: p * 100 })),
        metrics: metrics,
        lorenzData, dailyReturnsMap: new Map(Array.from(dailyPnl.entries()).map(([date, pnl]) => [date, pnl])), rollingSortinoData: [], monthlyPerformance: {}
    };
};