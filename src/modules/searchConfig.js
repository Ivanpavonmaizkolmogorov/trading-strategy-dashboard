import { state } from '../state.js';
import { findDatabankPortfolios } from './databank.js';
import { dom } from '../dom.js';

// Metric configuration: defines optimization direction for each metric
const METRIC_CONFIG = {
    // Higher is better
    sharpeRatio: { goal: 'maximize', label: 'Sharpe Ratio' },
    sortinoRatio: { goal: 'maximize', label: 'Sortino Ratio' },
    totalProfit: { goal: 'maximize', label: 'Total Profit' },
    profitFactor: { goal: 'maximize', label: 'Profit Factor' },
    sqn: { goal: 'maximize', label: 'SQN' },
    upi: { goal: 'maximize', label: 'UPI' },
    captureRatio: { goal: 'maximize', label: 'Capture Ratio' },
    winningPercentage: { goal: 'maximize', label: 'Win %' },
    monthlyAvgProfit: { goal: 'maximize', label: 'Monthly Avg Profit' },
    profitMaxDD_Ratio: { goal: 'maximize', label: 'Ret/DD' },
    monthlyProfitToDollarDD: { goal: 'maximize', label: 'Monthly Profit/DD' },
    gammaFlowScore: { goal: 'maximize', label: 'Gamma Flow Score' },
    maxConsecutiveWins: { goal: 'maximize', label: 'Max Cons. Wins' },

    // Lower is better
    maxDrawdown: { goal: 'minimize', label: 'Max Drawdown %' },
    maxDrawdownInDollars: { goal: 'minimize', label: 'Max Drawdown $' },
    ulcerIndexInDollars: { goal: 'minimize', label: 'Ulcer Index $' },
    maxMarginRequired: { goal: 'minimize', label: 'Max Margin Req.' },
    maxStagnationDays: { goal: 'minimize', label: 'Stagnation (Days)' },
    maxStagnationTrades: { goal: 'minimize', label: 'Stagnation (Trades)' },
    maxConsecutiveLosses: { goal: 'minimize', label: 'Max Cons. Losses' },
    maxConsecutiveLosingMonths: { goal: 'minimize', label: 'Max Cons. Losing Months' }
};

// Export for use in other modules
export { METRIC_CONFIG };


/**
 * Opens the unified Search Configuration Modal.
 * @param {Array<number>} selectedIndices - Optional. Array of indices of fixed strategies.
 */
export const openSearchConfigModal = (selectedIndices = []) => {
    // 1. Resolve Initial Fixed Strategies
    // If selectedIndices are provided (e.g. from Squad Builder manual selection), use them.
    // Otherwise, check if a Base Portfolio is selected via Radio Button.
    let baseStrategies = [];
    let isBasePortfolioMode = false;

    // Direct selection (Squad Builder) takes precedence or merges? 
    // Usually openSearchConfigModal() is called without args from "Find" button.
    if (selectedIndices.length > 0) {
        baseStrategies = selectedIndices.map(index => {
            const file = state.loadedStrategyFiles[index];
            return {
                index: index,
                name: file ? (file.name || `Strategy #${index}`) : `Strategy #${index}`, // Use canonical filename
                checked: true,
                isFixed: true
            };
        });
    } else if (state.searchBasePortfolioIndex !== undefined && state.searchBasePortfolioIndex !== -1) {
        // Base Portfolio Mode
        isBasePortfolioMode = true;
        const baseIndices = Array.from(state.searchBaseStrategyIndices || []);
        baseStrategies = baseIndices.map(index => {
            const file = state.loadedStrategyFiles[index];
            return {
                index: index,
                name: file ? (file.name || `Strategy #${index}`) : `Strategy #${index}`, // Use canonical filename
                checked: true,
                isFixed: false
            };
        });
    }

    const title = isBasePortfolioMode ? 'Team Search' : (baseStrategies.length > 0 ? 'Squad Builder' : 'New Search');
    const subtitle = isBasePortfolioMode
        ? 'Select strategies from your base portfolio to include.'
        : (baseStrategies.length > 0 ? 'Build a portfolio around your star players.' : 'Configure your portfolio search parameters.');
    const icon = (isBasePortfolioMode || baseStrategies.length > 0) ? '⚽' : '🔍';

    // Calculate initial size
    // If Base Portfolio has 10 strategies, size should be at least 10.
    const initialFixedCount = baseStrategies.length;
    const minSize = initialFixedCount + 1;
    const defaultSize = Math.max(minSize, 20);

    // Create modal HTML
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 animate-fade-in';

    // Warning container for high correlation
    const correlationWarningID = 'search-correlation-warning';

    const checklistHTML = baseStrategies.length > 0 ? `
        <div class="mb-6 bg-gray-900/50 rounded p-3 border border-gray-700">
            <label class="block text-xs font-medium text-gray-500 uppercase mb-2">
                ${isBasePortfolioMode ? 'Base Portfolio Strategies (Select to Include)' : 'Starting Lineup (Fixed)'}
            </label>
            <div class="flex flex-col gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                ${baseStrategies.map(s => `
                    <label class="flex items-center gap-2 p-2 rounded hover:bg-gray-800 transition-colors cursor-pointer border border-gray-700/50">
                        <input type="checkbox" class="base-strategy-checkbox form-checkbox h-4 w-4 text-sky-500 rounded border-gray-600 bg-gray-700 focus:ring-sky-500 focus:ring-offset-gray-800" 
                            data-index="${s.index}" ${s.checked ? 'checked' : ''}>
                        <span class="text-sm text-gray-300 truncate" title="${s.name}">${s.name}</span>
                        ${s.isFixed ? '<span class="text-xs text-blue-400 bg-blue-900/30 px-1 rounded ml-auto">Fixed</span>' : ''}
                    </label>
                `).join('')}
            </div>
            <div class="mt-2 flex justify-between text-xs text-gray-500">
                <span>Selected: <span id="selected-count" class="text-sky-400 font-bold">${initialFixedCount}</span></span>
                ${isBasePortfolioMode ? `
                    <button id="btn-toggle-all" class="text-sky-500 hover:text-sky-400 transition-colors">Toggle All</button>
                ` : ''}
            </div>
            
            <!-- Correlation Warning -->
            <div id="${correlationWarningID}" class="hidden mt-3 bg-orange-900/30 border border-orange-700/50 text-orange-200 px-3 py-2 rounded text-xs flex items-start gap-2">
                <span class="text-lg">⚠️</span>
                <div>
                    <strong class="block">High Internal Correlation</strong>
                    Your selected "Starting Lineup" has a max correlation of <strong id="current-base-correlation">0.00</strong>, which exceeds your threshold. 
                    The search may fail instantly. <button id="btn-fix-correlation" class="underline hover:text-white ml-1">Auto-adjust Threshold</button>
                </div>
            </div>
        </div>
    ` : '';

    modal.innerHTML = `
        <div class="bg-gray-800 rounded-lg border border-gray-700 p-6 w-[500px] max-w-full shadow-2xl transform transition-all scale-100 flex flex-col max-h-[90vh]">
            <div class="flex justify-between items-start mb-6 shrink-0">
                <div>
                    <h3 class="text-2xl font-bold text-white flex items-center gap-2">
                        <span>${icon}</span> ${title}
                    </h3>
                    <p class="text-gray-400 text-sm mt-1">${subtitle}</p>
                </div>
                <button id="btn-close-search" class="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
            </div>

            <div class="overflow-y-auto flex-1 pr-2 custom-scrollbar">
                <!-- Wrapper for scrolling content -->
                
                ${checklistHTML}

                <!-- Configuration Form -->
                <div class="space-y-4">
                    <!-- Portfolio Size -->
                    <div>
                        <label class="block text-sm font-medium text-gray-300 mb-1">Total Portfolio Size</label>
                        <div class="flex items-center gap-4">
                            <input type="range" id="search-size-range" min="${minSize}" max="100" value="${defaultSize}" 
                                class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500">
                            <span id="search-size-value" class="text-white font-mono bg-gray-700 px-2 py-1 rounded w-12 text-center">
                                ${defaultSize}
                            </span>
                        </div>
                        <p class="text-xs text-gray-500 mt-1">
                            Includes <span id="fixed-count-display" class="font-bold text-sky-400">${initialFixedCount}</span> fixed + <span id="random-count">${defaultSize - initialFixedCount}</span> random.
                        </p>
                    </div>

                    <!-- Date Range -->
                    <div class="bg-gray-900/50 rounded p-3 border border-gray-700">
                        <div class="flex items-center justify-between mb-3">
                            <label class="block text-sm font-medium text-gray-300">Date Range</label>
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" id="search-use-all-dates" class="form-checkbox h-4 w-4 text-blue-500 rounded border-gray-600 bg-gray-700" checked>
                                <span class="text-xs text-gray-400">Use All Available Data</span>
                            </label>
                        </div>
                        <div id="search-date-inputs" class="grid grid-cols-2 gap-3 hidden">
                            <div>
                                <label class="block text-xs text-gray-400 mb-1">Start Date</label>
                                <input type="date" id="search-start-date" class="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg p-2">
                            </div>
                            <div>
                                <label class="block text-xs text-gray-400 mb-1">End Date</label>
                                <input type="date" id="search-end-date" class="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg p-2">
                            </div>
                        </div>
                    </div>

                    <!-- Correlation Threshold -->
                    <div>
                        <label class="block text-sm font-medium text-gray-300 mb-1">Correlation Threshold</label>
                        <div class="flex items-center gap-4">
                            <input type="range" id="search-correlation-range" min="0.1" max="1.0" step="0.05" value="0.3" 
                                class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500">
                            <input type="number" id="search-correlation-input" min="0.1" max="1.0" step="0.05" value="0.3"
                                class="text-white font-mono bg-gray-700 border border-gray-600 px-2 py-1 rounded w-20 text-center text-sm">
                        </div>
                        <p class="text-xs text-gray-500 mt-1">Lower values mean stricter diversity requirements.</p>
                    </div>

                    <!-- Pre-normalization (Risk Normalization) -->
                    <div class="bg-gray-900/50 rounded p-3 border border-gray-700">
                        <div class="flex items-center justify-between mb-3">
                            <label class="block text-sm font-medium text-gray-300">Pre-normalization</label>
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" id="search-normalization-enabled" class="form-checkbox h-4 w-4 text-purple-500 rounded border-gray-600 bg-gray-700">
                                <span class="text-xs text-gray-400">Enable</span>
                            </label>
                        </div>
                        <div id="search-normalization-controls" class="grid grid-cols-2 gap-3 hidden">
                            <div>
                                <label class="block text-xs text-gray-400 mb-1">Target Metric</label>
                                <select id="search-normalization-metric" class="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg p-2">
                                    <option value="max_dd">Max Drawdown ($)</option>
                                    <option value="ulcer_index">Ulcer Index ($)</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs text-gray-400 mb-1">Target Value ($)</label>
                                <input type="number" id="search-normalization-value" value="1000" min="100" step="100" class="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg p-2 text-center">
                            </div>
                            
                            <!-- CAGR x KPI Option -->
                            <div class="col-span-2 border-t border-gray-700 pt-3 mt-1">
                                <label class="flex items-center gap-2 cursor-pointer mb-2">
                                    <input type="checkbox" id="search-cagr-scaling-enabled" class="form-checkbox h-3 w-3 text-green-500 rounded border-gray-600 bg-gray-700">
                                    <span class="text-xs text-gray-300">Optimize by: <span class="text-green-400 font-bold">CAGR × KPI</span></span>
                                </label>
                                <div id="search-cagr-scaling-controls" class="hidden grid grid-cols-5 gap-2 items-end">
                                     <div class="col-span-2">
                                        <label class="block text-xs text-gray-500 mb-1">Operator</label>
                                        <select id="search-cagr-scaling-operator" class="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded-lg p-2 text-center">
                                            <option value="multiply">Multiply (×)</option>
                                            <option value="divide">Divide (÷)</option>
                                        </select>
                                     </div>
                                     <div class="col-span-3">
                                        <label class="block text-xs text-gray-500 mb-1">Target KPI</label>
                                        <select id="search-cagr-scaling-metric" class="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded-lg p-2">
                                        <option value="sharpeRatio">Sharpe Ratio</option>
                                        <option value="sortinoRatio">Sortino Ratio</option>
                                        <option value="totalProfit">Total Profit</option>
                                        <option value="profitFactor">Profit Factor</option>
                                        <option value="sqn">SQN</option>
                                        <option value="upi">UPI</option>
                                        <option value="maxDrawdown">Max Drawdown %</option>
                                        <option value="maxDrawdownInDollars">Max Drawdown $</option>
                                        <option value="captureRatio">Capture Ratio</option>
                                        <option value="winningPercentage">Win %</option>
                                        <option value="monthlyAvgProfit">Monthly Avg Profit</option>
                                        <option value="profitMaxDD_Ratio">Ret/DD</option>
                                        <option value="monthlyProfitToDollarDD">Monthly Profit/DD</option>
                                        <option value="ulcerIndexInDollars">Ulcer Index $</option>
                                        <option value="maxMarginRequired">Max Margin Req.</option>
                                        <option value="maxStagnationDays">Stagnation (Days)</option>
                                        <option value="maxStagnationTrades">Stagnation (Trades)</option>
                                        <option value="maxConsecutiveLosses">Max Cons. Losses</option>
                                        <option value="maxConsecutiveWins">Max Cons. Wins</option>
                                        <option value="maxConsecutiveLosingMonths">Max Cons. Losing Months</option>
                                        <option value="gammaFlowScore">Gamma Flow Score</option>
                                        <option value="cagr">CAGR %</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        <p class="text-[10px] text-gray-500 mt-2 italic">
                            Normalize total portfolio risk before optimization. All strategies will be scaled uniformly.
                        </p>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-300 mb-1">Goal</label>
                            <select id="search-goal" class="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5">
                                <option value="maximize">Maximize</option>
                                <option value="minimize">Minimize</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-300 mb-1">Metric</label>
                            <select id="search-metric" class="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5">
                                <option value="sharpeRatio">Sharpe Ratio</option>
                                <option value="sortinoRatio">Sortino Ratio</option>
                                <option value="totalProfit">Total Profit</option>
                                <option value="profitFactor">Profit Factor</option>
                                <option value="sqn">SQN</option>
                                <option value="upi">UPI</option>
                                <option value="maxDrawdown">Max Drawdown %</option>
                                <option value="maxDrawdownInDollars">Max Drawdown $</option>
                                <option value="captureRatio">Capture Ratio</option>
                                <option value="winningPercentage">Win %</option>
                                <option value="monthlyAvgProfit">Monthly Avg Profit</option>
                                <option value="profitMaxDD_Ratio">Ret/DD</option>
                                <option value="monthlyProfitToDollarDD">Monthly Profit/DD</option>
                                <option value="ulcerIndexInDollars">Ulcer Index $</option>
                                <option value="maxMarginRequired">Max Margin Req.</option>
                                <option value="maxStagnationDays">Stagnation (Days)</option>
                                <option value="maxStagnationTrades">Stagnation (Trades)</option>
                                <option value="maxConsecutiveLosses">Max Cons. Losses</option>
                                <option value="maxConsecutiveWins">Max Cons. Wins</option>
                                <option value="maxConsecutiveLosingMonths">Max Cons. Losing Months</option>
                                <option value="gammaFlowScore">Gamma Flow Score</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- Search Method Selection -->
                <div class="mt-4 bg-gray-900/50 rounded p-3 border border-gray-700">
                    <label class="block text-sm font-medium text-gray-300 mb-2">Search Method</label>
                    <div class="space-y-3">
                        <!-- Auto -->
                        <label class="flex items-start gap-3 cursor-pointer group">
                            <input type="radio" name="search-method" value="auto" class="mt-1 form-radio text-blue-500 bg-gray-700 border-gray-600 focus:ring-blue-500" checked>
                            <div>
                                <span class="block text-sm font-bold text-gray-200 group-hover:text-white">Auto (Recommended)</span>
                                <span class="block text-xs text-gray-500">Automatically selects the best method based on complexity. Uses Brute Force for small sets and Monte Carlo for large ones.</span>
                            </div>
                        </label>
                        
                        <!-- Brute Force -->
                        <label class="flex items-start gap-3 cursor-pointer group">
                            <input type="radio" name="search-method" value="brute_force" class="mt-1 form-radio text-purple-500 bg-gray-700 border-gray-600 focus:ring-purple-500">
                            <div>
                                <span class="block text-sm font-bold text-gray-200 group-hover:text-white">Brute Force (Exhaustive)</span>
                                <span class="block text-xs text-gray-500">Checks EVERY possible combination. Guarantees finding the absolute best portfolio but can be extremely slow for large sets (>20 strategies).</span>
                            </div>
                        </label>
                        
                        <!-- Monte Carlo -->
                        <label class="flex items-start gap-3 cursor-pointer group">
                            <input type="radio" name="search-method" value="monte_carlo" class="mt-1 form-radio text-green-500 bg-gray-700 border-gray-600 focus:ring-green-500">
                            <div>
                                <span class="block text-sm font-bold text-gray-200 group-hover:text-white">Monte Carlo (Random)</span>
                                <span class="block text-xs text-gray-500">Randomly samples combinations. High speed for large sets, perfect for quick exploration, but might miss the absolute mathematical optimum.</span>
                            </div>
                        </label>
                    </div>
                </div>
            </div>

            <!-- Action Buttons -->
            <div class="mt-8 flex justify-end gap-3 shrink-0">
                <button id="btn-cancel-search" class="px-4 py-2 text-gray-400 hover:text-white transition-colors">Cancel</button>
                <button id="btn-start-search" class="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded font-bold shadow-lg transform hover:scale-105 transition-all flex items-center gap-2">
                    <span>🔭</span> Start Search
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Logic
    const sizeRange = modal.querySelector('#search-size-range');
    const sizeValue = modal.querySelector('#search-size-value');
    const randomCountSpan = modal.querySelector('#random-count');
    const fixedCountDisplay = modal.querySelector('#fixed-count-display');
    const selectedCountSpan = modal.querySelector('#selected-count');

    // Helper to count currently selected strategies
    const getSelectedCount = () => {
        return modal.querySelectorAll('.base-strategy-checkbox:checked').length;
    };

    const updateCounts = () => {
        const selected = getSelectedCount();
        const total = parseInt(sizeRange.value);
        if (selectedCountSpan) selectedCountSpan.textContent = selected;
        if (fixedCountDisplay) fixedCountDisplay.textContent = selected;
        if (randomCountSpan) randomCountSpan.textContent = Math.max(0, total - selected);
        // Ensure size is at least selected
        if (total < selected) {
            sizeRange.value = selected;
            sizeValue.textContent = selected;
            if (randomCountSpan) randomCountSpan.textContent = 0;
        }
        checkBaseCorrelation();
    };

    // Helper: Check Internal Correlation of Selected Fixed Strategies
    const checkBaseCorrelation = async () => {
        const warningEl = modal.querySelector('#search-correlation-warning');
        const correlationValSpan = modal.querySelector('#current-base-correlation');
        const fixBtn = modal.querySelector('#btn-fix-correlation');

        const checkedIndices = Array.from(modal.querySelectorAll('.base-strategy-checkbox:checked'))
            .map(cb => parseInt(cb.dataset.index, 10));

        if (checkedIndices.length < 2) {
            if (warningEl) warningEl.classList.add('hidden');
            return;
        }

        // We need correlation matrix. Typically stored in 'state.correlationMatrix' if computed.
        // Or we might need to compute it on the fly or fetch it.
        // Assuming we rely on pre-computed matrix or similar logic used in 'databank.js'.
        // For now, let's look for state.currentOptimizationData.correlationMatrix

        // If not available easily, we might skip or do a lightweight check if we have data.
        // Actually, 'analysis.js' has 'calculateCorrelationMatrix'.
        // For robust check, we need the full matrix.
        // If user is selecting from "Base Portfolio", that portfolio likely has a correlation matrix in `portfolio.analysis.correlationMatrix`?
        // Let's check `state.savedPortfolios`.

        let maxCorr = 0;
        let matrix = null;

        if (state.searchBasePortfolioIndex !== undefined && state.searchBasePortfolioIndex !== -1) {
            const p = state.savedPortfolios[state.searchBasePortfolioIndex];
            if (p && p.analysis && p.analysis.correlationMatrix) {
                matrix = p.analysis.correlationMatrix;
            }
        }

        // If we found a matrix, we need to map global indices to matrix indices.
        // The matrix in portfolio usually uses local indices (0..N).
        // `baseStrategies` has `index` mapped to global `loadedStrategyFiles` index.
        // We need to map global index back to local index in the portfolio to use the matrix.

        if (matrix) {
            // Reconstruct local indices based on global indices
            // p.strategyIds or p.indices maps local -> global/ID
            // We need to find which "row/col" within the matrix corresponds to the global `idx`.
            const p = state.savedPortfolios[state.searchBasePortfolioIndex];
            const pIndices = p.indices || []; // Array of global indices

            // Filter matrix for ONLY the checked strategies
            for (let i = 0; i < checkedIndices.length; i++) {
                for (let j = i + 1; j < checkedIndices.length; j++) {
                    const globalIdx1 = checkedIndices[i];
                    const globalIdx2 = checkedIndices[j];

                    // Find local index in p.indices
                    const localIdx1 = pIndices.indexOf(globalIdx1);
                    const localIdx2 = pIndices.indexOf(globalIdx2);

                    if (localIdx1 !== -1 && localIdx2 !== -1 && matrix[localIdx1] && matrix[localIdx1][localIdx2] !== undefined) {
                        const corr = Math.abs(matrix[localIdx1][localIdx2]);
                        if (corr > maxCorr) maxCorr = corr;
                    }
                }
            }
        }

        const threshold = parseFloat(correlationInput.value);
        if (maxCorr > threshold) {
            if (warningEl) warningEl.classList.remove('hidden');
            if (correlationValSpan) correlationValSpan.textContent = maxCorr.toFixed(2);

            if (fixBtn) {
                fixBtn.onclick = () => {
                    const safeVal = (maxCorr + 0.05).toFixed(2);
                    correlationInput.value = safeVal;
                    correlationRange.value = safeVal; // will trigger input event
                    correlationRange.dispatchEvent(new Event('input')); // Force update
                };
            }
        } else {
            if (warningEl) warningEl.classList.add('hidden');
        }
    };

    // Listeners for checkboxes
    const checkboxes = modal.querySelectorAll('.base-strategy-checkbox');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', updateCounts);
    });

    const toggleAllBtn = modal.querySelector('#btn-toggle-all');
    if (toggleAllBtn) {
        toggleAllBtn.onclick = () => {
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            checkboxes.forEach(cb => cb.checked = !allChecked);
            updateCounts();
        };
    }

    const correlationRange = modal.querySelector('#search-correlation-range');
    const correlationInput = modal.querySelector('#search-correlation-input');

    const useAllDatesCheckbox = modal.querySelector('#search-use-all-dates');
    const dateInputsDiv = modal.querySelector('#search-date-inputs');
    const startDateInput = modal.querySelector('#search-start-date');
    const endDateInput = modal.querySelector('#search-end-date');

    const metricSelect = modal.querySelector('#search-metric');
    const goalSelect = modal.querySelector('#search-goal');

    // Auto-update goal when metric changes
    metricSelect.addEventListener('change', (e) => {
        const metric = e.target.value;
        const config = METRIC_CONFIG[metric];
        if (config) {
            goalSelect.value = config.goal;
        }
    });

    // Set initial goal based on default metric
    const initialMetric = metricSelect.value;
    if (METRIC_CONFIG[initialMetric]) {
        goalSelect.value = METRIC_CONFIG[initialMetric].goal;
    }

    sizeRange.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        sizeValue.textContent = val;
        updateCounts(); // Check bounds
    });

    // Sync correlation slider and input
    correlationRange.addEventListener('input', (e) => {
        correlationInput.value = e.target.value;
        checkBaseCorrelation(); // Re-check when threshold changes
    });

    correlationInput.addEventListener('input', (e) => {
        let val = parseFloat(e.target.value);
        if (val < 0.1) val = 0.1;
        if (val > 1.0) val = 1.0;
        correlationInput.value = val;
        correlationRange.value = val;
        checkBaseCorrelation(); // Re-check when threshold changes
    });

    useAllDatesCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) {
            dateInputsDiv.classList.add('hidden');
        } else {
            dateInputsDiv.classList.remove('hidden');
        }
    });

    const normalizationCheckbox = modal.querySelector('#search-normalization-enabled');
    const normalizationControls = modal.querySelector('#search-normalization-controls');

    // CAGR x KPI Logic
    const cagrScalingCheckbox = modal.querySelector('#search-cagr-scaling-enabled');
    const cagrScalingControls = modal.querySelector('#search-cagr-scaling-controls');
    const cagrScalingMetric = modal.querySelector('#search-cagr-scaling-metric');
    const cagrScalingOperator = modal.querySelector('#search-cagr-scaling-operator');

    normalizationCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) {
            normalizationControls.classList.remove('hidden');
        } else {
            normalizationControls.classList.add('hidden');
            // Also uncheck sub-option if parent is unchecked (optional, but cleaner)
            if (cagrScalingCheckbox) {
                cagrScalingCheckbox.checked = false;
                cagrScalingControls.classList.add('hidden');
            }
        }
    });

    if (cagrScalingCheckbox) {
        cagrScalingCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;

            // Toggle visibility of secondary controls
            if (isChecked) {
                cagrScalingControls.classList.remove('hidden');
            } else {
                cagrScalingControls.classList.add('hidden');
            }

            // Disable/Enable main metric and goal selectors
            if (metricSelect) {
                metricSelect.disabled = isChecked;
                if (isChecked) metricSelect.classList.add('opacity-50', 'cursor-not-allowed');
                else metricSelect.classList.remove('opacity-50', 'cursor-not-allowed');
            }
            if (goalSelect) {
                goalSelect.disabled = isChecked;
                // Auto-set to 'maximize' if checking CAGR x KPI, as usually we want to maximize the product
                if (isChecked) goalSelect.value = 'maximize';

                if (isChecked) goalSelect.classList.add('opacity-50', 'cursor-not-allowed');
                else goalSelect.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        });
    }

    if (cagrScalingMetric && cagrScalingOperator) {
        cagrScalingMetric.addEventListener('change', (e) => {
            const selectedKey = e.target.value;
            const config = METRIC_CONFIG[selectedKey];

            if (config) {
                if (config.goal === 'minimize') {
                    cagrScalingOperator.value = 'divide';
                } else {
                    cagrScalingOperator.value = 'multiply';
                }
            }
        });
    }

    const closeModal = () => modal.remove();

    modal.querySelector('#btn-close-search').onclick = closeModal;
    modal.querySelector('#btn-cancel-search').onclick = closeModal;

    modal.querySelector('#btn-start-search').onclick = () => {
        // Collect checked fixed indices
        const checkedIndices = Array.from(modal.querySelectorAll('.base-strategy-checkbox:checked'))
            .map(cb => parseInt(cb.dataset.index, 10));

        const config = {
            fixedIndices: checkedIndices, // Use the dynamically checked list
            maxSize: parseInt(sizeRange.value),
            correlationThreshold: parseFloat(correlationInput.value),
            metric: modal.querySelector('#search-metric').value,
            goal: modal.querySelector('#search-goal').value,
            metricName: modal.querySelector('#search-metric').options[modal.querySelector('#search-metric').selectedIndex].text,
            useAllDates: useAllDatesCheckbox.checked,
            startDate: useAllDatesCheckbox.checked ? null : startDateInput.value,
            endDate: useAllDatesCheckbox.checked ? null : endDateInput.value,
            searchMethod: modal.querySelector('input[name="search-method"]:checked').value,

            // Normalization Params
            normalizationEnabled: normalizationCheckbox.checked,
            normalizationMetric: modal.querySelector('#search-normalization-metric').value,
            normalizationTarget: parseFloat(modal.querySelector('#search-normalization-value').value),

            // CAGR Optimization
            cagrScalingEnabled: cagrScalingCheckbox ? cagrScalingCheckbox.checked : false,
            cagrScalingMetric: (cagrScalingCheckbox && cagrScalingCheckbox.checked) ? cagrScalingMetric.value : null,
            cagrScalingOperator: (cagrScalingCheckbox && cagrScalingCheckbox.checked) ? cagrScalingOperator.value : 'multiply'
        };


        startSearch(config);
        closeModal();
    };
};

const startSearch = (config) => {
    // 1. Switch to DataBank tab
    const databankTabBtn = document.querySelector('button[data-target="databank-content"]');
    if (databankTabBtn) databankTabBtn.click();

    // 2. Update DataBank UI inputs to reflect Search settings (Sync UI)
    if (dom.databankSizeInput) dom.databankSizeInput.value = config.maxSize;
    if (dom.optimizationMetricSelect) dom.optimizationMetricSelect.value = config.metric;
    if (dom.optimizationGoalSelect) dom.optimizationGoalSelect.value = config.goal;
    if (dom.correlationFilterInput) dom.correlationFilterInput.value = config.correlationThreshold;

    // 3. Trigger search with custom config
    findDatabankPortfolios(config);
};
