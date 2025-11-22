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

    toggleLoading(true, 'Cargando Datos', 'Procesando archivos CSV...');
    dom.resultsDiv.classList.add('hidden');

    try {
        state.rawBenchmarkData = await parseCsv(dom.benchmarkFileInput.files[0]);
        if (!state.rawBenchmarkData[0].hasOwnProperty('date') || !state.rawBenchmarkData[0].hasOwnProperty('price')) {
            throw new Error(`El archivo de benchmark debe tener columnas de fecha y precio. Detectadas: [${Object.keys(state.rawBenchmarkData[0]).join(', ')}]`);
        }
        const strategiesPromises = state.loadedStrategyFiles.map(file => parseCsv(file));
        state.rawStrategiesData = await Promise.all(strategiesPromises);

        // --- CORRECCIÓN: Limpiar métricas antiguas antes de un nuevo análisis completo ---
        // Esto asegura que si cambiamos el benchmark, todo se recalcule.
        state.savedPortfolios.forEach(p => { delete p.metrics; delete p.analysis; });
        state.databankPortfolios.forEach(p => { delete p.metrics; });

        await reAnalyzeAllData(); // Análisis inicial
    } catch (error) {
        console.error("Error en el proceso de análisis:", error);
        displayError(error.message);
    } finally {
        toggleLoading(false);
    }
};

/**
 * Llama al backend para obtener un análisis completo de todas las estrategias y portafolios.
 * @param {Array} strategies - Array de datos de trades de las estrategias.
 * @param {Array} benchmark - Datos del benchmark.
 * @returns {Promise<Array>} - Promesa que resuelve a un array de resultados de análisis del backend.
 */
const getFullAnalysisFromBackend = async (strategies, benchmark, portfolios, isRiskNormalized, targetMaxDD) => {
    const payload = {
        strategies_data: strategies,
        benchmark_data: benchmark,
        portfolios_to_analyze: portfolios,
        is_risk_normalized: isRiskNormalized,
        normalization_metric: document.getElementById('normalization-metric-select')?.value || 'max_dd',
        normalization_target_value: targetMaxDD
    };
    console.log('%c[FRONTEND-LOG] 1. PAYLOAD A ENVIAR AL BACKEND:', 'color: cyan; font-weight: bold;', JSON.parse(JSON.stringify(payload)));
    try {
        const response = await fetch('/analysis/full', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
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
    console.log(`%c[FRONTEND-LOG] 0. Normalización Global Activada: ${isRiskNormalized}, Valor Objetivo: ${targetValue}`, 'color: yellow;');

    // --- CORREGIDO: Construir una lista de TODOS los portafolios que necesitan análisis del backend ---
    const portfoliosToAnalyze = [];

    // 1. Añadir todos los portafolios guardados a la lista de análisis.
    // El backend se encargará de calcular sus métricas siempre.
    state.savedPortfolios.forEach((p, i) => {
        // --- CORRECCIÓN DEFINITIVA: La normalización global siempre tiene prioridad ---
        let isNormalizedForThisRun, metricForThisRun, targetForThisRun;

        if (isRiskNormalized) {
            // Si la casilla global está marcada, se usa esa configuración para TODOS.
            isNormalizedForThisRun = true;
            metricForThisRun = document.getElementById('normalization-metric-select').value;
            targetForThisRun = targetValue;
        } else {
            // Si la global no está marcada, se usa la configuración individual del portafolio.
            const riskConfig = p.riskConfig || { isScaled: false };
            isNormalizedForThisRun = riskConfig.isScaled;
            metricForThisRun = riskConfig.normalizationMetric || 'max_dd';
            targetForThisRun = riskConfig.targetValue || 0;
        }

        // --- OPTIMIZACIÓN INCREMENTAL ---
        // Solo enviamos al backend si:
        // 1. No tiene métricas calculadas (es nuevo o se borraron).
        // 2. La configuración de riesgo global está activa (obliga a recalcular todo).
        // 3. Tiene configuración de riesgo propia y no tiene métricas (cubierto por 1).
        // NOTA: Si ya tiene métricas y NO estamos en modo global, asumimos que son válidas.

        const hasMetrics = p.metrics && Object.keys(p.metrics).length > 0;
        const needsRecalculation = !hasMetrics || isRiskNormalized; // Si hay normalización global, siempre recalcular para asegurar consistencia visual

        if (needsRecalculation) {
            console.log(`[FRONTEND-LOG] 1.1. Preparando Portafolio Guardado (índice ${i}, id: ${p.id}) para backend. Normalización: ${isNormalizedForThisRun}, Métrica: ${metricForThisRun}, Objetivo: ${targetForThisRun}`);

            portfoliosToAnalyze.push({
                indices: p.indices,
                weights: p.weights,
                is_saved_portfolio: true,
                saved_index: i,
                portfolio_id: p.id,
                is_risk_normalized: isNormalizedForThisRun,
                normalization_metric: metricForThisRun,
                normalization_target_value: targetForThisRun
            });
        } else {
            console.log(`[FRONTEND-LOG] 1.1. OMITIENDO Portafolio Guardado (índice ${i}) - Ya tiene métricas y no se requiere normalización global.`);
        }
    });

    // 1b. Añadir todos los portafolios del DataBank a la lista de análisis.
    // --- OPTIMIZACIÓN: Si estamos normalizando riesgo, IGNORAR los portafolios del DataBank para ahorrar tiempo.
    // El usuario generalmente solo quiere ver sus portafolios guardados normalizados.
    if (!isRiskNormalized) {
        state.databankPortfolios.forEach((p, i) => {
            // --- CORRECCIÓN: Solo enviar al backend si NO tiene métricas ---
            if (!p.metrics) {
                portfoliosToAnalyze.push({
                    indices: p.indices,
                    weights: null, // DataBank portfolios son siempre equal-weight
                    is_databank_portfolio: true,
                    databank_index: i
                });
            }
        });
    } else {
        console.log('[FRONTEND-LOG] 1.2. OMITIENDO Portafolios del DataBank por estar en modo Normalización de Riesgo.');
    }

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
    // --- CORRECCIÓN: Siempre mostrar loading si vamos a llamar al backend, aunque sea solo para estrategias ---
    let backendAnalyses = [];

    // Siempre mostramos loading porque SIEMPRE llamamos al backend para las estrategias individuales como mínimo
    toggleLoading(true, 'Analizando Datos', `Procesando ${state.loadedStrategyFiles.length} estrategias y ${portfoliosToAnalyze.length} portafolios...`, null);

    try {
        console.log(`[FRONTEND-LOG] Enviando ${portfoliosToAnalyze.length} portafolios en una sola petición.`);
        backendAnalyses = await getFullAnalysisFromBackend(state.rawStrategiesData, state.rawBenchmarkData, portfoliosToAnalyze, isRiskNormalized, targetValue);
    } catch (error) {
        console.error("Error durante el análisis:", error);
        displayError("Ocurrió un error durante el análisis. Revisa la consola.");
    } finally {
        toggleLoading(false);
    }

    console.log("%c[FRONTEND-LOG] 4. DATOS RECIBIDOS DEL BACKEND (Acumulados):", 'color: cyan; font-weight: bold;', JSON.parse(JSON.stringify(backendAnalyses)));

    if (!backendAnalyses) return;

    // 4. Mapear los resultados del backend al formato que espera el frontend.
    let allAnalysisResults = [];
    // --- OPTIMIZACIÓN: NO borrar métricas existentes si no se han recalculado ---
    // state.savedPortfolios.forEach(p => { delete p.metrics; delete p.analysis; }); 

    // Limpiar métricas antiguas de los portafolios del databank (estos siempre se recalculan si se envían, o se borran si no)
    // En este caso, como databankPortfolios siempre se envía completo si hay algo, está bien.
    // SOLO si no estamos en modo normalización (porque si lo estamos, no los enviamos y no queremos borrar sus datos viejos aunque no se muestren)
    // SOLO si no estamos en modo normalización (porque si lo estamos, no los enviamos y no queremos borrar sus datos viejos aunque no se muestren)
    // if (!isRiskNormalized) {
    //    state.databankPortfolios.forEach(p => { delete p.metrics; });
    // }

    // Contadores para mapear estrategias individuales
    const strategyAnalyses = [];

    for (const result of backendAnalyses) {
        if (!result) continue;

        if (result.is_saved_portfolio) {
            if (result.metrics && Object.keys(result.metrics).length > 0) {
                // El backend ahora usa saved_index para identificar portafolios guardados.
                // Es más fiable que el ID durante el ciclo de vida de la app.
                const portfolioInState = state.savedPortfolios[result.saved_index];
                console.log(`%c[FRONTEND-LOG] 5. Asignando métricas al portafolio guardado (índice ${result.saved_index})`, 'color: lightgreen;');
                if (portfolioInState) {
                    console.log(`[FRONTEND-LOG] 5.1. Métricas recibidas para portafolio '${portfolioInState.name}': Ret/DD=${result.metrics?.profitMaxDD_Ratio?.toFixed(2)}, MaxDD$=${result.metrics?.maxDrawdownInDollars?.toFixed(2)}`);
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

    console.log("%c[FRONTEND-LOG] 6. ESTADO FINAL de 'savedPortfolios' antes de dibujar:", 'color: orange; font-weight: bold;', JSON.parse(JSON.stringify(state.savedPortfolios)));
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

/**
 * Cierra el modal de confirmación de acción del gráfico.
 */
export const closeChartClickModal = () => {
    const modal = document.getElementById('chart-click-modal');
    if (modal) {
        const backdrop = document.getElementById('chart-click-modal-backdrop');
        const content = document.getElementById('chart-click-modal-content');
        backdrop.classList.add('opacity-0');
        content.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
        }, 300); // Coincide con la duración de la transición
    }
};