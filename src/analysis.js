import { state } from './state.js';
import { dom } from './dom.js';
import { displayError, toggleLoading, parseCsv } from './utils.js';
import { displayResults, updateAnalysisModeSelector } from './ui.js';

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
 * Llama al backend para obtener un análisis completo de todas las estrategias y portafolios.
 * @param {Array} strategies - Array de datos de trades de las estrategias.
 * @param {Array} benchmark - Datos del benchmark.
 * @returns {Promise<Array>} - Promesa que resuelve a un array de resultados de análisis del backend.
 */
const getFullAnalysisFromBackend = async (strategies, benchmark, portfolios, isRiskNormalized, targetMaxDD) => {
    try {
        const response = await fetch('http://localhost:8001/analysis/full', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                strategies_data: strategies,
                benchmark_data: benchmark,
                portfolios_to_analyze: portfolios,
                is_risk_normalized: isRiskNormalized, // <-- NUEVO
                target_max_dd: targetMaxDD             // <-- NUEVO
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

    const isRiskNormalized = dom.normalizeRiskCheckbox.checked;
    const targetMaxDD = isRiskNormalized ? parseFloat(document.getElementById('target-max-dd').value) : 0;

    // --- CORREGIDO: Construir una lista de TODOS los portafolios que necesitan análisis del backend ---
    const portfoliosToAnalyze = [];

    // 1. Añadir todos los portafolios guardados a la lista de análisis.
    // El backend se encargará de calcular sus métricas siempre.
    state.savedPortfolios.forEach((p, i) => {
        portfoliosToAnalyze.push({
            indices: p.indices,
            weights: p.weights,
            is_saved_portfolio: true,
            saved_index: i
        });
    });

    // 1b. Añadir todos los portafolios del DataBank a la lista de análisis.
    state.databankPortfolios.forEach((p, i) => {
        portfoliosToAnalyze.push({
            indices: p.indices,
            weights: null, // DataBank portfolios son siempre equal-weight
            is_databank_portfolio: true,
            databank_index: i
        });
    });

    // 2. Añadir el portafolio "en vivo" si hay estrategias seleccionadas en la tabla de resumen.
    if (state.selectedPortfolioIndices.size > 0) {
        portfoliosToAnalyze.push({
            indices: Array.from(state.selectedPortfolioIndices),
            weights: null, // El backend calculará equal weight
            is_current_portfolio: true
        });
    }

    // 3. Obtener todos los análisis (estrategias + portafolios) en una sola llamada al backend.
    const backendAnalyses = await getFullAnalysisFromBackend(state.rawStrategiesData, state.rawBenchmarkData, portfoliosToAnalyze, isRiskNormalized, targetMaxDD);
    if (!backendAnalyses || backendAnalyses.length === 0) return;

    // 4. Mapear los resultados del backend al formato que espera el frontend.
    let allAnalysisResults = [];
    let strategyIndex = 0;
    for (const result of backendAnalyses) {
        if (result && result.is_databank_portfolio) {
            // Es un portafolio del DataBank que ha sido re-analizado.
            // Actualizamos sus métricas directamente en el estado.
            const databankPortfolio = state.databankPortfolios[result.databank_index];
            if (databankPortfolio && result.metrics) {
                // La métrica principal optimizada no cambia, pero las secundarias sí.
                databankPortfolio.metrics = result.metrics;
            }
            // No añadimos estos resultados a `allAnalysisResults` porque el DataBank
            // se redibuja por separado.

        } else if (result && (result.is_saved_portfolio || result.is_current_portfolio)) {
            // Para portafolios, el backend ya ha hecho todo. Solo preparamos los datos para los gráficos.
            // CORRECCIÓN: Usar los trades que devuelve el backend, que ya están escalados si se normalizó el riesgo.
            const portfolioDef = result.is_saved_portfolio ? state.savedPortfolios[result.saved_index] : { name: 'Portafolio Actual' };
            // Si el backend no devuelve trades (versión antigua), los construimos como antes para mantener compatibilidad.
            const trades = result.trades || result.indices.flatMap((stratIdx, i) => {
                 const weight = result.weights ? result.weights[i] : (1 / result.indices.length);
                 return state.rawStrategiesData[stratIdx].map(trade => ({ ...trade, pnl: trade.pnl * weight }));
             });
            allAnalysisResults.push({
                name: portfolioDef.name,
                analysis: processStrategyData(trades, state.rawBenchmarkData, null, result.metrics),
                isSavedPortfolio: result.is_saved_portfolio,
                savedIndex: result.saved_index,
                isCurrentPortfolio: result.is_current_portfolio,
                indices: result.indices,
                weights: result.weights
            });
        } else if (result) {
            // Para estrategias individuales, el backend solo devuelve las métricas.
            allAnalysisResults.push({
                name: state.loadedStrategyFiles[strategyIndex].name.replace('.csv', ''),
                analysis: processStrategyData(state.rawStrategiesData[strategyIndex], state.rawBenchmarkData, null, result),
                originalIndex: strategyIndex
            });
            strategyIndex++;
        }
    }

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

    // --- CORRECCIÓN: Asegurar que el benchmark tenga un punto de partida válido para la normalización ---
    // Encontrar el primer punto del benchmark que tiene un valor válido.
    const firstValidBenchmarkPoint = benchmarkData.find(d => d.y != null);
    let lastBenchmarkValue = firstValidBenchmarkPoint ? firstValidBenchmarkPoint.y : 0;

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
    // Las métricas y datos para gráficos como Lorenz se reciben del backend.

    return {
        labels, portfolioValues, benchmarkData,
        returnsData: portfolioReturns.map((p, i) => ({ x: benchmarkReturns[i] * 100, y: p * 100 })),
        metrics: metrics,
        lorenzData: metrics.lorenzData || [], // Usar lorenzData de las métricas del backend
        rollingSortinoData: [], // Placeholder, ya que no se ha implementado en backend
        dailyReturnsMap: new Map(Array.from(dailyPnl.entries()).map(([date, pnl]) => [date, pnl])),
        monthlyPerformance: {}
    };
};