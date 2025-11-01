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
                is_risk_normalized: isRiskNormalized,
                normalization_metric: document.getElementById('normalization-metric-select')?.value || 'max_dd', // <-- CORREGIDO
                normalization_target_value: targetMaxDD // El valor del input ahora es genérico
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
    // --- GUARDIA DE SEGURIDAD ---
    // Si no hay datos de estrategias o de benchmark, no podemos analizar nada.
    if (!state.rawStrategiesData || state.rawStrategiesData.length === 0 || !state.rawBenchmarkData) {
        console.warn("reAnalyzeAllData abortado: Faltan datos de estrategias o de benchmark.");
        return;
    }

    state.selectedPortfolioIndices.clear();
    document.querySelectorAll('.portfolio-checkbox:checked').forEach(cb => {
        state.selectedPortfolioIndices.add(parseInt(cb.dataset.index));
    });

    updateAnalysisModeSelector();

    const isRiskNormalized = dom.normalizeRiskCheckbox.checked;
    const targetValue = isRiskNormalized ? parseFloat(document.getElementById('target-max-dd').value) : 0;

    // --- CORREGIDO: Construir una lista de TODOS los portafolios que necesitan análisis del backend ---
    const portfoliosToAnalyze = [];

    // 1. Añadir todos los portafolios guardados a la lista de análisis.
    // El backend se encargará de calcular sus métricas siempre.
    state.savedPortfolios.forEach((p, i) => {
        // --- CORRECCIÓN VITAL ---
        // Cada portafolio guardado ahora lleva su propia configuración de riesgo.
        // Si no tiene una, se asume que no se normaliza (is_risk_normalized: false).
        const riskConfig = p.riskConfig || { isScaled: false, targetMaxDD: 0 };
        portfoliosToAnalyze.push({
            indices: p.indices,
            weights: p.weights,
            is_saved_portfolio: true,
            saved_index: i,
            portfolio_id: p.id,
            is_risk_normalized: riskConfig.isScaled,
            normalization_metric: riskConfig.normalizationMetric || 'max_dd', // Guardar también la métrica
            normalization_target_value: riskConfig.targetValue
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
        // El portafolio "actual" SÍ usa la configuración global de la UI.
        portfoliosToAnalyze.push({
            indices: Array.from(state.selectedPortfolioIndices),
            weights: null, // El backend calculará equal weight
            is_current_portfolio: true,
            is_risk_normalized: isRiskNormalized,
            normalization_metric: document.getElementById('normalization-metric-select').value, // <-- Usa el control global
            normalization_target_value: targetValue // <-- Usa el control global
        });
    }

    // 3. Obtener todos los análisis (estrategias + portafolios) en una sola llamada al backend.
    const backendAnalyses = await getFullAnalysisFromBackend(state.rawStrategiesData, state.rawBenchmarkData, portfoliosToAnalyze, isRiskNormalized, targetValue);
    // El log que has proporcionado confirma que los datos llegan aquí.
    console.log("DEBUG ANALYSIS.JS: Datos recibidos del backend:", JSON.parse(JSON.stringify(backendAnalyses)));
    if (!backendAnalyses || backendAnalyses.length === 0) return;

    // 4. Mapear los resultados del backend al formato que espera el frontend.
    let allAnalysisResults = [];
    // Limpiar métricas antiguas de los portafolios guardados antes de enriquecerlos
    state.savedPortfolios.forEach(p => { delete p.metrics; delete p.analysis; });
    // Limpiar métricas antiguas de los portafolios del databank
    state.databankPortfolios.forEach(p => { delete p.metrics; });

    // Contadores para mapear estrategias individuales
    const strategyAnalyses = [];

    for (const result of backendAnalyses) {
        if (!result) continue;

        if (result.is_saved_portfolio) {
            if (result.metrics && Object.keys(result.metrics).length > 0) {
                // El backend ahora usa saved_index para identificar portafolios guardados.
                // Es más fiable que el ID durante el ciclo de vida de la app.
                const portfolioInState = state.savedPortfolios[result.saved_index];
                if (portfolioInState) {
                    portfolioInState.metrics = result.metrics;
                    portfolioInState.analysis = result.metrics;
                }
            }
        } else if (result.is_databank_portfolio) {
            if (result.databank_index !== undefined && state.databankPortfolios[result.databank_index]) {
                const databankPortfolio = state.databankPortfolios[result.databank_index];
                if (databankPortfolio && result.metrics) {
                    databankPortfolio.metrics = result.metrics;
                }
            }
        } else if (result.is_current_portfolio) {
            allAnalysisResults.push({ name: 'Portafolio Actual', analysis: result.metrics, isCurrentPortfolio: true });
        } else {
            // Si no es ningún tipo de portafolio, es una estrategia individual.
            // Esto es más robusto que la condición anterior.
            strategyAnalyses.push(result);
        }
    }

    // Ahora, procesamos las estrategias individuales en orden.
    // Esto asegura que el 'originalIndex' sea correcto.
    strategyAnalyses.forEach((analysis, index) => {
        if (index < state.loadedStrategyFiles.length) {
            allAnalysisResults.push({
                name: state.loadedStrategyFiles[index].name.replace('.csv', ''),
                analysis: analysis,
                originalIndex: index
            });
        }
    });

    // Después de enriquecer, añadimos los portafolios guardados a los resultados para los gráficos.
    state.savedPortfolios.forEach((p, i) => {
        if (p.metrics) {
            allAnalysisResults.push({ name: p.name, analysis: p.metrics, isSavedPortfolio: true, savedIndex: i });
        }
    });

    console.log("DEBUG ANALYSIS.JS: Estado final de 'savedPortfolios' antes de dibujar:", JSON.parse(JSON.stringify(state.savedPortfolios)));
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