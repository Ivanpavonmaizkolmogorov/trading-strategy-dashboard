import { dom } from './dom.js';
import { state } from './state.js';
import { updateDatabankDisplay, sortDatabank } from './modules/databank.js';
import { openOptimizationModal } from './modules/optimization.js';
import { ALL_METRICS, STRATEGY_COLORS, CHART_OPTIONS } from './config.js';
import { destroyChart, destroyAllCharts, formatMetricForDisplay, hideError } from './utils.js';

/**
 * Actualiza la lista de archivos de estrategia cargados en la UI.
 */
export const updateTradesFilesList = () => {
    dom.tradesFilesListEl.innerHTML = '';
    if (state.loadedStrategyFiles.length > 0) {
        state.loadedStrategyFiles.forEach((file, index) => {
            const fileEl = document.createElement('div');
            fileEl.className = 'flex justify-between items-center bg-gray-700/50 p-1 rounded text-gray-300';
            fileEl.innerHTML = `<span class="truncate pr-2">${file.name}</span><button data-index="${index}" class="remove-file-btn text-red-500 hover:text-red-400 font-bold text-lg px-2" title="Eliminar archivo">&times;</button>`;
            dom.tradesFilesListEl.appendChild(fileEl);
        });
    }
};

/**
 * Resetea la interfaz de usuario a su estado inicial.
 */
export const resetUI = () => {
    dom.tradesFileInput.value = '';
    dom.benchmarkFileInput.value = '';
    state.loadedStrategyFiles = [];
    state.rawBenchmarkData = null;
    state.rawStrategiesData = [];
    state.selectedPortfolioIndices.clear();
    state.savedPortfolios = [];
    state.featuredPortfolioIndex = null;
    state.comparisonPortfolioIndex = null;

    updateTradesFilesList();
    updateAnalysisModeSelector();
    dom.benchmarkFileNameEl.textContent = '(date, price)';

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
        dom.analysisModeSelect.innerHTML += `<option value="${i}">Filtrar por ${fileName}</option>`;
    });

    if (state.selectedPortfolioIndices.size > 0) {
        dom.analysisModeSelect.innerHTML += `<option value="portfolio">Filtrar por Portafolio</option>`;
    }

    dom.analysisModeSelect.value = selectedValue;
    if (!dom.analysisModeSelect.querySelector(`option[value="${selectedValue}"]`)) {
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

        const tabToActivate = dom.tabNav.querySelector(`.tab-btn[data-target="${activeTabId}"]`) || dom.tabNav.querySelector('.tab-btn');
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
    updateDatabankDisplay(); // <-- NUEVO: Refrescar el DataBank con las métricas actualizadas.

    const savedPortfolioAnalyses = window.analysisResults.filter(r => r.isSavedPortfolio && !r.isTemporaryOriginal);
    if (savedPortfolioAnalyses.length > 0 || state.comparisonPortfolioIndex !== null) {
        renderPortfolioComparisonCharts(savedPortfolioAnalyses);
    }
    renderFeaturedPortfolio();
};

/**
 * Crea el HTML para la pestaña de resumen.
 * @param {Array} results - Todos los resultados del análisis.
 * @returns {Object} Objeto con el HTML para la navegación y el contenido.
 */
const createSummaryTab = (results) => {
    const tabId = 'summary';
    const nav = `<button class="tab-btn text-gray-400 py-2 px-4 text-sm font-medium text-center border-b-2 border-transparent" data-target="${tabId}">Resumen Comparativo</button>`;

    // Ordenar los resultados antes de mostrarlos
    sortArrayByConfig(results, state.summarySortConfig, r => r.analysis);

    let tableBodyRows = '';
    results.filter(r => !r.isPortfolio && !r.isSavedPortfolio).forEach((result) => {
        const metrics = result.analysis;
        const isChecked = state.selectedPortfolioIndices.has(result.originalIndex) ? 'checked' : '';

        tableBodyRows += `<tr class="border-b border-gray-700 hover:bg-gray-800">
            <td class="p-3 w-8"><input type="checkbox" data-index="${result.originalIndex}" class="portfolio-checkbox form-checkbox h-5 w-5 bg-gray-800 border-gray-600 rounded text-sky-500 focus:ring-sky-600" ${isChecked}></td>
            <td class="p-3 font-semibold"><span class="inline-block w-3 h-3 rounded-full mr-2" style="background-color:${STRATEGY_COLORS[result.originalIndex % STRATEGY_COLORS.length]}"></span>${result.name}</td>
            ${state.defaultMetricColumns.map(key => `<td class="p-3 text-right">${formatMetricForDisplay(metrics[key], key)}</td>`).join('')}
        </tr>`;
    });

    let tableFoot = '';
    const portfolioResult = results.find(r => r.isCurrentPortfolio);
    if (portfolioResult) {
        const metrics = portfolioResult.analysis;
        tableFoot = `<tfoot><tr class="border-t-2 border-sky-500 bg-gray-800/50">
            <td class="p-3 w-8 text-center font-bold text-amber-400">P</td>
            <td class="p-3 font-semibold text-amber-400"><span class="inline-block w-3 h-3 rounded-full mr-2" style="background-color:#f59e0b"></span>${portfolioResult.name}</td>
            ${state.defaultMetricColumns.map(key => `<td class="p-3 text-right font-semibold text-amber-400">${formatMetricForDisplay(metrics[key], key)}</td>`).join('')}
        </tr></tfoot>`;
    }

    const tableHeaders = state.defaultMetricColumns.map(key => {
        const colInfo = ALL_METRICS[key];
        const orderIndicator = state.summarySortConfig.key === key ? `data-order="${state.summarySortConfig.order}"` : '';
        return `<th class="p-3 text-right sortable" data-column="${key}" data-type="numeric" ${orderIndicator}>${colInfo.label}</th>`;
    }).join('');

    const comparativeTableHTML = `<div class="overflow-x-auto bg-gray-800 rounded-lg border border-gray-700">
        <table id="summary-table" class="w-full text-sm text-left">
            <thead class="bg-gray-700 text-xs text-gray-400 uppercase">
                <tr><th class="p-3"></th><th class="p-3 sortable" data-column="name" ${state.summarySortConfig.key === 'name' ? `data-order="${state.summarySortConfig.order}"` : ''}>Estrategia</th>
                ${tableHeaders}
                </tr>
            </thead>
            <tbody>${tableBodyRows}</tbody>
            ${tableFoot}
        </table>
    </div>`;

    const content = `<div id="${tabId}" class="tab-content space-y-8">${comparativeTableHTML}</div>`;
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

    const tabId = `strategy-${result.originalIndex}`;
    const nav = `<button id="${tabId}-btn" class="tab-btn text-gray-400 py-2 px-4 text-sm font-medium text-center border-b-2 border-transparent" data-target="${tabId}">${result.name}</button>`;
    const metrics = result.analysis;

    const metricsHTML = `<div><h2 class="text-2xl font-bold text-white mb-4">Métricas Clave: ${result.name}</h2>
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
    </div>`;

    const chartsHTML = `<div class="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div class="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700 xl:col-span-2"><h2 class="text-xl font-bold">Equity vs. Benchmark</h2><div class="h-96"><canvas id="equityChart-${tabId}"></canvas></div></div>
        <div class="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700"><h2 class="text-xl font-bold">Dispersión de Rendimientos</h2><div class="h-80"><canvas id="scatterChart-${tabId}"></canvas></div></div>
        <div class="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700"><h2 class="text-xl font-bold">Curva de Lorenz</h2><div class="h-80"><canvas id="lorenzChart-${tabId}"></canvas></div></div>
    </div>`;

    const content = `<div id="${tabId}" class="tab-content space-y-8">${metricsHTML}${chartsHTML}</div>`;
    return { nav, content };
};

/**
 * Renderiza los gráficos para una pestaña específica.
 * @param {string} tabId - El ID de la pestaña a renderizar.
 */
export const renderChartsForTab = (tabId) => {
    const results = window.analysisResults;
    if (!results || !tabId) return;

    if (tabId.startsWith('strategy-')) {
        const index = parseInt(tabId.replace('strategy-', ''), 10);
        const result = results.find(r => r.originalIndex === index && !r.isPortfolio && !r.isSavedPortfolio);
        if (!result) return;

        const analysis = result.analysis;
        const color = STRATEGY_COLORS[result.originalIndex % STRATEGY_COLORS.length];

        if (document.getElementById(`equityChart-${tabId}`)) {
            renderEquityChart(`equityChart-${tabId}`, analysis, result.name, color);
            renderScatterChart(`scatterChart-${tabId}`, analysis, color);
            renderLorenzChart(`lorenzChart-${tabId}`, analysis, color);
        }
    }
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
const renderEquityChart = (canvasId, analysis, name, color) => {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    destroyChart(canvasId);

    state.chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                { label: name, data: analysis.chartData.equityCurve, borderColor: color, backgroundColor: `${color}1a`, borderWidth: 2, pointRadius: 0, tension: 0.1, fill: true },
                { label: 'Benchmark', data: analysis.chartData.benchmarkCurve, borderColor: '#f87171', backgroundColor: '#f871711a', borderWidth: 2, pointRadius: 0, tension: 0.1, fill: true }
            ]
        },
        options: CHART_OPTIONS
    });
};

/**
 * Renderiza un gráfico de dispersión de rendimientos.
 */
const renderScatterChart = (canvasId, analysis, color) => {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    destroyChart(canvasId);

    state.chartInstances[canvasId] = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Rendimiento Diario',
                data: analysis.chartData.scatterData,
                backgroundColor: `${color}99`
            }]
        },
        options: {
            ...CHART_OPTIONS,
            scales: {
                x: { ...CHART_OPTIONS.scales.x, title: { display: true, text: 'Rendimiento Benchmark (%)', color: '#d1d5db' } },
                y: { ...CHART_OPTIONS.scales.y, title: { display: true, text: 'Rendimiento Estrategia (%)', color: '#d1d5db' } }
            }
        }
    });
};

/**
 * Renderiza una curva de Lorenz.
 */
const renderLorenzChart = (canvasId, analysis, color) => {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    destroyChart(canvasId);

    state.chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Curva de Beneficios', data: analysis.lorenzData, showLine: true, borderColor: color, backgroundColor: `${color}1a`, tension: .1, pointRadius: 0, fill: true
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
        dom.savedPortfoliosCount.textContent = `${state.savedPortfolios.length}`;
        console.log("DEBUG UI.JS: Actualizado contador a", state.savedPortfolios.length);
    }

    const activeViewColumns = state.tableViews.saved[state.activeViews.saved]?.columns || state.tableViews.saved['default'].columns;

    // Ordenar los portafolios antes de mostrarlos
    state.savedPortfolios.sort((a, b) => {
        // Ahora es simple: cada portafolio tiene sus métricas.
        const sortConfig = state.savedPortfoliosSortConfig;
        let valA = sortConfig.key === 'name' ? a.name : (a.metrics?.[sortConfig.key] ?? 0);
        let valB = sortConfig.key === 'name' ? b.name : (b.metrics?.[sortConfig.key] ?? 0);

        if (typeof valA === 'number') {
            valA = isFinite(valA) ? valA : (sortConfig.order === 'asc' ? Infinity : -Infinity);
            valB = isFinite(valB) ? valB : (sortConfig.order === 'asc' ? Infinity : -Infinity);
        }

        if (valA < valB) return sortConfig.order === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.order === 'asc' ? 1 : -1;
        return 0;
    });

    let headerHTML = '<tr>';
    activeViewColumns.forEach(key => {
        const colInfo = ALL_METRICS[key];
        if (colInfo) {
            const orderIndicator = state.savedPortfoliosSortConfig.key === key ? `data-order="${state.savedPortfoliosSortConfig.order}"` : '';
            headerHTML += `<th class="${colInfo.class} sortable" data-sort-key="${key}" ${orderIndicator}>${colInfo.label}</th>`;
        }
    });
    headerHTML += `<th class="p-2 text-center align-bottom">Acciones</th></tr>`;
    dom.savedPortfoliosHeader.innerHTML = headerHTML;

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

        let rowHTML = `<tr class="text-xs cursor-pointer" data-row-type="saved" data-row-index="${originalIndex}">`;
        activeViewColumns.forEach(key => {
            if (key === 'name') {
                rowHTML += `<td class="p-2"><p class="font-semibold text-sky-300">${p.name}</p><p class="text-gray-400 text-xs">${weightsText}</p></td>`;
            } else {
                const value = p.metrics[key];
                rowHTML += `<td class="p-2 text-right">${formatMetricForDisplay(value, key)}</td>`;
            }
        });

        rowHTML += `<td class="p-2 text-center whitespace-nowrap">
            <button data-index="${originalIndex}" class="feature-portfolio-btn text-gray-500 hover:text-amber-400 text-xl px-1 ${isFeatured ? 'featured' : ''}" title="Destacar/Acciones">&#9733;</button>
            ${p.weights ? `<button data-index="${originalIndex}" class="compare-original-btn text-gray-500 hover:text-amber-400 text-xl px-1 ${isCompared ? 'active' : ''}" title="Comparar con Original">🔄</button>` : ''}
            <button data-index="${originalIndex}" class="view-edit-portfolio-btn bg-teal-600 hover:bg-teal-700 text-white font-bold py-1 px-2 rounded text-xs">Editar</button>
            <button data-index="${originalIndex}" class="delete-portfolio-btn text-red-500 hover:text-red-400 font-bold text-lg px-1">&times;</button>
        </td></tr>`;
        bodyHTML += rowHTML;
    });
    dom.savedPortfoliosBody.innerHTML = bodyHTML;
};

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
    const canvasId = 'portfolioEquityChart'; // ID del canvas
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;

    if (portfolioAnalyses.length > 0 || state.comparisonPortfolioIndex !== null) {
        dom.portfolioComparisonChartSection.classList.remove('hidden');
    } else {
        dom.portfolioComparisonChartSection.classList.add('hidden');
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
        const normalizedData = result.analysis.chartData.equityCurve;

        return {
            label: result.name,
            data: normalizedData,
            borderColor: isFeatured ? '#fbbf24' : (result.isTemporaryOriginal ? '#9ca3af' : STRATEGY_COLORS[(4 + result.savedIndex) % STRATEGY_COLORS.length]),
            borderWidth: isFeatured ? 3 : 2,
            pointRadius: 0,
            tension: 0.1,
            savedIndex: result.savedIndex,
            order: isFeatured ? 0 : 1
        };
    });

    const firstAnalysis = allAnalyses[0].analysis;
    datasets.push({ label: 'Benchmark', data: firstAnalysis.chartData.benchmarkCurve, borderColor: '#f87171', borderWidth: 2, pointRadius: 0, tension: 0.1, borderDash: [5, 5] });

    const chartOptionsWithClick = {
        // Hacemos una copia profunda de las opciones para evitar conflictos
        ...CHART_OPTIONS, // Usamos la copia superficial, es más simple.
        onClick: (evt, elements, chart) => {
            console.log('%c[CHART CLICK] 1. Evento onClick del gráfico disparado.', 'color: #f0abfc');
            const points = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true);
            console.log(`%c[CHART CLICK] 2. Puntos detectados bajo el cursor: ${points.length}`, 'color: #f0abfc');

            if (points.length) {
                const firstPoint = points[0];
                const dataset = chart.data.datasets[firstPoint.datasetIndex];
                const clickedPortfolioIndex = dataset.savedIndex;
                console.log(`%c[CHART CLICK] 3. Índice de portafolio detectado: ${clickedPortfolioIndex}`, 'color: #f0abfc');

                if (clickedPortfolioIndex === undefined) {
                    console.log('%c[CHART CLICK] 3.1. Clic en Benchmark. Abortando.', 'color: #f0abfc');
                    return;
                }

                const activeAction = document.querySelector('#chart-actions-group .chart-action-item.active')?.dataset.action;
                console.log(`%c[CHART CLICK] 4. Acción activa: '${activeAction}'`, 'color: #f0abfc');

                if (activeAction === 'destacar') {
                    console.log('%c[CHART CLICK] 5. Entrando en la lógica de "destacar".', 'color: #f0abfc; font-weight: bold;');
                    const portfolio = state.savedPortfolios[clickedPortfolioIndex];
                    if (!portfolio) {
                        console.error(`[CHART CLICK] ERROR: No se encontró el portafolio con índice ${clickedPortfolioIndex}`);
                        return;
                    }

                    const modal = document.getElementById('chart-click-modal');
                    const modalTitle = document.getElementById('chart-click-modal-title');
                    const modalBody = document.getElementById('chart-click-modal-body');
                    const confirmBtn = document.getElementById('chart-click-confirm-btn');

                    modalTitle.textContent = 'Confirmar Destacado';
                    modalBody.textContent = `¿Estás seguro de que quieres establecer "${portfolio.name}" como el portafolio destacado?`;

                    confirmBtn.onclick = () => {
                        console.log(`%c[CHART CLICK] 6. Confirmado. Estableciendo portafolio destacado a índice ${clickedPortfolioIndex}`, 'color: #f0abfc; font-weight: bold;');
                        state.featuredPortfolioIndex = clickedPortfolioIndex;
                        renderFeaturedPortfolio();
                        renderPortfolioComparisonCharts(portfolioAnalyses); // Re-render para actualizar el estilo
                        closeChartClickModal(); // Cierra el modal directamente
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

    state.chartInstances[canvasId] = new Chart(ctx, { type: 'line', data: { datasets }, options: chartOptionsWithClick });
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
        'Sortino': metrics.sortinoRatio, 'Max DD ($)': `$${metrics.maxDrawdownInDollars.toFixed(0)}`, 'Ulcer Index $': `$${metrics.ulcerIndexInDollars.toFixed(0)}`,
        'Profit Factor': metrics.profitFactor, 'Profit/Mes': `$${metrics.monthlyAvgProfit.toFixed(0)}`, 'Coef. Sharpe': metrics.sharpeRatio, 'Ret/DD': metrics.profitMaxDD_Ratio,
        'UPI': metrics.upi, 'SQN': metrics.sqn,
        'Meses Pérd. Cons. (Max)': metrics.maxConsecutiveLosingMonths,
    };

    let metricsHTML = Object.entries(metricsToShow).map(([key, val]) => {
        const displayVal = typeof val === 'number' ? val.toFixed(2) : val;
        return `<div>
                    <div class="text-xs text-gray-400 uppercase tracking-wide">${key}</div>
                    <div class="text-lg font-bold text-white">${displayVal}</div>
                </div>`;
    }).join('');

    const html = `
        <div class="p-6">
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
        </div>`;

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