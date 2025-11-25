import { state } from '../state.js';
import { dom } from '../dom.js';
import { renderEquityChart, renderScatterChart, renderLorenzChart, renderChartsForTab, renderPortfolioComparisonCharts } from '../ui.js';
import { STRATEGY_COLORS } from '../config.js';

export const focusMode = {
    active: false,
    focusedItems: new Map(), // Map<id, { item, type, rowElement, color }>
    // originalCharts: null, // To store state if needed, though re-rendering is easier

    /**
     * Enable Focus Mode for a specific item (Toggle selection)
     * @param {Object} item - The data object (strategy or portfolio)
     * @param {string} type - 'strategy', 'databank', 'saved'
     * @param {HTMLElement} rowElement - The table row element
     */
    enable(item, type, rowElement) {
        console.log('[FocusMode] enable() called. Type:', type, 'Item:', item.name || item.id);
        const id = item.id || item.name; // Use name as fallback ID if needed

        if (this.focusedItems.has(id)) {
            // Deselect if already selected
            console.log('[FocusMode] Item already selected, deselecting:', id);
            this.deselectItem(id);
        } else {
            // Select new item
            console.log('[FocusMode] Selecting new item:', id);
            this.active = true;

            // Assign a color based on the number of currently selected items
            const colorIndex = this.focusedItems.size % STRATEGY_COLORS.length;
            const color = STRATEGY_COLORS[colorIndex];

            this.focusedItems.set(id, { ...item, type, rowElement, color });
            this.highlightRow(rowElement, color);
        }

        // If no items left, disable focus mode
        if (this.focusedItems.size === 0) {
            this.disable();
            return;
        }

        // Update UI
        this.renderBanner();
        this.updateCharts();

        // Add ESC key listener if not already added
        if (this.focusedItems.size === 1) {
            document.addEventListener('keydown', this.handleEscKey);
        }
    },

    /**
     * Deselect a specific item
     */
    deselectItem(id) {
        const itemData = this.focusedItems.get(id);
        if (itemData) {
            this.clearRowHighlight(itemData.rowElement);
            this.focusedItems.delete(id);
        }
    },

    /**
     * Disable Focus Mode and restore normal view
     */
    disable() {
        if (!this.active) return;

        this.active = false;

        // Clear all highlights
        this.focusedItems.forEach(item => {
            this.clearRowHighlight(item.rowElement);
        });

        this.focusedItems.clear();
        this.removeBanner();
        this.restoreCharts();

        document.removeEventListener('keydown', this.handleEscKey);
    },

    /**
     * Handle ESC key to exit focus mode
     */
    handleEscKey(e) {
        if (e.key === 'Escape') {
            focusMode.disable();
        }
    },

    /**
     * Highlight the focused row
     */
    highlightRow(row, color) {
        if (!row) return;
        row.style.borderLeft = `4px solid ${color}`;
        row.style.backgroundColor = `${color}20`; // 20% opacity
        // Ensure row is visible
        // row.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); // Optional: might be annoying with multiple selections
    },

    /**
     * Clear highlight from the row
     */
    clearRowHighlight(row) {
        if (!row) return;
        row.style.borderLeft = '';
        row.style.backgroundColor = '';
    },

    /**
     * Render the floating banner
     */
    renderBanner() {
        this.removeBanner(); // Ensure no duplicates

        const count = this.focusedItems.size;
        const banner = document.createElement('div');
        banner.id = 'focus-mode-banner';
        banner.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-full shadow-2xl z-50 flex items-center gap-4 animate-bounce-in';
        banner.style.animation = 'fadeInDown 0.3s ease-out';

        banner.innerHTML = `
            <div class="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" />
                </svg>
                <span class="font-bold">Focus Mode:</span>
                <span class="max-w-xs truncate">${count} item${count !== 1 ? 's' : ''} selected</span>
            </div>
            <button id="exit-focus-mode" class="bg-white/20 hover:bg-white/30 rounded-full p-1 transition-colors" title="Clear all">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
            </button>
        `;

        document.body.appendChild(banner);

        document.getElementById('exit-focus-mode').addEventListener('click', () => this.disable());
    },

    /**
     * Remove the banner
     */
    removeBanner() {
        const banner = document.getElementById('focus-mode-banner');
        if (banner) banner.remove();
    },

    /**
     * Update charts to show only the focused items
     */
    updateCharts() {
        if (this.focusedItems.size === 0) return;

        // In the new layout, we always use the main viewer in the top panel
        // The canvas ID is 'portfolioEquityChart' for the main equity curve

        // Ensure the main viewer is visible (it should be by default)
        if (dom.viewerContainer) {
            dom.viewerContainer.classList.remove('hidden');
        }

        // Prepare data for renderPortfolioComparisonCharts
        const analyses = [];
        this.focusedItems.forEach(item => {
            let analysis = item.analysis;

            // For DataBank items, compute the portfolio by combining individual strategies
            if (item.type === 'databank' && !analysis && item.indices) {
                console.log('[FocusMode] DataBank item detected, computing portfolio from indices:', item.indices);

                // Get individual strategies
                const strategies = item.indices.map(idx => window.analysisResults[idx]).filter(Boolean);

                if (strategies.length === 0) {
                    console.error('[FocusMode] ❌ No strategies found for indices:', item.indices);
                    return;
                }

                console.log(`[FocusMode] Found ${strategies.length} strategies to combine`);

                // Combine equity curves (simple average for now - could be weighted)
                const firstStrategy = strategies[0];
                if (!firstStrategy.analysis?.chartData?.equityCurve) {
                    console.error('[FocusMode] ❌ First strategy has no equity curve');
                    return;
                }

                const numPoints = firstStrategy.analysis.chartData.equityCurve.length;
                const combinedEquityCurve = [];

                for (let i = 0; i < numPoints; i++) {
                    let sum = 0;
                    let count = 0;

                    strategies.forEach(strategy => {
                        if (strategy.analysis?.chartData?.equityCurve?.[i]) {
                            sum += strategy.analysis.chartData.equityCurve[i].y;
                            count++;
                        }
                    });

                    if (count > 0) {
                        combinedEquityCurve.push({
                            x: firstStrategy.analysis.chartData.equityCurve[i].x,
                            y: sum / count
                        });
                    }
                }

                // Create a synthetic analysis object
                analysis = {
                    chartData: {
                        equityCurve: combinedEquityCurve
                    }
                };

                console.log('[FocusMode] ✅ Successfully computed DataBank portfolio analysis');
            }

            // For DataBank items, check if the item object itself has the analysis
            if (item.type === 'databank' && !analysis) {
                console.log('[FocusMode] DataBank item detected:', item.name);
                console.log('[FocusMode] Full item structure:', item);
                console.warn('[FocusMode] ❌ DataBank item has no analysis property!');
                console.warn('[FocusMode] This means DataBank items need to be retrieved from state.databankPortfolios instead');

                // Try to find in state.databankPortfolios
                const databankItem = state.databankPortfolios?.find(p => p.name === item.name);
                if (databankItem && databankItem.analysis) {
                    analysis = databankItem.analysis;
                    console.log('[FocusMode] ✅ Found analysis in state.databankPortfolios');
                } else {
                    console.error('[FocusMode] ❌ Could not find analysis for DataBank item');
                    return; // Skip this item
                }
            }

            analyses.push({
                name: item.name,
                analysis: analysis,
                color: item.color
            });
        });

        // DEBUG: Log what we are trying to update
        console.log(`[FocusMode] Updating main viewer for ${analyses.length} items.`);

        // Render using the comparison function which targets the main viewer
        renderPortfolioComparisonCharts(analyses);

        // Ensure the comparison section is visible if it was hidden
        if (dom.portfolioComparisonChartSection) {
            dom.portfolioComparisonChartSection.classList.remove('hidden');
        }
    },

    /**
     * Restore charts to their normal state
     */
    /**
     * Restore charts to their normal state
     */
    restoreCharts() {
        // Simply trigger a re-render of the current tab
        // This relies on the existing logic in ui.js to pull data from state

        // We can try to detect which tab is active, or just update the one that corresponds to the last interaction
        // Ideally, we should just refresh the current view.

        // Let's check the active tab button
        const activeTabBtn = document.querySelector('.tab-btn.active');
        const targetId = activeTabBtn ? activeTabBtn.dataset.target : null;

        if (targetId === 'saved-portfolios-content') {
            if (typeof window.updateSavedPortfoliosDisplay === 'function') {
                window.updateSavedPortfoliosDisplay();
            }
        } else if (targetId === 'strategies-content') {
            if (typeof window.updateStrategiesDisplay === 'function') {
                window.updateStrategiesDisplay();
            }
        } else if (targetId === 'databank-content') {
            if (typeof window.updateDatabankDisplay === 'function') {
                window.updateDatabankDisplay();
            }
        }
    },

    /**
     * Select all visible items in the current table
     */
    selectAll() {
        console.log('[FocusMode] selectAll() called');
        // Determine active table
        const activeTabBtn = document.querySelector('.tab-btn.active');
        const targetId = activeTabBtn ? activeTabBtn.dataset.target : null;
        console.log('[FocusMode] Active tab:', targetId);

        let rows = [];
        let type = '';

        if (targetId === 'strategies-content') {
            rows = document.querySelectorAll('#strategies-table-body tr');
            type = 'strategy';
        } else if (targetId === 'databank-content') {
            rows = document.querySelectorAll('#databank-table-body tr');
            type = 'databank';
        } else if (targetId === 'saved-portfolios-content') {
            rows = document.querySelectorAll('#saved-portfolios-body tr');
            type = 'saved';
        }

        console.log('[FocusMode] Found', rows.length, 'rows of type:', type);

        if (rows.length > 20) {
            if (!confirm(`¿Seguro que quieres seleccionar ${rows.length} elementos? Puede ser lento.`)) {
                return;
            }
        }

        let successCount = 0;
        let failCount = 0;

        rows.forEach((row, rowIdx) => {
            const index = row.dataset.rowIndex || row.dataset.originalIndex;
            console.log(`[FocusMode] Row ${rowIdx}: index=${index}, dataset=`, row.dataset);

            if (index !== undefined) {
                let item = null;
                if (type === 'strategy') {
                    const originalIndex = parseInt(index, 10);
                    item = window.analysisResults?.find(r => r.originalIndex === originalIndex && !r.isPortfolio);
                    console.log(`[FocusMode] Strategy ${originalIndex}:`, item ? 'FOUND' : 'NOT FOUND');
                } else if (type === 'databank') {
                    const idx = parseInt(index, 10);
                    item = state.databankPortfolios[idx];
                    console.log(`[FocusMode] Databank ${idx}:`, item ? 'FOUND' : 'NOT FOUND');
                } else if (type === 'saved') {
                    const idx = parseInt(index, 10);
                    item = state.savedPortfolios[idx];
                    console.log(`[FocusMode] Saved ${idx}:`, item ? 'FOUND' : 'NOT FOUND');
                }

                if (item) {
                    // Ensure item has analysis property (skip check for DataBank since it's computed later)
                    if (!item.analysis && type !== 'databank') {
                        console.warn(`[FocusMode] Item ${item.name} has NO analysis data!`);
                        failCount++;
                        return;
                    }

                    // Add to selection without toggling off
                    const id = item.id || item.name;
                    if (!this.focusedItems.has(id)) {
                        this.active = true;
                        const colorIndex = this.focusedItems.size % STRATEGY_COLORS.length;
                        const color = STRATEGY_COLORS[colorIndex];
                        this.focusedItems.set(id, { ...item, type, rowElement: row, color });
                        this.highlightRow(row, color);
                        successCount++;
                        console.log(`[FocusMode] ✅ Added ${item.name} to selection`);
                    } else {
                        console.log(`[FocusMode] ⏭️ ${item.name} already selected`);
                    }
                } else {
                    failCount++;
                    console.warn(`[FocusMode] ❌ Could not find item for row index ${index}`);
                }
            } else {
                failCount++;
                console.warn(`[FocusMode] ❌ Row has no index attribute:`, row);
            }
        });

        console.log(`[FocusMode] selectAll complete: ${successCount} added, ${failCount} failed`);

        if (successCount === 0) {
            alert('No se pudieron seleccionar elementos. Revisa la consola para más detalles.');
            return;
        }

        this.renderBanner();
        this.updateCharts();
    },

    /**
     * Clear all selected items and render empty chart
     */
    clearAll() {
        console.log('[FocusMode] clearAll() called. Active:', this.active, 'Items count:', this.focusedItems.size);

        // If no items are selected, do nothing
        if (this.focusedItems.size === 0 && !this.active) {
            console.log('[FocusMode] clearAll: Nothing to clear, exiting');
            return;
        }

        if (!this.active) {
            // If not active, still clear any items that might be selected
            this.focusedItems.forEach(item => {
                this.clearRowHighlight(item.rowElement);
            });
            this.focusedItems.clear();
            this.removeBanner();

            // Render empty chart (benchmark only)
            renderPortfolioComparisonCharts([]);
            return;
        }

        this.active = false;

        // Clear all highlights
        this.focusedItems.forEach(item => {
            this.clearRowHighlight(item.rowElement);
        });

        this.focusedItems.clear();
        this.removeBanner();

        // Render empty chart (benchmark only) instead of calling restoreCharts
        renderPortfolioComparisonCharts([]);

        document.removeEventListener('keydown', this.handleEscKey);
    }
};

// Initialize global listeners for toolbar buttons
document.addEventListener('DOMContentLoaded', () => {
    const selectAllBtn = document.getElementById('select-all-btn');
    const clearAllBtn = document.getElementById('clear-all-btn');

    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => focusMode.selectAll());
    }
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => focusMode.clearAll());
    }
});
