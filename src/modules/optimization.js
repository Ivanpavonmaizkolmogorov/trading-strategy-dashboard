import { dom } from '../dom.js';
import { state } from '../state.js';
import { ALL_METRICS } from '../config.js';
import { toggleLoading, formatMetricForDisplay, displayError } from '../utils.js';
import { processStrategyData, reAnalyzeAllData } from '../analysis.js';

let optimizationModalElements; // To be initialized on first open

function getOptimizationModalElements() {
    if (!optimizationModalElements) {
        optimizationModalElements = {
            modal: document.getElementById('optimization-modal'),
            backdrop: document.getElementById('optimization-modal-backdrop'),
            content: document.getElementById('optimization-modal-content'),
            closeBtn: document.getElementById('close-optimization-modal-btn'),
            startBtn: document.getElementById('start-single-optimization-btn'),
            portfolioNameEl: document.getElementById('optimization-portfolio-name'),
            targetMetricSelect: document.getElementById('optimization-target-metric'),
            targetGoalSelect: document.getElementById('optimization-target-goal'),
            resultsContainer: document.getElementById('optimization-results-container'),
            simulationsCountInput: document.getElementById('simulations-count'),
            setupContainer: document.getElementById('optimization-setup-container'),
            scaleRiskCheckbox: document.getElementById('optimization-scale-risk-checkbox'),
            targetMaxDDInput: document.getElementById('optimization-target-max-dd'),
            targetMaxDDSlider: document.getElementById('optimization-target-max-dd-slider'),
            title: document.getElementById('optimization-modal-title'),
        };
    }
    return optimizationModalElements;
}

export const openOptimizationModal = (portfolioIndex) => {
    const elements = getOptimizationModalElements();
    state.currentOptimizationData = { portfolioIndex };
    const portfolio = state.savedPortfolios[portfolioIndex];

    elements.title.textContent = 'Editar Portafolio';

    const strategyNames = portfolio.indices.map(i => state.loadedStrategyFiles[i]?.name.replace('.csv', '') || `Estrategia ${i+1}`);
    let compositionHTML = `<p class="font-semibold text-lg text-sky-300 mb-2">${portfolio.name}</p>`;
    compositionHTML += '<p class="text-sm text-gray-400 mb-3">Haz clic en una estrategia para copiar su nombre:</p>';
    compositionHTML += '<ul class="space-y-1">';
    strategyNames.forEach(name => {
        compositionHTML += `<li><span class="copyable-strategy text-gray-300 text-sm p-1 rounded-md transition-colors duration-200" title="Copiar '${name}'">${name}</span></li>`;
    });
    compositionHTML += '</ul>';
    elements.portfolioNameEl.innerHTML = compositionHTML;

    elements.resultsContainer.innerHTML = '';
    elements.resultsContainer.classList.add('hidden');
    elements.setupContainer.classList.remove('hidden');

    elements.targetMetricSelect.innerHTML = dom.optimizationMetricSelect.innerHTML;
    elements.targetMetricSelect.value = 'sortinoRatio';
    elements.targetGoalSelect.value = 'maximize';
    
    // Buscamos el análisis ya hecho para obtener las métricas del backend y el MaxDD
    const originalPortfolioAnalysis = window.analysisResults?.find(r => r.isSavedPortfolio && r.savedIndex === portfolioIndex);
    const currentAnalysis = originalPortfolioAnalysis?.analysis;

    // --- MEJORA: Configurar controles de escalado de riesgo con el valor actual ---
    const riskConfig = portfolio.riskConfig || {};
    elements.scaleRiskCheckbox.checked = riskConfig.isScaled || false;
    elements.targetMaxDDInput.value = riskConfig.targetMaxDD || (currentAnalysis ? currentAnalysis.metrics.maxDrawdownInDollars.toFixed(0) : 10000);
    if (currentAnalysis) {
        // Establecer el máximo del slider en 1.5x el DD actual, o el valor guardado si es mayor.
        const sliderMax = Math.max(currentAnalysis.metrics.maxDrawdownInDollars * 1.5, parseFloat(elements.targetMaxDDInput.value));
        elements.targetMaxDDSlider.max = sliderMax.toFixed(0);
    }
    elements.targetMaxDDSlider.value = elements.targetMaxDDInput.value;
    elements.targetMaxDDInput.parentElement.classList.toggle('hidden', !elements.scaleRiskCheckbox.checked);

    // Limpiamos los resultados anteriores y mostramos el panel de búsqueda
    elements.resultsContainer.innerHTML = '<p class="text-center text-gray-400">Inicia una búsqueda para ver los resultados.</p>';
    elements.resultsContainer.classList.remove('hidden');
    elements.setupContainer.classList.remove('hidden');

    // Ocultar el contenedor de resultados y mostrar el de setup
    elements.resultsContainer.classList.add('hidden');
    elements.setupContainer.classList.remove('hidden');

    elements.modal.classList.remove('hidden');
    elements.modal.classList.add('flex');
    setTimeout(() => {
        elements.backdrop.classList.remove('opacity-0');
        elements.content.classList.remove('scale-95', 'opacity-0');
    }, 10);
};

export const closeOptimizationModal = () => {
    const elements = getOptimizationModalElements();
    elements.backdrop.classList.add('opacity-0');
    elements.content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        elements.modal.classList.add('hidden');
        elements.modal.classList.remove('flex');
    }, 300);
};

export const startOptimizationSearch = async () => {
    const elements = getOptimizationModalElements();
    toggleLoading(true, 'start-single-optimization-btn', 'start-optimization-btn-text', 'start-optimization-btn-spinner');
    elements.resultsContainer.classList.add('hidden');
    
    await new Promise(resolve => setTimeout(resolve, 10));
    
    try {
        const portfolio = state.savedPortfolios[state.currentOptimizationData.portfolioIndex];
        const activeDatabankView = state.tableViews.databank[state.activeViews.databank] || state.tableViews.databank['default'];

        const requestBody = {
            portfolio_indices: portfolio.indices,
            strategies_data: state.rawStrategiesData,
            benchmark_data: state.rawBenchmarkData,
            is_risk_scaled: elements.scaleRiskCheckbox.checked,
            target_max_dd: parseFloat(elements.targetMaxDDInput.value),
            params: {
                num_simulations: parseInt(elements.simulationsCountInput.value, 10),
                target_metric: elements.targetMetricSelect.value,
                target_goal: elements.targetGoalSelect.value,
                min_weight: parseFloat(dom.minWeightFilter.value) / 100,
                metrics_for_balance: activeDatabankView.columns.filter(key => key !== 'name' && key !== 'metricValue'),
            }
        };

        const response = await fetch('http://localhost:8001/analysis/optimize-portfolio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Error en la respuesta del backend de optimización');
        }

        const optimizationResults = await response.json();

        const finalResults = {
            ...optimizationResults,
            portfolio: portfolio,
            optimizationMetricName: elements.targetMetricSelect.options[elements.targetMetricSelect.selectedIndex].text
        };

        state.currentOptimizationData.lastResults = finalResults; // Guardar para recálculo
        displayOptimizationResults(finalResults);

    } catch (error) {
        console.error("Error during optimization:", error);
        displayError(`Ocurrió un error al optimizar los pesos: ${error.message}`);
    } finally {
        toggleLoading(false, 'start-single-optimization-btn', 'start-optimization-btn-text', 'start-optimization-btn-spinner');
    }
};

const displayOptimizationResults = (results) => {
    let { baseAnalysis, metricBestAnalysis, balancedBestAnalysis, portfolio, optimizationMetricName } = results;
    const elements = getOptimizationModalElements();

    let tableRows = '';
    const metricsToDisplay = (state.tableViews.databank[state.activeViews.databank] || state.tableViews.databank['default']).columns.filter(key => key !== 'name' && key !== 'metricValue');
    
    metricsToDisplay.forEach(metricKey => {
        const metricInfo = ALL_METRICS[metricKey];
        // Usamos optional chaining por si algún análisis falla
        if (!metricInfo || !baseAnalysis?.metrics || !metricBestAnalysis?.metrics || !balancedBestAnalysis?.metrics) return;

        const originalValue = baseAnalysis.metrics[metricKey];
        const metricOptimizedValue = metricBestAnalysis.metrics[metricKey];
        const balancedOptimizedValue = balancedBestAnalysis.metrics[metricKey];
        const isMinimizing = metricKey.toLowerCase().includes('drawdown') || metricKey.toLowerCase().includes('loss') || metricKey.toLowerCase().includes('stagnation');
        
        const getImprovement = (optValue) => {
            if (isFinite(originalValue) && isFinite(optValue) && originalValue !== 0) {
                return isMinimizing ? ((originalValue - optValue) / Math.abs(originalValue)) * 100 : ((optValue - originalValue) / Math.abs(originalValue)) * 100;
            }
            return 0;
        };

        const metricImprovement = getImprovement(metricOptimizedValue);
        const balancedImprovement = getImprovement(balancedOptimizedValue);

        const formatImprovement = (improvement) => {
            const color = improvement >= 0 ? 'text-green-400' : 'text-red-400';
            const icon = improvement >= 0 ? '▲' : '▼';
            return `<span class="${color}"><span>${icon}</span> <span>${Math.abs(improvement).toFixed(2)}%</span></span>`;
        };

        tableRows += `<tr class="border-b border-gray-700">
            <td class="p-2 font-semibold">${metricInfo.label}</td>
            <td class="p-2 text-right">${formatMetricForDisplay(originalValue, metricKey)}</td>
            <td class="p-2 text-right font-bold text-teal-300">${formatMetricForDisplay(metricOptimizedValue, metricKey)}</td>
            <td class="p-2 text-right font-bold text-sky-300">${formatMetricForDisplay(balancedOptimizedValue, metricKey)}</td>
            <td class="p-2 text-right">${formatImprovement(metricImprovement)}</td>
            <td class="p-2 text-right">${formatImprovement(balancedImprovement)}</td>
        </tr>`;
    });

    let html = `<h3 class="text-xl font-bold text-white mb-3">Resultados de Composición</h3>
        <div class="overflow-x-auto bg-gray-900/50 rounded-lg border border-gray-700">
            <table class="w-full text-sm">
                <thead class="bg-gray-700 text-xs text-gray-400 uppercase">
                    <tr>
                        <th class="p-2 text-left">Métrica</th>
                        <th class="p-2 text-right">Original</th>
                        <th class="p-2 text-right">Óptimo (Métrica)</th>
                        <th class="p-2 text-right">Óptimo (Balanceado)</th>
                        <th class="p-2 text-right">Mejora (Métrica)</th>
                        <th class="p-2 text-right">Mejora (Balance)</th>
                    </tr>
                </thead>
                <tbody>${tableRows}</tbody>
            </table>
        </div>`;

    const savePortfolio = (isNew, weightsToSave, analysisToUse, nameSuffix) => {
        const baseName = portfolio.name.replace(/ \(Opt.*?\)/, '').replace(' (Original)', '');
        const newName = `${baseName} ${nameSuffix}`;

        // --- NUEVO: Guardar la configuración de riesgo junto al portafolio ---
        const riskConfig = {
            isScaled: elements.scaleRiskCheckbox.checked,
            targetMaxDD: parseFloat(elements.targetMaxDDInput.value)
        };

        const newPortfolioData = {
            name: newName,
            indices: portfolio.indices,
            id: isNew ? state.nextPortfolioId++ : portfolio.id,
            weights: weightsToSave,
            comments: isNew ? `Copia optimizada de '${portfolio.name}'.` : portfolio.comments || '',
            riskConfig: riskConfig // Guardamos la configuración
        };

        if (isNew) {
            state.savedPortfolios.push(newPortfolioData);
        } else {
            state.savedPortfolios[state.currentOptimizationData.portfolioIndex] = newPortfolioData;
        }

        reAnalyzeAllData();
        closeOptimizationModal();
    };

    html += `<div class="mt-6 grid grid-cols-2 gap-x-4 gap-y-2">
        <button id="apply-metric-btn" class="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-3 rounded">Aplicar Óptimo (Métrica)</button>
        <button id="apply-balanced-btn" class="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-3 rounded">Aplicar Óptimo (Balance)</button>
        <button id="save-new-metric-btn" class="w-full bg-teal-800 hover:bg-teal-900 text-white font-semibold py-1.5 px-3 rounded text-xs">Guardar como Nuevo (Opt. Métrica)</button>
        <button id="save-new-balanced-btn" class="w-full bg-sky-800 hover:bg-sky-900 text-white font-semibold py-1.5 px-3 rounded text-xs">Guardar como Nuevo (Opt. Balance)</button>
    </div>`;

    elements.resultsContainer.innerHTML = html;
    elements.resultsContainer.classList.remove('hidden');

    document.getElementById('apply-metric-btn').addEventListener('click', () => savePortfolio(false, metricBestAnalysis.weights, metricBestAnalysis, `(Opt. ${optimizationMetricName})`));
    document.getElementById('apply-balanced-btn').addEventListener('click', () => savePortfolio(false, balancedBestAnalysis.weights, balancedBestAnalysis, `(Opt. Balanceado)`));
    document.getElementById('save-new-metric-btn').addEventListener('click', () => savePortfolio(true, metricBestAnalysis.weights, metricBestAnalysis, `(Opt. ${optimizationMetricName})`));
    document.getElementById('save-new-balanced-btn').addEventListener('click', () => savePortfolio(true, balancedBestAnalysis.weights, balancedBestAnalysis, `(Opt. Balanceado)`));
};

/**
 * Recalcula los resultados en el modal cuando cambia el Target Max DD.
 */
export const reevaluateOptimizationResults = () => {
    if (state.currentOptimizationData && state.currentOptimizationData.lastResults) {
        // Vuelve a lanzar la búsqueda con los nuevos parámetros de riesgo
        startOptimizationSearch();
    }
};