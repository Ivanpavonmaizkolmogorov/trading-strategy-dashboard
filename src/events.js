import { dom } from './dom.js';
import { state } from './state.js';
import { runAnalysis, reAnalyzeAllData } from './analysis.js';
import { updateTradesFilesList, resetUI, renderAllCharts } from './ui.js';
import { findDatabankPortfolios, clearDatabank, savePortfolioFromDatabank, sortDatabank, updateDatabankDisplay } from './modules/databank.js';
import { openOptimizationModal, closeOptimizationModal, startOptimizationSearch } from './modules/optimization.js';
import { openViewManager, closeViewManager, applyView, saveView, deleteView } from './modules/viewManager.js';
import { exportAnalysis, importAnalysis } from './modules/importExport.js';

export function initializeEventListeners() {
    // --- Controles Principales ---
    dom.analyzeBtn.addEventListener('click', runAnalysis);
    dom.resetBtn.addEventListener('click', resetUI);

    dom.tradesFileInput.addEventListener('change', (e) => {
        const newFiles = Array.from(e.target.files);
        newFiles.forEach(newFile => {
            if (!state.loadedStrategyFiles.some(existingFile => existingFile.name === newFile.name)) {
                state.loadedStrategyFiles.push(newFile);
            }
        });
        updateTradesFilesList();
        e.target.value = ''; // Permite volver a seleccionar el mismo archivo
    });

    dom.tradesFilesListEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-file-btn')) {
            const indexToRemove = parseInt(e.target.dataset.index, 10);
            state.loadedStrategyFiles.splice(indexToRemove, 1);
            updateTradesFilesList();
        }
    });

    dom.benchmarkFileInput.addEventListener('change', () => {
        dom.benchmarkFileNameEl.textContent = dom.benchmarkFileInput.files[0]?.name || '(date, price)';
    });

    dom.analysisModeSelect.addEventListener('change', () => {
        if (!dom.resultsDiv.classList.contains('hidden')) {
            reAnalyzeAllData();
        }
    });

    dom.normalizeRiskCheckbox.addEventListener('change', (e) => {
        dom.riskNormalizationControls.classList.toggle('hidden', !e.target.checked);
        if (!dom.resultsDiv.classList.contains('hidden')) {
            reAnalyzeAllData();
        }
    });
    
    document.getElementById('target-max-dd').addEventListener('change', () => {
        if (!dom.resultsDiv.classList.contains('hidden') && dom.normalizeRiskCheckbox.checked) {
            reAnalyzeAllData();
        }
    });

    // --- Pestañas y Gráficos ---
    dom.tabNav.addEventListener('click', (e) => {
        if (e.target.matches('.tab-btn')) {
            const targetId = e.target.dataset.target;
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById(targetId).classList.add('active');
            renderAllCharts(); // Renderiza gráficos para la pestaña recién activada
        }
    });

    dom.redrawChartsBtn.addEventListener('click', () => renderAllCharts(true));

    // --- Selección de Portafolio en Tabla de Resumen ---
    dom.tabContentArea.addEventListener('change', (e) => {
        if(e.target.classList.contains('portfolio-checkbox')) {
            reAnalyzeAllData();
            // Actualizar indicador del botón de búsqueda
            const findModeIndicator = document.getElementById('find-mode-indicator');
            const hasSelection = document.querySelectorAll('.portfolio-checkbox:checked').length > 0;
            findModeIndicator.textContent = hasSelection ? '(Búsqueda de Complementos)' : '(Búsqueda Global)';
        }
    });

    // --- Portafolios Guardados ---
    dom.savedPortfoliosBody.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-portfolio-btn')) {
            const indexToRemove = parseInt(e.target.dataset.index, 10);
            if (indexToRemove === state.featuredPortfolioIndex) state.featuredPortfolioIndex = null;
            if (indexToRemove === state.comparisonPortfolioIndex) state.comparisonPortfolioIndex = null;
            state.savedPortfolios.splice(indexToRemove, 1);
            reAnalyzeAllData();
        }
        if (e.target.classList.contains('view-edit-portfolio-btn')) {
            const index = parseInt(e.target.dataset.index, 10);
            openOptimizationModal(index);
        }
        // ... (aquí irían los listeners para editar, destacar, etc.)
    });

    // --- Portafolio Destacado ---
    dom.featuredPortfolioSection.addEventListener('click', (e) => {
        if (e.target.id === 'save-comments-btn') {
            const comments = document.getElementById('portfolio-comments').value;
            state.savedPortfolios[state.featuredPortfolioIndex].comments = comments;
            const feedbackEl = document.getElementById('save-comments-feedback');
            feedbackEl.textContent = '¡Guardado!';
            setTimeout(() => { feedbackEl.textContent = ''; }, 2000);
        }
    });

    // --- DataBank ---
    dom.findDatabankPortfoliosBtn.addEventListener('click', findDatabankPortfolios);
    dom.pauseSearchBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('http://localhost:8001/databank/pause', { method: 'POST' });
            if (!response.ok) throw new Error('Error al enviar señal de pausa al backend.');
            // La UI se actualiza en base a los mensajes del stream, no aquí.
        } catch (error) {
            console.error("Error al pausar/reanudar búsqueda:", error);
        }
    });
    dom.stopSearchBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('http://localhost:8001/databank/stop', { method: 'POST' });
            if (!response.ok) throw new Error('Error al enviar señal de detención al backend.');
            // La UI se actualiza en base a los mensajes del stream, no aquí.
            // Deshabilitamos inmediatamente para evitar clics múltiples.
            dom.stopSearchBtn.disabled = true;
            dom.pauseSearchBtn.disabled = true;
        } catch (error) {
            console.error("Error al detener búsqueda:", error);
        }
    });
    dom.clearDatabankBtn.addEventListener('click', clearDatabank);

    dom.databankTableHeader.addEventListener('click', (e) => {
        const header = e.target.closest('th.sortable');
        if (header) {
            sortDatabank(header);
        }
    });

    dom.databankTableHeader.addEventListener('change', (e) => {
        if (e.target.id === 'databank-select-all') {
            const isChecked = e.target.checked;
            dom.databankTableBody.querySelectorAll('.databank-row-checkbox').forEach(cb => {
                cb.checked = isChecked;
            });
        }
    });

    dom.databankSaveSelectedBtn.addEventListener('click', () => {
        const checkboxes = dom.databankTableBody.querySelectorAll('.databank-row-checkbox:checked');
        let savedCount = 0;
        checkboxes.forEach(cb => {
            const index = parseInt(cb.dataset.index, 10);
            if (savePortfolioFromDatabank(index)) {
                savedCount++;
            }
        });
        if (savedCount > 0) {
            reAnalyzeAllData();
        }
    });
    
    dom.databankTableBody.addEventListener('click', (e) => {
        if (e.target.classList.contains('databank-save-single-btn')) {
            const index = parseInt(e.target.dataset.index, 10);
            if (savePortfolioFromDatabank(index)) {
                reAnalyzeAllData();
            }
        }
    });

    // --- Optimization Modal ---
    const optModalElements = document.getElementById('optimization-modal');
    optModalElements.querySelector('#close-optimization-modal-btn').addEventListener('click', closeOptimizationModal);
    document.getElementById('optimization-modal-backdrop').addEventListener('click', closeOptimizationModal);
    optModalElements.querySelector('#start-single-optimization-btn').addEventListener('click', startOptimizationSearch);

    // --- View Manager Modal ---
    dom.manageViewsBtn.addEventListener('click', () => openViewManager('databank'));
    dom.savedManageViewsBtn.addEventListener('click', () => openViewManager('saved'));
    dom.closeViewManagerBtn.addEventListener('click', closeViewManager);
    dom.viewManagerBackdrop.addEventListener('click', closeViewManager);
    dom.viewSelector.addEventListener('change', (e) => {
        state.activeViews.databank = e.target.value;
        updateDatabankDisplay();
    });
    dom.savedViewSelector.addEventListener('change', (e) => {
        state.activeViews.saved = e.target.value;
        reAnalyzeAllData(); // This will trigger displaySavedPortfoliosList
    });
    const viewManagerModal = document.getElementById('view-manager-modal');
    viewManagerModal.querySelector('#apply-view-btn').addEventListener('click', applyView);
    viewManagerModal.querySelector('#save-view-btn').addEventListener('click', saveView);
    viewManagerModal.querySelector('#delete-view-btn').addEventListener('click', deleteView);

    // --- Import / Export ---
    dom.exportBtn.addEventListener('click', exportAnalysis);
    dom.importFile.addEventListener('click', (e) => { e.target.value = null; }); // Permite re-importar el mismo archivo
    dom.importFile.addEventListener('change', importAnalysis);

    // --- Quick Index ---
    dom.toggleQuickIndexBtn.addEventListener('click', () => {
        dom.quickIndexContent.classList.toggle('hidden');
    });

    // --- Eventos de copia en modales y tablas ---
    document.body.addEventListener('click', (e) => {
        if (e.target.classList.contains('copyable-strategy')) {
            const textToCopy = e.target.textContent;
            navigator.clipboard.writeText(textToCopy).then(() => {
                const originalBg = e.target.style.backgroundColor;
                e.target.style.backgroundColor = '#10B981'; // green-500
                setTimeout(() => {
                    e.target.style.backgroundColor = originalBg;
                }, 500);
            }).catch(err => {
                console.error('Error al copiar al portapapeles:', err);
            });
        }
    });
}