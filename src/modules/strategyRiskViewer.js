import { state } from '../state.js';

/**
 * Generates the HTML for the Strategy Risk Viewer Modal.
 */
const ensureStrategyRiskModalExists = () => {
    if (document.getElementById('strategy-risk-modal')) return;

    const modalHTML = `
    <div id="strategy-risk-modal" class="fixed inset-0 bg-gray-900/80 backdrop-blur-sm z-50 hidden flex items-center justify-center opacity-0 transition-opacity duration-300">
        <div class="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col transform scale-95 transition-transform duration-300" id="strategy-risk-modal-content">
            <!-- Header -->
            <div class="flex justify-between items-center p-6 border-b border-gray-700 bg-gray-800/50 rounded-t-xl">
                <div>
                    <h2 class="text-xl font-bold text-white flex items-center gap-2">
                        <span class="text-amber-400">👁️</span> Visor de Riesgo Base
                    </h2>
                    <p class="text-gray-400 text-sm mt-1" id="strategy-risk-portfolio-name">Portafolio: ...</p>
                </div>
                <button id="close-strategy-risk-modal" class="text-gray-400 hover:text-white transition-colors">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>

            <!-- Body -->
            <div class="p-6 overflow-y-auto">
                <div class="bg-blue-900/20 border border-blue-500/30 rounded-lg p-3 mb-4 flex flex-col gap-2">
                    <div class="flex items-start gap-3">
                        <span class="text-blue-400 text-xl">ℹ️</span>
                        <p class="text-sm text-blue-200">
                            Estos valores muestran el <strong>Peso (Weight)</strong> de cada estrategia.
                            La columna "Riesgo" se calcula multiplicando el Peso por el Valor Base.
                        </p>
                    </div>
                    
                    <div class="flex items-center gap-3 mt-2 pl-8">
                        <label class="text-sm text-gray-300">Valor Base Simulado:</label>
                        <input type="number" id="risk-viewer-base-input" class="w-24 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-center focus:outline-none focus:border-sky-500" value="100">
                    </div>
                </div>

                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="text-xs text-gray-400 uppercase border-b border-gray-700">
                            <th class="py-2 px-2">Estrategia</th>
                            <th class="py-2 px-2 text-right">Peso (Weight)</th>
                            <th class="py-2 px-2 text-right">Riesgo Calculado</th>
                        </tr>
                    </thead>
                    <tbody id="strategy-risk-table-body" class="text-sm text-gray-300 divide-y divide-gray-700/50">
                        <!-- Rows injected here -->
                    </tbody>
                </table>
            </div>
            
            <!-- Footer -->
            <div class="p-4 border-t border-gray-700 bg-gray-800/50 rounded-b-xl flex justify-end">
                <button id="btn-close-risk-viewer" class="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                    Cerrar
                </button>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Events
    const modal = document.getElementById('strategy-risk-modal');
    const closeBtn = document.getElementById('close-strategy-risk-modal');
    const btnClose = document.getElementById('btn-close-risk-viewer');
    const baseInput = document.getElementById('risk-viewer-base-input');

    const closeModal = () => {
        modal.classList.add('opacity-0');
        modal.querySelector('#strategy-risk-modal-content').classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
    };

    closeBtn.addEventListener('click', closeModal);
    btnClose.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Recalculate on input change
    baseInput.addEventListener('input', () => {
        const baseVal = parseFloat(baseInput.value) || 0;
        document.querySelectorAll('.risk-viewer-calculated-cell').forEach(cell => {
            const weight = parseFloat(cell.dataset.weight);
            cell.textContent = (weight * baseVal).toFixed(0);
        });
    });
};

/**
 * Opens the Strategy Risk Viewer for a portfolio.
 * @param {number} portfolioIndex 
 */
export const openStrategyRiskModal = (portfolioIndex) => {
    ensureStrategyRiskModalExists();

    const portfolio = state.savedPortfolios[portfolioIndex];
    if (!portfolio) return;

    document.getElementById('strategy-risk-portfolio-name').textContent = `Portafolio: ${portfolio.name}`;
    const tbody = document.getElementById('strategy-risk-table-body');
    tbody.innerHTML = '';

    // Reset base input to 100 or keep previous? Resetting is safer.
    const baseInput = document.getElementById('risk-viewer-base-input');
    baseInput.value = 100;
    const baseVal = 100;

    // Determine strategies and weights
    let strategies = [];
    const weights = portfolio.weights || [];
    const hasWeights = weights.length > 0;
    // Check for explicit risk per strategy (List[float] matching indices)
    const riskPerStrategy = Array.isArray(portfolio.riskPerStrategy) ? portfolio.riskPerStrategy : [];
    const hasRiskPerStrategy = riskPerStrategy.length > 0;

    // Helper to get strategy count first
    const count = (portfolio.strategyIds && portfolio.strategyIds.length) || (portfolio.indices && portfolio.indices.length) || 0;
    const defaultWeight = count > 0 ? (1 / count) : 0;

    if (portfolio.strategyIds && portfolio.strategyIds.length > 0) {
        strategies = portfolio.strategyIds.map((id, idx) => {
            const file = state.loadedStrategyFiles.find(f => f.strategyId === id);

            let w = defaultWeight;
            let r = null;

            if (hasRiskPerStrategy && riskPerStrategy[idx] !== undefined) {
                r = riskPerStrategy[idx];
                w = r / 100; // Infer weight relative to 100 base
            } else if (hasWeights && weights[idx] !== undefined) {
                w = weights[idx];
            }

            return {
                name: file ? file.name.replace('.csv', '') : `Strategy ${id}`,
                weight: w,
                risk: r
            };
        });
    } else if (portfolio.indices) {
        strategies = portfolio.indices.map((index, idx) => {
            const file = state.loadedStrategyFiles[index];

            let w = defaultWeight;
            let r = null;

            if (hasRiskPerStrategy && riskPerStrategy[idx] !== undefined) {
                r = riskPerStrategy[idx];
                w = r / 100;
            } else if (hasWeights && weights[idx] !== undefined) {
                w = weights[idx];
            }

            return {
                name: file ? file.name.replace('.csv', '') : `Strategy ${index}`,
                weight: w,
                risk: r
            };
        });
    }

    // Update Info Text based on data source
    const infoText = document.querySelector('#strategy-risk-modal p.text-blue-200');
    const riskColumnHeader = document.getElementById('risk-column-header');

    if (infoText) {
        if (hasRiskPerStrategy) {
            infoText.innerHTML = `✅ <strong>Riesgo Configurado Detectado</strong>.<br>Se muestran los valores de riesgo por operación definidos explícitamente en el portafolio.`;
            if (baseInput) baseInput.disabled = true; // Disable simulation if explicit risk exists
            if (riskColumnHeader) riskColumnHeader.textContent = 'Riesgo Configurado';
        } else if (hasWeights) {
            infoText.innerHTML = `Estos valores muestran el <strong>Peso Personalizado</strong> de cada estrategia.<br>La columna "Riesgo" se calcula multiplicando el Peso por el Valor Base.`;
            if (baseInput) baseInput.disabled = false;
            if (riskColumnHeader) riskColumnHeader.textContent = 'Riesgo Calculado';
        } else {
            infoText.innerHTML = `⚠️ <strong>Pesos No Encontrados</strong>: Se asume <strong>Peso Equitativo (${(defaultWeight * 100).toFixed(1)}%)</strong>.<br>La columna "Riesgo" se calcula dividiendo el Valor Base entre el número de estrategias.`;
            if (baseInput) baseInput.disabled = false;
            if (riskColumnHeader) riskColumnHeader.textContent = 'Riesgo Calculado';
        }
    }

    if (strategies.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-gray-500">No hay estrategias.</td></tr>';
    } else {
        strategies.forEach(strat => {
            const weight = strat.weight.toFixed(4);
            // If explicit risk exists, use it. Else calculate from weight * baseVal
            const riskDisplay = strat.risk !== null ? strat.risk.toFixed(2) : (strat.weight * baseVal).toFixed(0);
            const riskClass = strat.risk !== null ? 'text-purple-400 font-bold' : 'text-emerald-400 font-mono risk-viewer-calculated-cell';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="py-2 px-2 font-medium text-white">${strat.name}</td>
                <td class="py-2 px-2 text-right text-sky-400 font-mono">${weight}</td>
                <td class="py-2 px-2 text-right ${riskClass}" data-weight="${strat.weight}">${riskDisplay}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    const modal = document.getElementById('strategy-risk-modal');
    modal.classList.remove('hidden');
    // Trigger reflow
    void modal.offsetWidth;
    modal.classList.remove('opacity-0');
    modal.querySelector('#strategy-risk-modal-content').classList.remove('scale-95');
};
