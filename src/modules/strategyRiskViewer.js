import { state } from '../state.js';
import { selectedStrategies, renderStrategiesTable, updateFloatingActionBar } from './strategiesTable.js';

/**
 * Generates the HTML for the Strategy Risk Viewer Modal.
 */
const ensureStrategyRiskModalExists = () => {
    const existingModal = document.getElementById('strategy-risk-modal');
    if (existingModal) {
        // FORCE REMOVAL to ensure new styles and logic are applied immediately
        existingModal.remove();
    }

    const modalHTML = `
    <div id="strategy-risk-modal" class="fixed inset-0 bg-gray-900/80 backdrop-blur-sm z-50 hidden flex items-center justify-center opacity-0 transition-opacity duration-300">
        <div class="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-11/12 max-w-none max-h-[90vh] flex flex-col transform scale-95 transition-transform duration-300" id="strategy-risk-modal-content">
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

            <!-- Wrapper for Scrollable Content -->
            <div class="flex-1 overflow-y-auto custom-scrollbar">
                <!-- Body -->
                <div class="p-6">
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
                            <th class="py-2 px-2 w-8"><input type="checkbox" id="risk-viewer-select-all" class="form-checkbox h-4 w-4 bg-gray-700 border-gray-600 rounded text-blue-500"></th>
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
                <button id="btn-show-correlation" class="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors mr-auto border border-gray-600">
                    📊 Ver Matriz de Correlación
                </button>
                <button id="btn-close-risk-viewer" class="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                    Cerrar
                </button>
            </div>
            
            <!-- Correlation Matrix Container (Hidden by default) -->
            <div id="correlation-matrix-container" class="hidden p-6 border-t border-gray-700 bg-gray-800/50">
                <h3 class="text-md font-bold text-gray-300 mb-3">Matriz de Correlación (PnL Diario)</h3>
                <div id="correlation-matrix-content" class="overflow-x-auto">
                    <p class="text-sm text-gray-500 animate-pulse">Cargando...</p>
                </div>
                </div>
            </div>
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

    // Show Correlation Matrix
    document.getElementById('btn-show-correlation').addEventListener('click', async () => {
        const container = document.getElementById('correlation-matrix-container');
        const content = document.getElementById('correlation-matrix-content');

        if (container.classList.contains('hidden')) {
            container.classList.remove('hidden');
            // Auto-scroll to bottom
            setTimeout(() => container.scrollIntoView({ behavior: 'smooth' }), 100);

            // Fetch Data
            content.innerHTML = '<p class="text-sm text-gray-500 animate-pulse">Calculando correlaciones...</p>';

            /* 
               Warning: strategyIndices below are recalculated. 
               We should ensure they match the ones used in the table generation (openStrategyRiskModal)
               so the mapping is consistent. 
            */

            try {
                // Get current portfolio index from the modal title's context - we need to store it or look it up.
                // We can get it from the openStrategyRiskModal closure if we attach it to the DOM or state.
                // Better: Pass it via data attribute on the modal when opening.
                const modal = document.getElementById('strategy-risk-modal');
                const portfolioIndex = modal.dataset.portfolioIndex;
                const source = modal.dataset.source;

                if (!portfolioIndex) return;

                const portfolio = source === 'databank' ? state.databankPortfolios[portfolioIndex] : state.savedPortfolios[portfolioIndex];
                if (!portfolio) throw new Error("Portfolio not found");

                let strategyIndices = [];
                if (portfolio.strategyIds && portfolio.strategyIds.length > 0) {
                    // Resolve IDs to current indices
                    portfolio.strategyIds.forEach(id => {
                        const idx = state.loadedStrategyFiles.findIndex(f => f.strategyId === id);
                        if (idx !== -1) strategyIndices.push(idx);
                    });
                }

                // Fallback: If ID resolution failed (linkage broken) but we have legacy indices, use them.
                if (strategyIndices.length < 2 && portfolio.indices && portfolio.indices.length >= 2) {
                    console.warn("[RiskViewer] ID lookup failed for correlation. Falling back to indices.");
                    strategyIndices = portfolio.indices;
                }

                // Fallback 2: If no strategyIds/indices list but 'indices' property exists (legacy-legacy)
                if (strategyIndices.length === 0 && portfolio.indices) {
                    strategyIndices = portfolio.indices;
                }

                if (strategyIndices.length < 2) {
                    content.innerHTML = '<p class="text-sm text-yellow-500">Se necesitan al menos 2 estrategias para calcular correlación.</p>';
                    return;
                }

                // Prepare Request
                const requestBody = {
                    portfolio_indices: strategyIndices,
                    strategies_data: state.rawStrategiesData
                };

                const response = await fetch('/analysis/correlation-matrix', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody)
                });

                const data = await response.json();

                if (data.matrix) {
                    renderCorrelationHeatmap(data.matrix, strategyIndices, content);
                } else {
                    throw new Error(data.detail || "Error desconocido");
                }

            } catch (e) {
                console.error(e);
                content.innerHTML = `<p class="text-sm text-red-400">Error: ${e.message}</p>`;
            }
        } else {
            container.classList.add('hidden');
        }
    });
};

function renderCorrelationHeatmap(matrix, indices, container) {
    let html = '<table class="w-full text-xs text-center border-collapse table-auto">';

    // Indices to Names (Full names)
    const names = indices.map(idx => {
        const file = state.loadedStrategyFiles[idx];
        return file ? file.name.replace('.csv', '') : `Strat #${idx}`;
    });

    // Header
    html += '<thead><tr><th class="p-1"></th>';
    names.forEach(name => html += `<th class="p-2 text-gray-400 font-normal rotate-45 h-64 align-bottom whitespace-nowrap min-w-[80px] text-[10px]" title="${name}">${name}</th>`);
    html += '</tr></thead><tbody>';

    matrix.forEach((row, i) => {
        html += `<tr><td class="p-2 text-gray-400 font-normal text-right whitespace-nowrap text-[10px]" title="${names[i]}">${names[i]}</td>`;
        row.forEach((val, j) => {
            let colorClass = 'text-gray-500';
            let bgStyle = '';

            if (i === j) {
                colorClass = 'text-gray-600'; // Diagonal
            } else {
                const absVal = Math.abs(val);
                // Color scale: Green (0) -> Yellow (0.5) -> Red (1.0)
                // Simple traffic light logic
                if (val > 0.7) colorClass = 'text-red-400 font-bold';
                else if (val > 0.4) colorClass = 'text-yellow-400';
                else colorClass = 'text-green-400';

                // Background opacity for emphasis
                const opacity = Math.max(0.1, absVal * 0.3);
                const r = val > 0 ? 255 : 0; // Red for positive, Green/Blue for negative? Usually correlation is Red=High
                // Let's stick to text color for now to keep it clean, maybe slight bg
                bgStyle = `background-color: rgba(${val > 0.5 ? '255,0,0' : '0,255,0'}, ${opacity})`;
            }

            html += `<td class="p-2 border border-gray-700/50 ${colorClass}" style="${bgStyle}">${val.toFixed(2)}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

/**
 * Opens the Strategy Risk Viewer for a portfolio.
 * @param {number} portfolioIndex 
 */
export const openStrategyRiskModal = (portfolioIndex, source = 'saved') => {
    ensureStrategyRiskModalExists();

    const portfolio = source === 'databank' ? state.databankPortfolios[portfolioIndex] : state.savedPortfolios[portfolioIndex];
    if (!portfolio) return;

    // Store context for button handlers
    const modal = document.getElementById('strategy-risk-modal');
    modal.dataset.portfolioIndex = portfolioIndex;
    modal.dataset.source = source;

    // Reset View
    document.getElementById('correlation-matrix-container').classList.add('hidden');
    document.getElementById('strategy-risk-portfolio-name').textContent = `Portafolio: ${portfolio.name}`;
    const tbody = document.getElementById('strategy-risk-table-body');
    tbody.innerHTML = '';

    // --- WARNING INJECTION ---
    const warningId = 'risk-viewer-normalization-warning';
    const bodyContainer = modal.querySelector('.p-6'); // The main padding container
    const existingWarning = document.getElementById(warningId);
    if (existingWarning) existingWarning.remove();

    const normalizeCheckbox = document.getElementById('normalize-risk-checkbox');
    // Check State for Search Configuration (as element might be missing)
    const isGlobalNormalized = (normalizeCheckbox && normalizeCheckbox.checked) ||
        (state.currentOptimizationData && state.currentOptimizationData.normalizationEnabled);

    const isPortfolioNormalized = portfolio.riskConfig && portfolio.riskConfig.isScaled;

    if (isGlobalNormalized || isPortfolioNormalized) {
        const warningHTML = `
            <div id="${warningId}" class="bg-yellow-900/40 border border-yellow-600/50 rounded-lg p-3 mb-4 flex items-start gap-3">
                <span class="text-xl">⚠️</span>
                <div class="text-sm text-yellow-200">
                    <p class="font-bold">Aviso: Datos Normalizados</p>
                    <p class="opacity-90">Estás visualizando el desglose de riesgo sobre datos normalizados. Los valores de riesgo originales podrían diferir.</p>
                </div>
            </div>
        `;
        bodyContainer.insertAdjacentHTML('afterbegin', warningHTML);
    }

    // Determine strategies and weights
    let strategies = [];
    const weights = portfolio.weights || [];
    const hasWeights = weights.length > 0;
    // Check for explicit risk per strategy (List[float] matching indices)
    const riskPerStrategy = Array.isArray(portfolio.riskPerStrategy) ? portfolio.riskPerStrategy : [];
    const hasRiskPerStrategy = riskPerStrategy.length > 0;

    // Helper to get strategy count first
    const count = (portfolio.strategyIds && portfolio.strategyIds.length) || (portfolio.indices && portfolio.indices.length) || 0;

    console.log("[DEBUG RISK VIEWER] Opening modal for portfolio:", portfolio);
    console.log("[DEBUG RISK VIEWER] riskPerStrategy:", portfolio.riskPerStrategy);
    console.log("[DEBUG RISK VIEWER] riskConfig:", portfolio.riskConfig);

    const hasStoredNames = (portfolio.strategyNames && portfolio.strategyNames.length > 0);

    // Reset base input
    // User prefers "100 per strategy" as the mental model for default equal weights.
    // So if 5 strategies, Base = 500 -> Risk = 100 each.
    const baseInput = document.getElementById('risk-viewer-base-input');
    let baseVal = 100;

    if (!hasWeights && !hasRiskPerStrategy && count > 0) {
        baseVal = count * 100;
    }

    baseInput.value = baseVal;
    const defaultWeight = count > 0 ? (1 / count) : 0;

    if (portfolio.strategyIds && portfolio.strategyIds.length > 0) {
        console.log(`[RiskViewer] Resolving names for portfolio: ${portfolio.name}`);
        console.log(`[RiskViewer] Has stored strategyNames?`, !!portfolio.strategyNames, portfolio.strategyNames);

        strategies = portfolio.strategyIds.map((id, idx) => {
            const file = state.loadedStrategyFiles.find(f => f.strategyId === id);

            // Default name: Try file name -> Try stored strategyName -> Fallback to ID
            let name = file ? file.name.replace('.csv', '') : `Strategy ${id}`;
            let source = file ? 'File' : 'ID-Fallback';

            if (portfolio.strategyNames && portfolio.strategyNames[idx]) {
                name = portfolio.strategyNames[idx];
                source = 'Stored-Name';
            }

            console.log(`[RiskViewer] Strat #${idx} (ID: ${id}): Resolved Name="${name}" (Source: ${source})`);

            let w = defaultWeight;
            let r = null;

            if (hasRiskPerStrategy && riskPerStrategy[idx] !== undefined) {
                r = riskPerStrategy[idx];
                w = r / 100; // Infer weight relative to 100 base
            } else if (hasWeights && weights[idx] !== undefined) {
                w = weights[idx];
            }

            return {
                name: name,
                weight: w,
                risk: r
            };
        });
    } else if (portfolio.indices) {
        strategies = portfolio.indices.map((index, idx) => {
            const file = state.loadedStrategyFiles[index];
            // Default name: Try file name -> Try stored strategyName -> Fallback to Index
            let name = file ? file.name.replace('.csv', '') : `Strategy ${index}`;
            if (portfolio.strategyNames && portfolio.strategyNames[idx]) {
                name = portfolio.strategyNames[idx];
            }

            let w = defaultWeight;
            let r = null;

            if (hasRiskPerStrategy && riskPerStrategy[idx] !== undefined) {
                r = riskPerStrategy[idx];
                // Weight is inferred relative to base 100 if not explicit weights, or just use equal weight for display if undefined
                // But if we have risk, we should probably show the effective weight derived from that risk relative to total risk?
                // For now, let's keep the weight as is (likely 1/N) if not provided.
                if (!hasWeights) {
                    w = defaultWeight;
                } else if (weights[idx] !== undefined) {
                    w = weights[idx];
                }
            } else if (hasWeights && weights[idx] !== undefined) {
                w = weights[idx];
            }

            return {
                name: name,
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
            infoText.innerHTML = `ℹ️ <strong>Distribución Equitativa (Por Defecto)</strong>: Se asume <strong>${(defaultWeight * 100).toFixed(1)}%</strong> por estrategia.<br>La columna "Riesgo" se calcula dividiendo el Valor Base entre el número de estrategias.`;
            if (baseInput) baseInput.disabled = false;
            if (riskColumnHeader) riskColumnHeader.textContent = 'Riesgo Calculado';
        }
    }

    if (strategies.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-gray-500">No hay estrategias.</td></tr>';
    } else {
        strategies.forEach((strat, idx) => {
            const weight = strat.weight.toFixed(4);
            // If explicit risk exists, use it. Else calculate from weight * baseVal
            const riskDisplay = strat.risk !== null ? strat.risk.toFixed(2) : (strat.weight * baseVal).toFixed(0);
            const riskClass = strat.risk !== null ? 'text-purple-400 font-bold' : 'text-emerald-400 font-mono risk-viewer-calculated-cell';

            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-700/30 transition-colors group';

            // Resolve Original Index in state.loadedStrategyFiles to link with main table
            // We use name matching or ID matching if available, but indices is safest if we have them.
            // If strategies were populated via IDs, we map IDs back to loadedStrategyFiles index.
            let originalIndex = -1;

            if (portfolio.strategyIds && portfolio.strategyIds[idx]) {
                originalIndex = state.loadedStrategyFiles.findIndex(f => f.strategyId === portfolio.strategyIds[idx]);
            } else if (portfolio.indices && portfolio.indices[idx] !== undefined) {
                originalIndex = portfolio.indices[idx];
            }

            const isSelected = originalIndex !== -1 && selectedStrategies.has(originalIndex);

            tr.innerHTML = `
                <td class="py-2 px-2 text-center">
                    <input type="checkbox" class="risk-strategy-checkbox form-checkbox h-4 w-4 text-blue-500 bg-gray-700 border-gray-600 rounded cursor-pointer" 
                    data-original-index="${originalIndex}" ${isSelected ? 'checked' : ''} ${originalIndex === -1 ? 'disabled' : ''}>
                </td>
                <td class="py-2 px-2 font-medium text-white">
                    <div class="flex items-center">
                        <span>
                            ${strat.name} 
                            <span class="text-xs text-gray-500 ml-1">(${originalIndex !== -1 ? 'Linked' : 'No Link'})</span>
                            ${(() => {
                    // Robust Magic Number Check
                    let hasMagic = false;
                    if (state.magicNumberMap) {
                        // We don't have the full strategy object here easily, but we have the name
                        // and we can try to find the ID from state.loadedStrategyFiles if originalIndex is valid
                        const file = originalIndex !== -1 ? state.loadedStrategyFiles[originalIndex] : null;
                        const id = file ? file.strategyId : null;

                        const keys = [
                            id,
                            strat.name,
                            strat.name.toLowerCase().replace('.csv', '').trim(),
                            strat.name.replace(/\.csv$/i, '').trim()
                        ];
                        hasMagic = keys.some(k => k && state.magicNumberMap[k]);
                    }
                    return hasMagic ? `<span class="inline-flex items-center ml-2 px-1.5 py-0.5 rounded text-[9px] uppercase font-bold tracking-wider bg-indigo-900 text-indigo-200 border border-indigo-600 cursor-help" title="In MT5 (Magic Number Mapped)">⚡ MT5</span>` : '';
                })()}
                        </span>
                        <button class="copy-risk-strat-btn ml-2 text-gray-500 hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100" data-name="${strat.name}" title="Copy Name">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                        </button>
                    </div>
                </td>
                <td class="py-2 px-2 text-right text-sky-400 font-mono">${weight}</td>
                <td class="py-2 px-2 text-right ${riskClass}" data-weight="${strat.weight}">${riskDisplay}</td>
            `;
            tbody.appendChild(tr);
        });

        // Add event listeners to copy buttons
        tbody.querySelectorAll('.copy-risk-strat-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                // Strip .csv extension if present
                const name = btn.dataset.name.replace(/\.csv$/i, '');
                navigator.clipboard.writeText(name).then(() => {
                    // Assuming showToast is imported, if not rely on console or import it.
                    // Checking imports: showToast is NOT imported in original file view.
                    // I should check if I need to import it or if it's GLOBAL.
                    // Looking at imports: import { state } from '../state.js'; import { ... } from './strategiesTable.js';
                    // No showToast. I should assume it might fail or I should add import.
                    // Safest: Use alert or console log if showToast missing, OR add import.
                    // Given I can't easily add import in replace_file_content without context of top file, 
                    // I will check if window.showToast exists or just use console.
                    // Actually, I can rely on a console log or a simple alert for now to avoid breaking imports.
                    // OR better: The user environment likely has it.
                    // Let's try console + simple fallback visually? No, let's just run it.
                    // Wait, Step 278 showed imports:
                    // 1: import { state } from '../state.js';
                    // 2: import { ... } from './strategiesTable.js';
                    // No showToast.
                    // I will add the import in a separate step or just assume it works?
                    // No, I'll add a helper/fallback.
                    console.log('Copied:', name);
                    // Try to show toast if available globally
                    if (typeof showToast === 'function') showToast(`Copied: ${name}`, 'success');
                    else if (window.showToast) window.showToast(`Copied: ${name}`, 'success');
                });
            };
        });

        // Event Delegation for Checkboxes
        tbody.addEventListener('change', (e) => {
            if (e.target.classList.contains('risk-strategy-checkbox')) {
                const idx = parseInt(e.target.dataset.originalIndex);
                if (idx === -1 || isNaN(idx)) return;

                if (e.target.checked) {
                    selectedStrategies.add(idx);
                } else {
                    selectedStrategies.delete(idx);
                }

                // Update Main UI
                renderStrategiesTable();
                updateFloatingActionBar();
            }
        });
    }

    modal.classList.remove('hidden');
    // Trigger reflow
    void modal.offsetWidth;
    modal.classList.remove('opacity-0');
    modal.querySelector('#strategy-risk-modal-content').classList.remove('scale-95');
};
