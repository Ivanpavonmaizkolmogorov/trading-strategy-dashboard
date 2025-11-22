import { dom } from './dom.js';
import { state } from './state.js';
import { runAnalysis, reAnalyzeAllData, sortSummaryTable, sortSavedPortfoliosTable } from './analysis.js';
import { updateTradesFilesList, resetUI, renderAllCharts, closeChartClickModal } from './ui.js';
import { findDatabankPortfolios, clearDatabank, savePortfolioFromDatabank, sortDatabank, updateDatabankDisplay } from './modules/databank.js';
import { openOptimizationModal, closeOptimizationModal, startOptimizationSearch, reevaluateOptimizationResults } from './modules/optimization.js';
import { openViewManager, closeViewManager, applyView, saveView, deleteView } from './modules/viewManager.js';
import { exportAnalysis, importAnalysis } from './modules/importExport.js';
import { showToast } from './modules/notifications.js';
import { initializeLayout } from './modules/layout.js'; // <-- NUEVO

export function initializeEventListeners() {
    // Inicializar el nuevo Layout (Sidebar, Tabs, Resizer)
    initializeLayout();

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

    // --- NUEVO: Listener para el botón de Aplicar Normalización ---
    const applyNormalizationBtn = document.getElementById('apply-normalization-btn');
    if (applyNormalizationBtn) {
        applyNormalizationBtn.addEventListener('click', () => {
            // Forzamos el check del checkbox oculto para mantener compatibilidad con analysis.js
            // O mejor, actualizamos analysis.js para no depender del checkbox.
            // Por ahora, usaremos el checkbox oculto como "estado de verdad" si queremos persistencia simple,
            // pero la lógica de "Aplicar" implica que el usuario quiere ejecutar AHORA.

            // Vamos a marcar el checkbox oculto como true si se aplica, para que reAnalyzeAllData sepa que debe normalizar.
            // Si el usuario quisiera "Desactivar", necesitaríamos un botón de desactivar o toggle.
            // Asumimos que "Aplicar" activa la normalización con los parámetros dados.

            // Sin embargo, el usuario podría querer desactivarla.
            // El diseño actual es un panel siempre visible.
            // Vamos a asumir que si el usuario hace clic en "Aplicar", quiere normalizar.
            // Para desactivar, quizás deberíamos tener un botón "Resetear" o "Desactivar".
            // Por simplicidad y siguiendo el prompt: "normalizar preo k previamente haya podido configurar parametros".
            // Vamos a usar el checkbox oculto para indicar si está activo o no.

            dom.normalizeRiskCheckbox.checked = true;
            reAnalyzeAllData();
        });
    }

    // --- NUEVO: Listener para el botón de Restaurar Normalización ---
    const restoreNormalizationBtn = document.getElementById('restore-normalization-btn');
    if (restoreNormalizationBtn) {
        restoreNormalizationBtn.addEventListener('click', () => {
            dom.normalizeRiskCheckbox.checked = false;

            // --- CORRECCIÓN: Forzar recálculo desde cero ---
            // Borramos las métricas cacheadas para que reAnalyzeAllData las vuelva a calcular
            // usando las estrategias originales (rawStrategiesData).
            state.savedPortfolios.forEach(p => {
                delete p.metrics;
                delete p.analysis;
            });

            reAnalyzeAllData();
            showToast('Valores originales restaurados (recalculando...)', 'info');
        });
    }

    // Listener antiguo eliminado o comentado
    /*
    dom.normalizeRiskCheckbox.addEventListener('change', (e) => {
        dom.riskNormalizationControls.classList.toggle('hidden', !e.target.checked);
        if (!dom.resultsDiv.classList.contains('hidden')) {
            reAnalyzeAllData();
        }
    });
    */

    /**
     * Sincroniza un input de tipo 'range' (slider) con un input de tipo 'number'.
     * @param {HTMLInputElement} sliderEl - El elemento del slider.
     * @param {HTMLInputElement} numberEl - El elemento del input numérico.
     * @param {Function} onCommit - La función a llamar cuando el valor se confirma (evento 'change').
     */
    const setupSyncedSlider = (sliderEl, numberEl, onCommit) => {
        const syncValues = (source) => {
            const value = parseFloat(source.value);
            if (source.type === 'number' && value > parseFloat(sliderEl.max)) {
                sliderEl.max = value;
            }
            sliderEl.value = value;
            numberEl.value = value;
        }
        sliderEl.addEventListener('input', () => syncValues(sliderEl));
        numberEl.addEventListener('input', () => syncValues(numberEl));
        sliderEl.addEventListener('change', onCommit);
        numberEl.addEventListener('change', onCommit);
    };

    // Sincronizar controles de Normalización de Riesgo Global
    // El slider fue eliminado en la nueva UI, así que solo mantenemos el input.
    // No necesitamos sincronización.
    /*
    setupSyncedSlider(dom.targetMaxDDSlider, dom.targetMaxDDInput, () => {
        // Ahora solo actualiza el input visualmente, el usuario debe dar a "Aplicar".
    });
    */

    // --- Pestañas y Gráficos (OBSOLETO - Reemplazado por layout.js) ---
    /*
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
        if (e.target.classList.contains('portfolio-checkbox')) {
            reAnalyzeAllData();
            // Actualizar indicador del botón de búsqueda
            const findModeIndicator = document.getElementById('find-mode-indicator');
            const hasSelection = document.querySelectorAll('.portfolio-checkbox:checked').length > 0;
            findModeIndicator.textContent = hasSelection ? '(Búsqueda de Complementos)' : '(Búsqueda Global)';
        }
    });
    */

    // --- CORREGIDO: Listener para ordenar la tabla de Resumen usando delegación ---
    // --- CORREGIDO: Listener para ordenar la tabla de Resumen (DataBank) ---
    // Usamos el nuevo contenedor del DataBank
    if (dom.databankContent) {
        dom.databankContent.addEventListener('click', (e) => {
            const header = e.target.closest('#databank-table-header th.sortable');
            if (header) {
                console.log('-> Clic detectado en cabecera de DataBank:', header.dataset.column);
                sortSummaryTable(header);
            }
        });
    }


    // --- Portafolios Guardados ---
    // Usamos el contenedor principal de la sección para delegar todos los eventos
    // --- Portafolios Guardados ---
    // Usamos el nuevo contenedor de Portafolios Guardados
    if (dom.savedPortfoliosContent) {
        dom.savedPortfoliosContent.addEventListener('click', async (e) => {
            // Listener para ordenar
            const header = e.target.closest('#saved-portfolios-header th.sortable');
            if (header) {
                console.log('-> Clic detectado en cabecera de Portafolios Guardados:', header.dataset.sortKey);
                sortSavedPortfoliosTable(header);
                console.log('<- Función sortSavedPortfoliosTable llamada.');
            }

            if (e.target.classList.contains('delete-portfolio-btn')) {
                const indexToRemove = parseInt(e.target.dataset.index, 10);
                if (indexToRemove === state.featuredPortfolioIndex) state.featuredPortfolioIndex = null;
                if (indexToRemove === state.comparisonPortfolioIndex) state.comparisonPortfolioIndex = null;
                state.savedPortfolios.splice(indexToRemove, 1);
                // --- OPTIMIZACIÓN: Actualizar UI localmente sin llamar al backend ---
                displaySavedPortfoliosList();
                renderPortfolioComparisonCharts(window.analysisResults.filter(r => r.isSavedPortfolio && !r.isTemporaryOriginal));
                showToast('Portafolio eliminado correctamente', 'success');
                // await reAnalyzeAllData(); // <-- ELIMINADO: Innecesario
            }
            if (e.target.classList.contains('view-edit-portfolio-btn')) {
                const index = parseInt(e.target.dataset.index, 10);
                openOptimizationModal(index);
            }
            // --- CORRECCIÓN: Añadir el listener para el botón de destacar (estrella) ---
            if (e.target.classList.contains('feature-portfolio-btn')) {
                const index = parseInt(e.target.dataset.index, 10);
                // Si ya está destacado, quitar el destaque. Si no, establecerlo.
                state.featuredPortfolioIndex = state.featuredPortfolioIndex === index ? null : index;

                // --- OPTIMIZACIÓN: Actualizar UI localmente sin llamar al backend ---
                renderFeaturedPortfolio();
                displaySavedPortfoliosList(); // Actualiza la estrella en la lista
                renderPortfolioComparisonCharts(window.analysisResults.filter(r => r.isSavedPortfolio && !r.isTemporaryOriginal));

                if (state.featuredPortfolioIndex !== null) {
                    showToast('Portafolio destacado actualizado', 'success');
                } else {
                    showToast('Portafolio ya no está destacado', 'info');
                }

                // await reAnalyzeAllData(); // <-- ELIMINADO: Innecesario
            }
        });

        // --- Portafolio Destacado ---
        // --- Portafolio Destacado (OBSOLETO - Reemplazado por Visor) ---
        if (dom.featuredPortfolioSection) {
            dom.featuredPortfolioSection.addEventListener('click', (e) => {
                if (e.target.id === 'save-comments-btn') {
                    const comments = document.getElementById('portfolio-comments').value;
                    state.savedPortfolios[state.featuredPortfolioIndex].comments = comments;
                    const feedbackEl = document.getElementById('save-comments-feedback');
                    feedbackEl.textContent = '¡Guardado!';
                    setTimeout(() => { feedbackEl.textContent = ''; }, 2000);
                    showToast('Comentarios guardados', 'success');
                }
            });
        }

        // --- DataBank ---
        dom.findDatabankPortfoliosBtn.addEventListener('click', findDatabankPortfolios);
        dom.pauseSearchBtn.addEventListener('click', async () => {
            try {
                const response = await fetch('/databank/pause', { method: 'POST' });
                if (!response.ok) throw new Error('Error al enviar señal de pausa al backend.');
                // La UI se actualiza en base a los mensajes del stream, no aquí.
            } catch (error) {
                console.error("Error al pausar/reanudar búsqueda:", error);
            }
        });
        dom.stopSearchBtn.addEventListener('click', async () => {
            try {
                const response = await fetch('/databank/stop', { method: 'POST' });
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
                const portfolioData = state.databankPortfolios[index];
                if (portfolioData && savePortfolioFromDatabank(index, portfolioData.metrics)) {
                    savedCount++;
                }
            });
            if (savedCount > 0) {
                // --- OPTIMIZACIÓN: Solo re-analizar si faltan métricas (raro desde Databank) ---
                // savePortfolioFromDatabank ya adjunta las métricas si existen.
                // Verificamos si algún portafolio guardado recientemente NO tiene métricas.
                const needsAnalysis = state.savedPortfolios.some(p => !p.metrics);
                if (needsAnalysis) {
                    reAnalyzeAllData();
                } else {
                    displaySavedPortfoliosList();
                    // No necesitamos actualizar gráficos comparativos aquí, el usuario puede hacerlo manualmente si quiere
                }
                showToast(`${savedCount} portafolios guardados`, 'success');
            }
        });

        dom.databankTableBody.addEventListener('click', (e) => {
            if (e.target.classList.contains('databank-save-single-btn')) {
                const index = parseInt(e.target.dataset.index, 10);
                const portfolioData = state.databankPortfolios[index];
                if (portfolioData && savePortfolioFromDatabank(index, portfolioData.metrics)) {
                    // --- OPTIMIZACIÓN: Igual que arriba ---
                    const needsAnalysis = state.savedPortfolios.some(p => !p.metrics);
                    if (needsAnalysis) {
                        reAnalyzeAllData();
                    } else {
                        displaySavedPortfoliosList();
                    }
                    showToast('Portafolio guardado', 'success');
                }
            }
        });

        // --- Optimization Modal (Hidden for now) ---
        const optModalElements = document.getElementById('optimization-modal');
        if (optModalElements) {
            const closeBtn = optModalElements.querySelector('#close-optimization-modal-btn');
            const backdrop = document.getElementById('optimization-modal-backdrop');
            if (closeBtn) closeBtn.addEventListener('click', closeOptimizationModal);
            if (backdrop) backdrop.addEventListener('click', closeOptimizationModal);
            // El listener para 'start-single-optimization-btn' se ha movido a optimization.js

            // --- NUEVO: Eventos para el escalado de riesgo en el modal de optimización ---
            const scaleRiskCheckbox = optModalElements.querySelector('#optimization-scale-risk-checkbox');
            const targetMaxDDInput = optModalElements.querySelector('#optimization-target-max-dd');
            const targetMaxDDSlider = optModalElements.querySelector('#optimization-target-max-dd-slider');

            if (scaleRiskCheckbox && targetMaxDDInput) {
                scaleRiskCheckbox.addEventListener('change', (e) => { targetMaxDDInput.parentElement.classList.toggle('hidden', !e.target.checked); reevaluateOptimizationResults(); });
            }
            if (targetMaxDDSlider && targetMaxDDInput) {
                setupSyncedSlider(targetMaxDDSlider, targetMaxDDInput, reevaluateOptimizationResults);
            }
        }


        // --- View Manager (Hidden for now) ---
        if (dom.manageViewsBtn) dom.manageViewsBtn.addEventListener('click', () => openViewManager('databank'));
        if (dom.savedManageViewsBtn) dom.savedManageViewsBtn.addEventListener('click', () => openViewManager('saved'));
        if (dom.closeViewManagerBtn) dom.closeViewManagerBtn.addEventListener('click', closeViewManager);
        if (dom.viewManagerBackdrop) dom.viewManagerBackdrop.addEventListener('click', closeViewManager);
        if (dom.viewSelector) {
            dom.viewSelector.addEventListener('change', (e) => {
                const selectedView = viewsState.databankViews.find(v => v.name === e.target.value);
                viewsState.currentView = selectedView || null;
            });
        }
        if (dom.savedViewSelector) {
            dom.savedViewSelector.addEventListener('change', (e) => {
                const selectedView = viewsState.savedPortfoliosViews.find(v => v.name === e.target.value);
                viewsState.currentSavedView = selectedView || null;
            });
        }

        const viewManagerModal = dom.viewManagerModal;
        if (viewManagerModal) {
            const applyBtn = viewManagerModal.querySelector('#apply-view-btn');
            const saveBtn = viewManagerModal.querySelector('#save-view-btn');
            const deleteBtn = viewManagerModal.querySelector('#delete-view-btn');
            if (applyBtn) applyBtn.addEventListener('click', applyView);
            if (saveBtn) saveBtn.addEventListener('click', saveView);
            if (deleteBtn) deleteBtn.addEventListener('click', deleteView);
        }

        // --- Import / Export ---
        dom.exportBtn.addEventListener('click', exportAnalysis);
        dom.importFile.addEventListener('click', (e) => { e.target.value = null; }); // Permite re-importar el mismo archivo
        dom.importFile.addEventListener('change', importAnalysis);

        // --- Quick Index (Hidden for now) ---
        if (dom.toggleQuickIndexBtn) {
            dom.toggleQuickIndexBtn.addEventListener('click', () => {
                dom.quickIndexContent.classList.toggle('hidden');
            });
        }

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

        // --- NUEVO: Eventos para los botones de acción del gráfico comparativo ---
        const chartActionsGroup = document.getElementById('chart-actions-group');
        if (chartActionsGroup) {
            chartActionsGroup.addEventListener('click', (e) => {
                if (e.target.classList.contains('chart-action-item')) {
                    chartActionsGroup.querySelectorAll('.chart-action-item').forEach(btn => btn.classList.remove('active'));
                    e.target.classList.add('active');
                }
            });
        }

        // --- NUEVO: Eventos para el modal de confirmación del gráfico ---
        const chartClickModal = document.getElementById('chart-click-modal');
        if (chartClickModal) {
            const cancelBtn = chartClickModal.querySelector('#chart-click-cancel-btn');
            const backdrop = chartClickModal.querySelector('#chart-click-modal-backdrop');
            if (cancelBtn) cancelBtn.addEventListener('click', closeChartClickModal);
            if (backdrop) backdrop.addEventListener('click', closeChartClickModal);
        }
    }
} // Cierre de initializeEventListeners