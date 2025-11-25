import { dom } from '../dom.js';
import { state } from '../state.js';
import { ALL_METRICS } from '../config.js';
import { toggleLoading, formatMetricForDisplay } from '../utils.js';
import { reAnalyzeAllData } from '../analysis.js';
import { showToast } from './notifications.js';
import { METRIC_CONFIG } from './searchConfig.js';

// Helper function to determine if an increase in a metric value is an improvement
const isIncreaseGood = (metricKey) => {
    const config = METRIC_CONFIG[metricKey];
    if (!config) return true; // Default: higher is better
    return config.goal === 'maximize';
};

let optimizationModalElements; // To be initialized on first open
let optimizationAbortController = null; // Para cancelar requests

function getOptimizationModalElements() {
    if (!optimizationModalElements) {
        optimizationModalElements = {
            modal: document.getElementById('optimization-modal'),
            backdrop: document.getElementById('optimization-modal-backdrop'),
            panel: document.getElementById('optimization-panel'),
            closeBtn: document.getElementById('close-optimization-modal-btn'),
            startBtn: document.getElementById('start-single-optimization-btn'),
            portfolioNameEl: document.getElementById('optimization-portfolio-name'),
            strategyTableBody: document.getElementById('optimization-strategy-table-body'),
            targetMetricSelect: document.getElementById('optimization-target-metric'),
            targetGoalSelect: document.getElementById('optimization-target-goal'),
            resultsContainer: document.getElementById('optimization-results-container'),
            simulationsCountInput: document.getElementById('simulations-count'),
            simulationsDisplay: document.getElementById('simulations-display'),
            setupContainer: document.getElementById('optimization-setup-container'),
            progressContainer: document.getElementById('optimization-progress-container'),
            progressBar: document.getElementById('optimization-progress-bar'),
            progressText: document.getElementById('optimization-progress-text'),
            progressPercentage: document.getElementById('optimization-progress-percentage'),
            title: document.getElementById('optimization-modal-title'),
            scaleRiskCheckbox: document.getElementById('optimization-scale-risk-checkbox'),
            riskScalingOptions: document.getElementById('optimization-risk-scaling-options'),
            normalizationMetricSelect: document.getElementById('optimization-normalization-metric'),
            targetMaxDDInput: document.getElementById('optimization-target-max-dd'),
            cancelBtn: document.getElementById('cancel-optimization-btn'),
        };
    }
    return optimizationModalElements;
}

/**
 * NEW: Start optimization workflow using tab instead of modal
 */
export const startOptimizationWorkflow = (portfolioIndex) => {
    console.log('=================================================');
    console.log('[Optimization] startOptimizationWorkflow CALLED');
    console.log('[Optimization] Portfolio index:', portfolioIndex);
    console.log('=================================================');

    // Store current portfolio index
    state.currentOptimizationData = { portfolioIndex };
    const portfolio = state.savedPortfolios[portfolioIndex];

    console.log('[Optimization] Portfolio object:', portfolio);

    if (!portfolio) {
        console.error('[Optimization] ❌ Portfolio not found at index:', portfolioIndex);
        return;
    }

    console.log('[Optimization] ✅ Portfolio found:', portfolio.name);
    console.log('[Optimization] Portfolio indices:', portfolio.indices);

    // Switch to optimization tab
    console.log('[Optimization] 🔄 Switching to optimization tab...');
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');

    console.log('[Optimization] Found tabs:', tabs.length);
    console.log('[Optimization] Found contents:', contents.length);

    tabs.forEach(tab => tab.classList.remove('active'));
    contents.forEach(content => {
        content.classList.remove('active', 'flex');
        content.classList.add('hidden');
    });

    const optTab = Array.from(tabs).find(t => t.dataset.target === 'optimization-content');
    const optContent = document.getElementById('optimization-content');

    console.log('[Optimization] Opt tab found:', !!optTab);
    console.log('[Optimization] Opt content found:', !!optContent);

    if (optTab) {
        optTab.classList.add('active');
        console.log('[Optimization] ✅ Tab activated');
    }
    if (optContent) {
        optContent.classList.remove('hidden');
        optContent.classList.add('active', 'flex');
        console.log('[Optimization] ✅ Content shown');
    }

    // Populate portfolio info
    const portfolioNameEl = document.getElementById('opt-portfolio-name');
    const strategiesEl = document.getElementById('opt-portfolio-strategies');

    console.log('[Optimization] Name element found:', !!portfolioNameEl);
    console.log('[Optimization] Strategies element found:', !!strategiesEl);

    if (portfolioNameEl) {
        portfolioNameEl.textContent = portfolio.name;
        console.log('[Optimization] ✅ Set portfolio name:', portfolio.name);
    }

    if (strategiesEl) {
        const strategyNames = portfolio.indices.map(i =>
            state.loadedStrategyFiles[i]?.name.replace('.csv', '') || `Strategy ${i + 1}`
        );
        console.log('[Optimization] Strategy names:', strategyNames);
        strategiesEl.innerHTML = strategyNames.map(name =>
            `<span class="inline-block bg-gray-700 px-2 py-0.5 rounded mr-1 mb-1">${name}</span>`
        ).join('');
        console.log('[Optimization] ✅ Strategies populated');
    }

    // Reset UI state
    const progressSection = document.getElementById('opt-progress-section');
    const resultsSection = document.getElementById('opt-results-section');
    const startBtn = document.getElementById('opt-start-btn');
    const cancelBtn = document.getElementById('opt-cancel-btn');

    console.log('[Optimization] UI elements:', {
        progressSection: !!progressSection,
        resultsSection: !!resultsSection,
        startBtn: !!startBtn,
        cancelBtn: !!cancelBtn
    });

    if (progressSection) progressSection.classList.add('hidden');
    if (resultsSection) resultsSection.classList.add('hidden');
    if (startBtn) {
        startBtn.disabled = false;
        startBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    if (cancelBtn) cancelBtn.classList.add('hidden');

    console.log('[Optimization] ✅ Tab workflow complete!');
    console.log('[Optimization] 💡 Portfolio saved in state.currentOptimizationData');
    console.log('=================================================');

    // Populate dropdown for other portfolios
    populatePortfolioDropdown(portfolioIndex);
};

/**
 * Populate the portfolio dropdown in the optimization tab
 */
function populatePortfolioDropdown(selectedIndex = null) {
    const dropdown = document.getElementById('opt-portfolio-dropdown');
    if (!dropdown) return;

    // Clear existing options except first
    dropdown.innerHTML = '<option value="">-- Choose a portfolio --</option>';

    // Add all saved portfolios
    state.savedPortfolios.forEach((portfolio, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = portfolio.name;
        if (index === selectedIndex) {
            option.selected = true;
        }
        dropdown.appendChild(option);
    });

    console.log('[Optimization] Dropdown populated with', state.savedPortfolios.length, 'portfolios');
}

export const openOptimizationModal = async (portfolioIndex) => {
    console.log('[Optimization] openOptimizationModal llamado con índice:', portfolioIndex);
    const elements = getOptimizationModalElements();
    console.log('[Optimization] Elementos obtenidos:', {
        modal: !!elements.modal,
        panel: !!elements.panel,
        backdrop: !!elements.backdrop
    });

    // Verificar que el modal exista
    if (!elements.modal || !elements.panel) {
        console.error('[Optimization] Modal no encontrado - elements.modal:', !!elements.modal, 'elements.panel:', !!elements.panel);
        showToast('Modal de optimización no disponible', 'error');
        return;
    }

    console.log('[Optimization] Modal existe, continuando...');
    state.currentOptimizationData = { portfolioIndex };
    const portfolio = state.savedPortfolios[portfolioIndex];

    // Actualizar título y tabla de estrategias
    if (elements.title) elements.title.textContent = `Optimizar: ${portfolio.name}`;

    // Poblar tabla de estrategias
    if (elements.strategyTableBody) {
        const strategyNames = portfolio.indices.map(i => state.loadedStrategyFiles[i]?.name.replace('.csv', '') || `Estrategia ${i + 1}`);
        const currentWeights = portfolio.weights || portfolio.indices.map(() => 1 / portfolio.indices.length);

        let tableHTML = '';
        strategyNames.forEach((name, idx) => {
            const currentWeight = (currentWeights[idx] * 100).toFixed(1);
            const baseRisk = 100; // Todas las estrategias parten de $100/operación

            tableHTML += `
                <tr class="strategy-row" data-strategy-index="${idx}">
                    <td class="px-2 py-2 text-gray-300">${name}</td>
                    <td class="px-2 py-2 text-right text-gray-400">${currentWeight}%</td>
                    <td class="px-2 py-2 text-right text-gray-400">$${baseRisk.toFixed(2)}</td>
                    <td class="px-2 py-2 text-right text-gray-500 new-weight">-</td>
                    <td class="px-2 py-2 text-right text-gray-500 new-risk">-</td>
                </tr>
            `;
        });
        elements.strategyTableBody.innerHTML = tableHTML;
    }

    // Configurar selector de métricas - poblar con opciones
    if (elements.targetMetricSelect) {
        elements.targetMetricSelect.innerHTML = `
            <option value="sortinoRatio">Sortino Ratio</option>
            <option value="sharpeRatio">Sharpe Ratio</option>
            <option value="upi">UPI</option>
            <option value="profitMaxDD_Ratio">Ret/DD</option>
            <option value="sqn">SQN</option>
            <option value="profitFactor">Profit Factor</option>
            <option value="monthlyAvgProfit">Profit/Mes</option>
            <option value="winningPercentage">Win %</option>
            <option value="maxDrawdownInDollars">Max DD</option>
            <option value="ulcerIndexInDollars">Ulcer Index</option>
        `;
        elements.targetMetricSelect.value = 'sortinoRatio';
    }
    if (elements.targetGoalSelect) elements.targetGoalSelect.value = 'maximize';

    // Configurar slider de simulaciones
    if (elements.simulationsCountInput && elements.simulationsDisplay) {
        elements.simulationsCountInput.addEventListener('input', (e) => {
            elements.simulationsDisplay.textContent = e.target.value;
        });
        elements.simulationsDisplay.textContent = elements.simulationsCountInput.value;
    }

    // Configurar escalado de riesgo
    const riskConfig = portfolio.riskConfig || {};
    if (elements.scaleRiskCheckbox) {
        elements.scaleRiskCheckbox.checked = riskConfig.isScaled || false;
        elements.scaleRiskCheckbox.addEventListener('change', (e) => {
            if (elements.riskScalingOptions) {
                elements.riskScalingOptions.classList.toggle('hidden', !e.target.checked);
            }
        });
        // Trigger inicial
        if (elements.riskScalingOptions) {
            elements.riskScalingOptions.classList.toggle('hidden', !elements.scaleRiskCheckbox.checked);
        }
    }

    const currentMetrics = portfolio.metrics;
    if (elements.normalizationMetricSelect) elements.normalizationMetricSelect.value = riskConfig.normalizationMetric || 'max_dd';
    if (elements.targetMaxDDInput) elements.targetMaxDDInput.value = riskConfig.targetValue || (currentMetrics ? currentMetrics.maxDrawdownInDollars.toFixed(0) : 10000);

    // Ocultar resultados inicialmente
    if (elements.resultsContainer) elements.resultsContainer.classList.add('hidden');
    if (elements.progressContainer) elements.progressContainer.classList.add('hidden'); // Ocultar progreso al abrir
    if (elements.startBtn) {
        elements.startBtn.disabled = false;
        elements.startBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    if (elements.cancelBtn) elements.cancelBtn.classList.add('hidden');


    // Mostrar modal con animación slide-in
    showModalWithAnimation(elements);
};

export const closeOptimizationModal = () => {
    const elements = getOptimizationModalElements();
    if (!elements.panel || !elements.backdrop) return;

    elements.panel.classList.add('translate-x-full');
    elements.backdrop.classList.add('opacity-0');

    setTimeout(() => {
        if (elements.modal) {
            elements.modal.classList.add('hidden');
        }
    }, 300);
};

const showModalWithAnimation = (elements) => {
    if (!elements.modal || !elements.panel || !elements.backdrop) return;

    elements.modal.classList.remove('hidden');

    // Trigger reflow to ensure animation works
    requestAnimationFrame(() => {
        elements.backdrop.classList.remove('opacity-0');
        elements.panel.classList.remove('translate-x-full');
    });
};

export const startOptimizationSearch = async (isInitialLoad = false) => {
    console.log('[Optimization] ========== INICIO OPTIMIZACIÓN ==========');
    console.log('[Optimization] isInitialLoad:', isInitialLoad);
    const elements = getOptimizationModalElements();

    if (!isInitialLoad) {
        console.log('[Optimization] Mostrando UI de progreso...');
        // Mostrar progreso y deshabilitar botón iniciar
        if (elements.progressContainer) elements.progressContainer.classList.remove('hidden');
        if (elements.startBtn) {
            elements.startBtn.disabled = true;
            elements.startBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
        if (elements.progressBar) elements.progressBar.style.width = '0%';
        if (elements.progressPercentage) elements.progressPercentage.textContent = '0%';
        if (elements.progressText) elements.progressText.textContent = 'Iniciando optimización...';

        // Mostrar botón cancelar
        const cancelBtn = elements.cancelBtn;
        if (cancelBtn) {
            cancelBtn.classList.remove('hidden');
            cancelBtn.disabled = false;
        }
    }

    await new Promise(resolve => setTimeout(resolve, 10));

    try {
        const portfolio = state.savedPortfolios[state.currentOptimizationData.portfolioIndex];
        const metricsForBalance = state.defaultMetricColumns;
        const numSimulations = isInitialLoad ? 0 : parseInt(elements.simulationsCountInput.value, 10);

        console.log('[Optimization] Configuración:');
        console.log('  - Portafolio:', portfolio.name);
        console.log('  - Simulaciones:', numSimulations);
        console.log('  - Métrica:', elements.targetMetricSelect.value);
        console.log('  - Objetivo:', elements.targetGoalSelect.value);

        const requestBody = {
            portfolio_indices: portfolio.indices,
            strategies_data: state.rawStrategiesData,
            is_risk_normalized: false,
            normalization_metric: 'max_dd',
            normalization_target_value: 0,
            params: {
                num_simulations: numSimulations,
                target_metric: elements.targetMetricSelect.value,
                target_goal: elements.targetGoalSelect.value,
                min_weight: parseFloat(dom.minWeightFilter.value) / 100,
                metrics_for_balance: metricsForBalance,
            }
        };

        console.log('[Optimization] Request body preparado:', requestBody.params);

        // Crear AbortController para poder cancelar
        optimizationAbortController = new AbortController();

        // Simular progreso mientras espera respuesta
        if (!isInitialLoad) {
            simulateProgress(numSimulations);
        }

        console.log('[Optimization] Enviando request a /analysis/optimize-portfolio...');
        const startTime = Date.now();

        const response = await fetch('/analysis/optimize-portfolio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: optimizationAbortController.signal
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[Optimization] Respuesta recibida en ${elapsed}s`);

        if (!response.ok) {
            const errorData = await response.json();
            console.error('[Optimization] Error del backend:', errorData);
            throw new Error(errorData.detail || 'Error en la respuesta del backend de optimización');
        }

        const optimizationResults = await response.json();
        console.log('[Optimization] Resultados recibidos:', optimizationResults);

        // Completar progreso
        if (elements.progressBar) elements.progressBar.style.width = '100%';
        if (elements.progressPercentage) elements.progressPercentage.textContent = '100%';
        if (elements.progressText) elements.progressText.textContent = '¡Optimización completada!';

        const finalResults = {
            ...optimizationResults,
            portfolio: portfolio,
            optimizationMetricName: elements.targetMetricSelect.options[elements.targetMetricSelect.selectedIndex].text
        };

        state.currentOptimizationData.lastResults = finalResults;

        console.log('[Optimization] Mostrando resultados...');
        displayOptimizationResults(finalResults);
        elements.setupContainer.classList.remove('hidden');

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('[Optimization] Optimización cancelada por el usuario.');
            showToast('Optimización cancelada.', 'info');
        } else {
            console.error("Error during optimization:", error);
            showToast(`Ocurrió un error al optimizar los pesos: ${error.message}`, 'error');
        }
    } finally {
        if (!isInitialLoad) {
            toggleLoading(false, 'start-single-optimization-btn', 'start-optimization-btn-text', 'start-optimization-btn-spinner');
        }
    }
};

const displayOptimizationResults = (results) => {
    console.log('[Optimization] displayOptimizationResults iniciado');
    let { baseAnalysis, metricBestAnalysis, balancedBestAnalysis, portfolio, optimizationMetricName } = results;
    const elements = getOptimizationModalElements();

    // 1. Actualizar tabla de estrategias con nuevos pesos (óptimo por métrica)
    console.log('[Optimization] Actualizando tabla de estrategias...');
    const metricWeights = metricBestAnalysis.weights;
    const balancedWeights = balancedBestAnalysis.weights;

    document.querySelectorAll('.strategy-row').forEach((row, idx) => {
        const metricWeight = metricWeights[idx];
        const metricRisk = 100 * metricWeight;

        const newWeightCell = row.querySelector('.new-weight');
        const newRiskCell = row.querySelector('.new-risk');

        if (newWeightCell) {
            newWeightCell.textContent = `${(metricWeight * 100).toFixed(1)}%`;
            newWeightCell.classList.remove('text-gray-500');
            newWeightCell.classList.add('text-purple-400', 'font-semibold');
        }
        if (newRiskCell) {
            newRiskCell.textContent = `$${metricRisk.toFixed(2)}`;
            newRiskCell.classList.remove('text-gray-500');
            newRiskCell.classList.add('text-purple-400', 'font-semibold');
        }
    });

    // 2. Crear tabla comparativa de KPIs principales
    console.log('[Optimization] Generando tabla de KPIs...');
    const targetMetric = elements.targetMetricSelect.value;
    const targetMetricLabel = elements.targetMetricSelect.options[elements.targetMetricSelect.selectedIndex].text;
    const numSimulations = parseInt(elements.simulationsCountInput.value, 10);

    // KPIs principales a mostrar
    const keyMetrics = ['sortinoRatio', 'sharpeRatio', 'profitMaxDD_Ratio', 'maxDrawdownInDollars', 'profitFactor', 'winningPercentage'];

    let kpiRows = '';
    keyMetrics.forEach(metricKey => {
        const metricInfo = ALL_METRICS[metricKey];
        if (!metricInfo) return;

        const baseValue = baseAnalysis.metrics[metricKey];
        const metricValue = metricBestAnalysis.metrics[metricKey];
        const balancedValue = balancedBestAnalysis.metrics[metricKey];

        const metricChange = ((metricValue - baseValue) / Math.abs(baseValue)) * 100;
        const balancedChange = ((balancedValue - baseValue) / Math.abs(baseValue)) * 100;

        const formatChange = (change, metricKey) => {
            // For metrics where lower is better, invert the color logic
            const isImprovement = isIncreaseGood(metricKey)
                ? change >= 0  // Normal: positive change is good
                : change <= 0; // Inverted: negative change is good (DD decrease)

            const color = isImprovement ? 'text-green-400' : 'text-red-400';
            const icon = change >= 0 ? '▲' : '▼';
            return `<span class="${color} text-xs">${icon} ${Math.abs(change).toFixed(1)}%</span>`;
        };

        kpiRows += `
            <tr class="border-b border-gray-700">
                <td class="px-2 py-1 text-xs text-gray-300">${metricInfo.label}</td>
                <td class="px-2 py-1 text-xs text-right text-gray-400">${formatMetricForDisplay(baseValue, metricKey)}</td>
                <td class="px-2 py-1 text-xs text-right">
                    ${formatMetricForDisplay(metricValue, metricKey)} ${formatChange(metricChange, metricKey)}
                </td>
                <td class="px-2 py-1 text-xs text-right">
                    ${formatMetricForDisplay(balancedValue, metricKey)} ${formatChange(balancedChange, metricKey)}
                </td>
            </tr>
        `;
    });

    // 3. Crear HTML con cards mejoradas
    const baseValue = baseAnalysis.metrics[targetMetric];
    const metricValue = metricBestAnalysis.metrics[targetMetric];
    const balancedValue = balancedBestAnalysis.metrics[targetMetric];

    const metricImprovement = ((metricValue - baseValue) / Math.abs(baseValue)) * 100;
    const balancedImprovement = ((balancedValue - baseValue) / Math.abs(baseValue)) * 100;

    const html = `
        <div class="space-y-4">
            <h3 class="text-lg font-bold text-white border-b border-gray-600 pb-2">Resultados de Optimización</h3>
            
            <!-- KPI Comparison Table -->
            <div class="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
                <h4 class="text-sm font-semibold text-gray-300 mb-2">📊 Comparación de KPIs Principales</h4>
                <div class="overflow-x-auto">
                    <table class="w-full text-xs">
                        <thead class="bg-gray-700">
                            <tr>
                                <th class="px-2 py-1 text-left text-gray-400">Métrica</th>
                                <th class="px-2 py-1 text-right text-gray-400">Original</th>
                                <th class="px-2 py-1 text-right text-purple-400">Ópt. ${targetMetricLabel}</th>
                                <th class="px-2 py-1 text-right text-blue-400">Ópt. Balanceado</th>
                            </tr>
                        </thead>
                        <tbody>${kpiRows}</tbody>
                    </table>
                </div>
            </div>
            
            <!-- Comparison Cards -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <!-- Metric Best Card -->
                <div class="bg-gradient-to-br from-purple-900/30 to-purple-700/20 rounded-lg p-4 border-2 border-purple-500">
                    <div class="flex items-center gap-2 mb-2">
                        <span class="text-2xl">🎯</span>
                        <h4 class="font-bold text-purple-300">Óptimo por ${targetMetricLabel}</h4>
                    </div>
                    <div class="space-y-2">
                        <div>
                            <p class="text-xs text-gray-400">Valor ${targetMetricLabel}</p>
                            <p class="text-2xl font-bold text-white">${formatMetricForDisplay(metricValue, targetMetric)}</p>
                            <p class="text-sm ${isIncreaseGood(targetMetric) ? (metricImprovement >= 0 ? 'text-green-400' : 'text-red-400') : (metricImprovement <= 0 ? 'text-green-400' : 'text-red-400')}">
                                ${metricImprovement >= 0 ? '▲' : '▼'} ${Math.abs(metricImprovement).toFixed(2)}% vs original
                            </p>
                        </div>
                        <div class="pt-2 border-t border-purple-600">
                            <p class="text-xs text-gray-400 mb-1">Nuevos pesos:</p>
                            <p class="text-xs text-gray-300">${metricWeights.map((w, i) => `${(w * 100).toFixed(0)}%`).join(' / ')}</p>
                        </div>
                    </div>
                    <div class="mt-3 space-y-2">
                        <button data-type="metric" data-mode="overwrite" class="apply-optimized-weights-btn w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-3 rounded text-sm">
                            💾 Sobrescribir Original
                        </button>
                        <button data-type="metric" data-mode="new" class="apply-optimized-weights-btn w-full bg-purple-800 hover:bg-purple-900 text-white font-semibold py-1.5 px-3 rounded text-xs">
                            ➕ Guardar Como Nuevo
                        </button>
                    </div>
                </div>
                
                <!-- Balanced Best Card -->
                <div class="bg-gradient-to-br from-blue-900/30 to-blue-700/20 rounded-lg p-4 border-2 border-blue-500">
                    <div class="flex items-center gap-2 mb-2">
                        <span class="text-2xl">⚖️</span>
                        <h4 class="font-bold text-blue-300">Óptimo Balanceado</h4>
                    </div>
                    <div class="space-y-2">
                        <div>
                            <p class="text-xs text-gray-400">Valor ${targetMetricLabel}</p>
                            <p class="text-2xl font-bold text-white">${formatMetricForDisplay(balancedValue, targetMetric)}</p>
                            <p class="text-sm ${isIncreaseGood(targetMetric) ? (balancedImprovement >= 0 ? 'text-green-400' : 'text-red-400') : (balancedImprovement <= 0 ? 'text-green-400' : 'text-red-400')}">
                                ${balancedImprovement >= 0 ? '▲' : '▼'} ${Math.abs(balancedImprovement).toFixed(2)}% vs original
                            </p>
                        </div>
                        <div class="pt-2 border-t border-blue-600">
                            <p class="text-xs text-gray-400 mb-1">Nuevos pesos:</p>
                            <p class="text-xs text-gray-300">${balancedWeights.map((w, i) => `${(w * 100).toFixed(0)}%`).join(' / ')}</p>
                        </div>
                    </div>
                    <div class="mt-3 space-y-2">
                        <button data-type="balanced" data-mode="overwrite" class="apply-optimized-weights-btn w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-3 rounded text-sm">
                            💾 Sobrescribir Original
                        </button>
                        <button data-type="balanced" data-mode="new" class="apply-optimized-weights-btn w-full bg-blue-800 hover:bg-blue-900 text-white font-semibold py-1.5 px-3 rounded text-xs">
                            ➕ Guardar Como Nuevo
                        </button>
                    </div>
                </div>
            </div>
            
            <div class="text-center text-xs text-gray-400 mt-2">
                <p>✨ Pesos optimizados basados en ${numSimulations} simulaciones Monte Carlo</p>
            </div>
        </div>
    `;

    // 4. Insertar en results container
    console.log('[Optimization] Insertando HTML en resultsContainer...');
    if (elements.resultsContainer) {
        elements.resultsContainer.innerHTML = html;
        elements.resultsContainer.classList.remove('hidden');

        // Añadir event listeners a los botones de aplicar
        document.querySelectorAll('.apply-optimized-weights-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const type = e.currentTarget.dataset.type;
                const mode = e.currentTarget.dataset.mode; // 'overwrite' o 'new'
                const weightsToApply = type === 'metric' ? metricWeights : balancedWeights;
                const analysisToApply = type === 'metric' ? metricBestAnalysis : balancedBestAnalysis;
                const nameToApply = type === 'metric' ? `(Opt. ${targetMetricLabel})` : '(Opt. Balanceado)';

                console.log(`[Optimization] Aplicando pesos tipo: ${type}, modo: ${mode}`, weightsToApply);
                applyOptimizedWeights(weightsToApply, nameToApply, analysisToApply, mode === 'new');
            });
        });
    }

    // 5. Ocultar progreso y habilitar botón de nuevo
    if (elements.progressContainer) elements.progressContainer.classList.add('hidden');
    if (elements.cancelBtn) elements.cancelBtn.classList.add('hidden');
    if (elements.startBtn) {
        elements.startBtn.disabled = false;
        elements.startBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }

    console.log('[Optimization] Resultados mostrados exitosamente');
    showToast('✅ Optimización completada - revisa los resultados', 'success');
};

/**
 * Aplica los pesos optimizados al portafolio
 */
function applyOptimizedWeights(weights, nameSuffix, analysis, isNew = false) {
    console.log('[Optimization] Aplicando pesos optimizados...', { weights, isNew });
    const portfolioIndex = state.currentOptimizationData.portfolioIndex;
    const portfolio = state.savedPortfolios[portfolioIndex];

    if (isNew) {
        // Crear nuevo portafolio
        const baseName = portfolio.name.split('(')[0].trim();
        const newPortfolio = {
            name: `${baseName} ${nameSuffix}`,
            indices: portfolio.indices,
            id: state.nextPortfolioId++,
            weights: weights,
            metrics: analysis.metrics,
            comments: `Optimizado desde '${portfolio.name}'`,
            riskConfig: portfolio.riskConfig || {}
        };
        state.savedPortfolios.push(newPortfolio);
        console.log('[Optimization] Nuevo portafolio creado:', newPortfolio.name);
        showToast(`✅ Nuevo portafolio creado: ${newPortfolio.name}`, 'success');
    } else {
        // Sobrescribir original
        portfolio.weights = weights;
        portfolio.name = `${portfolio.name.split('(')[0].trim()} ${nameSuffix}`;
        portfolio.metrics = analysis.metrics;
        console.log('[Optimization] Portafolio actualizado:', portfolio.name);
        showToast(`✅ Portafolio actualizado: ${portfolio.name}`, 'success');
    }

    // Cerrar modal
    closeOptimizationModal();

    // Actualizar UI
    import('../ui.js').then(module => {
        module.displaySavedPortfoliosList();
    });
}

const savePortfolio = (isNew, weightsToSave, analysisToUse, nameSuffix) => {
    const baseName = portfolio.name.replace(/ \(Opt.*?\)/, '').replace(' (Original)', '');
    const newName = `${baseName} ${nameSuffix}`;

    // --- CORRECCIÓN: Guardar la configuración de riesgo junto al portafolio ---
    // Si la casilla no está marcada, guardamos explícitamente isScaled: false
    // para que no se aplique normalización a este portafolio en futuros análisis.
    const riskConfig = {
        isScaled: elements.scaleRiskCheckbox.checked,
        normalizationMetric: elements.normalizationMetricSelect.value, // <-- NUEVO
        targetValue: elements.scaleRiskCheckbox.checked ? parseFloat(elements.targetMaxDDInput.value) : null
    };

    const newPortfolioData = {
        name: newName,
        indices: portfolio.indices,
        id: isNew ? state.nextPortfolioId++ : portfolio.id,
        weights: weightsToSave,
        comments: isNew ? `Copia optimizada de '${portfolio.name}'.` : portfolio.comments || '',
        riskConfig: riskConfig // Guardamos la configuración completa
    };

    if (isNew) {
        state.savedPortfolios.push(newPortfolioData);
    } else {
        state.savedPortfolios[state.currentOptimizationData.portfolioIndex] = newPortfolioData;
    }

    reAnalyzeAllData();
    closeOptimizationModal();
};

/**
 * Recalcula los resultados en el modal cuando cambia el Target Max DD.
 */
export const reevaluateOptimizationResults = () => {
    if (state.currentOptimizationData && state.currentOptimizationData.lastResults) {
        startOptimizationSearch(true);
    }
};

/**
 * Simula progreso mientras espera la respuesta del backend
 */
let progressInterval = null;
function simulateProgress(numSimulations) {
    const elements = getOptimizationModalElements();
    let progress = 0;
    const estimatedTime = Math.max(3, numSimulations / 100); // Estimar ~1s cada 100 sims, mín 3s
    const increment = 100 / (estimatedTime * 10); // Incrementos cada 100ms

    console.log(`[Optimization] Simulando progreso - tiempo estimado: ${estimatedTime}s`);

    // Limpiar interval anterior si existe
    if (progressInterval) clearInterval(progressInterval);

    progressInterval = setInterval(() => {
        progress = Math.min(progress + increment, 95); // No pasar del 95% hasta que termine

        if (elements.progressBar) elements.progressBar.style.width = `${progress.toFixed(1)}%`;
        if (elements.progressPercentage) elements.progressPercentage.textContent = `${Math.floor(progress)}%`;

        // Actualizar texto según progreso
        if (elements.progressText) {
            if (progress < 30) {
                elements.progressText.textContent = 'Generando combinaciones...';
            } else if (progress < 60) {
                elements.progressText.textContent = 'Evaluando pesos...';
            } else if (progress < 90) {
                elements.progressText.textContent = 'Calculando métricas...';
            } else {
                elements.progressText.textContent = 'Finalizando optimización...';
            }
        }

        if (progress >= 95) {
            clearInterval(progressInterval);
        }
    }, 100);
}

/**
 * Simulate progress in tab-based UI
 */
let progressIntervalTab = null;
function simulateProgressInTab(numSimulations) {
    const progressBar = document.getElementById('opt-progress-bar');
    const progressPercentage = document.getElementById('opt-progress-percentage');
    const progressText = document.getElementById('opt-progress-text');

    let progress = 0;
    const estimatedTime = Math.max(3, numSimulations / 100);
    const increment = 100 / (estimatedTime * 10);

    console.log(`[Optimization] 📊 Simulating progress - estimated time: ${estimatedTime}s`);

    if (progressIntervalTab) clearInterval(progressIntervalTab);

    progressIntervalTab = setInterval(() => {
        progress = Math.min(progress + increment, 95);

        if (progressBar) progressBar.style.width = `${progress.toFixed(1)}%`;
        if (progressPercentage) progressPercentage.textContent = `${Math.floor(progress)}%`;

        if (progressText) {
            if (progress < 30) {
                progressText.textContent = 'Generating combinations...';
            } else if (progress < 60) {
                progressText.textContent = 'Evaluating weights...';
            } else if (progress < 90) {
                progressText.textContent = 'Calculating metrics...';
            } else {
                progressText.textContent = 'Finalizing optimization...';
            }
        }

        if (progress >= 95) {
            clearInterval(progressIntervalTab);
        }
    }, 100);
}

/**
 * Cancela la optimización en curso
 */
export const cancelOptimization = () => {
    console.log('[Optimization] Cancelando optimización...');
    const elements = getOptimizationModalElements();

    if (optimizationAbortController) {
        optimizationAbortController.abort();
        optimizationAbortController = null;
    }

    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }

    // Restaurar UI
    if (elements.progressContainer) elements.progressContainer.classList.add('hidden');
    if (elements.startBtn) {
        elements.startBtn.disabled = false;
        elements.startBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    if (elements.cancelBtn) elements.cancelBtn.classList.add('hidden');

    showToast('Optimización cancelada', 'info');
};

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Modal elements (old workflow - keeping for now)
    const elements = getOptimizationModalElements();

    // Close button
    if (elements.closeBtn) {
        elements.closeBtn.addEventListener('click', closeOptimizationModal);
    }

    // Backdrop click to close
    if (elements.backdrop) {
        elements.backdrop.addEventListener('click', closeOptimizationModal);
    }

    // Start button
    if (elements.startBtn) {
        elements.startBtn.addEventListener('click', () => startOptimizationSearch(false));
    }

    // Cancel button
    if (elements.cancelBtn) {
        elements.cancelBtn.addEventListener('click', cancelOptimization);
    }

    // ======================
    // NEW: Tab-based controls
    // ======================

    // Simulations slider
    const simSlider = document.getElementById('opt-simulations-slider');
    const simDisplay = document.getElementById('opt-simulations-display');

    if (simSlider && simDisplay) {
        simSlider.addEventListener('input', (e) => {
            simDisplay.textContent = e.target.value;
        });
    }

    // Portfolio dropdown
    const portDropdown = document.getElementById('opt-portfolio-dropdown');
    if (portDropdown) {
        // Populate on page load
        populatePortfolioDropdown();

        // Handle selection
        portDropdown.addEventListener('change', (e) => {
            const selectedIndex = parseInt(e.target.value, 10);
            if (!isNaN(selectedIndex)) {
                console.log('[Optimization] Portfolio selected from dropdown:', selectedIndex);
                startOptimizationWorkflow(selectedIndex);
            }
        });
    }

    // Start optimization button
    const startOptBtn = document.getElementById('opt-start-btn');
    if (startOptBtn) {
        startOptBtn.addEventListener('click', () => {
            console.log('[Optimization] Start button clicked in tab');
            startOptimizationInTab();
        });
    }

    // Cancel button in tab
    const cancelOptBtn = document.getElementById('opt-cancel-btn');
    if (cancelOptBtn) {
        cancelOptBtn.addEventListener('click', () => {
            console.log('[[Optimization] Cancel button clicked in tab');
            cancelOptimizationInTab();
        });
    }
});

/**
 * Start optimization in tab-based workflow
 */
async function startOptimizationInTab() {
    console.log('=================================================');
    console.log('[Optimization] 🚀 startOptimizationInTab CALLED');
    console.log('[Optimization] state.currentOptimizationData:', state.currentOptimizationData);
    console.log('=================================================');

    if (!state.currentOptimizationData || state.currentOptimizationData.portfolioIndex === undefined) {
        console.error('[Optimization] ❌ No portfolio selected');
        showToast('Please select a portfolio first', 'error');
        return;
    }

    console.log('[Optimization] ✅ Portfolio index:', state.currentOptimizationData.portfolioIndex);

    const portfolio = state.savedPortfolios[state.currentOptimizationData.portfolioIndex];
    if (!portfolio) {
        console.error('[Optimization] ❌ Portfolio not found');
        showToast('Portfolio not found', 'error');
        return;
    }

    // Get config from tab
    const targetMetric = document.getElementById('opt-target-metric')?.value || 'sortinoRatio';
    const goal = document.getElementById('opt-goal')?.value || 'maximize';
    const numSimulations = parseInt(document.getElementById('opt-simulations-slider')?.value) || 1000;

    console.log(`[Optimization] 📊 Config: ${numSimulations} simulations, metric: ${targetMetric}, goal: ${goal}`);

    // Show progress, hide results
    const progressSection = document.getElementById('opt-progress-section');
    const resultsSection = document.getElementById('opt-results-section');
    const startBtn = document.getElementById('opt-start-btn');
    const cancelBtn = document.getElementById('opt-cancel-btn');

    console.log('[Optimization] 🎨 Updating UI...');

    if (progressSection) {
        progressSection.classList.remove('hidden');
        console.log('[Optimization] ✅ Progress section shown');
    }
    if (resultsSection) resultsSection.classList.add('hidden');
    if (startBtn) {
        startBtn.disabled = true;
        startBtn.classList.add('opacity-50', 'cursor-not-allowed');
        console.log('[Optimization] ✅ Start button disabled');
    }
    if (cancelBtn) {
        cancelBtn.classList.remove('hidden');
        console.log('[Optimization] ✅ Cancel button shown');
    }

    // Reset progress
    const progressBar = document.getElementById('opt-progress-bar');
    const progressPercentage = document.getElementById('opt-progress-percentage');
    const progressText = document.getElementById('opt-progress-text');

    if (progressBar) progressBar.style.width = '0%';
    if (progressPercentage) progressPercentage.textContent = '0%';
    if (progressText) progressText.textContent = 'Starting optimization...';

    console.log('[Optimization] ⏳ Progress reset to 0%');

    try {
        // Prepare request
        const metricsForBalance = state.defaultMetricColumns;
        const requestBody = {
            portfolio_indices: portfolio.indices,
            strategies_data: state.rawStrategiesData,
            is_risk_normalized: false,
            normalization_metric: 'max_dd',
            normalization_target_value: 0,
            params: {
                num_simulations: numSimulations,
                target_metric: targetMetric,
                target_goal: goal,
                min_weight: parseFloat(dom.minWeightFilter.value) / 100,
                metrics_for_balance: metricsForBalance,
            }
        };

        console.log('[Optimization] 📤 Sending request to backend...', requestBody.params);

        // Create AbortController for cancellation
        optimizationAbortController = new AbortController();

        // Start progress simulation
        simulateProgressInTab(numSimulations);

        const startTime = Date.now();
        const response = await fetch('/analysis/optimize-portfolio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: optimizationAbortController.signal
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[Optimization] 📥 Response received in ${elapsed}s`);

        if (!response.ok) {
            const errorData = await response.json();
            console.error('[Optimization] ❌ Backend error:', errorData);
            throw new Error(errorData.detail || 'Backend optimization error');
        }

        const optimizationResults = await response.json();
        console.log('[Optimization] ✅ Results received:', optimizationResults);

        // Complete progress
        if (progressBar) progressBar.style.width = '100%';
        if (progressPercentage) progressPercentage.textContent = '100%';
        if (progressText) progressText.textContent = '¡Optimization complete!';

        // Save results
        state.currentOptimizationData.lastResults = {
            ...optimizationResults,
            portfolio: portfolio,
            targetMetric: targetMetric,
            numSimulations: numSimulations
        };

        // Hide progress after brief delay
        setTimeout(() => {
            if (progressSection) progressSection.classList.add('hidden');
        }, 1000);

        // Display results
        displayOptimizationResultsInTab(optimizationResults, portfolio, targetMetric);

        showToast('✅ Optimization completed!', 'success');

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('[Optimization] ⏹️ Optimization cancelled');
            showToast('Optimization cancelled', 'info');
        } else {
            console.error('[Optimization] ❌ Error:', error);
            showToast(`Error: ${error.message}`, 'error');
        }

        if (progressSection) progressSection.classList.add('hidden');
    } finally {
        // Restore UI
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
        if (cancelBtn) cancelBtn.classList.add('hidden');
        console.log('[Optimization] ✅ UI restored');
        console.log('=================================================');
    }
}

/**
 * Display optimization results in the tab UI
 */
function displayOptimizationResultsInTab(results, portfolio, targetMetric) {
    console.log('[Optimization] 📊 Displaying results in tab...');

    const { baseAnalysis, metricBestAnalysis, balancedBestAnalysis } = results;

    // Show results section
    const resultsSection = document.getElementById('opt-results-section');
    if (resultsSection) {
        resultsSection.classList.remove('hidden');
    }

    // Populate KPI table
    const tableBody = document.getElementById('opt-kpi-table-body');
    if (tableBody) {
        const keyMetrics = ['sortinoRatio', 'sharpeRatio', 'profitMaxDD_Ratio', 'maxDrawdownInDollars', 'profitFactor', 'winningPercentage'];

        let rows = '';
        keyMetrics.forEach(metricKey => {
            const metricInfo = ALL_METRICS[metricKey];
            if (!metricInfo) return;

            const baseValue = baseAnalysis.metrics[metricKey];
            const metricValue = metricBestAnalysis.metrics[metricKey];
            const balancedValue = balancedBestAnalysis.metrics[metricKey];

            const metricChange = ((metricValue - baseValue) / Math.abs(baseValue)) * 100;
            const balancedChange = ((balancedValue - baseValue) / Math.abs(baseValue)) * 100;

            const formatChange = (change, metricKey) => {
                // For metrics where lower is better, invert the color logic
                const isImprovement = isIncreaseGood(metricKey)
                    ? change >= 0  // Normal: positive change is good
                    : change <= 0; // Inverted: negative change is good (DD decrease)

                const color = isImprovement ? 'text-green-400' : 'text-red-400';
                const icon = change >= 0 ? '▲' : '▼';
                return `<span class="${color} text-xs">${icon} ${Math.abs(change).toFixed(1)}%</span>`;
            };

            rows += `
                <tr class="border-b border-gray-700">
                    <td class="px-2 py-1 text-xs text-gray-300">${metricInfo.label}</td>
                    <td class="px-2 py-1 text-xs text-right text-gray-400">${formatMetricForDisplay(baseValue, metricKey)}</td>
                    <td class="px-2 py-1 text-xs text-right">
                        ${formatMetricForDisplay(metricValue, metricKey)} ${formatChange(metricChange, metricKey)}
                    </td>
                    <td class="px-2 py-1 text-xs text-right">
                        ${formatMetricForDisplay(balancedValue, metricKey)} ${formatChange(balancedChange, metricKey)}
                    </td>
                </tr>
            `;
        });

        tableBody.innerHTML = rows;
    }

    // Update summary cards
    const metricSummary = document.getElementById('opt-metric-summary');
    const balancedSummary = document.getElementById('opt-balanced-summary');

    const metricWeights = metricBestAnalysis.weights.map(w => `${(w * 100).toFixed(0)}%`).join(' / ');
    const balancedWeights = balancedBestAnalysis.weights.map(w => `${(w * 100).toFixed(0)}%`).join(' / ');

    if (metricSummary) {
        metricSummary.innerHTML = `<p class="text-xs">Weights: ${metricWeights}</p>`;
    }
    if (balancedSummary) {
        balancedSummary.innerHTML = `<p class="text-xs">Weights: ${balancedWeights}</p>`;
    }

    // Setup apply buttons
    setupApplyButtonsInTab(metricBestAnalysis, balancedBestAnalysis, portfolio, targetMetric);

    console.log('[Optimization] ✅ Results displayed');

    // Update viewer to show 3 equity curves
    import('./viewer.js').then(module => {
        module.renderViewerForActiveTab();
        console.log('[Optimization] 📊 Viewer updated with comparison chart');
    });
}

/**
 * Setup event listeners for apply buttons in tab
 */
function setupApplyButtonsInTab(metricBest, balancedBest, portfolio, targetMetric) {
    const applyMetricBtn = document.getElementById('opt-apply-metric-btn');
    const saveMetricBtn = document.getElementById('opt-save-metric-btn');
    const applyBalancedBtn = document.getElementById('opt-apply-balanced-btn');
    const saveBalancedBtn = document.getElementById('opt-save-balanced-btn');

    // Remove old listeners by cloning
    if (applyMetricBtn) {
        const newBtn = applyMetricBtn.cloneNode(true);
        applyMetricBtn.parentNode.replaceChild(newBtn, applyMetricBtn);
        newBtn.addEventListener('click', () => {
            applyOptimizedWeights(metricBest.weights, `(Opt. ${targetMetric})`, metricBest, false);
        });
    }

    if (saveMetricBtn) {
        const newBtn = saveMetricBtn.cloneNode(true);
        saveMetricBtn.parentNode.replaceChild(newBtn, saveMetricBtn);
        newBtn.addEventListener('click', () => {
            applyOptimizedWeights(metricBest.weights, `(Opt. ${targetMetric})`, metricBest, true);
        });
    }

    if (applyBalancedBtn) {
        const newBtn = applyBalancedBtn.cloneNode(true);
        applyBalancedBtn.parentNode.replaceChild(newBtn, applyBalancedBtn);
        newBtn.addEventListener('click', () => {
            applyOptimizedWeights(balancedBest.weights, '(Opt. Balanced)', balancedBest, false);
        });
    }

    if (saveBalancedBtn) {
        const newBtn = saveBalancedBtn.cloneNode(true);
        saveBalancedBtn.parentNode.replaceChild(newBtn, saveBalancedBtn);
        newBtn.addEventListener('click', () => {
            applyOptimizedWeights(balancedBest.weights, '(Opt. Balanced)', balancedBest, true);
        });
    }
}

/**
 * Cancel optimization in tab
 */
function cancelOptimizationInTab() {
    console.log('[Optimization] Cancelling optimization in tab');

    if (optimizationAbortController) {
        optimizationAbortController.abort();
        optimizationAbortController = null;
    }

    if (progressIntervalTab) {
        clearInterval(progressIntervalTab);
        progressIntervalTab = null;
    }

    const progressSection = document.getElementById('opt-progress-section');
    const startBtn = document.getElementById('opt-start-btn');
    const cancelBtn = document.getElementById('opt-cancel-btn');

    if (progressSection) progressSection.classList.add('hidden');
    if (startBtn) {
        startBtn.disabled = false;
        startBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    if (cancelBtn) cancelBtn.classList.add('hidden');

    showToast('Optimization cancelled', 'info');
}