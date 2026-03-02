import { dom } from './dom.js';
import { state, saveSavedPortfolios } from './state.js';
import { updateDatabankDisplay, savePortfolioFromDatabank, updateDatabankCount } from './modules/databank.js';
import { renderViewerForActiveTab } from './modules/viewer.js'; // NUEVO
import { openOptimizationModal, startOptimizationWorkflow } from './modules/optimization.js';
import { ALL_METRICS, STRATEGY_COLORS, CHART_OPTIONS } from './config.js?v=10';
import { destroyChart, destroyAllCharts, formatMetricForDisplay, hideError, parseCsv } from './utils.js';
import { focusMode } from './modules/focusMode.js';
import { renderStrategiesTable as renderStrategiesTableModule } from './modules/strategiesTable.js';
import { renderSQAnalysis, calculateSQMetrics } from './modules/sqAnalysis_v2.js?v=11';
import { initSavedPortfoliosTable, getSavedPortfoliosTableConfig, selectedSavedPortfolios, clearSelectedSavedPortfolios } from './modules/savedPortfoliosTable.js';
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
// Listener for Data Updates (e.g. Risk Normalization)
document.addEventListener('portfolio-data-updated', () => {
    console.log('[UI] Received portfolio-data-updated event. Refreshing UI components...');
    
    // Refresh Saved Portfolios List & Chart if active
    if (state.activeTab === 'saved-portfolios') {
        displaySavedPortfoliosList();
        renderPortfolioComparisonCharts(state.savedPortfolios);
    }
    
    // Also refresh Strategies Table if needed (it might rely on updated metrics)
    if (typeof renderStrategiesTable === 'function') {
        renderStrategiesTable();
    }
});
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
                {
                    label: name,
                    data: analysis.chartData.equityCurve,
                    borderColor: color,
                    backgroundColor: `${color}1a`,
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.1,
                    fill: true
                }
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
export const getRealTradesByName = (stratName) => {
    // ========== DIAGNOSTIC LOGS ==========
    console.log('%c[DIAG-REALDATA] ═══════════════════════════════════════', 'color: #00ffff; font-weight: bold');
    console.log('%c[DIAG-REALDATA] getRealTradesByName CALLED', 'color: #00ffff; font-weight: bold');
    console.log('[DIAG-REALDATA] Input stratName:', stratName);
    // ========== END DIAGNOSTIC LOGS ==========

    if (!stratName) return [];

    // Normalization Helpers
    const normalize = s => s.replace(/\.csv$/i, '').trim().toLowerCase().replace(/\s+/g, ' ');
    const strictNormalize = s => s.replace(/\.csv$/i, '').trim();
    const stripImproved = s => s.replace(/ - Improved\s*[\d\.]+(?:\(\d+\))?$/, '').trim();
    // Example: "Name - Improved 0.6" -> "Name"

    const normalizedName = normalize(stratName);
    const cleanName = strictNormalize(stratName);
    const fuzzyName = stripImproved(cleanName);

    console.log('[DIAG-REALDATA] Name variations:', { normalizedName, cleanName, fuzzyName });

    // Resolve ID & Robust File Map Key
    let strategyId = stratName;
    let resolvedFileName = null; // Key for map lookup (likely with .csv)

    // Try finding file match (Exact or Fuzzy)
    const file = state.loadedStrategyFiles.find(f => {
        // Strict Match
        if (f.name === stratName) return true;
        // Loose Match (Base Name equal)
        const fBase = f.name.replace(/\.csv$/i, '').trim();
        const sBase = stratName.replace(/\.csv$/i, '').trim();
        return fBase === sBase;
    });

    if (file) {
        if (file.strategyId) strategyId = file.strategyId;
        resolvedFileName = file.name;
        console.log('[DIAG-REALDATA] ✅ File found:', { strategyId, resolvedFileName });
    } else {
        console.log('[DIAG-REALDATA] ⚠️ No file match in loadedStrategyFiles');
    }

    // Lookups
    const mapById = state.magicNumberMap[strategyId];
    const mapByName = state.magicNumberMap[stratName];
    const mapByCleanName = state.magicNumberMap[cleanName];
    const mapByNormName = state.magicNumberMap[normalizedName];

    // Resolved File Lookup (Critical for Portfolio Names vs File Extensions)
    const mapByResolvedFile = resolvedFileName ? state.magicNumberMap[resolvedFileName] : null;

    // New Fuzzy Map Check
    const mapByFuzzy = state.magicNumberMap[fuzzyName]; // Check base name in map

    console.log('[DIAG-REALDATA] Magic lookups:', {
        'byId': mapById ? '✅' : '❌',
        'byResolvedFile': mapByResolvedFile ? '✅' : '❌',
        'byNormName': mapByNormName ? '✅' : '❌',
        'byName': mapByName ? '✅' : '❌',
        'byCleanName': mapByCleanName ? '✅' : '❌',
        'byFuzzy': mapByFuzzy ? '✅' : '❌'
    });

    let magicRaw = mapById || mapByResolvedFile || mapByNormName || mapByName || mapByCleanName || mapByFuzzy;

    // DEBUG: If we found via fuzzy, log it
    // if (!mapById && !mapByName && mapByFuzzy) console.log(`[UI DEBUG] Fuzzy Match found for '${stratName}' -> '${fuzzyName}'`);

    if (!magicRaw) {
        console.log('[DIAG-REALDATA] ❌ No magic number found. Available map keys (first 10):', Object.keys(state.magicNumberMap).slice(0, 10));
        return [];
    }

    console.log('[DIAG-REALDATA] ✅ Magic raw value:', magicRaw);

    let magics = [];
    if (Array.isArray(magicRaw)) magics = magicRaw;
    else if (typeof magicRaw === 'string') magics = magicRaw.split(',').map(m => m.trim()).filter(Boolean);
    else magics = [String(magicRaw)];

    let allRealTrades = [];

    // 1. Search in Saved Portfolios (Legacy / Explicit Links)
    state.savedPortfolios.forEach(p => {
        if (p.realMetrics && p.realMetrics._tradesById) {
            magics.forEach(m => {
                const key = m.trim();
                if (p.realMetrics._tradesById[key]) {
                    allRealTrades = allRealTrades.concat(p.realMetrics._tradesById[key]);
                }
            });
        }
    });

    // 2. Search in Deep Scan Data (Global Cache - Multi-Account Support)
    // This allows "Hybrid" portfolios to pick up real trades even if they aren't explicitly linked to an account,
    // as long as the strategies themselves are mapped.
    if (state.deepScanData) {
        Object.values(state.deepScanData).forEach(accountData => {
            const tradesMap = accountData.tradesById || accountData._tradesById;
            if (!tradesMap) return;

            magics.forEach(m => {
                const magicStr = String(m).trim();
                // Check direct magic match
                if (tradesMap[magicStr]) {
                    allRealTrades = allRealTrades.concat(tradesMap[magicStr]);
                }
                // Check Compound Key (AccountId::Magic) if needed? 
                // Usually map has raw magics, deepScan has raw magics as keys? 
                // It seems deepScan keys are raw magics mostly.
            });
        });
    }

    // 3. FALLBACK: If no trades found via magicNumberMap, search deepScanData by comment/name
    // This mirrors the logic used in calculatePortfolioRealMetrics for aggregate lookups
    if (allRealTrades.length === 0 && state.deepScanData) {
        console.log(`[DIAG-REALDATA] 🔄 Fallback: Searching deepScanData by comment/name for: ${stratName}`);

        Object.entries(state.deepScanData).forEach(([accountId, accountData]) => {
            const tradesMap = accountData.tradesById || accountData._tradesById;
            if (!tradesMap) return;

            Object.entries(tradesMap).forEach(([key, trades]) => {
                // Check if any trade in this group has a matching comment
                const matchingTrades = trades.filter(t => {
                    const comment = (t.comment || t.Comment || '').toString();
                    const normalizedComment = normalize(comment);

                    // Check various match patterns
                    if (normalizedComment === normalizedName) return true;
                    if (strictNormalize(comment) === cleanName) return true;
                    if (stripImproved(strictNormalize(comment)) === fuzzyName) return true;

                    // Also check if comment contains the strategy name
                    if (normalizedComment.includes(normalizedName) || normalizedName.includes(normalizedComment)) return true;

                    return false;
                });

                if (matchingTrades.length > 0) {
                    console.log(`[DIAG-REALDATA] ✅ Found ${matchingTrades.length} trades via comment match in account ${accountId}`);
                    allRealTrades = allRealTrades.concat(matchingTrades);
                }
            });
        });
    }

    console.log(`[DIAG-REALDATA] Final: Found ${allRealTrades.length} real trades for '${stratName}'`);
    return allRealTrades;
};

// --- HELPER: Calculate Real Metrics for Portfolio on the Fly ---
export const calculatePortfolioRealMetrics = (portfolio) => {
    // Return existing if valid? Maybe forcing re-calc is safer to ensure it matches current strategies.
    // if (portfolio.calculatedRealMetrics) return portfolio.calculatedRealMetrics;

    console.log(`[UI] 🧮 Calculating Real Metrics for Portfolio: ${portfolio.name}`);
    let allRealTrades = [];
    // Initialize a map to store trades by strategy name for Lupa lookup
    let reconstructedTradesById = {};
    const sourceData = portfolio.realMetrics && portfolio.realMetrics._tradesById ? portfolio.realMetrics._tradesById : {};

    // Fallback: If portfolio has no trades, maybe we can look in a MASTER portfolio?
    // For now, strictly use portfolio's own attached data (DrGero case).

    let strategyNames = [];
    // Identify Strategies
    if (portfolio.strategyNames && Array.isArray(portfolio.strategyNames)) {
        strategyNames = portfolio.strategyNames;
    } else if (portfolio.strategies && Array.isArray(portfolio.strategies)) {
        strategyNames = portfolio.strategies.map(s => s.name || s);
    } else if (portfolio.indices && window.analysisResults) {
        strategyNames = portfolio.indices.map(i => window.analysisResults[i]?.name).filter(Boolean);
    }

    if (strategyNames.length > 0) {
        const normalize = s => s.replace(/\.csv$/i, '').trim().toLowerCase().replace(/\s+/g, ' ');

        strategyNames.forEach(stratName => {
            // Robust Strategy ID/File Resolution
            let strategyId = stratName;
            let resolvedFileName = null;
            const cleanName = stratName.replace(/\.csv$/i, '').trim();
            const normalizedStratName = normalize(stratName);

            // Try finding file match (Robust)
            const file = state.loadedStrategyFiles.find(f => {
                if (f.name === stratName) return true;
                if (f.name.replace(/\.csv$/i, '').trim() === cleanName) return true;
                return normalize(f.name) === normalizedStratName;
            });

            if (file) {
                if (file.strategyId) strategyId = file.strategyId;
                resolvedFileName = file.name;
            } else {
                console.warn(`[UI DEBUG] ⚠️ File not found for strategy '${stratName}' in loadedStrategyFiles.`);
            }

            // Lookup Magic Numbers
            const mapById = state.magicNumberMap[strategyId];
            const mapByName = state.magicNumberMap[stratName];
            const mapByNormName = state.magicNumberMap[normalizedStratName];
            const mapByCleanName = state.magicNumberMap[cleanName]; // Added CleanName
            const mapByResolvedFile = resolvedFileName ? state.magicNumberMap[resolvedFileName] : null;

            let magicRaw = mapById || mapByResolvedFile || mapByCleanName || mapByNormName || mapByName;
            let currentStratTrades = [];

            if (!magicRaw) {
                console.log(`[UI DEBUG] ❌ No Magic Map for '${stratName}'. Tried: ID=${strategyId}, File=${resolvedFileName}, Clean=${cleanName}`);
                // Debug available keys to see why we missed it
                const keys = Object.keys(state.magicNumberMap);
                console.log(`   -> Total Map Keys: ${keys.length}. Sample:`, keys.slice(0, 10));
                console.log(`   -> Check '[${stratName}]':`, state.magicNumberMap[stratName]);
                console.log(`   -> Check '[${cleanName}]':`, state.magicNumberMap[cleanName]);
                console.log(`   -> Check '[${normalizedStratName}]':`, state.magicNumberMap[normalizedStratName]);
                if (strategyId) console.log(`   -> Check ID '[${strategyId}]':`, state.magicNumberMap[strategyId]);
            } else {
                // console.log(`[UI DEBUG] ✅ Magic Map Found for '${stratName}':`, magicRaw);
            }

            if (magicRaw) {
                let magics = Array.isArray(magicRaw) ? magicRaw : String(magicRaw).split(',').map(m => m.trim()).filter(Boolean);
                magics.forEach(m => {
                    const magicStr = String(m).trim();
                    // 1. Check Local Portfolio Data (Explicit Link)
                    if (sourceData[magicStr]) {
                        currentStratTrades = currentStratTrades.concat(sourceData[magicStr]);
                    }
                    // 2. Check Global Deep Scan Data (Hybrid/Implicit Link)
                    else if (state.deepScanData) {
                        Object.entries(state.deepScanData).forEach(([accountId, accountData]) => {
                            const tradesMap = accountData.tradesById || accountData._tradesById;
                            if (!tradesMap) return;

                            // Parse Compound Key (e.g., "AccountID::MagicNumber")
                            let lookupKey = magicStr;
                            if (magicStr.includes('::')) {
                                const [linkedAcctId, realMagic] = magicStr.split('::');
                                if (String(linkedAcctId) !== String(accountId)) return;
                                lookupKey = realMagic;
                            }

                            // Accumulate matches
                            if (tradesMap[lookupKey]) {
                                currentStratTrades = currentStratTrades.concat(tradesMap[lookupKey]);
                            } else if (tradesMap[magicStr]) {
                                currentStratTrades = currentStratTrades.concat(tradesMap[magicStr]);
                            } else {
                                const lowerLookup = lookupKey.toLowerCase();
                                const match = Object.keys(tradesMap).find(k => k.toLowerCase() === lowerLookup);
                                if (match) {
                                    currentStratTrades = currentStratTrades.concat(tradesMap[match]);
                                }
                            }
                        });
                    }
                });
            }

            // Accumulate found trades into Global List and Index
            if (currentStratTrades.length > 0) {
                allRealTrades = allRealTrades.concat(currentStratTrades);

                // Store in index for Lupa (Implicit Match by Name) using multiple key variations
                reconstructedTradesById[stratName] = currentStratTrades;
                if (normalizedStratName !== stratName) reconstructedTradesById[normalizedStratName] = currentStratTrades;
                if (cleanName !== stratName) reconstructedTradesById[cleanName] = currentStratTrades;
                if (resolvedFileName) reconstructedTradesById[resolvedFileName] = currentStratTrades;
            }
        });
    }

    if (allRealTrades.length > 0) {
        // Normalize for Engine
        const parseDate = (d) => {
            if (!d) return null;
            const clean = typeof d === 'string' ? d.replace(/\./g, '/') : d;
            const dateObj = new Date(clean);
            return isNaN(dateObj.getTime()) ? null : dateObj;
        };

        const normalizedForEngine = allRealTrades.map(t => {
            const p = parseFloat(t.profit) || 0;
            const s = parseFloat(t.swap) || 0;
            const c = parseFloat(t.commission) || 0;
            const pnl = p + s + c;
            const parsedClose = parseDate(t.closeTime || t.closeDate);
            const parsedOpen = parseDate(t.openTime || t.openDate || t.OpenTime);
            const effectiveExit = parsedClose || parsedOpen;
            return {
                ...t, pnl, closeTime: parsedClose, openTime: parsedOpen, exitTime: effectiveExit
            };
        }).filter(t => t.exitTime && !isNaN(t.pnl)).sort((a, b) => a.exitTime - b.exitTime);

        console.log(`[UI] 🧮 Aggregated ${normalizedForEngine.length} trades for ${portfolio.name}`);
        const result = calculateSQMetrics(normalizedForEngine);
        // Attach the trades to the result for equity curve generation
        result._aggregatedTrades = normalizedForEngine;
        // CRITICAL: Attach the reconstructed index so Lupa can lookup individual strategies
        result._tradesById = { ...sourceData, ...reconstructedTradesById }; // Merge old and new
        // Cache it?
        portfolio.calculatedRealMetrics = result;
        return result;
    } else {
        console.warn(`[UI] ⚠️ No real trades found for ${portfolio.name} (Strategies: ${strategyNames.length})`);
        return {};
    }
};


export const displaySavedPortfoliosList = () => {
    // Initialize table if needed
    initSavedPortfoliosTable();

    let portfoliosToDisplay = [...state.savedPortfolios];
    console.log(`[UI DEBUG] Displaying Saved Portfolios. Total in State: ${state.savedPortfolios.length}. Mode: ${state.activeViewMode}`);

    // Filter for Reality Check Mode
    if (state.activeViewMode === 'reality-check') {
        portfoliosToDisplay = portfoliosToDisplay.filter(p => {
            // 1. Direct Linked Trades
            let hasTrades = p.realMetrics && p.realMetrics._tradesById && Object.keys(p.realMetrics._tradesById).length > 0;

            // 2. Aggregated Real Trades (Hybrid/Virtual Portfolio)
            if (!hasTrades) {
                // Use the shared helper ensuring consistent robust lookup
                const aggregatedMetrics = calculatePortfolioRealMetrics(p);

                if (aggregatedMetrics && aggregatedMetrics.totalProfit !== undefined) {
                    hasTrades = true;
                    // Ensure the portfolio object itself is updated with these metrics for the table to render
                    p.realMetrics = {
                        ...p.realMetrics,
                        ...aggregatedMetrics,
                        maxDrawdown: aggregatedMetrics.maxDD,
                        maxDrawdownInDollars: aggregatedMetrics.maxDD, // Using maxDD as the dollar value
                        totalRealProfit: aggregatedMetrics.totalProfit,
                        totalRealTrades: aggregatedMetrics.totalTrades,
                        isAggregated: true
                    };
                    console.log(`[UI] Virtual Portfolio '${p.name}' hydrated via calculatePortfolioRealMetrics. Trades: ${p.realMetrics.totalRealTrades}, _aggregatedTrades: ${p.realMetrics._aggregatedTrades?.length || 0}`);
                } else {
                    console.log(`[UI DEBUG] Portfolio '${p.name}' rejected. calculatePortfolioRealMetrics returned empty.`);
                }
            }
            return hasTrades;
        });
        console.log(`[UI DEBUG] After Reality Check Filter: ${portfoliosToDisplay.length}`);
    }
    if (portfoliosToDisplay.length === 0) {
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

    // En el nuevo layout, la sección siempre está visible
    if (dom.savedPortfoliosCount) {
        dom.savedPortfoliosCount.textContent = `${portfoliosToDisplay.length} `;
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

    // 0. Select All Checkbox Header (New)
    const thSelectAll = document.createElement('th');
    thSelectAll.className = 'px-4 py-3 w-10 text-center text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10';
    thSelectAll.innerHTML = '<input type="checkbox" id="select-all-saved-portfolios" class="form-checkbox h-4 w-4 text-red-500 rounded border-gray-600 bg-gray-700 cursor-pointer" title="Select All for Deletion">';
    headerRow.appendChild(thSelectAll);

    // 1. New Base Portfolio Radio Header
    const thBase = document.createElement('th');
    thBase.className = 'px-4 py-3 w-10 text-center text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10';
    thBase.title = 'Select as Base for Team Search';
    thBase.innerHTML = '🛡️'; // Icon for "Base" or "Defense" or "Team"
    headerRow.appendChild(thBase);

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

        // 0. Checkbox Cell (New)
        const tdCheckbox = document.createElement('td');
        tdCheckbox.className = 'px-4 py-3 text-center';
        tdCheckbox.innerHTML = `
            <input type="checkbox" 
                   class="saved-portfolio-checkbox form-checkbox h-4 w-4 text-red-500 bg-gray-700 border-gray-600 focus:ring-offset-gray-800 cursor-pointer"
                   data-index="${originalIndex}"
                   ${selectedSavedPortfolios.has(originalIndex) ? 'checked' : ''}>
        `;
        row.appendChild(tdCheckbox);

        // 1. Base Portfolio Radio Cell
        const tdBase = document.createElement('td');
        tdBase.className = 'px-4 py-3 text-center';
        tdBase.innerHTML = `
            <input type="radio" 
                   name="base-portfolio-select" 
                   class="form-radio h-4 w-4 text-sky-500 bg-gray-700 border-gray-600 focus:ring-offset-gray-800"
                   data-index="${originalIndex}"
                   ${state.searchBasePortfolioIndex === originalIndex ? 'checked' : ''}
                   title="Use as Base for Team Search">
        `;
        row.appendChild(tdBase);

        // Row Click Listener (Focus Mode) - REMOVED
        // Interaction is now handled by delegation in events.js to prevent duplicate listeners
        // and allow for better control over event propagation.
        /*
        row.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
            if (window.focusMode) {
                window.focusMode.toggle(p, 'saved', row);
            }
        });
        */

        visibleColumns.forEach(key => {
            const colInfo = ALL_METRICS[key];
            if (!colInfo) return;

            const td = document.createElement('td');
            td.className = 'px-4 py-3 text-gray-300 whitespace-nowrap';

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

                // Edit Name Logic is handled globally in events.js via delegation
                // We just render the structure here.

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

                // --- REALITY CHECK / BACKTEST TRADES BUTTON ---
                // Shows 🔍 button if we have Real Metrics (Reality Check) OR if we are in Backtest Mode (Aggregated View)
                const showReal = state.activeViewMode === 'reality-check' && p.realMetrics;
                const showBacktest = state.activeViewMode === 'backtest';

                if (showReal || showBacktest) {
                    // Badge Logic (Only for Reality Check)
                    if (showReal) {
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

                        // console.log(`[UI] Debug Badge: Portfolio ${p.name} - BacktestDD: ${backtestMaxDD}, RealDD: ${maxRealDD}`);

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
                    }

                    const btn = document.createElement('button');
                    btn.className = 'ml-2 text-gray-400 hover:text-white transition-colors';
                    btn.title = showReal ? 'View Real Trades' : 'View Backtest Trades (Aggregated)';
                    btn.innerHTML = '🔍';
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        // Determine type: 'saved' (Real) or 'saved-backtest'
                        const modalType = showReal ? 'saved' : 'saved-backtest';
                        openRealTradesModal(originalIndex, modalType);
                    };
                    nameGroup.appendChild(btn);

                    // Backtest Overlay Toggle (Reality Check Only)
                    if (showReal) {
                        const btnOverlay = document.createElement('button');
                        const isOverlayOn = p.showBacktestOverlay !== false; // Default True
                        btnOverlay.className = `ml-2 transition-colors ${isOverlayOn ? 'text-sky-400 hover:text-sky-300' : 'text-gray-600 hover:text-gray-400'}`;
                        btnOverlay.title = isOverlayOn ? 'Hide Backtest Overlay' : 'Show Backtest Overlay';
                        btnOverlay.innerHTML = '👁️';
                        btnOverlay.onclick = (e) => {
                            e.stopPropagation();
                            p.showBacktestOverlay = !isOverlayOn;
                            // Re-render table to update icon state
                            displaySavedPortfoliosList();
                            // If this portfolio is selected, refresh chart
                            if (selectedSavedPortfolios.has(originalIndex)) {
                                // Trigger chart update logic (simulating selection change or calling render directly)
                                // We need to re-fetch/process data. The easiest way is to trigger the checkbox listener logic
                                // or call the function that updates the chart based on selectedSavedPortfolios.
                                // It seems 'updateComparisonCharts' or similar is used.
                                // Since we don't have direct access to 'updateComparisonCharts' here (it interacts with analysis results),
                                // let's try to trigger a re-render if the main function is exposed or dispatch event.
                                // For now, simple re-render of table is confirmed. Chart update needs 'renderPortfolioComparisonCharts' with data.
                                // Attempt to trigger global update:
                                const event = new CustomEvent('portfolioSelectionChanged');
                                document.dispatchEvent(event);
                            }
                        };
                        nameGroup.appendChild(btnOverlay);
                    }

                    // Risk Breakdown Button
                    const btnRisk = document.createElement('button');
                    btnRisk.className = 'ml-2 text-gray-400 hover:text-white transition-colors';
                    btnRisk.title = 'Portfolio Risk Audit';
                    btnRisk.innerHTML = '📋';
                    btnRisk.onclick = (e) => {
                        e.stopPropagation();
                        if (window.openStrategyBreakdownModal) window.openStrategyBreakdownModal(originalIndex);
                    };
                    nameGroup.appendChild(btnRisk);
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
                let value;
                const isRealMode = state.activeViewMode === 'reality-check';

                // DATA SOURCE TOGGLE: Real vs Backtest
                if (isRealMode) {
                    // Always try to calculate/retrieve aggregated metrics
                    const realStats = calculatePortfolioRealMetrics(p);

                    if (realStats) {
                        value = realStats[key];
                        // Aliases
                        if (value === undefined) {
                            if (key === 'returnDD') value = realStats.profitMaxDD_Ratio || realStats.returnDDRatio;
                            else if (key === 'maxDrawdownInDollars') value = realStats.maxDD;
                        }
                    }
                } else {
                    // Backtest Mode (Default)
                    value = p.metrics?.[key];
                }

                // Fix for Ret/DD mismatch (Backtest key fallback)
                if (key === 'returnDD' && value === undefined && !isRealMode) {
                    value = p.metrics?.['profitMaxDD_Ratio'] || p.metrics?.['returnDDRatio'];
                }

                if (typeof value === 'number') {
                    td.textContent = formatMetricForDisplay(value, key);
                    td.className += ' text-right';
                    if (!['totalTrades', 'maxStagnationTrades', 'maxStagnationDays'].includes(key)) {
                        td.className += value >= 0 ? ' text-green-400' : ' text-red-400';
                    }
                } else {
                    td.textContent = (value !== undefined && value !== null) ? value : '-';
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
            <button data-index="${originalIndex}" onclick="event.stopPropagation(); if(window.openSlaveAccountsModal) window.openSlaveAccountsModal(${originalIndex});" class="manage-slave-accounts-btn text-gray-400 hover:text-sky-400 text-lg px-1 relative" title="Gestionar Cuentas Esclavas">
                👥
                ${(p.slaveAccounts && p.slaveAccounts.length > 0) ? `<span class="absolute -top-1 -right-1 flex h-3 w-3"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span><span class="relative inline-flex rounded-full h-3 w-3 bg-sky-500"></span></span>` : ''}
            </button>
            <button data-index="${originalIndex}" class="view-dd-analysis-btn text-gray-400 hover:text-red-400 text-lg px-1" title="Análisis de Drawdown">📉</button>
            <button data-index="${originalIndex}" class="view-strategy-risk-btn text-gray-400 hover:text-sky-400 text-lg px-1" title="Ver Riesgo Base Estrategias">👁️</button>
            <button data-index="${originalIndex}" class="delete-portfolio-btn text-gray-400 hover:text-red-400 text-lg px-1" title="Eliminar">🗑️</button>
            <button data-index="${originalIndex}" class="optimize-portfolio-btn text-sky-400 hover:text-sky-300 text-lg px-1" title="Optimizar">⚙️</button>
        `;

        // Margin Log Button (Appended AFTER innerHTML to avoid overwrite)
        if (p.metrics && p.metrics.maxMarginLog) {
            const marginBtn = document.createElement('button');
            marginBtn.className = 'text-yellow-400 hover:text-yellow-300 mx-1 transition-colors text-lg px-1';
            marginBtn.title = 'View Margin Log';
            marginBtn.innerHTML = '📊';
            marginBtn.onclick = (e) => {
                e.stopPropagation();
                openMarginLogModal(p.id);
            };
            // Insert before the delete button (or at the end)
            // Let's insert it at the beginning or after the star?
            // Let's just append it for now, or insert before delete button.
            // Actually, just appending is fine, it will appear at the end.
            tdActions.appendChild(marginBtn);
        }

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
    }); // End of portfoliosToDisplay.forEach

    // --- CHECKBOX LOGIC ---
    const selectAllCheckbox = document.getElementById('select-all-saved-portfolios');
    const rowCheckboxes = dom.savedPortfoliosBody.querySelectorAll('.saved-portfolio-checkbox');
    const deleteBtn = document.getElementById('delete-selected-portfolios-btn');
    const correlationBtn = document.getElementById('correlation-selected-portfolios-btn');
    const searchBtn = document.getElementById('search-selected-portfolios-btn');

    const updateDeleteButton = () => {
        const count = selectedSavedPortfolios.size;

        if (count > 0) {
            deleteBtn.classList.remove('hidden');
            deleteBtn.innerHTML = `🗑️ Eliminar (${count})`;
            if (searchBtn) searchBtn.classList.remove('hidden');
        } else {
            deleteBtn.classList.add('hidden');
            if (searchBtn) searchBtn.classList.add('hidden');
        }

        if (correlationBtn) {
            if (count >= 2) {
                correlationBtn.classList.remove('hidden');
            } else {
                correlationBtn.classList.add('hidden');
            }
        }
    };

    // Initialize button state
    updateDeleteButton();

    if (selectAllCheckbox) {
        // Initial state of Select All
        const allChecked = rowCheckboxes.length > 0 && Array.from(rowCheckboxes).every(cb => cb.checked);
        const someChecked = Array.from(rowCheckboxes).some(cb => cb.checked);
        selectAllCheckbox.checked = allChecked;
        selectAllCheckbox.indeterminate = someChecked && !allChecked;

        selectAllCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            rowCheckboxes.forEach(cb => {
                cb.checked = isChecked;
                const index = parseInt(cb.dataset.index);
                if (isChecked) selectedSavedPortfolios.add(index);
                else selectedSavedPortfolios.delete(index);
            });
            updateDeleteButton();
        });
    }

    rowCheckboxes.forEach(cb => {
        cb.addEventListener('change', (e) => {
            const index = parseInt(e.target.dataset.index);
            if (e.target.checked) selectedSavedPortfolios.add(index);
            else selectedSavedPortfolios.delete(index);

            // Update Select All state
            if (selectAllCheckbox) {
                const all = Array.from(rowCheckboxes).every(c => c.checked);
                const some = Array.from(rowCheckboxes).some(c => c.checked);
                selectAllCheckbox.checked = all;
                selectAllCheckbox.indeterminate = some && !all;
            }
            updateDeleteButton();
        });
    });

    // AUTO-RENDER IN REALITY CHECK MODE
    if (state.activeViewMode === 'reality-check') {
        const analysesToRender = portfoliosToDisplay.map(p => {
            return {
                name: p.name,
                savedIndex: state.savedPortfolios.findIndex(sp => sp.id === p.id),
                analysis: p.analysis || p, // Fallback
                realMetrics: p.realMetrics,
                showBacktestOverlay: p.showBacktestOverlay,
                strategyNames: p.strategyNames || p.strategies,
                color: p.color
            };
        }).filter(a => a.savedIndex !== -1);

        console.log(`[ANTIGRAVITY] 🔄 Auto-Rendering ${analysesToRender.length} portfolios for Reality Check.`);
        setTimeout(() => renderPortfolioComparisonCharts(analysesToRender), 50);
    }
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
    // localStorage.setItem('savedPortfoliosTableConfig', JSON.stringify(tableConfig)); // DISABLED
}

/**
 * Initialize Focus Mode listeners for Saved Portfolios
 * DEPRECATED: Logic moved to events.js to prevent duplicate listeners and propagation issues.
 */
export const initSavedPortfoliosFocus = () => {
    // Logic moved to events.js
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
        // localStorage.setItem('savedPortfoliosTableConfig', JSON.stringify(config)); // DISABLED

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

    const backtestMetrics = portfolioAnalysis.analysis?.metrics;
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
                        ${createRow('Total Profit', backtestMetrics.totalNetProfit, realMetrics.profit, (v) => typeof v === 'number' ? `$${v.toFixed(2)}` : '-')}
                        ${createRow('Drawdown $', backtestMetrics.maxDrawdownInDollars, realMetrics.drawdown, (v) => typeof v === 'number' ? `$${v.toFixed(2)}` : '-', true)}
                        ${createRow('Trades', backtestMetrics.totalTrades, realMetrics.trades, (v) => v)}
                        ${createRow('Profit Factor', backtestMetrics.profitFactor, realMetrics.profitFactor, (v) => typeof v === 'number' ? v.toFixed(2) : '-')}
                        ${createRow('Sharpe', backtestMetrics.sharpeRatio, realMetrics.sharpe, (v) => typeof v === 'number' ? v.toFixed(2) : '-')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    container.innerHTML = html;
};



/**
 * Cambia el modo de vista (Backtest vs Reality Check vs SQ Overview vs Real vs SQ).
 */
export const switchViewMode = (mode) => {
    state.activeViewMode = mode;

    // Update Tab Styles
    const tabBacktest = document.getElementById('tab-backtest');
    const tabReality = document.getElementById('tab-reality-check');
    const tabSQ = document.getElementById('tab-sq-stats');


    const activeClass = 'text-sm font-semibold text-white border-b-2 border-sky-500 pb-1 transition-colors';
    const inactiveClass = 'text-sm font-semibold text-gray-400 hover:text-white pb-1 transition-colors';

    if (tabBacktest) tabBacktest.className = mode === 'backtest' ? activeClass : inactiveClass;
    if (tabReality) tabReality.className = mode === 'reality-check' ? activeClass : inactiveClass;
    if (tabSQ) tabSQ.className = mode === 'sq-stats' ? activeClass : inactiveClass;


    // Toggle View Containers
    const chartView = document.getElementById('chart-view-container');
    const sqView = document.getElementById('sq-analysis-view');
    const compTableContainer = document.getElementById('comparison-table-container');

    if (chartView && sqView) {
        // SQ Stats Mode
        if (mode === 'sq-stats') {
            chartView.classList.add('hidden');
            sqView.classList.remove('hidden');
            renderSQAnalysis();
            return;
        }

        // Other Modes: Show Chart View, Hide SQ
        chartView.classList.remove('hidden');
        sqView.classList.add('hidden');

        // Mode specific actions
        if (mode === 'real-vs-sq') {
            // Real vs SQ Audit Mode - REMOVED
            // Legacy functionality was here.
        } else {
            // Backtest / Reality Check
            document.getElementById('portfolioEquityChart').parentElement.classList.remove('hidden');
            document.getElementById('portfolioDrawdownChart').parentElement.classList.remove('hidden');

            if (compTableContainer) {
                compTableContainer.style.maxHeight = '150px';
                compTableContainer.classList.add('hidden'); // Usually hidden unless specifically triggered?
            }

            // Refresh Saved List filtering
            displaySavedPortfoliosList();
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
    // ========== DIAGNOSTIC LOGS ==========
    console.log('%c[DIAG-CHART] ═══════════════════════════════════════', 'color: #00ff00; font-weight: bold');
    console.log('%c[DIAG-CHART] renderPortfolioComparisonCharts CALLED', 'color: #00ff00; font-weight: bold');
    console.log('[DIAG-CHART] portfolioAnalyses.length:', portfolioAnalyses.length);
    console.log('[DIAG-CHART] state.activeViewMode:', state.activeViewMode);
    portfolioAnalyses.forEach((p, i) => {
        console.log(`[DIAG-CHART] Item[${i}]: name="${p.name}", realMetrics=${!!p.realMetrics}, indices=${p.indices?.length || 0}`);
        if (p.realMetrics) {
            console.log(`[DIAG-CHART]   -> realMetrics.totalRealTrades=${p.realMetrics.totalRealTrades}, _tradesById keys=${Object.keys(p.realMetrics._tradesById || {}).length}`);
        }
    });
    // ========== END DIAGNOSTIC LOGS ==========

    console.log('[ANTIGRAVITY] renderPortfolioComparisonCharts called with', portfolioAnalyses.length, 'items. Mode:', state.activeViewMode);
    const canvasId = 'portfolioEquityChart';
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) {
        console.error('[ANTIGRAVITY] Canvas context not found for', canvasId);
        return;
    }

    dom.portfolioComparisonChartSection.classList.remove('hidden');

    if (portfolioAnalyses.length === 0 && state.comparisonPortfolioIndex === null) {
        console.log('[ANTIGRAVITY] No analyses to render and no comparison index.');
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
        allAnalyses = allAnalyses.filter(r => {
            if (!r.realMetrics) return false;
            // Check for direct trades (linked portfolios)
            if (r.realMetrics._tradesById && Object.keys(r.realMetrics._tradesById).length > 0) return true;
            // Check for aggregated trades (virtual portfolios)
            if (r.realMetrics.isAggregated && r.realMetrics.totalRealTrades > 0) return true;
            // Check for _aggregatedTrades array (strategies)
            if (r.realMetrics._aggregatedTrades && r.realMetrics._aggregatedTrades.length > 0) return true;
            return false;
        });

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
        const rawEquityCurve = chartData.equityCurve || [];

        if ((!rawEquityCurve || !rawEquityCurve.length) && state.activeViewMode !== 'reality-check') {
            console.warn(`[UI] ⚠️ Skipping chart for ${result.name}: No equity curve data found.`, result);
            return [];
        }

        console.log(`[UI] 📈 Preparing dataset for ${result.name}: ${rawEquityCurve.length} points.`);
        console.log(`[UI] Debug Result Object Keys:`, Object.keys(result));
        console.log(`[UI] Debug Risk Data:`, result.riskPerStrategy);

        // --- RISK NORMALIZATION SCALING ---
        let finalData = rawEquityCurve || [];

        // [NEW OOP] Fallback to OOP TradeSeries if provided by caller (like Focus Mode)
        if (result.pnlSeries) {
            console.log(`[UI] 🚀 Using TradeSeries Object for Chart Data resolving: ${result.name}`);
            finalData = result.pnlSeries.getEquityCurveFormat();
        } else {
            // [LEGACY] Apply Date Range Filter manually for old paths
            if (state.strategyDateRanges) {
                const sId = result.id || result.name;
                let filter = state.strategyDateRanges[sId] || state.strategyDateRanges[result.name] || (result.name ? state.strategyDateRanges[result.name.replace(/\.csv$/i, '')] : null);

                if (!filter && result.strategyNames && Array.isArray(result.strategyNames)) {
                    for (const stratName of result.strategyNames) {
                        const stratFilter = state.strategyDateRanges[stratName] || state.strategyDateRanges[stratName.replace(/\.csv$/i, '')];
                        if (stratFilter) { filter = stratFilter; break; }
                    }
                }

                if (filter && (filter.start || filter.end)) {
                    const startTs = filter.start ? new Date(filter.start).getTime() : -Infinity;
                    const endTs = filter.end ? new Date(filter.end).getTime() + 86399999 : Infinity;
                    finalData = finalData.filter(pt => {
                        let t;
                        if (typeof pt === 'object') {
                            if ('x' in pt) t = pt.x; else if ('date' in pt) t = pt.date; else if (Array.isArray(pt)) t = pt[0];
                        }
                        if (typeof t === 'string' && isNaN(t)) t = new Date(t).getTime();
                        return t >= startTs && t <= endTs;
                    });
                }
            }
        }

        console.group(`[DEBUG CHART] Portfolio: ${result.name} (Idx: ${result.savedIndex})`);
        console.log(`- Raw Equity Points: ${finalData.length}`);
        if (finalData.length > 0) {
            console.log(`- First Point (Raw):`, finalData[0]);
            console.log(`- Last Point (Raw):`, finalData[finalData.length - 1]);
        }
        console.log(`- Risk Conf (riskPerStrategy):`, result.riskPerStrategy);

        // Check if this portfolio has a scaling factor applied (Risk Normalization)
        // We look for riskPerStrategy. For global normalization, all strategies have same risk.
        // Factor = risk / 100.
        // USER REQUEST: DISABLE NORMALIZATION TO MATCH TABLE KPIs
        // The user wants to see the raw dollar equity that generates the ~113k profit.
        // Since `rawEquityCurve` is Base-100 normalized from the backend, we must DENORMALIZE it
        // using the initial_balance to show Real Dollars.

        const initialBalance = analysis.metrics?.initial_balance || 10000;
        console.log(`[UI] 💵 Denormalizing Chart Data for ${result.name} (Balance: ${initialBalance})`);

        finalData = finalData.map(pt => {
            let val = (typeof pt === 'object' && 'y' in pt) ? pt.y : pt;

            // Formula: (NormalizedValue / 100) * InitialBalance
            // Example: 1141 / 100 * 10000 = 114,100
            let realDollars = (val / 100.0) * initialBalance;

            if (typeof pt === 'object' && pt !== null && 'y' in pt) {
                return { ...pt, y: realDollars };
            }
            return realDollars;
        });

        /* 
        // OLD RISK SCALING - DISABLED
        if (result.riskPerStrategy && result.riskPerStrategy.length > 0) {
             // ...
        }
        */
        console.log('[UI] 🛑 Risk Normalization Disabled by User Request (Showing Real Dollars via Denormalization)');

        let color = result.color || (isFeatured ? '#fbbf24' : (result.isTemporaryOriginal ? '#9ca3af' : STRATEGY_COLORS[(4 + (result.savedIndex ?? index)) % STRATEGY_COLORS.length]));

        // VISUAL ENHANCEMENT: Fade backtest curve in Reality Check mode
        if (state.activeViewMode === 'reality-check') {
            // Convert hex to rgba with low opacity
            if (color.startsWith('#')) {
                const r = parseInt(color.slice(1, 3), 16);
                const g = parseInt(color.slice(3, 5), 16);
                const b = parseInt(color.slice(5, 7), 16);
                color = `rgba(${r}, ${g}, ${b}, 0.6)`; // 60% opacity
            } else if (color.startsWith('rgb')) {
                color = color.replace('rgb', 'rgba').replace(')', ', 0.6)');
            }
        }

        // AUTO-ZOOM & ISOLATION: In Reality Check mode
        if (state.activeViewMode === 'reality-check') {
            // Check for real data from either direct linking (_tradesById) or aggregation (_aggregatedTrades)
            const hasDirectTrades = result.realMetrics && result.realMetrics._tradesById;
            const hasAggregatedTrades = result.realMetrics && result.realMetrics.isAggregated && result.realMetrics._aggregatedTrades;
            const hasRealData = hasDirectTrades || hasAggregatedTrades;
            const showOverlay = result.showBacktestOverlay !== false; // Default TRUE by double-negation (undefined != false -> true)

            const tradeCount = hasDirectTrades
                ? Object.keys(result.realMetrics._tradesById).length
                : (hasAggregatedTrades ? result.realMetrics._aggregatedTrades.length : 0);

            console.log(`[ANTIGRAVITY] 🔍 Reality Check Logic for ${result.name}:`, { showOverlay, hasRealData, hasDirectTrades, hasAggregatedTrades, trades: tradeCount });

            if (showOverlay && hasRealData) {
                let minRealDate = Infinity;

                // Get min date from either source
                if (hasDirectTrades) {
                    Object.values(result.realMetrics._tradesById).flat().forEach(t => {
                        const d = new Date(t.closeTime || t.closeDate).getTime();
                        if (d < minRealDate) minRealDate = d;
                    });
                } else if (hasAggregatedTrades) {
                    result.realMetrics._aggregatedTrades.forEach(t => {
                        const d = t.exitTime ? t.exitTime.getTime() : new Date(t.closeTime || t.closeDate).getTime();
                        if (d < minRealDate) minRealDate = d;
                    });
                }

                if (minRealDate !== Infinity) {
                    console.log(`[ANTIGRAVITY] ✂️ Trimming Backtest to match Real Start: ${new Date(minRealDate).toISOString()} (${minRealDate})`);

                    if (finalData.length > 0) {
                        const originalLen = finalData.length;
                        finalData = finalData.filter(pt => {
                            // Helper to extract Time from generic point structure
                            let t;
                            if (typeof pt === 'object') {
                                if ('x' in pt) {
                                    t = pt.x;
                                    // Fix: Parse string dates (e.g. "2009-01-02") to timestamp
                                    if (typeof t === 'string' && isNaN(t)) {
                                        t = new Date(t).getTime();
                                    }
                                }
                                else if ('date' in pt) t = new Date(pt.date).getTime();
                                else if (Array.isArray(pt)) t = pt[0]; // [x, y]
                            }

                            if (!t) return true; // Keep if no time found (safe fallback)
                            return t >= minRealDate;
                        });
                        console.log(`[ANTIGRAVITY]    - Trimmed from ${originalLen} to ${finalData.length} points.`);
                    } else if (hasAggregatedTrades && result.realMetrics._aggregatedTrades.length > 0) {
                        // NO BACKTEST DATA: Generate equity curve from real trades
                        console.log(`[ANTIGRAVITY] 📈 Generating equity curve from ${result.realMetrics._aggregatedTrades.length} real trades (no backtest available)`);

                        // Sort trades by exit time
                        const sortedTrades = [...result.realMetrics._aggregatedTrades].sort((a, b) => {
                            const timeA = a.exitTime ? a.exitTime.getTime() : new Date(a.closeTime || a.closeDate).getTime();
                            const timeB = b.exitTime ? b.exitTime.getTime() : new Date(b.closeTime || b.closeDate).getTime();
                            return timeA - timeB;
                        });

                        // Build equity curve from trades
                        let runningBalance = initialBalance;
                        finalData = sortedTrades.map(trade => {
                            const pnl = parseFloat(trade.pnl) || 0;
                            runningBalance += pnl;
                            const exitTime = trade.exitTime ? trade.exitTime : new Date(trade.closeTime || trade.closeDate);
                            const dateStr = exitTime instanceof Date ? exitTime.toISOString().split('T')[0] : new Date(exitTime).toISOString().split('T')[0];
                            return { x: dateStr, y: runningBalance };
                        });

                        console.log(`[ANTIGRAVITY]    - Generated ${finalData.length} points from real trades. Final Balance: ${runningBalance.toFixed(2)}`);
                    }
                } else {
                    console.warn('[ANTIGRAVITY] minRealDate is Infinity despite hasRealData=true. Inspect _tradesById structure.');
                }
            } else if (!hasRealData) {
                // Logic to hide backtest if NO real data is handled by the filter loop above?
                // Wait, the filter loop (lines 1803+) removes portfolios without real metrics entirely from 'allAnalyses'.
                // So if we are here, hasRealData SHOULD be true, unless 'realMetrics' exists but '_tradesById' is empty/malformed.
                // But if users toggles Overlay OFF, we clear it.
                if (!showOverlay) {
                    finalData = [];
                    console.log(`[ANTIGRAVITY] 🔍 Overlay explicitly OFF. Hiding backtest data.`);
                }
            } else {
                // hasRealData is FALSE inside here?
                // Logic: showOverlay is T/F.
                // If showOverlay is FALSE -> Clear.
                if (!showOverlay) {
                    finalData = [];
                    console.log(`[ANTIGRAVITY] 🔍 Overlay OFF. Hiding backtest.`);
                }
                // If showOverlay is TRUE but !hasRealData -> We likely show full backtest?
                // OR we strictly hide backtest in Reality Check if it doesn't match Real?
                // Currently: display full backtest if no real data?
                // The filter block at 1803 removed items with NO real metrics.
                // So hasRealData should be true.
            }
        }

        if (finalData !== rawEquityCurve) {
            console.log(`- SCALED Data Points: ${finalData.length}`);
            if (finalData.length > 0) {
                // Check if object or number
                const first = finalData[0];
                const last = finalData[finalData.length - 1];
                const valF = (typeof first === 'object' && 'y' in first) ? first.y : first;
                const valL = (typeof last === 'object' && 'y' in last) ? last.y : last;
                console.log(`- First Point (Scaled): ${valF}`);
                console.log(`- Last Point (Scaled): ${valL}`);

                const graphProfit = valL - valF;
                console.log(`%c- GRAPH PROFIT (Scaled Last - First): ${graphProfit.toFixed(2)}`, 'color: #fbbf24; font-weight: bold;');

                // Try to find the Portfolio Metric Profit for comparison
                const metrics = result.analysis?.metrics || result.metrics || {};

                // VERIFICATION: Sum of Strategy Profits
                // If we have access to individual strategies in `result.strategies` or via indices
                // we can sum their totalProfit to see if it matches the portfolio profit.
                if (result.analysis && result.analysis.results) {
                    // result.analysis.results might be the array of individual strategy analysis
                    // But in 'savedPortfolios', this structure might differ.
                    // Let's rely on the Portfolio Metric first.
                }

                const metricProfit = metrics.totalProfit !== undefined ? metrics.totalProfit : (metrics.totalNetProfit !== undefined ? metrics.totalNetProfit : metrics.netProfit);

                if (metricProfit !== undefined) {
                    console.log(`%c- METRIC PROFIT (Raw/Stored): ${metricProfit.toFixed(2)}`, 'color: #34d399; font-weight: bold;');

                    // Calculate difference
                    const diff = Math.abs(graphProfit - metricProfit);
                    if (diff < 1000) { // Tolerate some diff due to date alignment
                        console.log(`%c✅ MATCH CONFIRMED (Diff: ${diff.toFixed(2)})`, 'color: #34d399; font-weight: bold;');
                    } else {
                        console.log(`%c⚠️ MISMATCH (Diff: ${diff.toFixed(2)}) - Check start/end dates or initial balance logic?`, 'color: #ef4444; font-weight: bold;');
                        console.log(`(Graph: ${graphProfit.toFixed(2)} vs Metric: ${metricProfit.toFixed(2)})`);
                    }
                } else {
                    console.log(`- Metric Profit not found in analysis/metrics keys:`, Object.keys(metrics));
                }
            }
        }

        console.groupEnd();

        const returnedDatasets = [{
            label: result.name,
            data: finalData.map((pt, i, arr) => {
                // Client-side Normalization: Force start at 0
                // We use the first point as baseline.
                // If point is object {x, y}, normalize y.
                if (typeof pt === 'object' && pt !== null && 'y' in pt) {
                    const firstY = arr[0].y;
                    return { ...pt, y: pt.y - firstY };
                }
                // If point is number
                const firstY = typeof arr[0] === 'number' ? arr[0] : arr[0].y;
                return pt - firstY;
            }),
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
            console.log(`[UI] 🔍 Reality Check Block Entered for ${result.name}`);
            let allRealTrades = [];
            let strategyNames = [];

            // PRIORITY: Use explicit strategy names if available (common in Saved Portfolios)
            if (result.strategyNames && Array.isArray(result.strategyNames) && result.strategyNames.length > 0) {
                strategyNames = result.strategyNames;
            } else if (result.strategies && Array.isArray(result.strategies)) {
                // Legacy or Strategy Object array
                strategyNames = result.strategies.map(s => s.name || s);
            } else if (result.indices && window.analysisResults) {
                // Fallback: Resolve via indices (Risk: window.analysisResults might be mixed)
                strategyNames = result.indices.map(i => window.analysisResults[i]?.name).filter(Boolean);
            }

            console.log(`[UI]   Found ${strategyNames.length} strategies to check.`);
            console.log(`[UI]   Strategy Names:`, strategyNames);

            if (strategyNames.length > 0) {
                // Helper to normalize strings for comparison: trim, lowercase, collapse spaces, AND remove .csv extension
                const normalize = s => s.replace(/\.csv$/i, '').trim().toLowerCase().replace(/\s+/g, ' ');

                strategyNames.forEach(stratName => {
                    // 1. Resolve Strategy ID from loaded files with Fuzzy Matching
                    let strategyId = stratName;
                    const normalizedStratName = normalize(stratName);

                    // Try fuzzy find if exact name doesn't match
                    const file = state.loadedStrategyFiles.find(f => normalize(f.name) === normalizedStratName);

                    if (file && file.strategyId) {
                        strategyId = file.strategyId;
                        console.log(`[UI]   Resolved '${stratName}' to ID: ${strategyId}`);
                    } else if (!file) {
                        console.warn(`[UI]   ⚠️ Could not fuzzy match strategy file for: '${stratName}'`);
                    }

                    // 2. Optimized Lookup Priority
                    // Prioritize the ID map first, then Name map.
                    // CRITICAL: Ignore empty arrays if a better match exists.
                    const mapById = state.magicNumberMap[strategyId];
                    const mapByName = state.magicNumberMap[stratName];
                    const mapByNormName = state.magicNumberMap[normalizedStratName];

                    let magicRaw = null;

                    if (Array.isArray(mapById) && mapById.length > 0) {
                        magicRaw = mapById;
                    } else if (Array.isArray(mapByNormName) && mapByNormName.length > 0) {
                        magicRaw = mapByNormName;
                    } else if (Array.isArray(mapByName) && mapByName.length > 0) {
                        magicRaw = mapByName;
                    } else {
                        // Fallback to whatever exists (even if empty, to reflect state)
                        magicRaw = mapById || mapByNormName || mapByName;
                    }

                    if (magicRaw && (!Array.isArray(magicRaw) || magicRaw.length > 0)) {
                        console.log(`[UI]   Strategy '${stratName}' mapped to ${JSON.stringify(magicRaw)}`);
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
                            } else {
                                console.warn(`[UI]   ⚠️ Magic '${m}' mapped but not found in _tradesById.`);
                            }
                        });
                    } else {
                        // FALLBACK: Try Implicit Match via Strategy Name (supported by Virtual Portfolios)
                        const cleanName = stratName.replace(/\.csv$/i, '').trim();
                        if (result.realMetrics._tradesById[stratName]) {
                            console.log(`[UI]   🎯 Implicit Name Match: '${stratName}'`);
                            allRealTrades = allRealTrades.concat(result.realMetrics._tradesById[stratName]);
                        } else if (result.realMetrics._tradesById[normalizedStratName]) {
                            console.log(`[UI]   🎯 Implicit Norm Match: '${normalizedStratName}'`);
                            allRealTrades = allRealTrades.concat(result.realMetrics._tradesById[normalizedStratName]);
                        } else if (result.realMetrics._tradesById[cleanName]) {
                            console.log(`[UI]   🎯 Implicit Clean Match: '${cleanName}'`);
                            allRealTrades = allRealTrades.concat(result.realMetrics._tradesById[cleanName]);
                        } else {
                            console.warn(`[UI]   ❌ No mapping OR implicit match found for '${stratName}'`);
                        }
                    }
                });
            }

            console.log(`[UI]   Total Real Trades Collected: ${allRealTrades.length}`);

            if (allRealTrades.length > 0) {
                // --- VERIFICATION / AUDIT LOGIC ---
                console.group(`[UI] 🧾 AUDIT: Real Trades Verification for ${result.name}`);
                const symbolStats = {};
                let totalAuditProfit = 0;

                allRealTrades.forEach(t => {
                    const sym = t.symbol || 'UNKNOWN';
                    if (!symbolStats[sym]) {
                        symbolStats[sym] = { count: 0, profit: 0, commission: 0, swap: 0, net: 0 };
                    }
                    symbolStats[sym].count++;
                    symbolStats[sym].profit += (parseFloat(t.profit) || 0);
                    symbolStats[sym].commission += (parseFloat(t.commission) || 0);
                    symbolStats[sym].swap += (parseFloat(t.swap) || 0);
                    // Myfxbook usually provides Net Profit as separate field or we sum it up?
                    // Usually 'profit' is gross or net depending on source.
                    // Let's assume t.profit + t.commission + t.swap for now, but also check if 'netProfit' exists.
                    // Based on parsed logic from reference: Net Profit is what we want.
                    // Let's rely on Myfxbook 'profit' + 'commission' + 'swap' as standard Net if explicit 'netProfit' doesn't exist.
                    // But wait, the user's table has "Profit" and "Net Profit".

                    const net = (parseFloat(t.profit) || 0) + (parseFloat(t.commission) || 0) + (parseFloat(t.swap) || 0);
                    symbolStats[sym].net += net;
                    totalAuditProfit += net;
                });

                console.table(Object.keys(symbolStats).map(sym => ({
                    Symbol: sym,
                    Count: symbolStats[sym].count,
                    NetProfit: parseFloat(symbolStats[sym].net.toFixed(2))
                })));
                console.log(`[UI] 💰 TOTAL Calculated Net Profit: ${totalAuditProfit.toFixed(2)}`);
                console.groupEnd();
                // ------------------------------------

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
                        currentEquity += (parseFloat(trade.profit) || 0) + (parseFloat(trade.swap) || 0) + (parseFloat(trade.commission) || 0);
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


                    // Hard Stop Line (Dynamic trailing based on Backtest Max DD)
                    // We want to visualize the "Allowed Drawdown" relative to the peak equity.
                    const backtestMaxDD = Math.abs(parseFloat(metrics.maxDrawdownInDollars || metrics.drawdown || 0));

                    if (backtestMaxDD > 0) {
                        const hardStopCurve = [];
                        let maxEq = -Infinity;

                        // Calculate trailing Hard Stop
                        realEquityCurve.forEach(p => {
                            if (p.y > maxEq) maxEq = p.y;
                            hardStopCurve.push({ x: p.x, y: maxEq - backtestMaxDD });
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

    // 2a. Define Hard Stop Plugin (Reality Check Mode Only)
    // This is a DYNAMIC hard stop that trails the highwater mark of the equity curve
    // The line shows: Current Highwater - Max DD from Backtest
    // Example: If start=0, maxDD=20, highwater=10 → hard stop = 10-20 = -10
    const hardStopPlugin = {
        id: 'hardStopPlugin',
        afterDatasetsDraw: (chart) => {
            if (state.activeViewMode !== 'reality-check') return;

            // Only run on Equity chart, not Drawdown chart
            const canvasId = chart.canvas?.id || '';
            if (canvasId.includes('Drawdown') || canvasId.includes('drawdown')) return;

            const ctx = chart.ctx;
            const yAxis = chart.scales.y;
            const xAxis = chart.scales.x;
            if (!yAxis || !xAxis) return;

            // Get chart area boundaries
            const { left, right, top, bottom } = chart.chartArea;

            let labelYOffset = 0; // For staggering multiple labels

            // 1. Group datasets by "Base Name" to handle priority
            const strategyGroups = {};

            chart.data.datasets.forEach(dataset => {
                const label = dataset.label || '';
                // Skip auxiliary datasets (if any known ones exist, e.g. "Drawdown")
                if (label === 'Drawdown') return;

                const isReal = label.includes('(Real)');
                const baseName = label.replace(' (Real)', '').trim();

                if (!strategyGroups[baseName]) {
                    strategyGroups[baseName] = { real: null, main: null };
                }

                if (isReal) {
                    strategyGroups[baseName].real = dataset;
                } else {
                    strategyGroups[baseName].main = dataset;
                }
            });

            // 2. Iterate each strategy and draw the line for the best available dataset
            Object.keys(strategyGroups).forEach(baseName => {
                const group = strategyGroups[baseName];
                // Priority: Real > Main
                // In Reality Check mode, if we have a separate Real line, we track that.
                // If we replaced the Main line with Real data (no separate Real line), we track Main.
                // If we only have Backtest (Main) and no Real, we track Main (hypothetical).
                const targetDataset = group.real || group.main;

                if (!targetDataset) return;

                const datasetName = baseName;
                const data = targetDataset.data;

                if (!data || data.length === 0) return;

                // Find the maxDD for this strategy from multiple sources
                let maxDD = 0;

                // Source 1: From dataset.analysis (backtest metrics)
                // Note: The 'real' dataset might NOT have the analysis attached directly if created ad-hoc.
                // So check both targetDataset and group.main (which usually holds the metadata)
                // Helper to extract DD with strict priority to Money values
                const extractMaxDD = (obj) => {
                    if (!obj) return 0;
                    const m = obj.metrics || obj;
                    // Strict Money Keys
                    const moneyDD = m['maxDrawdown$'] ||
                        m.maxDrawdownInMoney ||
                        m['Max Drawdown $'] ||
                        m.maxDrawdownInDollars;

                    if (moneyDD) return parseFloat(moneyDD);

                    // Ambiguous Keys (Check if they look like percentage vs money)
                    // If equity is ~10000, and DD is 12 (0.12%), it's likely %. 
                    // But we can't be sure without more context. Treat as fallback.
                    return parseFloat(m.maxDrawdown || m.maxDD || 0);
                };

                // Source 1: From dataset.analysis (Real or Linked Backtest)
                const sourceForAnalysis = group.main || targetDataset;
                let maxDD1 = extractMaxDD(sourceForAnalysis.analysis);
                if (sourceForAnalysis.realMetrics) {
                    const realDD = extractMaxDD(sourceForAnalysis.realMetrics);
                    maxDD1 = Math.max(maxDD1, realDD);
                }

                // Source 2: From Global Backtest Cache (window.analysisResults) - To start with Historical DD
                let maxDD2 = 0;
                if (window.analysisResults) {
                    // Helper to check name match
                    const isMatch = (name) => {
                        if (!name) return false;
                        const n = name.replace('.csv', '');
                        const target = datasetName.replace('.csv', '');
                        return n === target || n === datasetName;
                    };

                    const cached = window.analysisResults.find(a => isMatch(a.name));
                    if (cached) maxDD2 = extractMaxDD(cached.analysis);
                }

                // Use the LARGEST Drawdown found (Historical vs Real vs Current)
                // This ensures we use the 'Worst Case' for the hard stop.
                maxDD = Math.max(maxDD1, maxDD2);

                if (state.activeViewMode === 'reality-check') {
                    console.log(`[HardStopPlugin] 🔍 MaxDD lookup for ${datasetName}:`, {
                        fromDataset: maxDD1,
                        fromCache: maxDD2,
                        final: maxDD
                    });
                }

                if (state.activeViewMode === 'reality-check') {
                    console.log(`[HardStopPlugin] ✅ Final MaxDD used for ${datasetName}: ${maxDD}`);
                }

                if (!maxDD || maxDD <= 0) return;

                // Get the FIRST point (starting point)
                let firstY = 0;
                if (data.length > 0) {
                    const p0 = data[0];
                    firstY = typeof p0 === 'number' ? p0 : (p0 && typeof p0.y !== 'undefined' ? p0.y : 0);
                }

                // Prepare for loop to get X coordinates use scales
                const metaIndex = chart.data.datasets.indexOf(targetDataset);
                const meta = chart.getDatasetMeta(metaIndex);
                if (!meta || !meta.data || meta.data.length === 0) return;

                // Current equity for color calculation
                const lastIdx = data.length - 1;
                const lastPt = data[lastIdx];
                const currentY = typeof lastPt === 'number' ? lastPt : (lastPt && typeof lastPt.y !== 'undefined' ? lastPt.y : 0);

                // 1. Calculate FINAL Highwater/Stop for the Label and Color
                let finalHighwater = -Infinity;
                data.forEach(p => {
                    const v = typeof p === 'number' ? p : p.y;
                    const prof = v - firstY; // Calculate relative to start
                    if (prof > finalHighwater) finalHighwater = prof;
                });
                if (finalHighwater === -Infinity) finalHighwater = 0;

                const finalStopLevel = firstY + (finalHighwater - maxDD);
                const distanceToStop = currentY - finalStopLevel;
                const percentToStop = maxDD > 0 ? (distanceToStop / maxDD) * 100 : 100;

                // Chart Boundaries - DEFINED EARLY FOR LOGGING
                const yMin = yAxis.min;
                const yMax = yAxis.max;
                const chartAreaBottom = chart.chartArea.bottom;
                const chartAreaTop = chart.chartArea.top;

                /* 
                 * NOTE: If MaxDD > Current Profit, the Stop Level will be negative 
                 * and potentially off-screen (below yMin). This is mathematically correct behavior.
                 */


                // Use dataset color for the line base
                const baseColor = targetDataset.borderColor || '#ef4444';

                // 2. Draw the DYNAMIC hard stop line
                ctx.save();
                ctx.beginPath();

                // Color based on CURRENT danger level
                ctx.strokeStyle = percentToStop < 50 ? '#ef4444' : (percentToStop < 100 ? '#f59e0b' : baseColor);
                ctx.lineWidth = 1.5;
                ctx.setLineDash([6, 3]);

                let runningHighwater = -Infinity;
                let started = false;

                // Loop through points
                for (let i = 0; i < data.length; i++) {
                    const point = data[i];
                    const val = typeof point === 'number' ? point : point.y;
                    const profit = val - firstY;

                    if (profit > runningHighwater) runningHighwater = profit;
                    if (runningHighwater === -Infinity) runningHighwater = 0;

                    const currentStopLevel = firstY + (runningHighwater - maxDD);

                    // Pixel Coordinates
                    const x = meta.data[i]?.x;
                    if (x === undefined) continue;

                    // Standard projection - NO CLAMPING (allows line to be off-screen if safe)
                    let yPixel = yAxis.getPixelForValue(currentStopLevel);

                    if (!started) {
                        ctx.moveTo(x, yPixel);
                        started = true;
                    } else {
                        ctx.lineTo(x, yPixel);
                    }
                }

                ctx.stroke();

                // 3. Draw label at the END
                ctx.fillStyle = ctx.strokeStyle;
                ctx.font = 'bold 9px Inter, sans-serif';
                ctx.textAlign = 'right';
                // Position label at the final point's Y
                let finalYPixel;
                if (finalStopLevel < yMin) finalYPixel = chartAreaBottom - 2;
                else if (finalStopLevel > yMax) finalYPixel = chartAreaTop;
                else finalYPixel = yAxis.getPixelForValue(finalStopLevel);

                ctx.textBaseline = 'bottom';

                const textY = (finalStopLevel < yMin) ? finalYPixel - 2 : finalYPixel - 2;

                const shortName = datasetName.length > 15 ? datasetName.substring(0, 12) + '...' : datasetName;
                const statusIcon = percentToStop < 50 ? '🚨' : (percentToStop < 100 ? '⚠️' : '🛡️');
                const relativeStop = finalStopLevel - firstY;
                const label = `${statusIcon} ${shortName}: ${relativeStop >= 0 ? '+' : ''}$${relativeStop.toFixed(0)}`;

                ctx.fillText(label, right - 5, textY - labelYOffset);

                labelYOffset += 12; // Stagger next label

                ctx.restore();
            });

        }
    };

    // 2b. Define Crosshair Plugin
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
                            // USER REQUEST: Show RAW values without transformation.
                            // Since we disabled normalization, rawY is essentially the Equity (or PnL + InitBalance relative).
                            // Let's just use rawY directly as the user requested "dolares sin transformacion".
                            equityUSD = rawY;

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
                                equityUSD = eqRawY;
                            } else { equityUSD = 0; }
                        }

                        // Fix for Real Equity which might be in different units if not normalized
                        // For now, assume consistent units.

                        // const profitUSD = equityUSD - initialBalance; // Approximate

                        html += `
                            <div class="flex flex-col gap-1 mb-2 border-b border-gray-700/50 pb-2 last:border-0 last:mb-0 last:pb-0">
                                <div class="flex items-center gap-2">
                                    <div class="w-2 h-2 rounded-full" style="background-color: ${dataset.borderColor}"></div>
                                    <span class="text-gray-300 font-bold text-xs">${dataset.label}</span>
                                </div>
                                <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs ml-4">
                                    <div class="text-gray-400">Equity:</div>
                                    <div class="text-white font-mono text-right">$${equityUSD.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
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
                        currentEquity += (parseFloat(trade.profit) || 0) + (parseFloat(trade.swap) || 0) + (parseFloat(trade.commission) || 0);
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

    // 3b. Calculate Global Min Y for Hard Stop Visibility
    let globalMinY = undefined;
    if (state.activeViewMode === 'reality-check') {
        let lowestStop = Infinity;

        // Helper to extract DD (replicated from HardStopPlugin)
        const extractMaxDDForGlobalMin = (obj) => {
            if (!obj) return 0;
            const m = obj.metrics || obj;
            const moneyDD = m['maxDrawdown$'] || m.maxDrawdownInMoney || m['Max Drawdown $'] || m.maxDrawdownInDollars;
            if (moneyDD) return parseFloat(moneyDD);
            return parseFloat(m.maxDrawdown || m.maxDD || 0);
        };

        datasets.forEach(ds => {
            // Priority: Check dataset's own analysis => Check Global Cache
            let maxDD = 0;

            // 1. Try local analysis
            if (ds.analysis) {
                maxDD = extractMaxDDForGlobalMin(ds.analysis);
            }

            // 2. Try Global Cache if local failed or looks suspicious (e.g. 0)
            if ((!maxDD || maxDD === 0) && window.analysisResults) {
                const normalize = n => n ? n.replace('.csv', '').trim() : '';
                const targetName = normalize(ds.label).replace(' (Real)', ''); // Strip (Real) suffix

                const cached = window.analysisResults.find(a => normalize(a.name) === targetName);
                if (cached) {
                    const cachedDD = extractMaxDDForGlobalMin(cached.analysis);
                    if (cachedDD > maxDD) maxDD = cachedDD;
                }
            }

            // If we have a maxDD, find the starting Point Y
            if (maxDD > 0 && ds.data.length > 0) {
                const p0 = ds.data[0];
                const firstY = typeof p0 === 'number' ? p0 : (p0 && typeof p0.y !== 'undefined' ? p0.y : 0);
                const stopLevel = firstY - maxDD;
                if (stopLevel < lowestStop) {
                    lowestStop = stopLevel;
                }
            }
        });

        if (lowestStop !== Infinity) {
            // Add a 5% buffer below the stop for aesthetics
            globalMinY = lowestStop - (Math.abs(lowestStop) * 0.05);
        }
    }

    // 4. Create Equity Chart
    state.chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        plugins: [crosshairPlugin, hardStopPlugin],
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
                    suggestedMin: globalMinY, // Force visibility of Hard Stop
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
/**
 * Helper to get real trades for a single strategy index using robust mapping.
 */
/**
 * Helper to get real trades for a single strategy index using robust mapping.
 * @param {number} index - The strategy index in window.analysisResults
 * @param {Object} [portfolio] - Optional: The specific portfolio object we are auditing. If provided, we only look here.
 */
const getRealTradesForStrategy = (index, portfolio = null) => {
    const normalize = s => s.replace(/\.csv$/i, '').trim().toLowerCase().replace(/\s+/g, ' ');
    let allRealTrades = [];

    // 1. Resolve Strategy ID/Name first to ensure we look up the right thing
    let rawName;
    let file = state.loadedStrategyFiles[index];

    // Priority 1: Use Portfolio's stored strategy name if available (Most Robust)
    if (portfolio && portfolio.indices && portfolio.strategyNames) {
        const k = portfolio.indices.indexOf(index);
        if (k !== -1 && portfolio.strategyNames[k]) {
            rawName = portfolio.strategyNames[k];
            // Update file ref if possible by matching name, for ID lookup
            if (!file || normalize(file.name) !== normalize(rawName)) {
                file = state.loadedStrategyFiles.find(f => normalize(f.name) === normalize(rawName));
            }
        }
    }

    // Priority 2: Fallback to global lists
    if (!rawName) {
        if (file) {
            rawName = file.name;
        } else if (window.analysisResults && window.analysisResults[index] && window.analysisResults[index].name) {
            rawName = window.analysisResults[index].name;
        }
    }

    // 0. SHORT-CIRCUIT: Search `window.analysisResults` for this Name (Robust Cache Lookup)
    if (window.analysisResults && rawName) {
        console.log(`[Trade Lookup] 🔍 Searching Cache for '${rawName}'...`);
        const cachedStrat = window.analysisResults.find(s => {
            const match = normalize(s.name) === normalize(rawName);
            // console.log(`   - comparing with '${s.name}' -> ${match}`); // Uncomment for extreme verbosity
            return match;
        });

        if (cachedStrat) {
            console.log(`[Trade Lookup] ✅ Found Cached Strategy: '${cachedStrat.name}'. Has realMetrics?`, !!cachedStrat.realMetrics, 'Trades?', cachedStrat.realMetrics?.trades?.length);
            if (cachedStrat.realMetrics && cachedStrat.realMetrics.trades && cachedStrat.realMetrics.trades.length > 0) {
                console.log(`[Trade Lookup] ⚡ FAST PATH: Found ${cachedStrat.realMetrics.trades.length} cached trades for '${rawName}' (Matched: '${cachedStrat.name}')`);
                return cachedStrat.realMetrics.trades;
            } else {
                console.warn(`[Trade Lookup] ⚠️ Cached Strategy '${cachedStrat.name}' found but HAS NO TRADES. keys:`, Object.keys(cachedStrat.realMetrics || {}));
            }
        } else {
            console.warn(`[Trade Lookup] ❌ Strategy '${rawName}' NOT FOUND in window.analysisResults (Size: ${window.analysisResults.length})`);
        }
    }

    if (!rawName) return [];

    const normalizedName = normalize(rawName);

    // Determine sId (preferred ID, then file name, then resolved rawName)
    const sId = file ? (file.strategyId || file.name) : rawName;

    // 2. Lookups
    const cleanName = rawName.replace(/\.csv$/i, '').trim();
    const mapById = state.magicNumberMap[sId];
    const mapByName = state.magicNumberMap[rawName];
    const mapByCleanName = state.magicNumberMap[cleanName];
    const mapByNormName = state.magicNumberMap[normalizedName];

    // --- DEBUGGING MATCH FAILURES ---
    if (!mapById && !mapByName && !mapByNormName && !mapByCleanName) {
        console.warn(`[Mapping Fail] Could not find mapping for:`);
        console.warn(`  - ID: ${sId}`);
        console.warn(`  - Name: ${rawName}`);
        console.warn(`  - Clean: ${cleanName}`);
        console.warn(`  - Norm: ${normalizedName}`);
        console.warn(`  - Available Keys (Sample):`, Object.keys(state.magicNumberMap).slice(0, 10));
        if (window.analysisResults[index]) {
            console.warn(`  - AnalysisResult Item:`, window.analysisResults[index]);
        }
    }
    // --------------------------------

    console.log(`[Mapping Debug] Strategy: "${rawName}" (Clean: "${cleanName}") -> IDs: ${sId}`);
    console.log(`[Mapping Debug] Lookups -> ByID: ${mapById}, ByName: ${mapByName}, ByClean: ${mapByCleanName}, ByNorm: ${mapByNormName}`);

    // 3. Priority (Strict Short-Circuit)
    // PRIORITY ORDER: Name > Clean Name > ID
    // Names are more stable than auto-generated IDs which can change between sessions
    let magicRaw = null;

    if (Array.isArray(mapByName) && mapByName.length > 0) {
        magicRaw = mapByName;
        console.log(`[Mapping Debug] 🎯 Strict Match used: Name (${rawName})`);
    } else if (Array.isArray(mapByCleanName) && mapByCleanName.length > 0) {
        magicRaw = mapByCleanName;
        console.log(`[Mapping Debug] 🎯 Strict Match used: CleanName (${cleanName})`);
    } else if (Array.isArray(mapById) && mapById.length > 0) {
        magicRaw = mapById;
        console.log(`[Mapping Debug] 🎯 Strict Match used: ID (${sId})`);
    } else {
        console.log(`[Mapping Debug] ❌ No Strict Mapping found for '${rawName}'. Returning no data.`);
        magicRaw = null;
    }

    // 3. Robust Trade Retrieval (Handling .csv mismatches and multiple keys)
    // Supports: Name, CleanName, ID, and Normalized variations
    const potentialInternalKeys = [
        rawName,
        cleanName,
        sId,
        normalizedName
    ];

    // Remove duplicates
    const uniqueKeys = [...new Set(potentialInternalKeys)];

    // Target Sources
    const targets = portfolio ? [portfolio] : state.savedPortfolios;

    // Helper to extract trades from a portfolio
    const extract = (p, lookupKey) => {
        if (p.realMetrics && p.realMetrics._tradesById) {
            // 1. Exact Match
            if (p.realMetrics._tradesById[lookupKey]) return p.realMetrics._tradesById[lookupKey];

            // 2. Try adding/removing .csv
            if (lookupKey.endsWith('.csv') && p.realMetrics._tradesById[lookupKey.replace('.csv', '')]) return p.realMetrics._tradesById[lookupKey.replace('.csv', '')];
            if (!lookupKey.endsWith('.csv') && p.realMetrics._tradesById[lookupKey + '.csv']) return p.realMetrics._tradesById[lookupKey + '.csv'];

            // 3. Try matching normalized keys in the source
            const sourceKeys = Object.keys(p.realMetrics._tradesById);
            const normLookup = normalize(lookupKey);
            const match = sourceKeys.find(k => normalize(k) === normLookup);
            if (match) return p.realMetrics._tradesById[match];
        } else {
            console.warn(`[Trade Lookup] ⚠️ Portfolio '${p.name}' ignored: realMetrics._tradesById missing. (realMetrics: ${!!p.realMetrics})`);
        }
        return [];
    };


    if (magicRaw) {
        // CASE A: We have EXPLICIT MAPPINGS (Magic Numbers or mapped Keys) from magicNumberMap
        const magics = Array.isArray(magicRaw) ? magicRaw : (typeof magicRaw === 'string' ? magicRaw.split(',') : [String(magicRaw)]);

        targets.forEach(p => {
            if (p.realMetrics && p.realMetrics._tradesById) {
                magics.forEach(m => {
                    const key = m.trim();
                    // Try direct key (Magic/Account::Magic)
                    let found = p.realMetrics._tradesById[key];

                    // Try loose key (just Magic if Account::Magic missing)
                    if (!found && key.includes('::')) {
                        const simpleMagic = key.split('::')[1];
                        found = p.realMetrics._tradesById[simpleMagic];
                    }

                    if (found) {
                        allRealTrades = allRealTrades.concat(found);
                    }
                });
            }
        });
    } else {
        // CASE B: NO EXPLICIT MAPPING - Try Implicit Name/ID Matching

        // --- NEW FALLBACK: If no portfolio context, search ALL saved portfolios ---
        if (targets.length === 0 && state.savedPortfolios && state.savedPortfolios.length > 0) {
            console.log('[Trade Lookup] No portfolio context. Searching ALL saved portfolios for implicit match.');
            state.savedPortfolios.forEach(p => {
                if (p.realMetrics) targets.push(p);
            });
        }

        console.log(`[Trade Lookup] No explicit map. Trying Implicit Match. Targets: ${targets.length}`);
        // console.log('   Keys:', uniqueKeys);

        targets.forEach(p => {
            console.log(`   > Checking Portfolio '${p.name}'...`);
            uniqueKeys.forEach(k => {
                const found = extract(p, k);
                if (found.length > 0) {
                    console.log(`[Trade Lookup] 🎯 Implicit Match found via key '${k}': ${found.length} trades.`);
                    allRealTrades = allRealTrades.concat(found);
                }
            });
        });
    }

    // Deduplicate Trades (by ticket or unique props) to avoid double counting from multiple hits
    if (allRealTrades.length > 0) {
        const seenTickets = new Set();
        allRealTrades = allRealTrades.filter(t => {
            const id = t.ticket || t.id || (t.openTime + t.symbol + t.type);
            if (seenTickets.has(id)) return false;
            seenTickets.add(id);
            return true;
        });
    }

    // FALLBACK: Search in deepScanData (Global Cache) if still empty
    if (allRealTrades.length === 0 && state.deepScanData) {

        // FALLBACK: Search in deepScanData (Multi-Account persistence)
        // Supports both legacy format (just magicNumber) and new format (accountId::magicNumber)
        if (allRealTrades.length === 0 && state.deepScanData) {
            console.log(`[Trade Lookup] No trades in portfolios, searching deepScanData...`);

            // Determine keys to search: Use 'magics' from Case A if available, else 'uniqueKeys' from Case B
            const searchKeys = (typeof magics !== 'undefined' && magics) ? magics : uniqueKeys;

            searchKeys.forEach(m => {
                const key = m.trim();

                // Check if this is a uniqueId format (accountId::magicNumber)
                if (key.includes('::')) {
                    const [targetAccountId, magicNumber] = key.split('::');
                    // Only search in the specific account
                    const accountData = state.deepScanData[targetAccountId];
                    if (accountData && accountData.tradesById && accountData.tradesById[magicNumber]) {
                        const found = accountData.tradesById[magicNumber];
                        console.log(`[Trade Lookup] Found ${found.length} trades for magic '${magicNumber}' in account ${targetAccountId}`);
                        allRealTrades = allRealTrades.concat(found);
                    }
                } else {
                    // Legacy format: search in all accounts (backwards compatibility)
                    Object.entries(state.deepScanData).forEach(([accountId, accountData]) => {
                        const tradesMap = accountData.tradesById || accountData._tradesById;
                        if (tradesMap) {
                            // Search strict
                            if (tradesMap[key]) {
                                allRealTrades = allRealTrades.concat(tradesMap[key]);
                            }
                            // Search fuzzy (Case B usually sends names/cleanNames)
                            else if (!key.includes('::')) { // Only fuzzy match if not an ID-like key
                                // 1. Try Clean (.csv removal)
                                const clean = key.replace(/\.csv$/i, '').trim();
                                if (tradesMap[clean]) allRealTrades = allRealTrades.concat(tradesMap[clean]);

                                // 2. Try adding .csv
                                if (tradesMap[clean + '.csv']) allRealTrades = allRealTrades.concat(tradesMap[clean + '.csv']);
                            }
                        }
                    });
                }
            });

            if (allRealTrades.length > 0) {
                console.log(`[Trade Lookup] 🎯 DeepScan Implicit Match found: ${allRealTrades.length} trades.`);
            }
        }
    }

    return allRealTrades;
};

/**
 * Audit a portfolio to ensure individual strategy trades sum up to the portfolio total.
 */
const auditPortfolio = (portfolioIndex) => {
    const portfolio = state.savedPortfolios[portfolioIndex];
    console.log(`[AUDIT] Starting audit for index: ${portfolioIndex}`, portfolio);

    const auditContainer = document.getElementById('audit-report-container');

    if (!portfolio || !portfolio.realMetrics) {
        console.error('[AUDIT] No real metrics found for portfolio.');
        if (auditContainer) auditContainer.innerHTML = '<div class="text-xs text-red-400 px-6">Error: Sin métricas reales para auditar.</div>';
        return;
    }

    if (!portfolio.realMetrics.totalRealTrades) {
        console.warn('[AUDIT] Portfolio has totalRealTrades = 0 or undefined.', portfolio.realMetrics);
        // Proceeding anyway to see if calculated is also 0
    }

    console.group(`[AUDIT] Portfolio Consistency Check: ${portfolio.name}`);

    let calculatedTotalTrades = 0;
    let calculatedTotalProfit = 0;

    portfolio.indices.forEach(strategyIndex => {
        const trades = getRealTradesForStrategy(strategyIndex, portfolio);
        calculatedTotalTrades += trades.length;
        calculatedTotalProfit += trades.reduce((sum, t) => sum + (parseFloat(t.profit) || 0) + (parseFloat(t.commission) || 0) + (parseFloat(t.swap) || 0), 0);
    });

    const reportedTotalTrades = portfolio.realMetrics.totalRealTrades || portfolio.realMetrics.tradesCount || 0;
    const reportedTotalProfit = portfolio.realMetrics.totalRealProfit || portfolio.realMetrics.totalProfit || 0;

    console.log(`Trades: Calculated ${calculatedTotalTrades} vs Reported ${reportedTotalTrades}`);
    // Final Log
    console.log(`Profit: Calculated ${calculatedTotalProfit.toFixed(2)} vs Reported ${reportedTotalProfit.toFixed(2)}`);

    const isMatch = calculatedTotalTrades === reportedTotalTrades;
    const diff = reportedTotalTrades - calculatedTotalTrades;

    // --- UI UPDATE ---
    // auditContainer is already defined above
    if (auditContainer) {
        if (isMatch) {
            auditContainer.innerHTML = `
                <div class="flex items-center gap-3 bg-green-900/30 border border-green-700/50 rounded-lg p-3">
                    <span class="text-2xl">✅</span>
                    <div class="flex-1">
                        <h4 class="text-sm font-bold text-green-400">Consistencia Verificada</h4>
                        <p class="text-xs text-green-200/70">
                            La suma de estrategias (${calculatedTotalTrades} ops) coincide con el total del portafolio.
                        </p>
                    </div>
                    <div>
                         <button onclick="window.openStrategyBreakdownModal(${portfolioIndex})" 
                            class="px-3 py-1 bg-green-800/50 hover:bg-green-700/50 text-green-200 text-xs rounded border border-green-700 transition-colors">
                            Ver Desglose
                         </button>
                    </div>
                    <div class="text-right">
                        <div class="text-xs text-gray-400">Ganancia Calc.</div>
                        <div class="text-sm font-bold text-green-300">$${calculatedTotalProfit.toFixed(2)}</div>
                    </div>
                </div>
            `;
            console.log(`%c✅ TRADE COUNT MATCH`, 'color: green; font-weight: bold;');
        } else {
            auditContainer.innerHTML = `
                <div class="flex items-center gap-3 bg-red-900/30 border border-red-700/50 rounded-lg p-3">
                    <span class="text-2xl">⚠️</span>
                    <div class="flex-1">
                        <h4 class="text-sm font-bold text-red-400">Discrepancia Detectada</h4>
                        <p class="text-xs text-red-200/70">
                            Suma Estrategias: <strong>${calculatedTotalTrades}</strong> vs Portafolio: <strong>${reportedTotalTrades}</strong> (Dif: ${diff})
                        </p>
                    </div>
                    <div>
                         <button onclick="window.openStrategyBreakdownModal(${portfolioIndex})" 
                            class="px-3 py-1 bg-red-800/50 hover:bg-red-700/50 text-red-200 text-xs rounded border border-red-700 transition-colors">
                            Ver Desglose
                         </button>
                    </div>
                    <div class="text-right">
                        <div class="text-xs text-gray-400">Ganancia Calc.</div>
                        <div class="text-sm font-bold text-red-300">$${calculatedTotalProfit.toFixed(2)}</div>
                    </div>
                </div>
            `;
            console.error(`❌ TRADE COUNT MISMATCH (Diff: ${diff})`);
        }
    }

    console.groupEnd();
};

window.toggleBreakdownTrades = (id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden');
};

export const openRealTradesModal = async (index, type = 'strategy', parentPortfolioIndex = null) => {
    console.log(`[UI] Opening Real Trades Modal for index: ${index}, type: ${type}`);

    let strategyOrPortfolio;
    let allRealTrades = [];

    if (type === 'saved') {
        strategyOrPortfolio = state.savedPortfolios[index];
        if (strategyOrPortfolio) {
            // ROBUST TRADE AGGREGATION (Matches Real Equity Chart Logic)
            let strategyNames = [];
            // PRIORITY: Use explicit strategy names if available
            if (strategyOrPortfolio.strategyNames && Array.isArray(strategyOrPortfolio.strategyNames) && strategyOrPortfolio.strategyNames.length > 0) {
                strategyNames = strategyOrPortfolio.strategyNames;
            } else if (strategyOrPortfolio.strategies && Array.isArray(strategyOrPortfolio.strategies)) {
                strategyNames = strategyOrPortfolio.strategies.map(s => s.name || s);
            } else if (strategyOrPortfolio.indices && window.analysisResults) {
                strategyNames = strategyOrPortfolio.indices.map(i => window.analysisResults[i]?.name).filter(Boolean);
            }

            if (strategyNames.length > 0) {
                const normalize = s => s.replace(/\.csv$/i, '').trim().toLowerCase().replace(/\s+/g, ' ');

                strategyNames.forEach(stratName => {
                    // 1. Resolve Strategy ID from loaded files with Fuzzy Matching
                    let strategyId = stratName;
                    const normalizedStratName = normalize(stratName);

                    const file = state.loadedStrategyFiles.find(f => normalize(f.name) === normalizedStratName);
                    if (file && file.strategyId) {
                        strategyId = file.strategyId;
                    }

                    // 2. Optimized Lookup Priority
                    const mapById = state.magicNumberMap[strategyId];
                    const mapByName = state.magicNumberMap[stratName];
                    const mapByNormName = state.magicNumberMap[normalizedStratName];

                    let magicRaw = mapById || mapByNormName || mapByName;

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
                            if (strategyOrPortfolio.realMetrics && strategyOrPortfolio.realMetrics._tradesById && strategyOrPortfolio.realMetrics._tradesById[m]) {
                                allRealTrades = allRealTrades.concat(strategyOrPortfolio.realMetrics._tradesById[m]);
                            }
                        });
                    } else {
                        // FALLBACK: Implicit Name Lookup for Virtual Portfolios
                        const cleanName = stratName.replace(/\.csv$/i, '').trim();
                        if (strategyOrPortfolio.realMetrics && strategyOrPortfolio.realMetrics._tradesById) {
                            const tradesById = strategyOrPortfolio.realMetrics._tradesById;
                            if (tradesById[stratName]) {
                                allRealTrades = allRealTrades.concat(tradesById[stratName]);
                            } else if (tradesById[normalizedStratName]) {
                                allRealTrades = allRealTrades.concat(tradesById[normalizedStratName]);
                            } else if (tradesById[cleanName]) {
                                allRealTrades = allRealTrades.concat(tradesById[cleanName]);
                            }
                        }
                    }
                });
            }
            console.log(`[UI] Debug Real Trades Modal (Portfolio): Found ${allRealTrades.length} trades via Robust Lookup.`);

            // --- TRIGGER AUDIT ---
            setTimeout(() => auditPortfolio(index), 100);

            // --- CALCULATE REAL METRICS FOR MODAL HEADER ---
            if (allRealTrades.length > 0) {
                // Format dates same as strategiesTable for engine compatibility
                const parseDate = (d) => {
                    if (!d) return null;
                    const clean = typeof d === 'string' ? d.replace(/\./g, '/') : d;
                    const dateObj = new Date(clean);
                    return isNaN(dateObj.getTime()) ? null : dateObj;
                };

                const normalizedForEngine = allRealTrades.map(t => {
                    const pnl = (parseFloat(t.profit) || 0) + (parseFloat(t.swap) || 0) + (parseFloat(t.commission) || 0);
                    const parsedClose = parseDate(t.closeTime || t.closeDate);
                    const parsedOpen = parseDate(t.openTime || t.openDate);
                    // Open Trade Support: Use OpenTime if CloseTime missing for sequencing
                    const effectiveExit = parsedClose || parsedOpen;
                    return {
                        ...t,
                        pnl: pnl,
                        closeTime: parsedClose,
                        openTime: parsedOpen,
                        exitTime: effectiveExit, // Critical for Duration/CAGR -> UPI
                    };
                }).filter(t => t.exitTime && !isNaN(t.pnl)).sort((a, b) => a.exitTime - b.exitTime);

                const realStats = calculateSQMetrics(normalizedForEngine);
                if (realStats) {
                    strategyOrPortfolio.tempRealStats = realStats;
                }
            }
        }

    } else if (type === 'saved-backtest') {
        strategyOrPortfolio = state.savedPortfolios[index];
        if (strategyOrPortfolio) {
            console.log(`[UI] Aggregating Backtest Trades for Portfolio: ${strategyOrPortfolio.name}`);

            if (strategyOrPortfolio.indices && strategyOrPortfolio.indices.length > 0) {
                // Iterate strategies and aggregate trades
                strategyOrPortfolio.indices.forEach(idx => {
                    // Get raw data for this strategy
                    // IMPORTANT: state.rawStrategiesData should be populated.
                    const rawTrades = state.rawStrategiesData ? state.rawStrategiesData[idx] : null;

                    if (rawTrades && Array.isArray(rawTrades)) {
                        // Map and concat
                        const mappedTrades = rawTrades.map(row => ({
                            openTime: row.entry_date ? new Date(row.entry_date) : null,
                            closeTime: row.exit_date ? new Date(row.exit_date) : null,
                            type: (row.type !== undefined) ? row.type : (row.direction || '?'),
                            size: parseFloat(row.size) || 0,
                            symbol: row.symbol || '',
                            openPrice: parseFloat(row.open_price || row.price || 0),
                            closePrice: parseFloat(row.close_price || row.price || 0),
                            profit: parseFloat(row.pnl) || 0,
                            swap: parseFloat(row.swap) || 0,
                            commission: parseFloat(row.commission) || 0,
                            magicNumber: row.magic || row.magic_number || 0,
                            comment: (row.comment || '') + ` (Strategy ${idx})` // Append strategy info
                        })).filter(t => t.openTime && t.closeTime);

                        allRealTrades = allRealTrades.concat(mappedTrades);
                    } else {
                        console.warn(`[UI] Missing raw data for strategy index ${idx} in portfolio.`);
                    }
                });

                console.log(`[UI] Aggregated ${allRealTrades.length} trades from ${strategyOrPortfolio.indices.length} strategies.`);
            } else {
                console.warn('[UI] Portfolio has no indices to aggregate backtest data.');
            }

            // Calculate temporary stats for header (Always calculate for Backtest to ensure consistency)
            if (allRealTrades.length > 0) {
                // FIX: row.pnl from parseCsv (and thus t.profit) is now NET PnL (includes swap/comm).
                // We must NOT add swap/comm again.
                const realStats = calculateSQMetrics(
                    allRealTrades.map(t => ({ ...t, exitTime: t.closeTime, pnl: t.profit }))
                );
                strategyOrPortfolio.tempRealStats = realStats;
                strategyOrPortfolio.tempRealStats.isBacktest = true; // Flag for UI if needed
            }
        }

    } else if (type === 'backtest') {
        const file = state.loadedStrategyFiles[index];
        if (file) {
            strategyOrPortfolio = { name: file.name, backtest: true, analysis: window.analysisResults[index] }; // Try to link analysis for metrics
            try {
                // 1. Try to get cached data from Raw Strategies Data (Populated on Load/Import)
                let parsedData = state.rawStrategiesData && state.rawStrategiesData[index];

                if (!parsedData) {
                    // 2. Fallback: Parse File if it is a valid Blob/File
                    if (file instanceof File || file instanceof Blob) {
                        console.log(`[UI] Parsing backtest file: ${file.name}`);
                        parsedData = await parseCsv(file);
                    } else {
                        throw new Error("File content not available. Please re-upload this strategy file or import the analysis JSON again.");
                    }
                } else {
                    console.log(`[UI] Using cached backtest data for: ${file.name}`);
                }

                // Map CSV fields to Real Trades Modal format
                allRealTrades = parsedData.map(row => ({
                    openTime: row.entry_date ? new Date(row.entry_date) : null,
                    closeTime: row.exit_date ? new Date(row.exit_date) : null,
                    type: (row.type !== undefined) ? row.type : (row.direction || '?'),
                    size: parseFloat(row.size) || 0,
                    symbol: row.symbol || '',
                    openPrice: parseFloat(row.open_price || row.price || 0),
                    closePrice: parseFloat(row.close_price || row.price || 0),
                    profit: parseFloat(row.pnl) || 0,
                    swap: parseFloat(row.swap) || 0,
                    commission: parseFloat(row.commission) || 0,
                    magicNumber: row.magic || row.magic_number || 0,
                    comment: row.comment || ''
                })).filter(t => t.openTime && t.closeTime); // Filter valid rows

                // Calculate temporary stats for header (Always calculate for Backtest to ensure consistency)
                if (allRealTrades.length > 0) {
                    // FIX: row.pnl from parseCsv (and thus t.profit) is now NET PnL (includes swap/comm).
                    // We must NOT add swap/comm again.
                    const realStats = calculateSQMetrics(
                        allRealTrades.map(t => ({ ...t, exitTime: t.closeTime, pnl: t.profit }))
                    );
                    strategyOrPortfolio.tempRealStats = realStats;
                }

            } catch (err) {
                console.error('[UI] Error parsing backtest trades:', err);
                alert(`Error reading backtest file: ${err.message}`);
            }
        } else {
            console.error('[UI] Backtest File not found for index:', index);
        }
    } else {
        // Strategy
        if (typeof index === 'string') {
            // VIRTUAL STRATEGY (Just Name + Portfolio Context)
            const straName = index;
            strategyOrPortfolio = { name: straName, virtual: true };
            if (parentPortfolioIndex !== null && state.savedPortfolios[parentPortfolioIndex]) {
                const parentPortfolio = state.savedPortfolios[parentPortfolioIndex];
                // Try to find index if possible for robust lookup, otherwise just use portfolio context
                const foundIndex = parentPortfolio.strategyNames ? parentPortfolio.strategyNames.indexOf(straName) : -1;
                // If we found a real index in the portfolio, use it for better lookup
                if (foundIndex !== -1 && parentPortfolio.indices) {
                    allRealTrades = getRealTradesForStrategy(parentPortfolio.indices[foundIndex], parentPortfolio);
                } else {
                    // Fallback: manually finding trades in portfolio by name mapping
                    // This is handled inside getRealTradesForStrategy if we tweak it, 
                    // BUT getRealTradesForStrategy expects an INDEX.
                    // Let's create a temporary fake index lookup or modify getRealTradesForStrategy?
                    // actually, getRealTradesForStrategy logic:
                    // 1. Resolve Strategy ID/Name...
                    // Uses `state.loadedStrategyFiles[index]`... this might fail if index is string/missing.

                    // QUICK FIX: Construct a shell object that mimics a file for `getRealTradesForStrategy` to work?
                    // No, simpler to just implement direct lookup here for virtual case.

                    if (parentPortfolio.realMetrics && parentPortfolio.realMetrics._tradesById) {
                        const mapKeys = state.magicNumberMap[straName];
                        if (mapKeys) {
                            const magics = Array.isArray(mapKeys) ? mapKeys : [String(mapKeys)];
                            magics.forEach(m => {
                                if (parentPortfolio.realMetrics._tradesById[m]) {
                                    allRealTrades = allRealTrades.concat(parentPortfolio.realMetrics._tradesById[m]);
                                }
                            });
                        }
                    }
                }
            }
        } else {
            // STANDARD STRATEGY (Index)
            strategyOrPortfolio = window.analysisResults[index];
            if (strategyOrPortfolio) {
                let parentPortfolio = null;
                if (parentPortfolioIndex !== null && state.savedPortfolios[parentPortfolioIndex]) {
                    parentPortfolio = state.savedPortfolios[parentPortfolioIndex];
                    // Fix Title Name if possible
                    if (parentPortfolio.indices && parentPortfolio.strategyNames) {
                        const k = parentPortfolio.indices.indexOf(index);
                        if (k !== -1 && parentPortfolio.strategyNames[k]) {
                            // Create a temporary object with the correct name for display
                            strategyOrPortfolio = { ...strategyOrPortfolio, name: parentPortfolio.strategyNames[k] };
                        }
                    }
                }
                allRealTrades = getRealTradesForStrategy(index, parentPortfolio);
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

    // --- WARNING INJECTION FOR NORMALIZATION ---
    const warningId = 'real-trades-normalization-warning';
    const existingWarning = document.getElementById(warningId);
    if (existingWarning) existingWarning.remove(); // Clean up previous

    // Check Global Normalization OR Portfolio-specific Normalization
    const normalizeCheckbox = document.getElementById('normalize-risk-checkbox'); // Primary Global Checkbox
    const searchNormCheckbox = document.getElementById('search-normalization-enabled'); // Search Config Checkbox

    // Check if either global flag is active
    // 1. Global Toolbar Checkbox
    // 2. Search Configuration (Persisted in State)
    let isGlobalNormalized = (normalizeCheckbox && normalizeCheckbox.checked) ||
        (state.currentOptimizationData && state.currentOptimizationData.normalizationEnabled);

    // strategyOrPortfolio is already defined above
    const isPortfolioNormalized = strategyOrPortfolio.riskConfig && strategyOrPortfolio.riskConfig.isScaled;

    console.log(`[UI] RealTrades Warning Check: Global=${isGlobalNormalized}, Portfolio=${isPortfolioNormalized}`);

    if (isGlobalNormalized || isPortfolioNormalized) {
        const warningHTML = `
            <div id="${warningId}" class="mx-6 mt-4 p-3 bg-yellow-900/40 border border-yellow-600/50 rounded-lg flex items-start gap-3">
                <span class="text-xl">⚠️</span>
                <div class="text-sm text-yellow-200">
                    <p class="font-bold">Aviso: Datos Normalizados</p>
                    <p class="opacity-90">Estás visualizando datos con normalización de riesgo aplicada. Para ver los datos históricos originales (Backtest/Live directo), desactiva la configuración de riesgo en el panel de búsqueda o en el portafolio.</p>
                </div>
            </div>
        `;
        // Inject after header (which is the first child of modal content)
        const modalContent = document.getElementById('real-trades-modal-content');
        if (modalContent) {
            const header = modalContent.querySelector('.border-b.border-gray-700'); // The header div
            if (header) {
                header.insertAdjacentHTML('afterend', warningHTML);
            } else {
                console.warn('[UI] Warning Header not found for injection. Appending to top.');
                modalContent.insertAdjacentHTML('afterbegin', warningHTML);
            }
        }
    }

    // 1. Sort Chronologically to calculate running balance and drawdown
    allRealTrades.sort((a, b) => new Date(a.closeTime || a.closeDate) - new Date(b.closeTime || b.closeDate));

    let runningBalance = 0;
    let maxRunningBalance = -Infinity;
    let maxBalanceDate = null;
    let maxBalanceIndex = -1;

    // Tracking Peak Real Stats for Headers
    let peakRealDDMoney = 0;
    let peakRealStagDays = 0;
    let peakRealStagTrades = 0;

    const tradesWithBalance = allRealTrades.map((t, idx) => {
        const net = (parseFloat(t.profit) || 0) + (parseFloat(t.commission) || 0) + (parseFloat(t.swap) || 0);
        runningBalance += net;

        // Fallback: Use Open Time if Close Time is missing (Open Trade or Data Issue)
        // This ensures the trade is sequenced correctly in the running balance/stagnation logic.
        let rawDate = t.closeTime || t.closeDate || t.openTime || t.openDate;
        let closeDate = rawDate ? new Date(rawDate) : null;

        // If still invalid, default to now or skip (but we shouldn't have trades without ANY date)
        if (!closeDate || isNaN(closeDate.getTime())) {
            closeDate = new Date(); // Worst case fallback
        }

        // --- Stagnation & Drawdown Calculation ---
        let dd = 0;
        let stagDays = 0;
        let stagTrades = 0;

        if (runningBalance >= maxRunningBalance) {
            // New High
            maxRunningBalance = runningBalance;
            maxBalanceDate = closeDate;
            maxBalanceIndex = idx;
            dd = 0;
            stagDays = 0;
            stagTrades = 0;
        } else {
            // In Drawdown
            dd = runningBalance - maxRunningBalance; // negative value
            if (dd < -2000) {
                console.log(`[UI Table] Deep Drawdown: ${dd.toFixed(2)} at ${closeDate.toISOString()} | Balance: ${runningBalance.toFixed(2)} | Peak: ${maxRunningBalance.toFixed(2)}`);
            }

            // Stagnation Days
            if (maxBalanceDate && closeDate) {
                const diffTime = Math.abs(closeDate - maxBalanceDate);
                stagDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            }

            // Stagnation Trades
            if (maxBalanceIndex !== -1) {
                stagTrades = idx - maxBalanceIndex;
            }
        }

        // Track Peaks
        if (Math.abs(dd) > peakRealDDMoney) peakRealDDMoney = Math.abs(dd);
        if (stagDays > peakRealStagDays) peakRealStagDays = stagDays;
        if (stagTrades > peakRealStagTrades) peakRealStagTrades = stagTrades;

        return {
            ...t,
            _balance: runningBalance,
            _netProfit: net,
            _drawdown: dd,
            _stagDays: stagDays,
            _stagTrades: stagTrades
        };
    });

    // 2. Sort Descending for Display (Newest first)
    const trades = tradesWithBalance.sort((a, b) => new Date(b.closeTime || b.closeDate) - new Date(a.closeTime || a.closeDate));

    const modalTitle = document.getElementById('real-trades-modal-title');
    const modalSubtitle = document.getElementById('real-trades-modal-subtitle');
    const tableBody = document.getElementById('real-trades-table-body');
    const modal = document.getElementById('real-trades-modal');
    const modalContent = document.getElementById('real-trades-modal-content');

    if (modalTitle) {
        const typeLabel = strategyOrPortfolio.backtest ? 'Backtest Trades' : 'Real Trades';
        modalTitle.textContent = `${strategyOrPortfolio.name} - ${typeLabel}`;
    }
    if (modalSubtitle) {
        let subText = `Total Trades: ${trades.length} | Net Profit: $${runningBalance.toFixed(2)}`;

        // Enhance with Real Stats if available (calculated above for Portfolios or attached to strategies)
        const stats = strategyOrPortfolio.tempRealStats || strategyOrPortfolio.realMetrics;
        if (stats && (stats.upi || stats.sharpeRatio)) {
            // Fallback to defaults if specific metric is missing
            const upi = stats.upi !== undefined ? Number(stats.upi).toFixed(2) : '-';
            const sharpe = stats.sharpeRatio !== undefined ? Number(stats.sharpeRatio).toFixed(2) : '-';
            const dd = stats.maxDD !== undefined ? Number(stats.maxDD).toFixed(2) : '-';
            const ddPct = stats.maxDDPct !== undefined ? Number(stats.maxDDPct).toFixed(2) : '-';
            const sqn = stats.sqn !== undefined ? Number(stats.sqn).toFixed(2) : '-';
            const winRate = stats.winRate !== undefined ? Number(stats.winRate).toFixed(2) : '-';

            subText += ` | UPI: ${upi} | Sharpe: ${sharpe} | SQN: ${sqn} | MaxDD: $${dd} (${ddPct}%)`;
        }
        modalSubtitle.textContent = subText;
    }

    // 2.5 Inject Risk Headers (Drawdown & Stagnation)
    const updateRiskHeader = (headerId, currentPeak, btKeyMoney, btKeyPercent, isMoney = false) => {
        const header = document.getElementById(headerId);
        if (!header) return;

        // Find BT Value
        const findProp = (keys) => {
            const sources = [
                strategyOrPortfolio.metrics,
                strategyOrPortfolio.analysis,
                strategyOrPortfolio.sqMetrics,
                strategyOrPortfolio.tempRealStats,
                strategyOrPortfolio
            ];
            for (const src of sources) {
                if (!src) continue;
                for (const key of keys) {
                    if (src[key] !== undefined && src[key] !== null) return src[key];
                }
            }
            return null;
        };

        let btVal = findProp(Array.isArray(btKeyMoney) ? btKeyMoney : [btKeyMoney]);
        let isPercent = false;

        // Fallback for money if not found (Drawdown case)
        if (isMoney && btVal === null && btKeyPercent) {
            btVal = findProp(Array.isArray(btKeyPercent) ? btKeyPercent : [btKeyPercent]);
            if (btVal !== null) isPercent = true;
        }

        let label = '-';
        let usedPercent = 0;
        let btNum = 0;

        if (btVal !== null) {
            btNum = parseFloat(btVal);
            if (!isNaN(btNum) && btNum !== 0) {
                if (isPercent) {
                    label = `${btNum.toFixed(2)}%`;
                } else {
                    label = isMoney ? `$${btNum.toFixed(2)}` : btNum.toFixed(0);
                    usedPercent = (currentPeak / btNum) * 100;
                }
            }
        }

        // DEBUG: Trace Entry
        if (headerId.includes('dd') && isMoney) {
            console.log(`[RiskHeader ERROR-TRACE] Header: ${headerId}, btNum: ${btNum}, type: ${type}, index: ${index}`);
        }

        // --- Calculate Stats (Mean/Freq) ---
        let statsHtml = '';
        if (btNum > 0) {
            let metricCurve = [];
            let eventPeaks = []; // Capture Peak of each Drawdown Event for Mean Calc

            // PREFERRED: Use Raw Strategies Data if available (Exact Precision)
            let rawTrades = null;
            let stratIndex = index;

            // Resolve Index if Name is passed
            if (typeof index === 'string' && type === 'strategy') {
                // Try to find index in loadedStrategyFiles
                if (state.loadedStrategyFiles) {
                    let idx = state.loadedStrategyFiles.findIndex(f => f.name === index);

                    // Retry with .csv if not found and input doesn't have it
                    if (idx === -1 && !index.endsWith('.csv')) {
                        idx = state.loadedStrategyFiles.findIndex(f => f.name === `${index}.csv`);
                    }
                    // Retry without .csv if not found and input has it
                    if (idx === -1 && index.endsWith('.csv')) {
                        const cleanName = index.replace('.csv', '');
                        idx = state.loadedStrategyFiles.findIndex(f => f.name === cleanName);
                    }

                    if (idx !== -1) {
                        stratIndex = idx;
                        console.log(`[RiskHeader] Resolved name '${index}' to index ${idx}`);
                    } else {
                        console.warn(`[RiskHeader] Could not resolve name '${index}' to an index in loadedStrategyFiles.`);
                    }
                }
            }

            // Check raw data availability
            if (type === 'strategy' && state.rawStrategiesData && state.rawStrategiesData[stratIndex]) {
                rawTrades = state.rawStrategiesData[stratIndex];
                console.log(`[RiskHeader] Found Raw Trades for Strategy Index ${stratIndex}: ${rawTrades.length} rows.`);
            } else if (type === 'saved') {
                console.log(`[RiskHeader] Portfolio mode. No single raw file expected. Using Fallback.`);
            }

            if (rawTrades) {
                // DEBUG: Inspect Data Quality
                if (rawTrades.length > 0) {
                    // console.log(`[RiskHeader Debug] Header: ${headerId}, Keys:`, Object.keys(rawTrades[0]));
                    // console.log(`[RiskHeader Debug] Sample PnL:`, rawTrades.slice(0, 5).map(t => t.pnl || t.profit));
                    if (rawTrades[0].hasOwnProperty('drawdown') || rawTrades[0].hasOwnProperty('Drawdown')) {
                        console.log(`[RiskHeader Debug] Explicit Drawdown Col Found.`);
                    } else {
                        console.log(`[RiskHeader Debug] NO Explicit Drawdown Column.`);
                    }
                }

                // Check if explicit column exists
                const hasExplicitDD = rawTrades.length > 0 && (rawTrades[0].hasOwnProperty('drawdown') || rawTrades[0].hasOwnProperty('Drawdown'));

                if (hasExplicitDD && isMoney && headerId.includes('dd')) {
                    // USE EXPLICIT COLUMN (User Request: "It is in the column")
                    // If we want "Average Peak DD", we still need to find peaks in this series.
                    // Let's stick to Event Peaks but using the Column values as source.

                    let currentEventPeak = 0;
                    rawTrades.forEach(t => {
                        const val = parseFloat(t.drawdown || t.Drawdown || 0);
                        if (val === 0) {
                            if (currentEventPeak > 0.01) eventPeaks.push(currentEventPeak);
                            currentEventPeak = 0;
                            metricCurve.push(0);
                        } else {
                            if (val > currentEventPeak) currentEventPeak = val;
                            metricCurve.push(val);
                        }
                    });
                    if (currentEventPeak > 0.01) eventPeaks.push(currentEventPeak);

                } else {
                    // Reconstruct from Raw Trades (Logic confirmed robust)
                    let runningBal = 0;
                    let maxBal = 0;
                    let maxBalIdx = -1;
                    let maxBalTime = 0;

                    let currentEventPeak = 0;

                    const type = isMoney ? 'dd' : (headerId.includes('days') ? 'stag_days' : 'stag_trades');

                    rawTrades.forEach((t, i) => {
                        const profit = parseFloat(t.profit) || 0;
                        runningBal += profit;

                        const time = new Date(t.closeTime || t.openTime).getTime();

                        let val = 0;
                        let isNewHigh = false;

                        if (runningBal >= maxBal) {
                            maxBal = runningBal;
                            maxBalIdx = i;
                            maxBalTime = time;
                            isNewHigh = true;
                        } else {
                            if (type === 'dd') val = maxBal - runningBal;
                            else if (type === 'stag_days') val = Math.max(0, (time - maxBalTime) / 86400000);
                            else if (type === 'stag_trades') val = i - maxBalIdx;
                        }

                        if (isNewHigh) {
                            if (currentEventPeak > 0.01) eventPeaks.push(currentEventPeak); // Filter noise < 0.01
                            currentEventPeak = 0;
                            metricCurve.push(0);
                        } else {
                            if (val > currentEventPeak) currentEventPeak = val;
                            metricCurve.push(val);
                        }
                    });
                    // Capture last event if active
                    if (currentEventPeak > 0.01) eventPeaks.push(currentEventPeak);
                }

            } else {
                // FALLBACK: Use Chart Data
                let equityCurve = strategyOrPortfolio?.analysis?.chartData?.equityCurve;
                if (!equityCurve && strategyOrPortfolio?.metrics?.chartData?.equityCurve) {
                    equityCurve = strategyOrPortfolio.metrics.chartData.equityCurve;
                }

                if (equityCurve && equityCurve.length > 0) {
                    console.log(`[RiskHeader] Using Equity Curve Fallback. Points: ${equityCurve.length}`);
                    let maxBal = -Infinity;
                    let maxBalIdx = -1;
                    let maxBalTime = 0;
                    let currentEventPeak = 0;

                    const type = isMoney ? 'dd' : (headerId.includes('days') ? 'stag_days' : 'stag_trades');

                    equityCurve.forEach((pt, idx) => {
                        const y = pt.y;
                        const t = pt.t;
                        let val = 0;
                        let isNewHigh = false;

                        if (y >= maxBal) {
                            maxBal = y; maxBalIdx = idx; maxBalTime = t;
                            isNewHigh = true;
                        } else {
                            if (type === 'dd') val = maxBal - y;
                            else if (type === 'stag_days') val = Math.max(0, (t - maxBalTime) / 86400000);
                            else if (type === 'stag_trades') val = idx - maxBalIdx;
                        }

                        if (isNewHigh) {
                            if (currentEventPeak > 0.01) eventPeaks.push(currentEventPeak);
                            currentEventPeak = 0;
                            metricCurve.push(0);
                        } else {
                            if (val > currentEventPeak) currentEventPeak = val;
                            metricCurve.push(val);
                        }
                    });
                    if (currentEventPeak > 0.01) eventPeaks.push(currentEventPeak);
                } else {
                    console.log(`[RiskHeader] No Equity Curve found for fallback.`);
                }
            }

            if (metricCurve.length > 0) {
                // Mean: Use Event Peaks if available (better), else nonZeros
                // Filter small peaks (noise) if < 1% of Max BT? No, keep it absolute but clean.
                // We already filtered < 0.01

                const validPeaks = eventPeaks.filter(p => p > 0);
                const mean = validPeaks.length ? (validPeaks.reduce((a, b) => a + b, 0) / validPeaks.length) : 0;

                // Frequency: % of points above threshold (Exposure)
                const incidents = metricCurve.filter(v => v >= btNum).length;
                const freq = (incidents / metricCurve.length) * 100;

                const meanDisp = isMoney ? `$${mean.toFixed(0)}` : mean.toFixed(1);
                statsHtml = `<span class="text-gray-500 ml-1" title="Max BT Stats:\n[Avg: ${meanDisp}]: Media de los Picos de Evento\n[Freq: ${freq.toFixed(1)}%]: % Tiempo en este nivel">[Avg: ${meanDisp}] (Freq: ${freq.toFixed(1)}%)</span>`;
            }
        }

        let title = isMoney ? 'Drawdown' : (headerId.includes('days') ? 'Stag (Days)' : 'Stag (Trades)');

        // Coloring for "Used %"
        let usedColor = 'text-gray-400';
        if (usedPercent > 80) usedColor = 'text-red-500 font-bold';
        else if (usedPercent > 50) usedColor = 'text-orange-400';

        header.innerHTML = `${title}<div class="text-[10px] text-gray-400 font-normal mt-0.5 leading-tight">Max BT: ${label}${statsHtml}<br><span class="${usedColor} text-[10px]">(${usedPercent.toFixed(1)}% Used)</span></div>`;
    };

    updateRiskHeader('real-trades-dd-header', peakRealDDMoney, ['maxDrawdownInDollars', 'drawdown_money', 'maxDD'], ['maxDrawdown', 'maxDDPct'], true);
    updateRiskHeader('real-trades-stag-days-header', peakRealStagDays, ['maxStagnationDays', 'stagnationDays']);
    updateRiskHeader('real-trades-stag-trades-header', peakRealStagTrades, ['maxStagnationTrades', 'stagnationTrades']);

    if (tableBody) {
        // Prepare Audit Container Placeholders if needed
        const modalContentArea = document.getElementById('real-trades-modal-content-area');

        // Ensure container exists (now hardcoded in index.html)
        let auditContainer = document.getElementById('audit-report-container');
        if (auditContainer) {
            auditContainer.innerHTML = '<div class="text-xs text-gray-500 italic animate-pulse">Verificando consistencia...</div>';
        }

        if (trades.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="14" class="p-4 text-center text-gray-500">No real trades found.</td></tr>`;
        } else {
            tableBody.innerHTML = trades.map(t => {
                const bal = t._balance;
                const netProfit = t._netProfit;
                const dd = t._drawdown;

                const isPositiveBal = bal >= 0;
                const isPositiveNet = netProfit >= 0;

                const formatDateShort = (dateStr) => {
                    if (!dateStr || dateStr === '-') return '-';
                    const d = new Date(dateStr);
                    if (isNaN(d.getTime())) return dateStr;

                    const pad = (n) => n.toString().padStart(2, '0');
                    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                };

                return `
                        <tr class="hover:bg-gray-800/50 transition-colors border-b border-gray-700/50 last:border-0">
                            <td>${t.ticket || t.id || '-'}</td>
                            <td class="text-xs text-gray-500 font-mono" title="${t.magic || t.magicNumber || t.comment || '-'}">
                                ${(() => {
                        const val = t.magic || t.magicNumber || t.comment || '-';
                        return val.toString().replace(/\[.*?\]/g, '').trim();
                    })()}
                            </td>
                            <td class="whitespace-nowrap font-mono text-xs">${formatDateShort(t.openDate || t.openTime)}</td>
                            <td>${t.action || t.type || '-'}</td>
                            <td>${t.lots || t.size || '-'}</td>
                            <td>${t.symbol || t.item || '-'}</td>
                            <td>${t.openPrice || '-'}</td>
                            <td class="whitespace-nowrap font-mono text-xs">${formatDateShort(t.closeDate || t.closeTime)}</td>
                            <td>${t.closePrice || '-'}</td>
                            <td class="${(t.commission || 0) < 0 ? 'text-red-400' : 'text-gray-400'}">${Number(t.commission || 0).toFixed(2)}</td>
                            <td class="${(t.swap || 0) < 0 ? 'text-red-400' : 'text-gray-400'}">${Number(t.swap || 0).toFixed(2)}</td>
                            <td class="${(t.profit || 0) >= 0 ? 'text-green-400' : 'text-red-400'} font-bold">${Number(t.profit || 0).toFixed(2)}</td>
                            <td class="${isPositiveNet ? 'text-green-400' : 'text-red-400'} font-bold">${netProfit.toFixed(2)}</td>
                            <td class="text-red-400 font-bold text-right">${dd === 0 ? '-' : dd.toFixed(2)}</td>
                            <td class="text-orange-300 text-right">${t._stagDays === 0 ? '-' : t._stagDays}</td>
                            <td class="text-orange-300 text-right">${t._stagTrades === 0 ? '-' : t._stagTrades}</td>
                            <td class="${isPositiveBal ? 'text-green-400' : 'text-red-400'} font-bold">${bal.toFixed(2)}</td>
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

            // Trigger Audit if it's a saved portfolio
            if (type === 'saved') {
                setTimeout(() => {
                    auditPortfolio(index);
                }, 300);
            }
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

/**
 * Abre el modal de Log de Margen.
 */
export const openMarginLogModal = (portfolioId) => {
    let portfolio = null;
    let metrics = null;

    // 1. Try to find in state.savedPortfolios (Primary source for Saved Portfolios table)
    const savedPortfolio = state.savedPortfolios.find(p => p.id == portfolioId);
    if (savedPortfolio && savedPortfolio.metrics) {
        portfolio = savedPortfolio;
        metrics = savedPortfolio.metrics;
    }

    // 2. If not found, try window.analysisResults
    if (!metrics) {
        const analysisResult = window.analysisResults?.find(r => r.id == portfolioId);
        if (analysisResult) {
            portfolio = analysisResult;
            // Analysis results usually store metrics in .analysis
            metrics = analysisResult.analysis || analysisResult.metrics;
        }
    }

    if (!metrics || !metrics.maxMarginLog) {
        console.error('Margin Log not found for ID:', portfolioId, 'Metrics:', metrics);
        alert('No margin log available for this portfolio.');
        return;
    }

    const modal = document.getElementById('margin-log-modal');
    const modalContent = document.getElementById('margin-log-modal-content');
    const logContent = document.getElementById('margin-log-content');

    if (logContent) {
        logContent.textContent = metrics.maxMarginLog.join('\n');
    }

    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            if (modalContent) modalContent.classList.remove('scale-95');
        }, 10);
    }
};

export const closeMarginLogModal = () => {
    const modal = document.getElementById('margin-log-modal');
    const modalContent = document.getElementById('margin-log-modal-content');

    if (modal) {
        modal.classList.add('opacity-0');
        if (modalContent) modalContent.classList.add('scale-95');
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }, 300);
    }
};

export const copyMarginLog = () => {
    const logContent = document.getElementById('margin-log-content');
    if (logContent) {
        navigator.clipboard.writeText(logContent.textContent)
            .then(() => alert('Log copied to clipboard!'))
            .catch(err => console.error('Failed to copy:', err));
    }
};

// Expose globally
window.openMarginLogModal = openMarginLogModal;
window.closeMarginLogModal = closeMarginLogModal;
window.copyMarginLog = copyMarginLog;

/**
 * Copies the Real Trades table content to clipboard.
 */
export const copyRealTradesToClipboard = async () => {
    const tableBody = document.getElementById('real-trades-table-body');
    if (!tableBody) return;

    const rows = Array.from(tableBody.querySelectorAll('tr'));
    if (rows.length === 0) return;

    // Headers
    const headers = ['Ticket', 'Open Time', 'Type', 'Size', 'Symbol', 'Open Price', 'Close Time', 'Close Price', 'Commission', 'Swap', 'Profit', 'Net Profit'];
    let tsvContent = headers.join('\t') + '\n';

    // Rows
    rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        const rowData = cells.map(cell => cell.textContent.trim()).join('\t');
        tsvContent += rowData + '\n';
    });

    try {
        await navigator.clipboard.writeText(tsvContent);

        // Feedback
        const btn = document.getElementById('copy-real-trades-btn');
        if (btn) {
            const originalContent = btn.innerHTML;
            btn.innerHTML = `
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                </svg>
                <span>Copied!</span>
            `;
            btn.classList.remove('bg-blue-600', 'hover:bg-blue-500', 'border-blue-500');
            btn.classList.add('bg-green-600', 'hover:bg-green-500', 'border-green-500');

            setTimeout(() => {
                btn.innerHTML = originalContent;
                btn.classList.remove('bg-green-600', 'hover:bg-green-500', 'border-green-500');
                btn.classList.add('bg-blue-600', 'hover:bg-blue-500', 'border-blue-500');
            }, 2000);
        }
    } catch (err) {
        console.error('Failed to copy trades:', err);
    }
};

// Expose globally
window.openRealTradesModal = openRealTradesModal;
window.closeRealTradesModal = closeRealTradesModal;
window.copyRealTradesToClipboard = copyRealTradesToClipboard;

/**
 * Toggles the featured status of a portfolio.
 * @param {number} index - Index of the portfolio in savedPortfolios.
 */
function toggleFeaturedPortfolio(index) {
    if (state.featuredPortfolioIndex === index) {
        state.featuredPortfolioIndex = -1; // Deseleccionar
    } else {
        state.featuredPortfolioIndex = index;
    }

    // Guardar estado si es necesario (opcional, por ahora solo en memoria)
    // Re-renderizar lista para actualizar iconos
    displaySavedPortfoliosList();

    // Re-renderizar destacado
    renderFeaturedPortfolio();
}

/**
 * Toggles the comparison status of a portfolio.
 * @param {number} index - Index of the portfolio in savedPortfolios.
 * @param {boolean} isPortfolio - True if the item is a portfolio, false if a strategy.
 */
function toggleComparisonPortfolio(index, isPortfolio) {
    if (isPortfolio) {
        if (state.comparisonPortfolioIndex === index) {
            state.comparisonPortfolioIndex = -1; // Deseleccionar
        } else {
            state.comparisonPortfolioIndex = index;
        }
        state.comparisonStrategyIndex = -1; // Clear strategy comparison if portfolio is selected
    } else { // It's a strategy
        if (state.comparisonStrategyIndex === index) {
            state.comparisonStrategyIndex = -1; // Deseleccionar
        } else {
            state.comparisonStrategyIndex = index;
        }
        state.comparisonPortfolioIndex = -1; // Clear portfolio comparison if strategy is selected
    }

    displaySavedPortfoliosList();
    displayStrategiesList(); // Also update strategy list for comparison icons
    renderFeaturedPortfolio(); // Update comparison view
}

// Expose globally if needed
window.toggleFeaturedPortfolio = toggleFeaturedPortfolio;
window.toggleComparisonPortfolio = toggleComparisonPortfolio;

/**
 * Deletes a saved portfolio.
 * @param {number} index - Index of the portfolio in savedPortfolios.
 */
function deleteSavedPortfolio(index) {
    if (!confirm('¿Estás seguro de que quieres eliminar este portafolio?')) return;

    state.savedPortfolios.splice(index, 1);
    saveSavedPortfolios();
    displaySavedPortfoliosList();

    // Update indices for featured/comparison
    if (state.featuredPortfolioIndex === index) state.featuredPortfolioIndex = -1;
    else if (state.featuredPortfolioIndex > index) state.featuredPortfolioIndex--;

    if (state.comparisonPortfolioIndex === index) state.comparisonPortfolioIndex = -1;
    else if (state.comparisonPortfolioIndex > index) state.comparisonPortfolioIndex--;

    renderFeaturedPortfolio();
}

// Map optimization button to workflow
window.openOptimizationTab = startOptimizationWorkflow;
window.deleteSavedPortfolio = deleteSavedPortfolio;

// Modal Logic for Portfolio Risk Breakdown (Audit per Strategy)
window.openStrategyBreakdownModal = (portfolioIndex) => {
    const p = state.savedPortfolios[portfolioIndex];
    if (!p) return;

    // Force audit/recalculation on open to ensure fresh data and trigger Unmapped Warnings
    if (p.linkedAccountId) {
        import('./modules/myfxbookUI.js').then(mod => {
            console.log('[RiskModal] Triggering fresh audit for:', p.name);
            mod.recalculateStrategyBreakdown(p);
        });
    }

    document.getElementById('strategy-breakdown-title').textContent = `Risk Breakdown: ${p.name}`;
    const tbody = document.getElementById('strategy-breakdown-table-body');
    const modal = document.getElementById('strategy-breakdown-modal');
    const modalContent = document.getElementById('strategy-breakdown-modal-content');

    // Add Force Audit Button if not present
    const headerTitle = modalContent.querySelector('h3');
    if (headerTitle && !document.getElementById('force-audit-btn')) {
        const auditBtn = document.createElement('button');
        auditBtn.id = 'force-audit-btn';
        auditBtn.className = 'ml-4 bg-yellow-600 hover:bg-yellow-500 text-white text-xs px-2 py-1 rounded shadow-sm';
        auditBtn.innerHTML = '🔍 Auditar Myfxbook';
        auditBtn.onclick = () => {
            if (p.linkedAccountId) {
                auditBtn.disabled = true;
                auditBtn.textContent = '⏳ Sincronizando...';
                import('./modules/myfxbookUI.js').then(mod => {
                    mod.fetchLinkedAccountData(p).then(() => {
                        auditBtn.textContent = '🔍 Auditar Myfxbook';
                        auditBtn.disabled = false;
                        // The fetch logic already calls recalculate, but we can force logs again
                        console.log('[RiskModal] Sync complete. Data refreshed.');
                    });
                });
            } else {
                alert('Este portafolio no está vinculado a Myfxbook.');
            }
        };
        headerTitle.appendChild(auditBtn);
    }

    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-400 italic">Calculating metrics...</td></tr>';

    // --- WARNING INJECTION FOR NORMALIZATION ---
    const warningId = 'breakdown-normalization-warning';
    const existingWarning = document.getElementById(warningId);
    if (existingWarning) existingWarning.remove(); // Clean up previous

    const normalizeCheckbox = document.getElementById('normalize-risk-checkbox'); // Primary
    const searchNormCheckbox = document.getElementById('search-normalization-enabled'); // Search

    const isGlobalNormalized = (normalizeCheckbox && normalizeCheckbox.checked) ||
        (searchNormCheckbox && searchNormCheckbox.checked);

    const isPortfolioNormalized = p.riskConfig && p.riskConfig.isScaled;

    if (isGlobalNormalized || isPortfolioNormalized) {
        const warningHTML = `
            <div id="${warningId}" class="mx-6 mt-4 p-3 bg-yellow-900/40 border border-yellow-600/50 rounded-lg flex items-start gap-3">
                <span class="text-xl">⚠️</span>
                <div class="text-sm text-yellow-200">
                    <p class="font-bold">Aviso: Datos Normalizados</p>
                    <p class="opacity-90">Estás visualizando el desglose de riesgo sobre datos normalizados. Los valores mostrados pueden diferir de los históricos reales.</p>
                </div>
            </div>
        `;
        // Inject after header
        const header = modalContent.querySelector('.border-b.border-gray-700');
        if (header) header.insertAdjacentHTML('afterend', warningHTML);
    }

    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modalContent.classList.remove('scale-95');
    }, 10);

    // Timeout to allow UI render before heavy calc
    setTimeout(() => {
        console.log('[RiskModal] Starting calculation...');
        // Ensure we have something to iterate over. 
        // Saved portfolios might use 'strategyIds' or just have 'strategies' count?
        // If p.indices is missing but we have strategyNames, use that.
        let loopSource = p.indices;
        if (!loopSource || loopSource.length === 0) {
            if (p.strategyNames && p.strategyNames.length > 0) {
                // Create dummy indices if we only have names (Saved Portfolio case)
                loopSource = p.strategyNames.map((_, i) => i);
                console.log(`[RiskModal] Using strategyNames as loop source. Length: ${loopSource.length}`);
            } else {
                console.warn('[RiskModal] No indices or strategyNames found.');
                tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-500">No strategies found in this portfolio.</td></tr>';
                return;
            }
        } else {
            console.log(`[RiskModal] Using p.indices. Length: ${loopSource.length}`);
        }

        // Formatting helper: 2,000 -> 2 000
        const fmt = (n, d = 0) => n.toLocaleString('en-US', {
            minimumFractionDigits: d,
            maximumFractionDigits: d
        }).replace(/,/g, ' ');

        let totalPortfolioBalance = 0;
        let allPortfolioRealTrades = [];
        let allPortfolioBacktestTrades = [];

        const rows = loopSource.map((stratIdx, localIdx) => {
            // 1. Resolve Strategy
            // For Saved Portfolios without direct indices mapping to current session, we rely on strategyNames
            let stratRef = null;
            if (p.indices && p.indices[localIdx] !== undefined) {
                stratRef = window.analysisResults[p.indices[localIdx]];
            }

            let stratName = stratRef ? stratRef.name : `Strategy ${localIdx + 1}`;
            if (p.strategyNames && p.strategyNames[localIdx]) stratName = p.strategyNames[localIdx];

            // Normalize Name for display
            stratName = stratName.replace(/\.csv$/i, '').trim();

            console.log(`[RiskModal] Row ${localIdx}: ${stratName} (Ref: ${!!stratRef})`);

            // 2. Get Real Trades
            const realTrades = getRealTradesForStrategy(stratIdx, p);
            console.log(`[RiskModal]   Real Trades: ${realTrades.length}`);

            // Accumulate for Portfolio Stats
            allPortfolioRealTrades = allPortfolioRealTrades.concat(realTrades);

            // 3. Calc Real Peaks
            let maxRealDD = 0;
            let maxRealStagD = 0;
            let maxRealStagT = 0;
            const hasReal = realTrades.length > 0;
            let runBal = 0; // Moved outside if

            if (hasReal) {
                // Sort Chrono
                const sorted = [...realTrades].sort((a, b) => new Date(a.closeTime || a.closeDate) - new Date(b.closeTime || b.closeDate));
                let maxRunBal = -Infinity;
                let maxBalDate = null;
                let maxBalIndex = -1;

                sorted.forEach((t, i) => {
                    // Robust Parsing Helper
                    const cleanNum = (val) => {
                        if (typeof val === 'number') return val;
                        if (!val) return 0;
                        // Handle " $ -50.25 " etc.
                        return parseFloat(String(val).replace(/[^0-9.-]/g, '')) || 0;
                    };

                    const net = cleanNum(t.profit) + cleanNum(t.commission) + cleanNum(t.swap);
                    runBal += net;
                    const cDate = new Date(t.closeTime || t.closeDate);

                    if (runBal >= maxRunBal) {
                        maxRunBal = runBal;
                        maxBalDate = cDate;
                        maxBalIndex = i;
                    } else {
                        // Drawdown
                        const dd = Math.abs(runBal - maxRunBal);
                        if (dd > maxRealDD) maxRealDD = dd;

                        // Stag Days
                        if (maxBalDate) {
                            const sd = Math.ceil(Math.abs(cDate - maxBalDate) / (1000 * 60 * 60 * 24));
                            if (sd > maxRealStagD) maxRealStagD = sd;
                        }
                        // Stag Trades
                        if (maxBalIndex !== -1) {
                            const st = i - maxBalIndex;
                            if (st > maxRealStagT) maxRealStagT = st;
                        }
                    }
                });
            }

            // Accumulate Total
            totalPortfolioBalance += runBal;

            // 4. Get Backtest Metrics & Compare
            const findVal = (keys) => {
                const sources = [stratRef?.metrics, stratRef?.analysis, stratRef?.sqMetrics, stratRef];
                for (const src of sources) {
                    if (!src) continue;
                    for (const key of keys) {
                        if (src[key] !== undefined && src[key] !== null) return src[key];
                    }
                }
                return null;
            };

            // 4. Calculate Original Backtest Metrics & Frequency
            // We bypass 'window.analysisResults' because it might be normalized.
            // We use 'state.rawStrategiesData' to get the TRUE original backtest data.
            let originalBTVal = null; // Will hold { maxDD, maxStagTrades, maxStagDays }
            let ddFrequency = 0; // % of time historical DD >= Real DD
            let stagDaysFrequency = 0;
            let stagTradesFrequency = 0;
            let ddMean = 0;
            let stagDaysMean = 0;
            let stagTradesMean = 0;

            // Frequency Curves
            let ddCurve = [];
            let stagDaysCurve = [];
            let stagTradesCurve = [];

            if (p.indices && p.indices[localIdx] !== undefined) {
                const rawData = state.rawStrategiesData[p.indices[localIdx]];
                if (rawData) {
                    // Accumulate for Portfolio Stats
                    const stratBacktestTrades = [...rawData];
                    allPortfolioBacktestTrades = allPortfolioBacktestTrades.concat(stratBacktestTrades);

                    // Manual Calculation to avoid dependency on global config
                    let peak = 0;
                    let currentEq = 0;
                    let maxDD = 0;
                    let maxStagDays = 0;
                    let maxStagTrades = 0;



                    // Stagnation Tracking
                    let peakTime = 0;
                    let peakIndex = 0;
                    const oneDay = 1000 * 60 * 60 * 24;

                    // Sort by Exit Time (Consistency with engine)
                    const trades = [...rawData].sort((a, b) => new Date(a.exitTime || a.closeTime) - new Date(b.exitTime || b.closeTime));

                    // Initialize Peak Time with first trade open or close? 
                    // Usually stagnation starts counts from first trade close in simple engines, 
                    // or ideally from start of simulation. Let's use first trade close as anchor.
                    if (trades.length > 0) {
                        peakTime = new Date(trades[0].exitTime || trades[0].closeTime).getTime();
                    }

                    trades.forEach((t, i) => {
                        currentEq += t.pnl;

                        // Capture Exit Time
                        const tExit = new Date(t.exitTime || t.closeTime).getTime();

                        if (currentEq > peak) {
                            peak = currentEq;
                            peakTime = tExit;
                            peakIndex = i;
                            // Reset current stagnation for curves? 
                            // Actually, meaningful stagnation is recorded when we are NOT at peak.
                            // But for "curve", we want the value AT every point? 
                            // Or just the completed stagnation periods?
                            // Definition: "Frequency of reaching this state". 
                            // At every trade, we are in a state of DD and Stagnation.
                            ddCurve.push(0);
                            stagDaysCurve.push(0);
                            stagTradesCurve.push(0);
                        } else {
                            // Drawdown
                            const dd = peak - currentEq;
                            if (dd > maxDD) maxDD = dd;
                            ddCurve.push(dd);

                            // Stagnation Days
                            // Diff from Peak Time to Current Trade Exit Time
                            // If tExit < peakTime (unordered?), handle gracefully
                            let dur = 0;
                            if (tExit > peakTime) {
                                dur = (tExit - peakTime) / oneDay;
                            }
                            if (dur > maxStagDays) maxStagDays = dur;
                            stagDaysCurve.push(dur);

                            // Stagnation Trades
                            const trDur = i - peakIndex;
                            if (trDur > maxStagTrades) maxStagTrades = trDur;
                            stagTradesCurve.push(trDur);
                        }
                    });

                    originalBTVal = {
                        maxDrawdownInDollars: maxDD,
                        maxStagnationDays: maxStagDays,
                        maxStagnationTrades: maxStagTrades
                    };

                    // Helper for Mean
                    const calcMean = (arr) => {
                        let sum = 0;
                        let count = 0;
                        for (const val of arr) {
                            if (val <= 0) continue;
                            sum += val;
                            count++;
                        }
                        return count > 0 ? sum / count : 0;
                    };

                    // Calc Frequency & Mean
                    if (hasReal) {
                        if (maxRealDD > 0) {
                            const incidents = ddCurve.filter(d => d >= maxRealDD).length;
                            ddFrequency = (incidents / ddCurve.length) * 100;
                            ddMean = calcMean(ddCurve);
                        }
                        if (maxRealStagD > 0) {
                            const incidents = stagDaysCurve.filter(d => d >= maxRealStagD).length;
                            stagDaysFrequency = (incidents / stagDaysCurve.length) * 100;
                            stagDaysMean = calcMean(stagDaysCurve);
                        }
                        if (maxRealStagT > 0) {
                            const incidents = stagTradesCurve.filter(d => d >= maxRealStagT).length;
                            stagTradesFrequency = (incidents / stagTradesCurve.length) * 100;
                            stagTradesMean = calcMean(stagTradesCurve);
                        }
                    }
                }
            }

            // Metrics: Real | Backtest | Yield
            const renderCell = (realVal, btKeysDollar, btKeysGen, isMoney = false, metricType = 'standard') => {
                // Find BT Val
                // PRIORITY: Use calculated Original BT if available (for DD), else fall back to lookup
                let btVal = null;

                if (metricType === 'drawdown' && originalBTVal) {
                    btVal = originalBTVal.maxDrawdownInDollars;
                } else if (metricType === 'stagnation' && originalBTVal) {
                    btVal = originalBTVal.maxStagnationDays;
                } else if (metricType === 'stagnation_trades' && originalBTVal) {
                    btVal = originalBTVal.maxStagnationTrades;
                } else {
                    btVal = findVal(btKeysDollar);
                    if (btVal === null && isMoney) btVal = findVal(btKeysGen); // Try generic
                    else if (!isMoney) btVal = findVal(btKeysGen);
                }

                const realDisp = hasReal ? (isMoney ? `$${fmt(realVal, 2)}` : fmt(realVal, 0)) : '-';

                let btDisp = '-';
                let yieldDisp = '-';
                let freqDisp = '';

                if (btVal !== null) {
                    const num = parseFloat(btVal);
                    if (!isNaN(num) && num !== 0) {
                        btDisp = isMoney ? `$${fmt(num, 0)}` : fmt(num, 0); // No decimals for BT usually

                        if (hasReal) {
                            const yieldVal = (realVal / num) * 100;
                            // Color Logic for Yield
                            let yieldColor = 'text-blue-300';
                            if (yieldVal > 100) yieldColor = 'text-red-500 font-bold';
                            else if (yieldVal > 80) yieldColor = 'text-yellow-400';

                            yieldDisp = `<span class="${yieldColor}" title="Yield: Magnitud del Real vs Maximo Historico">${yieldVal.toFixed(1)}%</span>`;

                            // Calculate Max BT Frequency & Mean
                            let btFreqVal = 0;
                            let btMeanVal = 0;
                            let showBtStats = false;

                            if (metricType === 'drawdown') {
                                // Freq of Max DD in history (how often did we hit the max?)
                                if (ddCurve && ddCurve.length) {
                                    const incidents = ddCurve.filter(d => d >= num).length; // num is btVal
                                    btFreqVal = (incidents / ddCurve.length) * 100;
                                    btMeanVal = ddMean; // Already calculated
                                    showBtStats = true;
                                }
                            } else if (metricType === 'stagnation') {
                                if (stagDaysCurve && stagDaysCurve.length) {
                                    const incidents = stagDaysCurve.filter(d => d >= num).length;
                                    btFreqVal = (incidents / stagDaysCurve.length) * 100;
                                    btMeanVal = stagDaysMean;
                                    showBtStats = true;
                                }
                            } else if (metricType === 'stagnation_trades') {
                                if (stagTradesCurve && stagTradesCurve.length) {
                                    const incidents = stagTradesCurve.filter(d => d >= num).length;
                                    btFreqVal = (incidents / stagTradesCurve.length) * 100;
                                    btMeanVal = stagTradesMean;
                                    showBtStats = true;
                                }
                            }

                            if (showBtStats) {
                                const mDisp = metricType === 'drawdown' ? `$${btMeanVal.toFixed(0)}` : btMeanVal.toFixed(1);
                                const extraInfo = `<span class="text-gray-600 ml-1" title="Max BT Stats:\n[Avg: ${mDisp}]: Media Histórica\n[Freq: ${btFreqVal.toFixed(1)}%]: % de veces que se alcanzó este Máximo">[Avg: ${mDisp}] (Freq: ${btFreqVal.toFixed(1)}%)</span>`;
                                btDisp += extraInfo;
                            }

                            // Add Frequency
                            let freqVal = 0;
                            let meanVal = 0;
                            let showFreq = false;

                            if (metricType === 'drawdown') {
                                freqVal = ddFrequency;
                                meanVal = ddMean;
                                showFreq = true;
                            }
                            else if (metricType === 'stagnation') {
                                freqVal = stagDaysFrequency;
                                meanVal = stagDaysMean;
                                showFreq = true;
                            }
                            else if (metricType === 'stagnation_trades') {
                                freqVal = stagTradesFrequency;
                                meanVal = stagTradesMean;
                                showFreq = true;
                            }

                            if (showFreq) {
                                let freqColor = 'text-emerald-400';
                                if (freqVal < 5) freqColor = 'text-red-500 font-bold';
                                else if (freqVal < 20) freqColor = 'text-yellow-400';

                                const meanDisp = metricType === 'drawdown' ? `$${meanVal.toFixed(0)}` : meanVal.toFixed(1);

                                freqDisp = `<div class="text-[10px] ${freqColor} mt-0.5 cursor-help" title="Frecuencia: % de la historia en que el valor fue >= al actual.\n[Avg: ${meanDisp}]: Es la Media (promedio de todos los valores históricos > 0).\n\nCuanto más ALTO el %: Más normal es la situación.\nCuanto más BAJO el %: Más extraordinaria.">Freq: ${freqVal.toFixed(1)}% [Avg: ${meanDisp}]</div>`;
                            }
                        }
                    }
                }

                return `
                    <div class="leading-tight">
                        <div class="font-bold text-gray-200">${realDisp}</div>
                        <div class="text-[10px] text-gray-500 mt-0.5">
                            Max BT: <span class="text-gray-400">${btDisp}</span>
                        </div>
                        <div class="text-[10px] mt-0.5 flex items-center justify-center gap-2">
                             ${yieldDisp}
                        </div>
                        ${freqDisp}
                    </div>
                `;
            };

            // Styling Yield
            let yieldClass = 'text-gray-500';
            let status = 'Active';

            return `
            <tr class="hover:bg-gray-800/50 transition-colors border-b border-gray-800 last:border-0">
                <td class="p-4 font-medium text-sky-300">
                    <div class="flex items-center">
                        <div class="truncate w-48" title="${stratName}">${stratName}</div>
                        <button onclick="event.stopPropagation(); window.openRealTradesModal(${p.indices ? p.indices[localIdx] : -1}, 'strategy', 0)" class="ml-2 text-gray-400 hover:text-white transition-colors" title="View Real Trades">
                            🔍
                        </button>
                    </div>
                    <div class="text-[10px] text-gray-500 mt-1">${realTrades.length} trades</div>
                </td>
                <td class="p-4 text-center bg-gray-900/30">
                    ${renderCell(maxRealDD, ['maxDrawdownInDollars', 'maxDrawdown'], ['maxDrawdownInDollars', 'maxDrawdown'], true, 'drawdown')}
                </td>
                <td class="p-4 text-center">
                    ${renderCell(maxRealStagD, ['maxStagnationDays'], ['maxStagnationDays'], false, 'stagnation')}
                </td>
                <td class="p-4 text-center bg-gray-900/30">
                    ${renderCell(maxRealStagT, ['maxStagnationTrades'], ['maxStagnationTrades'], false, 'stagnation_trades')}
                </td>
                <td class="p-4 text-right font-bold ${totalPortfolioBalance >= 0 ? 'text-green-400' : 'text-red-400'}">
                    $${fmt(runBal, 2)}
                </td>
                <td class="p-4 text-right"><span class="text-green-400 text-xs">${status}</span></td>
            </tr>`;
        }).join('');

        tbody.innerHTML = rows + `
        <tr class="bg-gray-800 border-t-2 border-gray-700 font-bold">
            <td class="p-4 text-white text-right font-medium text-sky-300" colspan="4">TOTAL BALANCE</td>
            <td class="p-4 text-right ${totalPortfolioBalance >= 0 ? 'text-green-300' : 'text-red-400'} text-lg">
                $${fmt(totalPortfolioBalance, 2)}
            </td>
            <td></td>
        </tr>`;

        // --- PORTFOLIO AGGREGATE STATS CALCULATION ---

        // 1. Calculate Real Stats
        let portMaxDD = 0;
        let portMaxStagD = 0;
        let portMaxStagT = 0;
        let hasRealPort = false;

        if (allPortfolioRealTrades.length > 0) {
            hasRealPort = true;
            const sortedPort = [...allPortfolioRealTrades].sort((a, b) => new Date(a.closeTime || a.closeDate) - new Date(b.closeTime || b.closeDate));
            let portRunBal = 0;
            let portMaxRunBal = -Infinity;
            let portMaxBalDate = null;
            let portMaxBalIndex = -1;

            const cleanNum = (val) => {
                if (typeof val === 'number') return val;
                if (!val) return 0;
                return parseFloat(String(val).replace(/[^0-9.-]/g, '')) || 0;
            };

            sortedPort.forEach((t, i) => {
                const net = cleanNum(t.profit) + cleanNum(t.commission) + cleanNum(t.swap);
                portRunBal += net;
                const cDate = new Date(t.closeTime || t.closeDate);

                if (portRunBal >= portMaxRunBal) {
                    portMaxRunBal = portRunBal;
                    portMaxBalDate = cDate;
                    portMaxBalIndex = i;
                } else {
                    const dd = Math.abs(portRunBal - portMaxRunBal);
                    if (dd > portMaxDD) portMaxDD = dd;

                    if (portMaxBalDate) {
                        const sd = Math.ceil(Math.abs(cDate - portMaxBalDate) / (1000 * 60 * 60 * 24));
                        if (sd > portMaxStagD) portMaxStagD = sd;
                    }
                    if (portMaxBalIndex !== -1) {
                        const st = i - portMaxBalIndex;
                        if (st > portMaxStagT) portMaxStagT = st;
                    }
                }
            });
        }

        // 2. Simulate Portfolio Backtest for Curves/Distribution
        let portBT_DDCurve = [];
        let portBT_StagDaysCurve = [];
        let portBT_StagTradesCurve = [];

        let portBT_MeanDD = 0;
        let portBT_MeanStagD = 0;
        let portBT_MeanStagT = 0;

        let portBT_FreqDD = 0;
        let portBT_FreqStagD = 0;
        let portBT_FreqStagT = 0;

        let portBT_DD = null;
        let portBT_StagD = null;
        let portBT_StagT = null;

        if (p.analysis) {
            portBT_DD = p.analysis.maxDrawdownInDollars;
            portBT_StagD = p.analysis.maxStagnationDays;
            portBT_StagT = p.analysis.maxStagnationTrades;
        }

        if (allPortfolioBacktestTrades.length > 0) {
            console.log(`[RiskModal] Simulating Portfolio Backtest with ${allPortfolioBacktestTrades.length} trades...`);

            // Sort
            const sortedBT = [...allPortfolioBacktestTrades].sort((a, b) => new Date(a.exitTime || a.closeTime) - new Date(b.exitTime || b.closeTime));

            let peak = 0;
            let currentEq = 0;
            let peakTime = 0;
            if (sortedBT.length > 0) peakTime = new Date(sortedBT[0].exitTime || sortedBT[0].closeTime).getTime();
            let peakIndex = 0;
            const oneDay = 1000 * 60 * 60 * 24;
            let maxBT_DD = 0;

            sortedBT.forEach((t, i) => {
                // PnL in BT trades usually 'pnl' or 'profit'
                currentEq += (t.pnl || t.profit || 0);
                const tExit = new Date(t.exitTime || t.closeTime).getTime();

                if (currentEq > peak) {
                    peak = currentEq;
                    peakTime = tExit;
                    peakIndex = i;

                    portBT_DDCurve.push(0);
                    portBT_StagDaysCurve.push(0);
                    portBT_StagTradesCurve.push(0);
                } else {
                    const dd = peak - currentEq;
                    if (dd > maxBT_DD) maxBT_DD = dd;
                    portBT_DDCurve.push(dd);

                    let dur = 0;
                    if (tExit > peakTime) dur = (tExit - peakTime) / oneDay;
                    portBT_StagDaysCurve.push(dur);

                    const trDur = i - peakIndex;
                    portBT_StagTradesCurve.push(trDur);
                }
            });

            // If p.analysis was missing, use simulated max
            if (portBT_DD === null) portBT_DD = maxBT_DD;

            // Calc Means
            const calcMean = (arr) => {
                let sum = 0, count = 0;
                for (const v of arr) { if (v > 0) { sum += v; count++; } }
                return count > 0 ? sum / count : 0;
            };

            portBT_MeanDD = calcMean(portBT_DDCurve);
            portBT_MeanStagD = calcMean(portBT_StagDaysCurve);
            portBT_MeanStagT = calcMean(portBT_StagTradesCurve);

            // Calc Frequencies (if Real exists)
            if (hasRealPort) {
                if (portMaxDD > 0) {
                    const incidents = portBT_DDCurve.filter(d => d >= portMaxDD).length;
                    portBT_FreqDD = (incidents / portBT_DDCurve.length) * 100;
                }
                if (portMaxStagD > 0) {
                    const incidents = portBT_StagDaysCurve.filter(d => d >= portMaxStagD).length;
                    portBT_FreqStagD = (incidents / portBT_StagDaysCurve.length) * 100;
                }
                if (portMaxStagT > 0) {
                    const incidents = portBT_StagTradesCurve.filter(d => d >= portMaxStagT).length;
                    portBT_FreqStagT = (incidents / portBT_StagTradesCurve.length) * 100;
                }
            }
        }


        // Reuse renderCell logic but we need access to renderCell inside the timer scope?
        // renderCell is defined inside the map loop scope which is closed.
        // We need to duplicate or extract renderCell. 
        // Since extracting is risky for existing code without bigger refactor, let's duplicate the lightweight render logic for this row.

        const renderPortCell = (realVal, btVal, type, freqVal = 0, meanVal = 0) => {
            let btDisp = '-';
            let yieldDisp = '-';
            let freqDisp = '';

            if (btVal !== undefined && btVal !== null) {
                btDisp = type === 'money' ? `$${fmt(btVal, 0)}` : fmt(btVal, 0);

                const ratio = realVal / Math.abs(btVal);
                const yieldVal = ratio * 100;

                let yieldColor = 'text-blue-300';
                if (yieldVal > 100) yieldColor = 'text-red-500 font-bold';
                else if (yieldVal > 80) yieldColor = 'text-yellow-400';

                yieldDisp = `<span class="${yieldColor}" title="Yield: Magnitud del Real vs Maximo Historico">${yieldVal.toFixed(1)}%</span>`;
            }

            if (hasRealPort && allPortfolioBacktestTrades.length > 0) {
                let freqColor = 'text-emerald-400';
                if (freqVal < 5) freqColor = 'text-red-500 font-bold';
                else if (freqVal < 20) freqColor = 'text-yellow-400';

                const meanDisp = type === 'money' ? `$${meanVal.toFixed(0)}` : meanVal.toFixed(1);
                freqDisp = `<div class="text-[10px] ${freqColor} mt-0.5 cursor-help" title="Frecuencia Portfolio: % de la historia en que el valor fue >= al actual.">Freq: ${freqVal.toFixed(1)}% [Avg: ${meanDisp}]</div>`;
            }

            const realDisp = type === 'money' ? `$${fmt(realVal, 0)}` : fmt(realVal, 0);

            return `
                    <div class="leading-tight">
                        <div class="font-bold text-gray-200">${realDisp}</div>
                        <div class="text-[10px] text-gray-500 mt-0.5">
                            Max BT: <span class="text-gray-400">${btDisp}</span>
                        </div>
                        <div class="text-[10px] mt-0.5 flex items-center justify-center gap-2">
                             ${yieldDisp}
                        </div>
                         ${freqDisp}
                    </div>
                `;
        };

        const portRow = `
            <tr class="bg-gray-800/80 border-t border-gray-700 hover:bg-gray-700/50 transition-colors">
                <td class="p-4 font-bold text-purple-300 flex flex-col">
                    <span>⚡ PORTFOLIO STATS</span>
                    <span class="text-[10px] text-gray-500 font-normal">Aggregated Real Performance</span>
                </td>
                <td class="p-4 text-center bg-gray-900/50 border-x border-gray-700/50">
                    ${renderPortCell(portMaxDD, portBT_DD, 'money', portBT_FreqDD, portBT_MeanDD)}
                </td>
                <td class="p-4 text-center">
                    ${renderPortCell(portMaxStagD, portBT_StagD, 'number', portBT_FreqStagD, portBT_MeanStagD)}
                </td>
                <td class="p-4 text-center bg-gray-900/50 border-x border-gray-700/50">
                    ${renderPortCell(portMaxStagT, portBT_StagT, 'number', portBT_FreqStagT, portBT_MeanStagT)}
                </td>
                <td class="p-4 text-right">
                   <!-- Placeholder or duplicate balance -->
                </td>
                 <td class="p-4 text-right"></td>
            </tr>`;

        // Append to tbody (only if we have something to show, either real or backtest)
        if (hasRealPort || allPortfolioBacktestTrades.length > 0) {
            tbody.innerHTML += portRow;
        }

    }, 50); // Small timeout to allow spinner to show
};


// --- Event Listener for overlay toggles (Appended via Agent) ---
document.addEventListener('portfolioSelectionChanged', () => {
    console.log('[UI] 🔔 Event: portfolioSelectionChanged. Refreshing Chart...');
    const chart = state.chartInstances['portfolioEquityChart'];

    // If existing chart, try to reconstruct from datasets to preserve analysis data without re-fetching
    if (chart && chart.data && chart.data.datasets.length > 0) {
        const analyses = [];
        const seenIndices = new Set();

        chart.data.datasets.forEach(d => {
            if (d.savedIndex !== undefined && !seenIndices.has(d.savedIndex)) {
                seenIndices.add(d.savedIndex);
                // Reconstruct the 'result' object expected by render
                const p = state.savedPortfolios[d.savedIndex];
                if (p) {
                    analyses.push({
                        name: p.name,
                        savedIndex: d.savedIndex,
                        analysis: d.analysis, // Reuse cached analysis (Backtest)
                        realMetrics: p.realMetrics, // Use latest Real Metrics
                        showBacktestOverlay: p.showBacktestOverlay, // Use latest toggle state
                        strategyNames: p.strategyNames || p.strategies, // Ensure mapping keys exist
                        color: d.borderColor // Preserve color
                    });
                }
            }
        });

        if (analyses.length > 0) {
            renderPortfolioComparisonCharts(analyses);
        }
    }
});

/**
 * Toggles the backtest overlay visibility for a specific strategy (Logic similar to Saved Portfolios).
 * Used by the "Eye" button in the Strategies Table.
 */
window.toggleStrategyOverlay = (strategyName, buttonElement) => {
    console.log(`[UI] toggleStrategyOverlay called for: '${strategyName}'`);

    // 1. Find the strategy in the global results (Fuzzy Match for .csv)
    let strategy = window.analysisResults.find(s => {
        if (s.name === strategyName) return true;
        if (s.name === strategyName + '.csv') return true;
        if (s.name.replace('.csv', '') === strategyName) return true;
        return false;
    });

    // Helper to check if hydration is needed
    const needsHydration = !strategy || !strategy.realMetrics || !strategy.realMetrics._tradesById;

    if (needsHydration) {
        console.log(`[UI] Strategy '${strategyName}' needs hydration/selection. Delegating to FocusMode.`);

        // Dynamic import to avoid circular dependency issues if any
        import('./modules/focusMode.js').then(module => {
            const focusMode = module.focusMode || module.default; // Handle export types
            if (focusMode && typeof focusMode.enable === 'function') {
                // FocusMode.enable expects (item, type, rowElement, options)
                const result = focusMode.enable(
                    { name: strategyName }, // item
                    'strategy',              // type
                    null,                    // rowElement (null allows fuzzy find inside)
                    { forceSelect: true, toggleOverlay: true }    // options: force keep selected & toggle overlay
                );

                // Accurate UI Update from FocusMode Result
                if (result && buttonElement) {
                    const isVisible = result.showBacktestOverlay !== false;
                    buttonElement.innerHTML = isVisible ? '👁️' : '🚫';
                    buttonElement.title = isVisible ? 'Ocultar Backtest (Overlay)' : 'Mostrar Backtest (Overlay)';

                    // Reset classes
                    buttonElement.className = "ml-2 transition-all duration-200 transform hover:scale-110";

                    if (isVisible) {
                        buttonElement.classList.add('text-blue-500', 'opacity-100');
                    } else {
                        buttonElement.classList.add('text-gray-600', 'opacity-50');
                    }

                    // Sync Panel Eye
                    if (window.updateFocusPanelEye) {
                        window.updateFocusPanelEye(isVisible);
                    }
                }
            } else {
                console.error('[UI] Could not load FocusMode module.');
            }
        });
        return;
    }

    // 2. If Strategy IS found and has metrics (isActive), just toggle locally
    // Toggle the flag (Default true)
    strategy.showBacktestOverlay = (strategy.showBacktestOverlay === false) ? true : false;
    const isVisible = strategy.showBacktestOverlay;

    console.log(`[UI] Toggled Overlay for '${strategyName}' to ${isVisible}`);

    // Immediate UI Feedback
    if (buttonElement) {
        buttonElement.innerHTML = isVisible ? '👁️' : '🚫';
        buttonElement.title = isVisible ? 'Ocultar Backtest (Overlay)' : 'Mostrar Backtest (Overlay)';

        // Remove old classes to be safe
        buttonElement.className = "ml-2 transition-all duration-200 transform hover:scale-110";

        if (isVisible) {
            buttonElement.classList.add('text-blue-500', 'opacity-100');
        } else {
            buttonElement.classList.add('text-gray-600', 'opacity-50');
        }
    }

    // Sync Panel Eye
    if (window.updateFocusPanelEye) {
        window.updateFocusPanelEye(isVisible);
    }

    // Trigger Global Update
    const event = new CustomEvent('portfolioSelectionChanged');
    document.dispatchEvent(event);

    // Force re-render of strategies table
    import('./modules/strategiesTable.js').then(({ renderStrategiesTable }) => {
        if (renderStrategiesTable) renderStrategiesTable();
    });
};

/* ==========================================================================
   FOCUSED STRATEGY NAVIGATION (Panel Controls)
   ========================================================================== */
const initFocusedStrategyNavigation = () => {
    const prevBtn = document.getElementById('focus-prev-btn');
    const nextBtn = document.getElementById('focus-next-btn');
    const toggleBtn = document.getElementById('focus-toggle-eye-btn');

    if (!prevBtn || !nextBtn || !toggleBtn) return;

    // Helper: Get currently focused strategy index in the visible list
    const getFocusedContext = () => {
        return import('./modules/focusMode.js').then(m => {
            const fm = m.focusMode || m.default;
            if (!fm || !fm.focusedItems || fm.focusedItems.size === 0) return null;

            const focusedStrategy = fm.focusedItems.values().next().value; // Get first one
            const strategies = window.currentTableStrategies || [];

            if (strategies.length === 0) return null;

            // Find index
            const idx = strategies.findIndex(s => s.name === focusedStrategy.name); // Simple name match
            return { idx, strategies, focusedStrategy, fm };
        });
    };

    const navigate = (direction) => {
        getFocusedContext().then(ctx => {
            if (!ctx) return;
            const { idx, strategies, fm } = ctx;
            if (idx === -1) return;

            let newIdx = idx + direction;
            if (newIdx < 0) newIdx = 0; // Clamp (or could cycle)
            if (newIdx >= strategies.length) newIdx = strategies.length - 1;

            if (newIdx !== idx) {
                const target = strategies[newIdx];
                // Enable new one
                fm.enable(target, 'strategy', null, { forceSelect: true }).then(result => {
                    // Check if it's visible to update eye
                    if (result) updateEyeIcon(result.showBacktestOverlay !== false);
                });
            }
        });
    };

    const updateEyeIcon = (isVisible) => {
        toggleBtn.innerHTML = isVisible ? '👁️' : '🚫';
        toggleBtn.title = isVisible ? 'Ocultar Backtest (Overlay)' : 'Mostrar Backtest (Overlay)';
        toggleBtn.classList.toggle('text-blue-400', isVisible);
        toggleBtn.classList.toggle('text-gray-500', !isVisible);
        toggleBtn.classList.toggle('opacity-50', !isVisible);
    };

    // Listeners
    prevBtn.addEventListener('click', () => navigate(-1));
    nextBtn.addEventListener('click', () => navigate(1));

    toggleBtn.addEventListener('click', () => {
        getFocusedContext().then(ctx => {
            if (!ctx) return;
            const { focusedStrategy } = ctx;
            // We pass toggleBtn as the second arg so it gets the visual update effects if we wanted animations,
            // but strictly toggleStrategyOverlay updates the element passed to it.
            // However, toggleStrategyOverlay handles the ROW button usually.
            // If we pass toggleBtn here, it will animate THIS button.
            window.toggleStrategyOverlay(focusedStrategy.name, toggleBtn);
        });
    });

    // Expose for external sync
    window.updateFocusPanelEye = updateEyeIcon;
};

// Initialize on load
document.addEventListener('DOMContentLoaded', initFocusedStrategyNavigation);

