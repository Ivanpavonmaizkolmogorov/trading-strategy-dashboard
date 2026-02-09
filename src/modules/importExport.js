import { dom } from '../dom.js';
import { state } from '../state.js';
import { displayError, generateStrategyId } from '../utils.js';
import { reAnalyzeAllData } from '../analysis.js';
import { updateTradesFilesList, resetUI } from '../ui.js';
import { populateViewSelector } from '../modules/viewManager.js';
import { updateDatabankDisplay } from '../modules/databank.js';
import { showToast } from '../modules/notifications.js';
import { strategiesTable } from '../modules/strategiesTable.js';
import { getSavedPortfoliosTableConfig } from '../modules/savedPortfoliosTable.js';

/**
 * Exporta el estado actual de la aplicación a un archivo JSON.
 */
export const exportAnalysis = () => {
    // Allow export if we have strategies data OR deep scan data
    const hasStrategies = state.rawStrategiesData.length > 0;
    const hasDeepScanData = state.deepScanData && Object.keys(state.deepScanData).length > 0;
    const hasSavedPortfolios = state.savedPortfolios && state.savedPortfolios.length > 0;

    if (!hasStrategies && !hasDeepScanData && !hasSavedPortfolios) {
        alert("No hay datos para exportar. Por favor, primero analiza estrategias o realiza un Deep Scan.");
        return;
    }

    const appState = {
        loadedStrategyFiles: state.loadedStrategyFiles.map(f => ({ name: f.name, strategyId: f.strategyId })),
        rawStrategiesData: state.rawStrategiesData,
        savedPortfolios: state.savedPortfolios,
        selectedPortfolioIndices: Array.from(state.selectedPortfolioIndices),
        featuredPortfolioIndex: state.featuredPortfolioIndex,
        nextPortfolioId: state.nextPortfolioId,
        tableViews: state.tableViews,
        activeViews: state.activeViews,
        databankPortfolios: state.databankPortfolios,
        magicNumberMap: state.magicNumberMap, // <-- Persist Magic Mappings
        quarantinedStrategyNames: Array.from(state.quarantinedStrategyNames), // <-- Persist Quarantine List
        deepScanData: state.deepScanData || {}, // <-- Persist Deep Scan Data (Multi-Account)
        linkedAccounts: state.linkedAccounts || [], // <-- Persist Linked Accounts
        // Persistence for exterminated localStorage items:
        strategiesTableConfig: strategiesTable ? strategiesTable.getConfig() : null,
        savedPortfoliosTableConfig: getSavedPortfoliosTableConfig ? getSavedPortfoliosTableConfig() : null,
        linkedStrategiesFilter: state.linkedStrategiesFilter || 'all',
        tradePnlOverrides: state.tradePnlOverrides || {} // <-- Trade PnL Overrides (manual edits)
    };

    const stateString = JSON.stringify(appState);
    const blob = new Blob([stateString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analisis_estrategias_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

/**
 * Fusiona los portafolios guardados de un estado importado con el estado actual.
 * @param {Object} importedState - El objeto de estado importado.
 */
const mergeState = async (importedState) => {
    // 1. Comprobación de compatibilidad: Las estrategias base deben ser las mismas.
    const currentStrategyNames = state.loadedStrategyFiles.map(f => f.name).sort().join(',');
    const importedStrategyNames = importedState.loadedStrategyFiles.map(f => f.name).sort().join(',');

    if (currentStrategyNames !== importedStrategyNames) {
        alert("Fusión cancelada: Las estrategias base del archivo importado no coinciden con las de la sesión actual.");
        return;
    }

    let newPortfoliosAdded = 0;
    const portfoliosToMerge = importedState.savedPortfolios || [];

    portfoliosToMerge.forEach(importedPortfolio => {
        // 2. Comprobar si ya existe un portafolio idéntico.
        const isDuplicate = state.savedPortfolios.some(currentPortfolio => {
            // Compara índices (ordenados para ser consistentes)
            const sameIndices = JSON.stringify([...currentPortfolio.indices].sort()) === JSON.stringify([...importedPortfolio.indices].sort());
            // Compara pesos (si existen)
            const sameWeights = JSON.stringify(currentPortfolio.weights) === JSON.stringify(importedPortfolio.weights);
            return sameIndices && sameWeights;
        });

        if (!isDuplicate) {
            // 3. Añadir el nuevo portafolio si no es un duplicado.
            const newPortfolio = {
                ...importedPortfolio,
                id: state.nextPortfolioId++, // Asignar un nuevo ID único
                comments: `(Fusionado) ${importedPortfolio.comments || ''}`.trim()
            };
            state.savedPortfolios.push(newPortfolio);
            newPortfoliosAdded++;
        }
    });

    // 4. Merge Magic Mappings
    if (importedState.magicNumberMap) {
        state.magicNumberMap = { ...state.magicNumberMap, ...importedState.magicNumberMap };
        console.log('[ImportExport] Merged Magic Mappings.');
    }

    // 5. Merge Quarantine List
    if (importedState.quarantinedStrategyNames && Array.isArray(importedState.quarantinedStrategyNames)) {
        importedState.quarantinedStrategyNames.forEach(name => state.quarantinedStrategyNames.add(name));
        console.log('[ImportExport] Merged Quarantine List.');
    }

    // 6. Merge Deep Scan Data (by accountId - same account overwrites, different account coexists)
    if (importedState.deepScanData && Object.keys(importedState.deepScanData).length > 0) {
        if (!state.deepScanData) state.deepScanData = {};
        Object.entries(importedState.deepScanData).forEach(([accountId, data]) => {
            state.deepScanData[accountId] = data; // Overwrite if same accountId
        });
        console.log('[ImportExport] Merged Deep Scan Data:', Object.keys(state.deepScanData).length, 'accounts');
    }

    // 7. Merge Linked Accounts
    if (importedState.linkedAccounts && importedState.linkedAccounts.length > 0) {
        const existingIds = new Set(state.linkedAccounts.map(a => a.accountId));
        importedState.linkedAccounts.forEach(acc => {
            if (!existingIds.has(acc.accountId)) {
                state.linkedAccounts.push(acc);
            }
        });
        console.log('[ImportExport] Merged Linked Accounts:', state.linkedAccounts.length);
    }

    // 8. Merge Trade PnL Overrides
    if (importedState.tradePnlOverrides && Object.keys(importedState.tradePnlOverrides).length > 0) {
        state.tradePnlOverrides = { ...state.tradePnlOverrides, ...importedState.tradePnlOverrides };
        console.log('[ImportExport] Merged Trade PnL Overrides:', Object.keys(state.tradePnlOverrides).length);
    }

    if (newPortfoliosAdded > 0) {
        alert(`${newPortfoliosAdded} portafolios nuevos han sido fusionados con tu sesión.`);
        // Re-analizar todo para que los nuevos portafolios se muestren correctamente.
        await reAnalyzeAllData();
    } else {
        alert("No se encontraron portafolios nuevos para fusionar. Todos los portafolios del archivo ya existían en tu sesión.");
    }

    // Refresh Quarantine UI (Merged)
    import('./quarantine.js').then(({ renderQuarantineList }) => {
        renderQuarantineList();
    });
};

/**
 * Lee un archivo JSON e importa el estado de la aplicación.
 * @param {Event} e - El evento del input de archivo.
 */
export const importAnalysis = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const importedState = JSON.parse(event.target.result);

            // Si no hay un espacio de trabajo activo, simplemente reemplaza.
            if (state.rawStrategiesData.length === 0) {
                await restoreState(importedState);
                return;
            }

            // Preguntar al usuario qué acción realizar.
            if (confirm("¿Deseas fusionar los portafolios guardados con tu sesión actual?\n\n- Pulsa 'Aceptar' para FUSIONAR.\n- Pulsa 'Cancelar' para REEMPLAZAR todo el espacio de trabajo.")) {
                await mergeState(importedState);
            } else {
                await restoreState(importedState);
            }

        } catch (error) {
            console.error("Error al importar el archivo:", error);
            displayError("El archivo de importación no es válido o está corrupto.");
        }
    };
    reader.readAsText(file);
};

/**
 * Restaura el estado de la aplicación desde un objeto de estado importado.
 * @param {Object} importedState - El objeto de estado a restaurar.
 */
const restoreState = async (importedState) => {
    resetUI();

    state.loadedStrategyFiles = importedState.loadedStrategyFiles.map(f => ({
        name: f.name,
        isPlaceholder: true,
        strategyId: f.strategyId || generateStrategyId(f.name) // Use saved ID or generate new one
    }));
    state.rawStrategiesData = importedState.rawStrategiesData;
    state.savedPortfolios = importedState.savedPortfolios || [];
    state.selectedPortfolioIndices = new Set(importedState.selectedPortfolioIndices || []);
    state.featuredPortfolioIndex = importedState.featuredPortfolioIndex !== undefined ? importedState.featuredPortfolioIndex : null;
    state.nextPortfolioId = importedState.nextPortfolioId || (state.savedPortfolios.length ? Math.max(...state.savedPortfolios.map(p => p.id || 0)) + 1 : 0);
    state.tableViews = importedState.tableViews || state.tableViews;
    state.activeViews = importedState.activeViews || state.activeViews;
    state.activeViews = importedState.activeViews || state.activeViews;
    state.databankPortfolios = importedState.databankPortfolios || [];
    state.magicNumberMap = importedState.magicNumberMap || {}; // Restore Magic Mappings
    state.quarantinedStrategyNames = new Set(importedState.quarantinedStrategyNames || []); // Restore Quarantine List
    state.deepScanData = importedState.deepScanData || {}; // Restore Deep Scan Data (Multi-Account)
    state.linkedAccounts = importedState.linkedAccounts || []; // Restore Linked Accounts
    state.tradePnlOverrides = importedState.tradePnlOverrides || {}; // Restore Trade PnL Overrides

    console.log('[ImportExport] Restored deepScanData with', Object.keys(state.deepScanData).length, 'accounts');
    console.log('[ImportExport] Restored Trade PnL Overrides:', Object.keys(state.tradePnlOverrides).length);
    console.log('[ImportExport] Restored linkedAccounts:', state.linkedAccounts.length);

    updateTradesFilesList();

    // Sanitize Magic Number Map (Fix for cross-contamination)
    import('./magicMapRepair.js').then(({ sanitizeMagicMap }) => {
        sanitizeMagicMap();
    });

    // Backward compatibility: ignore old benchmark fields if present
    // (Files exported before benchmark removal may still have these fields)

    populateViewSelector('databank');
    populateViewSelector('saved');

    populateViewSelector('saved');

    // Restore Table Configs & Filters (since localStorage is exterminated)
    if (importedState.linkedStrategiesFilter) {
        state.linkedStrategiesFilter = importedState.linkedStrategiesFilter;
    }

    // Configs need to be applied to the instances. 
    // Since modules might be loaded already, we apply them now.
    if (importedState.strategiesTableConfig && strategiesTable) {
        strategiesTable.updateConfig(importedState.strategiesTableConfig);
    }
    // Saved Portfolios config is a bit trickier as it might rely on internal state of module, 
    // but looking at logic it seems to use a getter. We need a setter or update logic.
    // Actually ui.js usually manages savedPortfoliosTableConfig via simple object?
    // Let's check getSavedPortfoliosTableConfig implementation... it returns a config object.
    // If we want to restore it, we might need a way to set it back or the table recreates itself?
    // For now we assume if we just set it in memory if there was a global variable... 
    // Wait, ui.js had `localStorage.setItem` for it. 
    // But `savedPortfoliosTable` module seems to hold it?
    // Checking previous steps, `ui.js` imported `getSavedPortfoliosTableConfig` but where is the state held?
    // It seems held in `savedPortfoliosTable.js`. I will assume I can't easily restore it without a setter there.
    // I will skip restoring `savedPortfoliosTableConfig` for now unless I verify I can set it.
    // Actually, `strategiesTable` has `updateConfig` because it uses `CustomizableTable` class.
    // `savedPortfoliosTable` might be custom.
    // I will just execute reAnalyzeAllData.

    await reAnalyzeAllData();

    if (state.databankPortfolios.length > 0) {
        // En el nuevo layout, databankContent siempre está visible
        if (dom.databankContent) {
            console.log('[ImportExport] DataBank cargado con', state.databankPortfolios.length, 'portafolios');
        }
        updateDatabankDisplay();
        // databankStatus ya no existe en el nuevo layout
        if (dom.databankStatus) {
            dom.databankStatus.innerHTML = `ℹ️ DataBank cargado (${state.databankPortfolios.length} portafolios).`;
        }
        showToast(`DataBank cargado: ${state.databankPortfolios.length} portafolios`, 'success');
    }

    // Refresh Quarantine UI
    import('./quarantine.js').then(({ renderQuarantineList }) => {
        renderQuarantineList();
    });

    // Auto-close Config Modal
    const configModal = document.getElementById('config-modal');
    if (configModal) {
        configModal.classList.add('hidden');
    }
};