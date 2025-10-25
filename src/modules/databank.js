import { state } from '../state.js';
import { dom } from '../dom.js';
import { ALL_METRICS, SELECTION_COLORS } from '../config.js'; // ALL_METRICS y SELECTION_COLORS se siguen usando
import { hideError, displayError, toggleLoading, formatMetricForDisplay } from '../utils.js'; // Estas utilidades se siguen usando

/**
 * Inicia la búsqueda de portafolios en el DataBank.
 */
export const findDatabankPortfolios = async () => {
    if (state.rawStrategiesData.length < 2) {
        displayError("Necesitas al menos 2 estrategias cargadas para buscar portafolios.");
        return;
    }

    hideError();
    
    // Resetear el estado de la UI y los botones
    dom.databankSection.classList.remove('hidden');
    dom.pauseSearchBtn.disabled = false;
    dom.stopSearchBtn.disabled = false;
    dom.pauseSearchBtn.textContent = 'Pausar';
    toggleLoading(true, 'findDatabankPortfoliosBtn', 'findBestBtnText', 'findBestBtnSpinner');
    dom.clearDatabankBtn.disabled = true;
    if (dom.databankSizeInput) dom.databankSizeInput.disabled = true;

    state.databankPortfolios = [];
    updateDatabankDisplay(); // Limpia la tabla
    
    dom.databankStatus.innerHTML = `📡 Conectando con el backend de Python...`;

    // 1. Empaquetar los datos para la petición inicial
    const requestBody = {
        strategy_names: state.loadedStrategyFiles.map(f => f.name), // <-- Añadimos los nombres
        strategies_data: state.rawStrategiesData,
        benchmark_data: state.rawBenchmarkData,
        params: {
            metric_to_optimize_key: dom.optimizationMetricSelect.value,
            optimization_goal: dom.optimizationGoalSelect.value,
            correlation_threshold: parseFloat(dom.correlationFilterInput.value),
            max_size: parseInt(dom.databankSizeInput.value, 10),
            base_indices: Array.from(state.selectedPortfolioIndices),
            metric_name: dom.optimizationMetricSelect.options[dom.optimizationMetricSelect.selectedIndex].text,
            search_threshold: parseInt(dom.searchThresholdInput.value, 10),
        }
    };

    // 2. Realizar la petición POST para iniciar el stream en el backend
    // Usamos fetch solo para enviar los datos y disparar el proceso
    try {
        const response = await fetch('http://localhost:8001/databank/find-portfolios-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error("El backend no pudo iniciar el proceso de streaming.");
        }

        console.log("Conexión de streaming establecida. Escuchando resultados...");
        dom.databankStatus.innerHTML = `⏳ Escuchando resultados del backend...`;
        
        let searchMode = ''; // Variable para almacenar el modo de búsqueda

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        // Usamos un bucle 'while' en lugar de recursión para evitar el desbordamiento de la pila (stack overflow)
        async function processStream() {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    dom.databankStatus.innerHTML = `✅ Búsqueda completada por el backend.`;
                    toggleLoading(false, 'findDatabankPortfoliosBtn', 'findBestBtnText', 'findBestBtnSpinner');
                    dom.clearDatabankBtn.disabled = false;
                    if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
                    dom.pauseSearchBtn.disabled = true;
                    dom.stopSearchBtn.disabled = true;
                    break; // Salir del bucle
                }
                
                const chunk = decoder.decode(value);
                // Un stream puede contener varios eventos "data:"
                const events = chunk.split('\n\n').filter(e => e.startsWith('data:'));
                
                events.forEach(eventString => {
                    const jsonData = eventString.replace('data: ', '');
                    if (!jsonData) return;

                    const data = JSON.parse(jsonData);

                    if (data.status === 'info' || data.status === 'progress') {
                        // Determinar y almacenar el modo de búsqueda la primera vez que se recibe
                        if (!searchMode) {
                            if (data.message.toLowerCase().includes('monte carlo')) {
                                searchMode = '[Monte Carlo]';
                            } else if (data.message.toLowerCase().includes('exhaustiva')) {
                                searchMode = '[Exhaustiva]';
                            }
                        }
                        dom.databankStatus.innerHTML = `${searchMode} 🔍 ${data.message}`;
                    } else if (data.status === 'paused') {
                        dom.pauseSearchBtn.textContent = 'Reanudar';
                        dom.databankStatus.innerHTML = `${searchMode} ⏸️ ${data.message}`;
                    } else if (data.status === 'resumed') {
                        dom.pauseSearchBtn.textContent = 'Pausar';
                        dom.databankStatus.innerHTML = `${searchMode} ▶️ ${data.message}`;
                    } else if (data.status === 'stopped') {
                        dom.stopSearchBtn.disabled = true;
                        dom.pauseSearchBtn.disabled = true;
                        dom.pauseSearchBtn.textContent = 'Pausar';
                        dom.databankStatus.innerHTML = `${searchMode} ⏹️ ${data.message}`;
                    } else if (data.status === 'error') {
                        displayError(data.message);
                        dom.databankStatus.innerHTML = `❌ Error en la búsqueda.`;
                        toggleLoading(false, 'findDatabankPortfoliosBtn', 'findBestBtnText', 'findBestBtnSpinner');
                        dom.clearDatabankBtn.disabled = false;
                        if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
                        dom.pauseSearchBtn.disabled = true;
                        dom.stopSearchBtn.disabled = true;
                        reader.cancel(); // Detener la lectura del stream
                    } else if (data.status === 'completed') {
                        // El stream ha terminado, pero ya hemos mostrado el mensaje final en 'done'
                    } else {
                        // Es un objeto de portafolio
                        const newPortfolio = data;
                        if (!newPortfolio.name && newPortfolio.indices) { // Construir nombre si no viene
                            newPortfolio.name = newPortfolio.indices.map(i => state.loadedStrategyFiles[i]?.name.replace('.csv', '') || `Estrat. ${i+1}`).join(', ');
                        }
                        addToDatabankIfBetter(newPortfolio, parseInt(dom.databankSizeInput.value, 10));
                        updateDatabankDisplay();
                    }
                });
            }
        }
        processStream(); // Inicia la lectura del stream
    } catch (error) {
        console.error("Error iniciando la búsqueda en DataBank:", error);
        displayError(error.message || "Ocurrió un error al conectar con el backend.");
        dom.databankStatus.innerHTML = `❌ Error de conexión.`;
        toggleLoading(false, 'findDatabankPortfoliosBtn', 'findBestBtnText', 'findBestBtnSpinner');
        dom.clearDatabankBtn.disabled = false;
        if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
        dom.pauseSearchBtn.disabled = true;
        dom.stopSearchBtn.disabled = true;
    }
};

/**
 * Añade un portafolio al DataBank si es mejor que los existentes.
 */
const addToDatabankIfBetter = (portfolioData, maxSize) => {
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
    if (state.databankPortfolios.length === 0) {
        dom.databankEmptyRow.classList.remove('hidden');
        dom.databankTableBody.innerHTML = '';
        dom.databankTableBody.appendChild(dom.databankEmptyRow);
        dom.databankTableHeader.innerHTML = '';
        return;
    }

    dom.databankEmptyRow.classList.add('hidden');

    const activeViewColumns = state.tableViews.databank[state.activeViews.databank]?.columns || state.tableViews.databank['default'].columns;
    let headerHTML = '<tr>';
    headerHTML += `<th class="p-1.5 w-8 align-bottom"><input type="checkbox" id="databank-select-all" class="form-checkbox h-4 w-4 bg-gray-800 border-gray-600 rounded text-sky-500 focus:ring-sky-600"></th>`;
    headerHTML += `<th class="p-2 w-12 sortable align-bottom" data-sort-key="metricValue" ${state.databankSortConfig.key === 'metricValue' ? `data-order="${state.databankSortConfig.order}"` : ''}>Rank</th>`;
    
    activeViewColumns.forEach(key => {
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
    headerHTML += `<th class="p-2 text-center sticky right-0 bg-gray-700 z-20 align-bottom">Acción</th>`;
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

        html += `<tr class="${rowClass} hover:bg-gray-700/50 text-xs cursor-pointer" data-row-type="databank" data-row-index="${index}">
                <td class="p-2"><input type="checkbox" data-index="${index}" class="databank-row-checkbox form-checkbox h-4 w-4 bg-gray-800 border-gray-600 rounded text-sky-500 focus:ring-sky-600"></td>
                <td class="p-2 text-center">${rankBadge}</td>`;

        activeViewColumns.forEach(key => {
            if (key === 'name') {
                let constructedName = p.name;
                if (!constructedName && p.indices) {
                    constructedName = p.indices.map(i => state.loadedStrategyFiles[i]?.name || `Estrat ${i+1}`).join(', ');
                }
                const names = (constructedName || '').split(', ').map(name => `<div class="copyable-strategy p-0.5 rounded-sm" title="Copiar '${name.replace('.csv', '')}'">${name.replace('.csv', '')}</div>`).join('');
                html += `<td class="p-2 text-gray-300 max-w-xs">${names}</td>`;
            } else {
                const value = key === 'metricValue' ? p.metricValue : p.metrics[key];
                html += `<td class="p-2 text-right">${formatMetricForDisplay(value, key)}</td>`;
            }
        });

        html += `<td class="p-2 text-center sticky right-0 bg-gray-800 z-10"><button class="databank-save-single-btn bg-sky-700 hover:bg-sky-800 text-white font-bold py-1 px-2 rounded text-xs" data-index="${index}">Guardar</button></td></tr>`;
    });
    dom.databankTableBody.innerHTML = html;

    const firstPortfolio = state.databankPortfolios[0];
    if (metricHeader && firstPortfolio && firstPortfolio.metricName) {
        metricHeader.textContent = firstPortfolio.metricName;
    }
};

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
export const savePortfolioFromDatabank = (portfolioIndex) => {
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
        indices: portfolio.indices,
        id: state.nextPortfolioId++,
        weights: null,
        comments: `Guardado desde DataBank. Métrica: ${portfolio.metricName} (${portfolio.metricValue.toFixed(2)})`
    });
    return true;
};

/**
 * Limpia el DataBank.
 */
export const clearDatabank = () => {
    state.databankPortfolios = [];
    state.isSearchPaused = false;
    state.isSearchStopped = false;
    dom.databankStatus.innerHTML = 'DataBank limpiado.';
    updateDatabankDisplay();
    dom.databankSection.classList.add('hidden');
};

// Las siguientes funciones helper ya no son necesarias en el frontend
// porque la lógica de combinaciones y análisis se ha movido al backend.
// Se mantienen aquí para evitar errores de referencia si alguna parte del código
// aún las estuviera importando, pero deberían ser eliminadas si no se usan.

/*
function* getCombinations(arr, minSize = 2, maxSize = arr.length) { ... }
function* mapGenerator(generator, mapFn) { ... }
const countCombinations = (n, minSize, maxSize) => { ... };
*/

// Eliminamos las importaciones de analysis.js que ya no se usan aquí
// import { processStrategyData, calculateCorrelationMatrix } from '../analysis.js';
// import { reAnalyzeAllData } from '../analysis.js';