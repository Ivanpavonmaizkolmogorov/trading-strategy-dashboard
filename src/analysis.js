import { state } from './state.js';
import { dom } from './dom.js';
import { displayError, toggleLoading, parseCsv } from './utils.js';
import { displayResults, updateAnalysisModeSelector, displaySavedPortfoliosList } from './ui.js';

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
        const response = await fetch('/analysis/full', {
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
                analysis: result.metrics, // El backend ahora devuelve todo, incluyendo chartData
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
                analysis: result, // El backend ahora devuelve todo, incluyendo chartData
                originalIndex: strategyIndex
            });
            strategyIndex++;
        }
    }

    displayResults(allAnalysisResults);
};

/**
 * Ordena la tabla de resumen.
 * @param {HTMLElement} headerEl - El elemento de cabecera que fue clickeado.
 */
export const sortSummaryTable = (headerEl) => {
    console.log('-> Dentro de sortSummaryTable. Ordenando por:', headerEl.dataset.column);

    const sortKey = headerEl.dataset.column;
    if (!sortKey) return;

    let newOrder;
    if (state.summarySortConfig.key === sortKey) {
        newOrder = state.summarySortConfig.order === 'asc' ? 'desc' : 'asc';
    } else {
        const metricsToMinimize = ['maxDrawdown', 'maxDrawdownInDollars', 'maxStagnationTrades', 'maxConsecutiveLosses', 'avgLoss', 'downsideCapture', 'maxConsecutiveLosingMonths', 'maxStagnationDays'];
        newOrder = metricsToMinimize.includes(sortKey) ? 'asc' : 'desc';
    }

    state.summarySortConfig.key = sortKey;
    state.summarySortConfig.order = newOrder;

    // Re-render the entire results section to apply sorting
    console.log('<- Llamando a displayResults para redibujar la tabla de resumen.');
    displayResults(window.analysisResults);
};

/**
 * Ordena la tabla de portafolios guardados.
 * @param {HTMLElement} headerEl - El elemento de cabecera que fue clickeado.
 */
export const sortSavedPortfoliosTable = (headerEl) => {
    console.log('-> Dentro de sortSavedPortfoliosTable. Ordenando por:', headerEl.dataset.sortKey);

    const sortKey = headerEl.dataset.sortKey;
    if (!sortKey) return;

    let newOrder;
    if (state.savedPortfoliosSortConfig.key === sortKey) {
        newOrder = state.savedPortfoliosSortConfig.order === 'asc' ? 'desc' : 'asc';
    } else {
        const metricsToMinimize = ['maxDrawdown', 'maxDrawdownInDollars', 'maxStagnationTrades', 'maxConsecutiveLosses', 'avgLoss', 'downsideCapture', 'maxConsecutiveLosingMonths', 'maxStagnationDays'];
        newOrder = metricsToMinimize.includes(sortKey) ? 'asc' : 'desc';
    }

    state.savedPortfoliosSortConfig.key = sortKey;
    state.savedPortfoliosSortConfig.order = newOrder;

    // Simplemente volvemos a dibujar la lista, que ahora se ordenará con la nueva configuración.
    console.log('<- Llamando a displaySavedPortfoliosList para redibujar la tabla de guardados.');
    displaySavedPortfoliosList();
};