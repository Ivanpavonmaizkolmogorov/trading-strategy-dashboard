import { state } from '../state.js';
import { dom } from '../dom.js';
import { renderEquityChart, renderScatterChart, renderLorenzChart, renderChartsForTab, renderPortfolioComparisonCharts, renderRealityCheckTab } from '../ui.js';
import { STRATEGY_COLORS } from '../config.js';
import { renderSQAnalysis } from './sqAnalysis_v2.js?v=5';

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

        // --- FIX: ALWAYS Refresh data from Global State ---
        // The item passed from click event might be stale (captured at render time).
        let freshItem = item;
        if (type === 'saved') {
            const index = item.index !== undefined ? item.index : state.savedPortfolios.findIndex(p => p.id === id);
            if (index !== -1 && state.savedPortfolios[index]) {
                freshItem = { ...state.savedPortfolios[index], index: index }; // Preserve index if active
                console.log(`[FocusMode] 🔄 Refreshed item data from state. Risk keys present?`, Object.keys(freshItem.riskPerStrategy || {}));
            }
        }

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

            this.focusedItems.set(id, { ...freshItem, type, rowElement, color });
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
            // REFRESH DATA: Ensure we use the latest state (e.g. for Risk Normalization updates)
            if (item.type === 'saved') {
                const freshItem = state.savedPortfolios.find(p => p.id === item.id);
                if (freshItem) {
                    // Update existing reference with fresh data properties
                    console.log(`[FocusMode] Refreshing data for ${item.name}. Risk present?`, !!freshItem.riskPerStrategy, freshItem.riskPerStrategy);
                    item.riskPerStrategy = freshItem.riskPerStrategy;
                    item.analysis = freshItem.analysis;
                    item.metrics = freshItem.metrics;

                    // Essential for Reality Check
                    item.realMetrics = freshItem.realMetrics;
                    item.linkedAccountId = freshItem.linkedAccountId;
                    item.linkedAccountId = freshItem.linkedAccountId;
                    item.linkedAccountName = freshItem.linkedAccountName;
                    item.strategyNames = freshItem.strategyNames; // CRITICAL: Propagate strategy names to UI

                    // === PORTFOLIO SMART CONNECT ===
                    // Proactively try to fuzzy-match ALL strategies in this portfolio
                    // This ensures the portfolio chart (which aggregates strategies) works even if strategies aren't clicked individually
                    if (item.realMetrics && item.realMetrics._tradesById && state.magicNumberMap) {
                        const availableKeys = Object.keys(item.realMetrics._tradesById);
                        let strategyNames = item.strategyNames || [];

                        // If no strategy names, try to resolve from indices if available
                        if (strategyNames.length === 0 && item.indices && window.analysisResults) {
                            strategyNames = item.indices.map(i => window.analysisResults[i]?.name).filter(Boolean);
                        }

                        // CRITICAL: Ensure these names are saved to the item for UI.js to use
                        if (strategyNames.length > 0) {
                            item.strategyNames = strategyNames;
                            console.log(`[FocusMode] 🧠 Pre-scanning ${strategyNames.length} strategies for portfolio '${item.name}'...`);
                            strategyNames.forEach(stratName => {
                                // Skip if already mapped
                                if (state.magicNumberMap[stratName]) return;

                                // findBestMatch now returns an array of matches (strings)
                                const matches = findBestMatch(stratName, null, availableKeys, item.realMetrics._tradesById);

                                if (matches && matches.length > 0) {
                                    state.magicNumberMap[stratName] = matches;
                                    console.log(`[FocusMode] 💾 Auto-mapped (Portfolio Scan): '${stratName}' -> [${matches.join(', ')}]`);
                                }
                            });
                        }
                    }
                } else {
                    console.warn(`[FocusMode] Could not find fresh item for ${item.id}`);
                }
            }


            let analysis = item.analysis || item.metrics;

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
                // Resolve Strategy ID
                let strategyId = item.id;
                // Try to find ID from loaded files if item has originalIndex
                if (item.originalIndex !== undefined && state.loadedStrategyFiles[item.originalIndex]) {
                    const file = state.loadedStrategyFiles[item.originalIndex];
                    strategyId = file.strategyId || file.name;
                } else if (!strategyId) {
                    strategyId = item.name;
                }

                let magicRaw = state.magicNumberMap[strategyId] || state.magicNumberMap[item.name];
                console.log(`[FocusMode] 🔍 Looking up real data for strategy: ${item.name} (ID: ${strategyId})`);

                // DEBUG MAP
                if (state.magicNumberMap) {
                    // console.log(`[FocusMode] Magic Number Map Keys (First 5): ${Object.keys(state.magicNumberMap).slice(0, 5)}`);
                    // console.log(`[FocusMode] Direct Lookup '${strategyId}':`, state.magicNumberMap[strategyId]);
                    // console.log(`[FocusMode] Name Lookup '${item.name}':`, state.magicNumberMap[item.name]);
                } else {
                    console.warn('[FocusMode] state.magicNumberMap is undefined!');
                }

                // FALLBACK: Smart Connection via Linked Portfolios
                // FALLBACK: Smart Connection via Linked Portfolios
                if (!magicRaw) {
                    // Find parent portfolio
                    const parentPortfolio = state.savedPortfolios.find(p =>
                        p.indices && p.indices.includes(item.originalIndex) &&
                        p.realMetrics && p.realMetrics._tradesById
                    );

                    if (parentPortfolio) {
                        const availableKeys = Object.keys(parentPortfolio.realMetrics._tradesById);

                        // Use Helper
                        const bestMatch = findBestMatch(item.name, strategyId, availableKeys, parentPortfolio.realMetrics._tradesById);

                        if (bestMatch) {
                            console.log(`[FocusMode] 🧠 Smart Connection (Fuzzy): Matched '${item.name}' to '${bestMatch}'`);

                            // CRITICAL: Save to map so UI.js can find it
                            if (!state.magicNumberMap[item.name]) {
                                state.magicNumberMap[item.name] = [bestMatch];
                                console.log(`[FocusMode] 💾 Auto-saved mapping to state.magicNumberMap`);
                            }

                            magicRaw = [bestMatch];
                        } else {
                            console.log('[FocusMode] 🧠 Smart Connection Failed. Available Keys in Portfolio:', availableKeys);
                            console.log(`[FocusMode] 🧠 Tried matching against: ${item.name} and ${strategyId}`);
                        }
                    }
                }

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
                indices: item.indices, // Pass indices for Saved Portfolios
                riskPerStrategy: item.riskPerStrategy, // Pass risk metrics for scaling
                strategyNames: item.strategyNames // CRITICAL: Pass strategy names to UI
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

        // --- SQ ANALYSIS UPDATE LOGIC ---
        // If a single strategy is selected, update the SQ Analysis view to focus on it.
        // We need to find the parent portfolio index to call renderSQAnalysis.
        // If multiple items are selected, or none, we might want to reset or show aggregate?
        // For now, let's focus on the single strategy case as requested.

        if (this.focusedItems.size === 1) {
            const item = this.focusedItems.values().next().value;
            if (item.type === 'strategy') {
                // We need to find which portfolio this strategy belongs to, or use the currently active portfolio index.
                // Usually, the strategies table is showing strategies from a specific portfolio (e.g. Saved Portfolio 0).
                // Let's try to get the active portfolio index from state or UI.
                // Or we can try to find the strategy in the loaded files to get its ID.

                let strategyId = item.id;
                // Try to find ID from loaded files if item has originalIndex
                if (item.originalIndex !== undefined && state.loadedStrategyFiles[item.originalIndex]) {
                    const file = state.loadedStrategyFiles[item.originalIndex];
                    strategyId = file.strategyId || file.name;
                } else if (!strategyId) {
                    strategyId = item.name;
                }

                // Assuming we are viewing the currently selected portfolio in the strategies table.
                // We can check if there is a 'currentPortfolioIndex' in state or similar.
                // But renderSQAnalysis takes 'portfolioIndex'.
                // If we are in 'saved' mode, we can try to find the portfolio that contains this strategy.
                // However, strategies might belong to multiple portfolios.
                // BUT, usually the user is drilling down into ONE portfolio.
                // Let's assume the first saved portfolio for now if we can't determine, OR better:
                // Check if 'state.currentPortfolioIndex' exists (it might not).
                // Let's look at how strategiesTable knows what to render. It uses 'window.analysisResults'.
                // If window.analysisResults comes from a portfolio, we might have a reference.

                // Fallback: If we can't find the portfolio index easily, we might skip this or default to 0.
                // But wait, the user is likely looking at a specific portfolio.
                // Let's try to pass the strategy ID to renderSQAnalysis, assuming the view is already set to the correct portfolio.
                // We can re-render the CURRENTLY visible portfolio with the new strategy filter.

                // How to know the current portfolio index for SQ Analysis?
                // We can store it in a global variable or data attribute when renderSQAnalysis is called.
                // Let's assume renderSQAnalysis has been called before (as seen in logs).
                // We can try to read the currently rendered portfolio index from the DOM if we stored it?
                // Or we can just try to update the existing view if we expose a method?
                // But I modified renderSQAnalysis to be the entry point.

                // Let's try to find the portfolio index that contains this strategy in 'state.savedPortfolios'.
                const parentPortfolioIndex = state.savedPortfolios.findIndex(p =>
                    p.strategyIds && p.strategyIds.includes(strategyId)
                );

                if (parentPortfolioIndex !== -1) {
                    console.log(`[FocusMode] Updating SQ Analysis for strategy: ${strategyId} in portfolio ${parentPortfolioIndex}`);
                    renderSQAnalysis(parentPortfolioIndex, 'saved', strategyId);
                } else {
                    // If not found by ID, maybe by name?
                    // Or maybe it's a databank portfolio?
                    console.warn(`[FocusMode] Could not find parent portfolio for strategy ${strategyId} to update SQ Analysis.`);
                }
            } else if (item.type === 'saved') {
                // If a Saved Portfolio is focused, update SQ Analysis to show that portfolio
                console.log(`[FocusMode] Updating SQ Analysis for focused portfolio index: ${item.index}`);
                renderSQAnalysis(item.index, 'saved', 'all');
            }
        } else {
            // If multiple or zero, maybe reset to 'all'?
            // We need to know which portfolio we were looking at.
            // This is tricky without state tracking.
            // For now, let's only handle the single selection case which is the user request.
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

        // Also reset SQ Analysis if needed?
        // If we knew the last portfolio index, we could call renderSQAnalysis(idx, 'saved', 'all');
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
                    if (!item.analysis && !item.metrics && type !== 'databank') {
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

// Helper for Smart Fuzzy Matching
function findBestMatch(strategyName, strategyId, availableKeys, tradesById) {
    if (!availableKeys || availableKeys.length === 0) return null;

    let bestMatch = null;
    let highestScore = 0;

    availableKeys.forEach(key => {
        // Clean names to improve matching score
        // Remove common suffixes: " - Improved X.X", ".csv", "(1)", etc.
        const cleanName = strategyName
            .replace(/ - Improved \d+(\.\d+)?/gi, '')
            .replace(/\(\d+\)/g, '')
            .replace(/\.csv$/i, '')
            .trim();

        // Try matching against Clean Name, Original Name, and ID
        const scoreClean = calculateSimilarity(cleanName, key);
        const scoreName = calculateSimilarity(strategyName, key);
        const scoreId = strategyId ? calculateSimilarity(strategyId, key) : 0;

        // Take the best score approach
        let score = Math.max(scoreClean, scoreName, scoreId);

        // Prioritize keys with more trades (heuristic to avoid empty test keys)
        // If tradesById is provided, check count
        if (tradesById) {
            const tradeCount = tradesById[key]?.length || 0;
            if (tradeCount < 5) score *= 0.5; // Penalize very small trade counts
        }

        if (score > 0.6) { // High confidence threshold for multi-match
            if (!bestMatch) bestMatch = [];
            bestMatch.push(key);
            // Keep track of the highest score just for reference or single-match fallback
            if (score > highestScore) highestScore = score;
        } else if (score > highestScore) {
            highestScore = score;
            bestMatch = [key]; // Reset if we find a better single match that isn't "high confidence" enough to keep others? 
            // Actually, let's simplify: Collect ALL reasonable matches > 0.4, but sort by score?
        }
    });

    // New Logic: Return ALL matches above threshold
    const allMatches = [];
    availableKeys.forEach(key => {
        // ... (same cleaning logic) ...
        const cleanName = strategyName
            .replace(/ - Improved \d+(\.\d+)?/gi, '')
            .replace(/\(\d+\)/g, '')
            .replace(/\.csv$/i, '')
            .trim();

        const scoreClean = calculateSimilarity(cleanName, key);
        const scoreName = calculateSimilarity(strategyName, key);
        const scoreId = strategyId ? calculateSimilarity(strategyId, key) : 0;
        let score = Math.max(scoreClean, scoreName, scoreId);

        if (tradesById) {
            const tradeCount = tradesById[key]?.length || 0;
            if (tradeCount < 5) score *= 0.5;
        }

        if (score > 0.35) { // Slightly stricter threshold for multi-match
            allMatches.push({ key, score });
        }
    });

    if (allMatches.length > 0) {
        // Sort by score descending
        allMatches.sort((a, b) => b.score - a.score);
        // Return just the keys
        return allMatches.map(m => m.key);
    }

    return null;
}

// Helper for Fuzzy Matching (Levenshtein Distance)
function calculateSimilarity(s1, s2) {
    if (!s1 || !s2) return 0;
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    if (longer.length === 0) return 1.0;

    const editDistance = (s1, s2) => {
        s1 = s1.toLowerCase();
        s2 = s2.toLowerCase();
        const costs = new Array();
        for (let i = 0; i <= s1.length; i++) {
            let lastValue = i;
            for (let j = 0; j <= s2.length; j++) {
                if (i == 0) costs[j] = j;
                else {
                    if (j > 0) {
                        let newValue = costs[j - 1];
                        if (s1.charAt(i - 1) != s2.charAt(j - 1))
                            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                        costs[j - 1] = lastValue;
                        lastValue = newValue;
                    }
                }
            }
            if (i > 0) costs[s2.length] = lastValue;
        }
        return costs[s2.length];
    }

    return (longer.length - editDistance(longer, shorter)) / longer.length;
}
