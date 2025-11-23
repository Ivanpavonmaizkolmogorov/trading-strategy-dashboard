import { state } from '../state.js';
import { findDatabankPortfolios } from './databank.js';
import { dom } from '../dom.js';

/**
 * Opens the unified Search Configuration Modal.
 * @param {Array<number>} selectedIndices - Optional. Array of indices of fixed strategies.
 */
export const openSearchConfigModal = (selectedIndices = []) => {
    // Get strategy names if any are selected
    const selectedStrategies = selectedIndices.map(index => {
        const strategy = window.analysisResults[index];
        return strategy ? strategy.name : `Strategy #${index}`;
    });

    const isSquadBuilderMode = selectedStrategies.length > 0;
    const title = isSquadBuilderMode ? 'Squad Builder' : 'New Search';
    const subtitle = isSquadBuilderMode
        ? 'Build a portfolio around your star players.'
        : 'Configure your portfolio search parameters.';
    const icon = isSquadBuilderMode ? '⚽' : '🔍';
    const minSize = isSquadBuilderMode ? selectedStrategies.length + 1 : 2;
    const defaultSize = Math.max(minSize, 20);

    // Create modal HTML
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 animate-fade-in';
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-lg border border-gray-700 p-6 w-[500px] max-w-full shadow-2xl transform transition-all scale-100">
            <div class="flex justify-between items-start mb-6">
                <div>
                    <h3 class="text-2xl font-bold text-white flex items-center gap-2">
                        <span>${icon}</span> ${title}
                    </h3>
                    <p class="text-gray-400 text-sm mt-1">${subtitle}</p>
                </div>
                <button id="btn-close-search" class="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
            </div>

            <!-- Selected Players List (Only if Squad Builder Mode) -->
            ${isSquadBuilderMode ? `
            <div class="mb-6 bg-gray-900/50 rounded p-3 border border-gray-700">
                <label class="block text-xs font-medium text-gray-500 uppercase mb-2">Starting Lineup (Fixed)</label>
                <div class="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                    ${selectedStrategies.map(name => `
                        <span class="bg-blue-900/50 text-blue-200 text-xs px-2 py-1 rounded border border-blue-800 flex items-center gap-1">
                            ⭐ ${name}
                        </span>
                    `).join('')}
                </div>
            </div>
            ` : ''}

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
                        ${isSquadBuilderMode
            ? `Includes your ${selectedStrategies.length} fixed strategies + <span id="random-count">${defaultSize - selectedStrategies.length}</span> random additions.`
            : 'Number of strategies in each generated portfolio.'}
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
                        <input type="range" id="search-correlation-range" min="0.1" max="1.0" step="0.05" value="${dom.correlationFilterInput ? dom.correlationFilterInput.value : 0.5}" 
                            class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500">
                        <span id="search-correlation-value" class="text-white font-mono bg-gray-700 px-2 py-1 rounded w-12 text-center">
                            ${dom.correlationFilterInput ? dom.correlationFilterInput.value : 0.5}
                        </span>
                    </div>
                    <p class="text-xs text-gray-500 mt-1">Lower values mean stricter diversity requirements.</p>
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
                            <option value="totalProfit">Net Profit</option>
                            <option value="profitFactor">Profit Factor</option>
                            <option value="sqn">SQN</option>
                            <option value="upi">UPI</option>
                            <option value="maxDrawdown">Max Drawdown %</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- Action Buttons -->
            <div class="mt-8 flex justify-end gap-3">
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

    const correlationRange = modal.querySelector('#search-correlation-range');
    const correlationValue = modal.querySelector('#search-correlation-value');

    const useAllDatesCheckbox = modal.querySelector('#search-use-all-dates');
    const dateInputsDiv = modal.querySelector('#search-date-inputs');
    const startDateInput = modal.querySelector('#search-start-date');
    const endDateInput = modal.querySelector('#search-end-date');

    sizeRange.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        sizeValue.textContent = val;
        if (randomCountSpan) randomCountSpan.textContent = val - selectedStrategies.length;
    });

    correlationRange.addEventListener('input', (e) => {
        correlationValue.textContent = e.target.value;
    });

    useAllDatesCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) {
            dateInputsDiv.classList.add('hidden');
        } else {
            dateInputsDiv.classList.remove('hidden');
        }
    });

    const closeModal = () => modal.remove();

    modal.querySelector('#btn-close-search').onclick = closeModal;
    modal.querySelector('#btn-cancel-search').onclick = closeModal;

    modal.querySelector('#btn-start-search').onclick = () => {
        const config = {
            fixedIndices: selectedIndices,
            maxSize: parseInt(sizeRange.value),
            correlationThreshold: parseFloat(correlationRange.value),
            metric: modal.querySelector('#search-metric').value,
            goal: modal.querySelector('#search-goal').value,
            metricName: modal.querySelector('#search-metric').options[modal.querySelector('#search-metric').selectedIndex].text,
            useAllDates: useAllDatesCheckbox.checked,
            startDate: useAllDatesCheckbox.checked ? null : startDateInput.value,
            endDate: useAllDatesCheckbox.checked ? null : endDateInput.value
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
