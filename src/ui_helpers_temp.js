
export const initFocusedStrategyNavigation = () => {
    const prevBtn = document.getElementById('focus-prev-btn');
    const nextBtn = document.getElementById('focus-next-btn');
    const toggleBtn = document.getElementById('focus-toggle-eye-btn');

    if (!prevBtn || !nextBtn || !toggleBtn) return;

    // Helper: Get currently focused strategy index in the visible list
    const getFocusedContext = () => {
        // We need the focusMode module (dynamically imported or available globally? it's imported in ui.js modules)
        // Check if global focusMode is available or we need to rely on the module import in ui.js
        // ui.js doesn't import focusMode at top level in the snippet I saw, only dynamically.
        // Wait, I saw "import { focusMode } from './modules/focusMode.js';" in strategiesTable.js
        // Let's assume we can access it via a global or we need to import it here. 
        // Ideally ui.js should have it.
        // For now, let's try to access it via window or just rely on the fact that toggleStrategyOverlay works.

        // Actually, ui.js uses dynamic import for focusMode in toggleStrategyOverlay.
        // But for navigation we need it more directly.
        // Let's see if we can get focused items from DOM or State?
        // Better: Import it at top of ui.js if possible, or use the dynamic import approach.
        return import('./modules/focusMode.js').then(m => {
            const fm = m.focusMode || m.default;
            if (!fm || !fm.focusedItems || fm.focusedItems.size === 0) return null;

            const focusedStrategy = fm.focusedItems.values().next().value; // Get first one
            const strategies = window.currentTableStrategies || [];

            if (strategies.length === 0) return null;

            // Find index
            const idx = strategies.findIndex(s => s.name === focusedStrategy.name); // Simple name match
            return { idx, strategies, focusedStrategy, fm };
        });
    };

    const navigate = (direction) => {
        getFocusedContext().then(ctx => {
            if (!ctx) return;
            const { idx, strategies, fm } = ctx;
            if (idx === -1) return;

            let newIdx = idx + direction;
            if (newIdx < 0) newIdx = 0; // Clamp or cycle? User usually prefers clamp.
            if (newIdx >= strategies.length) newIdx = strategies.length - 1;

            if (newIdx !== idx) {
                const target = strategies[newIdx];
                // Enable new one
                fm.enable(target, 'strategy', null, { forceSelect: true });

                // Update Eye Button State manually for instant feedback
                // Note: The strategy object in strategies[] might not have showBacktestOverlay updated yet if it's new.
                // FocusMode default is true.
                updateEyeIcon(true); // Default is visible on new selection
            }
        });
    };

    const updateEyeIcon = (isVisible) => {
        toggleBtn.innerHTML = isVisible ? '👁️' : '🚫';
        toggleBtn.title = isVisible ? 'Ocultar Backtest (Overlay)' : 'Mostrar Backtest (Overlay)';
        toggleBtn.classList.toggle('text-blue-400', isVisible);
        toggleBtn.classList.toggle('text-gray-500', !isVisible);
    };

    // Listeners
    prevBtn.addEventListener('click', () => navigate(-1));
    nextBtn.addEventListener('click', () => navigate(1));

    toggleBtn.addEventListener('click', () => {
        getFocusedContext().then(ctx => {
            if (!ctx) return;
            const { focusedStrategy } = ctx;
            window.toggleStrategyOverlay(focusedStrategy.name, toggleBtn);
            // toggleStrategyOverlay handles the icon update for the passed button
        });
    });

    // We also need a way to update this button when the row button is clicked.
    // We can expose updateEyeIcon globally or hook into toggleStrategyOverlay.
    window.updateFocusPanelEye = updateEyeIcon;
};
