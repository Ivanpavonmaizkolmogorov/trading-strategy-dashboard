/**
 * TradeSeries.js
 * Encapsulates a series of Trade objects and computes performance metrics (KPIs)
 * identically to the Python backend / original JS implementations.
 * Uses lazy loading / caching for high performance.
 */
import { Trade } from './Trade.js';

export class TradeSeries {
    constructor(trades = [], overrides = {}) {
        // Ensure we are working with Trade instances
        this.trades = trades.map(t => t instanceof Trade ? t : new Trade(t, overrides));

        // Sort chronologically by exit time for accurate equity curve and drawdowns
        this.trades.sort((a, b) => a.exitTimestamp - b.exitTimestamp);

        // Cache object to avoid recalculating KPIs if not needed
        this._cache = {};
    }

    /**
     * Applies new overrides dynamically and invalidates metrics cache.
     * @param {Object} overrides 
     */
    updateOverrides(overrides) {
        this.trades.forEach(t => t.applyOverrides(overrides));
        this._cache = {};
    }

    // --- Core Aggregations & Caching Engine ---

    _calculateCoreMetrics() {
        if (this._cache.coreMetrics) return this._cache.coreMetrics;

        let totalProfit = 0;
        let grossProfit = 0;
        let grossLoss = 0;
        let wins = 0;
        let losses = 0;

        let maxDD = 0;
        let peakEquity = 0;
        let currentEquity = 0;

        let curConsecLosses = 0;
        let maxConsecLosses = 0;
        let curConsecWins = 0;
        let maxConsecWins = 0;

        let maxStagnationDays = 0;
        let peakTime = null;

        // Stagnation in Trades
        let tradesSincePeak = 0;
        let maxStagnationTrades = 0;
        let peakEquityForStagTrades = 0;

        const tradeEquityCurve = [0]; // Relative to 0 start
        const dailyPnL = {};

        // Stagnation logic mirrors sqAnalysis_v2.js
        if (this.trades.length > 0 && this.trades[0].exitTimestamp) {
            peakTime = this.trades[0].exitTimestamp;
        }

        this.trades.forEach(t => {
            const pnl = t.pnl;
            totalProfit += pnl;
            currentEquity += pnl;
            tradeEquityCurve.push(currentEquity);

            // Daily PnL for Sharpe/Sortino
            if (t.exitTime) {
                const dayKey = t.exitTime.toISOString().split('T')[0];
                dailyPnL[dayKey] = (dailyPnL[dayKey] || 0) + pnl;
            }

            // Drawdown
            if (currentEquity > peakEquity) {
                peakEquity = currentEquity;
            }
            const dd = peakEquity - currentEquity;
            if (dd > maxDD) {
                maxDD = dd;
            }

            // Update Peak Time for Stagnation
            if (currentEquity >= peakEquity && t.exitTimestamp) {
                peakTime = t.exitTimestamp;
            }

            // Stagnation Days computation
            if (peakTime && t.exitTimestamp) {
                const currentStagnation = (t.exitTimestamp - peakTime) / (1000 * 60 * 60 * 24);
                if (currentStagnation > maxStagnationDays) {
                    maxStagnationDays = currentStagnation;
                }
            }

            // Stagnation Trades
            if (currentEquity > peakEquityForStagTrades) {
                if (tradesSincePeak > maxStagnationTrades) maxStagnationTrades = tradesSincePeak;
                tradesSincePeak = 0;
                peakEquityForStagTrades = currentEquity;
            } else {
                tradesSincePeak++;
            }

            // Wins/Losses Streaks and Gross
            if (pnl >= 0) {
                wins++;
                grossProfit += pnl;
                curConsecWins++;
                curConsecLosses = 0;
                if (curConsecWins > maxConsecWins) maxConsecWins = curConsecWins;
            } else {
                losses++;
                grossLoss += pnl;
                curConsecLosses++;
                curConsecWins = 0;
                if (curConsecLosses > maxConsecLosses) maxConsecLosses = curConsecLosses;
            }
        });

        // Final stagnation trades check
        if (tradesSincePeak > maxStagnationTrades) maxStagnationTrades = tradesSincePeak;

        const totalTrades = this.trades.length;
        const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
        const profitFactor = Math.abs(grossLoss) > 0 ? grossProfit / Math.abs(grossLoss) : (grossProfit > 0 ? 999 : 0);
        const returnDDRatio = maxDD > 0 ? totalProfit / maxDD : (totalProfit > 0 ? 999 : 0);

        this._cache.coreMetrics = {
            totalProfit, grossProfit, grossLoss, wins, losses, totalTrades,
            maxDD, winRate, profitFactor, returnDDRatio,
            maxConsecLosses, maxConsecWins,
            maxStagnationDays: Math.floor(maxStagnationDays),
            maxStagnationTrades,
            tradeEquityCurve, dailyPnL
        };

        return this._cache.coreMetrics;
    }

    _calculateAdvancedMetrics() {
        if (this._cache.advancedMetrics) return this._cache.advancedMetrics;
        const core = this._calculateCoreMetrics();

        const initialCapital = 10000;
        let cagrPct = 0;
        let upi = 0;
        let sharpeRatio = 0;
        let sharpeRatioTrade = 0;
        let sortinoRatio = 0;
        let sqn = 0;
        let gammaFlowScore = 0;
        let maxDrawdownPct = 0;

        if (this.trades.length === 0) {
            this._cache.advancedMetrics = { cagrPct, upi, sharpeRatio, sharpeRatioTrade, sortinoRatio, sqn, gammaFlowScore, maxDrawdownPct };
            return this._cache.advancedMetrics;
        }

        const firstDateTs = this.trades[0].exitTimestamp;
        const lastDateTs = this.trades[this.trades.length - 1].exitTimestamp;
        const durationDays = (lastDateTs - firstDateTs) / (1000 * 60 * 60 * 24);
        const durationYears = durationDays / 365.25;
        const finalEquity = initialCapital + core.totalProfit;

        // 1. CAGR
        if (durationYears > 0 && finalEquity > 0) {
            if (durationYears < 1.0) {
                cagrPct = (((finalEquity / initialCapital) - 1) / durationYears) * 100;
            } else {
                cagrPct = (Math.pow(finalEquity / initialCapital, 1 / durationYears) - 1) * 100;
            }
        }

        // 2. Ulcer Index & UPI
        let squaredDDSum = 0;
        let peakEqBase = initialCapital;
        const absTradeCurve = core.tradeEquityCurve.map(v => initialCapital + v);

        absTradeCurve.forEach(eq => {
            if (eq > peakEqBase) peakEqBase = eq;
            const ddPct = peakEqBase > 0 ? ((eq / peakEqBase) - 1) * 100 : 0;
            squaredDDSum += (ddPct * ddPct);
        });

        const ulcerIndex = Math.sqrt(squaredDDSum / absTradeCurve.length);
        upi = ulcerIndex > 0 ? cagrPct / ulcerIndex : (cagrPct > 0 ? 999 : 0);

        // 2b. Max Drawdown % (from equity curve)
        let peakEqForPct = initialCapital;
        absTradeCurve.forEach(eq => {
            if (eq > peakEqForPct) peakEqForPct = eq;
            const ddPct = peakEqForPct > 0 ? ((peakEqForPct - eq) / peakEqForPct) * 100 : 0;
            if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
        });

        // 3. Sharpe & Sortino (Daily Basis)
        const dailyValues = Object.values(core.dailyPnL);
        if (dailyValues.length > 1) {
            const nDays = dailyValues.length;
            const meanDaily = dailyValues.reduce((a, b) => a + b, 0) / nDays;

            const varianceDaily = dailyValues.reduce((sum, val) => sum + Math.pow(val - meanDaily, 2), 0) / (nDays - 1);
            const stdDevDaily = Math.sqrt(varianceDaily);

            const downsideVariance = dailyValues.reduce((sum, val) => sum + Math.pow(Math.min(0, val), 2), 0) / nDays;
            const downsideDev = Math.sqrt(downsideVariance);

            const SQRT_252 = Math.sqrt(252);
            if (stdDevDaily > 0) sharpeRatio = (meanDaily / stdDevDaily) * SQRT_252;
            if (downsideDev > 0) sortinoRatio = (meanDaily / downsideDev) * SQRT_252;
        }

        // 3b. Sharpe Ratio (Trade Basis) - annualized
        const avgTrade = core.totalTrades > 0 ? core.totalProfit / core.totalTrades : 0;
        if (core.totalTrades > 1) {
            // Calculate trade returns (% relative to equity before each trade)
            const tradeReturns = [];
            for (let i = 0; i < this.trades.length; i++) {
                const eqBefore = absTradeCurve[i]; // equity before this trade
                if (eqBefore > 0) tradeReturns.push(this.trades[i].pnl / eqBefore);
            }
            if (tradeReturns.length > 1) {
                const meanRet = tradeReturns.reduce((a, b) => a + b, 0) / tradeReturns.length;
                const stdRet = Math.sqrt(tradeReturns.reduce((s, v) => s + Math.pow(v - meanRet, 2), 0) / (tradeReturns.length - 1));
                const tradesPerYear = durationYears > 0 ? core.totalTrades / durationYears : 0;
                const annFactor = Math.sqrt(tradesPerYear);
                if (stdRet > 0) sharpeRatioTrade = (meanRet / stdRet) * annFactor;
            }
        }

        // 4. SQN (Trade Basis)
        const varianceTrade = this.trades.reduce((sum, t) => sum + Math.pow(t.pnl - avgTrade, 2), 0) / core.totalTrades;
        const stdDevTrade = Math.sqrt(varianceTrade);

        // SQN uses population std dev and caps N at 100 as per python backend logic
        if (stdDevTrade > 0 && core.totalTrades > 0) {
            sqn = (avgTrade / stdDevTrade) * Math.sqrt(Math.min(core.totalTrades, 100));
        }

        // 5. Gamma Flow Score (GFS) - replicates analysis_engine.py
        // GFS = (Beta_TP / Beta_SL) * (AvgWin / |AvgLoss|)
        gammaFlowScore = this._calculateGammaFlowScore();

        this._cache.advancedMetrics = { cagrPct, upi, sharpeRatio, sharpeRatioTrade, sortinoRatio, sqn, gammaFlowScore, maxDrawdownPct };
        return this._cache.advancedMetrics;
    }

    /**
     * Calculates Gamma Flow Score (GFS).
     * GFS = (Beta_TP / Beta_SL) * (AvgWin / |AvgLoss|)
     * Beta is computed via Method of Moments on inter-arrival times.
     * Mirrors analysis_engine.py::calculate_gamma_flow_score()
     */
    _calculateGammaFlowScore() {
        if (this.trades.length < 2) return 0;

        // Categorize trades as TP or SL based on exitReason
        const tpTrades = [];
        const slTrades = [];

        this.trades.forEach(t => {
            const reason = (t.exitReason || '').toLowerCase();
            const isTrailing = /trailing/i.test(reason);
            const isTP = /tp|take|pt/i.test(reason);
            const isSL = /sl|stop/i.test(reason) && !isTrailing;

            if (isTP) tpTrades.push(t);
            else if (isSL) slTrades.push(t);
        });

        // Calculate Beta via Method of Moments on inter-arrival times (in days)
        const calcBeta = (trades) => {
            if (trades.length < 2) return 0;
            // Sort by exit time
            const sorted = [...trades].sort((a, b) => a.exitTimestamp - b.exitTimestamp);
            const interTimes = [];
            for (let i = 1; i < sorted.length; i++) {
                const diffDays = (sorted[i].exitTimestamp - sorted[i - 1].exitTimestamp) / (1000 * 60 * 60 * 24);
                interTimes.push(diffDays);
            }
            if (interTimes.length === 0) return 0;
            const mean = interTimes.reduce((a, b) => a + b, 0) / interTimes.length;
            const variance = interTimes.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / interTimes.length;
            if (variance === 0 || mean === 0) return 0;
            return mean / variance; // Beta = Mean / Variance
        };

        const betaTP = calcBeta(tpTrades);
        const betaSL = calcBeta(slTrades);

        // Payoff ratio: AvgWin / |AvgLoss| (uses ALL trades, not just TP/SL)
        const winners = this.trades.filter(t => t.pnl > 0);
        const losers = this.trades.filter(t => t.pnl < 0);
        const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + t.pnl, 0) / winners.length : 0;
        const avgLossAbs = losers.length > 0 ? Math.abs(losers.reduce((s, t) => s + t.pnl, 0) / losers.length) : 1;
        const payoff = avgLossAbs > 0 ? avgWin / avgLossAbs : 0;

        // GFS formula
        const effectiveBetaSL = betaSL > 0 ? betaSL : 0.001;
        return (betaTP / effectiveBetaSL) * payoff;
    }

    // --- GETTERS ---

    get totalTrades() { return this.trades.length; }
    get totalProfit() { return this._calculateCoreMetrics().totalProfit; }
    get maxDrawdown() { return this._calculateCoreMetrics().maxDD; }
    get maxDrawdownPct() { return this._calculateAdvancedMetrics().maxDrawdownPct; }
    get winRate() { return this._calculateCoreMetrics().winRate; }
    get profitFactor() { return this._calculateCoreMetrics().profitFactor; }
    get returnDD() { return this._calculateCoreMetrics().returnDDRatio; }
    get maxConsecutiveLosses() { return this._calculateCoreMetrics().maxConsecLosses; }
    get maxStagnationDays() { return this._calculateCoreMetrics().maxStagnationDays; }
    get maxStagnationTrades() { return this._calculateCoreMetrics().maxStagnationTrades; }
    get avgTrade() { const c = this._calculateCoreMetrics(); return c.totalTrades > 0 ? c.totalProfit / c.totalTrades : 0; }

    get upi() { return this._calculateAdvancedMetrics().upi; }
    get cagr() { return this._calculateAdvancedMetrics().cagrPct; }
    get sharpeRatio() { return this._calculateAdvancedMetrics().sharpeRatio; }
    get sharpeRatioTrade() { return this._calculateAdvancedMetrics().sharpeRatioTrade; }
    get sortinoRatio() { return this._calculateAdvancedMetrics().sortinoRatio; }
    get sqn() { return this._calculateAdvancedMetrics().sqn; }
    get gammaFlowScore() { return this._calculateAdvancedMetrics().gammaFlowScore; }

    // --- UTILITIES ---

    /**
     * Returns a new TradeSeries filtered by Date Range
     * @param {Date|string} startDate 
     * @param {Date|string} endDate 
     */
    filterByDateRange(startDate, endDate) {
        if (!startDate && !endDate) return this;

        const start = startDate ? new Date(startDate).getTime() : 0;
        const end = endDate ? new Date(endDate).getTime() : 8640000000000000;

        const filtered = this.trades.filter(t => t.exitTimestamp >= start && t.exitTimestamp <= end);
        return new TradeSeries(filtered);
    }

    /**
     * Helper to generate Chart.js series data for Equity Curve
     * @returns {Array} Array of points {x: timestamp, t: timestamp, y: equity}
     */
    getEquityCurveFormat() {
        const data = [];
        let currentEq = 0;
        this.trades.forEach(t => {
            currentEq += t.pnl;
            if (t.exitTimestamp) {
                // Chart.js format (t added for backwards compat with ui.js fallback)
                data.push({ x: t.exitTimestamp, t: t.exitTimestamp, y: currentEq });
            }
        });
        return data;
    }

    /**
     * Helper to generate Scatter chart data
     */
    getScatterDataFormat() {
        const data = [];
        this.trades.forEach(t => {
            if (t.exitTimestamp) {
                data.push({ x: t.exitTimestamp, y: t.pnl });
            }
        });
        return data;
    }

    /**
     * Helper to generate Lorenz Curve data
     */
    getLorenzDataFormat() {
        const sortedTrades = [...this.trades].sort((a, b) => a.pnl - b.pnl);
        const data = [{ x: 0, y: 0 }];
        let cumulativePnl = 0;
        const totalPnl = this.totalProfit > 0 ? this.totalProfit : 1; // avoid div 0

        sortedTrades.forEach((t, i) => {
            cumulativePnl += t.pnl;
            data.push({
                x: ((i + 1) / sortedTrades.length) * 100,
                y: (cumulativePnl / totalPnl) * 100
            });
        });
        return data;
    }
    /**
     * Submarine / Underwater Drawdown Curve for Charts
     * @returns {Array<{x: number, y: number}>} Array of points mapping timestamp to absolute numerical drawdown
     */
    getDrawdownCurveFormat() {
        const data = [];
        let currentEq = 0;
        let peakEq = 0;

        this.trades.forEach(t => {
            currentEq += t.pnl;
            if (currentEq > peakEq) {
                peakEq = currentEq;
            }

            if (t.exitTimestamp) {
                // Return positive DD value for charting
                data.push({ x: t.exitTimestamp, y: peakEq - currentEq });
            }
        });

        return data;
    }

    /**
     * Calculates the drawdown breakdown table data (Top N Drawdowns)
     * Replaces calculateDrawdownBreakdown from drawdownAnalysis.js
     * @param {number} topN 
     * @returns {Object} { drawdowns, currentStagnationDays, timeUnderWaterPercent, underwaterCurve }
     */
    getDrawdownBreakdown(topN = 7) {
        if (this.trades.length === 0) {
            return { drawdowns: [], currentStagnationDays: 0, timeUnderWaterPercent: 0, underwaterCurve: [] };
        }

        const INITIAL_CAPITAL = 10000;
        let currentBalance = INITIAL_CAPITAL;
        let highWaterMark = INITIAL_CAPITAL;

        let inDrawdown = false;
        let currentDDStart = null;
        let currentDDBottomValue = 0;
        let currentDDBottomDate = null;
        let currentDDDepthPercent = 0;

        const allDrawdowns = [];
        const underwaterCurve = [];

        let totalDaysInHistory = 0;
        const startTimeStamp = this.trades[0].exitTimestamp;
        const endTimeStamp = this.trades[this.trades.length - 1].exitTimestamp;

        if (startTimeStamp && endTimeStamp) {
            totalDaysInHistory = (endTimeStamp - startTimeStamp) / (1000 * 60 * 60 * 24);
        }

        for (let i = 0; i < this.trades.length; i++) {
            const trade = this.trades[i];
            const tradeDate = trade.exitTime;
            const dateStr = tradeDate ? tradeDate.toISOString() : null;
            const profit = trade.pnl;

            currentBalance += profit;

            if (currentBalance >= highWaterMark) {
                if (inDrawdown) {
                    const daysToRecover = (tradeDate.getTime() - currentDDStart.getTime()) / (1000 * 60 * 60 * 24);
                    const daysToBottom = (currentDDBottomDate.getTime() - currentDDStart.getTime()) / (1000 * 60 * 60 * 24);

                    if (currentDDBottomValue < 0) {
                        allDrawdowns.push({
                            depthMonetary: currentDDBottomValue,
                            depthPercent: currentDDDepthPercent,
                            startDate: new Date(currentDDStart),
                            bottomDate: new Date(currentDDBottomDate),
                            recoveryDate: new Date(tradeDate),
                            totalDays: Math.max(1, Math.round(daysToRecover)),
                            daysToBottom: Math.max(0, Math.round(daysToBottom)),
                            isRecovered: true
                        });
                    }
                    inDrawdown = false;
                }
                highWaterMark = currentBalance;
                underwaterCurve.push({ date: dateStr, value: 0, monetary: 0 });
            } else {
                const currentDrawdownValue = currentBalance - highWaterMark;
                const currentDrawdownPercent = (currentDrawdownValue / INITIAL_CAPITAL) * 100;

                if (!inDrawdown) {
                    inDrawdown = true;
                    currentDDStart = tradeDate;
                    currentDDBottomValue = currentDrawdownValue;
                    currentDDBottomDate = tradeDate;
                    currentDDDepthPercent = currentDrawdownPercent;
                } else {
                    if (currentDrawdownValue < currentDDBottomValue) {
                        currentDDBottomValue = currentDrawdownValue;
                        currentDDBottomDate = tradeDate;
                        currentDDDepthPercent = currentDrawdownPercent;
                    }
                }
                underwaterCurve.push({ date: dateStr, value: currentDrawdownPercent, monetary: currentDrawdownValue });
            }
        }

        let currentStagnationDays = 0;
        if (inDrawdown && currentDDStart) {
            const lastTradeDate = this.trades[this.trades.length - 1].exitTime;
            if (lastTradeDate) {
                currentStagnationDays = Math.max(0, Math.round((lastTradeDate.getTime() - currentDDStart.getTime()) / (1000 * 60 * 60 * 24)));
                const daysToBottom = Math.max(0, Math.round((currentDDBottomDate.getTime() - currentDDStart.getTime()) / (1000 * 60 * 60 * 24)));

                if (currentDDBottomValue < 0) {
                    allDrawdowns.push({
                        depthMonetary: currentDDBottomValue,
                        depthPercent: currentDDDepthPercent,
                        startDate: new Date(currentDDStart),
                        bottomDate: new Date(currentDDBottomDate),
                        recoveryDate: null,
                        totalDays: currentStagnationDays,
                        daysToBottom: daysToBottom,
                        isRecovered: false
                    });
                }
            }
        }

        const timeUnderWaterPercent = totalDaysInHistory > 0 ?
            (allDrawdowns.reduce((sum, dd) => sum + dd.totalDays, 0) / totalDaysInHistory) * 100
            : 0;

        const topDrawdowns = allDrawdowns
            .sort((a, b) => a.depthMonetary - b.depthMonetary)
            .slice(0, topN);

        return {
            drawdowns: topDrawdowns,
            currentStagnationDays,
            timeUnderWaterPercent: Math.min(100, Math.max(0, timeUnderWaterPercent)),
            underwaterCurve
        };
    }

    /**
     * Merges multiple TradeSeries into one Portfolio TradeSeries
     * @param {TradeSeries[]} seriesList 
     */
    static merge(seriesList) {
        let allTrades = [];
        let overrides = {};
        seriesList.forEach(s => {
            if (s && s.trades) allTrades = allTrades.concat(s.trades);
            if (s && s.overrides) overrides = { ...overrides, ...s.overrides };
        });
        return new TradeSeries(allTrades, overrides);
    }
}
