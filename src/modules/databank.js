import { state } from '../state.js';
import { dom } from '../dom.js';
import { ALL_METRICS, SELECTION_COLORS } from '../config.js?v=7'; // ALL_METRICS y SELECTION_COLORS se siguen usando
import { hideError, displayError, toggleLoading, formatMetricForDisplay } from '../utils.js'; // Estas utilidades se siguen usando
import { initDatabankTable, getDatabankTableConfig, ensureColumnVisible, hideColumn } from './databankTable.js?v=8';
import { focusMode } from './focusMode.js';
import { generatePortfolioId } from '../utils.js'; // Import ID generator
import { loadBrokerConfig } from './brokerConfig.js';

import { calculateSQMetrics, parseTradesFromContent, parseTradesFromData } from './sqAnalysis_v2.js?v=5';

/**
 * Actualiza el indicador visual de estado del DataBank.
 * @param {string} status - 'connecting' | 'searching' | 'paused' | 'stopped' | 'completed' | 'error' | 'hidden'
 * @param {string} message - Mensaje a mostrar
 */
const setDatabankStatus = (status, message = '') => {
    const statusBar = document.getElementById('databank-status-bar');
    const statusIcon = document.getElementById('databank-status-icon');
    const statusText = document.getElementById('databank-status-text');

    if (!statusBar || !statusIcon || !statusText) return;

    const statusConfig = {
        hidden: { icon: '', class: 'hidden' },
        connecting: { icon: '📡', class: 'animate-pulse', color: 'text-blue-400' },
        searching: { icon: '⛏️', class: 'animate-bounce', color: 'text-yellow-400' },
        paused: { icon: '⏸️', class: '', color: 'text-orange-400' },
        stopped: { icon: '⏹️', class: '', color: 'text-red-400' },
        completed: { icon: '✅', class: '', color: 'text-green-400' },
        error: { icon: '❌', class: '', color: 'text-red-500' }
    };

    const config = statusConfig[status] || statusConfig.hidden;

    if (status === 'hidden') {
        statusBar.classList.add('hidden');
    } else {
        statusBar.classList.remove('hidden');
        statusIcon.innerHTML = `<span class="${config.class} ${config.color} text-xl">${config.icon}</span>`;
        statusText.textContent = message;
        statusText.className = `text-sm ${config.color}`;
    }
};

export const updateDatabankCount = () => {
    const countBadge = document.getElementById('databank-count');
    if (countBadge) {
        countBadge.textContent = state.databankPortfolios.length;
        countBadge.classList.remove('hidden');
    }
};

/**
 * Inicia la búsqueda de portafolios en el DataBank.
 */
export const findDatabankPortfolios = async (customConfig = {}) => {
    if (state.rawStrategiesData.length < 2) {
        displayError("Necesitas al menos 2 estrategias cargadas para buscar portafolios.");
        return;
    }

    hideError();

    // Resetear el estado de la UI y los botones
    // En el nuevo layout, databankContent siempre está visible, no necesitamos mostrarlo
    if (dom.pauseSearchBtn) {
        dom.pauseSearchBtn.disabled = false;
        dom.pauseSearchBtn.textContent = 'Pausar';
    }
    if (dom.stopSearchBtn) dom.stopSearchBtn.disabled = false;

    // NO usamos toggleLoading porque bloquea toda la UI
    // En su lugar, solo deshabilitamos el botón de búsqueda
    if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.disabled = true;
    if (dom.clearDatabankBtn) dom.clearDatabankBtn.disabled = true;
    if (dom.databankSizeInput) dom.databankSizeInput.disabled = true;

    state.databankPortfolios = [];
    updateDatabankDisplay(); // Limpia la tabla

    // Mostrar estado visual: Conectando
    setDatabankStatus('connecting', 'Conectando con el backend de Python...');
    console.log('📡 Conectando con el backend de Python...');

    // 1. Empaquetar los datos para la petición inicial
    const requestBody = {
        strategy_names: state.loadedStrategyFiles.map(f => f.name), // <-- Añadimos los nombres
        strategies_data: state.rawStrategiesData,
        broker_config: loadBrokerConfig(),
        params: {
            metric_to_optimize_key: customConfig.metric || dom.optimizationMetricSelect.value,
            optimization_goal: customConfig.goal || dom.optimizationGoalSelect.value,
            correlation_threshold: customConfig.correlationThreshold !== undefined
                ? customConfig.correlationThreshold
                : (dom.correlationFilterInput ? parseFloat(dom.correlationFilterInput.value) : 0.90),
            max_size: customConfig.maxSize || (dom.databankSizeInput ? parseInt(dom.databankSizeInput.value, 10) : 20),
            base_indices: (state.searchBasePortfolioIndex !== null && state.searchBaseStrategyIndices.size > 0)
                ? Array.from(state.searchBaseStrategyIndices)
                : (customConfig.fixedIndices || Array.from(state.selectedPortfolioIndices)),
            metric_name: customConfig.metricName || dom.optimizationMetricSelect.options[dom.optimizationMetricSelect.selectedIndex].text,
            search_threshold: dom.searchThresholdInput ? parseInt(dom.searchThresholdInput.value, 10) : 500000,
            use_all_dates: customConfig.useAllDates !== undefined ? customConfig.useAllDates : true,
            search_method: customConfig.searchMethod || 'auto',

            // Normalization
            normalization_metric: customConfig.normalizationEnabled ? customConfig.normalizationMetric : null,
            normalization_target: customConfig.normalizationEnabled ? customConfig.normalizationTarget : null,

            // Custom Optimization
            cagr_scaling_metric: customConfig.cagrScalingEnabled ? customConfig.cagrScalingMetric : null,
            cagr_scaling_operator: customConfig.cagrScalingEnabled ? customConfig.cagrScalingOperator : 'multiply'
        }
    };

    // --- Dynamic Column Visibility Logic ---
    console.log('[DEBUG DATABANK] Checking column visibility for optimization metrics...');
    if (customConfig.cagrScalingEnabled) {
        // Show CAGR, the scaled metric, AND the resulting custom score
        ensureColumnVisible('cagr');
        ensureColumnVisible('cagr_custom_score');
        if (customConfig.cagrScalingMetric) {
            ensureColumnVisible(customConfig.cagrScalingMetric);
        }
    } else {
        // Show standard optimization metric
        const mainMetricKey = requestBody.params.metric_to_optimize_key;
        if (mainMetricKey) {
            ensureColumnVisible(mainMetricKey);
        }
        // User requested Optimized Score to be visible and at the start
        ensureColumnVisible('cagr_custom_score');
    }
    // ---------------------------------------

    console.log('[DEBUG DATABANK] Starting search with maxSize:', requestBody.params.max_size, 'Base Indices:', requestBody.params.base_indices);

    // Save configuration to state for global access (e.g. UI checks for normalization)
    state.currentOptimizationData = {
        ...requestBody.params,
        normalizationEnabled: customConfig.normalizationEnabled // Ensure boolean is strictly saved
    };

    try {
        const response = await fetch('/databank/find-portfolios-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error("El backend no pudo iniciar el proceso de streaming.");
        }

        console.log("Conexión de streaming establecida. Escuchando resultados...");
        setDatabankStatus('searching', 'Escuchando resultados del backend...');

        let searchMode = ''; // Variable para almacenar el modo de búsqueda

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = ''; // Buffer para acumular datos del stream

        // Usamos un bucle 'while' en lugar de recursión para evitar el desbordamiento de la pila (stack overflow)
        async function processStream() {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    setDatabankStatus('completed', 'Búsqueda completada');
                    // Re-habilitar botones
                    if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.disabled = false;
                    if (dom.clearDatabankBtn) dom.clearDatabankBtn.disabled = false;
                    if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
                    if (dom.pauseSearchBtn) dom.pauseSearchBtn.disabled = true;
                    if (dom.stopSearchBtn) dom.stopSearchBtn.disabled = true;
                    break; // Salir del bucle
                }

                // Añadir el nuevo trozo de datos al buffer
                buffer += decoder.decode(value, { stream: true });

                // Buscar mensajes completos en el buffer (delimitados por '\n\n')
                let boundary = buffer.indexOf('\n\n');
                while (boundary !== -1) {
                    const message = buffer.substring(0, boundary);
                    buffer = buffer.substring(boundary + 2); // Eliminar el mensaje procesado del buffer

                    if (message.startsWith('data:')) {
                        const jsonData = message.substring(5).trim(); // Eliminar 'data: '
                        if (!jsonData) continue;

                        try {
                            const data = JSON.parse(jsonData);

                            if (data.status === 'info' || data.status === 'progress') {
                                if (!searchMode) {
                                    if (data.message.toLowerCase().includes('monte carlo')) searchMode = '[Monte Carlo]';
                                    else if (data.message.toLowerCase().includes('exhaustiva')) searchMode = '[Exhaustiva]';
                                }
                                setDatabankStatus('searching', data.message);

                                // Mostrar advertencias importantes como errores persistentes
                                if (data.message.startsWith('⚠️')) {
                                    // Ignorar advertencias de correlación para no spamear la UI (el usuario ya lo ve en el status)
                                    if (!data.message.toLowerCase().includes('correlación')) {
                                        displayError(data.message, 10000); // Mostrar por 10 segundos
                                    } else {
                                        console.warn("[Backend Warning]", data.message);
                                    }
                                }
                            } else if (data.status === 'paused') {
                                dom.pauseSearchBtn.textContent = 'Reanudar';
                                // Mantener Stop habilitado durante la pausa
                                setDatabankStatus('paused', data.message);
                            } else if (data.status === 'resumed') {
                                dom.pauseSearchBtn.textContent = 'Pausar';
                                setDatabankStatus('searching', data.message);
                            } else if (data.status === 'stopped') {
                                dom.stopSearchBtn.disabled = true;
                                dom.pauseSearchBtn.disabled = true;
                                dom.pauseSearchBtn.textContent = 'Pausar';
                                setDatabankStatus('stopped', data.message);
                            } else if (data.status === 'error') {
                                displayError(data.message);
                                setDatabankStatus('error', 'Error en la búsqueda');
                                // Re-habilitar botones
                                if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.disabled = false;
                                if (dom.clearDatabankBtn) dom.clearDatabankBtn.disabled = false;
                                if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
                                if (dom.pauseSearchBtn) dom.pauseSearchBtn.disabled = true;
                                if (dom.stopSearchBtn) dom.stopSearchBtn.disabled = true;
                                reader.cancel(); // Detener la lectura del stream
                            } else if (data.status === 'completed') {
                                setDatabankStatus('completed', 'Búsqueda completada');
                                // Re-habilitar botones
                                if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.disabled = false;
                                if (dom.clearDatabankBtn) dom.clearDatabankBtn.disabled = false;
                                if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
                                if (dom.pauseSearchBtn) dom.pauseSearchBtn.disabled = true;
                                if (dom.stopSearchBtn) dom.stopSearchBtn.disabled = true;
                                reader.cancel();
                            } else {
                                const newPortfolio = data;
                                console.log("[DEBUG DATABANK] Received portfolio candidate:", newPortfolio);
                                if (newPortfolio.metrics && newPortfolio.metrics.cagr_custom_score !== undefined) {
                                    console.log(`[DataBank] Portfolio cagr_custom_score: ${newPortfolio.metrics.cagr_custom_score}`);
                                } else {
                                    console.log(`[DataBank] Portfolio metrics:`, newPortfolio.metrics);
                                }
                                if (!newPortfolio.name && newPortfolio.indices) newPortfolio.name = newPortfolio.indices.map(i => state.loadedStrategyFiles[i]?.name.replace('.csv', '') || `Estrat. ${i + 1}`).join(', ');
                                console.log("[DEBUG DATABANK] Attempting to add to databank...");
                                addToDatabankIfBetter(newPortfolio, parseInt(dom.databankSizeInput?.value || 20, 10));
                                // Throttle: Solo actualizar la UI cada 500ms para mantenerla responsive
                                if (!window.databankUpdateScheduled) {
                                    window.databankUpdateScheduled = true;
                                    setTimeout(() => {
                                        updateDatabankDisplay();
                                        window.databankUpdateScheduled = false;
                                    }, 500);
                                }
                            }
                        } catch (e) {
                            console.error("Error al parsear JSON del stream:", e, "Datos recibidos:", jsonData);
                        }
                    }
                    boundary = buffer.indexOf('\n\n'); // Buscar el siguiente mensaje
                }
            }
        }
        await processStream(); // Inicia la lectura del stream y espera a que termine (o falle)

    } catch (error) {
        console.error("Error iniciando la búsqueda en DataBank:", error);
        displayError(error.message || "Ocurrió un error al conectar con el backend.");
        setDatabankStatus('error', 'Error de conexión con el backend');
        // Re-habilitar botones
        if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.disabled = false;
        if (dom.clearDatabankBtn) dom.clearDatabankBtn.disabled = false;
        if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
        if (dom.pauseSearchBtn) dom.pauseSearchBtn.disabled = true;
        if (dom.stopSearchBtn) dom.stopSearchBtn.disabled = true;
    }
};

/**
 * Añade un portafolio al DataBank si es mejor que los existentes.
 */
const addToDatabankIfBetter = (portfolioData, maxSize) => {
    // Esta función se asegura de que el DataBank solo contenga la mejor versión de cada
    // combinación de estrategias única, evitando duplicados.

    const { indices, metricValue, optimizationGoal } = portfolioData;
    const key = indices.sort((a, b) => a - b).join(',');

    const existingIndex = state.databankPortfolios.findIndex(p => p.key === key);

    if (existingIndex > -1) {
        const existingPortfolio = state.databankPortfolios[existingIndex];
        const isNewBetter = (optimizationGoal === 'maximize')
            ? metricValue > existingPortfolio.metricValue
            : metricValue < existingPortfolio.metricValue;

        if (isNewBetter) {
            state.databankPortfolios[existingIndex] = { ...portfolioData, key };
        } else {
            return;
        }
    } else {
        state.databankPortfolios.push({ ...portfolioData, key });
    }

    state.databankPortfolios.sort((a, b) => {
        const valA = isFinite(a.metricValue) ? a.metricValue : (optimizationGoal === 'maximize' ? -Infinity : Infinity);
        const valB = isFinite(b.metricValue) ? b.metricValue : (optimizationGoal === 'maximize' ? -Infinity : Infinity);
        return optimizationGoal === 'maximize' ? valB - valA : valA - valB;
    });

    if (state.databankPortfolios.length > maxSize) {
        state.databankPortfolios = state.databankPortfolios.slice(0, maxSize);
        console.log(`[DEBUG DATABANK] Sliced to maxSize (${maxSize}). New count: ${state.databankPortfolios.length}`);
    } else {
        console.log(`[DEBUG DATABANK] Portfolio added/updated. Current count: ${state.databankPortfolios.length} (Max: ${maxSize})`);
    }
};

/**
 * Actualiza la tabla del DataBank en la UI.
 */
export const updateDatabankDisplay = () => {
    updateDatabankCount();

    // Initialize table if needed
    initDatabankTable();

    if (state.databankPortfolios.length === 0) {
        dom.databankEmptyRow.classList.remove('hidden');
        dom.databankTableBody.innerHTML = '';
        dom.databankTableBody.appendChild(dom.databankEmptyRow);
        dom.databankTableHeader.innerHTML = '';
        return;
    }

    dom.databankEmptyRow.classList.add('hidden');

    // Get custom column configuration
    const config = getDatabankTableConfig();
    const visibleColumns = config.visibleColumns;

    // 2. Render Headers
    dom.databankTableHeader.innerHTML = '';
    const headerRow = document.createElement('tr');

    // Checkbox header
    const thCheckbox = document.createElement('th');
    thCheckbox.className = 'px-4 py-3 w-8 text-left text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10';
    thCheckbox.innerHTML = '<input type="checkbox" id="databank-select-all" class="form-checkbox h-4 w-4 bg-gray-800 border-gray-600 rounded text-sky-500 focus:ring-sky-600">';
    headerRow.appendChild(thCheckbox);

    // Rank header
    const thRank = document.createElement('th');
    thRank.className = 'px-4 py-3 w-12 text-left text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10 relative group select-none cursor-pointer hover:text-white transition-colors';
    if (state.databankSortConfig.key === 'metricValue') {
        thRank.className += ' text-blue-400';
    }
    const rankLabel = 'Rank' + (state.databankSortConfig.key === 'metricValue' ? (state.databankSortConfig.order === 'asc' ? ' ▲' : ' ▼') : '');
    thRank.textContent = rankLabel;
    thRank.dataset.sortKey = 'metricValue';

    // Resizer
    const rankResizer = document.createElement('div');
    rankResizer.className = 'absolute right-0 top-0 bottom-0 w-1 cursor-col-resize bg-gray-600 hover:bg-blue-500 transition-colors';
    rankResizer.addEventListener('mousedown', initDatabankResize);
    thRank.appendChild(rankResizer);
    headerRow.appendChild(thRank);

    // Data columns
    visibleColumns.forEach(key => {
        const colInfo = ALL_METRICS[key];
        if (!colInfo) return;

        const th = document.createElement('th');
        th.className = 'px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10 relative group select-none cursor-pointer hover:text-white transition-colors';

        const isSorting = state.databankSortConfig.key === key;
        if (isSorting) {
            th.className += ' text-blue-400';
        }

        const label = colInfo.label + (isSorting ? (state.databankSortConfig.order === 'asc' ? ' ▲' : ' ▼') : '');
        th.textContent = label;
        th.dataset.sortKey = key;
        th.dataset.colId = key;
        if (key === 'metricValue') {
            th.id = 'databank-metric-header';
        }

        // Apply saved width OR auto-fit if first time
        if (config.columnWidths && config.columnWidths[key]) {
            th.style.width = config.columnWidths[key];
            th.style.minWidth = config.columnWidths[key];
        } else {
            // First time: auto-fit after table is rendered
            // Special case: name column has max-width limit (contains multiple strategy names)
            if (key === 'name') {
                th.style.maxWidth = '300px';
                th.style.width = '300px';
                th.style.minWidth = '200px';
                // Save this default width
                if (!config.columnWidths) config.columnWidths = {};
                config.columnWidths[key] = '300px';
                localStorage.setItem('databankTableConfig_v6', JSON.stringify(config));
            } else {
                setTimeout(() => autoFitDatabankColumn(th, key), 0);
            }
        }



        // Click to sort
        th.addEventListener('click', (e) => {
            if (e.target.classList.contains('cursor-col-resize')) return;
            sortDatabank(th);
        });

        // Resizer
        const resizer = document.createElement('div');
        resizer.className = 'absolute right-0 top-0 bottom-0 w-1 cursor-col-resize bg-gray-600 hover:bg-blue-500 transition-colors';
        resizer.addEventListener('mousedown', initDatabankResize);
        resizer.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            autoFitDatabankColumn(th, key);
        });
        th.appendChild(resizer);
        headerRow.appendChild(th);
    });

    // Action header
    const thAction = document.createElement('th');
    thAction.className = 'px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10';
    thAction.textContent = 'Acción';
    headerRow.appendChild(thAction);

    dom.databankTableHeader.appendChild(headerRow);

    const metricHeader = document.getElementById('databank-metric-header');

    let html = '';
    const rankColors = ['bg-amber-400', 'bg-slate-300', 'bg-yellow-600'];

    state.databankPortfolios.forEach((p, index) => {
        if (index === 0) {
            // Debugging removed
        }
        let rowClass = (index < 3 && state.databankSortConfig.key === 'metricValue') ? 'databank-top3' : '';
        const selectionIndex = state.selectedRows.databank.indexOf(index);
        if (selectionIndex !== -1) {
            rowClass = SELECTION_COLORS[selectionIndex % SELECTION_COLORS.length];
        }

        let rankBadge = `<span class="font-bold">${index + 1}</span>`;
        if (index < 3 && state.databankSortConfig.key === 'metricValue') {
            rankBadge = `<span class="inline-block text-xs py-0.5 px-2 ${rankColors[index]} text-gray-900 rounded-full font-bold">#${index + 1}</span>`;
        }

        html += `<tr class="${rowClass} hover:bg-gray-700/50 transition-colors cursor-pointer border-b border-gray-700 last:border-0" data-row-type="databank" data-row-index="${index}">
                <td class="px-4 py-3"><input type="checkbox" data-index="${index}" class="databank-row-checkbox form-checkbox h-4 w-4 bg-gray-800 border-gray-600 rounded text-sky-500 focus:ring-sky-600"></td>
                <td class="px-4 py-3 text-center">${rankBadge}</td>`;

        visibleColumns.forEach(key => {
            // Safety check: ensure column exists in definition to match header rendering
            const colInfo = ALL_METRICS[key];
            if (!colInfo) return;

            if (key === 'name') {
                let constructedName = p.name;
                if (!constructedName && p.indices) {
                    constructedName = p.indices.map(i => state.loadedStrategyFiles[i]?.name || `Estrat ${i + 1}`).join(', ');
                }
                // Compact View: Single line with ellipsis, full list in tooltip
                const count = p.indices ? p.indices.length : 0;
                const shortText = `${count} Estrategias: ${constructedName}`;
                html += `<td class="px-4 py-3 text-gray-300 max-w-xs truncate" title="${constructedName}">
                            <div class="truncate text-sm">${shortText}</div>
                         </td>`;
            } else {
                // Get value from metrics or analysis.metrics
                let value;
                if (key === 'metricValue') {
                    value = p.metricValue;
                } else if (key === 'strategyCount') {
                    value = p.indices ? p.indices.length : 0;
                    // console.log(`[DEBUG] Row ${index} - strategyCount:`, value, 'Indices:', p.indices);
                } else if (key === 'returnDD') {
                    // Mapping for Ret/DD
                    const metrics = p.metrics || p.analysis?.metrics || p.analysis || {};
                    value = metrics['profitMaxDD_Ratio'];
                } else if (key === 'cagr_custom_score') {
                    // Fallback to metricValue (Optimization Goal) if specific custom score is missing
                    value = p.metrics?.[key] ?? p.analysis?.metrics?.[key] ?? p.metricValue;
                } else {
                    value = p.metrics?.[key] ?? p.analysis?.metrics?.[key] ?? p.analysis?.[key];
                }

                if (index === 0) {
                    // console.log(`[DEBUG FRONTEND] Col '${key}': Value extracted:`, value);
                }

                html += `<td class="px-4 py-3 text-gray-300 text-right whitespace-nowrap">${formatMetricForDisplay(value, key)}</td>`;
            }
        });


        // Add action column
        html += `<td class="px-4 py-3 text-center sticky right-0 bg-gray-800 z-10 whitespace-nowrap">
                    <button class="view-strategy-risk-btn text-gray-400 hover:text-sky-400 text-lg px-1 mr-2" title="Ver Riesgo Base" data-index="${index}" data-source="databank">👁️</button>
                    <button class="databank-save-single-btn bg-sky-700 hover:bg-sky-800 text-white font-bold py-1 px-2 rounded text-xs" data-index="${index}">Guardar</button>
                 </td></tr>`;
    });
    dom.databankTableBody.innerHTML = html;

    const firstPortfolio = state.databankPortfolios[0];
    if (metricHeader && firstPortfolio && firstPortfolio.metricName) {
        metricHeader.textContent = firstPortfolio.metricName;
    }
};

// Make globally accessible for databankTable modal
window.updateDatabankDisplay = updateDatabankDisplay;

// Auto-fit column to content
// Auto-fit column to content
function autoFitDatabankColumn(th, colId) {
    const tableBody = dom.databankTableBody;
    if (!tableBody) return;

    const rows = tableBody.querySelectorAll('tr');
    let maxWidth = 50;

    const tempSpan = document.createElement('span');
    tempSpan.style.visibility = 'hidden';
    tempSpan.style.position = 'absolute';
    tempSpan.style.whiteSpace = 'nowrap';
    tempSpan.className = 'px-4 py-3 text-xs';
    document.body.appendChild(tempSpan);

    // Measure header
    tempSpan.textContent = th.textContent;
    maxWidth = Math.max(maxWidth, tempSpan.offsetWidth + 20);

    // Measure cells
    const config = getDatabankTableConfig();
    const colIndex = config.visibleColumns.indexOf(colId) + 2; // +2 for checkbox and rank

    rows.forEach(row => {
        const cell = row.children[colIndex];
        if (cell) {
            tempSpan.textContent = cell.textContent;
            maxWidth = Math.max(maxWidth, tempSpan.offsetWidth);
        }
    });

    document.body.removeChild(tempSpan);

    const newWidth = maxWidth + 'px';
    th.style.width = newWidth;
    th.style.minWidth = newWidth;

    const tableConfig = getDatabankTableConfig();
    if (!tableConfig.columnWidths) tableConfig.columnWidths = {};
    tableConfig.columnWidths[colId] = newWidth;
    localStorage.setItem('databankTableConfig', JSON.stringify(tableConfig));
}

/**
 * Initialize Focus Mode listeners for DataBank
 */
export const initDatabankFocus = () => {
    if (!dom.databankTableBody) return;

    dom.databankTableBody.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        if (!row) return;

        // Ignore if clicking on checkbox or buttons
        if (e.target.closest('input[type="checkbox"]') || e.target.closest('button')) return;

        const index = row.dataset.rowIndex;
        if (index !== undefined) {
            const portfolio = state.databankPortfolios[index];
            if (portfolio) {
                focusMode.enable(portfolio, 'databank', row);
            }
        }
    });
};

// Resizer functionality (copied from Strategies)
let databankResizeData = null;

function initDatabankResize(e) {
    databankResizeData = {
        th: e.target.parentElement,
        startX: e.pageX,
        startWidth: e.target.parentElement.offsetWidth
    };
    document.addEventListener('mousemove', doDatabankResize);
    document.addEventListener('mouseup', stopDatabankResize);
    e.preventDefault();
}

function doDatabankResize(e) {
    if (!databankResizeData) return;
    const delta = e.pageX - databankResizeData.startX;
    const newWidth = Math.max(50, databankResizeData.startWidth + delta);
    databankResizeData.th.style.width = newWidth + 'px';
    databankResizeData.th.style.minWidth = newWidth + 'px';
}

function stopDatabankResize() {
    if (databankResizeData) {
        const colId = databankResizeData.th.dataset.colId || databankResizeData.th.dataset.sortKey;
        const newWidth = databankResizeData.th.style.width;

        const config = getDatabankTableConfig();
        if (!config.columnWidths) config.columnWidths = {};
        config.columnWidths[colId] = newWidth;
        localStorage.setItem('databankTableConfig', JSON.stringify(config));

        databankResizeData = null;
    }
    document.removeEventListener('mousemove', doDatabankResize);
    document.removeEventListener('mouseup', stopDatabankResize);
}



/**
 * Ordena la tabla del DataBank.
 */
// Make globally accessible
window.renderBaseStrategiesConfig = renderBaseStrategiesConfig;

/**
 * Renders the configuration panel for Base Strategies (Locked/Fixed)
 */
export function renderBaseStrategiesConfig() {
    // 1. Find or Create Container
    // We want to insert it before the "Find Portfolios" button or controls area.
    // Let's assume there is a container holding the search button.
    const searchBtn = document.getElementById('find-databank-portfolios-btn');
    if (!searchBtn) return;

    const parentContainer = searchBtn.closest('.flex.flex-wrap') || searchBtn.parentElement;
    let configContainer = document.getElementById('base-strategies-config-container');

    if (state.searchBasePortfolioIndex === null) {
        if (configContainer) configContainer.classList.add('hidden');
        return;
    }

    if (!configContainer) {
        configContainer = document.createElement('div');
        configContainer.id = 'base-strategies-config-container';
        configContainer.className = 'w-full bg-slate-800/50 border border-slate-700 rounded p-3 mb-4 mt-2';
        parentContainer.insertBefore(configContainer, parentContainer.firstChild); // Insert at top of controls
    }

    configContainer.classList.remove('hidden');

    // 2. Get Portfolio Data
    const portfolio = state.savedPortfolios[state.searchBasePortfolioIndex];
    if (!portfolio) {
        configContainer.classList.add('hidden');
        return;
    }

    // 3. Render Content
    let strategiesListHTML = '';

    // Use indices approach for rendering logic
    // We already resolved indices into state.searchBaseStrategyIndices
    // But we need to map them back to names/files to show checks

    // Get ALL strategies that were originally in the portfolio (even if unchecked now, we need to show them)
    // We can iterate state.loadedStrategyFiles and check if they are in the 'original' set.
    // BUT we didn't store the 'original set' separately from the 'active set'.
    // We should re-derive the list from the portfolio object every time, 
    // but check the state.searchBaseStrategyIndices for the checked state.

    let potentialIndices = [];
    if (portfolio.strategyIds && portfolio.strategyIds.length > 0) {
        portfolio.strategyIds.forEach(id => {
            const idx = state.loadedStrategyFiles.findIndex(f => f.strategyId === id);
            if (idx !== -1) potentialIndices.push(idx);
        });
    } else if (portfolio.indices) {
        potentialIndices = portfolio.indices;
    }

    potentialIndices.forEach(idx => {
        const file = state.loadedStrategyFiles[idx];
        if (!file) return;

        const isChecked = state.searchBaseStrategyIndices.has(idx);

        strategiesListHTML += `
            <label class="flex items-center space-x-2 text-xs bg-slate-900/50 p-1.5 rounded cursor-pointer hover:bg-slate-700 transition-colors">
                <input type="checkbox" 
                       class="form-checkbox h-3 w-3 text-sky-500 rounded border-gray-600 bg-gray-800 focus:ring-sky-600 base-strategy-checkbox" 
                       value="${idx}"
                       ${isChecked ? 'checked' : ''}>
                <span class="truncate max-w-[150px] text-gray-300" title="${file.name}">${file.name.replace('.csv', '')}</span>
            </label>
        `;
    });

    configContainer.innerHTML = `
        <div class="flex items-center justify-between mb-2 border-b border-slate-700/50 pb-1">
            <h4 class="text-xs font-semibold text-sky-400 flex items-center gap-2">
                <span>🛡️ Base Team: ${portfolio.name}</span>
                <span class="text-[10px] text-gray-500 font-normal">(${state.searchBaseStrategyIndices.size} locked)</span>
            </h4>
            <button class="text-[10px] text-gray-400 hover:text-white hover:bg-red-900/30 px-2 rounded" onclick="window.clearBasePortfolioSelection()">
                Clear Selection
            </button>
        </div>
        <div class="flex flex-wrap gap-2 max-h-[100px] overflow-y-auto custom-scrollbar">
            ${strategiesListHTML}
        </div>
        <div class="mt-2 text-[10px] text-gray-500 italic">
            * Selected strategies will be locked in the search. Uncheck to treat them as optional candidates.
        </div>
    `;

    // Add listeners
    const checkboxes = configContainer.querySelectorAll('.base-strategy-checkbox');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', (e) => {
            const idx = parseInt(e.target.value, 10);
            if (e.target.checked) {
                state.searchBaseStrategyIndices.add(idx);
            } else {
                state.searchBaseStrategyIndices.delete(idx);
            }
            // Re-render to update counts? Or just update UI count text.
            // Re-render is safer for counts.
            renderBaseStrategiesConfig();
        });
    });
}

// Helper to clear selection from UI
window.clearBasePortfolioSelection = () => {
    state.searchBasePortfolioIndex = null;
    state.searchBaseStrategyIndices.clear();

    // Uncheck radio buttons
    const radios = document.querySelectorAll('input[name="base-portfolio-select"]');
    radios.forEach(r => r.checked = false);

    renderBaseStrategiesConfig();

    if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.classList.add('hidden');
};

export const sortDatabank = (headerEl) => {
    const isRunning = dom.findDatabankPortfoliosBtn.disabled && !state.isSearchPaused && !state.isSearchStopped;
    if (isRunning) return;

    const sortKey = headerEl.dataset.sortKey;
    if (!sortKey) return;

    let newOrder;
    if (state.databankSortConfig.key === sortKey) {
        newOrder = state.databankSortConfig.order === 'asc' ? 'desc' : 'asc';
    } else {
        const metricsToMinimize = ['maxDrawdown', 'maxDrawdownInDollars', 'maxStagnationTrades', 'maxConsecutiveLosses', 'avgLoss', 'downsideCapture', 'maxConsecutiveLosingMonths'];
        newOrder = metricsToMinimize.includes(sortKey) ? 'asc' : 'desc';
    }

    if (sortKey === 'metricValue') {
        const optimizationGoal = state.databankPortfolios[0]?.optimizationGoal || dom.optimizationGoalSelect.value;
        if (state.databankSortConfig.key !== 'metricValue') {
            newOrder = (optimizationGoal === 'maximize') ? 'desc' : 'asc';
        }
    }

    state.databankSortConfig.key = sortKey;
    state.databankSortConfig.order = newOrder;

    document.querySelectorAll('#databank-table-header th.sortable').forEach(th => th.removeAttribute('data-order'));
    headerEl.dataset.order = newOrder;

    state.databankPortfolios.sort((a, b) => {
        let valA, valB;
        if (sortKey === 'name') { valA = a.name || ''; valB = b.name || ''; }
        else if (sortKey === 'metricValue') { valA = a.metricValue; valB = b.metricValue; }
        else if (sortKey === 'strategyCount') { valA = a.indices ? a.indices.length : 0; valB = b.indices ? b.indices.length : 0; }
        else { valA = a.metrics[sortKey]; valB = b.metrics[sortKey]; }

        if (typeof valA === 'number') {
            const goal = (newOrder === 'desc') ? 'maximize' : 'minimize';
            valA = isFinite(valA) ? valA : (goal === 'maximize' ? -Infinity : Infinity);
            valB = isFinite(valB) ? valB : (goal === 'maximize' ? -Infinity : Infinity);
        }

        if (valA < valB) return state.databankSortConfig.order === 'asc' ? -1 : 1;
        if (valA > valB) return state.databankSortConfig.order === 'asc' ? 1 : -1;
        return 0;
    });

    updateDatabankDisplay();
};

// This code block is assumed to be part of a function that initiates the databank search,
// such as `findDatabankPortfolios` or similar, and is placed here based on the user's instruction
// to restore the streaming implementation.
// It is placed before `clearDatabank` as it's a new top-level export or function.
// 2. Realizar la petición POST para iniciar el stream en el backend
// Usamos fetch solo para enviar los datos y disparar el proceso
// This block is likely part of an async function, e.g., `export const findDatabankPortfolios = async () => { ... }`
// For the purpose of this edit, it's inserted as a standalone block as per the instruction's context.
/*
    try {
        const response = await fetch('/databank/find-portfolios-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody) // `requestBody` would need to be defined in the actual function
        });

        if (!response.ok) {
            throw new Error("El backend no pudo iniciar el proceso de streaming.");
        }

        console.log("Conexión de streaming establecida. Escuchando resultados...");
        setDatabankStatus('searching', 'Escuchando resultados del backend...');

        let searchMode = ''; // Variable para almacenar el modo de búsqueda

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = ''; // Buffer para acumular datos del stream

        // Usamos un bucle 'while' en lugar de recursión para evitar el desbordamiento de la pila (stack overflow)
        async function processStream() {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    setDatabankStatus('completed', 'Búsqueda completada');
                    // Re-habilitar botones
                    if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.disabled = false;
                    if (dom.clearDatabankBtn) dom.clearDatabankBtn.disabled = false;
                    if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
                    if (dom.pauseSearchBtn) dom.pauseSearchBtn.disabled = true;
                    if (dom.stopSearchBtn) dom.stopSearchBtn.disabled = true;
                    break; // Salir del bucle
                }

                // Añadir el nuevo trozo de datos al buffer
                buffer += decoder.decode(value, { stream: true });

                // Buscar mensajes completos en el buffer (delimitados por '\n\n')
                let boundary = buffer.indexOf('\n\n');
                while (boundary !== -1) {
                    const message = buffer.substring(0, boundary);
                    buffer = buffer.substring(boundary + 2); // Eliminar el mensaje procesado del buffer

                    if (message.startsWith('data:')) {
                        const jsonData = message.substring(5).trim(); // Eliminar 'data: '
                        if (!jsonData) continue;

                        try {
                            const data = JSON.parse(jsonData);

                            if (data.status === 'info' || data.status === 'progress') {
                                if (!searchMode) {
                                    if (data.message.toLowerCase().includes('monte carlo')) searchMode = '[Monte Carlo]';
                                    else if (data.message.toLowerCase().includes('exhaustiva')) searchMode = '[Exhaustiva]';
                                }
                                setDatabankStatus('searching', data.message);
                            } else if (data.status === 'paused') {
                                dom.pauseSearchBtn.textContent = 'Reanudar';
                                // Mantener Stop habilitado durante la pausa
                                setDatabankStatus('paused', data.message);
                            } else if (data.status === 'resumed') {
                                dom.pauseSearchBtn.textContent = 'Pausar';
                                setDatabankStatus('searching', data.message);
                            } else if (data.status === 'stopped') {
                                dom.stopSearchBtn.disabled = true;
                                dom.pauseSearchBtn.disabled = true;
                                dom.pauseSearchBtn.textContent = 'Pausar';
                                setDatabankStatus('stopped', data.message);
                            } else if (data.status === 'error') {
                                displayError(data.message); // `displayError` would need to be defined
                                setDatabankStatus('error', 'Error en la búsqueda');
                                // Re-habilitar botones
                                if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.disabled = false;
                                if (dom.clearDatabankBtn) dom.clearDatabankBtn.disabled = false;
                                if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
                                if (dom.pauseSearchBtn) dom.pauseSearchBtn.disabled = true;
                                if (dom.stopSearchBtn) dom.stopSearchBtn.disabled = true;
                                reader.cancel(); // Detener la lectura del stream
                            } else if (data.status === 'completed') {
                                setDatabankStatus('completed', 'Búsqueda completada');
                                // Re-habilitar botones
                                if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.disabled = false;
                                if (dom.clearDatabankBtn) dom.clearDatabankBtn.disabled = false;
                                if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
                                if (dom.pauseSearchBtn) dom.pauseSearchBtn.disabled = true;
                                if (dom.stopSearchBtn) dom.stopSearchBtn.disabled = true;
                                reader.cancel();
                            } else {
                                const newPortfolio = data;
                                if (!newPortfolio.name && newPortfolio.indices) newPortfolio.name = newPortfolio.indices.map(i => state.loadedStrategyFiles[i]?.name.replace('.csv', '') || `Estrat. ${i + 1}`).join(', ');
                                addToDatabankIfBetter(newPortfolio, parseInt(dom.databankSizeInput?.value || 20, 10)); // `addToDatabankIfBetter` would need to be defined
                                // Throttle: Solo actualizar la UI cada 500ms para mantenerla responsive
                                if (!window.databankUpdateScheduled) {
                                    window.databankUpdateScheduled = true;
                                    setTimeout(() => {
                                        updateDatabankDisplay();
                                        window.databankUpdateScheduled = false;
                                    }, 500);
                                }
                            }
                        } catch (e) {
                            console.error("Error al parsear JSON del stream:", e, "Datos recibidos:", jsonData);
                        }
                    }
                    boundary = buffer.indexOf('\n\n'); // Buscar el siguiente mensaje
                }
            }
        }
        processStream(); // Inicia la lectura del stream
    } catch (error) {
        console.error("Error al iniciar el stream de búsqueda:", error);
        displayError("Error al iniciar la búsqueda de portafolios: " + error.message);
        setDatabankStatus('error', 'Error al iniciar la búsqueda');
        // Re-habilitar botones
        if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.disabled = false;
        if (dom.clearDatabankBtn) dom.clearDatabankBtn.disabled = false;
        if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
        if (dom.pauseSearchBtn) dom.pauseSearchBtn.disabled = true;
        if (dom.stopSearchBtn) dom.stopSearchBtn.disabled = true;
    }
*/

/**
 * Guarda un portafolio desde el DataBank a la lista de portafolios guardados.
 */
export const savePortfolioFromDatabank = (portfolioIndex, metrics) => {
    const portfolio = state.databankPortfolios[portfolioIndex];
    if (!portfolio) return false;

    const isDuplicate = state.savedPortfolios.some(p =>
        p.indices.length === portfolio.indices.length &&
        p.indices.every(i => portfolio.indices.includes(i)) &&
        !p.weights
    );

    if (isDuplicate) {
        console.warn(`Portfolio ${portfolio.key} ya está guardado.`);
        return false;
    }

    const names = portfolio.indices.map(i => state.loadedStrategyFiles[i].name.replace('.csv', '')).join('+');
    const strategyIds = portfolio.indices.map(i => state.loadedStrategyFiles[i].strategyId);
    const strategyNames = portfolio.indices.map(i => state.loadedStrategyFiles[i].name.replace('.csv', ''));

    // Calculate SQ Metrics for persistence
    let allTrades = [];
    portfolio.indices.forEach(idx => {
        const file = state.loadedStrategyFiles[idx];
        if (file && file.content) {
            const trades = parseTradesFromContent(file.content);
            allTrades = allTrades.concat(trades);
        } else if (state.rawStrategiesData[idx]) {
            // Fallback: Use rawStrategiesData if content is missing
            const trades = parseTradesFromData(state.rawStrategiesData[idx]);
            allTrades = allTrades.concat(trades);
        }
    });
    allTrades.sort((a, b) => a.exitTime - b.exitTime);
    const sqMetrics = calculateSQMetrics(allTrades);

    state.savedPortfolios.push({
        name: `P-DB (${names}) ${portfolio.metricName}`,
        indices: portfolio.indices,
        strategyIds: strategyIds, // <--- SAVE STRATEGY IDs
        strategyNames: strategyNames, // <--- SAVE STRATEGY NAMES
        id: generatePortfolioId(`P-DB (${names})`, strategyIds),
        weights: null,
        metrics: portfolio.metrics || metrics, // Use passed metrics if available
        sqMetrics: sqMetrics, // <--- SAVE SQ METRICS
        comments: `Guardado desde DataBank. Métrica: ${portfolio.metricName} (${portfolio.metricValue.toFixed(2)})`
    });
    // Adjuntamos las métricas pre-calculadas para evitar re-análisis innecesario
    return true;
};

/**
 * Limpia el DataBank.
 */
export const clearDatabank = () => {
    state.databankPortfolios = [];
    state.isSearchPaused = false;
    state.isSearchStopped = false;
    setDatabankStatus('hidden');
    updateDatabankDisplay();
    // databankSection ya no existe en el nuevo layout
    if (dom.databankSection) dom.databankSection.classList.add('hidden');
};

// Eliminamos las importaciones de analysis.js que ya no se usan aquí
// import { processStrategyData, calculateCorrelationMatrix } from '../analysis.js';
// import { reAnalyzeAllData } from '../analysis.js';