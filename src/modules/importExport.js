import { dom } from '../dom.js';
import { state } from '../state.js';
import { displayError } from '../utils.js';
import { reAnalyzeAllData } from '../analysis.js';
import { updateTradesFilesList, resetUI } from '../ui.js';
import { populateViewSelector } from '../modules/viewManager.js';
import { updateDatabankDisplay } from '../modules/databank.js';

/**
 * Exporta el estado actual de la aplicación a un archivo JSON.
 */
export const exportAnalysis = () => {
    if (state.rawStrategiesData.length === 0) {
        alert("No hay datos para exportar. Por favor, primero analiza las estrategias.");
        return;
    }

    const appState = {
        loadedStrategyFiles: state.loadedStrategyFiles.map(f => ({ name: f.name })),
        benchmarkFileName: dom.benchmarkFileInput.files[0]?.name || null,
        rawStrategiesData: state.rawStrategiesData,
        rawBenchmarkData: state.rawBenchmarkData,
        savedPortfolios: state.savedPortfolios,
        selectedPortfolioIndices: Array.from(state.selectedPortfolioIndices),
        featuredPortfolioIndex: state.featuredPortfolioIndex,
        nextPortfolioId: state.nextPortfolioId,
        tableViews: state.tableViews,
        activeViews: state.activeViews,
        databankPortfolios: state.databankPortfolios,
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

    if (newPortfoliosAdded > 0) {
        alert(`${newPortfoliosAdded} portafolios nuevos han sido fusionados con tu sesión.`);
        // Re-analizar todo para que los nuevos portafolios se muestren correctamente.
        await reAnalyzeAllData();
    } else {
        alert("No se encontraron portafolios nuevos para fusionar. Todos los portafolios del archivo ya existían en tu sesión.");
    }
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

    state.loadedStrategyFiles = importedState.loadedStrategyFiles.map(f => ({ name: f.name, isPlaceholder: true }));
    state.rawStrategiesData = importedState.rawStrategiesData;
    state.rawBenchmarkData = importedState.rawBenchmarkData;
    state.savedPortfolios = importedState.savedPortfolios || [];
    state.selectedPortfolioIndices = new Set(importedState.selectedPortfolioIndices || []);
    state.featuredPortfolioIndex = importedState.featuredPortfolioIndex !== undefined ? importedState.featuredPortfolioIndex : null;
    state.nextPortfolioId = importedState.nextPortfolioId || (state.savedPortfolios.length ? Math.max(...state.savedPortfolios.map(p => p.id || 0)) + 1 : 0);
    state.tableViews = importedState.tableViews || state.tableViews;
    state.activeViews = importedState.activeViews || state.activeViews;
    state.databankPortfolios = importedState.databankPortfolios || [];

    updateTradesFilesList();
    dom.benchmarkFileNameEl.textContent = importedState.benchmarkFileName || '(date, price)';
    populateViewSelector('databank');
    populateViewSelector('saved');

    await reAnalyzeAllData();

    if (state.databankPortfolios.length > 0) {
        dom.databankSection.classList.remove('hidden');
        updateDatabankDisplay();
        dom.databankStatus.innerHTML = `ℹ️ DataBank cargado (${state.databankPortfolios.length} portafolios).`;
    }
};