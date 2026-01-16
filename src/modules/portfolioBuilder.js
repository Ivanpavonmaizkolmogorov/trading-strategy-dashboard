import { state } from '../state.js';
import { dom } from '../dom.js';
import { displayError, formatMetricForDisplay, generatePortfolioId } from '../utils.js'; // Import ID generator
import { savePortfolioFromDatabank } from './databank.js'; // Reusing save logic? Maybe need a generic one.
import { displaySavedPortfoliosList } from '../ui.js';
import { ALL_METRICS } from '../config.js';

import { calculateSQMetrics, parseTradesFromContent, parseTradesFromData } from './sqAnalysis_v2.js?v=10';

/**
 * Analyzes a manually selected set of strategies.
 * @param {number[]} indices - Array of strategy indices.
 */
export const analyzeCustomPortfolio = async (indices) => {
    if (!indices || indices.length < 2) {
        displayError("Selecciona al menos 2 estrategias para crear un portafolio.");
        return;
    }

    const btn = document.getElementById('fab-test-selection');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="animate-spin">⏳</span> Analizando...';
    }

    try {
        console.log(`[PortfolioBuilder] Analyzing custom portfolio with indices: ${indices}`);

        // Construct payload similar to DataBank but specific
        // Construct payload for /analysis/full
        const tempId = Date.now();
        const payload = {
            strategies_data: state.rawStrategiesData,
            portfolios_to_analyze: [{
                indices: indices,
                weights: null, // Equal weights by default
                portfolio_id: tempId // Temporary ID to find result
            }]
        };

        const response = await fetch('/analysis/full', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Backend error: ${response.statusText}`);
        }

        const results = await response.json();

        // Find our portfolio result
        const portfolioResult = results.find(r => r.portfolio_id === tempId);

        if (!portfolioResult || !portfolioResult.metrics) {
            throw new Error("No results returned for the created portfolio.");
        }

        // Validate against active filters
        const validation = validatePortfolio(portfolioResult);

        // Show result modal
        showPortfolioResultModal(portfolioResult, validation, indices);

    } catch (error) {
        console.error("[PortfolioBuilder] Error:", error);
        displayError(`Error al analizar portafolio: ${error.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
};

/**
 * Validates a portfolio against active DOM filters.
 */
const validatePortfolio = (portfolio) => {
    const warnings = [];
    const metrics = portfolio.metrics;

    // Helper to safely get float value or default
    const getFilterValue = (id, defaultValue) => {
        const el = document.getElementById(id);
        return el ? parseFloat(el.value) : defaultValue;
    };

    // 1. Correlation
    // If filter input doesn't exist, assume no correlation limit (or high limit)
    const correlationThreshold = getFilterValue('correlation-filter', 1.0);
    // Note: Backend usually returns 'max_correlation' or similar in metrics?
    // If not, we skip this check.

    // 2. Max Drawdown %
    const maxDDLimit = getFilterValue('max-drawdown-filter', 100);
    if (Math.abs(metrics.maxDrawdown) > maxDDLimit) {
        warnings.push(`Max Drawdown (${Math.abs(metrics.maxDrawdown).toFixed(2)}%) excede el límite (${maxDDLimit}%).`);
    }

    // 3. Min Profit Factor
    const minPF = getFilterValue('min-profit-factor', 0);
    if (metrics.profitFactor < minPF) {
        warnings.push(`Profit Factor (${metrics.profitFactor.toFixed(2)}) es menor que el mínimo (${minPF}).`);
    }

    // 4. Min Net Profit
    const minProfit = getFilterValue('min-net-profit', -Infinity);
    if (metrics.totalProfit < minProfit) {
        warnings.push(`Net Profit ($${metrics.totalProfit.toFixed(0)}) es menor que el mínimo ($${minProfit}).`);
    }

    // 5. Min Trade Count
    const minTrades = getFilterValue('min-trade-count', 0);
    if (metrics.totalTrades < minTrades) {
        warnings.push(`Número de Trades (${metrics.totalTrades}) es menor que el mínimo (${minTrades}).`);
    }

    return {
        passed: warnings.length === 0,
        warnings: warnings
    };
};

/**
 * Shows a modal with the analysis results.
 */
const showPortfolioResultModal = (portfolio, validation, indices) => {
    // Check if modal exists, if not create it
    let modal = document.getElementById('portfolio-result-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'portfolio-result-modal';
        modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[60] hidden';
        modal.innerHTML = `
            <div class="bg-gray-800 rounded-xl shadow-2xl border border-gray-700 w-full max-w-2xl p-6 transform transition-all scale-100">
                <div class="flex justify-between items-start mb-6">
                    <div>
                        <h3 class="text-xl font-bold text-white mb-1">Resultado del Análisis</h3>
                        <p class="text-gray-400 text-sm">Portafolio Manual</p>
                    </div>
                    <button id="close-result-modal" class="text-gray-400 hover:text-white transition-colors">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>

                <div id="result-modal-content" class="space-y-6">
                    <!-- Metrics Grid -->
                </div>

                <div id="result-modal-warnings" class="mt-6 hidden">
                    <!-- Warnings -->
                </div>

                <div class="mt-4">
                    <label class="block text-sm font-medium text-gray-400 mb-1">Comentarios (Opcional)</label>
                    <textarea id="portfolio-comment" class="w-full bg-gray-700 border border-gray-600 rounded-lg p-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" rows="2" placeholder="Notas sobre este portafolio..."></textarea>
                </div>

                <div class="mt-8 flex justify-end gap-3">
                    <button id="cancel-save-btn" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors">Cerrar</button>
                    <button id="confirm-save-btn" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2">
                        <span>Guardar Portafolio</span>
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Close handlers
        const close = () => modal.classList.add('hidden');
        document.getElementById('close-result-modal').onclick = close;
        document.getElementById('cancel-save-btn').onclick = close;
        modal.onclick = (e) => { if (e.target === modal) close(); };
    }

    // Populate Content - Use default visible columns from savedPortfoliosTable
    const content = document.getElementById('result-modal-content');
    const metrics = portfolio.metrics;

    // Default visible columns (same as savedPortfoliosTable.js DEFAULT_CONFIG.visibleColumns)
    // Excluding 'name' since it's not a metric
    const defaultMetrics = ['totalTrades', 'totalProfit', 'returnDD', 'upi', 'sortinoRatio', 'sharpeRatio', 'maxDrawdownInDollars', 'maxStagnationTrades', 'maxStagnationDays', 'winningPercentage', 'profitFactor', 'sqn'];

    // Generate metric cards dynamically
    const metricCards = defaultMetrics.map(metricId => {
        const metricDef = ALL_METRICS[metricId];
        if (!metricDef) return '';

        const value = metrics[metricId];
        const formattedValue = formatMetricForDisplay(value, metricId);

        // Determine color based on metric type
        let colorClass = 'text-gray-200';
        if (metricId === 'totalProfit') {
            colorClass = value >= 0 ? 'text-emerald-400' : 'text-red-400';
        } else if (['maxDrawdown', 'maxDrawdownInDollars'].includes(metricId)) {
            colorClass = 'text-red-400';
        } else if (['sharpeRatio', 'sortinoRatio', 'upi'].includes(metricId)) {
            colorClass = 'text-purple-400';
        } else if (['profitFactor', 'returnDD'].includes(metricId)) {
            colorClass = 'text-blue-400';
        }

        return `
            <div class="bg-gray-700/50 p-3 rounded-lg text-center">
                <div class="text-xs text-gray-400 uppercase">${metricDef.label}</div>
                <div class="text-lg font-bold ${colorClass}">
                    ${formattedValue}
                </div>
            </div>
        `;
    }).join('');

    content.innerHTML = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            ${metricCards}
        </div>
    `;

    // Warnings
    const warningsDiv = document.getElementById('result-modal-warnings');
    if (!validation.passed) {
        warningsDiv.classList.remove('hidden');
        warningsDiv.innerHTML = `
            <div class="bg-amber-900/30 border border-amber-700/50 rounded-lg p-4">
                <div class="flex items-center gap-2 mb-2 text-amber-400 font-bold">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                    Advertencia: Filtros no superados
                </div>
                <ul class="list-disc list-inside text-amber-200/80 text-sm space-y-1">
                    ${validation.warnings.map(w => `<li>${w}</li>`).join('')}
                </ul>
            </div>
        `;
    } else {
        warningsDiv.classList.add('hidden');
        warningsDiv.innerHTML = '';
    }

    // Save Button Logic
    const saveBtn = document.getElementById('confirm-save-btn');
    saveBtn.onclick = () => {
        // Add to saved portfolios
        // Use 'indices' from the closure, as portfolio result from backend might not have it
        const names = indices.map(i => state.loadedStrategyFiles[i].name.replace('.csv', '')).join('+');
        const strategyIds = indices.map(i => state.loadedStrategyFiles[i].strategyId);
        const strategyNames = indices.map(i => state.loadedStrategyFiles[i].name.replace('.csv', ''));

        // Calculate SQ Metrics for persistence
        let allTrades = [];
        indices.forEach(idx => {
            const file = state.loadedStrategyFiles[idx];
            if (file && file.content) {
                const trades = parseTradesFromContent(file.content);
                allTrades = allTrades.concat(trades);
            } else if (state.rawStrategiesData[idx]) {
                // Fallback: Use rawStrategiesData if content is missing (e.g. after reload)
                console.log(`[PortfolioBuilder] Using rawStrategiesData for strategy index ${idx}`);
                const trades = parseTradesFromData(state.rawStrategiesData[idx]);
                allTrades = allTrades.concat(trades);
            }
        });
        allTrades.sort((a, b) => a.exitTime - b.exitTime);
        const sqMetrics = calculateSQMetrics(allTrades);

        // Save portfolio with strategyIds for robust restoration
        state.savedPortfolios.push({
            name: `Manual (${names})`,
            indices: indices,
            strategyIds: strategyIds, // <--- SAVE STRATEGY IDs
            strategyNames: strategyNames, // <--- SAVE STRATEGY NAMES
            id: generatePortfolioId(`Manual (${names})`, strategyIds),
            weights: null,
            metrics: portfolio.metrics, // Save pre-calculated metrics
            sqMetrics: sqMetrics, // <--- SAVE SQ METRICS
            analysis: portfolio.metrics, // Save chart data and analysis (metrics contains chartData)
            comments: document.getElementById('portfolio-comment')?.value || ''
        });

        displaySavedPortfoliosList();

        // Close modal
        modal.classList.add('hidden');

        // Notify user
        // Maybe a toast? For now just log.
        console.log("Portfolio saved manually.");
    };

    // Show modal
    modal.classList.remove('hidden');
};

/**
 * Loads a portfolio into the strategy selection view (Editor) for modification.
 * @param {number} portfolioIndex - Index of the portfolio in state.savedPortfolios
 */
export const loadPortfolioIntoEditor = (portfolioIndex) => {
    const portfolio = state.savedPortfolios[portfolioIndex];
    if (!portfolio) return;

    console.log(`[PortfolioBuilder] Loading portfolio ${portfolio.name} into editor...`);

    // Import dynamically to avoid circular dependencies if possible, or just assume it's available
    import('./strategiesTable.js').then(({ selectedStrategies, renderStrategiesTable }) => {
        // 1. Clear current selection
        selectedStrategies.clear();

        // 2. Select strategies from portfolio
        // ROBUST: Try to match by strategyId first, then fallback to indices
        let indicesToSelect = [];

        if (portfolio.strategyIds && portfolio.strategyIds.length > 0) {
            // Find current indices for these IDs
            portfolio.strategyIds.forEach(id => {
                const currentIndex = state.loadedStrategyFiles.findIndex(f => f.strategyId === id);
                if (currentIndex !== -1) {
                    indicesToSelect.push(currentIndex);
                } else {
                    console.warn(`[PortfolioBuilder] Strategy with ID ${id} not found in loaded files.`);
                }
            });
        } else if (portfolio.indices) {
            // Fallback for legacy portfolios
            indicesToSelect = portfolio.indices;
        }

        indicesToSelect.forEach(index => {
            // Verify index is within bounds
            if (state.loadedStrategyFiles[index]) {
                selectedStrategies.add(index);
            }
        });

        // 3. Update Table UI
        renderStrategiesTable();

        // 4. Scroll to strategies table
        document.getElementById('strategies-content')?.scrollIntoView({ behavior: 'smooth' });

        // 5. Show toast
        import('../modules/notifications.js').then(({ showToast }) => {
            showToast(`Loaded "${portfolio.name}" into editor`, 'success');
        });
    });
};
