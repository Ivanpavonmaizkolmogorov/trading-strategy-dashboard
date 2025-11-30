import { state } from '../state.js';
import { dom } from '../dom.js';
import { renderEquityChart, renderScatterChart, renderLorenzChart, renderChartsForTab, renderPortfolioComparisonCharts, renderRealityCheckTab } from '../ui.js';
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
    toggle(item, type, rowElement) {
        this.enable(item, type, rowElement);
    },

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
        // We might not need a banner if the UI is clear enough
        // For now, let's skip it or implement a subtle indicator
        this.removeBanner();
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

            // Determine savedIndex for correct color assignment in UI
            let savedIndex = item.savedIndex;
            if (item.type === 'saved' && savedIndex === undefined) {
                // Try to find index in state based on ID
                savedIndex = state.savedPortfolios.findIndex(p => p.id === item.id);
            }

            // REALITY CHECK FOR STRATEGIES: Attach Real Metrics if available
            let realMetrics = null;
            if (item.type === 'strategy' && state.magicNumberMap) {
                const magicRaw = state.magicNumberMap[item.name];
                console.log(`[FocusMode] 🔍 Looking up real data for strategy: ${item.name}`);
                console.log(`[FocusMode] 🔢 Magic Number(s) found: ${magicRaw}`);

                if (magicRaw) {
                    // Handle comma-separated magic numbers or arrays
                    let magics = [];
                    if (typeof magicRaw === 'string') {
                        magics = magicRaw.split(',').map(m => m.trim()).filter(Boolean);
                    } else if (Array.isArray(magicRaw)) {
                        magics = magicRaw;
                    } else {
                        magics = [String(magicRaw)];
                    }

                    // Find a portfolio that has real data for ANY of these magic numbers
                    const portfolioWithData = state.savedPortfolios.find(p =>
                        p.realMetrics &&
                        p.realMetrics._tradesById &&
                        magics.some(m => p.realMetrics._tradesById[m])
                    );

                    if (portfolioWithData) {
                        console.log(`[FocusMode] 📂 Found containing portfolio with data: ${portfolioWithData.name}`);

                        // Aggregate trades from all matching magic numbers
                        let strategyTrades = [];
                        let tradesById = {};
                        magics.forEach(m => {
                            if (portfolioWithData.realMetrics._tradesById[m]) {
                                const trades = portfolioWithData.realMetrics._tradesById[m];
                                strategyTrades = strategyTrades.concat(trades);
                                tradesById[m] = trades; // Preserve structure for UI lookup
                            }
                        });

                        console.log(`[FocusMode] 📊 Trades found: ${strategyTrades.length}`);

                        if (strategyTrades.length > 0) {
                            // Calculate stats from aggregated trades
                            const profit = strategyTrades.reduce((sum, t) => sum + (t.profit || 0) + (t.swap || 0) + (t.commission || 0), 0);

                            // Simple drawdown calculation for the aggregated trades (approximation)
                            // For accurate DD, we'd need to simulate the equity curve.
                            // For now, let's use the sum of profits as a proxy or 0 if complex.
                            // Better: Calculate max drawdown from the constructed equity curve of these trades.

                            // Let's construct a simple equity curve to find Max DD
                            strategyTrades.sort((a, b) => new Date(a.closeTime) - new Date(b.closeTime));
                            let currentEq = 0;
                            let maxEq = 0;
                            let maxDD = 0;

                            console.log(`[FocusMode] 📉 Calculating Real DD for ${item.name}`);
                            console.log(`[FocusMode]    Trades: ${strategyTrades.length}`);

                            strategyTrades.forEach((t, index) => {
                                const p = (t.profit || 0) + (t.swap || 0) + (t.commission || 0);
                                currentEq += p;
                                if (currentEq > maxEq) maxEq = currentEq;
                                const dd = maxEq - currentEq;
                                if (dd > maxDD) {
                                    maxDD = dd;
                                    console.log(`[FocusMode]    New MaxDD at trade ${index}: ${maxDD} (Eq: ${currentEq}, MaxEq: ${maxEq})`);
                                }
                            });

                            console.log(`[FocusMode]    Final MaxDD: ${maxDD}`);

                            realMetrics = {
                                _tradesById: tradesById, // Use the correctly structured map
                                profit: profit,
                                drawdown: maxDD,
                                trades: strategyTrades.length,
                                profitFactor: 0, // Hard to calc without gross profit/loss
                                sharpe: 0, // Complex
                                lastSync: portfolioWithData.realMetrics.lastSync
                            };
                            console.log(`[FocusMode] ✅ Found Real Metrics for strategy ${item.name}`);
                        } else {
                            console.warn(`[FocusMode] ⚠️ Portfolio found but no trades for magics: ${magics.join(', ')}`);
                        }
                    } else {
                        console.warn(`[FocusMode] ❌ No portfolio found containing trades for Magics: ${magics.join(', ')}`);
                        // Debug: Log available portfolios and their magic numbers if possible
                        state.savedPortfolios.forEach(p => {
                            if (p.realMetrics && p.realMetrics._tradesById) {
                                console.log(`[FocusMode] Portfolio ${p.name} has magics: ${Object.keys(p.realMetrics._tradesById).join(', ')}`);
                            } else {
                                console.log(`[FocusMode] Portfolio ${p.name} has NO real metrics.`);
                            }
                        });
                    }
                } else {
                    console.warn(`[FocusMode] ❌ No Magic Number mapped for ${item.name}`);
                }
            } else if (item.type === 'saved' && item.realMetrics) {
                realMetrics = item.realMetrics;
            }


            // DEBUG: Log item name being processed
            console.log(`[FocusMode] Processing item: ${item.name} (ID: ${item.id})`);
            console.log('[FocusMode] Item indices:', item.indices);

            const analysisObj = {
                name: item.name,
                analysis: analysis,
                color: item.color,
                savedIndex: savedIndex,
                realMetrics: realMetrics,
                indices: item.indices // Pass indices for Saved Portfolios
            };

            // For single strategies, we need to pass the name as a strategy so magic number lookup works
            if (item.type === 'strategy') {
                analysisObj.strategies = [item.name];
            } else if (item.strategies) {
                analysisObj.strategies = item.strategies;
            }

            analyses.push(analysisObj);
        });

        // DEBUG: Log what we are trying to update
        console.log(`[FocusMode] Updating main viewer for ${analyses.length} items.`);
        console.log('[FocusMode] Analyses names:', analyses.map(a => a.name));

        // Render using the comparison function which targets the main viewer
        renderPortfolioComparisonCharts(analyses);

        // Ensure the comparison section is visible if it was hidden
        if (dom.portfolioComparisonChartSection) {
            dom.portfolioComparisonChartSection.classList.remove('hidden');
        }

        // REALITY CHECK PANEL LOGIC
        const detailsContainer = document.getElementById('strategy-details-container');
        if (detailsContainer) {
            if (this.focusedItems.size === 1) {
                // Get the single item
                const item = this.focusedItems.values().next().value;
                // Only show for strategies or saved portfolios that are linked
                if (item.type === 'strategy') {
                    // We need the full strategy result object which has 'originalIndex'
                    // The 'item' here might be the strategy object itself.
                    // Let's verify if it has 'originalIndex'.
                    // In strategiesTable.js, we pass 'strategy' which is an element of window.analysisResults
                    // So it should have 'originalIndex' if we added it, or we can find it.
                    // Actually, window.analysisResults elements usually have 'originalIndex'.

                    // Check if we need to find the full result object
                    let fullResult = item;

                    // We need to ensure originalIndex is present for renderRealityCheckTab to work
                    if (fullResult.originalIndex === undefined) {
                        const idx = window.analysisResults.findIndex(r => r.name === item.name);
                        if (idx !== -1) {
                            // Create a shallow copy with originalIndex if it's missing on the original object
                            fullResult = { ...window.analysisResults[idx], originalIndex: idx };
                        }
                    }

                    console.log('[FocusMode] Rendering Reality Check for:', fullResult.name, 'Index:', fullResult.originalIndex);

                    // REALITY CHECK LOGIC DISABLED BY USER REQUEST (Step 1316)
                    // The user wants a chart extension and comparison table instead of an overlay.
                    /*
                    if (fullResult && fullResult.originalIndex !== undefined) {
                        renderRealityCheckTab(fullResult, 'strategy-details-container');
                        detailsContainer.classList.remove('hidden'); 
                    } else {
                        console.warn('[FocusMode] Could not find originalIndex for strategy:', item.name);
                        detailsContainer.classList.add('hidden');
                    }
                    */
                    detailsContainer.classList.add('hidden'); // Always hide for now
                } else {
                    detailsContainer.classList.add('hidden');
                }
            } else {
                detailsContainer.classList.add('hidden');
            }
        }

    },

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
            if (!confirm(`¿Seguro que quieres seleccionar ${rows.length} elementos ? Puede ser lento.`)) {
                return;
            }
        }

        let successCount = 0;
        let failCount = 0;

        rows.forEach((row, rowIdx) => {
            const index = row.dataset.rowIndex || row.dataset.originalIndex;
            console.log(`[FocusMode] Row ${rowIdx}: index = ${index}, dataset = `, row.dataset);

            if (index !== undefined) {
                let item = null;
                if (type === 'strategy') {
                    const originalIndex = parseInt(index, 10);
                    item = window.analysisResults?.find(r => r.originalIndex === originalIndex && !r.isPortfolio);
                    console.log(`[FocusMode] Strategy ${originalIndex}: `, item ? 'FOUND' : 'NOT FOUND');
                } else if (type === 'databank') {
                    const idx = parseInt(index, 10);
                    item = state.databankPortfolios[idx];
                    console.log(`[FocusMode] Databank ${idx}: `, item ? 'FOUND' : 'NOT FOUND');
                } else if (type === 'saved') {
                    const idx = parseInt(index, 10);
                    item = state.savedPortfolios[idx];
                    console.log(`[FocusMode] Saved ${idx}: `, item ? 'FOUND' : 'NOT FOUND');
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
                    console.warn(`[FocusMode] ❌ Could not find item for row index ${index} `);
                }
            } else {
                failCount++;
                console.warn(`[FocusMode] ❌ Row has no index attribute: `, row);
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

// Expose globally for UI coordination
window.focusMode = focusMode;

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
