import { dom } from './dom.js';
import { state } from './state.js';
import { updateDatabankDisplay, savePortfolioFromDatabank, updateDatabankCount } from './modules/databank.js';
import { renderViewerForActiveTab } from './modules/viewer.js'; // NUEVO
import { openOptimizationModal } from './modules/optimization.js';
import { ALL_METRICS, STRATEGY_COLORS, CHART_OPTIONS } from './config.js';
import { destroyChart, destroyAllCharts, formatMetricForDisplay, hideError } from './utils.js';
import { focusMode } from './modules/focusMode.js';
import { renderStrategiesTable as renderStrategiesTableModule } from './modules/strategiesTable.js';
import { initSavedPortfoliosTable, getSavedPortfoliosTableConfig } from './modules/savedPortfoliosTable.js';


/**
 * Actualiza la lista de archivos de estrategia cargados en la UI.
 */
export const updateTradesFilesList = () => {
    dom.tradesFilesListEl.innerHTML = '';
    if (state.loadedStrategyFiles.length > 0) {
        state.loadedStrategyFiles.forEach((file, index) => {
            const fileEl = document.createElement('div');
            fileEl.className = 'flex justify-between items-center bg-gray-700/50 p-1 rounded text-gray-300';
            fileEl.innerHTML = `< span class="truncate pr-2" > ${file.name}</span > <button data-index="${index}" class="remove-file-btn text-red-500 hover:text-red-400 font-bold text-lg px-2" title="Eliminar archivo">&times;</button>`;
            dom.tradesFilesListEl.appendChild(fileEl);
        });
    }
};

/**
 * Resetea la interfaz de usuario a su estado inicial.
 */
export const resetUI = () => {
    dom.tradesFileInput.value = '';
    state.loadedStrategyFiles = [];
    state.rawStrategiesData = [];
    state.selectedPortfolioIndices.clear();
    state.savedPortfolios = [];
    state.featuredPortfolioIndex = null;
    state.comparisonPortfolioIndex = null;

    updateTradesFilesList();
    updateAnalysisModeSelector();

    // Ocultar secciones obsoletas (con null checks)
    if (dom.resultsDiv) dom.resultsDiv.classList.add('hidden');
    if (dom.savedPortfoliosContent) dom.savedPortfoliosContent.classList.remove('hidden'); // Mantener visible
    if (dom.featuredPortfolioSection) dom.featuredPortfolioSection.classList.add('hidden');
    // El visor siempre está visible en el nuevo layout

    hideError();
    destroyAllCharts();

    // Limpiar contenido de tabs obsoletos (con null checks)
    if (dom.tabNav) dom.tabNav.innerHTML = '';
    if (dom.tabContentArea) dom.tabContentArea.innerHTML = '';

    // Resetear controles de normalización
    if (dom.normalizeRiskCheckbox) {
        dom.normalizeRiskCheckbox.checked = false;
        // Si tuviéramos el panel ocultable ligado al checkbox, lo ocultaríamos aquí.
        // En la nueva UI, el panel es visible pero el checkbox es el "estado".
        // dom.riskNormalizationControls.classList.add('hidden'); 
    }
};

/**
 * Actualiza las opciones en el selector de modo de análisis.
 */
export const updateAnalysisModeSelector = () => {
    const selectedValue = dom.analysisModeSelect.value;
    dom.analysisModeSelect.innerHTML = '<option value="-1">Análisis Completo</option>';

    state.rawStrategiesData.forEach((_, i) => {
        const fileName = state.loadedStrategyFiles[i].name.replace('.csv', '');
        dom.analysisModeSelect.innerHTML += `< option value = "${i}" > Filtrar por ${fileName}</option > `;
    });

    if (state.selectedPortfolioIndices.size > 0) {
        dom.analysisModeSelect.innerHTML += `< option value = "portfolio" > Filtrar por Portafolio</option > `;
    }

    dom.analysisModeSelect.value = selectedValue;
    if (!dom.analysisModeSelect.querySelector(`option[value = "${selectedValue}"]`)) {
        dom.analysisModeSelect.value = '-1';
    }
};

/**
 * Muestra los resultados del análisis, creando las pestañas y tablas.
 * @param {Array} results - Array con los resultados del análisis para cada estrategia/portafolio.
 */
export const displayResults = (results) => {
    window.analysisResults = results.filter(r => r && r.analysis);

    const activeTabId = document.querySelector('.tab-btn.active')?.dataset.target;

    let navHTML = '';
    let contentHTML = '';

    const summaryResult = createSummaryTab(window.analysisResults);
    navHTML += summaryResult.nav;
    contentHTML += summaryResult.content;

    window.analysisResults.filter(r => !r.isPortfolio && !r.isSavedPortfolio).forEach((result) => {
        const strategyResult = createStrategyTab(result);
        navHTML += strategyResult.nav;
        contentHTML += strategyResult.content;
    });

    // En el nuevo layout, las pestañas de estrategias individuales están ocultas
    // Solo actualizamos si los elementos existen (para compatibilidad con layout antiguo)
    if (dom.tabNav && dom.tabContentArea) {
        dom.tabNav.innerHTML = navHTML;
        dom.tabContentArea.innerHTML = contentHTML;

        const tabToActivate = dom.tabNav.querySelector(`.tab - btn[data - target="${activeTabId}"]`) || dom.tabNav.querySelector('.tab-btn');
        if (tabToActivate) {
            tabToActivate.classList.add('active');
            const activeContent = document.getElementById(tabToActivate.dataset.target);
            if (activeContent) {
                activeContent.classList.add('active');
            }
        }

        if (dom.resultsDiv) dom.resultsDiv.classList.remove('hidden');
        renderChartsForTab(tabToActivate?.dataset.target);
    } else {
        // Nuevo layout: No mostramos pestañas individuales de estrategias
        console.log('[UI] Nuevo layout detectado - omitiendo renderizado de pestañas de estrategias');
    }
    displaySavedPortfoliosList();
    renderStrategiesTable(); // ✅ Render strategies table in bottom panel
    updateDatabankDisplay(); // <-- NUEVO: Refrescar el DataBank con las métricas actualizadas.

    // PERFORMANCE OVERHAUL: Disabled auto-rendering
    // Charts now only render via Focus Mode (user selection)
    /*
    const savedPortfolioAnalyses = window.analysisResults.filter(r => r.isSavedPortfolio && !r.isTemporaryOriginal);
    if (savedPortfolioAnalyses.length > 0 || state.comparisonPortfolioIndex !== null) {
        renderPortfolioComparisonCharts(savedPortfolioAnalyses);
    }
    */
    renderFeaturedPortfolio();

    // NUEVO: Renderizar el viewer principal según el tab activo
    setTimeout(() => renderViewerForActiveTab(), 150);
};

/**
 * Crea el HTML para la pestaña de resumen.
 * @param {Array} results - Todos los resultados del análisis.
 * @returns {Object} Objeto con el HTML para la navegación y el contenido.
 */
const createSummaryTab = (results) => {
    const tabId = 'summary';
    const nav = `< button class="tab-btn text-gray-400 py-2 px-4 text-sm font-medium text-center border-b-2 border-transparent" data - target="${tabId}" > Resumen Comparativo</button > `;

    // Ordenar los resultados antes de mostrarlos
    sortArrayByConfig(results, state.summarySortConfig, r => r.analysis);

    let tableBodyRows = '';
    results.filter(r => !r.isPortfolio && !r.isSavedPortfolio).forEach((result) => {
        const metrics = result.analysis;
        const isChecked = state.selectedPortfolioIndices.has(result.originalIndex) ? 'checked' : '';

        tableBodyRows += `< tr class="border-b border-gray-700 hover:bg-gray-800" >
            <td class="p-3 w-8"><input type="checkbox" data-index="${result.originalIndex}" class="portfolio-checkbox form-checkbox h-5 w-5 bg-gray-800 border-gray-600 rounded text-sky-500 focus:ring-sky-600" ${isChecked}></td>
            <td class="p-3 font-semibold"><span class="inline-block w-3 h-3 rounded-full mr-2" style="background-color:${STRATEGY_COLORS[result.originalIndex % STRATEGY_COLORS.length]}"></span>${result.name}</td>
            ${state.defaultMetricColumns.map(key => `<td class="p-3 text-right">${formatMetricForDisplay(metrics[key], key)}</td>`).join('')}
        </tr > `;
    });

    let tableFoot = '';
    const portfolioResult = results.find(r => r.isCurrentPortfolio);
    if (portfolioResult) {
        const metrics = portfolioResult.analysis;
        tableFoot = `< tfoot > <tr class="border-t-2 border-sky-500 bg-gray-800/50">
        <td class="p-3 w-8 text-center font-bold text-amber-400">P</td>
        <td class="p-3 font-semibold text-amber-400"><span class="inline-block w-3 h-3 rounded-full mr-2" style="background-color:#f59e0b"></span>${portfolioResult.name}</td>
        ${state.defaultMetricColumns.map(key => `<td class="p-3 text-right font-semibold text-amber-400">${formatMetricForDisplay(metrics[key], key)}</td>`).join('')}
    </tr></tfoot > `;
    }

    const tableHeaders = state.defaultMetricColumns.map(key => {
        const colInfo = ALL_METRICS[key];
        const orderIndicator = state.summarySortConfig.key === key ? `data - order="${state.summarySortConfig.order}"` : '';
        return `< th class="p-3 text-right sortable" data - column="${key}" data - type="numeric" ${orderIndicator}> ${colInfo.label}</th > `;
    }).join('');

    const comparativeTableHTML = `< div class="overflow-x-auto bg-gray-800 rounded-lg border border-gray-700" >
    <table id="summary-table" class="w-full text-sm text-left">
        <thead class="bg-gray-700 text-xs text-gray-400 uppercase">
            <tr><th class="p-3"></th><th class="p-3 sortable" data-column="name" ${state.summarySortConfig.key === 'name' ? `data-order="${state.summarySortConfig.order}"` : ''}>Estrategia</th>
                ${tableHeaders}
            </tr>
        </thead>
        <tbody>${tableBodyRows}</tbody>
        ${tableFoot}
    </table>
    </div > `;

    const content = `< div id = "${tabId}" class="tab-content space-y-8" > ${comparativeTableHTML}</div > `;
    return { nav, content };
};

/**
 * Ordena la tabla de resumen.
 * @param {HTMLElement} headerEl - El elemento de cabecera que fue clickeado.
 */
const sortSummaryTable = (headerEl) => {
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

const sortArrayByConfig = (array, sortConfig, metricAccessor) => {
    if (!array) return;
    array.sort((a, b) => {
        const metricsA = metricAccessor(a);
        const metricsB = metricAccessor(b);
        const valA = sortConfig.key === 'name' ? a.name : metricsA[sortConfig.key];
        const valB = sortConfig.key === 'name' ? b.name : metricsB[sortConfig.key];

        if (valA < valB) return sortConfig.order === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.order === 'asc' ? 1 : -1;
        return 0;
    });
};


/**
 * Crea el HTML para la pestaña de una estrategia individual.
 * @param {Object} result - El resultado del análisis para una estrategia.
 * @returns {Object} Objeto con el HTML para la navegación y el contenido.
 */
const createStrategyTab = (result) => {
    if (result.isPortfolio || result.isSavedPortfolio) return { nav: '', content: '' };

    const tabId = `strategy - ${result.originalIndex} `;
    const nav = `< button id = "${tabId}-btn" class="tab-btn text-gray-400 py-2 px-4 text-sm font-medium text-center border-b-2 border-transparent" data - target="${tabId}" > ${result.name}</button > `;
    const metrics = result.analysis;

    const metricsHTML = `< div ><h2 class="text-2xl font-bold text-white mb-4">Métricas Clave: ${result.name}</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            ${Object.entries({
        'Profit Factor': metrics.profitFactor, 'Coef. Sharpe': metrics.sharpeRatio, 'Max DD (%)': `${metrics.maxDrawdown.toFixed(2)}%`, 'Profit/Mes': metrics.monthlyAvgProfit,
        'Ret/DD': metrics.profitMaxDD_Ratio, 'UPI': metrics.upi, 'Win %': `${metrics.winningPercentage.toFixed(2)}%`, 'Ulcer Index $': metrics.ulcerIndexInDollars,
        'Max DD ($)': metrics.maxDrawdownInDollars, 'Pérdidas Cons.': metrics.maxConsecutiveLosses, 'Stagnation (Trades)': metrics.maxStagnationTrades,
        'Meses Pérd. Cons.': metrics.maxConsecutiveLosingMonths, 'Capture Ratio': metrics.captureRatio, 'Sortino': metrics.sortinoRatio, 'SQN': metrics.sqn
    }).map(([label, value]) => `
                <div class="bg-gray-800 p-4 rounded-xl shadow-lg border border-gray-700">
                    <h3 class="font-semibold text-gray-400 text-sm">${label}</h3>
                    <p class="text-3xl font-bold">${formatMetricForDisplay(value, label)}</p>
                </div>`).join('')}
        </div>
    </div > `;

    const chartsHTML = `<div class="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div class="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700 xl:col-span-2"><h2 class="text-xl font-bold">Equity Curve</h2><div class="h-96"><canvas id="equityChart-${tabId}"></canvas></div></div>
        <div class="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700"><h2 class="text-xl font-bold">Dispersión de Rendimientos</h2><div class="h-80"><canvas id="scatterChart-${tabId}"></canvas></div></div>
        <div class="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700"><h2 class="text-xl font-bold">Curva de Lorenz</h2><div class="h-80"><canvas id="lorenzChart-${tabId}"></canvas></div></div>
    </div > `;

    const content = `< div id = "${tabId}" class="tab-content space-y-8" > ${metricsHTML}${chartsHTML}</div > `;
    return { nav, content };
};

/**
 * Renderiza los gráficos para una pestaña específica.
 * @param {string} tabId - El ID de la pestaña a renderizar.
 */
/**
 * Renderiza los gráficos para una pestaña específica.
 * @param {string} tabId - El ID de la pestaña a renderizar.
 */
export const renderChartsForTab = (tabId) => {
    // PERFORMANCE OVERHAUL: Disable auto-rendering.
    // Charts are now only rendered via Focus Mode (user selection).
    // Clear charts if needed

    // If it's the main viewer, ensure it's cleared
    if (tabId === 'strategies-content' || tabId === 'databank-content' || tabId === 'saved-portfolios-content') {
        // Only clear if we are NOT in focus mode (to avoid clearing user selection on tab switch)
        // But actually, we want to persist selection across tabs if possible, or clear it?
        // For now, let's just NOT render anything automatically.
        return;
    }

    const results = window.analysisResults;
    if (!results || !tabId) return;

    // ... rest of the function is effectively disabled for auto-render
    // We keep the code below just in case we need to revert or use it for specific cases
    /*
    if (tabId.startsWith('strategy-')) {
        // ...
    }
    */
};

/**
 * Renderiza todos los gráficos de la pestaña activa.
 * @param {boolean} forceRedraw - Si es true, destruye los gráficos existentes antes de volver a dibujar.
 */
export const renderAllCharts = (forceRedraw = false) => {
    const activeTab = document.querySelector('.tab-btn.active');
    if (activeTab) {
        const targetId = activeTab.dataset.target;
        if (forceRedraw) {
            document.querySelectorAll(`#${targetId} canvas`).forEach(canvas => destroyChart(canvas.id));
        }
        renderChartsForTab(targetId);
    }
};

/**
 * Renderiza un gráfico de equity.
 * @param {string} canvasId - ID del elemento canvas.
 * @param {Object} analysis - Objeto de análisis con los datos.
 * @param {string} name - Nombre de la estrategia.
 * @param {string} color - Color para la línea del gráfico.
 */
export const renderEquityChart = (canvasId, analysis, name, color) => {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    destroyChart(canvasId);

    state.chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                { label: name, data: analysis.chartData.equityCurve, borderColor: color, backgroundColor: `${color}1a`, borderWidth: 2, pointRadius: 0, tension: 0.1, fill: true }
            ]
        },
        options: CHART_OPTIONS
    });
};

/**
 * Renderiza un gráfico de dispersión de rendimientos.
 */
export const renderScatterChart = (canvasId, analysis, color) => {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    destroyChart(canvasId);

    state.chartInstances[canvasId] = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Rendimiento Diario',
                data: analysis.chartData.scatterData,
                backgroundColor: `${color} 99`
            }]
        },
        options: {
            ...CHART_OPTIONS,
            scales: {
                x: { ...CHART_OPTIONS.scales.x, title: { display: true, text: 'Rendimiento Portfolio (%)', color: '#d1d5db' } },
                y: { ...CHART_OPTIONS.scales.y, title: { display: true, text: 'Rendimiento Estrategia (%)', color: '#d1d5db' } }
            }
        }
    });
};

/**
 * Renderiza una curva de Lorenz.
 */
export const renderLorenzChart = (canvasId, analysis, color) => {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    destroyChart(canvasId);

    state.chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Curva de Beneficios', data: analysis.lorenzData, showLine: true, borderColor: color, backgroundColor: `${color} 1a`, tension: .1, pointRadius: 0, fill: true
            }, {
                label: 'Consistencia Perfecta', data: [{ x: 0, y: 0 }, { x: 100, y: 100 }], borderColor: '#4ade80', borderWidth: 2, pointRadius: 0, borderDash: [5, 5], fill: false
            }]
        },
        options: {
            ...CHART_OPTIONS,
            scales: {
                x: { ...CHART_OPTIONS.scales.x, type: 'linear', position: 'bottom', min: 0, max: 100, title: { display: true, text: '% Acumulado de Trades Ganadores' } },
                y: { ...CHART_OPTIONS.scales.y, min: 0, max: 100, title: { display: true, text: '% Acumulado del Beneficio Total' } }
            }
        }
    });
};

/**
 * Muestra la lista de portafolios guardados.
 */
export const displaySavedPortfoliosList = () => {
    console.log("DEBUG UI.JS: Entrando a displaySavedPortfoliosList. Estado de 'savedPortfolios':", JSON.parse(JSON.stringify(state.savedPortfolios)));
    console.log("DEBUG UI.JS: dom.savedPortfoliosContent existe?", !!dom.savedPortfoliosContent);
    console.log("DEBUG UI.JS: dom.savedPortfoliosBody existe?", !!dom.savedPortfoliosBody);
    console.log("DEBUG UI.JS: dom.savedPortfoliosCount existe?", !!dom.savedPortfoliosCount);

    // Initialize table if needed
    initSavedPortfoliosTable();

    if (state.savedPortfolios.length === 0) {
        console.log("DEBUG UI.JS: No hay portafolios guardados, ocultando sección");
        // En el nuevo layout, el contenido siempre está visible, solo vaciamos la tabla
        if (dom.savedPortfoliosBody) {
            dom.savedPortfoliosBody.innerHTML = '<tr><td colspan="10" class="p-4 text-center text-gray-500">No hay portafolios guardados</td></tr>';
        }
        if (dom.savedPortfoliosCount) dom.savedPortfoliosCount.textContent = '0';
        return;
    }

    console.log("DEBUG UI.JS: Hay", state.savedPortfolios.length, "portafolios guardados");
    // En el nuevo layout, la sección siempre está visible
    if (dom.savedPortfoliosCount) {
        dom.savedPortfoliosCount.textContent = `${state.savedPortfolios.length} `;
        console.log("DEBUG UI.JS: Actualizado contador a", state.savedPortfolios.length);
    }

    // Get custom column configuration
    const tableConfig = getSavedPortfoliosTableConfig();
    const visibleColumns = tableConfig.visibleColumns || [];

    // Ordenar los portafolios antes de mostrarlos
    state.savedPortfolios.sort((a, b) => {
        // Ahora es simple: cada portafolio tiene sus métricas.
        const sortConfig = state.savedPortfoliosSortConfig;

        let valA, valB;
        if (sortConfig.key === 'name') {
            valA = a.name;
            valB = b.name;
        } else if (sortConfig.key === 'strategyCount') {
            valA = a.indices ? a.indices.length : 0;
            valB = b.indices ? b.indices.length : 0;
        } else {
            valA = a.metrics?.[sortConfig.key] ?? 0;
            valB = b.metrics?.[sortConfig.key] ?? 0;
        }

        if (typeof valA === 'number') {
            valA = isFinite(valA) ? valA : (sortConfig.order === 'asc' ? Infinity : -Infinity);
            valB = isFinite(valB) ? valB : (sortConfig.order === 'asc' ? Infinity : -Infinity);
        }

        if (valA < valB) return sortConfig.order === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.order === 'asc' ? 1 : -1;
        return 0;
    });

    // Clear and rebuild header using DOM (like Strategies)
    dom.savedPortfoliosHeader.innerHTML = '';
    const headerRow = document.createElement('tr');

    visibleColumns.forEach(key => {
        const colInfo = ALL_METRICS[key];
        if (!colInfo) return;

        const th = document.createElement('th');
        th.className = 'px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10 relative group select-none cursor-pointer hover:text-white transition-colors';

        const isSorting = state.savedPortfoliosSortConfig.key === key;
        if (isSorting) {
            th.className += ' text-blue-400';
        }

        const label = colInfo.label + (isSorting ? (state.savedPortfoliosSortConfig.order === 'asc' ? ' ▲' : ' ▼') : '');
        th.textContent = label;
        th.dataset.sortKey = key;
        th.dataset.colId = key;

        // Apply saved width OR auto-fit if first time
        if (tableConfig.columnWidths && tableConfig.columnWidths[key]) {
            th.style.width = tableConfig.columnWidths[key];
            th.style.minWidth = tableConfig.columnWidths[key];
        } else {
            // First time: auto-fit after table is rendered
            setTimeout(() => autoFitSavedPortfoliosColumn(th, key), 0);
        }

        // Click to sort
        th.addEventListener('click', (e) => {
            if (e.target.classList.contains('cursor-col-resize')) return;
            sortSavedPortfoliosTable(th);
        });

        // Resizer
        const resizer = document.createElement('div');
        resizer.className = 'absolute right-0 top-0 bottom-0 w-1 cursor-col-resize bg-gray-600 hover:bg-blue-500 transition-colors';
        resizer.addEventListener('mousedown', initSavedPortfoliosResize);
        resizer.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            autoFitSavedPortfoliosColumn(th, key);
        });
        th.appendChild(resizer);
        headerRow.appendChild(th);
    });

    // Action header
    const thAction = document.createElement('th');
    thAction.className = 'px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10';
    thAction.textContent = 'Acciones';
    headerRow.appendChild(thAction);

    dom.savedPortfoliosHeader.appendChild(headerRow);

    let bodyHTML = '';
    state.savedPortfolios.forEach((p, i) => {
        // Ya no necesitamos buscar. ¡Las métricas están en el propio objeto 'p'!
        if (!p.metrics || Object.keys(p.metrics).length === 0) {
            console.log(`DEBUG UI.JS: Saltando portafolio ID ${p.id} ('${p.name}') porque no tiene métricas.`);
            return; // Si no tiene métricas, lo saltamos.
        }

        // El índice original es su posición en el array de estado ANTES de ordenar.
        // Para los botones, necesitamos el índice que corresponde al estado actual.
        const originalIndex = state.savedPortfolios.indexOf(p);

        const weightsText = p.weights ? `(${p.weights.map(w => `${(w * 100).toFixed(0)}%`).join('/')})` : '';
        const isFeatured = originalIndex === state.featuredPortfolioIndex;
        const isCompared = originalIndex === state.comparisonPortfolioIndex;

        let rowHTML = `<tr class="hover:bg-gray-700/50 transition-colors cursor-pointer border-b border-gray-700 last:border-0" data-row-type="saved" data-row-index="${originalIndex}">`;
        visibleColumns.forEach(key => {
            // Safety check: ensure column exists in definition
            const colInfo = ALL_METRICS[key];
            if (!colInfo) return;

            if (key === 'name') {
                rowHTML += `<td class="px-4 py-3"><p class="font-semibold text-sky-300">${p.name}</p><p class="text-gray-400 text-xs">${weightsText}</p></td>`;
            } else if (key === 'strategyCount') {
                const value = p.indices ? p.indices.length : 0;
                rowHTML += `<td class="px-4 py-3 text-gray-300 text-right">${value}</td>`;
            } else if (key === 'returnDD') {
                const value = p.metrics ? p.metrics['profitMaxDD_Ratio'] : 0;
                rowHTML += `<td class="px-4 py-3 text-gray-300 text-right">${formatMetricForDisplay(value, key)}</td>`;
            } else {
                const value = p.metrics[key];
                rowHTML += `<td class="px-4 py-3 text-gray-300 text-right">${formatMetricForDisplay(value, key)}</td>`;
            }
        });

        rowHTML += `<td class="px-4 py-3 text-center whitespace-nowrap">
            <button data-index="${originalIndex}" class="feature-portfolio-btn text-gray-500 hover:text-amber-400 text-xl px-1 ${isFeatured ? 'featured' : ''}" title="Destacar/Acciones">&#9733;</button>
            ${p.weights ? `<button data-index="${originalIndex}" class="compare-original-btn text-gray-500 hover:text-amber-400 text-xl px-1 ${isCompared ? 'active' : ''}" title="Comparar con Original">🔄</button>` : ''}
            <button data-index="${originalIndex}" class="view-edit-portfolio-btn bg-purple-600 hover:bg-purple-700 text-white font-bold py-1 px-3 rounded-lg text-xs inline-flex items-center gap-1 transition-all">
                <span class="text-sm">⚙️</span>
                <span>Optimizar</span>
            </button>
            <button data-index="${originalIndex}" class="delete-portfolio-btn text-red-500 hover:text-red-400 font-bold text-lg px-1">&times;</button>
        </td></tr>`;
        bodyHTML += rowHTML;
    });
    dom.savedPortfoliosBody.innerHTML = bodyHTML;
};

// Make globally accessible for savedPortfoliosTable modal
window.displaySavedPortfoliosList = displaySavedPortfoliosList;

// Auto-fit column to content
function autoFitSavedPortfoliosColumn(th, colId) {
    const tableBody = dom.savedPortfoliosBody;
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
    const config = getSavedPortfoliosTableConfig();
    const colIndex = config.visibleColumns.indexOf(colId);

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

    const tableConfig = getSavedPortfoliosTableConfig();
    if (!tableConfig.columnWidths) tableConfig.columnWidths = {};
    tableConfig.columnWidths[colId] = newWidth;
    localStorage.setItem('savedPortfoliosTableConfig', JSON.stringify(tableConfig));
}

/**
 * Initialize Focus Mode listeners for Saved Portfolios
 */
export const initSavedPortfoliosFocus = () => {
    if (!dom.savedPortfoliosBody) return;

    dom.savedPortfoliosBody.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        if (!row) return;

        // Ignore if clicking on buttons
        if (e.target.closest('button')) return;

        const index = row.dataset.rowIndex;
        if (index !== undefined) {
            const portfolio = state.savedPortfolios[index];
            if (portfolio) {
                focusMode.enable(portfolio, 'saved', row);
            }
        }
    });
};

// Resizer functionality for Saved Portfolios (copied from Strategies)
let savedPortfoliosResizeData = null;

function initSavedPortfoliosResize(e) {
    savedPortfoliosResizeData = {
        th: e.target.parentElement,
        startX: e.pageX,
        startWidth: e.target.parentElement.offsetWidth
    };
    document.addEventListener('mousemove', doSavedPortfoliosResize);
    document.addEventListener('mouseup', stopSavedPortfoliosResize);
    e.preventDefault();
}

function doSavedPortfoliosResize(e) {
    if (!savedPortfoliosResizeData) return;
    const delta = e.pageX - savedPortfoliosResizeData.startX;
    const newWidth = Math.max(50, savedPortfoliosResizeData.startWidth + delta);
    savedPortfoliosResizeData.th.style.width = newWidth + 'px';
    savedPortfoliosResizeData.th.style.minWidth = newWidth + 'px';
}

function stopSavedPortfoliosResize() {
    if (savedPortfoliosResizeData) {
        const colId = savedPortfoliosResizeData.th.dataset.colId || savedPortfoliosResizeData.th.dataset.sortKey;
        const newWidth = savedPortfoliosResizeData.th.style.width;

        const config = getSavedPortfoliosTableConfig();
        if (!config.columnWidths) config.columnWidths = {};
        config.columnWidths[colId] = newWidth;
        localStorage.setItem('savedPortfoliosTableConfig', JSON.stringify(config));

        savedPortfoliosResizeData = null;
    }
    document.removeEventListener('mousemove', doSavedPortfoliosResize);
    document.removeEventListener('mouseup', stopSavedPortfoliosResize);
}


/**
 * Ordena la tabla de portafolios guardados.
 * @param {HTMLElement} headerEl - El elemento de cabecera que fue clickeado.
 */
const sortSavedPortfoliosTable = (headerEl) => {
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
    displaySavedPortfoliosList(); // Correcto: solo redibuja esta lista
};

/**
 * Renderiza los gráficos de comparación de portafolios.
 */
export const renderPortfolioComparisonCharts = (portfolioAnalyses) => {
    console.log('[UI] renderPortfolioComparisonCharts called with', portfolioAnalyses.length, 'items');
    console.log('[UI] Portfolio names:', portfolioAnalyses.map(p => p.name).join(', '));
    const canvasId = 'portfolioEquityChart'; // ID del canvas
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;

    // Always show the chart section (for clean slate UX)
    dom.portfolioComparisonChartSection.classList.remove('hidden');

    // If empty and no comparison, just destroy chart and return
    if (portfolioAnalyses.length === 0 && state.comparisonPortfolioIndex === null) {
        console.log('[UI] No portfolios to display');
        return;
    }

    const allAnalyses = [...portfolioAnalyses];
    const originalResult = window.analysisResults.find(r => r.isTemporaryOriginal);
    if (originalResult) {
        if (!allAnalyses.some(a => a.name === originalResult.name)) {
            allAnalyses.push(originalResult);
        }
    }
    if (allAnalyses.length === 0) return;

    const datasets = allAnalyses.map((result) => {
        const isFeatured = result.savedIndex === state.featuredPortfolioIndex;
        const analysis = result.analysis || {};
        const chartData = analysis.chartData || {};
        const normalizedData = chartData.equityCurve || [];

        if (!normalizedData.length) {
            console.warn(`[UI] Dataset for ${result.name} (Index: ${result.savedIndex}) is EMPTY. Skipping.`);
            return null;
        }

        const color = result.color || (isFeatured ? '#fbbf24' : (result.isTemporaryOriginal ? '#9ca3af' : STRATEGY_COLORS[(4 + result.savedIndex) % STRATEGY_COLORS.length]));

        console.log(`[UI] Dataset for ${result.name}: ${normalizedData.length} points. Color: ${color}. Featured: ${isFeatured}`);

        return {
            label: result.name,
            data: normalizedData,
            borderColor: color,
            borderWidth: isFeatured ? 3 : 2,
            pointRadius: 0,
            tension: 0.1,
            savedIndex: result.savedIndex,
            order: isFeatured ? 0 : 1,
            analysis: analysis, // Attach the full analysis object for use in plugins
            isFeatured: isFeatured
        };
    }).filter(ds => ds !== null);

    // --- Crosshair Plugin Definition ---
    const crosshairPlugin = {
        id: 'crosshairPlugin',
        defaults: {
            width: 1,
            color: 'rgba(156, 163, 175, 0.5)', // gray-400 with opacity
            dash: [3, 3],
            labelColor: 'rgba(31, 41, 55, 0.9)', // gray-800
            textColor: '#f3f4f6' // gray-100
        },
        beforeDraw: (chart) => {
            // Draw Stagnation Highlight
            const datasets = chart.data.datasets;
            if (!datasets || datasets.length === 0) return;

            // Find a dataset that has stagnation metrics. 
            // Prioritize featured, then check others.
            let targetDataset = datasets.find(d => d.isFeatured && d.analysis && (d.analysis.metrics?.maxStagnationStart || d.analysis.maxStagnationStart));

            if (!targetDataset) {
                targetDataset = datasets.find(d => d.analysis && (d.analysis.metrics?.maxStagnationStart || d.analysis.maxStagnationStart));
            }

            if (!targetDataset || !targetDataset.analysis) return;

            const analysis = targetDataset.analysis;
            const metrics = analysis.metrics || analysis; // metrics might be directly on analysis or nested

            if (metrics && metrics.maxStagnationStart && metrics.maxStagnationEnd) {
                const ctx = chart.ctx;
                const xAxis = chart.scales.x;
                const yAxis = chart.scales.y;

                // Parse dates
                const startDate = new Date(metrics.maxStagnationStart);
                const endDate = new Date(metrics.maxStagnationEnd);

                // Get pixels
                const startPixel = xAxis.getPixelForValue(startDate.getTime());
                const endPixel = xAxis.getPixelForValue(endDate.getTime());

                if (startPixel && endPixel) {
                    const width = endPixel - startPixel;

                    ctx.save();
                    ctx.fillStyle = 'rgba(239, 68, 68, 0.15)'; // Red-500 with 15% opacity
                    // Draw full height rectangle
                    ctx.fillRect(startPixel, yAxis.top, width, yAxis.bottom - yAxis.top);

                    // Draw Label
                    ctx.fillStyle = 'rgba(239, 68, 68, 0.8)'; // Darker red for text
                    ctx.font = 'bold 12px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    const label = `${metrics.maxStagnationDays} d`;
                    // Position at the top center of the highlighted area, slightly padded
                    ctx.fillText(label, startPixel + width / 2, yAxis.top + 5);

                    ctx.restore();
                }
            }
        },
        afterInit: (chart) => {
            chart.crosshair = { x: 0, y: 0, draw: false };
        },
        afterEvent: (chart, args) => {
            const { inChartArea } = args;
            const { x, y } = args.event;

            // Sync logic: Update the OTHER chart
            const otherChartId = chart.canvas.id === 'portfolioEquityChart' ? 'portfolioDrawdownChart' : 'portfolioEquityChart';
            const otherChart = state.chartInstances[otherChartId];

            chart.crosshair = { x, y, draw: inChartArea };

            if (otherChart && inChartArea) {
                // Sync X coordinate (assuming aligned axes)
                otherChart.crosshair = { x, y: 0, draw: true }; // y:0 means don't draw horizontal on other
                otherChart.draw();
            } else if (otherChart) {
                otherChart.crosshair = { x: 0, y: 0, draw: false };
                otherChart.draw();
            }

            args.changed = true; // Force redraw

            // --- Unified Tooltip Logic ---
            const infoPanel = document.getElementById('chart-info-panel');
            const infoDate = document.getElementById('chart-info-date');
            const infoBody = document.getElementById('chart-info-body');

            if (inChartArea && infoPanel && infoDate && infoBody) {
                // Position Tooltip near mouse (Floating)
                // Offset: 15px right, 15px down (closer)
                const tooltipX = args.event.native.clientX;
                const tooltipY = args.event.native.clientY;

                // Smart Positioning: Flip to left if too close to right edge
                const tooltipWidth = infoPanel.offsetWidth || 220; // Estimate if 0
                const viewportWidth = window.innerWidth;
                const edgeThreshold = 20;

                let finalX = tooltipX + 15;

                if (finalX + tooltipWidth > viewportWidth - edgeThreshold) {
                    finalX = tooltipX - tooltipWidth - 15;
                }

                infoPanel.style.position = 'fixed';
                infoPanel.style.left = `${finalX}px`;
                infoPanel.style.top = `${tooltipY + 15}px`;
                infoPanel.classList.remove('hidden');
                infoPanel.classList.remove('opacity-0');

                // Get active elements (points under cursor)
                // We use 'index' mode to get points from all datasets at the same X
                const activePoints = chart.getElementsAtEventForMode(args.event, 'index', { intersect: false }, true);

                if (activePoints.length > 0) {
                    // Update Date
                    const firstPoint = activePoints[0];
                    const xValue = chart.data.datasets[firstPoint.datasetIndex].data[firstPoint.index].x;
                    const date = new Date(xValue);
                    infoDate.textContent = date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

                    // Build Body Content
                    let html = '';

                    // Sort points by value descending
                    const sortedPoints = [...activePoints].sort((a, b) => {
                        const valA = chart.data.datasets[a.datasetIndex].data[a.index].y;
                        const valB = chart.data.datasets[b.datasetIndex].data[b.index].y;
                        return valB - valA;
                    });

                    sortedPoints.forEach(point => {
                        const dataset = chart.data.datasets[point.datasetIndex];
                        const meta = dataset.savedIndex !== undefined
                            ? allAnalyses.find(a => a.savedIndex === dataset.savedIndex)
                            : null;

                        const initialBalance = meta?.analysis?.metrics?.initial_balance || 10000;
                        const rawY = dataset.data[point.index].y;

                        let equityUSD, ddUSD;

                        if (chart.canvas.id === 'portfolioEquityChart') {
                            // Triggered from Equity Chart
                            equityUSD = (rawY / 100) * initialBalance;

                            // Find corresponding DD
                            const ddChart = state.chartInstances['portfolioDrawdownChart'];
                            if (ddChart) {
                                const ddDataset = ddChart.data.datasets.find(ds => ds.label === dataset.label);
                                if (ddDataset && ddDataset.data[point.index]) {
                                    ddUSD = ddDataset.data[point.index].y;
                                } else {
                                    ddUSD = 0;
                                }
                            }
                        } else {
                            // Triggered from Drawdown Chart
                            ddUSD = rawY; // Already in $

                            // Find corresponding Equity
                            const eqChart = state.chartInstances['portfolioEquityChart'];
                            if (eqChart) {
                                const eqDataset = eqChart.data.datasets.find(ds => ds.label === dataset.label);
                                if (eqDataset && eqDataset.data[point.index]) {
                                    const eqRawY = eqDataset.data[point.index].y;
                                    equityUSD = (eqRawY / 100) * initialBalance;
                                } else {
                                    equityUSD = 0;
                                }
                            }
                        }

                        const profitUSD = equityUSD - initialBalance;

                        html += `
                            <div class="flex flex-col gap-1 mb-2 border-b border-gray-700/50 pb-2 last:border-0 last:mb-0 last:pb-0">
                                <div class="flex items-center gap-2">
                                    <div class="w-2 h-2 rounded-full" style="background-color: ${dataset.borderColor}"></div>
                                    <span class="text-gray-300 font-bold text-xs">${dataset.label}</span>
                                </div>
                                <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs ml-4">
                                    <div class="text-gray-400">Valor:</div>
                                    <div class="text-white font-mono text-right">${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(equityUSD)}</div>

                                    <div class="text-gray-400">Beneficio (Equity):</div>
                                    <div class="${profitUSD >= 0 ? 'text-green-400' : 'text-red-400'} font-mono text-right">${profitUSD >= 0 ? '+' : ''}${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(profitUSD)}</div>
                                    
                                    <div class="text-gray-400">Drawdown:</div>
                                    <div class="text-red-400 font-mono text-right">${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(ddUSD)}</div>
                                </div>
                            </div>
                        `;
                    });

                    infoBody.innerHTML = html;
                }
            } else if (infoPanel && !inChartArea) {
                infoPanel.classList.add('opacity-0');
            }
        },
        afterDraw: (chart, args, options) => {
            const { ctx, chartArea: { top, bottom, left, right }, scales: { x: xScale, y: yScale } } = chart;
            const { x, y, draw } = chart.crosshair || {};

            // Draw if this chart is active OR if it's being synced (draw=true but x might be from other chart)
            if (!draw) return;

            ctx.save();
            ctx.beginPath();
            ctx.lineWidth = options.width || 1;
            ctx.strokeStyle = options.color || 'rgba(156, 163, 175, 0.5)';
            ctx.setLineDash(options.dash || [3, 3]);

            // Vertical Line (Always draw if x is present)
            if (x) {
                ctx.moveTo(x, top);
                ctx.lineTo(x, bottom);
            }

            // Horizontal Line (Only if y is present and > 0, usually only on active chart)
            if (y) {
                ctx.moveTo(left, y);
                ctx.lineTo(right, y);
            }

            ctx.stroke();

            // --- Draw Labels ---
            ctx.setLineDash([]);
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // X Axis Label (Date) - Only if x is valid
            if (xScale && x) {
                const xValue = xScale.getValueForPixel(x);
                const date = new Date(xValue);
                if (!isNaN(date.getTime())) {
                    const label = date.toLocaleDateString();
                    const textWidth = ctx.measureText(label).width + 10;

                    ctx.fillStyle = options.labelColor || 'rgba(31, 41, 55, 0.9)';
                    ctx.fillRect(x - textWidth / 2, bottom, textWidth, 20);

                    ctx.fillStyle = options.textColor || '#f3f4f6';
                    ctx.fillText(label, x, bottom + 10);
                }
            }

            // Y Axis Label (Value) - Only if y is valid (active chart)
            if (yScale && y) {
                const yValue = yScale.getValueForPixel(y);
                let label;
                if (chart.canvas.id === 'portfolioDrawdownChart') {
                    label = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: "compact" }).format(yValue);
                } else {
                    label = new Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(yValue);
                }

                const textWidth = ctx.measureText(label).width + 10;

                ctx.fillStyle = options.labelColor || 'rgba(31, 41, 55, 0.9)';
                ctx.fillRect(right - textWidth, y - 10, textWidth, 20);

                ctx.fillStyle = options.textColor || '#f3f4f6';
                ctx.fillText(label, right - textWidth / 2, y);
            }

            ctx.restore();
        }
    };

    // --- Drawdown Chart Logic ---
    const ddCanvasId = 'portfolioDrawdownChart';
    destroyChart(ddCanvasId);
    const ddCtx = document.getElementById(ddCanvasId)?.getContext('2d');

    if (ddCtx) {
        // Set cursor to crosshair for better UX
        ddCtx.canvas.style.cursor = 'crosshair';

        const calculateDrawdownCurve = (equityCurve, initialBalance) => {
            if (!equityCurve || equityCurve.length === 0) return [];
            let maxEquity = -Infinity;
            return equityCurve.map(point => {
                if (point.y > maxEquity) maxEquity = point.y;

                // Calculate Dollar Drawdown
                // Assuming equityCurve is normalized (base 100)
                // RealEquity = (PointY / 100) * InitialBalance
                // RealMax = (MaxY / 100) * InitialBalance
                // DD$ = RealEquity - RealMax

                const realEquity = (point.y / 100) * initialBalance;
                const realMax = (maxEquity / 100) * initialBalance;
                const drawdownUSD = realEquity - realMax;

                return { x: point.x, y: drawdownUSD };
            });
        };

        const ddDatasets = allAnalyses.map((result) => {
            const isFeatured = result.savedIndex === state.featuredPortfolioIndex;
            const analysis = result.analysis || {};
            const chartData = analysis.chartData || {};
            const equityCurve = chartData.equityCurve || [];
            const initialBalance = analysis.metrics?.initial_balance || 10000; // Fallback

            if (!equityCurve.length) return null;

            const drawdownCurve = calculateDrawdownCurve(equityCurve, initialBalance);
            const color = result.color || (isFeatured ? '#fbbf24' : (result.isTemporaryOriginal ? '#9ca3af' : STRATEGY_COLORS[(4 + result.savedIndex) % STRATEGY_COLORS.length]));

            return {
                label: result.name,
                data: drawdownCurve,
                borderColor: color,
                backgroundColor: color + '40', // Slightly more opaque fill
                borderWidth: 0, // No border
                pointRadius: 0,
                fill: true,
                tension: 0.1,
                savedIndex: result.savedIndex,
                order: isFeatured ? 0 : 1
            };
        }).filter(ds => ds !== null);

        // Create Drawdown Chart
        // FIX: Register in state.chartInstances to allow proper destruction via utils.destroyChart
        const ddChart = new Chart(ddCtx, {
            type: 'line', // Back to line for stability with large datasets
            data: { datasets: ddDatasets },
            plugins: [crosshairPlugin], // Register local plugin
            options: {
                ...CHART_OPTIONS,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    ...CHART_OPTIONS.plugins,
                    legend: { display: false },
                    title: { display: false },
                    tooltip: {
                        enabled: false, // Disable built-in tooltip in favor of unified panel
                    },
                    crosshair: { // Plugin options
                        color: 'rgba(255, 255, 255, 0.3)',
                        width: 1
                    }
                },
                scales: {
                    x: {
                        display: false,
                        grid: { display: false }
                    },
                    y: {
                        display: false,
                        grid: { display: false }
                    }
                },
                elements: {
                    point: {
                        radius: 0, // No points, just the shape
                        hitRadius: 10,
                        hoverRadius: 4 // Show point on hover
                    },
                    line: {
                        borderWidth: 0, // No border, just fill
                    }
                }
            }
        });

        state.chartInstances[ddCanvasId] = ddChart;
    }

    const firstAnalysis = allAnalyses[0].analysis;
    // No benchmark needed

    const chartOptionsWithClick = {
        // Hacemos una copia profunda de las opciones para evitar conflictos
        ...CHART_OPTIONS, // Usamos la copia superficial, es más simple.
        plugins: {
            ...CHART_OPTIONS.plugins,
            tooltip: {
                enabled: false // Disable built-in tooltip for main chart too
            }
        },
        onClick: (evt, elements, chart) => {
            console.log('%c[CHART CLICK] 1. Evento onClick del gráfico disparado.', 'color: #f0abfc');
            const points = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true);
            console.log(`% c[CHART CLICK]2. Puntos detectados bajo el cursor: ${points.length} `, 'color: #f0abfc');

            if (points.length) {
                const firstPoint = points[0];
                const dataset = chart.data.datasets[firstPoint.datasetIndex];
                const clickedPortfolioIndex = dataset.savedIndex;
                console.log(`% c[CHART CLICK]3. Índice de portafolio detectado: ${clickedPortfolioIndex} `, 'color: #f0abfc');

                if (clickedPortfolioIndex === undefined) {
                    console.log('%c[CHART CLICK] 3.1. Clic en Benchmark. Abortando.', 'color: #f0abfc');
                    return;
                }

                const activeAction = document.querySelector('#chart-actions-group .chart-action-item.active')?.dataset.action;
                console.log(`% c[CHART CLICK]4. Acción activa: '${activeAction}'`, 'color: #f0abfc');

                if (activeAction === 'destacar') {
                    console.log('%c[CHART CLICK] 5. Entrando en la lógica de "destacar".', 'color: #f0abfc; font-weight: bold;');
                    const portfolio = state.savedPortfolios[clickedPortfolioIndex];
                    if (!portfolio) {
                        console.error(`[CHART CLICK]ERROR: No se encontró el portafolio con índice ${clickedPortfolioIndex} `);
                        return;
                    }

                    const modal = document.getElementById('chart-click-modal');
                    const modalTitle = document.getElementById('chart-click-modal-title');
                    const modalBody = document.getElementById('chart-click-modal-body');
                    const confirmBtn = document.getElementById('chart-click-modal-confirm-btn');

                    modalTitle.textContent = 'Confirmar Destacado';
                    modalBody.textContent = `¿Estás seguro de que quieres establecer "${portfolio.name}" como el portafolio destacado?`;

                    confirmBtn.onclick = () => {
                        console.log(`%c[CHART CLICK] 6. Confirmado. Estableciendo portafolio destacado a índice ${clickedPortfolioIndex}`, 'color: #f0abfc; font-weight: bold;');
                        state.featuredPortfolioIndex = clickedPortfolioIndex;
                        renderFeaturedPortfolio();
                        renderPortfolioComparisonCharts(portfolioAnalyses); // Re-render para actualizar el estilo
                        window.closeChartClickModal(); // Cierra el modal directamente
                    };

                    console.log('%c[CHART CLICK] 7. Mostrando modal de confirmación.', 'color: #f0abfc');
                    modal.classList.remove('hidden');
                    modal.classList.add('flex');
                    setTimeout(() => {
                        document.getElementById('chart-click-modal-backdrop').classList.remove('opacity-0');
                        document.getElementById('chart-click-modal-content').classList.remove('scale-95', 'opacity-0');
                    }, 10);
                } else if (activeAction === 'ocultar') { // Lógica para Ocultar/Mostrar
                    console.log('%c[CHART CLICK] 5. Entrando en la lógica de "ocultar/mostrar".', 'color: #f0abfc; font-weight: bold;');
                    // --- CORRECCIÓN: Usar chart.toggleDataVisibility() es la forma más limpia ---
                    const datasetMeta = chart.getDatasetMeta(firstPoint.datasetIndex);
                    chart.toggleDataVisibility(firstPoint.datasetIndex);
                    chart.update(); // Actualizar el gráfico para que el cambio sea visible
                } else if (activeAction === 'editar') { // Lógica para Editar
                    console.log('%c[CHART CLICK] 5. Entrando en la lógica de "editar".', 'color: #f0abfc; font-weight: bold;');
                    // El índice del portafolio ya lo tenemos en 'clickedPortfolioIndex'
                    openOptimizationModal(clickedPortfolioIndex);
                } else {
                    console.log(`%c[CHART CLICK] 5.1. La acción activa ('${activeAction}') no tiene una función de clic definida. No se hace nada.`, 'color: #f0abfc');
                }
            }
        }
    };

    // --- CORRECCIÓN: Deshabilitar el plugin de zoom si se va a usar el onClick ---
    // El plugin de zoom y el onClick a nivel de opciones son a menudo incompatibles.
    // Damos prioridad al onClick.
    delete chartOptionsWithClick.plugins.zoom;

    // Set cursor to crosshair for main chart too
    if (ctx) ctx.canvas.style.cursor = 'crosshair';

    const chart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        plugins: [crosshairPlugin], // Register local plugin
        options: {
            ...chartOptionsWithClick,
            plugins: {
                ...chartOptionsWithClick.plugins,
                crosshair: { // Plugin options
                    color: 'rgba(255, 255, 255, 0.3)',
                    width: 1
                }
            }
        }
    });
    state.chartInstances[canvasId] = chart;
};

// Expose close modal function globally
window.closeChartClickModal = () => {
    const modal = document.getElementById('chart-click-modal');
    if (modal) {
        const backdrop = document.getElementById('chart-click-modal-backdrop');
        const content = document.getElementById('chart-click-modal-content');
        backdrop.classList.add('opacity-0');
        content.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex'); // Ensure flex is removed
        }, 300); // Coincide con la duración de la transición
    }
};

/**
 * Renderiza la sección del portafolio destacado.
 */
export const renderFeaturedPortfolio = () => {
    console.log('[UI] renderFeaturedPortfolio llamado, nuevo layout?', !dom.featuredPortfolioSection);

    // En el nuevo layout, no tenemos sección de portafolio destacado
    if (!dom.featuredPortfolioSection) {
        console.log('[UI] Nuevo layout - omitiendo renderizado de portafolio destacado');
        return;
    }

    destroyChart('featured-portfolio-chart');
    if (state.featuredPortfolioIndex === null || !state.savedPortfolios[state.featuredPortfolioIndex]) {
        dom.featuredPortfolioSection.innerHTML = '';
        dom.featuredPortfolioSection.classList.add('hidden');
        return;
    }

    const portfolio = state.savedPortfolios[state.featuredPortfolioIndex];
    const portfolioAnalysis = window.analysisResults.find(r => r.isSavedPortfolio && r.savedIndex === state.featuredPortfolioIndex);
    if (!portfolioAnalysis) return;

    const { analysis } = portfolioAnalysis;
    const metrics = analysis;

    const metricsToShow = {
        'Sortino': metrics.sortinoRatio, 'Max DD ($)': `$${metrics.maxDrawdownInDollars.toFixed(0)} `, 'Ulcer Index $': `$${metrics.ulcerIndexInDollars.toFixed(0)} `,
        'Profit Factor': metrics.profitFactor, 'Profit/Mes': `$${metrics.monthlyAvgProfit.toFixed(0)} `, 'Coef. Sharpe': metrics.sharpeRatio, 'Ret/DD': metrics.profitMaxDD_Ratio,
        'UPI': metrics.upi, 'SQN': metrics.sqn,
        'Meses Pérd. Cons. (Max)': metrics.maxConsecutiveLosingMonths,
    };

    let metricsHTML = Object.entries(metricsToShow).map(([key, val]) => {
        const displayVal = typeof val === 'number' ? val.toFixed(2) : val;
        return `< div >
                    <div class="text-xs text-gray-400 uppercase tracking-wide">${key}</div>
                    <div class="text-lg font-bold text-white">${displayVal}</div>
                </div > `;
    }).join('');

    const html = `
    < div class="p-6" >
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-2xl font-bold text-white">Portafolio Destacado</h2>
            </div>
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div class="bg-gray-800 p-6 rounded-xl">
                    <h3 class="text-xl font-semibold text-sky-400 mb-4">${portfolio.name}</h3>
                    <div class="grid grid-cols-2 gap-4">
                        ${metricsHTML}
                    </div>
                    <div> <label class="block text-sm font-medium text-gray-300 mt-4">Comentarios</label>
                        <textarea id="portfolio-comments" class="mt-1 w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white" rows="3">${portfolio.comments || ''}</textarea>
                        <button id="save-comments-btn" class="mt-2 bg-sky-600 hover:bg-sky-700 text-white font-bold py-1 px-3 rounded text-xs">Guardar Comentarios</button>
                        <span id="save-comments-feedback" class="ml-2 text-xs text-green-400"></span>
                    </div>
                </div>
                <div class="lg:col-span-2 bg-gray-800 p-4 rounded-xl">
                     <div class="h-64"><canvas id="featured-portfolio-chart"></canvas></div>
                </div>
            </div>
        </div > `;

    dom.featuredPortfolioSection.innerHTML = html;
    dom.featuredPortfolioSection.classList.remove('hidden');

    renderEquityChart('featured-portfolio-chart', analysis, portfolio.name, '#fbbf24');
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

/**
 * Renderiza la tabla de estrategias individuales.
 */
export const renderStrategiesTable = () => {
    const tableBody = document.getElementById('strategies-table-body');
    renderStrategiesTableModule();
};