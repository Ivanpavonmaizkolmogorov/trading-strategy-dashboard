import { state } from '../state.js';
import { dom } from '../dom.js';
import { renderEquityChart, renderScatterChart, renderLorenzChart, renderChartsForTab, renderPortfolioComparisonCharts, renderRealityCheckTab, getRealTradesByName } from '../ui.js';
import { STRATEGY_COLORS } from '../config.js';
import { renderSQAnalysis, calculateSQMetrics, filterTradesByDate, parseTradesFromData } from './sqAnalysis_v2.js?v=11';
import { formatMetricForDisplay, toggleLoading } from '../utils.js';
import { getFullAnalysisFromBackend } from '../analysis.js';

/**
 * Helper: Search for trades in state.deepScanData by magic number(s)
 * Supports both legacy format (just magicNumber) and new format (accountId::magicNumber)
 * @param {string|string[]} magics - One or more magic numbers to search for
 * @returns {Object} { found: boolean, trades: Array, tradesById: Object, sourceName: string }
 */
function findTradesInDeepScanData(magics) {
    const magicList = Array.isArray(magics) ? magics : [magics];
    let allTrades = [];
    let tradesById = {};
    let sourceName = '';

    if (!state.deepScanData) return { found: false, trades: [], tradesById: {}, sourceName: '' };

    magicList.forEach(magic => {
        const key = String(magic).trim();

        // Check if this is a uniqueId format (accountId::magicNumber)
        if (key.includes('::')) {
            const [targetAccountId, magicNumber] = key.split('::');
            // Only search in the specific account
            const accountData = state.deepScanData[targetAccountId];
            if (accountData && accountData.tradesById && accountData.tradesById[magicNumber]) {
                const trades = accountData.tradesById[magicNumber];
                allTrades = allTrades.concat(trades);

                if (!tradesById[magicNumber]) {
                    tradesById[magicNumber] = trades;
                } else {
                    tradesById[magicNumber] = tradesById[magicNumber].concat(trades);
                }

                if (!sourceName) {
                    sourceName = accountData.sourceName || `Account ${targetAccountId}`;
                }
            }
        } else {
            // Legacy format: search in all accounts (backwards compatibility)
            Object.entries(state.deepScanData).forEach(([accountId, accountData]) => {
                if (!accountData.tradesById) return;

                if (accountData.tradesById[key]) {
                    const trades = accountData.tradesById[key];
                    allTrades = allTrades.concat(trades);

                    if (!tradesById[key]) {
                        tradesById[key] = trades;
                    } else {
                        tradesById[key] = tradesById[key].concat(trades);
                    }

                    if (!sourceName) {
                        sourceName = accountData.sourceName || `Account ${accountId}`;
                    }
                }
            });
        }
    });

    return {
        found: allTrades.length > 0,
        trades: allTrades,
        tradesById: tradesById,
        sourceName: sourceName
    };
}

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

    enable(item, type, rowElement, options = {}) {
        // ========== DIAGNOSTIC LOGS ==========
        console.log('%c[DIAG-FOCUS] ═══════════════════════════════════════', 'color: #ff00ff; font-weight: bold');
        console.log('%c[DIAG-FOCUS] focusMode.enable CALLED', 'color: #ff00ff; font-weight: bold');
        console.log('[DIAG-FOCUS] type:', type);
        console.log('[DIAG-FOCUS] item.name:', item.name);
        console.log('[DIAG-FOCUS] item.id:', item.id);
        console.log('[DIAG-FOCUS] item.originalIndex:', item.originalIndex);
        console.log('[DIAG-FOCUS] item.indices:', item.indices);
        console.log('[DIAG-FOCUS] state.activeViewMode:', state.activeViewMode);
        console.log('[DIAG-FOCUS] state.loadedStrategyFiles.length:', state.loadedStrategyFiles?.length);
        // ========== END DIAGNOSTIC LOGS ==========

        console.log('[FocusMode] enable() called. Type:', type, 'Item:', item.name || item.id, 'Options:', options);
        console.log('[FocusMode] Item Keys:', Object.keys(item));
        console.log('[FocusMode] Item CreationFilter:', item.creationFilter);
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
            // Deselect if already selected, unless forceSelect is true
            if (options.forceSelect) {
                console.log('[FocusMode] Item already selected, but forceSelect is TRUE. Keeping selection and updating data.');
                // Update data in place just in case
                const existing = this.focusedItems.get(id);

                // Toggle Logic Check
                let nextOverlayState = existing.showBacktestOverlay;
                if (options.toggleOverlay) {
                    // Inverse current state (default true if undefined)
                    const currentState = (existing.showBacktestOverlay !== false);
                    nextOverlayState = !currentState;
                    console.log(`[FocusMode] 🔀 Toggling Overlay for '${id}' to: ${nextOverlayState}`);
                }

                this.focusedItems.set(id, { ...existing, ...freshItem, type, rowElement, showBacktestOverlay: nextOverlayState });
            } else {
                console.log('[FocusMode] Item already selected, deselecting:', id);
                this.deselectItem(id);
            }
        } else {
            // Select new item
            console.log('[FocusMode] Selecting new item:', id);
            this.active = true;

            // Assign a color based on the number of currently selected items
            const colorIndex = this.focusedItems.size % STRATEGY_COLORS.length;
            const color = STRATEGY_COLORS[colorIndex];

            // Default showBacktestOverlay to true for individually focused items
            this.focusedItems.set(id, { ...freshItem, type, rowElement, color, showBacktestOverlay: true });
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

        // Return the current state of the item for UI updates
        return this.focusedItems.get(id);
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
     * Helper: Recalculate metrics based on a date range
     */
    /**
     * Helper: Recalculate metrics based on a date range using Standard Engine
     * @param {Object} analysis - Analysis object (may contain trades)
     * @param {Object} filter - Date filter {start, end}
     * @param {Array} [tradesArg] - Optional trades array if not in analysis
     */
    async recalculateMetrics(analysis, filter, tradesArg) {
        // [FIX] Handle asynchronous nature by returning a Promise
        // But for Curve Fallback, we can return immediately if trades are missing.
        // Changing to synchronous for curve fallback scenario to ensure immediate UI update
        // when trades are missing (common in Databank).

        if (!filter || (!filter.start && !filter.end)) return null;
        if (!filter || (!filter.start && !filter.end)) return null;

        // 1. Resolve Trades
        const trades = tradesArg || (analysis ? analysis.trades : null);

        if (!trades || !Array.isArray(trades) || trades.length === 0) {
            console.warn('[FocusMode] ⚠️ recalculateMetrics: No trades available for Engine. Falling back to Curve.');
            return this.recalculateMetricsFromCurve(analysis, filter);
        }

        // 2. Filter Trades LOCALLY first to reduce payload size
        const filteredTrades = filterTradesByDate(trades, filter.start, filter.end);

        if (!filteredTrades || filteredTrades.length === 0) return null;

        console.log(`[FocusMode] ⚙️ Backend Engine Input: ${filteredTrades.length} trades. Fetching...`);

        try {
            // 3. CALL BACKEND ENGINE (Async)
            // We verify normalization flags from DOM or state if needed, but for "Optimized View",
            // we usually just want the raw metrics for the specific date range.
            // If normalization is active globally, we should respect it.
            const isRiskNormalized = dom.normalizeRiskCheckbox ? dom.normalizeRiskCheckbox.checked : false;
            const targetMaxDD = isRiskNormalized ? parseFloat(document.getElementById('target-max-dd').value) : 0;

            // Strategy Name for logging
            const stratName = (analysis && analysis.name) ? analysis.name : 'OptimizedViewStrategy';

            // Construct payload: ONE strategy (the filtered trades)
            // Backend expects array of strategies.
            // getFullAnalysisFromBackend(strategies, portfolios, isRiskNormalized, targetMaxDD)
            const backendResults = await getFullAnalysisFromBackend([filteredTrades], [], isRiskNormalized, targetMaxDD);

            if (!backendResults || backendResults.length === 0) {
                console.error('[FocusMode] ❌ Backend returned empty results.');
                return null;
            }

            const engineMetrics = backendResults[0]; // First strategy result

            if (!engineMetrics) return null;

            console.log(`[FocusMode] ⚖️ Backend Metrics Received. Profit: ${engineMetrics.totalProfit}, MaxDD: ${engineMetrics.maxDrawdownInDollars}, GFS: ${engineMetrics.gammaFlowScore}`);

            // 4. Return Metrics (Mapping Backend Keys to Frontend Expectations)
            const scaledMetrics = {
                ...engineMetrics,
                // Standardize Keys
                netProfit: engineMetrics.totalProfit,
                totalProfit: engineMetrics.totalProfit,
                maxDrawdownInDollars: engineMetrics.maxDrawdownInDollars || engineMetrics.maxDD, // Backend key might vary
                maxDD: engineMetrics.maxDrawdownInDollars || engineMetrics.maxDD,

                // Aliases
                NetProfit: engineMetrics.totalProfit,
                'Net Profit': engineMetrics.totalProfit,
                MaxDD: engineMetrics.maxDrawdownInDollars,
                'Max DD': engineMetrics.maxDrawdownInDollars,
                TotalTrades: engineMetrics.totalTrades,
                winningPercentage: engineMetrics.winningPercentage || engineMetrics.winRate, // Backend usually sends winningPercentage? Check.
                returnDD: engineMetrics.returnDD,

                // Advanced Metrics (Backend specific)
                gammaFlowScore: engineMetrics.gammaFlowScore,
                sharpeRatioTrade: engineMetrics.sharpeRatioTrade || engineMetrics.sharpeRatio, // Fallback
                upi: engineMetrics.upi,
                sortinoRatio: engineMetrics.sortinoRatio,
                maxStagnationTrades: engineMetrics.maxStagnationTrades,
                maxStagnationDays: engineMetrics.maxStagnationDays,
                maxConsecutiveLosses: engineMetrics.maxConsecutiveLosses
            };

            return scaledMetrics;

        } catch (e) {
            console.error('[FocusMode] 💥 Error fetching backend metrics:', e);
            return null;
        }
    },

    /**
     * Fallback: Recalculate metrics from Equity Curve (Approximation)
     * Used when trade list is unavailable.
     */
    recalculateMetricsFromCurve(analysis, filter) {
        if (!analysis || !analysis.chartData || !analysis.chartData.equityCurve) return null;

        const startTs = filter.start ? new Date(filter.start).getTime() : -Infinity;
        const endTs = filter.end ? new Date(filter.end).getTime() + 86399999 : Infinity;

        // Filter Equity Curve
        const filteredCurve = analysis.chartData.equityCurve.filter(pt => {
            let t;
            if (typeof pt === 'object') {
                if ('x' in pt) t = pt.x;
                else if ('date' in pt) t = pt.date;
                else if (Array.isArray(pt)) t = pt[0];
            }
            if (typeof t === 'string' && isNaN(t)) t = new Date(t).getTime();
            return t >= startTs && t <= endTs;
        });

        if (filteredCurve.length === 0) return null;

        // Apply Denormalization Scaling
        const initialBalance = (analysis.metrics && analysis.metrics.initial_balance) ? analysis.metrics.initial_balance : 10000;
        const scale = (val) => {
            // [ROBUST] Handle undefined or null
            if (val === undefined || val === null) return 0;
            // If value is percentage (e.g. 5.5%), convert to dollars: (5.5 / 100) * 10000 = 550
            return (val / 100.0) * initialBalance;
        };

        // [ROBUST] Helper to get Y value from point
        const getVal = (pt) => {
            if (typeof pt === 'number') return pt;
            if (Array.isArray(pt)) return pt[1];
            if (pt && typeof pt === 'object') {
                if ('y' in pt) return pt.y;
                if ('value' in pt) return pt.value;
                if ('balance' in pt) return pt.balance;
                if ('close' in pt) return pt.close;
                // Fallback if index 1 exists (tuple-like object with numeric keys?)
                if (1 in pt) return pt[1];
            }
            return 0;
        };

        // Recalculate
        const first = getVal(filteredCurve[0]);
        const last = getVal(filteredCurve[filteredCurve.length - 1]);

        const firstScaled = scale(first);
        const lastScaled = scale(last);

        // [FIX] Ensure we return Dollars if the curve was Percentage (which it is for Databank portfolios)
        // If 'maxDD' comes from scaled values, it is in Dollars.
        // If the original curve was Percentage, 'scale' function handles conversion (Val / 100 * Bal).
        // So 'profit' and 'maxDD' here are DOLLARS.
        const profit = lastScaled - firstScaled;

        console.log(`[FocusMode] Recalc Internal: StartRaw=${first}, EndRaw=${last}, StartScaled=${firstScaled}, EndScaled=${lastScaled}, NetProfit=${profit}`);

        // Calc DD
        let peak = -Infinity;
        let maxDD = 0;

        filteredCurve.forEach(pt => {
            const valScaled = scale(getVal(pt));
            if (valScaled > peak) peak = valScaled;
            const dd = peak - valScaled;
            if (dd > maxDD) maxDD = dd;
        });

        // Log diagnosis
        // console.log(`[FocusMode] From Curve: Start=${firstScaled}, End=${lastScaled}, Profits=${profit}, DD=${maxDD}`);

        return {
            ...analysis.metrics, // [FIX] Spread ORIGINAL metrics FIRST
            netProfit: profit,
            drawdown: maxDD,
            totalTrades: filteredCurve.length,
            NetProfit: profit,
            'Net Profit': profit,
            MaxDD: maxDD,
            'Max DD': maxDD,
            TotalTrades: filteredCurve.length,
            // [FIX] Aliases for Table Compatibility
            totalProfit: profit,
            maxDrawdownInDollars: maxDD
        };
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
     * Render the floating banner (DISABLED per user request)
     */
    renderBanner() {
        // Disabled per user request
        this.removeBanner();
        return;
    },
    /**
     * Helper to ensure global filter exists
     */
    ensureGlobalFilter(item) {
        const sId = item.id || item.name;
        if (!state.strategyDateRanges) state.strategyDateRanges = {};

        if (!state.strategyDateRanges[sId] && !state.strategyDateRanges[item.name]) {
            // Default to full range if no global filter exists yet
            if (item.analysis && item.analysis.trades && item.analysis.trades.length > 0) {
                const trades = item.analysis.trades;
                let minD = Infinity;
                let maxD = -Infinity;

                trades.forEach(t => {
                    const dStr = t.date || t.exit_date;
                    if (dStr) {
                        const d = new Date(dStr).getTime();
                        if (!isNaN(d)) {
                            if (d < minD) minD = d;
                            if (d > maxD) maxD = d;
                        }
                    }
                });

                if (minD !== Infinity) {
                    const startStr = new Date(minD).toISOString().split('T')[0];
                    const endStr = new Date(maxD).toISOString().split('T')[0];

                    // Set GLOBAL state
                    state.strategyDateRanges[sId] = { start: startStr, end: endStr };
                    console.log(`[FocusMode] Initialized Global Filter for ${sId}: ${startStr} - ${endStr}`);
                }
            }
        }
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
    async updateCharts() {
        // ========== DIAGNOSTIC LOGS ==========
        console.log('%c[DIAG-PNL] ═══════════════════════════════════════', 'color: #ffff00; font-weight: bold; background: #333');
        console.log('%c[DIAG-PNL] focusMode.updateCharts CALLED (Async)', 'color: #ffff00; font-weight: bold; background: #333');
        console.log('[DIAG-PNL] focusedItems.size:', this.focusedItems.size);
        // ========== END DIAGNOSTIC LOGS ==========

        if (this.focusedItems.size === 0) return;

        // Show loading state if we are likely to hit the backend (Optimized view active)
        const isOptimizedView = Array.from(this.focusedItems.values()).some(i => i.viewMode === 'optimized');
        if (isOptimizedView) {
            toggleLoading(true, 'Synchronizing...', 'Fetching exact metrics from Backend Engine');
        }

        try {
            // Ensure the main viewer is visible (it should be by default)
            if (dom.viewerContainer) {
                dom.viewerContainer.classList.remove('hidden');
            }

            // Prepare data for renderPortfolioComparisonCharts
            // Use Promise.all to handle async backend calls in parallel
            const analysesPromises = Array.from(this.focusedItems.values()).map(async (item) => {
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

                // 1. REHYDRATION / RECONSTRUCTION (Must happen BEFORE filtering)

                // For DataBank items, compute the portfolio by combining individual strategies
                // CRITICAL: This must happen first so we have a base "Full History" analysis to potentially filter later.
                // We force this if we haven't confirmed it's a full reconstruction yet (flag isFullReconstructed).
                if (item.type === 'databank' && item.indices && (!analysis || !analysis.isFullReconstructed)) {
                    console.log('[FocusMode] DataBank item detected, computing portfolio from indices:', item.indices);

                    // Get individual strategies
                    const strategies = item.indices.map(idx => window.analysisResults[idx]).filter(Boolean);

                    if (strategies.length > 0) {
                        console.log(`[FocusMode] Found ${strategies.length} strategies to combine`);

                        // Combine equity curves - ROBUST METHOD: Sum of Cumulative PnL (Date-Aligned)
                        // Averaging balances works poorly if strategies start at different times (causes drops/sinkholes).

                        const pnlMaps = []; // Array of Map<Timestamp, PnL_Value>
                        const allTimestamps = new Set();
                        let allTrades = []; // [FIX] Collect all trades for engine

                        strategies.forEach(strat => {
                            // [FIX] Collect trades (try multiple sources)
                            // [FIX] Collect trades (Robust)
                            let stratTrades = [];
                            if (strat.trades && Array.isArray(strat.trades)) {
                                stratTrades = strat.trades;
                            } else if (strat.analysis && strat.analysis.trades) {
                                stratTrades = strat.analysis.trades;
                            } else if (state.rawStrategiesData) {
                                // Try Index
                                const idx = strat.originalIndex;
                                if (idx !== undefined && state.rawStrategiesData[idx] && state.rawStrategiesData[idx].trades) {
                                    stratTrades = state.rawStrategiesData[idx].trades;
                                }
                                // Try Name Matching if index fails
                                else if (state.loadedStrategyFiles) {
                                    const fileMatch = state.loadedStrategyFiles.find(f => f.name === strat.name);
                                    if (fileMatch && state.rawStrategiesData[fileMatch.index]?.trades) {
                                        stratTrades = state.rawStrategiesData[fileMatch.index].trades;
                                        // console.log(`[FocusMode] 🔦 Found trades via name match for ${strat.name}`);
                                    } else {
                                        console.warn(`[FocusMode] ⚠️ Name match failed for ${strat.name}`);
                                    }
                                }
                            }

                            // [FIX] Self-Healing: If still no trades, try parsing raw CSV data directly
                            if (stratTrades.length === 0 && strat.originalIndex !== undefined && state.rawStrategiesData && state.rawStrategiesData[strat.originalIndex]) {
                                const rawData = state.rawStrategiesData[strat.originalIndex];
                                if (Array.isArray(rawData)) {
                                    try {
                                        const parsed = parseTradesFromData(rawData);
                                        if (parsed && parsed.length > 0) {
                                            stratTrades = parsed;
                                            console.log(`[FocusMode] 🩹 Self-Healing: Parsed ${stratTrades.length} trades from raw CSV for ${strat.name}`);
                                        }
                                    } catch (e) {
                                        console.error(`[FocusMode] ❌ Self-Healing failed for ${strat.name}:`, e);
                                    }
                                }
                            }

                            // [FIX] Ultimate Self-Healing: if we still don't have trades, it might be due to window.analysisResults indices drift.
                            // Let's try to match by name on the loaded files.
                            if (stratTrades.length === 0 && state.loadedStrategyFiles) {
                                const fallBackIndex = state.loadedStrategyFiles.findIndex(f => f.name === strat.name);
                                if (fallBackIndex !== -1 && state.rawStrategiesData && state.rawStrategiesData[fallBackIndex]) {
                                    const rawData = state.rawStrategiesData[fallBackIndex];
                                    if (Array.isArray(rawData)) {
                                        try {
                                            const parsed = parseTradesFromData(rawData);
                                            if (parsed && parsed.length > 0) {
                                                stratTrades = parsed;
                                                console.log(`[FocusMode] 🚑 Ultimate Self-Healing (Index Drift): Parsed ${stratTrades.length} trades for ${strat.name}`);
                                            }
                                        } catch (e) {
                                            console.error(`[FocusMode] ❌ Ultimate Self-Healing failed for ${strat.name}:`, e);
                                        }
                                    }
                                }
                            }

                            if (stratTrades.length > 0) {
                                console.log(`[FocusMode] ✅ Got ${stratTrades.length} trades for ${strat.name}`);
                                allTrades = allTrades.concat(stratTrades);
                            } else {
                                console.warn(`[FocusMode] ❌ Could not find trades for strategy: ${strat.name}. OrigIdx: ${strat.originalIndex}`);
                            }

                            if (strat.analysis?.chartData?.equityCurve && strat.analysis.chartData.equityCurve.length > 0) {
                                const curve = strat.analysis.chartData.equityCurve;
                                const startBal = curve[0].y; // Assume first point is initial balance
                                const map = new Map();

                                curve.forEach(pt => {
                                    let t;
                                    if (typeof pt.x === 'string') t = new Date(pt.x).getTime();
                                    else t = pt.x; // Assume timestamp

                                    // Store Cumulative Profit (Balance - StartBalance)
                                    map.set(t, pt.y - startBal);
                                    allTimestamps.add(t);
                                });
                                pnlMaps.push(map);
                            }
                        });

                        // Sort unique timestamps
                        const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

                        // Build Combined Curve
                        // We simply SUM the Cumulative PnL of all active strategies at each timestamp.
                        // This assumes "Portfolio Profit" = Sum(Strategy Profits).
                        // This does NOT account for "closed" strategies properly if they stop reporting data, 
                        // but for Databank/Backtest, usually data persists to end or we assume last value holds.
                        // Better: If a strategy has no data at T, assume it contributes its LAST KNOWN PnL (or 0 if not started).

                        const combinedEquityCurve = [];
                        const lastKnownPnL = new Array(pnlMaps.length).fill(0);
                        const started = new Array(pnlMaps.length).fill(false); // Track if strategy has started

                        // Base Balance for Portfolio (e.g. 10000)
                        // We can just plot Profit, or Balance. Let's start at 0 Profit.

                        sortedTimestamps.forEach(t => {
                            let currentTotalPnL = 0;

                            pnlMaps.forEach((map, idx) => {
                                if (map.has(t)) {
                                    lastKnownPnL[idx] = map.get(t);
                                    started[idx] = true;
                                } else {
                                    // If strategy hasn't started yet, its contribution is 0.
                                    // If it HAS started but has a gap, we hold last value? 
                                    // For standard "Sum of Curves", holding last value is safer if we assume flat equity during gaps.
                                    // If we assume gap = 0 PnL change, then holding last Cumulative PnL is correct.
                                }

                                if (started[idx]) {
                                    currentTotalPnL += lastKnownPnL[idx];
                                }
                            });

                            // Convert to string date/iso if needed, but timestamp is safer for logic
                            // const isoDate = new Date(t).toISOString();

                            // [FIX] NORMALIZE TO PERCENTAGE
                            // The UI and Metrics Scaler expect the Equity Curve to be in "Percentage Growth" relative to 10000.
                            // (Value / 100) * 10000 = Absolute.
                            // So: (Absolute / 10000) * 100 = Percentage.
                            // const baseCapital = 10000; // Defined outside loop now
                            const percentageVal = (currentTotalPnL / 10000) * 100.0;

                            combinedEquityCurve.push({
                                x: t,
                                y: percentageVal // Storing as % allows existing scaling logic to work correctly
                            });
                        });

                        // Update UI often expects "Balance" curve starting at ~10000.
                        // But our 'y' is now Percentage.
                        // The UI chart adapter (ui.js / renderPortfolioComparisonCharts) does:
                        // scale = (val / 100) * 10000.
                        // If y=0, scale=0. We want scale=10000 (Initial Balance)?
                        // Actually, ui.js adds previous balance in some modes, but usually it plots "Profit + 10000" or similar.
                        // Let's check 'recalculateMetricsFromCurve': it takes (last - first).
                        // If first=0 (%), last=10 (%), diff=10%. Scaled Diff = (10/100)*10000 = 1000. Correct Profit.

                        // However, for the CHART (Visual), usually it expects the points to be "Growth".
                        // If we want the chart to start at 10000, we interpret it as Balance.
                        // If we start at 0, it's relative PnL.
                        // Existing curves usually start at 10000 (100%?? No, 10000 is 0% growth? or 100% of capital?)
                        // Let's look at standard strategies: usually they are normalized to 10000 start?
                        // If simple strategies are stored as %:
                        // 10000 -> 0% change? Or 10000 is the value?
                        // 'recalculateMetricsFromCurve' assumes: scale(pt.y).
                        // If pt.y is 10000, scale(10000) = (10000/100)*10000 = 1,000,000. That's huge.
                        // So pt.y MUST be typically small (like 100 for 10000?).
                        // If the curve starts at 10000 (Balance), then scale() breaks it.
                        // Wait, standard SQ strategies might store equity as "10000, 10050, ...".
                        // If so, scale(10000) is huge.
                        // Maybe 'recalculateMetricsFromCurve' is ONLY for normalized curves?
                        // Let's assume standard behavior:
                        // If I store % (0, 1.5, ...), scale works for PnL.
                        // But for the Chart Visual, we might need to shift it?
                        // For now, storing as % (starting at 0) fixes the PnL Metric bug (1022 vs 102296).
                        // The chart might look like it starts at 0.

                        const baseCapital = 10000; // Moved up
                        combinedEquityCurve.forEach(pt => pt.y += baseCapital);

                        // Create a synthetic analysis object if it doesn't exist
                        if (!analysis) analysis = {};

                        // Assign Chart Data
                        analysis.chartData = {
                            equityCurve: combinedEquityCurve
                        };

                        // Mark as Fully Reconstructed so we don't redo this unnecessarily, 
                        // BUT we do it once to ensure we have the full history base.
                        analysis.isFullReconstructed = true;

                        // COMPUTE METRICS FOR FULL HISTORY (Synthetic)
                        // We need at least Net Profit and Max DD to show correct values in "Full View"
                        if (combinedEquityCurve.length > 0) {
                            const firstVal = combinedEquityCurve[0].y;
                            const lastVal = combinedEquityCurve[combinedEquityCurve.length - 1].y;
                            const totalProfit = lastVal - firstVal;

                            // Compute MaxDD
                            let peak = -Infinity;
                            let maxDD = 0;
                            combinedEquityCurve.forEach(pt => {
                                if (pt.y > peak) peak = pt.y;
                                const dd = peak - pt.y;
                                if (dd > maxDD) maxDD = dd;
                            });

                            const syntheticMetrics = {
                                netProfit: totalProfit,
                                totalProfit: totalProfit,
                                NetProfit: totalProfit,
                                maxDD: maxDD,
                                MaxDD: maxDD,
                                maxDD: maxDD,
                                MaxDD: maxDD,
                                drawdown: maxDD,
                                // [FIX] Aliases
                                maxDrawdownInDollars: maxDD,
                                totalTrades: strategies.reduce((acc, s) => acc + (s.metrics?.totalTrades || 0), 0), // Sum of trades
                                TotalTrades: strategies.reduce((acc, s) => acc + (s.metrics?.totalTrades || 0), 0)
                            };

                            // [FIX] Assign aggregated trades to analysis
                            analysis.trades = allTrades;

                            // Overwrite with Full Stats
                            analysis.metrics = syntheticMetrics;

                            console.log(`[FocusMode] 🧮 Computed Synthetic Metrics for Full View: Profit=${totalProfit.toFixed(2)}, MaxDD=${maxDD.toFixed(2)}`);
                        }

                        // Update the item reference so we don't re-compute every time (caching)
                        item.analysis = analysis;

                        console.log('[FocusMode] ✅ Successfully computed DataBank portfolio analysis (Sum of PnL)');
                    } else {
                        console.warn('[FocusMode] ❌ No strategies found for indices:', item.indices);
                    }
                }

                // Fallback: If still no analysis, try to look up in state
                if (item.type === 'databank' && !analysis) {
                    const databankItem = state.databankPortfolios?.find(p => p.name === item.name);
                    if (databankItem && databankItem.analysis) {
                        analysis = databankItem.analysis;
                        console.log('[FocusMode] ✅ Found analysis in state.databankPortfolios (fallback)');
                    } else {
                        console.error('[FocusMode] ❌ Could not find analysis for DataBank item (fallback)');
                        return; // Skip this item
                    }
                }

                // 2. TOGGLE VIEW LOGIC: Apply Date Filter to Analysis if needed
                // This now acts on the "analysis" object which (thanks to step 1) should contain the Full History.
                let activeFilterForTable = null;
                if (item.creationFilter) {
                    activeFilterForTable = item.creationFilter;
                } else if (item.viewMode === 'optimized' && state.strategyDateRanges) {
                    // Resolve from Global State
                    const sId = item.id || item.name;
                    activeFilterForTable = state.strategyDateRanges[sId] || state.strategyDateRanges[item.name];
                }

                if (activeFilterForTable) {
                    const filter = activeFilterForTable;

                    // We need to filter the equity curve AND recalculate metrics
                    if (analysis && analysis.chartData && analysis.chartData.equityCurve) {
                        const startTs = new Date(filter.start).getTime();
                        // End date should include the full day (23:59:59.999), 
                        // BUT be careful: if filter.end is "2026-01-25", calling new Date() gives midnight.
                        // We want to include trades on that day.
                        const endTs = new Date(filter.end).getTime() + (24 * 60 * 60 * 1000) - 1;

                        const filteredCurve = analysis.chartData.equityCurve.filter(pt => {
                            // Handle various point formats
                            let t;
                            if (typeof pt === 'object') {
                                if ('x' in pt) t = pt.x;
                                else if ('date' in pt) t = pt.date;
                                else if (Array.isArray(pt)) t = pt[0];
                            }
                            if (typeof t === 'string' && isNaN(t)) t = new Date(t).getTime();
                            return t >= startTs && t <= endTs;
                        });

                        // Normalize Filtered Curve (Offset to start at 0)
                        if (filteredCurve.length > 0) {
                            const startVal = filteredCurve[0].y;
                            // Clone to avoid mutating original objects
                            const normalizedCurve = filteredCurve.map(pt => ({ x: pt.x, y: pt.y - startVal }));

                            // Get recalculated metrics (reuse helper)
                            const newMetrics = this.recalculateMetrics(analysis, filter);

                            // Merge metrics carefully - prioritize recalculated ones
                            const mergedMetrics = { ...analysis.metrics, ...(newMetrics || {}) };

                            // Create a Shadow Analysis object
                            analysis = {
                                ...analysis,
                                metrics: mergedMetrics,
                                chartData: {
                                    ...analysis.chartData,
                                    equityCurve: normalizedCurve
                                }
                            };
                            console.log(`[FocusMode] 🎯 Showing Optimized View (${normalizedCurve.length} points). Range: ${filter.start} - ${filter.end}`);
                        } else {
                            console.warn('[FocusMode] ⚠️ Filter resulted in empty curve. Reverting to full.');
                        }
                    }
                }

                // [FIX-v2] For Databank items, the analysis.metrics contains NORMALIZED values
                // (e.g., Profit=5.37 instead of $35,837) computed from raw CSV PnL.
                // We must NOT overwrite the backend's correct dollar-denominated p.metrics.
                // Only store the analysis for CHART rendering purposes.
                if (item.type === 'databank') {
                    // Store the analysis on the item for chart use, but DON'T touch metrics
                    if (analysis) {
                        item.analysis = analysis;
                        // Also store on the global state item for chart access
                        const globalItem = state.databankPortfolios?.find(p => p.name === item.name);
                        if (globalItem) {
                            globalItem.analysis = analysis;
                        }
                    }
                    console.log(`[FocusMode] 📊 DataBank: Stored analysis for charts only. NOT overwriting table metrics.`);
                } else if (item.type === 'saved' && analysis && analysis.metrics && item.viewMode !== 'optimized') {
                    // For saved portfolios, propagation is safe (metrics come from full backend analysis)
                    item.metrics = { ...item.metrics, ...analysis.metrics };

                    if (analysis.metrics.totalProfit !== undefined) item.totalProfit = analysis.metrics.totalProfit;
                    if (analysis.metrics.maxDrawdownInDollars !== undefined) item.maxDrawdownInDollars = analysis.metrics.maxDrawdownInDollars;
                    if (analysis.metrics.totalTrades !== undefined) item.totalTrades = analysis.metrics.totalTrades;
                    if (analysis.metrics.sharpeRatio !== undefined) item.sharpeRatio = analysis.metrics.sharpeRatio;
                    if (analysis.metrics.profitFactor !== undefined) item.profitFactor = analysis.metrics.profitFactor;
                    if (analysis.metrics.cagr !== undefined) item.cagr = analysis.metrics.cagr;
                    if (analysis.metrics.sqn !== undefined) item.sqn = analysis.metrics.sqn;
                    if (analysis.metrics.returnDD !== undefined) item.returnDD = analysis.metrics.returnDD;
                    if (analysis.metrics.winningPercentage !== undefined) item.winningPercentage = analysis.metrics.winningPercentage;
                    if (analysis.metrics.gammaFlowScore !== undefined) item.gammaFlowScore = analysis.metrics.gammaFlowScore;
                    if (analysis.metrics.maxStagnationTrades !== undefined) item.maxStagnationTrades = analysis.metrics.maxStagnationTrades;
                    if (analysis.metrics.maxStagnationDays !== undefined) item.maxStagnationDays = analysis.metrics.maxStagnationDays;
                    if (analysis.metrics.maxConsecutiveLosses !== undefined) item.maxConsecutiveLosses = analysis.metrics.maxConsecutiveLosses;
                    if (analysis.metrics.upi !== undefined) item.upi = analysis.metrics.upi;
                    if (analysis.metrics.sortinoRatio !== undefined) item.sortinoRatio = analysis.metrics.sortinoRatio;
                    if (analysis.metrics.sharpeRatioTrade !== undefined) item.sharpeRatioTrade = analysis.metrics.sharpeRatioTrade;

                    console.log(`[FocusMode] 🔄 Propagated metrics to saved item ${item.name}: Profit=${item.totalProfit}, Trades=${item.totalTrades}`);
                }

                // Determine savedIndex for correct color assignment in UI
                let savedIndex = item.savedIndex;
                if (item.type === 'saved' && savedIndex === undefined) {
                    // Try to find index in state based on ID
                    savedIndex = state.savedPortfolios.findIndex(p => p.id === item.id);
                }

                // REHYDRATION: If strategy item lacks analysis (e.g., Virtual Strategy from Reality Check), try to find it
                if (item.type === 'strategy' && !item.analysis && window.analysisResults) {
                    // Helper to check if analysis is valid (has actual data)
                    const isValidAnalysis = (r) => {
                        // Check if analyzing a direct strategy object or a wrapped result
                        const analysis = r.analysis || r;
                        return analysis &&
                            analysis.chartData &&
                            analysis.chartData.equityCurve &&
                            analysis.chartData.equityCurve.length > 0;
                    };

                    // Try to find by originalIndex first
                    if (item.originalIndex !== undefined && item.originalIndex !== -1 && window.analysisResults[item.originalIndex] && isValidAnalysis(window.analysisResults[item.originalIndex])) {
                        item.analysis = window.analysisResults[item.originalIndex].analysis;
                        console.log(`[FocusMode] 💧 Rehydrated analysis from originalIndex: ${item.originalIndex}`);
                    }
                    // Fallback: Find by Name (with fuzzy .csv matching)
                    else if (item.name) {
                        // Helper for fuzzy match
                        const isMatch = (target, query) => {
                            if (!target || !query) return false;
                            if (target === query) return true;
                            if (target === query + '.csv') return true;
                            if (target.replace('.csv', '') === query) return true;
                            if (query.replace('.csv', '') === target) return true;
                            return false;
                        };

                        // 1. Check window.analysisResults
                        let found = window.analysisResults.find(r => isMatch(r.name, item.name) && isValidAnalysis(r));
                        let source = 'window.analysisResults';

                        // 2. Check state.strategies
                        if (!found && state.strategies) {
                            found = state.strategies.find(s => isMatch(s.name, item.name) && isValidAnalysis(s));
                            source = 'state.strategies';
                        }

                        // 3. Check inside Saved Portfolios (Deep Scan)
                        if (!found && state.savedPortfolios) {
                            for (const p of state.savedPortfolios) {
                                if (p.strategies && Array.isArray(p.strategies)) {
                                    const strat = p.strategies.find(s => isMatch(s.name, item.name) && isValidAnalysis(s));
                                    if (strat) {
                                        found = strat;
                                        source = `SavedPortfolio(${p.name})`;
                                        break;
                                    }
                                }
                            }
                        }

                        if (found && found.analysis) {
                            item.analysis = found.analysis;
                            // Also hydrate other missing props if available
                            if (!item.metrics && found.metrics) item.metrics = found.metrics;

                            console.log(`[FocusMode] 💧 Rehydrated analysis from ${source}: ${item.name} -> ${found.name} (${found.analysis.chartData.equityCurve.length} pts)`);
                        } else {
                            console.warn(`[FocusMode] ⚠️ Method 'enable' failed to find VALID backtest analysis for: ${item.name}`);
                        }
                    }
                }

                // REALITY CHECK FOR STRATEGIES: Attach Real Metrics if available
                let realMetrics = null;

                // PRIORITY 1: Use pre-calculated realMetrics from the strategy item itself (from strategiesTable Late Binding)
                if (item.type === 'strategy' && item.realMetrics && item.realMetrics._aggregatedTrades) {
                    console.log(`[FocusMode] ♻️ Using pre-calculated realMetrics from strategy: ${item.name} (${item.realMetrics._aggregatedTrades.length} trades)`);
                    realMetrics = item.realMetrics;
                }
                // PRIORITY 2: Fall back to lookup via magicNumberMap
                else if (item.type === 'strategy' && state.magicNumberMap) {
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
                            ((p.indices && item.originalIndex !== undefined && item.originalIndex !== -1 && p.indices.includes(item.originalIndex)) ||
                                (p.strategyNames && p.strategyNames.includes(item.name))) &&
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
                            // FALLBACK: Search in deepScanData (Multi-Account persistence)
                            console.log(`[FocusMode] 🔍 No portfolio found, searching in deepScanData...`);
                            const deepScanResult = findTradesInDeepScanData(magics);

                            if (deepScanResult.found) {
                                console.log(`[FocusMode] ✅ Found ${deepScanResult.trades.length} trades in deepScanData (${deepScanResult.sourceName})`);

                                const strategyTrades = deepScanResult.trades;
                                const tradesById = deepScanResult.tradesById;

                                // Calculate stats - ensure numeric conversion for trade values that may be strings
                                const profit = strategyTrades.reduce((sum, t) => sum + (parseFloat(t.profit) || 0) + (parseFloat(t.swap) || 0) + (parseFloat(t.commission) || 0), 0);

                                // Calculate drawdown
                                strategyTrades.sort((a, b) => new Date(a.closeTime) - new Date(b.closeTime));
                                let currentEq = 0;
                                let maxEq = 0;
                                let maxDD = 0;

                                strategyTrades.forEach(t => {
                                    const p = (parseFloat(t.profit) || 0) + (parseFloat(t.swap) || 0) + (parseFloat(t.commission) || 0);
                                    currentEq += p;
                                    if (currentEq > maxEq) maxEq = currentEq;
                                    const dd = maxEq - currentEq;
                                    if (dd > maxDD) maxDD = dd;
                                });

                                realMetrics = {
                                    _tradesById: tradesById,
                                    profit: profit,
                                    drawdown: maxDD,
                                    trades: strategyTrades.length,
                                    profitFactor: 0,
                                    sharpe: 0,
                                    lastSync: new Date().toISOString()
                                };
                                console.log(`[FocusMode] ✅ Real Metrics from deepScanData for ${item.name}: Profit=${parseFloat(profit).toFixed(2)}, DD=${parseFloat(maxDD).toFixed(2)}, Trades=${strategyTrades.length}`);
                            } else {
                                console.warn(`[FocusMode] ❌ No trades found in portfolios OR deepScanData for Magics: ${magics.join(', ')}`);
                                // Debug: Log available IDs in deepScanData
                                if (state.deepScanData) {
                                    Object.entries(state.deepScanData).forEach(([accId, data]) => {
                                        if (data.tradesById) {
                                            console.log(`[FocusMode] deepScanData[${accId}] has IDs: ${Object.keys(data.tradesById).slice(0, 10).join(', ')}...`);
                                        }
                                    });
                                }
                            }
                        }
                    } else {
                        console.warn(`[FocusMode] ❌ No Magic Number mapped for ${item.name}`);

                        // FALLBACK: Use getRealTradesByName to find trades (same logic as portfolios)
                        if (state.activeViewMode === 'reality-check') {
                            console.log(`[FocusMode] 🔄 Attempting getRealTradesByName fallback for ${item.name}`);
                            const realTrades = getRealTradesByName(item.name);
                            if (realTrades && realTrades.length > 0) {
                                console.log(`[FocusMode] ✅ Found ${realTrades.length} real trades via getRealTradesByName`);

                                // Calculate metrics from trades
                                const profit = realTrades.reduce((sum, t) => sum + (parseFloat(t.profit) || 0) + (parseFloat(t.swap) || 0) + (parseFloat(t.commission) || 0), 0);

                                // Calculate drawdown
                                let currentEq = 0;
                                let maxEq = 0;
                                let maxDD = 0;
                                realTrades.forEach(t => {
                                    const p = (parseFloat(t.profit) || 0) + (parseFloat(t.swap) || 0) + (parseFloat(t.commission) || 0);
                                    currentEq += p;
                                    if (currentEq > maxEq) maxEq = currentEq;
                                    const dd = maxEq - currentEq;
                                    if (dd > maxDD) maxDD = dd;
                                });

                                realMetrics = {
                                    _aggregatedTrades: realTrades,
                                    isAggregated: true,
                                    profit: profit,
                                    drawdown: maxDD,
                                    trades: realTrades.length,
                                    totalRealTrades: realTrades.length,
                                    totalRealProfit: profit
                                };
                            }
                        }
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
                    strategyNames: item.strategyNames, // CRITICAL: Pass strategy names to UI
                    pnlSeries: item.pnlSeries // Include TradeSeries
                };

                // For single strategies, we need to pass the name as a strategy so magic number lookup works
                // BUT, passing 'strategies' array makes UI.js treat it as a portfolio which might trigger aggregation logic that fails for ghost strategies.
                // We should rely on 'strategyNames' for Reality Check lookup.
                if (item.type === 'strategy') {
                    // analysisObj.strategies = [item.name]; // REMOVED to prevent Portfolio Masquerade
                    // Ensure strategyNames contains the name for Reality Check to work
                    if (!analysisObj.strategyNames) {
                        analysisObj.strategyNames = [item.name];
                    }
                } else if (item.strategies) {
                    analysisObj.strategies = item.strategies;
                }

                // DEBUG: Verify Analysis Data before sending to UI
                if (analysisObj.analysis && analysisObj.analysis.chartData && analysisObj.analysis.chartData.equityCurve) {
                    // --- TRADE SERIES INJECTION START ---
                    let activeFilter = null;
                    // [FIX] Always check for date filters, not just when viewMode === 'optimized'
                    if (item.creationFilter) {
                        activeFilter = item.creationFilter;
                    } else if (state.strategyDateRanges) {
                        const sId = item.id || item.name;
                        activeFilter = state.strategyDateRanges[sId] || state.strategyDateRanges[item.name];
                        if (!activeFilter && item.strategyNames) {
                            for (const name of item.strategyNames) {
                                if (state.strategyDateRanges[name]) { activeFilter = state.strategyDateRanges[name]; break; }
                            }
                        }
                    }

                    // Build or use TradeSeries base
                    let baseSeries = item.pnlSeries;

                    // Fallback to building the series dynamically if it's missing
                    if (!baseSeries) {
                        if (item.type === 'strategy' && analysisObj.analysis.trades) {
                            baseSeries = new TradeSeries(analysisObj.analysis.trades, state.tradePnlOverrides || {});
                            item.pnlSeries = baseSeries; // Cache it
                        } else if (item.type === 'saved' || item.type === 'portfolio') {
                            // Rehydrate portfolio tradeseries by merging component strategies
                            const seriesList = [];
                            const indices = item.indices || [];

                            if (indices.length === 0 && item.strategyIds) {
                                item.strategyIds.forEach(id => {
                                    const idx = state.loadedStrategyFiles.findIndex(f => f.strategyId === id);
                                    if (idx !== -1) indices.push(idx);
                                });
                            }

                            indices.forEach(idx => {
                                if (state.strategySeries && state.strategySeries[idx]) {
                                    seriesList.push(state.strategySeries[idx]);
                                }
                            });

                            if (seriesList.length > 0) {
                                baseSeries = TradeSeries.merge(seriesList);
                                item.pnlSeries = baseSeries;
                            }
                        }
                    }

                    if (baseSeries) {
                        let displaySeries = baseSeries;
                        if (activeFilter) {
                            displaySeries = baseSeries.filterByDateRange(activeFilter.start, activeFilter.end);
                        }

                        // Attach the right series to the analysisObj so UI can plot it natively
                        analysisObj.pnlSeries = displaySeries;

                        // Sync metrics locally for the item
                        // [FIX-v2] SKIP for databank items — displaySeries has normalized (%)
                        // values, not dollars. Syncing would corrupt the backend's correct metrics.
                        if (activeFilter && item.type !== 'databank') {
                            item.totalProfit = displaySeries.totalProfit;
                            item.maxDrawdownInDollars = displaySeries.maxDrawdown;
                            if (!item.metrics) item.metrics = {};
                            // [FIX] Use correct metric keys matching backend/config.js
                            item.metrics.totalProfit = displaySeries.totalProfit;
                            item.metrics.totalTrades = displaySeries.totalTrades;
                            item.metrics.maxDrawdownInDollars = displaySeries.maxDrawdown;

                            // Re-sync to global state
                            this.syncItemToGlobalState(item);
                        }
                    }
                    // --- TRADE SERIES INJECTION END ---

                    console.log(`[FocusMode] 📤 Sending Analysis for ${item.name} with TradeSeries support.`);
                } else {
                    console.warn(`[FocusMode] ⚠️ Sending Analysis for ${item.name} WITHOUT equity curve! Keys:`, Object.keys(analysisObj.analysis || {}));
                }

                return analysisObj;
            });

            // Resolve all backend calls and filter out failures
            const analyses = (await Promise.all(analysesPromises)).filter(Boolean);


            // DEBUG: Log what we are trying to update
            console.log(`[FocusMode] Updating main viewer for ${analyses.length} items.`);
            console.log('[FocusMode] Analyses names:', analyses.map(a => a.name));

            // Render using the comparison function which targets the main viewer
            renderPortfolioComparisonCharts(analyses);

            // [FIX] Always force Databank Table Refresh when charts update
            // This ensures the table stays in sync with the view mode (Optimized vs Full)
            if (typeof window.updateDatabankDisplay === 'function') {
                // Check if databank is likely visible (or just force it, it's cheap)
                const dbPanel = document.getElementById('databank-content');
                if (dbPanel && !dbPanel.classList.contains('hidden')) {
                    console.log('[FocusMode] 🟢 Triggering Databank Table Refresh from updateCharts');
                    window.updateDatabankDisplay();
                }
            }

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
                    let parentPortfolioIndex = -1;

                    // PRIORITY 1: explicit sourcePortfolioIndex (set by strategiesTable for virtual strategies)
                    if (item.sourcePortfolioIndex !== undefined && item.sourcePortfolioIndex !== null) {
                        parentPortfolioIndex = item.sourcePortfolioIndex;
                        console.log(`[FocusMode] Using explicit sourcePortfolioIndex: ${parentPortfolioIndex}`);
                    }

                    // PRIORITY 2: Search by strategy ID
                    if (parentPortfolioIndex === -1) {
                        parentPortfolioIndex = state.savedPortfolios.findIndex(p =>
                            p.strategyIds && p.strategyIds.includes(strategyId)
                        );
                    }

                    if (parentPortfolioIndex !== -1) {
                        // Refine ID: The 'strategyId' variable here holds the NAME (from strategiesTable).
                        // We must resolve it to the internal ID if possible, because sqAnalysis filters by ID.
                        let finalId = strategyId;
                        const portfolio = state.savedPortfolios[parentPortfolioIndex];
                        if (portfolio && portfolio.strategyNames && portfolio.strategyIds) {
                            const nameIdx = portfolio.strategyNames.indexOf(strategyId);
                            if (nameIdx !== -1 && portfolio.strategyIds[nameIdx]) {
                                finalId = portfolio.strategyIds[nameIdx];
                                console.log(`[FocusMode] Resolved Strategy Name '${strategyId}' to ID '${finalId}'`);
                            }
                        }

                        console.log(`[FocusMode] Updating SQ Analysis for strategy: ${finalId} (Name: ${strategyId}) in portfolio ${parentPortfolioIndex}`);
                        const currentDataType = document.getElementById('sq-data-type-select')?.value || 'backtest';
                        renderSQAnalysis(parentPortfolioIndex, 'saved', finalId, currentDataType);
                    } else {
                        // If not found by ID, maybe by name?
                        // Or maybe it's a databank portfolio?
                        console.warn(`[FocusMode] Could not find parent portfolio for strategy ${strategyId} to update SQ Analysis.`);
                    }
                } else if (item.type === 'saved') {
                    // If a Saved Portfolio is focused, update SQ Analysis to show that portfolio
                    console.log(`[FocusMode] Updating SQ Analysis for focused portfolio index: ${item.index}`);
                    const currentDataType = document.getElementById('sq-data-type-select')?.value || 'backtest';
                    renderSQAnalysis(item.index, 'saved', 'all', currentDataType);
                }
            } else if (this.focusedItems.size > 1) {
                // MULTI-SELECTION LOGIC
                const items = Array.from(this.focusedItems.values()).filter(i => i.type === 'strategy');
                if (items.length > 0) {
                    // Try to identify parent portfolio from first item
                    let parentPortfolioIndex = -1;
                    const first = items[0];

                    // Priority 1: sourcePortfolioIndex
                    if (first.sourcePortfolioIndex !== undefined && first.sourcePortfolioIndex !== null) {
                        parentPortfolioIndex = first.sourcePortfolioIndex;
                    }
                    // Priority 2: Search by Name/ID of first item
                    else {
                        let searchId = first.id || first.name;
                        if (first.originalIndex !== undefined && state.loadedStrategyFiles[first.originalIndex]) {
                            searchId = state.loadedStrategyFiles[first.originalIndex].strategyId || state.loadedStrategyFiles[first.originalIndex].name;
                        }
                        parentPortfolioIndex = state.savedPortfolios.findIndex(p => p.strategyIds && p.strategyIds.includes(searchId));

                        // Fallback check by name
                        if (parentPortfolioIndex === -1) {
                            parentPortfolioIndex = state.savedPortfolios.findIndex(p => p.strategyNames && p.strategyNames.includes(searchId));
                        }
                    }

                    if (parentPortfolioIndex !== -1) {
                        // Collect all IDs
                        const validIds = [];
                        items.forEach(item => {
                            // Resolve ID logic...
                            let sId = item.id || item.name;
                            if (item.originalIndex !== undefined && state.loadedStrategyFiles[item.originalIndex]) {
                                const f = state.loadedStrategyFiles[item.originalIndex];
                                sId = f.strategyId || f.name;
                            }

                            // Resolve to internal ID using portfolio maps
                            const portfolio = state.savedPortfolios[parentPortfolioIndex];
                            if (portfolio && portfolio.strategyNames && portfolio.strategyIds) {
                                // Try to match by Name -> ID mapping
                                // The 'sId' we have might be the ID or the Name depending on source.
                                // Let's check if sId exists in strategyNames
                                const nameIdx = portfolio.strategyNames.indexOf(sId);
                                if (nameIdx !== -1 && portfolio.strategyIds[nameIdx]) {
                                    sId = portfolio.strategyIds[nameIdx];
                                }
                            }
                            validIds.push(sId);
                        });

                        if (validIds.length > 0) {
                            console.log(`[FocusMode] Updating SQ Analysis for ${validIds.length} strategies in portfolio ${parentPortfolioIndex}`);
                            const currentDataType = document.getElementById('sq-data-type-select')?.value || 'backtest';
                            renderSQAnalysis(parentPortfolioIndex, 'saved', validIds, currentDataType);
                        }
                    } else {
                        console.warn("[FocusMode] Could not determine parent portfolio for multi-selection.");
                    }
                }
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
                    if (detailsContainer) detailsContainer.classList.add('hidden');
                }
            }

            // [FIX] Update Banner once charts and metrics are ready
            this.renderBanner();

        } catch (e) {
            console.error('[FocusMode] 💥 Error in updateCharts:', e);
        } finally {
            if (isOptimizedView) toggleLoading(false);
        }
    },

    /**
     * Helper: Sync updated item properties back to global state
     * This is crucial so that the Databank Table (which reads from state) reflects the changes.
     */
    syncItemToGlobalState(item) {
        if (!item) return;

        // [FIX] Only sync specific safe properties instead of blindly spreading.
        // Spreading the entire item was corrupting the original backend metrics object
        // and injecting pnlSeries that could produce wrong values after date filtering.
        const safeKeys = ['pnlSeries', 'totalProfit', 'maxDrawdownInDollars', 'creationFilter'];

        const applySafeSync = (target) => {
            safeKeys.forEach(key => {
                if (item[key] !== undefined) {
                    target[key] = item[key];
                }
            });
            // Sync specific metric keys without replacing the entire metrics object
            if (item.metrics && target.metrics) {
                if (item.metrics.totalProfit !== undefined) target.metrics.totalProfit = item.metrics.totalProfit;
                if (item.metrics.totalTrades !== undefined) target.metrics.totalTrades = item.metrics.totalTrades;
                if (item.metrics.maxDrawdownInDollars !== undefined) target.metrics.maxDrawdownInDollars = item.metrics.maxDrawdownInDollars;
            }
        };

        // 1. Sync to Databank Portfolios
        if (state.databankPortfolios) {
            let found = false;
            if (item.id) {
                const idx = state.databankPortfolios.findIndex(p => p.id === item.id);
                if (idx !== -1) {
                    applySafeSync(state.databankPortfolios[idx]);
                    found = true;
                }
            }
            if (!found && item.name) {
                const idx = state.databankPortfolios.findIndex(p => p.name === item.name);
                if (idx !== -1) {
                    applySafeSync(state.databankPortfolios[idx]);
                    found = true;
                }
            }
        }

        // 2. Sync to Saved Portfolios (if applicable)
        if (state.savedPortfolios) {
            if (item.id) {
                const idx = state.savedPortfolios.findIndex(p => p.id === item.id);
                if (idx !== -1) {
                    applySafeSync(state.savedPortfolios[idx]);
                }
            } else if (item.name) {
                const idx = state.savedPortfolios.findIndex(p => p.name === item.name);
                if (idx !== -1) {
                    applySafeSync(state.savedPortfolios[idx]);
                }
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

    // [FIX] Listen for date filter changes from strategiesTable and re-render charts/tables
    document.addEventListener('strategy-date-updated', (e) => {
        console.log('[FocusMode] strategy-date-updated received:', e.detail);
        // Re-render charts if focus mode is active
        if (focusMode.focusedItems && focusMode.focusedItems.size > 0) {
            focusMode.updateCharts();
        }
        // Re-render the databank table
        if (typeof window.updateDatabankDisplay === 'function') {
            window.updateDatabankDisplay();
        }
    });
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
