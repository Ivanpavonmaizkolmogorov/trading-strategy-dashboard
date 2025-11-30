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
import { unlinkAccount } from './modules/myfxbookUI.js';
import { openSlaveAccountsModal } from './modules/slaveAccounts.js';
import { openStrategyRiskModal } from './modules/strategyRiskViewer.js';


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

    // NUEVO: Inicializar Reality Check
    setTimeout(() => {
        const triggers = document.querySelectorAll('.vs-real-trigger');
        triggers.forEach(trigger => {
            const index = parseInt(trigger.dataset.index);
            const targetId = trigger.dataset.target;
            const result = window.analysisResults.find(r => r.originalIndex === index);
            if (result) {
                renderRealityCheckTab(result, targetId);
            }
        });
    }, 200);
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
 * Renderiza el contenido de la pestaña "Reality Check".
 */
export const renderRealityCheckTab = (strategyResult, containerId) => {
    const container = document.getElementById(containerId);
    // If container is not found, we might be in a context where we need to create it or it's just missing
    if (!container) return;

    // Support both "tab" style (with wrapper) and "panel" style (direct container)
    const wrapper = document.getElementById(`${containerId}-container`);

    // If wrapper exists, handle visibility
    if (wrapper) {
        // 1. Find a linked portfolio that contains this strategy
        const linkedPortfolio = state.savedPortfolios.find(p =>
            p.linkedAccountId &&
            p.indices &&
            p.indices.includes(strategyResult.originalIndex)
        );

        if (!linkedPortfolio) {
            console.log('[RealityCheck] No linked portfolio found for strategy index:', strategyResult.originalIndex);
            wrapper.classList.add('hidden');
            return;
        }
        wrapper.classList.remove('hidden');
    }

    // ... rest of logic ...
    // We need to re-fetch linkedPortfolio if we didn't do it above
    const linkedPortfolio = state.savedPortfolios.find(p =>
        p.linkedAccountId &&
        p.indices &&
        p.indices.includes(strategyResult.originalIndex)
    );

    if (!linkedPortfolio) {
        console.log('[RealityCheck] No linked portfolio found (2nd check) for strategy:', strategyResult.name);
        if (wrapper) wrapper.classList.add('hidden');
        else container.innerHTML = ''; // Clear if direct container and not linked
        return;
    }

    console.log('[RealityCheck] Found linked portfolio:', linkedPortfolio.name);

    const realMetrics = linkedPortfolio.realMetrics;
    if (!realMetrics || !realMetrics.strategyBreakdown) {
        console.warn('[RealityCheck] No real metrics found in portfolio');
        container.innerHTML = '<p class="text-yellow-400 text-xs">Datos de Myfxbook no sincronizados.</p>';
        return;
    }

    // 3. Find specific strategy data
    const stratIndexInPortfolio = linkedPortfolio.indices.indexOf(strategyResult.originalIndex);
    const strategyId = linkedPortfolio.strategyIds ? linkedPortfolio.strategyIds[stratIndexInPortfolio] : null;

    let realStats = null;
    if (state.magicNumberMap && strategyId && state.magicNumberMap[strategyId]) {
        realStats = realMetrics.strategyBreakdown[strategyId];
    }
    if (!realStats) {
        realStats = realMetrics.strategyBreakdown[strategyResult.name];
    }

    if (!realStats) {
        container.innerHTML = `
            <div class="text-gray-400 text-xs">
                <p>No se encontraron datos reales vinculados.</p>
                <p class="text-[10px] mt-1">ID: <span class="font-mono text-blue-300">${strategyId || strategyResult.name}</span></p>
            </div>`;
        return;
    }

    // 4. Compare Metrics
    const backtest = strategyResult.analysis;
    const real = realStats;

    const getDeviationColor = (realVal, btVal, type = 'lower') => {
        if (!btVal) return 'text-gray-400';
        const ratio = realVal / btVal;
        if (type === 'lower') {
            if (ratio > 1.5) return 'text-red-500 font-bold';
            if (ratio > 1.1) return 'text-yellow-400 font-bold';
            return 'text-emerald-400';
        } else {
            if (ratio < 0.5) return 'text-red-500 font-bold';
            if (ratio < 0.8) return 'text-yellow-400 font-bold';
            return 'text-emerald-400';
        }
    };

    const ddColor = getDeviationColor(Math.abs(real.maxDrawdown), Math.abs(backtest.maxDrawdownInDollars), 'lower');
    const consLossColor = getDeviationColor(real.maxConsecutiveLosses, backtest.maxConsecutiveLosses, 'lower');

    container.innerHTML = `
        <div class="overflow-x-auto bg-gray-800/80 rounded p-2 backdrop-blur-sm border border-gray-700 shadow-xl">
            <div class="flex justify-between items-center mb-2 border-b border-gray-700 pb-1">
                 <h3 class="text-xs font-bold text-gray-300 flex items-center gap-1">
                    <span>🩺</span> Reality Check
                 </h3>
                 <span class="text-[10px] text-blue-400 truncate max-w-[100px]" title="${linkedPortfolio.name}">${linkedPortfolio.name}</span>
            </div>
            <table class="w-full text-xs text-left">
                <thead class="text-gray-500 uppercase">
                    <tr>
                        <th class="pb-1">Metric</th>
                        <th class="pb-1 text-right">BT</th>
                        <th class="pb-1 text-right">Real</th>
                        <th class="pb-1 text-center">St</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-700/50">
                    <tr>
                        <td class="py-1 font-medium text-gray-400">Max DD</td>
                        <td class="py-1 text-right text-gray-500">$${Math.abs(backtest.maxDrawdownInDollars).toFixed(0)}</td>
                        <td class="py-1 text-right ${ddColor}">$${Math.abs(real.maxDrawdown).toFixed(0)}</td>
                        <td class="py-1 text-center">${ddColor.includes('red') ? '🔴' : (ddColor.includes('yellow') ? '🟡' : '🟢')}</td>
                    </tr>
                    <tr>
                        <td class="py-1 font-medium text-gray-400">Cons.L</td>
                        <td class="py-1 text-right text-gray-500">${backtest.maxConsecutiveLosses}</td>
                        <td class="py-1 text-right ${consLossColor}">${real.maxConsecutiveLosses}</td>
                        <td class="py-1 text-center">${consLossColor.includes('red') ? '🔴' : (consLossColor.includes('yellow') ? '🟡' : '🟢')}</td>
                    </tr>
                    <tr>
                        <td class="py-1 font-medium text-gray-400">Profit</td>
                        <td class="py-1 text-right text-gray-500">$${backtest.totalProfit.toFixed(0)}</td>
                        <td class="py-1 text-right ${real.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}">$${real.totalProfit.toFixed(0)}</td>
                        <td class="py-1 text-center">-</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
};

// DEBUG FUNCTION
window.debugRealityCheck = () => {
    console.log('[Debug] Triggering Reality Check manually...');
    const container = document.getElementById('strategy-details-container');
    if (!container) {
        console.error('[Debug] Container #strategy-details-container not found!');
        return;
    }
    container.classList.remove('hidden');
    container.style.display = 'block'; // Force display

    let strat = null;

    // 1. Try window.analysisResults
    if (window.analysisResults && window.analysisResults.length > 0) {
        strat = window.analysisResults[0];
    }
    // 2. Try state.savedPortfolios
    else if (state.savedPortfolios && state.savedPortfolios.length > 0) {
        // Find a portfolio with analysis
        const portfolio = state.savedPortfolios.find(p => p.analysis);
        if (portfolio) {
            // We need a STRATEGY, not a portfolio. 
            // But we can't easily get individual strategy analysis from a saved portfolio object 
            // unless we have the raw data loaded.
            // However, we can try to use the portfolio itself just to test the UI rendering, 
            // but renderRealityCheckTab expects a strategy with 'originalIndex'.

            console.warn('[Debug] Found saved portfolios but no raw strategies loaded.');
            console.warn('[Debug] Please load strategies or run analysis first.');

            // Try to fake it if we have metrics
            if (portfolio.realMetrics && portfolio.realMetrics.strategyBreakdown) {
                const firstKey = Object.keys(portfolio.realMetrics.strategyBreakdown)[0];
                if (firstKey) {
                    strat = {
                        name: firstKey,
                        originalIndex: 0, // Fake index
                        analysis: {
                            // Fake backtest data for comparison
                            maxDrawdownInDollars: 100,
                            maxConsecutiveLosses: 2,
                            totalProfit: 500
                        }
                    };
                    console.log('[Debug] Created FAKE strategy from saved portfolio for testing:', strat);
                }
            }
        }
    }

    if (strat) {
        console.log('[Debug] Rendering for strategy:', strat.name);
        // Ensure originalIndex
        if (strat.originalIndex === undefined) strat.originalIndex = 0;

        renderRealityCheckTab(strat, 'strategy-details-container');
    } else {
        console.warn('[Debug] No analysis results found. Please LOAD strategies first.');
        alert('Por favor, CARGA un archivo de estrategias o selecciona un portafolio guardado para ver datos.');
    }
};

/**
 * Crea el HTML para la pestaña de una estrategia individual.
 * @param {Object} result - El resultado del análisis para una estrategia.
 * @returns {Object} Objeto con el HTML para la navegación y el contenido.
 */
const createStrategyTab = (result) => {
    if (result.isPortfolio || result.isSavedPortfolio) return { nav: '', content: '' };

    const tabId = `strategy-${result.originalIndex}`;
    const vsRealTabId = `vs-real-${result.originalIndex}`;

    const nav = `<button id="${tabId}-btn" class="tab-btn text-gray-400 py-2 px-4 text-sm font-medium text-center border-b-2 border-transparent" data-target="${tabId}">${result.name}</button>`;

    const metricsHTML = createMetricsTable(result.analysis);

    const chartsHTML = `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
            <h2 class="text-xl font-bold mb-4">Dispersión de Rendimientos</h2>
            <div class="h-80"><canvas id="scatterChart-${tabId}"></canvas></div>
        </div>
        <div class="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
            <h2 class="text-xl font-bold mb-4">Curva de Lorenz</h2>
            <div class="h-80"><canvas id="lorenzChart-${tabId}"></canvas></div>
        </div>
    </div>`;

    const realityCheckHTML = `
    <div class="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700 mt-6 hidden" id="${vsRealTabId}-container">
        <div class="flex justify-between items-center mb-4">
            <h2 class="text-xl font-bold flex items-center gap-2">
                <span>🩺</span> Reality Check (vs Myfxbook)
            </h2>
            <span class="text-xs text-gray-400" id="${vsRealTabId}-status"></span>
        </div>
        <div id="${vsRealTabId}" class="min-h-[100px]"></div>
    </div>`;

    const triggerScript = `<span class="hidden vs-real-trigger" data-index="${result.originalIndex}" data-target="${vsRealTabId}"></span>`;

    const content = `<div id="${tabId}" class="tab-content space-y-8">
        ${triggerScript}
        ${realityCheckHTML}
        ${metricsHTML}
        ${chartsHTML}
    </div>`;

    return { nav, content };
};

/**
 * Crea el HTML para la tabla de métricas clave de una estrategia.
 * @param {Object} metrics - Objeto de métricas de la estrategia.
 * @returns {string} HTML de la tabla de métricas.
 */
const createMetricsTable = (metrics) => {
    return `< div ><h2 class="text-2xl font-bold text-white mb-4">Métricas Clave</h2>
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

    let portfoliosToDisplay = [...state.savedPortfolios];

    // Filter for Reality Check Mode
    if (state.activeViewMode === 'reality-check') {
        portfoliosToDisplay = portfoliosToDisplay.filter(p => {
            const hasTrades = p.realMetrics && p.realMetrics._tradesById && Object.keys(p.realMetrics._tradesById).length > 0;
            if (hasTrades) {
                console.log(`[UI] Debug Filter: Portfolio "${p.name}" keys:`, Object.keys(p));
                console.log(`[UI] Debug Filter: Portfolio "${p.name}" indices:`, p.indices);
                if (window.analysisResults) {
                    console.log(`[UI] Debug: window.analysisResults length: ${window.analysisResults.length}`);
                    if (p.indices && p.indices.length > 0) {
                        console.log(`[UI] Debug: Resolved names from indices:`, p.indices.map(i => window.analysisResults[i]?.name));
                    }
                } else {
                    console.log(`[UI] Debug: window.analysisResults is undefined/null`);
                }
            }
            return hasTrades;
        });
        console.log(`[UI] Reality Check Filter: Showing ${portfoliosToDisplay.length} / ${state.savedPortfolios.length} portfolios (Linked to Myfxbook)`);
    }

    if (portfoliosToDisplay.length === 0) {
        console.log("DEBUG UI.JS: No hay portafolios guardados (o filtrados), ocultando sección");
        // En el nuevo layout, el contenido siempre está visible, solo vaciamos la tabla
        if (dom.savedPortfoliosBody) {
            const message = state.activeViewMode === 'reality-check'
                ? 'No linked portfolios found. Link a portfolio to Myfxbook to see Reality Check.'
                : 'No hay portafolios guardados';
            dom.savedPortfoliosBody.innerHTML = `<tr><td colspan="10" class="p-4 text-center text-gray-500">${message}</td></tr>`;
        }
        if (dom.savedPortfoliosCount) dom.savedPortfoliosCount.textContent = '0';
        return;
    }

    console.log("DEBUG UI.JS: Hay", portfoliosToDisplay.length, "portafolios para mostrar");
    // En el nuevo layout, la sección siempre está visible
    if (dom.savedPortfoliosCount) {
        dom.savedPortfoliosCount.textContent = `${portfoliosToDisplay.length} `;
        console.log("DEBUG UI.JS: Actualizado contador a", portfoliosToDisplay.length);
    }

    // Get custom column configuration
    const tableConfig = getSavedPortfoliosTableConfig();
    const visibleColumns = tableConfig.visibleColumns || [];

    // Ordenar los portafolios antes de mostrarlos
    portfoliosToDisplay.sort((a, b) => {
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

        // Initial Visibility Check
        const stagnationControls = document.getElementById('stagnation-controls');
        if (stagnationControls && state.activeViewMode === 'reality-check') {
            stagnationControls.classList.remove('hidden');
        }

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

    // Dynamic Real Metrics Column
    const hasRealMetrics = portfoliosToDisplay.some(p => p.realMetrics);
    if (hasRealMetrics) {
        const th = document.createElement('th');
        th.className = 'px-4 py-3 text-center text-xs font-medium text-blue-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10';
        th.textContent = 'Real vs Backtest';
        headerRow.appendChild(th);
    }

    // Action header
    const thAction = document.createElement('th');
    thAction.className = 'px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10';
    thAction.textContent = 'Acciones';
    headerRow.appendChild(thAction);

    dom.savedPortfoliosHeader.appendChild(headerRow);

    // Render Body
    dom.savedPortfoliosBody.innerHTML = '';
    portfoliosToDisplay.forEach((p, index) => {
        // Find original index in state.savedPortfolios for actions
        const originalIndex = state.savedPortfolios.indexOf(p);

        if (!p.metrics || Object.keys(p.metrics).length === 0) {
            return;
        }

        const weightsText = p.weights ? `(${p.weights.map(w => `${(w * 100).toFixed(0)}%`).join('/')})` : '';

        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-700/50 transition-colors cursor-pointer border-b border-gray-700 last:border-0';
        row.dataset.rowType = 'saved';
        row.dataset.rowIndex = originalIndex;

        // Row Click Listener (Focus Mode)
        row.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
            if (window.focusMode) {
                window.focusMode.toggle(p, 'saved', row);
            }
        });

        visibleColumns.forEach(key => {
            const colInfo = ALL_METRICS[key];
            if (!colInfo) return;

            const td = document.createElement('td');
            td.className = 'px-4 py-3 text-gray-300 truncate';

            if (key === 'name') {
                // Name Column Structure
                const container = document.createElement('div');
                container.className = 'flex flex-col gap-1';
                container.dataset.portfolioIndex = originalIndex;

                // Name Display/Edit
                const nameGroup = document.createElement('div');
                nameGroup.className = 'flex items-center gap-2 group portfolio-name-container';
                nameGroup.innerHTML = `
                    <p class="font-semibold text-sky-300 flex items-center gap-2 portfolio-name-display cursor-pointer" title="Click to edit">
                        <span class="portfolio-name-text hover:text-sky-200 transition-colors">${p.name}</span>
                        <span class="text-gray-500 opacity-0 group-hover:opacity-100 hover:text-sky-400 transition-all duration-200 text-xs edit-portfolio-name-btn p-1 rounded hover:bg-gray-700">✏️</span>
                    </p>
                    <input type="text" class="hidden portfolio-name-input bg-gray-700 text-white border border-gray-600 rounded px-2 py-1 text-xs w-full max-w-[200px] focus:outline-none focus:border-sky-500 shadow-sm" value="${p.name}">
                `;

                // Edit Name Logic (Delegate or attach here? Attach here for simplicity)
                const editBtn = nameGroup.querySelector('.edit-portfolio-name-btn');
                const nameDisplay = nameGroup.querySelector('.portfolio-name-display');
                const nameInput = nameGroup.querySelector('.portfolio-name-input');
                const nameText = nameGroup.querySelector('.portfolio-name-text');

                const toggleEdit = (e) => {
                    e.stopPropagation();
                    nameDisplay.classList.add('hidden');
                    nameInput.classList.remove('hidden');
                    nameInput.focus();
                };

                editBtn.addEventListener('click', toggleEdit);
                nameDisplay.addEventListener('click', toggleEdit);

                nameInput.addEventListener('blur', () => {
                    // Save logic would go here (omitted for brevity, relying on existing global listener or need to reimplement?)
                    // Existing logic likely targets .portfolio-name-input.
                    // Let's just toggle visibility back for now.
                    nameDisplay.classList.remove('hidden');
                    nameInput.classList.add('hidden');
                });

                nameInput.addEventListener('click', e => e.stopPropagation());
                nameInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        // Trigger save (simulate blur or call save function)
                        nameInput.blur();
                    }
                });

                container.appendChild(nameGroup);

                // Linked Account Badge
                if (p.linkedAccountId) {
                    const badge = document.createElement('span');
                    badge.className = 'inline-flex items-center gap-1 bg-blue-900/40 text-blue-200 text-[10px] px-1.5 py-0.5 rounded border border-blue-800/50 w-fit';
                    badge.innerHTML = `<span title="Linked to Myfxbook: ${p.linkedAccountName}">🔗 Myfxbook</span>`;

                    const unlinkBtn = document.createElement('button');
                    unlinkBtn.className = 'hover:text-red-400 unlink-portfolio-btn ml-1 font-bold transition-colors';
                    unlinkBtn.dataset.index = originalIndex;
                    unlinkBtn.title = 'Unlink';
                    unlinkBtn.textContent = '×';
                    unlinkBtn.onclick = (e) => {
                        e.stopPropagation();
                        // Call unlink logic (window.unlinkPortfolio?)
                        if (window.unlinkPortfolio) window.unlinkPortfolio(originalIndex);
                    };
                    badge.appendChild(unlinkBtn);
                    container.appendChild(badge);
                }

                // --- REALITY CHECK BADGE & BUTTON ---
                if (state.activeViewMode === 'reality-check' && p.realMetrics) {
                    // Calculate Risk Metrics
                    let ddPercent = 0;
                    let stagPercent = 0;
                    let riskIcon = '🛡️';
                    let riskColor = 'text-green-400';
                    let stagLabel = '';

                    const backtestMaxDD = Math.abs(Number(p.metrics?.maxDrawdownInDollars || p.metrics?.maxDrawdown || 0));
                    let maxRealDD = Math.abs(Number(p.realMetrics?.maxDrawdown || 0));

                    if (p.realMetrics._tradesById) {
                        const allRealTrades = Object.values(p.realMetrics._tradesById).flat()
                            .filter(t => (t.action || t.type) !== 'Deposit' && (t.action || t.type) !== 'Transfer')
                            .sort((a, b) => new Date(a.closeDate || a.closeTime) - new Date(b.closeDate || b.closeTime));

                        if (allRealTrades.length > 0) {
                            // Calculate MaxDD and Equity
                            let maxEq = -Infinity;
                            let lastHighIndex = 0;
                            let lastHighTime = new Date(allRealTrades[0].closeDate || allRealTrades[0].closeTime).getTime();
                            let currentEq = 0;
                            let calculatedMaxDD = 0;

                            allRealTrades.forEach((t, idx) => {
                                currentEq += (t.profit || 0) + (t.swap || 0) + (t.commission || 0);
                                if (currentEq > maxEq) {
                                    maxEq = currentEq;
                                    lastHighIndex = idx;
                                    lastHighTime = new Date(t.closeDate || t.closeTime).getTime();
                                }
                                const dd = maxEq - currentEq;
                                if (dd > calculatedMaxDD) calculatedMaxDD = dd;
                            });

                            // Use calculated MaxDD if original is missing or NaN
                            if (!maxRealDD || isNaN(maxRealDD)) {
                                maxRealDD = calculatedMaxDD;
                                console.log(`[UI] Calculated missing MaxDD for ${p.name}: ${maxRealDD}`);
                            }

                            if (state.stagnationMode === 'trades') {
                                const currentStagnationTrades = (allRealTrades.length - 1) - lastHighIndex;
                                const limit = Number(p.metrics?.maxStagnationTrades || 0);
                                if (limit > 0) stagPercent = (currentStagnationTrades / limit) * 100;
                                stagLabel = 'Stag(T)';
                            } else {
                                const lastDate = new Date(allRealTrades[allRealTrades.length - 1].closeDate || allRealTrades[allRealTrades.length - 1].closeTime).getTime();
                                const currentStagnationDays = (lastDate - lastHighTime) / (1000 * 60 * 60 * 24);
                                const limit = Number(p.metrics?.maxStagnationDays || 0);
                                if (limit > 0) stagPercent = (currentStagnationDays / limit) * 100;
                                stagLabel = 'Stag(D)';
                            }
                        }
                    }

                    console.log(`[UI] Debug Badge: Portfolio ${p.name} - BacktestDD: ${backtestMaxDD}, RealDD: ${maxRealDD}`);

                    if (backtestMaxDD > 0) {
                        ddPercent = (maxRealDD / backtestMaxDD) * 100;
                    } else {
                        ddPercent = 0;
                    }

                    const maxRisk = Math.max(ddPercent, stagPercent);
                    if (maxRisk >= 100) { riskColor = 'text-red-500 font-bold'; riskIcon = '🚨'; }
                    else if (maxRisk >= 80) { riskColor = 'text-orange-400'; riskIcon = '⚠️'; }

                    const badge = document.createElement('span');
                    badge.className = `ml-2 ${riskColor} text-xs bg-gray-800 px-1.5 py-0.5 rounded border border-gray-600`;
                    badge.textContent = `DD: ${ddPercent.toFixed(0)}% | ${stagLabel}: ${stagPercent.toFixed(0)}% ${riskIcon}`;

                    // Append badge to the name group (first line)
                    nameGroup.appendChild(badge);

                    const btn = document.createElement('button');
                    btn.className = 'ml-2 text-gray-400 hover:text-white transition-colors';
                    btn.title = 'View Real Trades';
                    btn.innerHTML = '🔍';
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        openRealTradesModal(originalIndex, 'saved');
                    };
                    nameGroup.appendChild(btn);
                }

                td.appendChild(container);

                // Weights text
                const weightsP = document.createElement('p');
                weightsP.className = 'text-gray-500 text-[10px] mt-0.5';
                weightsP.textContent = weightsText;
                td.appendChild(weightsP);

            } else if (key === 'strategyCount') {
                td.textContent = p.indices ? p.indices.length : 0;
                td.className += ' text-right';
            } else {
                const value = p.metrics?.[key];
                if (typeof value === 'number') {
                    td.textContent = formatMetricForDisplay(value, key);
                    td.className += ' text-right';
                    if (!['totalTrades', 'maxStagnationTrades', 'maxStagnationDays'].includes(key)) {
                        td.className += value >= 0 ? ' text-green-400' : ' text-red-400';
                    }
                } else {
                    td.textContent = value || '-';
                    td.className += ' text-right';
                }
            }
            row.appendChild(td);
        });

        // Real vs Backtest Column (if enabled)
        if (hasRealMetrics) {
            const td = document.createElement('td');
            td.className = 'px-4 py-3 text-center';
            // Logic for Real vs Backtest values (omitted for now or implement if needed)
            td.textContent = '-';
            row.appendChild(td);
        }

        // Actions Column
        const tdActions = document.createElement('td');
        tdActions.className = 'px-4 py-3 text-center whitespace-nowrap'; // Added whitespace-nowrap

        const isFeatured = originalIndex === state.featuredPortfolioIndex;
        const isCompared = originalIndex === state.comparisonPortfolioIndex;

        tdActions.innerHTML = `
            <button data-index="${originalIndex}" class="feature-portfolio-btn text-gray-500 hover:text-amber-400 text-xl px-1 ${isFeatured ? 'featured' : ''}" title="Destacar/Acciones">&#9733;</button>
            ${p.weights ? `<button data-index="${originalIndex}" class="compare-original-btn text-gray-500 hover:text-amber-400 text-xl px-1 ${isCompared ? 'active' : ''}" title="Comparar con Original">🔄</button>` : ''}
            <button data-index="${originalIndex}" class="manage-slave-accounts-btn text-gray-400 hover:text-sky-400 text-lg px-1 relative" title="Gestionar Cuentas Esclavas">
                👥
                ${(p.slaveAccounts && p.slaveAccounts.length > 0) ? `<span class="absolute -top-1 -right-1 flex h-3 w-3"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span><span class="relative inline-flex rounded-full h-3 w-3 bg-sky-500"></span></span>` : ''}
            </button>
            <button data-index="${originalIndex}" class="delete-portfolio-btn text-gray-400 hover:text-red-400 text-lg px-1" title="Eliminar">🗑️</button>
            <button data-index="${originalIndex}" class="optimize-portfolio-btn text-sky-400 hover:text-sky-300 text-lg px-1" title="Optimizar">⚙️</button>
        `;

        // Event Listeners for Actions
        const featureBtn = tdActions.querySelector('.feature-portfolio-btn');
        if (featureBtn) featureBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFeaturedPortfolio(originalIndex);
        });

        const compareBtn = tdActions.querySelector('.compare-original-btn');
        if (compareBtn) compareBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleComparisonPortfolio(originalIndex);
        });

        const slaveBtn = tdActions.querySelector('.manage-slave-accounts-btn');
        if (slaveBtn) slaveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.openSlaveAccountsModal) window.openSlaveAccountsModal(originalIndex);
        });

        const deleteBtn = tdActions.querySelector('.delete-portfolio-btn');
        if (deleteBtn) deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSavedPortfolio(originalIndex);
        });

        const optimizeBtn = tdActions.querySelector('.optimize-portfolio-btn');
        if (optimizeBtn) optimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.openOptimizationTab) window.openOptimizationTab(originalIndex);
        });

        row.appendChild(tdActions);
        dom.savedPortfoliosBody.appendChild(row);
    });
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
 * Renderiza la tabla de comparación (Backtest vs Real).
 */
const renderComparisonTable = (portfolioAnalysis) => {
    const container = document.getElementById('comparison-table-container');
    if (!container) return;

    container.innerHTML = '';
    container.classList.remove('hidden');

    const backtestMetrics = portfolioAnalysis.analysis.metrics;
    const realMetrics = portfolioAnalysis.realMetrics;

    if (!backtestMetrics || !realMetrics) return;

    // Helper to calculate diff color
    const getDiffColor = (backtestVal, realVal, isInverse = false) => {
        if (backtestVal === 0) return 'text-gray-400';
        const diff = (realVal - backtestVal) / Math.abs(backtestVal);
        if (Math.abs(diff) < 0.05) return 'text-gray-400'; // < 5% diff
        if (isInverse) {
            return diff < 0 ? 'text-green-400' : 'text-red-400';
        }
        return diff > 0 ? 'text-green-400' : 'text-red-400';
    };

    const createRow = (label, backtestVal, realVal, formatFn, isInverse = false) => {
        const bVal = formatFn ? formatFn(backtestVal) : backtestVal;
        const rVal = formatFn ? formatFn(realVal) : realVal;
        const color = getDiffColor(backtestVal, realVal, isInverse);

        return `
            <tr class="border-b border-gray-700/50 hover:bg-gray-800/50 transition-colors">
                <td class="py-2 px-4 text-gray-400 font-medium">${label}</td>
                <td class="py-2 px-4 text-right font-mono text-gray-300">${bVal}</td>
                <td class="py-2 px-4 text-right font-mono ${color} font-bold">${rVal}</td>
            </tr>
        `;
    };

    const html = `
        <div class="flex flex-col h-full">
            <div class="flex items-center justify-between mb-2 px-2">
                <h3 class="text-xs font-bold text-gray-400 uppercase tracking-wider">Reality Check: ${portfolioAnalysis.name}</h3>
                <span class="text-[10px] text-gray-500">Live data from Myfxbook</span>
            </div>
            <div class="overflow-auto flex-1 custom-scrollbar">
                <table class="w-full text-sm text-left">
                    <thead class="text-xs text-gray-500 uppercase bg-gray-800/50 sticky top-0">
                        <tr>
                            <th class="py-2 px-4 rounded-tl-lg">Metric</th>
                            <th class="py-2 px-4 text-right">Backtest</th>
                            <th class="py-2 px-4 text-right rounded-tr-lg">Real</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${createRow('Total Profit', backtestMetrics.totalNetProfit, realMetrics.profit, (v) => `$${v.toFixed(2)}`)}
                        ${createRow('Drawdown $', backtestMetrics.maxDrawdownInDollars, realMetrics.drawdown, (v) => `$${v.toFixed(2)}`, true)}
                        ${createRow('Trades', backtestMetrics.totalTrades, realMetrics.trades, (v) => v)}
                        ${createRow('Profit Factor', backtestMetrics.profitFactor, realMetrics.profitFactor, (v) => v.toFixed(2))}
                        ${createRow('Sharpe', backtestMetrics.sharpeRatio, realMetrics.sharpe, (v) => v.toFixed(2))}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    container.innerHTML = html;
};

/**
 * Cambia el modo de vista (Backtest vs Reality Check).
 */
export const switchViewMode = (mode) => {
    state.activeViewMode = mode;

    // Update Tab Styles
    const tabBacktest = document.getElementById('tab-backtest');
    const tabReality = document.getElementById('tab-reality-check');

    if (tabBacktest && tabReality) {
        if (mode === 'backtest') {
            tabBacktest.className = 'text-sm font-semibold text-white border-b-2 border-sky-500 pb-1 transition-colors';
            tabReality.className = 'text-sm font-semibold text-gray-400 hover:text-white pb-1 transition-colors';
        } else {
            tabBacktest.className = 'text-sm font-semibold text-gray-400 hover:text-white pb-1 transition-colors';
            tabReality.className = 'text-sm font-semibold text-white border-b-2 border-sky-500 pb-1 transition-colors';
        }
    }

    // Toggle Stagnation Controls & Sync Button Visibility
    const stagnationControls = document.getElementById('stagnation-controls');
    const syncBtn = document.getElementById('reality-check-sync-btn');

    if (mode === 'reality-check') {
        if (stagnationControls) stagnationControls.classList.remove('hidden');
        if (syncBtn) syncBtn.classList.remove('hidden');
    } else {
        if (stagnationControls) stagnationControls.classList.add('hidden');
        if (syncBtn) syncBtn.classList.add('hidden');
    }

    // Re-render charts
    if (window.focusMode && window.focusMode.active) {
        console.log('[UI] Switch View Mode: Focus Mode active, updating focused charts.');
        window.focusMode.updateCharts();
    } else {
        // Normal mode: render saved portfolios ONLY if in Saved Portfolios tab
        if (state.activeTab === 'saved-portfolios') {
            console.log('[UI] Switch View Mode: Refreshing Saved Portfolios Table and Charts.');
            displaySavedPortfoliosList();
            renderPortfolioComparisonCharts(state.savedPortfolios);
        } else {
            console.log(`[UI] Switch View Mode: Active tab is ${state.activeTab}, skipping portfolio chart render.`);
            // Optional: Clear chart or show placeholder?
            // For now, just don't render portfolios.
        }
    }

    // Re-render Strategies Table (to apply filter)
    if (typeof renderStrategiesTable === 'function') {
        renderStrategiesTable();
    } else {
        // Fallback if imported elsewhere
        import('./modules/strategiesTable.js').then(module => {
            if (module.renderStrategiesTable) module.renderStrategiesTable();
        });
    }
};

/**
 * Renderiza los gráficos de comparación de portafolios.
 */
export const renderPortfolioComparisonCharts = (portfolioAnalyses) => {
    console.log('[UI] renderPortfolioComparisonCharts called with', portfolioAnalyses.length, 'items. Mode:', state.activeViewMode);
    const canvasId = 'portfolioEquityChart';
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;

    dom.portfolioComparisonChartSection.classList.remove('hidden');

    if (portfolioAnalyses.length === 0 && state.comparisonPortfolioIndex === null) {
        return;
    }

    let allAnalyses = [...portfolioAnalyses];
    const originalResult = (window.analysisResults || []).find(r => r.isTemporaryOriginal);
    if (originalResult && !allAnalyses.some(a => a.name === originalResult.name)) {
        allAnalyses.push(originalResult);
    }

    // REALITY CHECK: Filter out portfolios without real metrics if in reality-check mode
    if (state.activeViewMode === 'reality-check') {
        const originalCount = allAnalyses.length;
        allAnalyses = allAnalyses.filter(r =>
            r.realMetrics &&
            r.realMetrics._tradesById &&
            Object.keys(r.realMetrics._tradesById).length > 0
        );

        if (allAnalyses.length === 0 && originalCount > 0) {
            console.warn('[UI] Reality Check: All items filtered out due to missing real metrics.');
            // Render "No Data" message on canvas
            const ctx = document.getElementById(canvasId)?.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.font = '16px sans-serif';
                ctx.fillStyle = '#9ca3af'; // gray-400
                ctx.fillText('No Real Data available for the selected item(s).', ctx.canvas.width / 2, ctx.canvas.height / 2);
                ctx.font = '14px sans-serif';
                ctx.fillStyle = '#6b7280'; // gray-500
                ctx.fillText('Please link a Myfxbook account or select a portfolio with real trades.', ctx.canvas.width / 2, ctx.canvas.height / 2 + 25);
                ctx.restore();
            }
            return;
        }
    }

    if (allAnalyses.length === 0) return;

    // 1. Prepare Equity Datasets
    const drawdownDatasets = []; // Initialize here to populate inside map
    const datasets = allAnalyses.flatMap((result, index) => {
        const isFeatured = result.savedIndex === state.featuredPortfolioIndex;
        const analysis = result.analysis || {};
        const chartData = analysis.chartData || {};
        const normalizedData = chartData.equityCurve || [];

        if (!normalizedData.length) {
            console.warn(`[UI] ⚠️ Skipping chart for ${result.name}: No equity curve data found.`, result);
            return [];
        }

        console.log(`[UI] 📈 Preparing dataset for ${result.name}: ${normalizedData.length} points.`);

        let color = result.color || (isFeatured ? '#fbbf24' : (result.isTemporaryOriginal ? '#9ca3af' : STRATEGY_COLORS[(4 + (result.savedIndex ?? index)) % STRATEGY_COLORS.length]));

        // VISUAL ENHANCEMENT: Fade backtest curve in Reality Check mode
        if (state.activeViewMode === 'reality-check') {
            // Convert hex to rgba with low opacity
            if (color.startsWith('#')) {
                const r = parseInt(color.slice(1, 3), 16);
                const g = parseInt(color.slice(3, 5), 16);
                const b = parseInt(color.slice(5, 7), 16);
                color = `rgba(${r}, ${g}, ${b}, 0.3)`; // 30% opacity
            } else if (color.startsWith('rgb')) {
                color = color.replace('rgb', 'rgba').replace(')', ', 0.3)');
            }
        }

        // AUTO-ZOOM & ISOLATION: In Reality Check mode, HIDE backtest data to let Real data scale properly
        let finalData = normalizedData;
        if (state.activeViewMode === 'reality-check') {
            // Hide backtest data completely to focus on Real Evolution
            finalData = [];
            console.log(`[UI] 🔍 Reality Check: Hiding backtest data to focus on Real Evolution.`);
        }

        const returnedDatasets = [{
            label: result.name,
            data: finalData,
            borderColor: color,
            borderWidth: isFeatured ? 3 : 2,
            pointRadius: 0,
            tension: 0.1,
            savedIndex: result.savedIndex,
            order: isFeatured ? 0 : 1,
            analysis: analysis,
            isFeatured: isFeatured
        }];

        // REALITY CHECK: Add Real Equity Curve if available AND mode is 'reality-check'
        if (state.activeViewMode === 'reality-check' && result.realMetrics && result.realMetrics._tradesById && state.magicNumberMap) {
            let allRealTrades = [];
            let strategyNames = [];

            if (result.strategies && Array.isArray(result.strategies)) {
                strategyNames = result.strategies.map(s => s.name || s);
            } else if (result.indices && window.analysisResults) {
                strategyNames = result.indices.map(i => window.analysisResults[i]?.name).filter(Boolean);
            }

            if (strategyNames.length > 0) {
                strategyNames.forEach(stratName => {
                    // Resolve Strategy ID from loaded files
                    let strategyId = stratName;
                    const file = state.loadedStrategyFiles.find(f => f.name === stratName);
                    if (file && file.strategyId) {
                        strategyId = file.strategyId;
                    }

                    // Try lookup by ID first, then Name
                    const magicRaw = state.magicNumberMap[strategyId] || state.magicNumberMap[stratName];

                    if (magicRaw) {
                        let magics = [];
                        if (Array.isArray(magicRaw)) {
                            magics = magicRaw;
                        } else if (typeof magicRaw === 'string') {
                            magics = magicRaw.split(',').map(m => m.trim()).filter(Boolean);
                        } else {
                            magics = [String(magicRaw)];
                        }

                        magics.forEach(m => {
                            if (result.realMetrics._tradesById[m]) {
                                allRealTrades = allRealTrades.concat(result.realMetrics._tradesById[m]);
                            }
                        });
                    }
                });
            }

            if (allRealTrades.length > 0) {
                // Sort by close date
                allRealTrades.sort((a, b) => new Date(a.closeTime) - new Date(b.closeTime));

                // Generate Real Equity Curve (Absolute Profit)
                let currentEquity = 0;
                const realEquityCurve = [];

                if (allRealTrades.length > 0) {
                    const firstDate = new Date(allRealTrades[0].closeDate || allRealTrades[0].closeTime).getTime();
                    realEquityCurve.push({ x: firstDate - 3600000, y: 0 });
                }

                allRealTrades.forEach(trade => {
                    const dateStr = trade.closeDate || trade.closeTime;
                    const tradeDate = new Date(dateStr).getTime();
                    if (!isNaN(tradeDate)) {
                        currentEquity += (trade.profit || 0) + (trade.swap || 0) + (trade.commission || 0);
                        realEquityCurve.push({ x: tradeDate, y: currentEquity });
                    }
                });

                if (realEquityCurve.length > 0) {
                    // Use original opaque color for Real curve
                    const realColor = result.color || (isFeatured ? '#fbbf24' : (result.isTemporaryOriginal ? '#9ca3af' : STRATEGY_COLORS[(4 + (result.savedIndex ?? index)) % STRATEGY_COLORS.length]));

                    // Add Real Equity Dataset
                    returnedDatasets.push({
                        label: `${result.name} (Real)`,
                        data: realEquityCurve,
                        borderColor: realColor,
                        borderWidth: 2,
                        pointRadius: 3, // Make points visible
                        tension: 0.1,
                        order: -2 // On top of everything
                    });

                    // --- DEGRADATION ANALYSIS ---
                    const metrics = result.analysis?.metrics || result.metrics || result.analysis || {};

                    // Hard Stop Line (Trailing based on MaxDD)
                    const hardStopLimit = Math.abs(Number(metrics.maxDrawdownInDollars || metrics.maxDrawdown || 0));

                    if (hardStopLimit > 0) {
                        const hardStopCurve = [];
                        let maxEq = -Infinity;

                        realEquityCurve.forEach(p => {
                            if (p.y > maxEq) maxEq = p.y;
                            hardStopCurve.push({ x: p.x, y: maxEq - hardStopLimit });
                        });

                        returnedDatasets.push({
                            label: 'Hard Stop (MaxDD)',
                            data: hardStopCurve,
                            borderColor: realColor, // Same color as strategy
                            borderWidth: 2,
                            borderDash: [5, 5], // Dashed
                            pointRadius: 0,
                            fill: false,
                            order: -1 // On top
                        });
                    }

                    // Calculate Risk Metrics for Badge (Logic preserved for badge calculation later if needed, but here we just need datasets)
                    // ... (Badge calculation logic is separate in displaySavedPortfoliosList, here we just render charts)
                    // ... (inside realEquityCurve check)
                }
            }
        }

        return returnedDatasets;
    });

    // Cleanup HUD if not in Reality Check
    if (state.activeViewMode !== 'reality-check') {
        const hud = document.getElementById('degradation-hud');
        if (hud) hud.style.display = 'none';
    }

    // 2. Define Crosshair Plugin
    const crosshairPlugin = {
        id: 'crosshairPlugin',
        defaults: {
            width: 1,
            color: 'rgba(156, 163, 175, 0.5)',
            dash: [3, 3],
            labelColor: 'rgba(31, 41, 55, 0.9)',
            textColor: '#f3f4f6'
        },
        beforeDraw: (chart) => {
            const datasets = chart.data.datasets;
            if (!datasets || datasets.length === 0) return;
            const ctx = chart.ctx;
            const xAxis = chart.scales.x;
            const yAxis = chart.scales.y;
            let labelYOffset = 5;

            datasets.forEach((dataset) => {
                const analysis = dataset.analysis;
                if (!analysis) return;
                const metrics = analysis.metrics || analysis;
                if (!metrics || !metrics.maxStagnationStart || !metrics.maxStagnationEnd) return;

                const startDate = new Date(metrics.maxStagnationStart);
                const endDate = new Date(metrics.maxStagnationEnd);
                const startPixel = xAxis.getPixelForValue(startDate.getTime());
                const endPixel = xAxis.getPixelForValue(endDate.getTime());

                if (!startPixel || !endPixel) return;
                const width = endPixel - startPixel;
                const datasetColor = dataset.borderColor || '#38bdf8';

                let r = 56, g = 189, b = 248;
                if (datasetColor.startsWith('#')) {
                    const hex = datasetColor.slice(1);
                    r = parseInt(hex.substr(0, 2), 16);
                    g = parseInt(hex.substr(2, 2), 16);
                    b = parseInt(hex.substr(4, 2), 16);
                }

                ctx.save();
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.15)`;
                ctx.fillRect(startPixel, yAxis.top, width, yAxis.bottom - yAxis.top);
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.9)`;
                ctx.font = 'bold 11px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                const shortName = dataset.label.length > 25 ? dataset.label.substring(0, 22) + '...' : dataset.label;
                const label = `${shortName}: ${metrics.maxStagnationDays} d`;
                ctx.fillText(label, startPixel + width / 2, yAxis.top + labelYOffset);
                labelYOffset += 16;
                ctx.restore();
            });
        },
        afterInit: (chart) => {
            chart.crosshair = { x: 0, y: 0, draw: false };
        },
        afterEvent: (chart, args) => {
            const { inChartArea } = args;
            const { x, y } = args.event;
            const otherChartId = chart.canvas.id === 'portfolioEquityChart' ? 'portfolioDrawdownChart' : 'portfolioEquityChart';
            const otherChart = state.chartInstances[otherChartId];

            chart.crosshair = { x, y, draw: inChartArea };

            if (otherChart && inChartArea) {
                otherChart.crosshair = { x, y: 0, draw: true };
                otherChart.draw();
            } else if (otherChart) {
                otherChart.crosshair = { x: 0, y: 0, draw: false };
                otherChart.draw();
            }
            args.changed = true;

            // Tooltip Logic
            const infoPanel = document.getElementById('chart-info-panel');
            const infoDate = document.getElementById('chart-info-date');
            const infoBody = document.getElementById('chart-info-body');

            if (inChartArea && infoPanel && infoDate && infoBody) {
                const tooltipX = args.event.native.clientX;
                const tooltipY = args.event.native.clientY;
                const tooltipWidth = infoPanel.offsetWidth || 220;
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

                const activePoints = chart.getElementsAtEventForMode(args.event, 'index', { intersect: false }, true);

                if (activePoints.length > 0) {
                    const firstPoint = activePoints[0];
                    const xValue = chart.data.datasets[firstPoint.datasetIndex].data[firstPoint.index].x;
                    const date = new Date(xValue);
                    infoDate.textContent = date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

                    let html = '';
                    const sortedPoints = [...activePoints].sort((a, b) => {
                        const valA = chart.data.datasets[a.datasetIndex].data[a.index].y;
                        const valB = chart.data.datasets[b.datasetIndex].data[b.index].y;
                        return valB - valA;
                    });

                    sortedPoints.forEach(point => {
                        const dataset = chart.data.datasets[point.datasetIndex];
                        const meta = dataset.savedIndex !== undefined ? allAnalyses.find(a => a.savedIndex === dataset.savedIndex) : null;
                        const initialBalance = meta?.analysis?.metrics?.initial_balance || 10000;
                        const rawY = dataset.data[point.index].y;
                        let equityUSD, ddUSD;

                        if (chart.canvas.id === 'portfolioEquityChart') {
                            equityUSD = (rawY / 100) * initialBalance; // Assuming normalized
                            // If it's Real Equity (not normalized), rawY is already USD?
                            // Wait, Backtest is normalized to 100 base?
                            // If normalizedData is equityCurve, it's usually normalized to 100 in this app?
                            // Let's assume standard behavior.
                            // BUT Real Equity we calculated as absolute USD profit added to start equity.
                            // If start equity was normalized (e.g. 100), then Real Equity is also normalized-ish.
                            // However, the tooltip logic assumes percentage for backtest?
                            // Let's stick to existing logic for now.

                            const ddChart = state.chartInstances['portfolioDrawdownChart'];
                            if (ddChart) {
                                const ddDataset = ddChart.data.datasets.find(ds => ds.label === dataset.label);
                                ddUSD = (ddDataset && ddDataset.data[point.index]) ? ddDataset.data[point.index].y : 0;
                            } else { ddUSD = 0; }
                        } else {
                            ddUSD = rawY;
                            const eqChart = state.chartInstances['portfolioEquityChart'];
                            if (eqChart) {
                                const eqDataset = eqChart.data.datasets.find(ds => ds.label === dataset.label);
                                const eqRawY = (eqDataset && eqDataset.data[point.index]) ? eqDataset.data[point.index].y : 0;
                                equityUSD = (eqRawY / 100) * initialBalance;
                            } else { equityUSD = 0; }
                        }

                        // Fix for Real Equity which might be in different units if not normalized
                        // For now, assume consistent units.

                        const profitUSD = equityUSD - initialBalance; // Approximate

                        html += `
                            <div class="flex flex-col gap-1 mb-2 border-b border-gray-700/50 pb-2 last:border-0 last:mb-0 last:pb-0">
                                <div class="flex items-center gap-2">
                                    <div class="w-2 h-2 rounded-full" style="background-color: ${dataset.borderColor}"></div>
                                    <span class="text-gray-300 font-bold text-xs">${dataset.label}</span>
                                </div>
                                <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs ml-4">
                                    <div class="text-gray-400">Value:</div>
                                    <div class="text-white font-mono text-right">${rawY.toFixed(2)}</div>
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
            if (!draw) return;

            ctx.save();
            ctx.beginPath();
            ctx.lineWidth = options.width || 1;
            ctx.strokeStyle = options.color || 'rgba(156, 163, 175, 0.5)';
            ctx.setLineDash(options.dash || [3, 3]);
            if (x) { ctx.moveTo(x, top); ctx.lineTo(x, bottom); }
            if (y) { ctx.moveTo(left, y); ctx.lineTo(right, y); }
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

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
            if (yScale && y) {
                const yValue = yScale.getValueForPixel(y);
                const label = new Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(yValue);
                const textWidth = ctx.measureText(label).width + 10;
                ctx.fillStyle = options.labelColor || 'rgba(31, 41, 55, 0.9)';
                ctx.fillRect(right - textWidth, y - 10, textWidth, 20);
                ctx.fillStyle = options.textColor || '#f3f4f6';
                ctx.fillText(label, right - textWidth / 2, y);
            }
            ctx.restore();
        }
    };

    // 3. Prepare Drawdown Datasets
    const ddCanvasId = 'portfolioDrawdownChart';
    destroyChart(ddCanvasId);
    const ddCtx = document.getElementById(ddCanvasId)?.getContext('2d');

    if (ddCtx) {
        ddCtx.canvas.style.cursor = 'crosshair';
        const calculateDrawdownCurve = (equityCurve, initialBalance) => {
            if (!equityCurve || equityCurve.length === 0) return [];
            let maxEquity = -Infinity;
            return equityCurve.map(point => {
                if (point.y > maxEquity) maxEquity = point.y;
                const realEquity = (point.y / 100) * initialBalance;
                const realMax = (maxEquity / 100) * initialBalance;
                return { x: point.x, y: realEquity - realMax };
            });
        };

        const ddDatasets = allAnalyses.map((result, index) => {
            const isFeatured = result.savedIndex === state.featuredPortfolioIndex;
            const color = result.color || (isFeatured ? '#fbbf24' : (result.isTemporaryOriginal ? '#9ca3af' : STRATEGY_COLORS[(4 + (result.savedIndex ?? index)) % STRATEGY_COLORS.length]));

            // REALITY CHECK MODE
            if (state.activeViewMode === 'reality-check' && result.realMetrics && result.realMetrics._tradesById && state.magicNumberMap) {
                let allRealTrades = [];
                let strategyNames = [];

                if (result.strategies && Array.isArray(result.strategies)) {
                    strategyNames = result.strategies.map(s => s.name || s);
                } else if (result.indices && window.analysisResults) {
                    strategyNames = result.indices.map(i => window.analysisResults[i]?.name).filter(Boolean);
                }

                if (strategyNames.length > 0) {
                    strategyNames.forEach(stratName => {
                        const magicRaw = state.magicNumberMap[stratName];
                        if (magicRaw) {
                            let magics = [];
                            if (Array.isArray(magicRaw)) {
                                magics = magicRaw;
                            } else if (typeof magicRaw === 'string') {
                                magics = magicRaw.split(',').map(m => m.trim()).filter(Boolean);
                            } else {
                                magics = [String(magicRaw)];
                            }
                            magics.forEach(m => {
                                if (result.realMetrics._tradesById[m]) {
                                    allRealTrades = allRealTrades.concat(result.realMetrics._tradesById[m]);
                                }
                            });
                        }
                    });
                }

                if (allRealTrades.length > 0) {
                    allRealTrades.sort((a, b) => new Date(b.closeTime) - new Date(a.closeTime)); // Sort by closeTime descending for DD chart? No, ascending for curve generation.
                    // Sort by close date
                    allRealTrades.sort((a, b) => new Date(a.closeTime) - new Date(b.closeTime));

                    // Generate Real Equity Curve
                    let currentEquity = 0;
                    const realEquityCurve = [];
                    if (allRealTrades.length > 0) {
                        const firstDate = new Date(allRealTrades[0].closeTime).getTime();
                        realEquityCurve.push({ x: firstDate - 3600000, y: 0 });
                    }
                    allRealTrades.forEach(trade => {
                        const tradeDate = new Date(trade.closeTime).getTime();
                        currentEquity += (trade.profit || 0) + (trade.swap || 0) + (trade.commission || 0);
                        realEquityCurve.push({ x: tradeDate, y: currentEquity });
                    });

                    // Calculate Drawdown from Real Equity Curve
                    let maxRealEquity = -Infinity;
                    const realDrawdownCurve = realEquityCurve.map(point => {
                        if (point.y > maxRealEquity) maxRealEquity = point.y;
                        return { x: point.x, y: point.y - maxRealEquity };
                    });

                    return {
                        label: `${result.name} (Real)`,
                        data: realDrawdownCurve,
                        borderColor: color,
                        backgroundColor: color + '40',
                        borderWidth: 0,
                        pointRadius: 0,
                        fill: true,
                        tension: 0.1,
                        savedIndex: result.savedIndex,
                        order: isFeatured ? 0 : 1
                    };
                }
                return null;
            }

            // BACKTEST MODE (Default)
            const analysis = result.analysis || {};
            const equityCurve = analysis.chartData?.equityCurve || [];
            const initialBalance = analysis.metrics?.initial_balance || 10000;
            if (!equityCurve.length) return null;

            const drawdownCurve = calculateDrawdownCurve(equityCurve, initialBalance);

            return {
                label: result.name,
                data: drawdownCurve,
                borderColor: color,
                backgroundColor: color + '40',
                borderWidth: 0,
                pointRadius: 0,
                fill: true,
                tension: 0.1,
                savedIndex: result.savedIndex ?? index,
                order: isFeatured ? 0 : 1
            };
        }).filter(ds => ds !== null);

        state.chartInstances[ddCanvasId] = new Chart(ddCtx, {
            type: 'line',
            data: { datasets: ddDatasets.concat(drawdownDatasets) },
            plugins: [crosshairPlugin],
            options: {
                ...CHART_OPTIONS,
                maintainAspectRatio: false,
                layout: { padding: { left: 60, right: 10 } },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    ...CHART_OPTIONS.plugins,
                    legend: { display: false },
                    title: { display: false },
                    tooltip: { enabled: false },
                    crosshair: { color: 'rgba(255, 255, 255, 0.3)', width: 1 }
                },
                scales: {
                    x: {
                        ...CHART_OPTIONS.scales.x,
                        display: false,
                        grid: { display: false },
                        time: { unit: undefined } // Auto-scale to match Equity chart
                    },
                    y: { display: false, grid: { display: false } }
                },
                elements: {
                    point: { radius: 0, hitRadius: 10, hoverRadius: 4 },
                    line: { borderWidth: 0 }
                }
            }
        });
    }

    // Calculate min date from Real datasets if in Reality Check mode
    let minRealDate = undefined;
    if (state.activeViewMode === 'reality-check') {
        datasets.forEach(ds => {
            if (ds.label.includes('(Real)') && ds.data.length > 0) {
                const firstPoint = ds.data[0];
                if (!minRealDate || firstPoint.x < minRealDate) {
                    minRealDate = firstPoint.x;
                }
            }
        });
        // Add some buffer (e.g., 1 day or 1 week before)
        if (minRealDate) {
            minRealDate -= 86400000 * 2; // 2 days buffer
        }
    }

    // 4. Create Equity Chart
    state.chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        plugins: [crosshairPlugin],
        options: {
            ...CHART_OPTIONS,
            maintainAspectRatio: false,
            layout: { padding: { left: 10, right: 10 } },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                ...CHART_OPTIONS.plugins,
                legend: { display: true, position: 'top', labels: { color: '#9ca3af', font: { size: 10 } } },
                tooltip: { enabled: false },
                crosshair: { color: 'rgba(255, 255, 255, 0.3)', width: 1 }
            },
            scales: {
                x: {
                    type: 'time',
                    min: minRealDate,
                    time: { unit: undefined }, // Override unit to auto-scale for Real Equity which might be short-term
                    grid: { color: 'rgba(75, 85, 99, 0.2)' },
                    ticks: { color: '#9ca3af', font: { size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(75, 85, 99, 0.2)' },
                    ticks: { color: '#9ca3af', font: { size: 10 } }
                }
            },
            elements: {
                point: { radius: 0, hitRadius: 10, hoverRadius: 4 },
                line: { borderWidth: 2 }
            },
            onClick: (evt, elements, chart) => {
                console.log('%c[CHART CLICK] 1. Evento onClick del gráfico disparado.', 'color: #f0abfc');
                const points = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true);
                console.log(`%c[CHART CLICK]2. Puntos detectados bajo el cursor: ${points.length} `, 'color: #f0abfc');

                if (points.length) {
                    const firstPoint = points[0];
                    const dataset = chart.data.datasets[firstPoint.datasetIndex];
                    const clickedPortfolioIndex = dataset.savedIndex;
                    console.log(`%c[CHART CLICK]3. Índice de portafolio detectado: ${clickedPortfolioIndex} `, 'color: #f0abfc');

                    if (clickedPortfolioIndex === undefined) {
                        console.log('%c[CHART CLICK] 3.1. Clic en Benchmark. Abortando.', 'color: #f0abfc');
                        return;
                    }

                    const activeAction = document.querySelector('#chart-actions-group .chart-action-item.active')?.dataset.action;
                    console.log(`%c[CHART CLICK]4. Acción activa: '${activeAction}'`, 'color: #f0abfc');

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
                            renderPortfolioComparisonCharts(portfolioAnalyses);
                            window.closeChartClickModal();
                        };

                        console.log('%c[CHART CLICK] 7. Mostrando modal de confirmación.', 'color: #f0abfc');
                        modal.classList.remove('hidden');
                        modal.classList.add('flex');
                        setTimeout(() => {
                            document.getElementById('chart-click-modal-backdrop').classList.remove('opacity-0');
                            document.getElementById('chart-click-modal-content').classList.remove('scale-95', 'opacity-0');
                        }, 10);
                    } else if (activeAction === 'ocultar') {
                        console.log('%c[CHART CLICK] 5. Entrando en la lógica de "ocultar/mostrar".', 'color: #f0abfc; font-weight: bold;');
                        chart.toggleDataVisibility(firstPoint.datasetIndex);
                        chart.update();
                    } else if (activeAction === 'editar') {
                        console.log('%c[CHART CLICK] 5. Entrando en la lógica de "editar".', 'color: #f0abfc; font-weight: bold;');
                        openOptimizationModal(clickedPortfolioIndex);
                    } else {
                        console.log(`%c[CHART CLICK] 5.1. La acción activa ('${activeAction}') no tiene una función de clic definida. No se hace nada.`, 'color: #f0abfc');
                    }
                }
            }
        }
    });

    // REALITY CHECK: Render Comparison Table if single portfolio AND mode is 'reality-check'
    const tableContainer = document.getElementById('comparison-table-container');
    if (tableContainer) {
        if (state.activeViewMode === 'reality-check' && portfolioAnalyses.length === 1 && portfolioAnalyses[0].realMetrics) {
            renderComparisonTable(portfolioAnalyses[0]);
        } else {
            tableContainer.classList.add('hidden');
        }
    }
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

/**
 * Abre el modal de Trades Reales.
 */
export const openRealTradesModal = (index, type = 'strategy') => {
    console.log(`[UI] Opening Real Trades Modal for index: ${index}, type: ${type}`);

    let strategyOrPortfolio;
    let allRealTrades = [];

    if (type === 'saved') {
        strategyOrPortfolio = state.savedPortfolios[index];
        if (strategyOrPortfolio && strategyOrPortfolio.realMetrics && strategyOrPortfolio.realMetrics._tradesById) {
            // For portfolios, trades are directly available (aggregated during analysis)
            // But wait, are they? Yes, analysis.js aggregates them into realMetrics.
            // Let's verify if _tradesById is flat or nested.
            // In analysis.js: realMetrics._tradesById = { ...allTrades };
            // So it should be a map of ticket -> trade.
            // _tradesById is Magic -> Array of Trades. We need to flatten it.
            const tradesArrays = Object.values(strategyOrPortfolio.realMetrics._tradesById);
            allRealTrades = tradesArrays.flat().filter(t => {
                const action = t.action || t.type;
                return action !== 'Deposit' && action !== 'Transfer';
            });
            console.log(`[UI] Debug Real Trades Modal: Found ${allRealTrades.length} trades after flattening and filtering.`);
            if (allRealTrades.length > 0) {
                console.log(`[UI] Debug First Trade:`, allRealTrades[0]);
            }
        }
    } else {
        // Strategy
        strategyOrPortfolio = window.analysisResults[index];
        if (strategyOrPortfolio) {
            // Logic to find Real Trades (copied from strategiesTable.js)
            if (state.magicNumberMap && state.magicNumberMap[strategyOrPortfolio.name]) {
                const magicRaw = state.magicNumberMap[strategyOrPortfolio.name];
                let magics = Array.isArray(magicRaw) ? magicRaw : (typeof magicRaw === 'string' ? magicRaw.split(',') : [String(magicRaw)]);

                state.savedPortfolios.forEach(p => {
                    if (p.realMetrics && p.realMetrics._tradesById) {
                        magics.forEach(m => {
                            const trades = p.realMetrics._tradesById[m.trim()];
                            if (trades) allRealTrades = allRealTrades.concat(trades);
                        });
                    }
                });
            }
        }
    }

    if (!strategyOrPortfolio) {
        console.error('[UI] Item not found.');
        return;
    }

    if (allRealTrades.length === 0) {
        console.warn(`[UI] No real trades found for: ${strategyOrPortfolio.name}`);
    }

    const trades = allRealTrades.sort((a, b) => new Date(b.closeTime) - new Date(a.closeTime)); // Descending order

    const modalTitle = document.getElementById('real-trades-modal-title');
    const modalSubtitle = document.getElementById('real-trades-modal-subtitle');
    const tableBody = document.getElementById('real-trades-table-body');
    const modal = document.getElementById('real-trades-modal');
    const modalContent = document.getElementById('real-trades-modal-content');

    if (modalTitle) modalTitle.textContent = `${strategyOrPortfolio.name} - Real Trades`;
    if (modalSubtitle) modalSubtitle.textContent = `Total Trades: ${trades.length}`;

    if (tableBody) {
        if (trades.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="12" class="p-4 text-center text-gray-500">No real trades found.</td></tr>`;
        } else {
            tableBody.innerHTML = trades.map(t => {
                const netProfit = (t.profit || 0) + (t.commission || 0) + (t.swap || 0);

                return `
                    <tr class="hover:bg-gray-800/50 transition-colors border-b border-gray-700/50 last:border-0">
                        <td>${t.ticket || t.id || '-'}</td>
                        <td>${t.openDate || t.openTime || '-'}</td>
                        <td>${t.action || t.type || '-'}</td>
                        <td>${t.lots || t.size || '-'}</td>
                        <td>${t.symbol || t.item || '-'}</td>
                        <td>${t.openPrice || '-'}</td>
                        <td>${t.closeDate || t.closeTime || '-'}</td>
                        <td>${t.closePrice || '-'}</td>
                        <td class="${(t.commission || 0) < 0 ? 'text-red-400' : 'text-gray-400'}">${(t.commission || 0).toFixed(2)}</td>
                        <td class="${(t.swap || 0) < 0 ? 'text-red-400' : 'text-gray-400'}">${(t.swap || 0).toFixed(2)}</td>
                        <td class="${(t.profit || 0) >= 0 ? 'text-green-400' : 'text-red-400'} font-bold">${(t.profit || 0).toFixed(2)}</td>
                        <td class="${netProfit >= 0 ? 'text-green-400' : 'text-red-400'} font-bold">${netProfit.toFixed(2)}</td>
                    </tr>
                `;
            }).join('');
        }
    }

    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        // Animation
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            if (modalContent) modalContent.classList.remove('scale-95');
        }, 10);
    }
};

/**
 * Cierra el modal de Trades Reales.
 */
export const closeRealTradesModal = () => {
    const modal = document.getElementById('real-trades-modal');
    const modalContent = document.getElementById('real-trades-modal-content');

    if (modal) {
        modal.classList.add('opacity-0');
        if (modalContent) modalContent.classList.add('scale-95');

        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }, 300);
    }
};

// Expose globally
window.openRealTradesModal = openRealTradesModal;
window.closeRealTradesModal = closeRealTradesModal;