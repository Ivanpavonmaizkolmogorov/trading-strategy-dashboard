
import { wizardState } from './searchConfig.js';
import { state } from '../state.js';
import { showToast } from './notifications.js';

export const saveSearchHistory = async (name, config, baseStrategies, objective) => {
    try {
        const payload = {
            name: name || `Search ${new Date().toLocaleString()}`,
            timestamp: new Date().toISOString(),
            config: config,
            base_strategies: baseStrategies.map(s => s.name), // Save names for adaptability
            objective: objective
        };

        const response = await fetch('/history/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Failed to save history');
        console.log('[SearchHistory] Configuration saved.');
    } catch (e) {
        console.error('[SearchHistory] Save failed:', e);
    }
};

export const fetchSearchHistory = async () => {
    try {
        const response = await fetch('/history/list');
        if (!response.ok) return [];
        return await response.json();
    } catch (e) {
        console.error('[SearchHistory] Fetch failed:', e);
        return [];
    }
};

export const renderSearchHistory = async () => {
    const container = document.getElementById('engines-list-container');
    if (!container) return;

    container.innerHTML = '<div class="flex justify-center p-10"><div class="animate-spin text-4xl">🔄</div></div>';

    const history = await fetchSearchHistory();

    if (!history || history.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full text-gray-500 opacity-50">
                <span class="text-6xl mb-4">🚂</span>
                <p class="text-xl">No hay historial de búsquedas.</p>
                <p class="text-sm">Ejecuta una búsqueda en el DataBank para verla aquí.</p>
            </div>`;
        return;
    }

    let html = '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">';

    history.forEach((item, index) => {
        const date = new Date(item.timestamp).toLocaleString();
        const baseCount = item.base_strategies ? item.base_strategies.length : 0;

        // Metrics Summary
        const goalIcon = item.config.goal === 'maximize' ? '📈' : '📉';
        const metricName = item.config.metric || 'Sharpe';

        html += `
            <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-sky-500 transition-colors flex flex-col shadow-lg">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <h3 class="font-bold text-sky-400 text-sm">${item.name || 'Búsqueda s/n'}</h3>
                        <p class="text-[10px] text-gray-500">${date}</p>
                    </div>
                    <span class="text-xs bg-gray-700 px-2 py-1 rounded border border-gray-600">${item.objective.toUpperCase()}</span>
                </div>
                
                <div class="flex-1 space-y-2 my-2 text-xs text-gray-300 bg-gray-900/50 p-2 rounded">
                    <div class="flex justify-between">
                        <span>Estrategias Base:</span>
                        <span class="font-mono text-white">${baseCount}</span>
                    </div>
                    <div class="flex justify-between">
                        <span>Objetivo:</span>
                        <span class="font-mono text-amber-400">${goalIcon} ${metricName}</span>
                    </div>
                    <div class="flex justify-between">
                        <span>Tamaño:</span>
                        <span class="font-mono text-white">${item.config.minSize} - ${item.config.maxSize}</span>
                    </div>
                    ${item.config.correlationThreshold ? `
                    <div class="flex justify-between">
                         <span>Corr. Max:</span>
                         <span class="font-mono text-red-300">${item.config.correlationThreshold}</span>
                    </div>` : ''}
                </div>

                <button class="btn-rerun-search w-full mt-2 bg-sky-600 hover:bg-sky-500 text-white font-bold py-2 px-4 rounded text-xs flex items-center justify-center gap-2 transition-transform hover:scale-105"
                    data-json='${JSON.stringify(item).replace(/'/g, "&apos;")}'>
                    <span>▶️</span> Ejecutar / Cargar
                </button>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;

    // Attach Listeners
    container.querySelectorAll('.btn-rerun-search').forEach(btn => {
        btn.onclick = () => {
            const data = JSON.parse(btn.dataset.json);
            loadAndRunEngine(data);
        };
    });
};

const loadAndRunEngine = async (data) => {
    // 1. Load Config
    // Import searchConfig dynamically if needed, but we imported `wizardState` at top.

    // Restore Config
    Object.assign(wizardState.config, data.config);
    wizardState.objective = data.objective;

    // 2. Map Base Strategies
    // We have names, we need to find current indices in state.loadedStrategyFiles
    wizardState.baseStrategies = [];
    const missing = [];

    if (data.base_strategies && data.base_strategies.length > 0) {
        data.base_strategies.forEach(name => {
            const found = state.loadedStrategyFiles.find(f => f.name === name);
            if (found) {
                // We need 'originalIndex' for wizardState mapping
                const index = state.loadedStrategyFiles.indexOf(found);
                wizardState.baseStrategies.push({
                    name: found.name,
                    index: index, // Used by wizard UI
                    originalIndex: index,
                    checked: true
                });
            } else {
                missing.push(name);
            }
        });
    }

    // 3. Notify adaptation
    if (missing.length > 0) {
        showToast(`Adaptando: ${missing.length} estrategias originales no encontradas.`, 'warning');
    } else {
        showToast('Configuración cargada. Estrategias mapeadas 100%.', 'success');
    }

    // 4. Open Wizard at Step 3 (Confirmation/Params)
    // We import openSearchConfigModal to trigger the flow
    const { openSearchConfigModal } = await import('./searchConfig.js');

    // Set step to 3 to verify params
    // But openSearchConfigModal initializes wizard state... 
    // We might need to manually set step AFTER opening?
    // openSearchConfigModal resets wizardState? Let's check searchConfig.js
    // If it resets, we lose our assignments.

    // Looking at searchConfig.js: 
    // export const openSearchConfigModal = (preSelectedIndices = []) => { ... wizardState = deepClone(DEFAULT_STATE); ... }
    // It RESETS state.

    // So we need a way to open it WITH state.
    // Or we modify openSearchConfigModal to accept a full state object?
    // Or we just update the UI state after opening?

    openSearchConfigModal();

    // Wait for modal to init then override state
    // Wait for modal to init then override state
    setTimeout(async () => {
        Object.assign(wizardState.config, data.config);
        wizardState.objective = data.objective;

        // Re-apply base strategies
        wizardState.step = 3;

        const allStrategies = state.loadedStrategyFiles.map((f, i) => ({
            name: f.name,
            index: i,
            originalIndex: i,
            checked: false
        }));

        if (data.base_strategies) {
            data.base_strategies.forEach(name => {
                const s = allStrategies.find(x => x.name === name);
                if (s) s.checked = true;
            });
        }

        wizardState.baseStrategies = allStrategies;

        // Render
        const { renderWizard } = await import('./searchConfig.js');
        renderWizard();

        showToast('Motor cargado. Revisa y pulsa Ejecutar.', 'info');

    }, 200);
};

export const initSearchHistory = () => {
    // Nav Button
    const navBtn = document.getElementById('nav-engines');
    if (navBtn) {
        navBtn.addEventListener('click', () => {
            // Manual Switch View logic for now (could ideally use layout.switchView if exported)
            // Just hide others and show engines-view
            document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
            navBtn.classList.add('active');

            ['#live-monitor-view', 'main', '#main-header'].forEach(sel => {
                const el = document.querySelector(sel);
                if (el) el.classList.add('hidden');
            });

            // Show Engines
            const view = document.getElementById('engines-view');
            if (view) {
                view.classList.remove('hidden');
                renderSearchHistory();
            }
        });
    }

    // Refresh Button
    const refreshBtn = document.getElementById('engines-refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', renderSearchHistory);
};

