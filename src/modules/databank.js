import { state } from '../state.js';
import { dom } from '../dom.js';
import { ALL_METRICS, SELECTION_COLORS } from '../config.js'; // ALL_METRICS y SELECTION_COLORS se siguen usando
import { hideError, displayError, toggleLoading, formatMetricForDisplay } from '../utils.js'; // Estas utilidades se siguen usando
import { initDatabankTable, getDatabankTableConfig } from './databankTable.js';

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
        benchmark_data: state.rawBenchmarkData,
        params: {
            metric_to_optimize_key: customConfig.metric || dom.optimizationMetricSelect.value,
            optimization_goal: customConfig.goal || dom.optimizationGoalSelect.value,
            correlation_threshold: customConfig.correlationThreshold !== undefined
                ? customConfig.correlationThreshold
                : parseFloat(dom.correlationFilterInput.value),
            max_size: customConfig.maxSize || (dom.databankSizeInput ? parseInt(dom.databankSizeInput.value, 10) : 20),
            base_indices: customConfig.fixedIndices || Array.from(state.selectedPortfolioIndices),
            metric_name: customConfig.metricName || dom.optimizationMetricSelect.options[dom.optimizationMetricSelect.selectedIndex].text,
            search_threshold: dom.searchThresholdInput ? parseInt(dom.searchThresholdInput.value, 10) : 500000, // Default: 500000
            use_all_dates: customConfig.useAllDates !== undefined ? customConfig.useAllDates : true,
            start_date: customConfig.startDate || null,
            end_date: customConfig.endDate || null
        }
    };

    // 2. Realizar la petición POST para iniciar el stream en el backend
    // Usamos fetch solo para enviar los datos y disparar el proceso
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
                            } else {
                                const newPortfolio = data;
                                if (!newPortfolio.name && newPortfolio.indices) newPortfolio.name = newPortfolio.indices.map(i => state.loadedStrategyFiles[i]?.name.replace('.csv', '') || `Estrat. ${i + 1}`).join(', ');
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
        processStream(); // Inicia la lectura del stream
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
    const tableConfig = getDatabankTableConfig();
    const visibleColumns = tableConfig.visibleColumns || [];

    let headerHTML = '<tr>';
    headerHTML += `<th class="px-4 py-3 w-8 align-bottom"><input type="checkbox" id="databank-select-all" class="form-checkbox h-4 w-4 bg-gray-800 border-gray-600 rounded text-sky-500 focus:ring-sky-600"></th>`;
    headerHTML += `<th class="px-4 py-3 w-12 sortable align-bottom" data-sort-key="metricValue" ${state.databankSortConfig.key === 'metricValue' ? `data-order="${state.databankSortConfig.order}"` : ''}>Rank</th>`;

    visibleColumns.forEach(key => {
        const colInfo = ALL_METRICS[key];
        if (colInfo) {
            const orderIndicator = state.databankSortConfig.key === key ? `data-order="${state.databankSortConfig.order}"` : '';
            const id = key === 'metricValue' ? 'id="databank-metric-header"' : '';
            if (key === 'name') {
                headerHTML += `<th class="${colInfo.class} sortable" ${id} data-sort-key="${key}" ${orderIndicator}>${colInfo.label}</th>`;
            } else {
                headerHTML += `<th class="${colInfo.class.replace('text-right', 'text-center')} sortable" ${id} data-sort-key="${key}" ${orderIndicator}><div class="corr-header">${colInfo.label}</div></th>`;
            }
        }
    });
    headerHTML += `<th class="px-4 py-3 text-center sticky right-0 bg-gray-700 z-20 align-bottom">Acción</th>`;
    headerHTML += '</tr>';
    dom.databankTableHeader.innerHTML = headerHTML;

    const metricHeader = document.getElementById('databank-metric-header');

    let html = '';
    const rankColors = ['bg-amber-400', 'bg-slate-300', 'bg-yellow-600'];

    state.databankPortfolios.forEach((p, index) => {
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
            if (key === 'name') {
                let constructedName = p.name;
                if (!constructedName && p.indices) {
                    constructedName = p.indices.map(i => state.loadedStrategyFiles[i]?.name || `Estrat ${i + 1}`).join(', ');
                }
                const names = (constructedName || '').split(', ').map(name => `<div class="copyable-strategy p-0.5 rounded-sm" title="Copiar '${name.replace('.csv', '')}'">${name.replace('.csv', '')}</div>`).join('');
                html += `<td class="px-4 py-3 text-gray-300 max-w-xs">${names}</td>`;
            } else {
                const value = key === 'metricValue' ? p.metricValue : p.metrics[key];
                html += `<td class="px-4 py-3 text-gray-300 text-right">${formatMetricForDisplay(value, key)}</td>`;
            }
        });

        html += `<td class="px-4 py-3 text-center sticky right-0 bg-gray-800 z-10"><button class="databank-save-single-btn bg-sky-700 hover:bg-sky-800 text-white font-bold py-1 px-2 rounded text-xs" data-index="${index}">Guardar</button></td></tr>`;
    });
    dom.databankTableBody.innerHTML = html;

    const firstPortfolio = state.databankPortfolios[0];
    if (metricHeader && firstPortfolio && firstPortfolio.metricName) {
        metricHeader.textContent = firstPortfolio.metricName;
    }
};

// Make globally accessible for databankTable modal
window.updateDatabankDisplay = updateDatabankDisplay;


/**
 * Ordena la tabla del DataBank.
 */
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

    const names = portfolio.indices.map(i => state.loadedStrategyFiles[i].name.replace('.csv', '').substring(0, 5)).join('+');

    state.savedPortfolios.push({
        name: `P-DB (${names}) ${portfolio.metricName}`,
        indices: portfolio.indices, // El ID se asigna aquí
        id: state.nextPortfolioId++,
        weights: null,
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