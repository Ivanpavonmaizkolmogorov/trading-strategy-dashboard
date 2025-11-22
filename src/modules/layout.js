import { dom } from '../dom.js';

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
            }
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
};
