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
    a.download = `analisis_estrategias_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

/**
 * Lee un archivo JSON e importa el estado de la aplicación.
 * @param {Event} e - El evento del input de archivo.
 */
export const importAnalysis = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const importedState = JSON.parse(event.target.result);
            restoreState(importedState);
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
const restoreState = (importedState) => {
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
    
    reAnalyzeAllData();

    if (state.databankPortfolios.length > 0) {
        dom.databankSection.classList.remove('hidden');
        updateDatabankDisplay();
        dom.databankStatus.innerHTML = `ℹ️ DataBank cargado (${state.databankPortfolios.length} portafolios).`;
    }
};