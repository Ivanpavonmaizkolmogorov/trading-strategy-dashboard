import { state, saveSavedPortfolios } from '../state.js';
import { formatMetricForDisplay } from '../utils.js';
import { showToast } from './notifications.js';

/**
 * Manual Risk Configuration Modal
 * Allows users to set custom risk per trade for each strategy in a portfolio
 */

let currentPortfolioIndex = null;
let riskValues = {}; // { strategyIndex: riskValue }

/**
 * Open the risk configuration modal for a specific portfolio
 */
export const openRiskConfigModal = (portfolioIndex) => {
    currentPortfolioIndex = portfolioIndex;
    const portfolio = state.savedPortfolios[portfolioIndex];

    if (!portfolio) {
        showToast('Portfolio not found', 'error');
        return;
    }

    // Initialize risk values
    riskValues = {};

    if (portfolio.riskPerStrategy && portfolio.riskPerStrategy.length === portfolio.indices.length) {
        // Load existing configuration
        portfolio.indices.forEach((idx, i) => {
            riskValues[idx] = portfolio.riskPerStrategy[i];
        });
        showToast('Loaded existing risk configuration', 'info');
    } else {
        // Default to $100
        portfolio.indices.forEach(idx => {
            riskValues[idx] = 100;
        });
    }

    // Create modal if it doesn't exist
    let modal = document.getElementById('risk-config-modal');
    if (!modal) {
        modal = createModalElement();
        document.body.appendChild(modal);
    }

    // Populate modal content
    populateModal(portfolio);

    // Show modal with animation
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.querySelector('.modal-content').classList.add('scale-100');
        modal.querySelector('.modal-content').classList.remove('scale-95');
    }, 10);
};

/**
 * Create the modal DOM element
 */
const createModalElement = () => {
    const modal = document.createElement('div');
    modal.id = 'risk-config-modal';
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[70] hidden';

    modal.innerHTML = `
        <div class="modal-content bg-gray-800 rounded-xl shadow-2xl border border-gray-700 w-full max-w-4xl p-6 transform transition-all scale-95 flex flex-col max-h-[90vh]">
            <div class="flex justify-between items-start mb-4 flex-shrink-0">
                <div>
                    <h3 class="text-xl font-bold text-white mb-1 flex items-center gap-2">
                        <span>⚙️</span>
                        <span>Manual Risk Configuration</span>
                    </h3>
                    <p class="text-gray-400 text-sm" id="risk-config-portfolio-name"></p>
                </div>
                <button id="close-risk-config-modal" class="text-gray-400 hover:text-white transition-colors">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>

            <!-- Global Controls -->
            <div class="mb-4 bg-gray-700/30 p-3 rounded-lg border border-gray-700 flex-shrink-0">
                <div class="flex flex-col gap-3">
                    <div class="flex flex-wrap gap-4 items-center justify-between">
                        <div class="flex items-center gap-3">
                            <label class="text-xs text-gray-400 uppercase font-semibold">Global Actions:</label>
                            <button id="equalize-all-btn" class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded border border-gray-600 transition-colors text-xs font-medium">
                                Reset All to $100
                            </button>
                        </div>
                        
                        <div class="flex items-center gap-2">
                            <span class="text-xs text-gray-400 uppercase font-semibold">Multiplier:</span>
                            <div class="flex bg-gray-700 rounded border border-gray-600 overflow-hidden">
                                <button class="multiplier-btn px-2 py-1 hover:bg-blue-600 text-gray-300 hover:text-white text-xs transition-colors border-r border-gray-600 last:border-0" data-factor="0.5">x0.5</button>
                                <button class="multiplier-btn px-2 py-1 hover:bg-blue-600 text-gray-300 hover:text-white text-xs transition-colors border-r border-gray-600 last:border-0" data-factor="0.75">x0.75</button>
                                <button class="multiplier-btn px-2 py-1 hover:bg-blue-600 text-gray-300 hover:text-white text-xs transition-colors border-r border-gray-600 last:border-0" data-factor="1.25">x1.25</button>
                                <button class="multiplier-btn px-2 py-1 hover:bg-blue-600 text-gray-300 hover:text-white text-xs transition-colors border-r border-gray-600 last:border-0" data-factor="1.5">x1.5</button>
                                <button class="multiplier-btn px-2 py-1 hover:bg-blue-600 text-gray-300 hover:text-white text-xs transition-colors" data-factor="2.0">x2.0</button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Fine Tune Slider -->
                    <div class="flex items-center gap-3 border-t border-gray-700 pt-2">
                        <span class="text-xs text-gray-400 uppercase font-semibold">Fine Tune:</span>
                        <input type="range" id="global-fine-tune" min="0.1" max="3.0" step="0.01" value="1.0" 
                            class="w-48 h-1.5 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400">
                        <span id="global-fine-tune-value" class="text-xs text-blue-300 font-mono font-bold">1.00x</span>
                        <span class="text-xs text-gray-500 ml-2">(Applies to current values)</span>
                    </div>
                </div>
            </div>

            <!-- Strategy Risk Table -->
            <div class="bg-gray-900/50 rounded-lg border border-gray-700 overflow-hidden mb-4 flex-1 flex flex-col min-h-0">
                <div class="overflow-y-auto custom-scrollbar p-1">
                    <table class="w-full">
                        <thead class="bg-gray-800 sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase w-1/2">Strategy & Risk Slider</th>
                                <th class="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase w-1/4">Risk ($)</th>
                                <th class="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase w-1/4">Weight (%)</th>
                            </tr>
                        </thead>
                        <tbody id="risk-config-strategies-body" class="divide-y divide-gray-700">
                            <!-- Populated dynamically -->
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Summary -->
            <div class="grid grid-cols-2 gap-4 mb-4 flex-shrink-0">
                <div class="bg-gray-700/50 p-3 rounded-lg flex justify-between items-center">
                    <div class="text-xs text-gray-400 uppercase">Total Risk</div>
                    <div class="text-lg font-bold text-emerald-400" id="risk-config-total">$0</div>
                </div>
                <div class="bg-gray-700/50 p-3 rounded-lg flex justify-between items-center">
                    <div class="text-xs text-gray-400 uppercase">Avg Risk</div>
                    <div class="text-lg font-bold text-blue-400" id="risk-config-average">$0</div>
                </div>
            </div>

            <!-- Action Buttons -->
            <div class="flex justify-between items-center flex-shrink-0 pt-4 border-t border-gray-700 mt-auto">
                <button id="cancel-risk-config-btn" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors">
                    Cancel
                </button>
                
                <div class="flex gap-3">
                    <button id="save-new-risk-btn" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2 shadow-lg shadow-emerald-900/20" title="Create a new portfolio copy with these settings">
                        <span>💾</span>
                        <span>Save New & Analyze</span>
                    </button>
                    <button id="overwrite-risk-btn" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2 shadow-lg shadow-blue-900/20" title="Update the current portfolio">
                        <span>✓</span>
                        <span>Overwrite & Analyze</span>
                    </button>
                </div>
            </div>
        </div>
    `;

    // Event listeners
    modal.querySelector('#close-risk-config-modal').onclick = closeRiskConfigModal;
    modal.querySelector('#cancel-risk-config-btn').onclick = closeRiskConfigModal;
    modal.querySelector('#equalize-all-btn').onclick = equalizeAllRisks;

    modal.querySelector('#save-new-risk-btn').onclick = () => applyRiskConfig('new');
    modal.querySelector('#overwrite-risk-btn').onclick = () => applyRiskConfig('overwrite');

    // Multiplier buttons
    modal.querySelectorAll('.multiplier-btn').forEach(btn => {
        btn.onclick = () => applyGlobalMultiplier(parseFloat(btn.dataset.factor));
    });

    // Fine tune slider
    const fineTuneSlider = modal.querySelector('#global-fine-tune');
    const fineTuneValue = modal.querySelector('#global-fine-tune-value');

    // Store initial values when slider interaction starts
    let initialRiskValues = null;

    fineTuneSlider.addEventListener('mousedown', () => {
        initialRiskValues = { ...riskValues };
    });

    fineTuneSlider.addEventListener('input', (e) => {
        const factor = parseFloat(e.target.value);
        fineTuneValue.textContent = `${factor.toFixed(2)}x`;

        if (!initialRiskValues) initialRiskValues = { ...riskValues }; // Fallback

        // Apply factor to INITIAL values
        Object.keys(initialRiskValues).forEach(key => {
            let newVal = Math.round(initialRiskValues[key] * factor);
            if (newVal < 0) newVal = 0;
            riskValues[key] = newVal;
        });

        // Update UI
        document.querySelectorAll('.risk-input').forEach(input => {
            const idx = input.dataset.strategyIndex;
            input.value = riskValues[idx];
        });

        document.querySelectorAll('.risk-slider').forEach(slider => {
            const idx = slider.dataset.strategyIndex;
            slider.value = riskValues[idx];
        });

        updateWeightsAndSummary();
    });

    // Reset slider on mouse up (commit change)
    fineTuneSlider.addEventListener('mouseup', () => {
        fineTuneSlider.value = 1.0;
        fineTuneValue.textContent = "1.00x";
        initialRiskValues = null; // Reset base
    });

    // Click outside to close
    modal.onclick = (e) => {
        if (e.target === modal) closeRiskConfigModal();
    };

    return modal;
};

/**
 * Populate modal with portfolio data
 */
const populateModal = (portfolio) => {
    document.getElementById('risk-config-portfolio-name').textContent = portfolio.name || 'Portfolio';

    const tbody = document.getElementById('risk-config-strategies-body');
    tbody.innerHTML = '';

    portfolio.indices.forEach((strategyIdx, i) => {
        // FIX: Use state.loadedStrategyFiles directly as window.analysisResults might be sorted/reordered
        const strategyFile = state.loadedStrategyFiles[strategyIdx];
        const strategyName = strategyFile?.name || `Strategy ${strategyIdx + 1}`;
        const currentRisk = riskValues[strategyIdx];

        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-700/30 transition-colors group';
        row.innerHTML = `
            <td class="px-4 py-3">
                <div class="text-white font-medium mb-2 text-sm truncate" title="${strategyName}">
                    ${strategyName}
                </div>
                <div class="flex items-center gap-3">
                    <span class="text-[10px] text-gray-500 font-mono w-6 text-right">$0</span>
                    <input type="range" 
                        class="risk-slider flex-1 h-1.5 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-all"
                        data-strategy-index="${strategyIdx}"
                        value="${currentRisk}"
                        min="0"
                        max="2000"
                        step="1"
                        title="Adjust risk: $${currentRisk}">
                    <span class="text-[10px] text-gray-500 font-mono w-8">$2k</span>
                </div>
            </td>
            <td class="px-4 py-3 text-center align-middle">
                <div class="relative inline-block">
                    <span class="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
                    <input type="number" 
                        class="risk-input w-20 bg-gray-700 border border-gray-600 rounded px-2 py-1.5 pl-5 text-white text-center focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm font-mono"
                        data-strategy-index="${strategyIdx}"
                        value="${currentRisk}"
                        min="0"
                        step="1">
                </div>
            </td>
            <td class="px-4 py-3 text-center align-middle">
                <span class="weight-display text-gray-300 font-semibold text-sm font-mono" data-strategy-index="${strategyIdx}">
                    0.0%
                </span>
            </td>
        `;

        tbody.appendChild(row);
    });

    // Add event listeners to inputs and sliders
    document.querySelectorAll('.risk-input').forEach(input => {
        input.addEventListener('input', (e) => handleRiskChange(e, 'input'));
    });

    document.querySelectorAll('.risk-slider').forEach(slider => {
        slider.addEventListener('input', (e) => handleRiskChange(e, 'slider'));
    });

    // Initial calculation
    updateWeightsAndSummary();
};

/**
 * Handle risk input change
 */
const handleRiskChange = (e, source) => {
    const strategyIdx = parseInt(e.target.dataset.strategyIndex);
    let value = parseFloat(e.target.value);

    if (isNaN(value) || value < 0) value = 0;

    riskValues[strategyIdx] = value;

    // Sync the other control
    if (source === 'input') {
        const slider = document.querySelector(`.risk-slider[data-strategy-index="${strategyIdx}"]`);
        if (slider) slider.value = value;
    } else {
        const input = document.querySelector(`.risk-input[data-strategy-index="${strategyIdx}"]`);
        if (input) input.value = value;
    }

    updateWeightsAndSummary();
};

/**
 * Apply global multiplier to all risks
 */
const applyGlobalMultiplier = (factor) => {
    Object.keys(riskValues).forEach(key => {
        let newVal = Math.round(riskValues[key] * factor);
        if (newVal < 0) newVal = 0;
        riskValues[key] = newVal;
    });

    // Update UI
    document.querySelectorAll('.risk-input').forEach(input => {
        const idx = input.dataset.strategyIndex;
        input.value = riskValues[idx];
    });

    document.querySelectorAll('.risk-slider').forEach(slider => {
        const idx = slider.dataset.strategyIndex;
        slider.value = riskValues[idx];
    });

    updateWeightsAndSummary();
    showToast(`Multiplied all risks by ${factor}x`, 'info');
};

/**
 * Update weights and summary values
 */
const updateWeightsAndSummary = () => {
    const risks = Object.values(riskValues);
    const totalRisk = risks.reduce((sum, r) => sum + r, 0);
    const avgRisk = totalRisk / risks.length;

    // Update summary
    document.getElementById('risk-config-total').textContent = `$${totalRisk.toFixed(2)}`;
    document.getElementById('risk-config-average').textContent = `$${avgRisk.toFixed(2)}`;

    // Update weights
    document.querySelectorAll('.weight-display').forEach(span => {
        const strategyIdx = parseInt(span.dataset.strategyIndex);
        const risk = riskValues[strategyIdx] || 0;
        const weight = totalRisk > 0 ? (risk / totalRisk) * 100 : 0;
        span.textContent = `${weight.toFixed(1)}%`;
    });
};

/**
 * Equalize all risks to $100
 */
const equalizeAllRisks = () => {
    Object.keys(riskValues).forEach(key => {
        riskValues[key] = 100;
    });

    // Update UI
    document.querySelectorAll('.risk-input').forEach(input => {
        input.value = 100;
    });

    document.querySelectorAll('.risk-slider').forEach(slider => {
        slider.value = 100;
    });

    updateWeightsAndSummary();
    showToast('All risks set to $100', 'success');
};

/**
 * Apply risk configuration and trigger re-analysis
 */
const applyRiskConfig = async (saveMode) => {
    if (currentPortfolioIndex === null) return;

    let portfolio = state.savedPortfolios[currentPortfolioIndex];
    if (!portfolio) return;

    // Validate that all risks are > 0
    const hasZeroRisk = Object.values(riskValues).some(r => r <= 0);
    if (hasZeroRisk) {
        showToast('All strategies must have risk > 0', 'error');
        return;
    }

    // Create risk array in the same order as portfolio.indices
    const riskPerStrategy = portfolio.indices.map(idx => riskValues[idx]);

    // Check save mode
    if (saveMode === 'new') {
        // Clone portfolio
        const newPortfolio = JSON.parse(JSON.stringify(portfolio));
        newPortfolio.name = `${portfolio.name} (Risk Config)`;
        newPortfolio.id = Date.now(); // New ID
        newPortfolio.riskPerStrategy = riskPerStrategy;

        // Clear metrics to force analysis
        delete newPortfolio.metrics;
        delete newPortfolio.analysis;
        delete newPortfolio.chartData;

        // Add to state
        state.savedPortfolios.push(newPortfolio);

        // Update current index to the new one
        currentPortfolioIndex = state.savedPortfolios.length - 1;
        portfolio = newPortfolio;

        showToast('Created new portfolio copy', 'success');
    } else {
        // Update existing portfolio
        portfolio.riskPerStrategy = riskPerStrategy;

        // CRITICAL FIX: Clear metrics to force re-analysis in analysis.js
        delete portfolio.metrics;
        delete portfolio.analysis;
        delete portfolio.chartData;
    }

    // Persist changes
    saveSavedPortfolios();

    // Close modal
    closeRiskConfigModal();

    // Show loading toast
    showToast('Re-analyzing portfolio with custom risk allocation...', 'info');

    try {
        // Import reAnalyzeAllData dynamically to avoid circular dependency
        const { reAnalyzeAllData } = await import('../analysis.js');

        // Trigger re-analysis
        await reAnalyzeAllData();

        showToast('Portfolio re-analyzed successfully', 'success');
    } catch (error) {
        console.error('[RiskConfig] Error re-analyzing:', error);
        showToast('Error re-analyzing portfolio', 'error');
    }
};

/**
 * Close the modal
 */
export const closeRiskConfigModal = () => {
    const modal = document.getElementById('risk-config-modal');
    if (!modal) return;

    const content = modal.querySelector('.modal-content');
    content.classList.remove('scale-100');
    content.classList.add('scale-95');

    setTimeout(() => {
        modal.classList.add('hidden');
        currentPortfolioIndex = null;
    }, 200);
};
