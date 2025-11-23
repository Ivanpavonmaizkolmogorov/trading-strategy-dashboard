import { dom } from '../dom.js';
import { renderViewerForActiveTab } from './viewer.js';
import { renderStrategiesTable } from '../ui.js';
import { initStrategiesTable } from './strategiesTable.js';

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
            if (targetContent) {
                targetContent.classList.remove('hidden');
                targetContent.classList.add('active', 'flex');

                // Render specific content if needed
                if (targetId === 'strategies-content') {
                    initStrategiesTable(); // Ensure controls are injected and config loaded
                    renderStrategiesTable();
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
            // Maximize Chart = Minimize Bottom Panel
            sourcePanel.style.height = '40px'; // Min height for tabs
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
            // Maximize Bottom Panel = Max height
            const containerHeight = document.querySelector('main').clientHeight;
            sourcePanel.style.height = `${containerHeight - 100}px`; // Leave space for header/chart
            triggerResize();
        });
    }
};
