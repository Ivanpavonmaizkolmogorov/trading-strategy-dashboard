import { dom } from '../dom.js';
import { state, saveSavedPortfolios } from '../state.js';
import { renderViewerForActiveTab } from './viewer.js';
import { renderStrategiesTable, displaySavedPortfoliosList } from '../ui.js';
import { initStrategiesTable } from './strategiesTable.js';
import { exportTableToCSV } from '../utils.js';
import { selectedSavedPortfolios, clearSelectedSavedPortfolios } from './savedPortfoliosTable.js';
import { showToast } from './notifications.js';

/**
 * Inicializa la lógica del layout: Sidebar, Tabs y Resizer.
 */
export const initializeLayout = () => {
    initSidebar();
    initBottomPanelTabs();
    initPanelResizer();
};

const initSidebar = () => {
    // Config Button -> Open Modal
    if (dom.navConfig) {
        dom.navConfig.addEventListener('click', () => {
            dom.configModal.classList.remove('hidden');
            dom.configModal.classList.add('flex');
        });
    }

    // Close Config Modal
    const closeModal = () => {
        dom.configModal.classList.add('hidden');
        dom.configModal.classList.remove('flex');
    };

    if (dom.closeConfigBtn) dom.closeConfigBtn.addEventListener('click', closeModal);
    if (dom.configModalBackdrop) dom.configModalBackdrop.addEventListener('click', closeModal);

    // Analysis Button -> Focus Viewer (Optional: Reset view)
    if (dom.navAnalysis) {
        dom.navAnalysis.addEventListener('click', () => {
            // Ya estamos en la vista de análisis, quizás hacer scroll top o resetear algo
            console.log("Focus en Análisis");
        });
    }
};

const initBottomPanelTabs = () => {
    if (!dom.panelTabs) return;

    // --- References to Control Groups ---
    const databankControls = document.getElementById('databank-controls');
    const savedPortfoliosControls = document.getElementById('saved-portfolios-controls');
    const strategiesControls = document.getElementById('strategies-controls');

    // --- Helper to Toggle Controls ---
    const updateControlsVisibility = (targetId) => {
        // Hide all first
        if (databankControls) databankControls.classList.add('hidden');
        if (savedPortfoliosControls) savedPortfoliosControls.classList.add('hidden');
        if (strategiesControls) strategiesControls.classList.add('hidden');

        // Show specific
        if (targetId === 'databank-content' && databankControls) {
            databankControls.classList.remove('hidden');
            if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.classList.remove('hidden');
        } else if (targetId === 'saved-portfolios-content' && savedPortfoliosControls) {
            savedPortfoliosControls.classList.remove('hidden');
            // Hide search button unless base portfolio is selected
            if (dom.findDatabankPortfoliosBtn) {
                if (state.searchBasePortfolioIndex !== null) {
                    dom.findDatabankPortfoliosBtn.classList.remove('hidden');
                } else {
                    dom.findDatabankPortfoliosBtn.classList.add('hidden');
                }
            }
        } else if (targetId === 'strategies-content' && strategiesControls) {
            strategiesControls.classList.remove('hidden');
            // strategies tab likely doesn't need search button
            if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.classList.add('hidden');
        }
    };

    // --- Initialize Export Buttons (One-time setup) ---
    const exportDatabankBtn = document.getElementById('export-databank-btn');
    if (exportDatabankBtn) {
        console.log('[Layout] Export Databank Button found. Attaching listener.');
        exportDatabankBtn.addEventListener('click', () => {
            console.log('[Layout] Export Databank Button Clicked!');
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            exportTableToCSV('databank-table-body', `databank_export_${timestamp}.csv`);
        });
    } else {
        console.warn('[Layout] Export Databank Button NOT found during init!');
    }

    const deleteSelectedBtn = document.getElementById('delete-selected-portfolios-btn');
    if (deleteSelectedBtn) {
        console.log('[Layout] Delete Selected Portfolios Button found. Attaching listener.');
        deleteSelectedBtn.addEventListener('click', () => {
            const count = selectedSavedPortfolios.size;
            if (count === 0) return;

            if (confirm(`¿Estás seguro de que quieres eliminar ${count} portafolios seleccionados? Esto no se puede deshacer.`)) {
                const indicesToDelete = new Set(selectedSavedPortfolios);
                // Filter out the deleted ones
                state.savedPortfolios = state.savedPortfolios.filter((_, index) => !indicesToDelete.has(index));

                saveSavedPortfolios();
                clearSelectedSavedPortfolios();
                displaySavedPortfoliosList();
                showToast(`${count} portafolios eliminados correctamente.`, 'success');
            }
        });
    } else {
        console.warn('[Layout] Delete Selected Portfolios Button NOT found during init!');
    }

    const exportSavedBtn = document.getElementById('export-saved-portfolios-btn');
    if (exportSavedBtn) {
        console.log('[Layout] Export Saved Portfolios Button found. Attaching listener.');
        exportSavedBtn.addEventListener('click', () => {
            console.log('[Layout] Export Saved Portfolios Button Clicked!');
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            exportTableToCSV('saved-portfolios-body', `saved_portfolios_${timestamp}.csv`);
        });
    } else {
        console.warn('[Layout] Export Saved Portfolios Button NOT found during init!');
    }

    const exportStrategiesBtn = document.getElementById('export-strategies-btn');
    if (exportStrategiesBtn) {
        console.log('[Layout] Export Strategies Button found. Attaching listener.');
        exportStrategiesBtn.addEventListener('click', () => {
            console.log('[Layout] Export Strategies Button Clicked!');
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            exportTableToCSV('strategies-table-body', `strategies_export_${timestamp}.csv`);
        });
    } else {
        console.warn('[Layout] Export Strategies Button NOT found during init!');
    }

    // 0. Sync Initial State
    const activeContent = document.querySelector('.tab-content.active');
    if (activeContent) {
        if (activeContent.id === 'databank-content') state.activeTab = 'databank';
        else if (activeContent.id === 'saved-portfolios-content') state.activeTab = 'saved-portfolios';
        else if (activeContent.id === 'strategies-content') state.activeTab = 'strategies';
        console.log(`[Layout] Initial active tab synced to: ${state.activeTab}`);
    }

    dom.panelTabs.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // 1. Remove active class from all tabs
            dom.panelTabs.forEach(b => b.classList.remove('active', 'text-white', 'bg-gray-700'));
            dom.panelTabs.forEach(b => b.classList.add('text-gray-300')); // Reset color

            // 2. Add active class to clicked tab
            const targetBtn = e.currentTarget; // Use currentTarget to get the button, not the span inside
            targetBtn.classList.add('active', 'text-white', 'bg-gray-700');
            targetBtn.classList.remove('text-gray-300');

            // 3. Hide all content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active', 'flex');
                content.classList.add('hidden');
            });

            // 4. Show target content
            const targetId = targetBtn.dataset.target;
            const targetContent = document.getElementById(targetId);

            // 4.5 Update Controls Visibility
            updateControlsVisibility(targetId);

            if (targetContent) {
                targetContent.classList.remove('hidden');
                targetContent.classList.add('active', 'flex');

                // Update State
                if (targetId === 'strategies-content') state.activeTab = 'strategies';
                else if (targetId === 'saved-portfolios-content') state.activeTab = 'saved-portfolios';
                else if (targetId === 'databank-content') state.activeTab = 'databank';
                console.log(`[Layout] Active Tab changed to: ${state.activeTab}`);

                // Render specific content if needed
                if (targetId === 'strategies-content') {
                    initStrategiesTable(); // Ensure controls are injected and config loaded
                    renderStrategiesTable();
                } else if (targetId === 'saved-portfolios-content') {
                    displaySavedPortfoliosList();
                }
            }

            // 5. Update viewer chart based on active tab
            setTimeout(() => renderViewerForActiveTab(), 100); // Small delay to ensure DOM is ready
        });
    });
};

const initPanelResizer = () => {
    const resizer = dom.panelResizer;
    const sourcePanel = dom.sourcePanel;
    const viewerContainer = dom.viewerContainer;

    if (!resizer || !sourcePanel || !viewerContainer) return;

    let isResizing = false;
    let lastDownY = 0;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        lastDownY = e.clientY;
        resizer.classList.add('resizing');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none'; // Prevent text selection
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const containerHeight = document.querySelector('main').clientHeight;
        const offsetTop = document.querySelector('main').getBoundingClientRect().top;

        // Calculate new height for source panel (Total Height - Mouse Y relative to container)
        // Mouse Y relative to viewport - Container Offset = Mouse Y inside container
        const mouseYInContainer = e.clientY - offsetTop;

        // We want the bottom panel height. 
        // Bottom Panel Height = Container Height - Mouse Y
        let newHeight = containerHeight - mouseYInContainer;

        // Limits
        if (newHeight < 100) newHeight = 100; // Min height
        if (newHeight > containerHeight - 100) newHeight = containerHeight - 100; // Max height

        sourcePanel.style.height = `${newHeight}px`;
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });

    // --- Resize Control Buttons ---
    const maxChartBtn = document.getElementById('resize-max-chart');
    const resetBtn = document.getElementById('resize-reset');
    const maxBottomBtn = document.getElementById('resize-max-bottom');

    // Helper to trigger window resize for Chart.js update
    const triggerResize = () => {
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 50); // Small delay to allow transition
    };

    if (maxChartBtn) {
        maxChartBtn.addEventListener('mousedown', (e) => e.stopPropagation()); // Prevent drag start
        maxChartBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Maximize Bottom Panel (User Requested Swap)
            const containerHeight = document.querySelector('main').clientHeight;
            // Leave 44px (raised 4 more points as requested)
            sourcePanel.style.height = `${containerHeight - 44}px`;

            triggerResize();
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        resetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Reset to default (approx 40% or 320px)
            sourcePanel.style.height = '320px';
            triggerResize();
        });
    }

    if (maxBottomBtn) {
        maxBottomBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        maxBottomBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.stopPropagation();
            // Maximize Chart / Minimize Bottom Panel (User Requested Swap)
            // Leave 4px visible (a couple points higher than 0)
            sourcePanel.style.height = '4px';

            triggerResize();
        });
    }
};
