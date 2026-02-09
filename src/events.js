import { dom } from './dom.js';
import { state, saveSavedPortfolios } from './state.js';
import { runAnalysis, reAnalyzeAllData, sortSummaryTable, sortSavedPortfoliosTable } from './analysis.js';
import { updateTradesFilesList, resetUI, renderAllCharts, closeChartClickModal, switchViewMode, renderStrategiesTable } from './ui.js';
import { findDatabankPortfolios, stopDatabankSearch, clearDatabank, savePortfolioFromDatabank, sortDatabank, updateDatabankDisplay, openPurgeModal } from './modules/databank.js';
import { openOptimizationModal, closeOptimizationModal, startOptimizationSearch, reevaluateOptimizationResults } from './modules/optimization.js';
import { openViewManager, closeViewManager, applyView, saveView, deleteView } from './modules/viewManager.js';
import { exportAnalysis, importAnalysis } from './modules/importExport.js';
import { showToast } from './modules/notifications.js';
import { initializeLayout } from './modules/layout.js'; // <-- NUEVO
import { initMyfxbookUI, openMyfxbookModal, refreshAllAccounts } from './modules/myfxbookUI.js'; // <-- MYFXBOOK
import { generateStrategyId, generatePortfolioId } from './utils.js'; // <-- ID GENERATOR
import { initLiveMonitor, renderLiveMonitor } from './modules/liveMonitor.js'; // <-- LIVE MONITOR
import { openSlaveAccountsModal } from './modules/slaveAccounts.js'; // <-- SLAVE ACCOUNTS
import { openStrategyRiskModal } from './modules/strategyRiskViewer.js'; // <-- STRATEGY RISK VIEWER
import { focusMode } from './modules/focusMode.js'; // <-- FOCUS MODE

export function initializeEventListeners() {
    // --- SANITIZATION: Check for duplicate IDs in saved portfolios ---
    if (state.savedPortfolios && state.savedPortfolios.length > 0) {
        const idMap = new Map();
        let fixedCount = 0;
        state.savedPortfolios.forEach(p => {
            if (idMap.has(p.id)) {
                // Duplicate found! Regenerate ID
                const oldId = p.id;
                p.id = generatePortfolioId(p.name, p.strategyIds || p.indices);
                console.warn(`[Events] Duplicate ID found (${oldId}) for portfolio "${p.name}". Regenerated to: ${p.id}`);
                fixedCount++;
            } else {
                idMap.set(p.id, true);
            }
        });
        if (fixedCount > 0) {
            saveSavedPortfolios();
            console.log(`[Events] Fixed ${fixedCount} duplicate portfolio IDs.`);
        }
    }

    // Inicializar el nuevo Layout (Sidebar, Tabs, Resizer)
    initializeLayout();

    // Inicializar Myfxbook UI
    initMyfxbookUI();

    // --- Live Monitor Navigation ---
    initLiveMonitor();

    // --- NUEVO: Search Engines / History ---
    import('./modules/searchHistory.js').then(({ initSearchHistory }) => initSearchHistory());


    // --- Stagnation Mode Controls ---
    const stagnationRadios = document.querySelectorAll('input[name="stagnation-mode"]');
    console.log(`[Events] Found ${stagnationRadios.length} stagnation radio buttons.`);
    stagnationRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            console.log(`[Events] Stagnation Radio changed: ${e.target.value}`);
            if (e.target.checked) {
                state.stagnationMode = e.target.value;
                console.log(`[Events] State updated. Mode: ${state.stagnationMode}`);

                if (state.activeViewMode === 'reality-check') {
                    // Refresh Charts and Table
                    if (window.analysisResults) {
                        switchViewMode('reality-check'); // Re-trigger view mode switch to refresh charts
                    }
                    if (state.activeTab === 'saved-portfolios') {
                        displaySavedPortfoliosList();
                    } else {
                        renderStrategiesTable();
                    }
                }
            }
        });
    });

    const navMonitor = document.getElementById('nav-monitor');
    const liveMonitorView = document.getElementById('live-monitor-view');
    const mainHeader = document.getElementById('main-header');
    const mainContent = document.querySelector('main');

    /* CONFLICTING LISTENER REMOVED - Handled in layout.js with Sandbox Iframe
    if (navMonitor && liveMonitorView) {
        navMonitor.addEventListener('click', () => {
            // Switch View
            document.querySelectorAll('.sidebar-item').forEach(btn => btn.classList.remove('active'));
            navMonitor.classList.add('active');

            // Hide Main App
            if (mainHeader) mainHeader.classList.add('hidden');
            if (mainContent) mainContent.classList.add('hidden');

            // Show Monitor
            liveMonitorView.classList.remove('hidden');
            renderLiveMonitor();
        });
    }
    */

    // Restore Main View
    const restoreMainView = (activeBtnId) => {
        document.querySelectorAll('.sidebar-item').forEach(btn => btn.classList.remove('active'));
        document.getElementById(activeBtnId)?.classList.add('active');

        if (mainHeader) mainHeader.classList.remove('hidden');
        if (mainContent) mainContent.classList.remove('hidden');
        liveMonitorView?.classList.add('hidden');
        document.getElementById('engines-view')?.classList.add('hidden');
    };

    document.getElementById('nav-analysis')?.addEventListener('click', () => restoreMainView('nav-analysis'));
    document.getElementById('nav-config')?.addEventListener('click', () => restoreMainView('nav-config'));

    // Monitor Actions

    document.getElementById('monitor-refresh-btn')?.addEventListener('click', renderLiveMonitor);
    document.getElementById('reality-check-sync-btn')?.addEventListener('click', refreshAllAccounts);

    // --- Controles Principales ---
    dom.analyzeBtn.addEventListener('click', runAnalysis);
    dom.resetBtn.addEventListener('click', resetUI);

    dom.tradesFileInput.addEventListener('change', (e) => {
        const newFiles = Array.from(e.target.files);
        let addedCount = 0;
        let updatedCount = 0;

        newFiles.forEach(newFile => {
            const existingIndex = state.loadedStrategyFiles.findIndex(f => f.name === newFile.name);

            if (existingIndex !== -1) {
                // UPDATE: Strategy exists, replace file but KEEP ID
                const oldId = state.loadedStrategyFiles[existingIndex].strategyId;
                newFile.strategyId = oldId;
                // Preserve other metadata if needed? Usually just ID.
                // Replace the entry (placeholder or old file) with the new File object
                state.loadedStrategyFiles[existingIndex] = newFile;

                // Clear cached data for this index to force re-parsing
                if (state.rawStrategiesData && state.rawStrategiesData[existingIndex]) {
                    state.rawStrategiesData[existingIndex] = null;
                }
                updatedCount++;
            } else {
                // ADD: New strategy
                newFile.strategyId = generateStrategyId(newFile.name);
                state.loadedStrategyFiles.push(newFile);
                addedCount++;
            }
        });

        updateTradesFilesList();

        // Feedback to user
        let message = '';
        if (addedCount > 0) message += `${addedCount} añadidas. `;
        if (updatedCount > 0) message += `${updatedCount} actualizadas (ID mantenido).`;

        console.log(`[Upload] Added: ${addedCount}, Updated: ${updatedCount}`);

        if (message) {
            showToast(message, 'success');
        } else if (newFiles.length > 0) {
            showToast('Archivos procesados.', 'info');
        }

        e.target.value = ''; // Permite volver a seleccionar el mismo archivo

        // AUTO-ANALYSIS: Automatically run analysis if valid files exist
        if (state.loadedStrategyFiles.length > 0) {
            console.log('[Upload] Auto-starting analysis...');
            runAnalysis();
        }
    });


    dom.tradesFilesListEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-file-btn')) {
            const indexToRemove = parseInt(e.target.dataset.index, 10);
            state.loadedStrategyFiles.splice(indexToRemove, 1);
            if (state.rawStrategiesData && state.rawStrategiesData.length > indexToRemove) {
                state.rawStrategiesData.splice(indexToRemove, 1);
            }
            updateTradesFilesList();
        }
    });

    // --- NUEVO: Listener para actualización remota (e.g. desde FAB Delete) ---
    window.addEventListener('strategies-deleted', () => {
        updateTradesFilesList();
        // Also ensure analysis mode filter is updated since options depend on file list
        // updateAnalysisModeSelector(); // (Checking if imported... if not, might need import or it's handled in ui.js)
        // ui.js exports updateAnalysisModeSelector but events.js imports it.
        // Let's add it.
        import('./ui.js').then(({ updateAnalysisModeSelector }) => {
            updateAnalysisModeSelector();
        });
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
    // --- Portafolios Guardados ---
    // Header Listener (Sorting)
    if (dom.savedPortfoliosHeader) {
        dom.savedPortfoliosHeader.addEventListener('click', (e) => {
            const header = e.target.closest('th.sortable');
            if (header) {
                console.log('-> Clic detectado en cabecera de Portafolios Guardados:', header.dataset.sortKey);
                sortSavedPortfoliosTable(header);
            }
        });
    }

    // Body Listener (Actions)
    if (dom.savedPortfoliosBody) {
        // Helper function for name editing
        const savePortfolioName = (inputEl) => {
            const newName = inputEl.value.trim();
            const wrapper = inputEl.closest('[data-portfolio-index]');
            const index = wrapper ? parseInt(wrapper.dataset.portfolioIndex, 10) : -1;
            const portfolio = state.savedPortfolios[index];

            if (newName && portfolio && newName !== portfolio.name) {
                portfolio.name = newName;
                const nameTextEl = wrapper.querySelector('.portfolio-name-text');
                if (nameTextEl) nameTextEl.textContent = newName;
                saveSavedPortfolios(); // Persist change
                showToast('Portfolio renamed', 'success');

                // Update Live Monitor if it's the one being monitored
                if (document.getElementById('live-monitor-view')?.classList.contains('hidden') === false) {
                    import('./modules/liveMonitor.js').then(({ renderLiveMonitor }) => renderLiveMonitor());
                }
            }
            const displayEl = inputEl.closest('.portfolio-name-container').querySelector('.portfolio-name-display');
            if (displayEl) displayEl.classList.remove('hidden');
            inputEl.classList.add('hidden');
        };

        dom.savedPortfoliosBody.addEventListener('click', async (e) => {
            console.log('[Events] Click detected in savedPortfoliosBody. Target:', e.target);

            // --- Delete Portfolio ---
            if (e.target.classList.contains('delete-portfolio-btn')) {
                const indexToRemove = parseInt(e.target.dataset.index, 10);
                if (indexToRemove === state.featuredPortfolioIndex) state.featuredPortfolioIndex = null;
                if (indexToRemove === state.comparisonPortfolioIndex) state.comparisonPortfolioIndex = null;
                state.savedPortfolios.splice(indexToRemove, 1);
                // --- OPTIMIZACIÓN: Actualizar UI localmente sin llamar al backend ---
                displaySavedPortfoliosList();
                showToast('Portafolio eliminado correctamente', 'success');
            }

            // --- Optimize Portfolio ---
            const optimizeBtn = e.target.classList.contains('optimize-portfolio-btn')
                ? e.target
                : e.target.closest('.optimize-portfolio-btn'); // Corrected class name from view-edit-portfolio-btn

            if (optimizeBtn) {
                console.log('[Events] Click en botón Optimizar detectado');
                const index = parseInt(optimizeBtn.dataset.index, 10);
                import('./modules/optimization.js').then(module => {
                    module.startOptimizationWorkflow(index);
                });
            }

            // --- Feature Portfolio (Star) ---
            if (e.target.classList.contains('feature-portfolio-btn')) {
                const index = parseInt(e.target.dataset.index, 10);
                state.featuredPortfolioIndex = state.featuredPortfolioIndex === index ? null : index;
                renderFeaturedPortfolio();
                displaySavedPortfoliosList();
                if (state.featuredPortfolioIndex !== null) {
                    showToast('Portafolio destacado actualizado', 'success');
                } else {
                    showToast('Portafolio ya no está destacado', 'info');
                }
            }

            // --- Compare Portfolio (Refresh) ---
            const compareBtn = e.target.closest('.compare-original-btn');
            if (compareBtn) {
                const index = parseInt(compareBtn.dataset.index, 10);
                state.comparisonPortfolioIndex = state.comparisonPortfolioIndex === index ? null : index;
                displaySavedPortfoliosList();
            }

            // --- Manage Slave Accounts ---
            const manageAccountsBtn = e.target.closest('.manage-slave-accounts-btn');
            if (manageAccountsBtn) {
                console.log('[Events] Manage Slave Accounts clicked');
                const index = parseInt(manageAccountsBtn.dataset.index, 10);
                openSlaveAccountsModal(index);
                e.stopPropagation();
            }

            // --- View Strategy Risk ---
            const viewRiskBtn = e.target.closest('.view-strategy-risk-btn');
            if (viewRiskBtn) {
                const index = parseInt(viewRiskBtn.dataset.index, 10);
                const source = viewRiskBtn.dataset.source || 'saved';
                openStrategyRiskModal(index, source);
                e.stopPropagation();
            }

            // --- Edit Portfolio Name in List ---
            const nameContainer = e.target.closest('.portfolio-name-container'); // Updated class match
            if (nameContainer && (e.target.closest('.portfolio-name-display') || e.target.closest('.edit-portfolio-name-btn'))) {
                const displayEl = nameContainer.querySelector('.portfolio-name-display');
                const inputEl = nameContainer.querySelector('.portfolio-name-input');
                if (displayEl && inputEl) {
                    displayEl.classList.add('hidden');
                    inputEl.classList.remove('hidden');
                    inputEl.focus();
                    inputEl.select(); // Select text for easy editing
                }
                e.stopPropagation(); // Prevent bubbling to row click
                return; // Stop processing to avoid selection
            }

            const row = e.target.closest('tr');

            // --- Base Portfolio Selection ---
            if (e.target.name === 'base-portfolio-select') {
                const index = parseInt(e.target.dataset.index, 10);

                // Toggle Logic: 
                // If the clicked radio is ALREADY the one stored in state, it means the user wants to deselect it.
                // (Browser keeps it checked by default on click, so we must manually uncheck it).
                if (state.searchBasePortfolioIndex === index) {
                    // Toggle Off
                    e.target.checked = false;
                    state.searchBasePortfolioIndex = null;
                    state.searchBaseStrategyIndices.clear();
                    console.log('[Events] Base Portfolio Deselected');

                    // Hide Search Button
                    if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.classList.add('hidden');

                    if (window.renderBaseStrategiesConfig) {
                        window.renderBaseStrategiesConfig();
                    }
                } else {
                    // New Selection (Browser already checked it visually)
                    state.searchBasePortfolioIndex = index;

                    const portfolio = state.savedPortfolios[index];
                    if (portfolio) {
                        state.searchBaseStrategyIndices.clear();
                        if (portfolio.strategyIds && portfolio.strategyIds.length > 0) {
                            portfolio.strategyIds.forEach(id => {
                                const currentIdx = state.loadedStrategyFiles.findIndex(f => f.strategyId === id);
                                if (currentIdx !== -1) state.searchBaseStrategyIndices.add(currentIdx);
                            });
                        } else if (portfolio.indices) {
                            portfolio.indices.forEach(idx => state.searchBaseStrategyIndices.add(idx));
                        }

                        console.log('[Events] Base Portfolio Selected:', portfolio.name);

                        // Show Search Button
                        if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.classList.remove('hidden');

                        if (window.renderBaseStrategiesConfig) {
                            window.renderBaseStrategiesConfig();
                        }
                    }
                }

                e.stopPropagation();
                return;
            }

            if (row && !e.target.closest('button') && !e.target.closest('input')) {
                const index = row.dataset.rowIndex;
                if (index !== undefined) {
                    const portfolio = state.savedPortfolios[index];
                    if (portfolio) {
                        console.log(`[Events] Clicking row ${index}. ID: ${portfolio.id}`);
                        console.log(`[Events] State Item riskPerStrategy present?`, !!portfolio.riskPerStrategy, portfolio.riskPerStrategy);
                        // Pass index explicitly so focusMode can use it for SQ Analysis
                        focusMode.enable({ ...portfolio, index: parseInt(index, 10) }, 'saved', row);
                    }
                }
            }
        });

        // Input Blur/Enter Listener for Name Edit
        dom.savedPortfoliosBody.addEventListener('focusout', (e) => {
            if (e.target.classList.contains('portfolio-name-input')) {
                // Delay to allow Enter to fire first
                setTimeout(() => {
                    savePortfolioName(e.target);
                }, 100);
            }
        });

        dom.savedPortfoliosBody.addEventListener('keydown', (e) => {
            if (e.target.classList.contains('portfolio-name-input') && e.key === 'Enter') {
                savePortfolioName(e.target);
                e.target.blur(); // Trigger focusout to ensure consistency
            } else if (e.target.classList.contains('portfolio-name-input') && e.key === 'Escape') {
                const inputEl = e.target;
                const displayEl = inputEl.closest('.portfolio-name-container').querySelector('.portfolio-name-display');
                if (displayEl) displayEl.classList.remove('hidden');
                inputEl.classList.add('hidden');
                // Reset value
                const wrapper = inputEl.closest('[data-portfolio-index]');
                const index = wrapper ? parseInt(wrapper.dataset.portfolioIndex, 10) : -1;
                if (index !== -1 && state.savedPortfolios[index]) {
                    inputEl.value = state.savedPortfolios[index].name;
                }
            }
        });
    }

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
    if (dom.findDatabankPortfoliosBtn) {
        dom.findDatabankPortfoliosBtn.addEventListener('click', async () => {
            const { openSearchConfigModal } = await import('./modules/searchConfig.js');
            openSearchConfigModal(); // Call with no fixed strategies
        });
    }

    if (dom.pauseSearchBtn) {
        dom.pauseSearchBtn.addEventListener('click', async () => {
            try {
                const response = await fetch('/databank/pause', { method: 'POST' });
                if (!response.ok) throw new Error('Error al enviar señal de pausa al backend.');
                // La UI se actualiza en base a los mensajes del stream, no aquí.
            } catch (error) {
                console.error("Error al pausar/reanudar búsqueda:", error);
            }
        });
    }

    if (dom.stopSearchBtn) {
        dom.stopSearchBtn.addEventListener('click', () => {
            stopDatabankSearch();
            // Manually disable to prevent double clicks, though function handles UI too
            dom.stopSearchBtn.disabled = true;
            dom.pauseSearchBtn.disabled = true;
        });
    }

    if (dom.clearDatabankBtn) {
        dom.clearDatabankBtn.addEventListener('click', clearDatabank);
    }

    const purgeBtn = document.getElementById('purge-databank-btn');
    if (purgeBtn) {
        purgeBtn.addEventListener('click', openPurgeModal);
    }

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

        // --- View Strategy Risk in Databank ---
        const viewRiskBtn = e.target.closest('.view-strategy-risk-btn');
        if (viewRiskBtn) {
            const index = parseInt(viewRiskBtn.dataset.index, 10);
            const source = viewRiskBtn.dataset.source || 'databank';
            openStrategyRiskModal(index, source);
            e.stopPropagation();
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
    // --- NUEVO: Listeners para pestañas de vista (Backtest / Reality Check) ---
    const tabBacktest = document.getElementById('tab-backtest');
    const tabRealityCheck = document.getElementById('tab-reality-check');
    const tabSQ = document.getElementById('tab-sq-stats');

    if (tabBacktest) {
        tabBacktest.addEventListener('click', () => switchViewMode('backtest'));
    }
    if (tabRealityCheck) {
        tabRealityCheck.addEventListener('click', () => switchViewMode('reality-check'));
    }
    if (tabSQ) {
        tabSQ.addEventListener('click', () => switchViewMode('sq-stats'));
    }
    const tabRealVsSq = document.getElementById('tab-real-vs-sq');
    if (tabRealVsSq) {
        tabRealVsSq.addEventListener('click', () => switchViewMode('real-vs-sq'));
    }
    // --- DEBUG: Global Click Listener ---
    window.addEventListener('click', (e) => {
        if (e.target.closest('.manage-slave-accounts-btn')) {
            console.log('[GLOBAL DEBUG] Click on Manage Slave Accounts Button detected!');
            console.log('Target:', e.target);
            console.log('Path:', e.composedPath());
        }
    });

    // --- DEBUG: Expose Modal Function Globally ---
    window.openSlaveAccountsModal = openSlaveAccountsModal;
    window.debugOpenSlave = openSlaveAccountsModal; // Keep alias just in case
}