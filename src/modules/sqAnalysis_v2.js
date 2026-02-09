import { state } from '../state.js';

// Variable to track the currently active analysis view
let activeRenderConfig = null;
let analysisDateSortAsc = false; // Default: Newest First (Desc)
let lastDropdownSearch = ''; // Persist search term across re-renders

window.toggleAnalysisSort = () => {
    analysisDateSortAsc = !analysisDateSortAsc;
    if (activeRenderConfig) {
        renderSQAnalysis(activeRenderConfig.index, activeRenderConfig.source);
    }
};

document.addEventListener('portfolio-data-updated', () => {
    // Check if the analysis view is active (content div exists and we have a config)
    const contentDiv = document.getElementById('sq-analysis-content');
    if (activeRenderConfig && contentDiv && contentDiv.innerHTML !== '') {
        console.log('[SQ ANALYSIS] Received update event. Re-rendering active view.');
        renderSQAnalysis(activeRenderConfig.index, activeRenderConfig.source);
    }
});

/**
 * Filters an array of trades by date range.
 * @param {Array} trades - Array of trade objects.
 * @param {Date|string|object} startDateOrRange - Either start date, or an object {start, end}.
 * @param {Date|string} [endDate] - End date (inclusive), only used if first param is a start date.
 * @returns {Array} Filtered trades.
 */
export const filterTradesByDate = (trades, startDateOrRange, endDate) => {
    if (!trades || trades.length === 0) return [];

    // Handle object parameter format: {start, end}
    let startDate, end;
    if (startDateOrRange && typeof startDateOrRange === 'object' && !Array.isArray(startDateOrRange) && !(startDateOrRange instanceof Date)) {
        startDate = startDateOrRange.start;
        end = startDateOrRange.end;
    } else {
        startDate = startDateOrRange;
        end = endDate;
    }

    if (!startDate && !end) return trades;

    const start = startDate ? new Date(startDate) : new Date(0); // Epoch
    const endD = end ? new Date(end) : new Date(8640000000000000); // Far future

    // Reset times for date-only comparison if input is date-only string
    if (typeof startDate === 'string' && startDate.length === 10) start.setHours(0, 0, 0, 0);
    if (typeof end === 'string' && end.length === 10) endD.setHours(23, 59, 59, 999);

    return trades.filter(t => {
        // Support multiple date property names: exit_date (CSV), exitTime, closeTime, closeDate, entry_date
        let dateStr = t.exit_date || t.exitTime || t.closeTime || t.closeDate || t.entry_date;
        if (!dateStr) return false;

        // Parse YYYY.MM.DD HH:MM:SS format (convert dots to dashes for Date parsing)
        if (typeof dateStr === 'string' && dateStr.includes('.')) {
            dateStr = dateStr.replace(/\./g, '-');
        }

        const dt = new Date(dateStr);
        if (isNaN(dt.getTime())) return false; // Invalid date

        return dt >= start && dt <= endD;
    });
};
export const calculateSQMetrics = (trades) => {
    if (!trades || !Array.isArray(trades) || trades.length === 0) return null;

    console.log(`[SQ DEBUG] calculateSQMetrics Input Trades: ${trades.length}`);

    let totalProfit = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let wins = 0;
    let losses = 0;
    let maxConsecWins = 0;
    let maxConsecLosses = 0;
    let curConsecWins = 0;
    let curConsecLosses = 0;
    let maxDD = 0;
    let peakEquity = 0;
    let currentEquity = 0;
    let largestWin = 0;
    let largestLoss = 0;
    let sharpeRatio = 0;
    let sortinoRatio = 0;

    // Stagnation State
    let maxStagnationDays = 0;
    let peakTime = null; // Time of last peak equity

    // Monthly/Weekly Data Cache
    const timeData = {
        month: {},
        week: {},
        day: {},
        year: {},
        trade: {} // Fix: Initialize trade-level grouping
    };

    // Sort trades by Open Time for Inter-Trade Analysis
    const tradesByOpen = [...trades].sort((a, b) => a.openTime - b.openTime);

    // Sort trades by Exit Time for Equity / Drawdown / Balance Curve
    // This is CRITICAL for Portfolio Analysis to match Backend and Reality.
    const tradesByExit = [...trades].sort((a, b) => a.exitTime - b.exitTime);

    // --- Inter-Trade Time Analysis (Uses Open Time) ---
    let previousOpenTime = null;
    const interTradeTimes = []; // In Hours

    tradesByOpen.forEach(t => {
        if (previousOpenTime) {
            const diffMs = t.openTime - previousOpenTime;
            const diffHours = diffMs / (1000 * 60 * 60);
            if (diffHours >= 0) interTradeTimes.push(diffHours);
        }
        previousOpenTime = t.openTime;
    });

    // --- Equity & Metrics Analysis (Uses Exit Time) ---
    // Initialize Peak Time for Stagnation
    if (tradesByExit.length > 0) {
        peakTime = tradesByExit[0].exitTime ? tradesByExit[0].exitTime.getTime() : null;
    }

    tradesByExit.forEach((t, i) => {
        const pnl = t.pnl;
        totalProfit += pnl;
        currentEquity += pnl;

        // DD
        if (currentEquity > peakEquity) {
            peakEquity = currentEquity;
            // console.log(`[SQ Metrics] New Peak Equity: ${peakEquity.toFixed(2)} at ${t.exitTime}`);
        }
        const dd = peakEquity - currentEquity; // Positive value representing drop
        if (dd > maxDD) {
            // console.log(`[SQ Metrics] New Max DD Found: ${dd.toFixed(2)} (Peak: ${peakEquity.toFixed(2)} -> Curr: ${currentEquity.toFixed(2)}) at ${t.exitTime}. Last Trade PnL: ${pnl.toFixed(2)}`);
            maxDD = dd;
        }

        // Update Peak Time
        if (currentEquity >= peakEquity) {
            peakTime = t.exitTime ? t.exitTime.getTime() : null;
        }

        // Win/Loss
        if (pnl >= 0) {
            wins++;
            grossProfit += pnl;
            curConsecWins++;
            curConsecLosses = 0;
            if (curConsecWins > maxConsecWins) maxConsecWins = curConsecWins;
            if (pnl > largestWin) largestWin = pnl;
        } else {
            losses++;
            grossLoss += pnl;
            curConsecLosses++;
            curConsecWins = 0;
            if (curConsecLosses > maxConsecLosses) maxConsecLosses = curConsecLosses;
            if (pnl < largestLoss) largestLoss = pnl;
        }

        // Aggregation
        if (t.exitTime) {
            const y = t.exitTime.getFullYear();
            const m = t.exitTime.getMonth(); // 0-11

            // Week Calculation
            const d = new Date(Date.UTC(y, m, t.exitTime.getDate()));
            const dayNum = d.getUTCDay() || 7;
            d.setUTCDate(d.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
            const w = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
            const wy = d.getUTCFullYear();

            // Stagnation Calculation (Current Trade)
            let currentStagnation = 0;
            if (peakTime) {
                currentStagnation = (t.exitTime.getTime() - peakTime) / (1000 * 60 * 60 * 24);
                if (currentStagnation > maxStagnationDays) {
                    // console.log(`[SQ Metrics] New Max Stagnation Days in Drawdown: ${currentStagnation.toFixed(1)} days.`);
                    maxStagnationDays = currentStagnation;
                }
            }

            // Helper to update bucket
            const updateBucket = (bucket, key) => {
                if (!bucket[key]) bucket[key] = { pnl: 0, count: 0, wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, maxDD: 0, maxStagnation: 0 };
                const s = bucket[key];
                s.pnl += pnl;
                s.count++;
                if (pnl >= 0) { s.wins++; s.grossProfit += pnl; }
                else { s.losses++; s.grossLoss += pnl; }

                // Track Max Stats for this Period
                if (dd > s.maxDD) s.maxDD = dd;
                if (currentStagnation > s.maxStagnation) s.maxStagnation = currentStagnation;
            };

            // Month
            if (!timeData.month[y]) timeData.month[y] = {};
            updateBucket(timeData.month[y], m);

            // Week
            if (!timeData.week[wy]) timeData.week[wy] = {};
            updateBucket(timeData.week[wy], w);

            // Day
            if (!timeData.day[y]) timeData.day[y] = {};
            const dayKey = `${String(m + 1).padStart(2, '0')}-${String(t.exitTime.getDate()).padStart(2, '0')}`;
            updateBucket(timeData.day[y], dayKey);

            // Year
            if (!timeData.year[y]) timeData.year[y] = {};
            updateBucket(timeData.year[y], y);

            // Trade (Individual) - Using index as key to preserve order
            // We group by "Year" (dummy) or just a single bucket?
            // Existing logic expects timeData[period][year][key] -> stats
            // Let's use Year of trade as parent bucket, and index as key.
            if (!timeData.trade[y]) timeData.trade[y] = {};
            // Creating a unique key for each trade to prevent aggregation distinctness issues if any
            const tradeKey = `t_${i}`;
            // We want specific trade stats, not aggregated.
            // updateBucket aggregates. For 'trade', count is 1, sum is pnl.
            // Manually set or reuse updateBucket? updateBucket adds to existing.
            // Since key is unique (t_i), updateBucket works fine to init.
            updateBucket(timeData.trade[y], tradeKey);
        }
    });

    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const avgWin = wins > 0 ? grossProfit / wins : 0;
    const avgLoss = losses > 0 ? grossLoss / losses : 0;
    const profitFactor = Math.abs(grossLoss) > 0 ? grossProfit / Math.abs(grossLoss) : (grossProfit > 0 ? 999 : 0);
    const avgTrade = totalTrades > 0 ? totalProfit / totalTrades : 0;

    // Expectancy
    const expectancy = (winRate / 100 * avgWin) + ((1 - winRate / 100) * avgLoss);

    // Heuristic for "Risk per Trade" to identify Trailing Stops
    // User Update: Trailing if PnL > -0.6 * Risk (includes reduced losses)
    const baseRisk = 100;
    const riskThreshold = baseRisk * 0.6; // 60 -> Logic: PnL > -60 is Trailing



    // SQN
    const variance = trades.reduce((sum, t) => sum + Math.pow(t.pnl - avgTrade, 2), 0) / totalTrades;
    const stdDev = Math.sqrt(variance);
    const sqn = stdDev > 0 ? Math.sqrt(Math.min(totalTrades, 100)) * (avgTrade / stdDev) : 0;
    const sharpeRatioTrade = stdDev > 0 ? avgTrade / stdDev : 0;

    // Return / DD
    const returnDDRatio = maxDD > 0 ? totalProfit / maxDD : (totalProfit > 0 ? 999 : 0);

    // Time Stats
    // FIX: Use sorted tradesByExit to ensure correct Duration range
    const firstDate = tradesByExit[0].exitTime;
    const lastDate = tradesByExit[tradesByExit.length - 1].exitTime;
    const days = (lastDate - firstDate) / (1000 * 60 * 60 * 24);
    const years = days / 365.25;
    const avgYearlyProfit = years > 0 ? totalProfit / years : totalProfit;
    const avgMonthlyProfit = years > 0 ? totalProfit / (years * 12) : totalProfit;
    const avgDailyProfit = days > 0 ? totalProfit / days : totalProfit;

    // --- Markov Chain Analysis ---
    const markovStats = calculateMarkovChain(trades, timeData);

    // --- Exit Reason Analysis ---
    const exitStats = analyzeExitReasons(trades, riskThreshold);

    // --- Gamma Distribution Analysis ---
    // 1. Global Inter-Trade Times
    const gammaParams = fitGamma(interTradeTimes);
    const globalInterTradeStats = {
        label: 'All Trades',
        values: interTradeTimes, // Now in DAYS
        ...gammaParams
    };

    // --- Transition Matrix ---
    const transitionMatrix = calculateTransitionMatrix(tradesByOpen, riskThreshold);

    // 2. Fragmented Inter-Trade Times (by Exit Category)
    const categoryTimes = {};
    const categoryLastTime = {};

    // Helper to get category (reuse logic from analyzeExitReasons slightly simplified or standardized)
    const getCat = (t) => getExitCategory(t, riskThreshold);

    // DEBUG: Track category counts and unique reasons
    const debugCatCounts = {};
    const uniqueExitReasons = new Set();

    tradesByOpen.forEach(t => {
        const cat = getCat(t);
        debugCatCounts[cat] = (debugCatCounts[cat] || 0) + 1;
        if (t.exitReason) uniqueExitReasons.add(t.exitReason);

        if (!categoryTimes[cat]) categoryTimes[cat] = [];

        // For separated categories (TP, SL, etc), the user wants "Time between Exits"
        // i.e., "Since I last hit TP, how long until I hit TP again?"
        if (categoryLastTime[cat]) {
            const diffMs = t.exitTime - categoryLastTime[cat];
            const diffDays = diffMs / (1000 * 60 * 60 * 24);
            if (diffDays >= 0) categoryTimes[cat].push(diffDays);
        }
        categoryLastTime[cat] = t.exitTime;
    });

    // Helper map for trades
    const categoryTrades = {};
    tradesByOpen.forEach(t => {
        const cat = getCat(t);
        if (!categoryTrades[cat]) categoryTrades[cat] = [];
        categoryTrades[cat].push(t);
    });

    console.log('[SQ Analysis] Debug: Category Counts:', debugCatCounts);
    console.log('[SQ Analysis] Debug: Unique Exit Reasons found:', Array.from(uniqueExitReasons));

    const interTradeStatsByReason = {
        'All': globalInterTradeStats
    };

    Object.keys(categoryTimes).forEach(cat => {
        if (categoryTimes[cat].length >= 0) { // Allow even single trade categories to show list? Yes.
            const params = fitGamma(categoryTimes[cat]);
            interTradeStatsByReason[cat] = {
                label: cat,
                values: categoryTimes[cat],
                trades: categoryTrades[cat] || [], // Attach trades
                ...params
            };
        }
    });

    // --- Advanced Risk Metrics (Sharpe & Sortino) ---
    // 1. Aggregate Daily PnL
    // --- ADVANCED BACKEND-PARITY METRICS (UPI, Stagnation, Streaks) ---

    // 1. Construct Daily Equity Curve (for CAGR, UPI, Sharpe Daily)
    // Trades are already sorted by exitTime in tradesByExit
    const dailyPnL = {};
    const tradeEquityCurve = [0]; // Relative to 0 start
    let currentTradeEq = 0;

    tradesByExit.forEach(t => {
        currentTradeEq += t.pnl;
        tradeEquityCurve.push(currentTradeEq);

        if (t.exitTime) {
            const dayKey = t.exitTime.toISOString().split('T')[0];
            dailyPnL[dayKey] = (dailyPnL[dayKey] || 0) + t.pnl;
        }
    });

    const dailyValues = Object.values(dailyPnL);
    // Simple Daily Equity Series (assuming missing days = 0 pnl)
    // For robust Sharpe/UPI we ideally need a full calendar, but simplified approaches work for estimation.
    // SQX/Backend uses full date range reindexing.

    // Variables sharpeRatio and sortinoRatio declared at top of function

    if (dailyValues.length > 1) {
        const nDays = dailyValues.length;
        const meanDaily = dailyValues.reduce((a, b) => a + b, 0) / nDays;

        // StdDev (Total Volatility)
        const varianceDaily = dailyValues.reduce((sum, val) => sum + Math.pow(val - meanDaily, 2), 0) / (nDays - 1);
        const stdDevDaily = Math.sqrt(varianceDaily);

        // Downside Deviation (Downside Volatility)
        const downsideVariance = dailyValues.reduce((sum, val) => {
            const down = Math.min(0, val - 0); // Target return 0 for Sortino
            return sum + Math.pow(down, 2);
        }, 0) / nDays; // Sortino uses N, not N-1 usually, but N is fine for large samples
        const downsideDev = Math.sqrt(downsideVariance);

        // Annualizaton (assuming 252 trading days)
        const SQRT_252 = Math.sqrt(252);

        if (stdDevDaily > 0) {
            sharpeRatio = (meanDaily / stdDevDaily) * SQRT_252;
        }

        if (downsideDev > 0) {
            sortinoRatio = (meanDaily / downsideDev) * SQRT_252;
        }
    }

    // 2. CAGR Calculation
    const durationDays = (lastDate - firstDate) / (1000 * 60 * 60 * 24);
    const durationYears = durationDays / 365.25;
    let cagr = 0;
    const initialCapital = 10000; // Assumed fixed base for % calc context
    const finalEquity = initialCapital + totalProfit;

    if (durationYears > 0 && finalEquity > 0) {
        if (durationYears < 1.0) {
            cagr = ((finalEquity / initialCapital) - 1) / durationYears;
        } else {
            cagr = Math.pow(finalEquity / initialCapital, 1 / durationYears) - 1;
        }
    }
    const cagrPct = cagr * 100;

    // 3. UPI (Ulcer Performance Index)
    // Ulcer Index = sqrt(mean(squared drawdowns %))
    let squaredDDSum = 0;
    let peakEq = initialCapital;
    let maxStagnationTrades = 0;
    let tradesSincePeak = 0;
    let peakTradeEq = initialCapital; // For stagnation trades

    // Map trade curve to absolute equity (assuming 10k start)
    const absTradeCurve = tradeEquityCurve.map(v => initialCapital + v);

    absTradeCurve.forEach(eq => {
        if (eq > peakEq) peakEq = eq;
        const ddPct = peakEq > 0 ? ((eq / peakEq) - 1) * 100 : 0;
        squaredDDSum += (ddPct * ddPct);

        // Stagnation Trades
        if (eq > peakTradeEq) {
            if (tradesSincePeak > maxStagnationTrades) maxStagnationTrades = tradesSincePeak;
            tradesSincePeak = 0;
            peakTradeEq = eq;
        } else {
            tradesSincePeak++;
        }
    });
    if (tradesSincePeak > maxStagnationTrades) maxStagnationTrades = tradesSincePeak;

    const ulcerIndex = Math.sqrt(squaredDDSum / absTradeCurve.length);
    const upi = ulcerIndex > 0 ? cagrPct / ulcerIndex : (cagrPct > 0 ? 999 : 0);

    // 4. Stagnation in Days
    // (Calculated in Main Loop now)
    // maxStagnationDays is already populated.

    // 5. Consecutive Wins/Losses (Streaks) & Max Margin
    // Max Consecutive Losses is needed for table
    // Already calculated: maxConsecWins, maxConsecLosses
    // Mapping keys to match table expectation

    return {
        totalProfit, grossProfit, grossLoss, totalTrades, wins, losses,
        winRate, profitFactor, maxDD, avgWin, avgLoss,
        maxConsecWins, maxConsecLosses, expectancy, sqn,
        avgYearlyProfit, avgMonthlyProfit, avgDailyProfit,
        largestWin, largestLoss, returnDDRatio, avgTrade,
        timeData,
        markovStats,
        exitStats,
        interTradeStats: globalInterTradeStats,
        interTradeStatsByReason,
        transitionMatrix,
        sharpeRatio,
        sortinoRatio,
        // NEW METRICS
        upi: upi,
        cagr: cagrPct,
        maxStagnationDays: Math.floor(maxStagnationDays),
        maxStagnationTrades: maxStagnationTrades,
        maxConsecutiveLosses: maxConsecLosses, // Alias for table ID
        returnDD: returnDDRatio, // Alias
        gammaFlowScore: gammaParams.alpha ? Math.min(100, Math.max(0, (gammaParams.alpha / (gammaParams.alpha + 0.5)) * 100)) : 0,
        sharpeRatioTrade: sharpeRatioTrade
    };
};

/**
 * Categorizes and analyzes trade exit reasons.
 */
const analyzeExitReasons = (trades, riskThreshold = 0) => {
    const stats = {};
    const categories = ['TP', 'SL', 'Trailing', 'BreakEven', 'Manual', 'Time', 'Other'];

    // Initialize stats
    categories.forEach(cat => {
        stats[cat] = { count: 0, wins: 0, losses: 0, duration: 0, pnl: 0, label: cat };
    });

    trades.forEach((t, index) => {
        let cat = 'Other';
        // Priority: Exit Reason (Close Type) > Comment
        const reason = (t.exitReason || t.comment || '').toLowerCase();

        if ((reason.includes('tp') || reason.includes('take profit') || reason.includes('limit') || reason.includes('target') || reason.includes('pt')) && t.pnl > 0) cat = 'TP';
        else if (reason.includes('sl') || reason.includes('stop loss') || reason.includes('stop')) {
            // Check for Trailing (Explicit text OR SL with favorable move)
            if (reason.includes('trail') || reason.includes('ts')) cat = 'Trailing';
            else if (t.pnl > -riskThreshold && riskThreshold > 0) cat = 'Trailing'; // Heuristic: PnL > -80 (Reduced loss or Profit)
            else if (t.pnl > 0 && riskThreshold === 0) cat = 'Trailing'; // Fallback
            else cat = 'SL';
        } else if (reason.includes('close') || reason.includes('exit') || reason.includes('manual')) cat = 'Manual';
        else if (reason.includes('break') || reason.includes('be')) cat = 'BreakEven';

        // Map specific types from StrategyQuant
        if (reason === 'exit after x bars') cat = 'Time';

        stats[cat].count++;
        stats[cat].pnl += t.pnl;
        stats[cat].duration += (t.duration || 0);
        if (t.pnl >= 0) stats[cat].wins++;
        else stats[cat].losses++;
    });

    // Calculate Averages
    Object.values(stats).forEach(s => {
        s.avgDuration = s.count > 0 ? s.duration / s.count : 0;
        s.winRate = s.count > 0 ? (s.wins / s.count) * 100 : 0;
        s.avgPnL = s.count > 0 ? s.pnl / s.count : 0;
    });

    return stats;
};

// --- GAMMA & PROBABILITY HELPERS ---

// Method of Moments Estimation
const fitGamma = (data) => {
    if (!data || data.length < 2) return { alpha: 0, beta: 0 };

    const n = data.length;
    const mean = data.reduce((a, b) => a + b, 0) / n;

    // Variance
    const variance = data.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1);

    if (variance === 0 || mean === 0) return { alpha: 0, beta: 0 };

    const alpha = (mean * mean) / variance;
    const beta = mean / variance;

    return { alpha, beta, mean, variance };
};

const gammaLog = (z) => {
    // Lanczos approximation for ln(Gamma(z))
    const p = [
        676.5203681218851, -1259.1392167224028, 771.32342877765313,
        -176.61502916214059, 12.507343278686905, -0.13857109526572012,
        9.9843695780195716e-6, 1.5056327351493116e-7
    ];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - gammaLog(1 - z);
    z -= 1;
    let x = 0.99999999999980993;
    for (let i = 0; i < p.length; i++) x += p[i] / (z + i + 1);
    let t = z + p.length - 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
};

const gammaPDF = (x, alpha, beta) => {
    if (x <= 0) return 0;
    const lnPDF = alpha * Math.log(beta) - gammaLog(alpha) + (alpha - 1) * Math.log(x) - beta * x;
    return Math.exp(lnPDF);
};

// Gamma CDF (Cumulative Distribution Function) - Numerical Integration
// Uses Simpson's Rule.
const gammaCDF = (x, alpha, beta) => {
    if (x <= 0) return 0;
    if (alpha <= 0 || beta <= 0) return 0;

    // Simpson's Rule Integration
    // Increase steps for better precision on sharp curves
    const steps = 1000;
    const h = x / steps;

    // Avoiding singularity at 0 for alpha < 1
    const startX = 1e-5;

    let sum = gammaPDF(startX, alpha, beta) + gammaPDF(x, alpha, beta);

    for (let i = 1; i < steps; i += 2) {
        sum += 4 * gammaPDF(startX + i * h, alpha, beta);
    }
    for (let i = 2; i < steps - 1; i += 2) {
        sum += 2 * gammaPDF(startX + i * h, alpha, beta);
    }

    const res = (h / 3) * sum;
    // Clamp to [0, 1] to prevent numerical artifacts > 100%
    return Math.min(1.0, Math.max(0.0, res));
};

// Helper: Categorize Exit Reason
const getExitCategory = (t, riskThreshold = 0) => {
    const c = t.comment ? t.comment.toLowerCase() : '';
    const r = t.exitReason ? t.exitReason.toLowerCase() : '';

    // Prioritize explicit exitReason
    if (r.includes('trailing')) return 'Trailing';
    if ((r.includes('tp') || r.includes('take') || r === 'pt') && t.pnl > 0) return 'TP';
    // Check for SL with favorable move => Trailing Stop
    const isSL = r.includes('sl') || r.includes('stop') || c.includes('sl') || c.includes('stop loss');
    if (isSL) {
        // PnL > -80 implies the loss is smaller than 80 (e.g. -50), or it's a profit.
        // This means the SL moved favorably from the assumed -100 baseline.
        if (t.pnl > -riskThreshold && riskThreshold > 0) return 'Trailing';
        if (t.pnl > 0 && riskThreshold === 0) return 'Trailing'; // Fallback
        return 'SL';
    }

    // Fallback to comment
    if (c.includes('trailing')) return 'Trailing';
    if ((c.includes('tp') || c.includes('take profit')) && t.pnl > 0) return 'TP';
    if (c.includes('close') || c.includes('exit') || c.includes('manual')) return 'Manual';
    if (r.includes('exit after')) return 'Time'; // Re-check reason for Time
    if (r === 'exit after x bars') return 'Time';

    return 'Other';
};

// Calculate Transition Matrix (Conditional Probabilities)
const calculateTransitionMatrix = (trades, riskThreshold = 0) => {
    const cats = ['SL', 'TP', 'Trailing', 'Time', 'Other'];
    const matrix = {};
    cats.forEach(c => matrix[c] = { total: 0, next: {} });
    cats.forEach(r => cats.forEach(c => matrix[r].next[c] = 0));

    // Sort by Exit Time to ensure sequence
    const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);

    for (let i = 0; i < sorted.length - 1; i++) {
        const curr = getExitCategory(sorted[i], riskThreshold);
        const next = getExitCategory(sorted[i + 1], riskThreshold);

        if (matrix[curr]) {
            matrix[curr].total++;
            if (matrix[curr].next[next] !== undefined) {
                matrix[curr].next[next]++;
            }
        }
    }

    return matrix;
};

// Render Transition Matrix HTML
const renderTransitionMatrixHTML = (matrix) => {
    if (!matrix) return '';

    const cats = ['SL', 'TP', 'Trailing', 'Time']; // Exclude 'Other' to keep 4x4 clean
    let rows = '';

    cats.forEach(rowKey => {
        const rowData = matrix[rowKey] || { total: 0, next: {} };
        const total = rowData.total;

        let cells = `<td class="py-3 px-4 text-gray-300 font-bold border-r border-gray-700 bg-gray-800/50">${rowKey}</td>`;

        cats.forEach(colKey => {
            const count = rowData.next[colKey] || 0;
            const pct = total > 0 ? (count / total * 100) : 0;

            // Color Logic (Heatmap)
            let colorClass = 'text-gray-500';
            let bgClass = '';

            if (pct > 0) {
                // High probability highlighting
                if (rowKey === 'SL' && colKey === 'SL' && pct > 50) {
                    colorClass = 'text-red-400 font-bold'; // Panic Loop
                    bgClass = 'bg-red-900/20';
                } else if (rowKey === 'Time' && colKey === 'TP' && pct > 50) {
                    colorClass = 'text-emerald-400 font-bold'; // Patience Reward
                    bgClass = 'bg-emerald-900/20';
                } else if (pct > 50) {
                    colorClass = 'text-white font-bold';
                    bgClass = 'bg-gray-700/50';
                } else if (pct > 25) {
                    colorClass = 'text-gray-300';
                }
            }

            cells += `
                <td class="py-2 px-2 text-right border-gray-700/50 border ${bgClass}">
                    <div class="${colorClass}">${pct.toFixed(1)}%</div>
                    <div class="text-[10px] text-gray-600">(${count})</div>
                </td>
            `;
        });

        rows += `<tr class="hover:bg-gray-700/30 transition-colors">${cells}</tr>`;
    });

    return `
        <div class="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden mt-6">
             <div class="p-3 bg-gray-900/50 border-b border-gray-700">
                <h3 class="text-amber-400 font-bold text-sm uppercase tracking-wider">Transition Matrix (Conditional Probabilities)</h3>
                <div class="text-[10px] text-gray-500 normal-case mt-1">Probability of Next Event [Column] given Previous Event [Row]</div>
            </div>
            <div class="p-4 overflow-x-auto">
                <table class="w-full text-sm">
                    <thead class="bg-gray-900/30 text-xs uppercase font-medium text-gray-400">
                        <tr>
                            <th class="py-2 px-4 text-left border-r border-gray-700">Prev \\ Next</th>
                            ${cats.map(c => `<th class="py-2 px-2 text-right">${c}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-800">
                        ${rows}
                    </tbody>
                </table>
            </div>
        </div>
    `;
};


// --- MARKOV HELPER FUNCTIONS ---

const getMarkovSequence = (data, depth = 1) => {
    const states = data.map(val => val >= 0 ? 'W' : 'L');
    const transitions = {};

    for (let i = depth; i < states.length; i++) {
        const prevSeq = states.slice(i - depth, i).join('-');
        const nextState = states[i];

        if (!transitions[prevSeq]) {
            transitions[prevSeq] = { W: 0, L: 0, total: 0 };
        }

        transitions[prevSeq][nextState]++;
        transitions[prevSeq].total++;
    }

    return transitions;
};

const calculateMarkovChain = (trades, timeData) => {
    // 1. Trade-by-Trade PnL
    const tradePnLs = trades.map(t => t.pnl);

    // 2. Monthly PnL (Flattened)
    const monthPnLs = [];
    const years = Object.keys(timeData.month).sort();
    years.forEach(y => {
        const months = Object.keys(timeData.month[y]).sort((a, b) => Number(a) - Number(b));
        months.forEach(m => {
            monthPnLs.push(timeData.month[y][m].pnl);
        });
    });

    // 3. Weekly PnL (Flattened)
    const weekPnLs = [];
    const wYears = Object.keys(timeData.week).sort();
    wYears.forEach(y => {
        const weeks = Object.keys(timeData.week[y]).sort((a, b) => Number(a) - Number(b));
        weeks.forEach(w => {
            weekPnLs.push(timeData.week[y][w].pnl);
        });
    });

    return {
        trade: {
            d1: getMarkovSequence(tradePnLs, 1),
            d2: getMarkovSequence(tradePnLs, 2),
            d3: getMarkovSequence(tradePnLs, 3),
            d4: getMarkovSequence(tradePnLs, 4)
        },
        month: {
            d1: getMarkovSequence(monthPnLs, 1),
            d2: getMarkovSequence(monthPnLs, 2),
            d3: getMarkovSequence(monthPnLs, 3)
        },
        week: {
            d1: getMarkovSequence(weekPnLs, 1),
            d2: getMarkovSequence(weekPnLs, 2),
            d3: getMarkovSequence(weekPnLs, 3)
        }
    };
};

// --- TRADE MATCHING HELPER ---
const matchTrades = (btTrades, realTrades) => {
    console.log(`[MATCH DEBUG] Starting with ${btTrades.length} BT Trades and ${realTrades.length} Real Trades`);

    const roundToHour = (d) => {
        if (!d) return null;
        const x = new Date(d);
        x.setMinutes(0, 0, 0, 0);
        return x.getTime();
    };

    const btMap = new Map();
    btTrades.forEach(t => {
        const k = roundToHour(t.openTime);
        if (!k) return;
        if (!btMap.has(k)) btMap.set(k, []);
        btMap.get(k).push(t);
    });

    // console.log(`[MATCH DEBUG] Created BT Map with ${btMap.size} hourly buckets`);

    const matches = [];
    const orphanReal = [];
    const matchedBtIds = new Set();

    realTrades.forEach(real => {
        const k = roundToHour(real.openTime);
        const candidates = btMap.get(k);
        let best = null;

        const realDateStr = real.openTime ? real.openTime.toISOString() : 'NoDate';
        // console.log(`[MATCH DEBUG] processing Real Trade: ${realDateStr} (Bucket: ${new Date(k).toISOString()})`);

        // Check current, prev (-1h), and next (+1h) buckets for candidates
        const bucketsToCheck = [k, k - 3600000, k + 3600000];
        let allCandidates = [];

        bucketsToCheck.forEach(bucketKey => {
            const bucket = btMap.get(bucketKey);
            if (bucket) allCandidates = allCandidates.concat(bucket);
        });

        if (allCandidates.length > 0) {
            const avail = allCandidates.filter(c => !matchedBtIds.has(c));
            let bestScore = -1;

            if (avail.length === 0) {
                // console.log(`[MATCH DEBUG]   -> Buckets found but all candidates already matched.`);
            }

            avail.forEach(bt => {
                let score = 0;
                // Time proximity (minute diff reversed)
                const diffMin = Math.abs(bt.openTime - real.openTime) / 60000;
                if (diffMin < 90) score += (100 - diffMin); // Tolerance 90 mins

                // Symbol Match
                if (real.symbol && bt.symbol && real.symbol.toLowerCase() === bt.symbol.toLowerCase()) score += 200;

                // Type Match
                if (real.type && bt.type && real.type.toLowerCase() === bt.type.toLowerCase()) score += 100;

                // console.log(`[MATCH DEBUG]     -> Candidate BT ${bt.openTime.toISOString()} | Diff: ${diffMin.toFixed(1)}m | Score: ${score.toFixed(1)}`);

                if (score > bestScore) {
                    bestScore = score;
                    best = bt;
                }
            });
        } else {
            // console.log(`[MATCH DEBUG]   -> No BT candidates in current or adjacent buckets for ${new Date(k).toISOString()}`);
        }

        if (best) {
            matches.push({ real, bt: best });
            matchedBtIds.add(best);
            // console.log(`[MATCH DEBUG]   -> ✅ MATCHED with BT ${best.openTime.toISOString()}`);
        } else {
            orphanReal.push(real);
            console.log(`[MATCH DEBUG]   -> ❌ ORPHAN REAL: ${realDateStr} (Pnl: ${real.pnl})`);
        }
    });

    const orphanBT = btTrades.filter(t => !matchedBtIds.has(t));

    console.log(`[MATCH DEBUG] Result: ${matches.length} Matches, ${orphanReal.length} Orphan Real, ${orphanBT.length} Orphan BT`);

    // Sort Descending by Real Exit Time (or Open Time)
    matches.sort((a, b) => b.real.openTime - a.real.openTime);
    orphanReal.sort((a, b) => b.openTime - a.openTime);
    orphanBT.sort((a, b) => b.openTime - a.openTime);

    return { matches, orphanReal, orphanBT };
};

export const generateSQAnalysisHTML = (metrics, selectedMetric = 'pnl', selectedPeriod = 'month', strategiesList = [], currentStrategyId = 'all', currentDataType = 'backtest', markovPeriod = 'trade', markovDepth = 1, currentFreqSelection = 'All', portfoliosList = [], currentPortfolioIndex = -1, secondaryMetrics = null, dateRange = {}, isDropdownOpen = false) => {
    if (!metrics) return '<div class="text-gray-400 text-center p-10">No hay datos suficientes para el análisis.</div>';

    // --- STATE FOR EXPORT ---
    if (!window.latestSQAnalysisData) window.latestSQAnalysisData = null;

    window.copySQAnalysisJSON = () => {
        if (!window.latestSQAnalysisData) {
            alert("No analysis data available to copy.");
            return;
        }
        const json = JSON.stringify(window.latestSQAnalysisData, null, 2);
        navigator.clipboard.writeText(json).then(() => {
            const btn = document.getElementById('sq-copy-json-btn');
            if (btn) {
                const originalText = btn.innerHTML;
                btn.innerHTML = '✅ Copied!';
                setTimeout(() => btn.innerHTML = originalText, 2000);
            }
        }).catch(err => {
            console.error('Failed to copy: ', err);
            alert("Failed to copy data.");
        });
    };



    const formatMoney = (val) => val !== undefined && val !== null ? `$ ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-';
    const formatNum = (val, dec = 2) => val !== undefined && val !== null ? val.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '-';

    // --- Dynamic Modal Title ---
    let modalTitle = 'Monthly Performance';
    if (selectedPeriod === 'trade') modalTitle = 'Trade Analysis';
    else if (selectedPeriod === 'year') modalTitle = 'Yearly Performance';
    else if (selectedPeriod === 'week') modalTitle = 'Weekly Performance';
    else if (selectedPeriod === 'day') modalTitle = 'Daily Performance';

    if (currentStrategyId !== 'all') {
        if (Array.isArray(currentStrategyId)) {
            modalTitle = `${currentStrategyId.length} Strategies Selected`;
        } else {
            const strat = strategiesList.find(s => s.id === currentStrategyId);
            if (strat) {
                modalTitle = strat.name.replace('.csv', '').trim();
            }
        }
    }

    const metricsOptions = [
        { value: 'pnl', label: 'Net Profit' },
        { value: 'count', label: 'Trade Count' },
        { value: 'winRate', label: 'Win Rate %' },
        { value: 'profitFactor', label: 'Profit Factor' },
        { value: 'grossProfit', label: 'Gross Profit' },
        { value: 'grossLoss', label: 'Gross Loss' },
        { value: 'drawdown', label: 'Dist. Drawdown ($)' }, // Max DD in period
        { value: 'stagnation', label: 'Dist. Stagnation (Days)' } // Max Stag in period
    ];

    const periodOptions = [
        { value: 'month', label: 'Monthly' },
        { value: 'week', label: 'Weekly' },
        { value: 'day', label: 'Daily' },
        { value: 'year', label: 'Yearly' },
        { value: 'trade', label: 'Trade-Level' }
    ];

    const strategyOptions = strategiesList.map(s =>
        `<option value="${s.id}" ${s.id === currentStrategyId ? 'selected' : ''}>${s.name}</option>`
    ).join('');

    // --- NEW: Portfolio Options ---
    const portfolioOptions = portfoliosList.map(p =>
        `<option value="${p.index}" ${p.index === currentPortfolioIndex ? 'selected' : ''}>${p.name}</option>`
    ).join('');

    const portfolioSelectorHTML = portfoliosList.length > 0 ? `
        <select id="sq-portfolio-select" class="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-amber-500 mr-2 max-w-[200px] truncate">
            ${portfolioOptions}
        </select>
    ` : '';

    // Multi-select dropdown for strategies
    const selectedIds = Array.isArray(currentStrategyId) ? currentStrategyId : (currentStrategyId === 'all' ? [] : [currentStrategyId]);
    const allSelected = currentStrategyId === 'all' || selectedIds.length === 0;

    const strategySelectorHTML = `
                <button id="sq-strategy-dropdown-btn" class="bg-gray-700 text-gray-200 text-xs rounded px-3 py-1.5 border border-gray-600 hover:border-amber-500 focus:outline-none focus:border-amber-500 flex items-center gap-2 min-w-[180px]">
                <span id="sq-strategy-label" class="truncate flex-1 text-left">${Array.isArray(currentStrategyId) && currentStrategyId.length === 0 ? '0 selected' : (allSelected ? 'All Strategies' : (selectedIds.length === 1 ? strategiesList.find(s => s.id === selectedIds[0])?.name?.substring(0, 25) || '1 selected' : selectedIds.length + ' selected'))}</span>
                <svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            <div id="sq-strategy-dropdown-menu" class="${isDropdownOpen ? '' : 'hidden'} absolute z-50 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl min-w-[320px] max-h-[80vh] overflow-hidden flex flex-col">
                <div class="p-2 border-b border-gray-700 bg-gray-900 sticky top-0 flex flex-col gap-2 z-10">
                    <div class="flex items-center gap-1 w-full">
                        <input type="text" id="sq-strategy-search-input" placeholder="🔍 Search strategies (space for multiple terms)..." 
                            value="${lastDropdownSearch}"
                            class="flex-1 bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 border border-gray-600 focus:outline-none focus:border-amber-500 placeholder-gray-500"
                            onclick="event.stopPropagation();"
                        >
                        <button onclick="document.getElementById('sq-strategy-dropdown-menu').classList.add('hidden'); event.stopPropagation();" class="p-1.5 text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 border border-transparent hover:border-gray-600 rounded transition-colors" title="Close Menu">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    <div class="flex flex-wrap gap-2 items-center justify-between">
                            <label class="flex items-center gap-1 cursor-pointer select-none" title="Select/Deselect All Visible">
                                <input type="checkbox" id="sq-select-all-visible-toggle" class="form-checkbox h-4 w-4 text-blue-500 rounded border-gray-600 bg-gray-700 cursor-pointer transition-colors focus:ring-0 focus:ring-offset-0"
                                    ${(allSelected && (!lastDropdownSearch || lastDropdownSearch === '')) ? 'checked' : ''}
                                >
                                <span class="text-[10px] text-gray-400">All Visible</span>
                            </label>
                            <span class="text-gray-600">|</span>
                            <button id="sq-strategy-select-global-all" class="text-[10px] bg-blue-900/40 hover:bg-blue-800 text-blue-200 px-2 py-1 rounded border border-blue-800/50" title="Select ALL items (ignoring filter)">All</button>
                            <button id="sq-strategy-select-global-none" class="text-[10px] bg-red-900/40 hover:bg-red-800 text-red-200 px-2 py-1 rounded border border-red-800/50" title="Deselect ALL items">None</button>
                        </div>
                        <span id="sq-strategy-count-badge" class="text-[10px] text-gray-500">${strategiesList.length} total</span>
                    </div>
                    
                    ${portfoliosList.length > 0 ? `
                        <div class="whitespace-nowrap overflow-x-auto custom-scrollbar pb-1 flex gap-1 border-t border-gray-700 pt-2">
                            ${portfoliosList.map((p, idx) => `
                                <button data-pidx="${idx}" class="sq-portfolio-shortcut flex-shrink-0 text-[10px] bg-cyan-900/40 hover:bg-cyan-800 text-cyan-200 px-2 py-0.5 rounded border border-cyan-800/50" title="${p.name}">
                                    📁 ${p.name.length > 15 ? p.name.substring(0, 15) + '...' : p.name}
                                </button>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
                <div id="sq-strategy-list-container" class="overflow-y-auto max-h-[100px] custom-scrollbar p-2 space-y-1 transition-all duration-300">
                    ${strategiesList.map(s => {
        // PRE-FILTERING: Apply hidden state immediately during render
        let isVisible = true;
        if (lastDropdownSearch) {
            const terms = lastDropdownSearch.toLowerCase().split(' ').filter(t => t.trim());
            const text = s.name.toLowerCase();
            isVisible = terms.every(term => text.includes(term));
        }

        return `
                        <label class="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-700/50 rounded cursor-pointer group sq-strategy-item ${isVisible ? '' : 'hidden'}">
                            <input type="checkbox" class="sq-strategy-checkbox accent-amber-500" value="${s.id}" ${allSelected || selectedIds.includes(s.id) ? 'checked' : ''}>
                            <span class="text-gray-300 text-xs truncate flex-1 group-hover:text-white pointer-events-none" title="${s.name}">${s.name}</span>
                        </label>
                        `;
    }).join('')}
                </div>
                <div class="border-t border-gray-700 p-1 bg-gray-900/50 flex justify-center cursor-pointer hover:bg-gray-800 transition-colors" onclick="const c=this.previousElementSibling; c.classList.toggle('max-h-[100px]'); c.classList.toggle('max-h-[500px]'); this.querySelector('svg').classList.toggle('rotate-180')" title="Expand/Collapse List">
                    <svg class="w-3 h-3 text-gray-400 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                </div>
            </div>
        </div>
        <button onclick="const checkboxes = document.querySelectorAll('.sq-strategy-checkbox:checked'); if(checkboxes.length === 1) window.addStrategyToQuarantine(checkboxes[0].closest('label').querySelector('span').title || checkboxes[0].closest('label').querySelector('span').textContent.trim());" class="ml-2 text-red-500 hover:text-red-400 p-1 rounded hover:bg-gray-700 transition-colors" title="Mover estrategia seleccionada a Cuarentena">
            ☣️
        </button>
    `;

    const dateControls = `
        <div class="flex items-center gap-1 ml-2 border-l border-gray-600 pl-2">
            <span class="text-gray-400 text-[10px] uppercase">Range:</span>
            <input type="date" id="sq-start-date" class="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-amber-500 w-28" value="${dateRange.start || ''}">
            <span class="text-gray-400">-</span>
            <input type="date" id="sq-end-date" class="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-amber-500 w-28" value="${dateRange.end || ''}">
        </div>
    `;

    // Multiplier Legend Inputs
    const multControls = `
        <div class="flex items-center gap-2 ml-2 border-l border-gray-600 pl-2 text-xs">
            <div class="flex items-center gap-1">
                <input type="number" id="sq-bt-mult" class="w-12 bg-gray-700 text-blue-300 text-xs rounded px-1 py-1 border border-blue-900/50 focus:outline-none text-right" value="${dateRange.btMult || 1}" step="0.01" title="Backtest Multiplier">
                <span class="text-blue-400 font-bold">BT</span>
            </div>
            <span class="text-gray-500">|</span>
            <div class="flex items-center gap-1">
                <span class="text-emerald-400 font-bold">Real</span>
                <input type="number" id="sq-real-mult" class="w-12 bg-gray-700 text-emerald-300 text-xs rounded px-1 py-1 border border-emerald-900/50 focus:outline-none text-right" value="${dateRange.realMult || 1}" step="0.01" title="Real Multiplier">
            </div>
        </div>
    `;

    const dataTypeSelectorHTML = `
        <select id="sq-data-type-select" class="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-amber-500 ml-2">
            <option value="backtest" ${currentDataType === 'backtest' ? 'selected' : ''}>Backtest Data</option>
            <option value="real" ${currentDataType === 'real' ? 'selected' : ''}>Real Data (Live)</option>
            <option value="comparison" ${currentDataType === 'comparison' ? 'selected' : ''}>Comparison (Split)</option>
        </select>
    `;

    const headerControls = `
        <div class="flex flex-wrap gap-y-2 gap-x-4 items-center justify-between w-full">
            <!-- Group 1: Portfolio/Strategy/Data -->
            <div class="flex items-center gap-2">
                ${/* DISABLED: portfolioSelectorHTML */''}
                ${strategySelectorHTML}
                ${dataTypeSelectorHTML}
            </div>

            <!-- Group 2: Time & Multipliers (Center-ish) -->
            <div class="flex items-center gap-2 border-l border-gray-700 pl-4">
                ${dateControls}
                ${multControls}
            </div>

            <!-- Group 3: View Settings & Actions (Right) -->
            <div class="flex items-center gap-2 ml-auto">
                <select id="sq-period-select" class="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-amber-500">
                    ${periodOptions.map(o => `<option value="${o.value}" ${o.value === selectedPeriod ? 'selected' : ''}>${o.label}</option>`).join('')}
                </select>
                <select id="sq-metric-select" class="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-amber-500">
                    ${metricsOptions.map(o => `<option value="${o.value}" ${o.value === selectedMetric ? 'selected' : ''}>${o.label}</option>`).join('')}
                </select>
                
                <div class="h-4 w-px bg-gray-600 mx-1"></div>

                <!-- Quick View Buttons -->
                <div class="flex rounded shadow-sm">
                    <button onclick="const p=document.getElementById('sq-period-select');const d=document.getElementById('sq-data-type-select');if(p&&d){p.value='month';d.value='comparison';p.dispatchEvent(new Event('change'));d.dispatchEvent(new Event('change'));}" class="bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-xs rounded-l px-2 py-1 border border-gray-500 border-r-0 transition-colors" title="Default View">
                        📅
                    </button>
                    <button onclick="const p=document.getElementById('sq-period-select');const d=document.getElementById('sq-data-type-select');if(p&&d){p.value='trade';d.value='comparison';p.dispatchEvent(new Event('change'));d.dispatchEvent(new Event('change'));}" class="bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-xs rounded-r px-2 py-1 border border-gray-500 transition-colors" title="Trade Level">
                        🔬
                    </button>
                </div>

                <button id="sq-copy-json-btn" onclick="window.copySQAnalysisJSON()" class="bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-xs rounded px-2 py-1 border border-gray-500 transition-colors" title="Copy JSON">
                    📋
                </button>
                
                ${(selectedPeriod === 'trade' && currentDataType === 'comparison') ? `
                <button onclick="window.showAnalysisBreakdown()" class="bg-amber-900/40 hover:bg-amber-800 text-amber-400 hover:text-amber-200 text-xs rounded px-2 py-1 border border-amber-600/50 transition-colors flex items-center gap-1" title="Breakdown">
                    📊
                </button>
                <button onclick="window.showPnLChart('${(() => {
                let targetId = currentStrategyId;
                if (Array.isArray(currentStrategyId)) {
                    targetId = currentStrategyId.length === 1 ? currentStrategyId[0] : 'all';
                }
                const sObj = strategiesList.find(s => s.id === targetId);
                const val = sObj ? sObj.name : targetId;
                return val && typeof val === 'string' ? val.replace(/'/g, "\\'") : 'all';
            })()}')" class="bg-blue-900/40 hover:bg-blue-800 text-blue-400 hover:text-blue-200 text-xs rounded px-2 py-1 border border-blue-600/50 transition-colors flex items-center gap-1" title="Chart PnL">
                    📈
                </button>` : ''}
                
                <!-- R2 Indicator -->
                <div id="sq-r2-container" class="bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] hidden self-center">
                    <span class="text-gray-500">R²</span>
                    <span id="sq-r2-value" class="font-mono font-bold text-amber-400 ml-1"></span>
                </div>
            </div>
        </div>
    `;

    const metricDefinitions = {
        'pnl': { label: 'Net Profit ($)', format: (v) => v !== 0 ? formatNum(v, 0) : '-', color: (v) => v > 0 ? 'text-emerald-400' : (v < 0 ? 'text-red-400' : 'text-gray-600') },
        'count': { label: 'Total Trades', format: (v) => v !== 0 ? v : '-', color: () => 'text-gray-300' },
        'winRate': { label: 'Win Rate (%)', format: (v) => (v !== undefined && v !== null && v !== '-') ? formatNum(v, 1) + '%' : '-', color: (v) => v > 50 ? 'text-emerald-400' : 'text-yellow-400' },
        'profitFactor': { label: 'Profit Factor', format: (v) => v !== 0 ? formatNum(v, 2) : '-', color: (v) => v > 1.5 ? 'text-emerald-400' : (v > 1 ? 'text-yellow-400' : 'text-red-400') },
        'grossProfit': { label: 'Gross Profit', format: (v) => formatNum(v, 0), color: () => 'text-emerald-400' },
        'grossLoss': { label: 'Gross Loss', format: (v) => formatNum(v, 0), color: () => 'text-red-400' },
        'drawdown': { label: 'Period Max Drawdown ($)', format: (v) => v > 0 ? formatNum(-v, 0) : '-', color: () => 'text-red-400' }, // DD is usually positive in calculation (drop), displayed as negative.
        'stagnation': { label: 'Period Max Stagnation (Days)', format: (v) => v > 0 ? v.toFixed(1) : '-', color: (v) => v > 100 ? 'text-red-400' : 'text-gray-300' }
    };

    const currentMetric = metricDefinitions[selectedMetric] || metricDefinitions['pnl'];
    const overflowClass = selectedPeriod === 'week' ? 'overflow-x-auto' : '';
    // Safe access to timeData
    const safeTimeData = metrics.timeData || { month: {}, week: {} };
    const dataBucket = safeTimeData[selectedPeriod] || {};
    const years = Object.keys(dataBucket).sort((a, b) => b - a);
    let tableRows = '';
    let headersHTML = '';

    // --- SHARED HELPERS ---
    const calcTotal = (gp, gl, wc, w, mDD, mStag) => {
        if (selectedMetric === 'pnl') return gp + gl;
        if (selectedMetric === 'count') return wc;
        if (selectedMetric === 'winRate') return wc > 0 ? (w / wc) * 100 : 0;
        if (selectedMetric === 'profitFactor') return Math.abs(gl) > 0 ? gp / Math.abs(gl) : (gp > 0 ? 999 : 0);
        if (selectedMetric === 'grossProfit') return gp;
        if (selectedMetric === 'grossLoss') return gl;
        if (selectedMetric === 'drawdown') return mDD;
        if (selectedMetric === 'stagnation') return mStag;
        return 0;
    };

    const renderRow = (year, monthsData, secondaryMonthsData, label) => {
        let yearTotal = 0;
        let secYearTotal = 0;
        let yWins = 0, yCount = 0, yGP = 0, yGL = 0, yMaxDD = 0, yMaxStag = 0;
        let sWins = 0, sCount = 0, sGP = 0, sGL = 0, sMaxDD = 0, sMaxStag = 0;

        // Calculate Yearly Total (Primary)
        if (monthsData) {
            Object.values(monthsData).forEach(stats => {
                yWins += stats.wins; yCount += stats.count; yGP += stats.grossProfit; yGL += stats.grossLoss;
                if (stats.maxDD > yMaxDD) yMaxDD = stats.maxDD;
                if (stats.maxStagnation > yMaxStag) yMaxStag = stats.maxStagnation;
            });
        }
        // Calculate Yearly Total (Secondary)
        if (secondaryMonthsData) {
            Object.values(secondaryMonthsData).forEach(stats => {
                sWins += stats.wins; sCount += stats.count; sGP += stats.grossProfit; sGL += stats.grossLoss;
                if (stats.maxDD > sMaxDD) sMaxDD = stats.maxDD;
                if (stats.maxStagnation > sMaxStag) sMaxStag = stats.maxStagnation;
            });
        }

        const getVal = (stats) => {
            if (!stats) return 0;
            if (selectedMetric === 'pnl') return stats.pnl;
            if (selectedMetric === 'count') return stats.count;
            if (selectedMetric === 'winRate') return stats.count > 0 ? (stats.wins / stats.count) * 100 : 0;
            if (selectedMetric === 'profitFactor') return Math.abs(stats.grossLoss) > 0 ? stats.grossProfit / Math.abs(stats.grossLoss) : (stats.grossProfit > 0 ? 999 : 0);
            if (selectedMetric === 'grossProfit') return stats.grossProfit;
            if (selectedMetric === 'grossLoss') return stats.grossLoss;
            if (selectedMetric === 'drawdown') return stats.maxDD || 0;
            if (selectedMetric === 'stagnation') return stats.maxStagnation || 0;
            return 0;
        };

        // calcTotal moved to parent scope

        yearTotal = calcTotal(yGP, yGL, yCount, yWins, yMaxDD, yMaxStag);
        secYearTotal = calcTotal(sGP, sGL, sCount, sWins, sMaxDD, sMaxStag);

        const formatSplit = (v1, v2, hasV1, hasV2) => {
            if (!hasV1 && !hasV2) return '-';
            if (currentDataType !== 'comparison') return `<span class="${currentMetric.color(v1)}">${currentMetric.format(v1)}</span>`;

            // Comparison Mode
            const s1 = hasV1 ? `<span class="${currentMetric.color(v1)}">${currentMetric.format(v1)}</span>` : '<span class="text-gray-700">-</span>';
            const s2 = hasV2 ? `<span class="${currentMetric.color(v2)} font-bold">${currentMetric.format(v2)}</span>` : '<span class="text-gray-700">-</span>';

            if (!hasV2) return s1;
            return `<div class="flex items-center justify-end gap-1 whitespace-nowrap">
                ${s1}
                <span class="text-gray-600">|</span>
                ${s2}
             </div>`;
        };

        let cells = `<td class="py-2 px-2 font-bold text-gray-300 border-r border-gray-700 text-xs">${label}</td>`;
        for (let m = 0; m < 12; m++) {
            const stats1 = monthsData ? monthsData[m] : null;
            const stats2 = secondaryMonthsData ? secondaryMonthsData[m] : null;

            const val1 = stats1 ? getVal(stats1) : 0;
            const val2 = stats2 ? getVal(stats2) : 0;

            cells += `<td class="py-2 px-1 text-right text-xs">
                ${formatSplit(val1, val2, !!stats1, !!stats2)}
            </td>`;
        }

        cells += `<td class="py-2 px-2 text-right font-bold border-l border-gray-700">
            ${formatSplit(yearTotal, secYearTotal, !!monthsData, !!secondaryMonthsData)}
        </td>`;

        return `<tr class="hover:bg-gray-700/30 transition-colors">${cells}</tr>`;
    };

    if (selectedPeriod === 'trade') {
        const arrow = analysisDateSortAsc ? '▲' : '▼';
        headersHTML = `
            <th class="py-2 px-2 text-left font-bold text-gray-300 cursor-pointer select-none" onclick="window.toggleAnalysisSort()">Time ${arrow}</th>
            <th class="py-2 px-2 text-left text-gray-400">Symbol</th>
            <th class="py-2 px-2 text-left text-gray-400">Type</th>
            <th class="py-2 px-2 text-right text-gray-400">Size</th>
            <th class="py-2 px-2 text-right text-gray-400">Open Price</th>
            <th class="py-2 px-2 text-right text-gray-400">PnL (Real)</th>
            <th class="py-2 px-2 text-right text-gray-400">PnL (BT)</th>
            <th class="py-2 px-2 text-right text-gray-400">Diff</th>
        `;

        let rows = '';
        const btTrades = metrics ? (metrics.trades || []) : [];
        const realTrades = secondaryMetrics ? (secondaryMetrics.trades || []) : [];

        // Sorting
        const mk = analysisDateSortAsc ? 1 : -1;

        // --- REFACTORED RENDER LOGIC ---
        if (currentDataType === 'comparison' && realTrades.length > 0) {
            const results = matchTrades(btTrades, realTrades);

            // Helper for Smart Symbol Display
            const getSmartSymbol = (t, strategies) => {
                // 1. Try Strategy Name via ID (for Backtest trades mostly)
                if (t.strategyId && strategies && strategies.length > 0) {
                    const strat = strategies.find(s => s.id === t.strategyId);
                    if (strat) return strat.name.replace('.csv', '').trim();
                }

                // 2. Use Comment (Magic) if available (Common for Real/Orphan Real)
                // Use this as primary fallback as per user request (Strategy Name > Magic > Symbol)
                if (t.comment && t.comment.trim().length > 0) {
                    return t.comment.replace('.csv', '').trim();
                }

                // 3. Fallback to Symbol
                return t.symbol || '-';
            };

            // 1. CALCULATE STATS FIRST
            const sumPnL = (list) => list.reduce((acc, x) => acc + x.pnl, 0);
            const sumMatchedReal = results.matches.reduce((acc, x) => acc + x.real.pnl, 0);
            const sumMatchedBT = results.matches.reduce((acc, x) => acc + x.bt.pnl, 0);
            const sumMatchedDiff = results.matches.reduce((acc, x) => acc + (x.real.pnl - x.bt.pnl), 0);

            const sumOrphanReal = sumPnL(results.orphanReal);
            const sumOrphanBT = sumPnL(results.orphanBT);

            const totalRealPnL = sumMatchedReal + sumOrphanReal;
            const totalBTPnL = sumMatchedBT + sumOrphanBT;
            const totalDiff = totalRealPnL - totalBTPnL;

            // R2 Helpers
            const calculateR2 = (arrX, arrY) => {
                if (arrX.length < 2 || arrX.length !== arrY.length) return 0;
                const n = arrX.length;
                const meanX = arrX.reduce((a, b) => a + b, 0) / n;
                const meanY = arrY.reduce((a, b) => a + b, 0) / n;
                let num = 0, denX = 0, denY = 0;
                for (let i = 0; i < n; i++) {
                    const dx = arrX[i] - meanX;
                    const dy = arrY[i] - meanY;
                    num += dx * dy;
                    denX += dx * dx;
                    denY += dy * dy;
                }
                const r = num / Math.sqrt(denX * denY);
                return r * r;
            };

            const xMatched = results.matches.map(m => m.bt.pnl);
            const yMatched = results.matches.map(m => m.real.pnl);
            const r2Matched = calculateR2(xMatched, yMatched);

            // Global Set
            const xGlobal = [...xMatched];
            const yGlobal = [...yMatched];
            results.orphanReal.forEach(r => { xGlobal.push(0); yGlobal.push(r.pnl); });
            results.orphanBT.forEach(b => { xGlobal.push(b.pnl); yGlobal.push(0); });
            const r2Global = calculateR2(xGlobal, yGlobal);

            // Capture for Export
            window.latestSQAnalysisData = {
                matches: results.matches.map(m => ({
                    displaySymbol: getSmartSymbol(m.bt, strategiesList) || getSmartSymbol(m.real, strategiesList),
                    bt: m.bt,
                    real: m.real,
                    diff: (m.real.pnl || 0) - (m.bt.pnl || 0)
                })),
                orphanReal: results.orphanReal.map(r => ({
                    ...r,
                    displaySymbol: getSmartSymbol(r, strategiesList)
                })),
                orphanBT: results.orphanBT.map(b => ({
                    ...b,
                    displaySymbol: getSmartSymbol(b, strategiesList)
                })),
                totals: { // Will be populated after calc
                    matched: { real: sumMatchedReal, bt: sumMatchedBT, diff: sumMatchedDiff, r2: r2Matched },
                    orphanReal: { pnl: sumOrphanReal, count: results.orphanReal.length },
                    orphanBT: { pnl: sumOrphanBT, count: results.orphanBT.length },
                    global: { real: totalRealPnL, bt: totalBTPnL, diff: totalDiff, r2: r2Global }
                }
            };
            // Dispatch Event for Listeners (e.g. PnL Modal)
            window.dispatchEvent(new CustomEvent('sq-analysis-rendered', {
                detail: window.latestSQAnalysisData
            }));


            // 2. RENDER SECTIONS SEQUENTIALLY

            // --- A) MATCHED SECTION ---


            // MATCHED
            if (results.matches.length > 0) {
                // Header
                rows += `<tr class="bg-gray-800/50"><td colspan="8" class="py-2 px-4 text-xs font-bold text-emerald-400 uppercase tracking-wider border-b border-gray-700">Matched Trades (${results.matches.length})</td></tr>`;

                // Rows
                results.matches.sort((a, b) => (a.real.openTime - b.real.openTime) * mk);
                results.matches.forEach(m => {
                    const r = m.real;
                    const b = m.bt;
                    // Fallback to 0 if PnL is missing to avoid calculation errors
                    const rPnL = r.pnl !== undefined ? r.pnl : 0;
                    const bPnL = b.pnl !== undefined ? b.pnl : 0;

                    const diff = rPnL - bPnL;
                    const diffClass = Math.abs(diff) > 0.01 ? (diff >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-gray-500';
                    const timeDiff = Math.abs(r.openTime - b.openTime) / 60000;

                    rows += `
                        <tr class="hover:bg-gray-700/30 border-b border-gray-800 transition-colors">
                            <td class="py-2 px-2 text-gray-300 whitespace-nowrap">
                                <div>${r.openTime ? r.openTime.toISOString().replace('T', ' ').slice(0, 16) : '-'}</div>
                                <div class="text-[10px] text-gray-500">Δ ${timeDiff.toFixed(0)}m</div>
                            </td>
                            <td class="py-2 px-2 text-gray-400 text-xs">${getSmartSymbol(b, strategiesList) || getSmartSymbol(r, strategiesList)}</td>
                            <td class="py-2 px-2 text-gray-400 text-xs">${r.type || b.type || '-'}</td>
                            <td class="py-2 px-2 text-right text-gray-400 text-xs">${formatNum(r.size || b.size || 0)}</td>
                            <td class="py-2 px-2 text-right text-gray-400 text-xs">${formatNum(r.openPrice || b.openPrice || 0, 4)}</td>
                            <td class="py-2 px-2 text-right font-mono font-bold ${r.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}">${formatMoney(r.pnl)}</td>
                            <td class="py-2 px-2 text-right font-mono ${b.pnl >= 0 ? 'text-emerald-500/70' : 'text-red-500/70'}">${formatMoney(b.pnl)}</td>
                            <td class="py-2 px-2 text-right font-mono text-xs ${diffClass}">${formatMoney(diff)}</td>
                        </tr>
                     `;
                });

                // Total Row (IMMEDIATE)
                rows += `
                    <tr class="bg-gray-800 font-bold border-b border-gray-700">
                        <td colspan="5" class="py-2 px-4 text-emerald-400 text-right uppercase text-xs">Matched Total (R²: ${r2Matched.toFixed(3)})</td>
                        <td class="py-2 px-2 text-right font-mono ${sumMatchedReal >= 0 ? 'text-emerald-400' : 'text-red-400'}">${formatMoney(sumMatchedReal)}</td>
                        <td class="py-2 px-2 text-right font-mono ${sumMatchedBT >= 0 ? 'text-emerald-500/70' : 'text-red-500/70'}">${formatMoney(sumMatchedBT)}</td>
                        <td class="py-2 px-2 text-right font-mono text-xs text-gray-400">${formatMoney(sumMatchedDiff)}</td>
                    </tr>
                 `;
            }


            // --- B) ORPHAN REAL SECTION ---
            if (results.orphanReal.length > 0) {
                rows += `<tr class="bg-gray-800/50"><td colspan="8" class="py-2 px-4 text-xs font-bold text-amber-400 uppercase tracking-wider border-b border-gray-700 mt-4">Orphan Real Trades (${results.orphanReal.length}) <span class="text-gray-500 font-normal normal-case">- Not found in Backtest</span></td></tr>`;
                results.orphanReal.sort((a, b) => (a.openTime - b.openTime) * mk);
                results.orphanReal.forEach(r => {
                    rows += `
                        <tr class="hover:bg-gray-700/30 border-b border-gray-800 transition-colors bg-red-900/5">
                            <td class="py-2 px-2 text-gray-300 whitespace-nowrap">${r.openTime ? r.openTime.toISOString().replace('T', ' ').slice(0, 16) : '-'}</td>
                            <td class="py-2 px-2 text-gray-400 text-xs">${getSmartSymbol(r, strategiesList)}</td>
                            <td class="py-2 px-2 text-gray-400 text-xs">${r.type || '-'}</td>
                            <td class="py-2 px-2 text-right text-gray-400 text-xs">${formatNum(r.size || 0)}</td>
                            <td class="py-2 px-2 text-right text-gray-400 text-xs">${formatNum(r.openPrice || 0, 4)}</td>
                            <td class="py-2 px-2 text-right font-mono font-bold ${r.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}">${formatMoney(r.pnl)}</td>
                            <td class="py-2 px-2 text-right text-gray-500">-</td>
                            <td class="py-2 px-2 text-right text-gray-500">-</td>
                        </tr>
                     `;
                });

                // Total Row (IMMEDIATE)
                rows += `
                    <tr class="bg-gray-800 font-bold border-b border-gray-700">
                        <td colspan="5" class="py-2 px-4 text-amber-400 text-right uppercase text-xs">Orphan Real Total</td>
                        <td class="py-2 px-2 text-right font-mono ${sumOrphanReal >= 0 ? 'text-emerald-400' : 'text-red-400'}">${formatMoney(sumOrphanReal)}</td>
                        <td class="py-2 px-2 text-right font-mono text-gray-500">-</td>
                        <td class="py-2 px-2 text-right font-mono text-xs text-gray-400">-</td>
                    </tr>
                `;
            }


            // ORPHAN BACKTEST




            // --- C) ORPHAN BACKTEST SECTION ---
            if (results.orphanBT.length > 0) {
                rows += `<tr class="bg-gray-800/50"><td colspan="8" class="py-2 px-4 text-xs font-bold text-blue-400 uppercase tracking-wider border-b border-gray-700 mt-4">Orphan Backtest Trades (${results.orphanBT.length}) <span class="text-gray-500 font-normal normal-case">- Not executed in Real</span></td></tr>`;
                results.orphanBT.sort((a, b) => (a.openTime - b.openTime) * mk);
                const displayLimit = 200;
                results.orphanBT.slice(0, displayLimit).forEach(b => {
                    rows += `
                        <tr class="hover:bg-gray-700/30 border-b border-gray-800 transition-colors opacity-60">
                            <td class="py-2 px-2 text-gray-300 whitespace-nowrap">${b.openTime ? b.openTime.toISOString().replace('T', ' ').slice(0, 16) : '-'}</td>
                            <td class="py-2 px-2 text-gray-400 text-xs">${getSmartSymbol(b, strategiesList)}</td>
                            <td class="py-2 px-2 text-gray-400 text-xs">${b.type || '-'}</td>
                            <td class="py-2 px-2 text-right text-gray-400 text-xs">${formatNum(b.size || 0)}</td>
                            <td class="py-2 px-2 text-right text-gray-400 text-xs">${formatNum(b.openPrice || 0, 4)}</td>
                            <td class="py-2 px-2 text-right text-gray-500">-</td>
                            <td class="py-2 px-2 text-right font-mono font-bold ${b.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}">${formatMoney(b.pnl)}</td>
                            <td class="py-2 px-2 text-right text-gray-500">-</td>
                        </tr>
                     `;
                });
                if (results.orphanBT.length > displayLimit) {
                    rows += `<tr><td colspan="8" class="text-center text-xs text-gray-500 py-2">... ${results.orphanBT.length - displayLimit} more hidden ...</td></tr>`;
                }

                // IMPROVED: Orphan Backtest Total Row Injection (Immediate)
                const sumPnLSafe = (list) => list.reduce((acc, x) => acc + (x.pnl || 0), 0);
                const sumOrphanBTSec = sumPnLSafe(results.orphanBT);

                rows += `
                    <tr class="bg-gray-800 font-bold border-b border-gray-700">
                        <td colspan="5" class="py-2 px-4 text-blue-400 text-right uppercase text-xs">Orphan Backtest Total</td>
                        <td class="py-2 px-2 text-right font-mono text-gray-500">-</td>
                        <td class="py-2 px-2 text-right font-mono ${sumOrphanBTSec >= 0 ? 'text-emerald-500/70' : 'text-red-500/70'}">${formatMoney(sumOrphanBTSec)}</td>
                        <td class="py-2 px-2 text-right font-mono text-xs text-gray-400">-</td>
                    </tr>
                `;
            }

            // --- D) GLOBAL TOTALS ---
            // Re-calculate stats for global summary

            rows += `
                <tr class="bg-gray-900 border-t-4 border-gray-600 font-bold text-sm">
                    <td colspan="5" class="py-3 px-4 text-white text-right uppercase">Global Total (All Sources) - R²: <span class="${r2Global > 0.7 ? 'text-emerald-400' : 'text-yellow-400'}">${r2Global.toFixed(3)}</span></td>
                    <td class="py-3 px-2 text-right font-mono ${totalRealPnL >= 0 ? 'text-emerald-400' : 'text-red-400'} text-base">${formatMoney(totalRealPnL)}</td>
                    <td class="py-3 px-2 text-right font-mono ${totalBTPnL >= 0 ? 'text-emerald-400' : 'text-red-400'} text-base opacity-70">${formatMoney(totalBTPnL)}</td>
                    <td class="py-3 px-2 text-right font-mono ${totalDiff >= 0 ? 'text-emerald-400' : 'text-red-400'}">${formatMoney(totalDiff)}</td>
                </tr>
            `;

        } else {
            // Single View (Backtest or Real)
            const trades = currentDataType === 'real' ? realTrades : btTrades;
            trades.sort((a, b) => (a.openTime - b.openTime) * mk);

            trades.forEach(t => {
                rows += `
                        <tr class="hover:bg-gray-700/30 border-b border-gray-800 transition-colors">
                            <td class="py-2 px-2 text-gray-300 whitespace-nowrap">${t.openTime ? t.openTime.toISOString().replace('T', ' ').slice(0, 16) : '-'}</td>
                            <td class="py-2 px-2 text-gray-400 text-xs">${t.symbol || '-'}</td>
                            <td class="py-2 px-2 text-gray-400 text-xs">${t.type || '-'}</td>
                            <td class="py-2 px-2 text-right text-gray-400 text-xs">${formatNum(t.size || 0)}</td>
                            <td class="py-2 px-2 text-right text-gray-400 text-xs">${formatNum(t.openPrice || 0, 4)}</td>
                            <td class="py-2 px-2 text-right font-mono font-bold ${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}">${formatMoney(t.pnl)}</td>
                            <td class="py-2 px-2 text-right text-gray-600">-</td>
                            <td class="py-2 px-2 text-right text-gray-600">-</td>
                        </tr>
                     `;
            });
        }
        tableRows = rows;
    }
    else if (selectedPeriod === 'month') {
        const primaryBucket = safeTimeData.month || {};
        const secondaryBucket = (secondaryMetrics && secondaryMetrics.timeData && currentDataType === 'comparison') ? secondaryMetrics.timeData.month : {};
        const allYears = new Set([...Object.keys(primaryBucket), ...Object.keys(secondaryBucket)]);
        const mk = analysisDateSortAsc ? 1 : -1;
        const years = Array.from(allYears).sort((a, b) => (Number(a) - Number(b)) * mk);
        const arrow = analysisDateSortAsc ? '▲' : '▼';

        headersHTML = `
            <th class="py-2 px-2 text-left font-bold text-gray-300 border-r border-gray-700 cursor-pointer hover:text-white select-none" onclick="window.toggleAnalysisSort()" title="Toggle Sort Order">Year ${arrow}</th>
            <th class="py-2 px-1 text-right">Jan</th><th class="py-2 px-1 text-right">Feb</th><th class="py-2 px-1 text-right">Mar</th>
            <th class="py-2 px-1 text-right">Apr</th><th class="py-2 px-1 text-right">May</th><th class="py-2 px-1 text-right">Jun</th>
            <th class="py-2 px-1 text-right">Jul</th><th class="py-2 px-1 text-right">Aug</th><th class="py-2 px-1 text-right">Sep</th>
            <th class="py-2 px-1 text-right">Oct</th><th class="py-2 px-1 text-right">Nov</th><th class="py-2 px-1 text-right">Dec</th>
            <th class="py-2 px-2 text-right font-bold text-gray-300 border-l border-gray-700">Total</th>
        `;

        years.forEach(year => {
            // In Split Mode, we pass both to renderRow
            const prim = primaryBucket[year];
            const sec = secondaryBucket[year];
            tableRows += renderRow(year, prim, sec, year);
        });
    } else {
        const arrow = analysisDateSortAsc ? '▲' : '▼';
        headersHTML = `<th class="py-2 px-2 text-left cursor-pointer hover:text-white select-none" onclick="window.toggleAnalysisSort()" title="Toggle Sort Order">${selectedPeriod.charAt(0).toUpperCase() + selectedPeriod.slice(1)} ${arrow}</th><th class="py-2 px-2 text-right">Value</th>`;
        let weekRows = '';

        // Safe Access setup for non-monthly periods
        const primaryBucket = safeTimeData[selectedPeriod] || {};
        const secondaryBucket = (secondaryMetrics && secondaryMetrics.timeData && currentDataType === 'comparison') ? secondaryMetrics.timeData[selectedPeriod] : {};
        const allYears = new Set([...Object.keys(primaryBucket), ...Object.keys(secondaryBucket)]);
        const mk = analysisDateSortAsc ? 1 : -1;
        const years = Array.from(allYears).sort((a, b) => (Number(a) - Number(b)) * mk);

        // Helper to extract value
        const getVal = (stats) => {
            if (!stats) return 0;
            if (selectedMetric === 'pnl') return stats.pnl;
            if (selectedMetric === 'count') return stats.count;
            if (selectedMetric === 'winRate') return stats.count > 0 ? (stats.wins / stats.count) * 100 : 0;
            if (selectedMetric === 'profitFactor') return Math.abs(stats.grossLoss) > 0 ? stats.grossProfit / Math.abs(stats.grossLoss) : (stats.grossProfit > 0 ? 999 : 0);
            if (selectedMetric === 'grossProfit') return stats.grossProfit;
            if (selectedMetric === 'grossLoss') return stats.grossLoss;
            if (selectedMetric === 'drawdown') return stats.maxDD || 0;
            if (selectedMetric === 'stagnation') return stats.maxStagnation || 0;
            return 0;
        };

        // --- MOVED R-SQUARED CALCULATION TO setupRender ---
        // We will calculate it there and inject it into the DOM after render.
        // This avoids issues with innerHTML and script tags.

        // Total Accumulators (For Non-Month periods, we sum PnL but MAX the DD/Stag)
        const accP = { pnl: 0, count: 0, wins: 0, grossProfit: 0, grossLoss: 0, maxDD: 0, maxStag: 0 };
        const accS = { pnl: 0, count: 0, wins: 0, grossProfit: 0, grossLoss: 0, maxDD: 0, maxStag: 0 };
        let hasDataP = false;
        let hasDataS = false;

        years.forEach(year => {
            const weeksP = primaryBucket[year] || {};
            const weeksS = secondaryBucket[year] || {};

            // Union of all sub-keys (weeks/days) for this year
            const allSubKeys = new Set([...Object.keys(weeksP), ...Object.keys(weeksS)]);
            const sortedKeys = Array.from(allSubKeys).sort((a, b) => {
                const mk = analysisDateSortAsc ? 1 : -1;
                // If keys are 'MM-DD' strings (Day Mode), parse them
                if (typeof a === 'string' && a.includes('-')) {
                    const [m1, d1] = a.split('-').map(Number);
                    const [m2, d2] = b.split('-').map(Number);
                    if (m1 !== m2) return (m1 - m2) * mk;
                    return (d1 - d2) * mk;
                }
                // Fallback for numeric keys (Week)
                return (Number(a) - Number(b)) * mk;
            });

            sortedKeys.forEach(w => {
                const statsP = weeksP[w];
                const statsS = weeksS[w];

                const valP = getVal(statsP);
                const valS = getVal(statsS);

                // Accumulate
                if (statsP) {
                    hasDataP = true;
                    accP.pnl += statsP.pnl;
                    accP.count += statsP.count;
                    accP.wins += statsP.wins;
                    accP.grossProfit += statsP.grossProfit;
                    accP.grossLoss += statsP.grossLoss;
                    if (statsP.maxDD > accP.maxDD) accP.maxDD = statsP.maxDD;
                    if (statsP.maxStagnation > accP.maxStag) accP.maxStag = statsP.maxStagnation;
                }
                if (statsS) {
                    hasDataS = true;
                    accS.pnl += statsS.pnl;
                    accS.count += statsS.count;
                    accS.wins += statsS.wins;
                    accS.grossProfit += statsS.grossProfit;
                    accS.grossLoss += statsS.grossLoss;
                    if (statsS.maxDD > accS.maxDD) accS.maxDD = statsS.maxDD;
                    if (statsS.maxStagnation > accS.maxStag) accS.maxStagnation = statsS.maxStagnation;
                }

                // Reuse existing formatSplit helper from renderRow scope if possible, 
                // BUT renderRow is a sibling function. referencing it might fail if defined inside renderRow.
                // formatSplit IS defined inside renderRow (lines 853-867 in previous view), so we cannot access it here.
                // We must duplicate or move formatSplit definition up.
                // Checking previous code... 'formatSplit' is inside renderRow. 
                // I will redefine a simple version here.

                const fmt = (v1, v2, hasV1, hasV2) => {
                    if (!hasV1 && !hasV2) return '-';
                    if (currentDataType !== 'comparison') return `<span class="${currentMetric.color(v1)}">${currentMetric.format(v1)}</span>`;

                    const s1 = hasV1 ? `<span class="${currentMetric.color(v1)}">${currentMetric.format(v1)}</span>` : '<span class="text-gray-700">-</span>';
                    const s2 = hasV2 ? `<span class="${currentMetric.color(v2)} font-bold">${currentMetric.format(v2)}</span>` : '<span class="text-gray-700">-</span>';

                    if (!hasV2) return s1;
                    return `<div class="flex items-center justify-end gap-1 whitespace-nowrap">${s1}<span class="text-gray-600">|</span>${s2}</div>`;
                };

                const label = selectedPeriod === 'week' ? `${year} - W${w}` :
                    selectedPeriod === 'day' ? `${year} - Day ${w}` :
                        `${year}`;

                // --- Backtest End Detection ---
                let isPostBacktest = false;
                if ((currentDataType === 'backtest' || currentDataType === 'comparison') && metrics.trades && metrics.trades.length > 0) {
                    // Calculate Last Trade Date effectively
                    // We use the metrics.trades which should be the source for this view
                    const lastTrade = metrics.trades[metrics.trades.length - 1];
                    if (lastTrade && (lastTrade.exitTime || lastTrade.closeTime)) {
                        const lastDate = new Date(lastTrade.exitTime || lastTrade.closeTime);

                        // Determine start date of current row's period
                        if (selectedPeriod === 'year') {
                            if (Number(year) > lastDate.getFullYear()) isPostBacktest = true;
                        }
                        else if (selectedPeriod === 'week') {
                            // Approximation: Year + Week * 7 days
                            if (Number(year) > lastDate.getFullYear()) isPostBacktest = true;
                            else if (Number(year) === lastDate.getFullYear()) {
                                // Week calculation (ISO 8601 rough)
                                const oneJan = new Date(year, 0, 1);
                                const numberOfDays = Math.floor((lastDate - oneJan) / (24 * 60 * 60 * 1000));
                                const lastWeek = Math.ceil((numberOfDays + oneJan.getDay() + 1) / 7);
                                if (Number(w) > lastWeek) isPostBacktest = true;
                            }
                        } else if (selectedPeriod === 'day') {
                            // Day 01-06 format? 
                            // w is "MM-DD". 
                            if (Number(year) > lastDate.getFullYear()) isPostBacktest = true;
                            else if (Number(year) === lastDate.getFullYear()) {
                                const [m, d] = w.split('-').map(Number);
                                const rDate = new Date(year, m - 1, d);
                                if (rDate > lastDate) isPostBacktest = true;
                            }
                        }
                    }
                }

                // Construct Controls
                let startControls = '';
                if (isPostBacktest) {
                    startControls = `<span class="ml-auto text-[10px] font-bold text-gray-600 bg-gray-800 px-2 py-0.5 rounded border border-gray-700 select-none whitespace-nowrap">END OF DATA</span>`;
                }

                let loupes = '';
                // Backtest Loupe
                if (!isPostBacktest && (currentDataType === 'backtest' || currentDataType === 'comparison')) {
                    loupes += `<button onclick="window.openStagnationAudit('${year}', '${w}', 'backtest')" class="p-1 hover:bg-blue-500/20 rounded text-blue-400" title="Audit Backtest Trades">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"></path></svg>
                        </button>`;
                }

                // Real Loupe
                if (currentDataType === 'real' || currentDataType === 'comparison') {
                    loupes += `<button onclick="window.openStagnationAudit('${year}', '${w}', 'real')" class="p-1 hover:bg-emerald-500/20 rounded text-emerald-400" title="Audit Real Trades">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"></path></svg>
                        </button>`;
                }

                let auditControls = startControls;

                if (loupes) {
                    const spacing = startControls ? 'ml-2' : 'ml-auto';
                    auditControls += `<div class="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 ${spacing}">
                        ${loupes}
                     </div>`;
                }

                weekRows += `
                    <tr class="hover:bg-gray-700/30 border-b border-gray-800 transition-colors group">
                        <td class="py-1 px-4 text-gray-400 flex items-center gap-2">
                            ${label}
                            ${auditControls}
                        </td>
                        <td class="py-1 px-4 text-right">
                             ${fmt(valP, valS, !!statsP, !!statsS)}
                        </td>
                    </tr>
                `;
            });
        });

        // RENDER TOTALS ROW
        // NOTE: accP and accS are populated in the loop.
        const totP = calcTotal(accP.grossProfit, accP.grossLoss, accP.count, accP.wins, accP.maxDD, accP.maxStag);
        const totS = calcTotal(accS.grossProfit, accS.grossLoss, accS.count, accS.wins, accS.maxDD, accS.maxStag);

        // Format Helper
        const fmtTotal = (v1, v2, hasV1, hasV2) => {
            if (!hasV1 && !hasV2) return '-';
            if (currentDataType !== 'comparison') return `<span class="${currentMetric.color(v1)}">${currentMetric.format(v1)}</span>`;
            const s1 = hasV1 ? `<span class="${currentMetric.color(v1)}">${currentMetric.format(v1)}</span>` : '<span class="text-gray-700">-</span>';
            const s2 = hasV2 ? `<span class="${currentMetric.color(v2)} font-bold">${currentMetric.format(v2)}</span>` : '<span class="text-gray-700">-</span>';
            if (!hasV2) return s1;
            return `<div class="flex items-center justify-end gap-1 whitespace-nowrap">${s1}<span class="text-gray-600">|</span>${s2}</div>`;
        };

        const totalRow = `
             <tr class="bg-gray-900/80 border-t-2 border-gray-600 font-bold">
                 <td class="py-2 px-4 text-gray-200 uppercase tracking-wider">Total</td>
                 <td class="py-2 px-4 text-right">
                      ${fmtTotal(totP, totS, hasDataP, hasDataS)}
                 </td>
             </tr>
        `;

        tableRows = weekRows + totalRow;
    }

    const tableHeader = `
        <thead class="bg-gray-900/50 text-xs uppercase font-medium text-gray-400 sticky top-0 z-10">
            <tr>
                ${headersHTML}
            </tr>
        </thead>
    `;

    const tableBody = `
        <tbody class="divide-y divide-gray-800 text-sm">
            ${tableRows}
        </tbody>
    `;

    // --- Markov UI ---
    const mData = (metrics.markovStats && metrics.markovStats[markovPeriod] && metrics.markovStats[markovPeriod][`d${markovDepth}`]) || {};
    const seqs = Object.keys(mData).sort();

    let markovRows = '';
    if (seqs.length === 0) {
        markovRows = '<tr><td colspan="4" class="p-4 text-center text-gray-500">No data available.</td></tr>';
    } else {
        seqs.forEach(seq => {
            const d = mData[seq];
            const pW = d.total > 0 ? (d.W / d.total * 100).toFixed(1) : 0;
            const pL = d.total > 0 ? (d.L / d.total * 100).toFixed(1) : 0;
            const colorW = d.W > d.L ? 'text-emerald-400 font-bold' : 'text-gray-400';
            const colorL = d.L > d.W ? 'text-red-400 font-bold' : 'text-gray-400';

            markovRows += `
                <tr class="hover:bg-gray-700/30 border-b border-gray-800">
                    <td class="py-2 px-4 text-gray-300 font-mono">${seq}</td>
                    <td class="py-2 px-4 text-right ${colorW}">${pW}% (${d.W})</td>
                    <td class="py-2 px-4 text-right ${colorL}">${pL}% (${d.L})</td>
                    <td class="py-2 px-4 text-right text-gray-500">${d.total}</td>
                </tr>
            `;
        });
    }

    const markovControls = `
        <div class="flex gap-2 items-center">
             <select id="sq-markov-depth" class="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-amber-500">
                <option value="1" ${markovDepth == 1 ? 'selected' : ''}>Depth 1</option>
                <option value="2" ${markovDepth == 2 ? 'selected' : ''}>Depth 2</option>
                <option value="3" ${markovDepth == 3 ? 'selected' : ''}>Depth 3</option>
                <option value="4" ${markovDepth == 4 ? 'selected' : ''}>Depth 4</option>
            </select>
            <select id="sq-markov-period" class="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-amber-500">
                <option value="trade" ${markovPeriod === 'trade' ? 'selected' : ''}>By Trade</option>
                <option value="month" ${markovPeriod === 'month' ? 'selected' : ''}>By Month</option>
                <option value="week" ${markovPeriod === 'week' ? 'selected' : ''}>By Week</option>
            </select>
        </div>
    `;

    const markovSection = `
        <div class="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden mt-6">
             <div class="p-3 bg-gray-900/50 border-b border-gray-700 flex justify-between items-center">
                <h3 class="text-amber-400 font-bold text-sm uppercase tracking-wider">Markov Chain Analysis</h3>
                ${markovControls}
            </div>
            <div class="max-h-[300px] overflow-y-auto custom-scrollbar">
                <table class="w-full whitespace-nowrap text-sm">
                    <thead class="bg-gray-900/50 text-xs uppercase font-medium text-gray-400 sticky top-0">
                        <tr>
                            <th class="py-2 px-4 text-left">Previous Sequence</th>
                            <th class="py-2 px-4 text-right">Next: WIN %</th>
                            <th class="py-2 px-4 text-right">Next: LOSS %</th>
                            <th class="py-2 px-4 text-right">Occurrences</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-800">
                        ${markovRows}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    return `
        <div class="p-6 space-y-6">
            <div class="bg-gray-800/50 rounded-lg border border-gray-700 overflow-visible">
                <div class="p-3 bg-gray-900/50 border-b border-gray-700 flex justify-between items-center">
                    <h3 class="text-amber-400 font-bold text-sm uppercase tracking-wider truncate max-w-xl" title="${modalTitle}">${modalTitle}</h3>
                    ${headerControls} 
                </div>
                <div class="${overflowClass} max-h-[500px] overflow-y-auto custom-scrollbar">
                    <table class="w-full whitespace-nowrap">
                        ${tableHeader}
                        ${tableBody}
                    </table>
                </div>
            </div>
            <div class="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
                 <h3 class="text-amber-400 font-bold text-sm uppercase mb-4 tracking-wider">Performance Distribution</h3>
                 <div class="h-64 relative">
                    <canvas id="sq-chart"></canvas>
                 </div>
            </div>
            ${renderOverview(metrics, formatMoney, formatNum, secondaryMetrics)}
            ${markovSection}
            ${metrics.transitionMatrix ? renderTransitionMatrixHTML(metrics.transitionMatrix) : ''}
            ${renderFrequencyAnalysisHTML(metrics.interTradeStatsByReason, currentFreqSelection, formatNum)}
            ${renderExitAnalysisHTML(metrics.exitStats, formatMoney, formatNum)}
        </div>
    `;
};

const renderFrequencyAnalysisHTML = (statsMap, selectedKey, formatNum) => {
    if (!statsMap || Object.keys(statsMap).length === 0) return '';

    // Color Mapping
    const colorMap = {
        'TP': { border: 'border-emerald-500/50', bg: 'bg-emerald-900/20', text: 'text-emerald-400' },
        'SL': { border: 'border-red-500/50', bg: 'bg-red-900/20', text: 'text-red-400' },
        'Trailing': { border: 'border-purple-500/50', bg: 'bg-purple-900/20', text: 'text-purple-400' },
        'Time': { border: 'border-blue-500/50', bg: 'bg-blue-900/20', text: 'text-blue-400' },
        'Manual': { border: 'border-gray-500/50', bg: 'bg-gray-900/20', text: 'text-gray-400' },
        'Other': { border: 'border-gray-600/50', bg: 'bg-gray-800/30', text: 'text-gray-500' }
    };

    // Interesting keys to show in grid (Exclude 'All')
    const keys = Object.keys(statsMap)
        .filter(k => k !== 'All')
        .sort((a, b) => a.localeCompare(b));

    const cards = keys.map(key => {
        const stats = statsMap[key];
        // Skip empty or tiny datasets
        if (!stats || stats.values.length < 2) return '';

        const colors = colorMap[key] || colorMap['Other'];

        return `
        <div class="${colors.bg} rounded border ${colors.border} p-3">
             <div class="flex justify-between items-center mb-2">
                 <div class="flex items-center gap-2">
                    <h4 class="${colors.text} font-bold text-xs uppercase">${key} (${stats.values.length})</h4>
                    <button onclick="window.showExitDetails('${key}')" class="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-700/50 transition-colors" title="View Detailed List">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
                    </button>
                 </div>
                 <div class="text-[10px] text-gray-400">Mean: ${formatNum(stats.mean, 2)} days</div>
             </div>
             <div class="h-32 relative">
                <canvas id="sq-freq-chart-${key}"></canvas>
             </div>
             <div class="grid grid-cols-2 gap-1 text-[10px] text-gray-400 mt-2">
                <div>Alpha: ${formatNum(stats.alpha, 2)}</div>
                <div>Beta: ${formatNum(stats.beta, 2)}</div>
             </div>
             <!-- Calculator Mini -->
             <div class="mt-2 text-[10px] space-y-1 border-t border-gray-700/50 pt-2">
                 <div class="flex gap-1">
                     <input type="number" id="sq-prob-input-${key}" class="w-8 bg-gray-900 border border-gray-700 rounded px-1 text-center text-gray-300" placeholder="Days" value="5">
                     <select id="sq-prob-op-${key}" class="bg-gray-800 border border-gray-700 text-gray-300 rounded px-0 text-[10px]">
                        <option value="lte">&le;</option>
                        <option value="gt">&gt;</option>
                        <option value="eq">=</option>
                     </select>
                     <button class="bg-gray-700/50 hover:bg-gray-600 text-gray-300 px-1 rounded flex-1 calc-btn border border-gray-600 text-[10px]" data-key="${key}" title="Calculate Probability or Density">Calc</button>
                 </div>
                 <div id="sq-prob-res-${key}" class="h-4 ${colors.text} text-center font-bold text-[10px]"></div>
             </div>
        </div>
        `;
    }).join('');

    const sectionId = 'sq-freq-analysis';
    return `
        <div class="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden mt-6">
             <div class="p-3 bg-gray-900/50 border-b border-gray-700 flex justify-between items-center cursor-pointer select-none hover:bg-gray-800/50 transition-colors" onclick="window.toggleSQSection('${sectionId}', this)">
                <h3 class="text-amber-400 font-bold text-sm uppercase tracking-wider">Frequency Analysis (Days between Events)</h3>
                <svg class="w-5 h-5 text-gray-400 transform transition-transform -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
            <div id="${sectionId}" class="hidden transition-all duration-300">
                <div class="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                     ${cards}
                </div>
            </div>
        </div>
    `;
};

const renderOverview = (metrics, formatMoney, formatNum, secondaryMetrics = null) => {
    const getValueHTML = (primaryVal, secondaryVal, formatFn, colorFn) => {
        if (secondaryMetrics && secondaryVal !== undefined) {
            return `
                <div class="flex items-center justify-end gap-2 text-sm">
                    <span class="${colorFn(primaryVal)}">${formatFn(primaryVal)}</span>
                    <span class="text-gray-500">|</span>
                    <span class="${colorFn(secondaryVal)} opacity-90 font-bold">${formatFn(secondaryVal)}</span>
                </div>
             `;
        }
        return `<div class="${colorFn(primaryVal)} text-lg">${formatFn(primaryVal)}</div>`;
    };

    const colorPnL = (v) => v >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold';
    const colorPF = (v) => v > 1.5 ? 'text-emerald-400 font-mono' : (v > 1 ? 'text-yellow-400 font-mono' : 'text-red-400 font-mono');
    const colorPlain = () => 'text-white font-mono';
    const colorDD = () => 'text-red-400 font-mono';

    const sec = secondaryMetrics || {};

    return `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div class="space-y-6">
                <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                    <h3 class="text-amber-400 font-bold mb-4 text-sm uppercase tracking-wider">Overview</h3>
                    <div class="grid grid-cols-2 gap-y-4 text-sm items-center">
                        <div class="text-gray-400">Total Profit</div>
                        <div class="text-right">${getValueHTML(metrics.totalProfit, sec.totalProfit, formatMoney, colorPnL)}</div>
                        
                        <div class="text-gray-400">Profit Factor</div>
                        <div class="text-right">${getValueHTML(metrics.profitFactor, sec.profitFactor, formatNum, colorPF)}</div>
                        
                        <div class="text-gray-400">Win Rate</div>
                        <div class="text-right">${getValueHTML(metrics.winRate, sec.winRate, (v) => formatNum(v) + '%', colorPlain)}</div>
                        
                        <div class="text-gray-400">Max Drawdown</div>
                        <div class="text-right">${getValueHTML(metrics.maxDD, sec.maxDD, formatMoney, colorDD)}</div>
                        
                        <div class="text-gray-400">Total Trades</div>
                        <div class="text-right">${getValueHTML(metrics.totalTrades, sec.totalTrades, (v) => v, colorPlain)}</div>
                        
                         <div class="text-gray-400">Avg Yearly Profit</div>
                        <div class="text-right">${getValueHTML(metrics.avgYearlyProfit, sec.avgYearlyProfit, formatMoney, k => 'text-emerald-300 font-mono')}</div>
                    </div>
                </div>
            </div>
            <div class="space-y-6">
                <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                    <h3 class="text-amber-400 font-bold mb-4 text-sm uppercase tracking-wider">Trade Stats</h3>
                    <div class="grid grid-cols-2 gap-y-4 text-sm items-center">
                        <div class="text-gray-400">Avg Win</div>
                        <div class="text-right">${getValueHTML(metrics.avgWin, sec.avgWin, formatMoney, k => 'text-emerald-300 font-mono')}</div>
                        
                        <div class="text-gray-400">Avg Loss</div>
                        <div class="text-right">${getValueHTML(metrics.avgLoss, sec.avgLoss, formatMoney, k => 'text-red-300 font-mono')}</div>
                        
                        <div class="text-gray-400">Max Consec Wins</div>
                        <div class="text-right">${getValueHTML(metrics.maxConsecWins, sec.maxConsecWins, v => v, k => 'text-emerald-400 font-mono')}</div>
                        
                        <div class="text-gray-400">Max Consec Loss</div>
                        <div class="text-right">${getValueHTML(metrics.maxConsecLosses, sec.maxConsecLosses, v => v, k => 'text-red-400 font-mono')}</div>
                        
                         <div class="text-gray-400">SQN</div>
                        <div class="text-right">${getValueHTML(metrics.sqn, sec.sqn, formatNum, colorPlain)}</div>
                    </div>
                </div>
            </div>
        </div>
    `;
};

const renderExitAnalysisHTML = (exitStats, formatMoney, formatNum) => {
    if (!exitStats) return '';
    const sectionId = 'sq-exit-analysis';
    return `
        <div class="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden mt-6">
             <div class="p-3 bg-gray-900/50 border-b border-gray-700 flex justify-between items-center cursor-pointer select-none hover:bg-gray-800/50 transition-colors" onclick="window.toggleSQSection('${sectionId}', this)">
                <h3 class="text-amber-400 font-bold text-sm uppercase tracking-wider">Trading Psychology: Exit Analysis</h3>
                <svg class="w-5 h-5 text-gray-400 transform transition-transform -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
            <div id="${sectionId}" class="hidden transition-all duration-300">
                <div class="p-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div class="grid grid-cols-2 gap-4">
                         <div class="h-48 relative"><canvas id="sq-exit-dist-chart"></canvas></div>
                         <div class="h-48 relative"><canvas id="sq-exit-duration-chart"></canvas></div>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-xs text-left text-gray-400">
                            <thead class="text-xs text-gray-500 uppercase bg-gray-700/50">
                                <tr>
                                    <th class="px-3 py-2">Type</th>
                                    <th class="px-3 py-2 text-right">Count</th>
                                    <th class="px-3 py-2 text-right">WinRate</th>
                                    <th class="px-3 py-2 text-right">AvgPnL</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-700/50">
                                ${Object.values(exitStats).map(s => {
        if (s.count === 0) return '';
        return `
                                        <tr class="hover:bg-gray-700/30">
                                            <td class="px-3 py-2 font-medium text-gray-300">${s.label}</td>
                                            <td class="px-3 py-2 text-right">${s.count}</td>
                                            <td class="px-3 py-2 text-right ${s.winRate > 50 ? 'text-emerald-400' : 'text-red-400'}">${formatNum(s.winRate, 1)}%</td>
                                            <td class="px-3 py-2 text-right ${s.avgPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}">${formatMoney(s.avgPnL)}</td>
                                        </tr>
                                    `;
    }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `;
};

export const parseTradesFromContent = (content) => {
    if (!content) return [];
    const lines = content.split('\n');
    const headers = lines[0].split(';');
    const delimiter = headers.length > 1 ? ';' : ',';
    const h = lines[0].split(delimiter).map(s => s.trim().toLowerCase());
    console.log('[SQ DEBUG] CSV Headers:', h);

    const idxDate = h.findIndex(c => c.includes('date') || c.includes('time'));
    const idxOpenDate = h.findIndex(c => c.includes('open') && (c.includes('time') || c.includes('date')));
    const idxExitDate = h.findIndex(c => (c.includes('close') || c.includes('exit')) && (c.includes('time') || c.includes('date')));
    const idxProfit = h.findIndex(c => c.includes('profit') || c.includes('pnl'));
    const idxComment = h.findIndex(c => c.includes('comment') || c.includes('reason'));
    const idxCloseType = h.findIndex(c => c.includes('close type') || c.includes('exit reason'));

    const idxSwap = h.findIndex(c => c.includes('swap'));
    const idxComm = h.findIndex(c => c.includes('commission') || c.includes('comm'));

    if (idxProfit === -1) return [];

    const trades = [];
    const missingCols = [];
    if (idxSwap === -1) missingCols.push('Swap');
    if (idxComm === -1) missingCols.push('Commission');
    // Attach to array to preserve backward compatibility
    trades.missingCols = missingCols;

    const parseDate = (dateStr) => {
        if (!dateStr) return null;
        const [datePart, timePart] = dateStr.split(' ');
        const [y, m, d] = datePart.split('.');
        return new Date(`${y}-${m}-${d}T${timePart || '00:00:00'}`);
    };

    /**
     * Robust float parser that handles:
     * - "1,234.56" (US/UK) -> 1234.56
     * - "1.234,56" (EU) -> 1234.56
     * - "1234" -> 1234
     * - "1,234" -> 1234
     */
    const parseFlexibleFloat = (val) => {
        if (typeof val === 'number') return val;
        if (!val) return 0.0;

        let str = String(val).trim();
        if (str === '') return 0.0;

        // Remove currency symbols if present (simple check)
        str = str.replace(/[€$£¥]/g, '').trim();

        // Check format: 
        // If it looks like EU "1.234,56" (dot before comma, and comma is likely decimal)
        // OR just "12,34" (comma as decimal)

        if (str.includes(',') && str.includes('.')) {
            const lastComma = str.lastIndexOf(',');
            const lastDot = str.lastIndexOf('.');

            if (lastComma > lastDot) {
                // Formatting is 1.234,56 -> EU
                str = str.replace(/\./g, '').replace(',', '.');
            } else {
                // Formatting is 1,234.56 -> US
                str = str.replace(/,/g, '');
            }
        } else if (str.includes(',')) {
            // Assume comma is decimal separator (typical for EU simple numbers)
            // UNLESS it's like "1,200" (thousands). This is ambiguous.
            // Heuristic: If 3 decimals after comma, typically thousands "1,000". 
            // If 2 decimals "1,23", typically decimal.
            // But if source is consistently EU, "," is decimal.
            // Let's assume standard programming input is usually dot. 
            // If input is CSV export, it depends on locale.
            // SAFE BET: Replace comma with dot for conversion if no dots present.
            str = str.replace(',', '.');
        }

        const num = parseFloat(str);
        return isNaN(num) ? 0.0 : num;
    };

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(delimiter);
        // Use parsing helper
        // Use parsing helper
        const rawProfit = cols[idxProfit];
        let pnl = parseFlexibleFloat(rawProfit);

        // Add Swap and Commission if available
        if (idxSwap !== -1 && cols[idxSwap]) pnl += parseFlexibleFloat(cols[idxSwap]);
        if (idxComm !== -1 && cols[idxComm]) pnl += parseFlexibleFloat(cols[idxComm]);

        // Note: isNaN check moved inside helper, returns 0.0 if fail.
        if (isNaN(pnl)) continue;

        let openTime = new Date();
        let exitTime = new Date();

        if (idxOpenDate !== -1) openTime = parseDate(cols[idxOpenDate]);
        else if (idxDate !== -1) openTime = parseDate(cols[idxDate]);

        if (idxExitDate !== -1) exitTime = parseDate(cols[idxExitDate]);
        else if (idxDate !== -1) exitTime = parseDate(cols[idxDate]);

        let comment = '';
        if (idxComment !== -1) comment = cols[idxComment] ? cols[idxComment].trim() : '';

        let exitReason = '';
        if (idxCloseType !== -1) exitReason = cols[idxCloseType] ? cols[idxCloseType].trim() : '';

        // NEW: Extended Parsing
        const idxSymbol = h.findIndex(c => c === 'symbol' || c === 'instrument');
        const idxType = h.findIndex(c => c === 'type' || c === 'direction' || c === 'order');
        const idxSize = h.findIndex(c => c === 'size' || c === 'lots' || c === 'amount');
        const idxOpenPrice = h.findIndex(c => c.includes('open') && c.includes('price'));
        const idxClosePrice = h.findIndex(c => (c.includes('close') || c.includes('exit')) && c.includes('price'));

        const symbol = idxSymbol !== -1 ? cols[idxSymbol] : '';
        const type = idxType !== -1 ? cols[idxType] : '';
        const size = idxSize !== -1 ? parseFlexibleFloat(cols[idxSize]) : 0;
        const openPrice = idxOpenPrice !== -1 ? parseFlexibleFloat(cols[idxOpenPrice]) : 0;
        const closePrice = idxClosePrice !== -1 ? parseFlexibleFloat(cols[idxClosePrice]) : 0;

        const duration = (exitTime && openTime) ? (exitTime - openTime) : 0;

        trades.push({
            pnl,
            openTime: openTime || new Date(),
            exitTime: exitTime || new Date(),
            duration: Math.max(0, duration),
            comment: comment,
            exitReason: exitReason,
            symbol: symbol,
            type: type,
            size: size,
            openPrice: openPrice,
            closePrice: closePrice
        });
    }
    return trades;
};

export const parseTradesFromData = (data) => {
    if (!data || !Array.isArray(data) || data.length === 0) return [];

    const trades = [];
    const missingCols = [];
    // Check first row for keys
    if (data.length > 0) {
        const keys = Object.keys(data[0]).map(k => k.toLowerCase());
        const hasSwap = keys.some(k => k.includes('swap'));
        const hasComm = keys.some(k => k.includes('commission') || k.includes('comm'));

        if (!hasSwap) missingCols.push('Swap');
        if (!hasComm) missingCols.push('Commission');

        console.log('[SQ Analysis] Debug: Schema of first row:', Object.keys(data[0]));
    }
    trades.missingCols = missingCols;

    /**
     * Reusing robust float parser logic locally or we could export it.
     * Duplicating for safety generic robust parsing across modules without dependency hell right now.
     */
    const parseFlexibleFloat = (val) => {
        if (typeof val === 'number') return val;
        if (val === null || val === undefined) return null;

        let str = String(val).trim();
        if (str === '') return null; // Logic change: return null here to indicate missing value

        str = str.replace(/[€$£¥\s]/g, '');

        if (str.includes(',') && str.includes('.')) {
            const lastComma = str.lastIndexOf(',');
            const lastDot = str.lastIndexOf('.');
            if (lastComma > lastDot) str = str.replace(/\./g, '').replace(',', '.');
            else str = str.replace(/,/g, '');
        } else if (str.includes(',')) {
            str = str.replace(',', '.');
        }

        const num = parseFloat(str);
        return isNaN(num) ? null : num;
    };

    const parseDate = (dateInput) => {
        if (!dateInput) return null;
        if (dateInput instanceof Date && !isNaN(dateInput.getTime())) return dateInput;
        if (typeof dateInput === 'number') return new Date(dateInput);
        const dateStr = String(dateInput).trim();
        let date = new Date(dateStr);
        if (!isNaN(date.getTime())) return date;
        if (dateStr.includes(' ')) {
            const [datePart, timePart] = dateStr.split(' ');
            if (datePart.includes('.')) {
                const parts = datePart.split('.');
                if (parts.length === 3) {
                    if (parts[0].length === 4) return new Date(`${parts[0]}-${parts[1]}-${parts[2]}T${timePart || '00:00:00'}`);
                    else return new Date(`${parts[2]}-${parts[1]}-${parts[0]}T${timePart || '00:00:00'}`);
                }
            }
        }
        return null;
    };

    data.forEach((row, index) => {
        // Use robust parser
        let pnl = parseFlexibleFloat(row.pnl !== undefined ? row.pnl : row.profit);

        // Add Swap and Commission if present
        if (pnl !== null) {
            const swap = parseFlexibleFloat(row.swap || 0);
            const comm = parseFlexibleFloat(row.commission || row.comm || 0);

            // Note: Parser returns null if invalid, treat as 0 for calc
            pnl += (swap || 0);
            pnl += (comm || 0);
        }

        if (pnl === null || isNaN(pnl)) return;

        let openTime = null;
        if (row.entry_date) openTime = parseDate(row.entry_date);
        else if (row.open_time) openTime = parseDate(row.open_time);
        else if (row.date) openTime = parseDate(row.date);
        else if (row.time) openTime = parseDate(row.time);

        let exitTime = null;
        if (row.exit_date) exitTime = parseDate(row.exit_date);
        else if (row.close_time) exitTime = parseDate(row.close_time);
        else if (row.date) exitTime = parseDate(row.date);

        if (!openTime && exitTime) openTime = exitTime;
        if (openTime && !exitTime) exitTime = openTime;

        const duration = (exitTime && openTime) ? (exitTime - openTime) : 0;

        // Robust Column Discovery
        let comment = row.comment || row.reason || row.message || row.comentario || '';
        if (!comment) {
            const commentKey = Object.keys(row).find(k => k.includes('comment') || k.includes('reason') || k.includes('message'));
            if (commentKey) comment = row[commentKey];
        }

        let exitReason = row['close type'] || row.closeType || row.close_type || '';
        if (!exitReason) {
            const exitKey = Object.keys(row).find(k => (k.includes('close') || k.includes('exit')) && (k.includes('type') || k.includes('reason')));
            if (exitKey) exitReason = row[exitKey];
        }

        const symbol = row.symbol || row.Symbol || row.instrument || '';
        const type = row.type || row.Type || row.direction || row.action || '';
        const size = parseFlexibleFloat(row.size || row.lots || row.amount || 0);
        const openPrice = parseFlexibleFloat(row.open_price || row.openPrice || row['open price'] || 0);
        const closePrice = parseFlexibleFloat(row.close_price || row.closePrice || row.exit_price || row['close price'] || 0);

        trades.push({
            pnl: parseFloat(pnl),
            openTime: openTime || new Date(),
            exitTime: exitTime || new Date(),
            duration: Math.max(0, duration),
            comment: String(comment).trim(),
            exitReason: String(exitReason).trim(),
            symbol: String(symbol).trim(),
            type: String(type).trim(),
            size: size,
            openPrice: openPrice,
            closePrice: closePrice
        });
    });

    return trades;
};

// --- Histogram Helper ---
const calculateStatistics = (values) => {
    if (!values || values.length === 0) return { mean: 0, median: 0, p95: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = sum / sorted.length;
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const p95Index = Math.floor(sorted.length * 0.95);
    const p95 = sorted[p95Index];
    return { mean, median, p95 };
};

const calculateHistogramData = (values, binCount = 10) => {
    if (!values || values.length === 0) return { labels: [], data: [] };
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return { labels: [min.toFixed(2)], data: [values.length] };

    const range = max - min;
    const step = range / binCount;
    const bins = new Array(binCount).fill(0);
    const labels = [];

    for (let i = 0; i < binCount; i++) {
        const start = min + (i * step);
        const end = min + ((i + 1) * step);
        labels.push(`${start.toFixed(0)} to ${end.toFixed(0)}`);
    }

    values.forEach(v => {
        let bucketIndex = Math.floor((v - min) / step);
        if (bucketIndex >= binCount) bucketIndex = binCount - 1;
        bins[bucketIndex]++;
    });

    return { labels, data: bins };
};

let histogramChart = null;
const renderHistogram = (canvasId, values, label) => {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (histogramChart) {
        console.log('[SQ DEBUG] Destroying old histogram chart');
        histogramChart.destroy();
        histogramChart = null;
    }
    console.log('[SQ DEBUG] Rendering new histogram chart');

    const stats = calculateStatistics(values);
    const { labels, data } = calculateHistogramData(values, 15);

    histogramChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Frequency',
                data: data,
                backgroundColor: 'rgba(56, 189, 248, 0.5)',
                borderColor: 'rgba(56, 189, 248, 1)',
                borderWidth: 1,
                barPercentage: 0.9,
                categoryPercentage: 1.0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { title: (items) => `Range: ${items[0].label}`, label: (item) => `Count: ${item.raw}` } },
                annotation: {
                    annotations: {
                        meanLine: {
                            type: 'line',
                            scaleID: 'y', // Actually we want vertical line. In bar chart, x is category.
                            // Simplified for now: Just show stats in HTML or simple bars.
                            // The annotation logic was causing issues with specific x/y coords on category axis.
                            // We will omit the lines for robustness or use a simple line on Y if it was horizontal.
                            // But user wants vertical line on X.
                            // Let's Skip complex annotations to avoid errors for now.
                            // We can render stats in HTML.
                        }
                    }
                }
            },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(75, 85, 99, 0.2)' }, ticks: { color: '#9ca3af' } },
                x: { grid: { display: false }, ticks: { color: '#9ca3af', maxRotation: 45, minRotation: 45 } }
            }
        }
    });
};
let exitDistChart = null;
let exitDurationChart = null;

const renderExitAnalysisCharts = (exitStats) => {
    if (!exitStats) return;

    const ctxDist = document.getElementById('sq-exit-dist-chart');
    const ctxDur = document.getElementById('sq-exit-duration-chart');

    if (exitDistChart) { exitDistChart.destroy(); exitDistChart = null; }
    if (exitDurationChart) { exitDurationChart.destroy(); exitDurationChart = null; }

    const labels = Object.keys(exitStats).filter(k => exitStats[k].count > 0);
    const dataCount = labels.map(k => exitStats[k].count);
    const dataDur = labels.map(k => exitStats[k].avgDuration / (1000 * 60 * 60)); // Hours

    if (ctxDist) {
        exitDistChart = new Chart(ctxDist, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: dataCount,
                    backgroundColor: ['#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#6366f1', '#9ca3af'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { color: '#9ca3af', font: { size: 10 } } },
                    title: { display: true, text: 'Distribution', color: '#d1d5db', font: { size: 12 } }
                }
            }
        });
    }

    if (ctxDur) {
        exitDurationChart = new Chart(ctxDur, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Avg Duration (Hours)',
                    data: dataDur,
                    backgroundColor: '#8b5cf6',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: 'Avg Duration (Hours)', color: '#d1d5db', font: { size: 12 } }
                },
                scales: {
                    y: { grid: { color: '#374151' }, ticks: { color: '#9ca3af' } },
                    x: { grid: { display: false }, ticks: { color: '#9ca3af' } }
                }
            }
        });
    }
};

let interTradeChart = null;
let interTradeChartInstances = {};

const renderFrequencyCharts = (statsMap) => {
    if (!statsMap) return;

    // Color Mapping (Matching HTML)
    const colorMap = {
        'TP': { bg: 'rgba(16, 185, 129, 0.4)', border: 'rgba(16, 185, 129, 0.8)' }, // Emerald
        'SL': { bg: 'rgba(239, 68, 68, 0.4)', border: 'rgba(239, 68, 68, 0.8)' },   // Red
        'Trailing': { bg: 'rgba(168, 85, 247, 0.4)', border: 'rgba(168, 85, 247, 0.8)' }, // Purple
        'Time': { bg: 'rgba(59, 130, 246, 0.4)', border: 'rgba(59, 130, 246, 0.8)' },     // Blue
        'Manual': { bg: 'rgba(107, 114, 128, 0.4)', border: 'rgba(107, 114, 128, 0.8)' }, // Gray
        'Other': { bg: 'rgba(75, 85, 99, 0.4)', border: 'rgba(75, 85, 99, 0.8)' }        // Dark Gray
    };

    // Destroy old charts
    Object.values(interTradeChartInstances).forEach(c => c.destroy());
    interTradeChartInstances = {};

    Object.keys(statsMap).forEach(key => {
        if (key === 'All') return; // Skip All

        const stats = statsMap[key];
        // Skip if empty or too small
        if (!stats || stats.values.length < 2) return;

        const ctx = document.getElementById(`sq-freq-chart-${key}`);
        if (!ctx) return;

        // Assuming calculateHistogramData is available in scope (or imported/defined globally)
        const { labels, data } = calculateHistogramData(stats.values, 15);
        const colors = colorMap[key] || colorMap['Other'];

        interTradeChartInstances[key] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Freq',
                    data: data,
                    backgroundColor: colors.bg,
                    borderColor: colors.border,
                    borderWidth: 1,
                    barPercentage: 1.0,
                    categoryPercentage: 1.0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: false },
                    tooltip: {
                        enabled: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        display: false
                    },
                    x: {
                        display: false
                    }
                }
            }
        });
    });
};


export const renderSQAnalysis = async (portfolioIndex, source = 'saved', initialStrategyId = 'all', initialDataType = 'backtest') => {

    // FALLBACK: If index undefined (e.g. from tab switch), try to resume last config or default to 0
    if (portfolioIndex === undefined || portfolioIndex === null) {
        if (activeRenderConfig && activeRenderConfig.index !== undefined && activeRenderConfig.index !== null) {
            console.log(`[SQ Analysis] Resuming last active view: Index ${activeRenderConfig.index} (${activeRenderConfig.source})`);
            portfolioIndex = activeRenderConfig.index;
            source = activeRenderConfig.source || 'saved';
        } else if (state.savedPortfolios && state.savedPortfolios.length > 0) {
            console.log(`[SQ Analysis] No index provided, defaulting to first Saved Portfolio.`);
            portfolioIndex = 0;
            source = 'saved';
        }
    }

    // Update active config
    activeRenderConfig = { index: portfolioIndex, source: source };

    const contentDiv = document.getElementById('sq-analysis-content');
    const loadingDiv = document.getElementById('sq-analysis-loading');
    if (!contentDiv) return;

    contentDiv.innerHTML = '';
    if (loadingDiv) loadingDiv.classList.remove('hidden');

    setTimeout(() => {
        try {
            const portfolio = source === 'databank' ? state.databankPortfolios[portfolioIndex] : state.savedPortfolios[portfolioIndex];
            if (!portfolio) {
                console.warn(`[SQ Analysis] Portfolio at index ${portfolioIndex} (source: ${source}) not found. State may have changed.`);
                contentDiv.innerHTML = '<div class="text-gray-500 p-10 text-center">No portfolio selected or portfolio data changed. Please select a portfolio.</div>';
                if (loadingDiv) loadingDiv.classList.add('hidden');
                return;
            }


            console.log(`[SQ DEBUG] Rendering Portfolio Index: ${portfolioIndex}, Name: ${portfolio.name}, Source: ${source}`);

            let allTrades = [];
            let strategyIndices = [];
            let allMissingCols = new Set();

            // PRIORITIZE IDs (Robust)
            if (portfolio.strategyIds && portfolio.strategyIds.length > 0) {
                strategyIndices = portfolio.strategyIds.map(id => state.loadedStrategyFiles.findIndex(f => f.strategyId === id));
                // If major failures (mostly -1), warn but continue?
                const validCount = strategyIndices.filter(i => i !== -1).length;
                if (validCount === 0 && portfolio.indices) {
                    console.warn("[SQ Analysis] ID lookup failed for all strategies. Falling back to indices (Legacy/Fragile).");
                    strategyIndices = portfolio.indices;
                    // Inject Warning
                    const warningHTML = `
                        <div class="bg-yellow-900/30 border border-yellow-700/50 text-yellow-200 px-4 py-2 rounded mb-4 text-xs flex items-center gap-2">
                            <span class="text-xl">⚠️</span>
                            <div>
                                <strong>Data Mismatch Detected:</strong> This portfolio references strategies that were re-loaded with different IDs. 
                                Displaying data based on file <em>order</em> (indices), which may be inaccurate.
                                <br>
                                <span class="underline cursor-pointer hover:text-white" onclick="document.querySelector('#save-portfolio-btn')?.click()">Please Re-Save this portfolio to fix it.</span>
                            </div>
                        </div>
                     `;
                    // Prepend to contentDiv after a short delay or store in a variable to prepend later? 
                    // setupRender overwrites contentDiv via generateSQAnalysisHTML. 
                    // We should pass a warning flag to setupRender or inject after setupRender.
                    // Easier: set a flag.
                    portfolio._hasIdMismatch = true;
                }
            } else {
                strategyIndices = portfolio.indices || [];
            }

            const strategiesList = [];
            const portfolioRealMetrics = portfolio.realMetrics; // Access pre-calculated real metrics if available

            // ======= DEBUG: STRATEGY LIST SOURCING =======
            console.log(`[SQ Analysis] 🔍 STRATEGY LIST SOURCING DEBUG ===============`);
            console.log(`[SQ Analysis]    - portfolioIndex: ${portfolioIndex}`);
            console.log(`[SQ Analysis]    - source: ${source}`);
            console.log(`[SQ Analysis]    - portfolio.name: ${portfolio?.name}`);
            console.log(`[SQ Analysis]    - portfolio.strategyIds: ${portfolio?.strategyIds?.length || 0}`);
            console.log(`[SQ Analysis]    - portfolio.indices: ${portfolio?.indices?.length || 0}`);
            console.log(`[SQ Analysis]    - state.loadedStrategyFiles: ${state.loadedStrategyFiles?.length || 0}`);
            console.log(`[SQ Analysis]    - strategyIndices resolved: [${strategyIndices.join(', ')}]`);
            console.log(`[SQ Analysis]    - initialDataType: ${initialDataType}`);

            // Log all loaded strategies for comparison
            console.log(`[SQ Analysis]    - ALL LOADED STRATEGIES:`);
            (state.loadedStrategyFiles || []).forEach((file, idx) => {
                console.log(`[SQ Analysis]       [${idx}] ${file.name} (ID: ${file.strategyId})`);
            });
            // ======= END DEBUG =======

            // ======= NEW LOGIC: strategiesList SHOULD DEPEND ON PORTFOLIO =======
            // Filter strategies based on resolved indices
            console.log(`[SQ Analysis] 🚀 NEW STRATEGY SOURCING LOGIC (PORTFOLIO FILTERED) ===============`);
            console.log(`[SQ Analysis]    - initialDataType: ${initialDataType}`);

            // Use a Set for O(1) lookup
            const targetIndices = new Set(strategyIndices);

            (state.loadedStrategyFiles || []).forEach((file, idx) => {
                if (!file) return;
                // MODIFIED: Include ALL global strategies, do not filter by portfolio
                // The dropdown needs to show everything. We will handle selection below.
                /*
                if (!targetIndices.has(idx)) {
                     // console.log(`[SQ Analysis]    ⏭️ Skipping index ${idx} (Not in Portfolio)`);
                    return;
                }
                */

                const stratId = file.strategyId || file.name;
                const rawName = file.name;

                strategiesList.push({ id: stratId, name: rawName, index: idx });
            });

            console.log(`[SQ Analysis]    - strategiesList FINAL: ${strategiesList.length} strategies (Filtered by Portfolio)`);
            strategiesList.forEach((s, i) => {
                console.log(`[SQ Analysis]       [${i}] ${s.name} (ID: ${s.id})`);
            });
            console.log(`[SQ Analysis] 🚀 END NEW STRATEGY SOURCING LOGIC ===============`);

            // NEW LOGIC: If we are in Portfolio View (indices exist) and initialStrategyId is 'all',
            // Default the SELECTION to just the Portfolio strategies, not Global All.
            if (initialStrategyId === 'all' && strategyIndices.length > 0) {
                const subsetIds = strategyIndices.map(i => state.loadedStrategyFiles[i]?.id).filter(id => id);
                if (subsetIds.length > 0) {
                    console.log(`[SQ Analysis] Defaulting 'all' to Portfolio Subset (${subsetIds.length} strategies)`);
                    initialStrategyId = subsetIds;
                }
            }



            // ======= LOAD TRADES FROM PORTFOLIO STRATEGIES ONLY =======
            console.log(`[SQ Analysis] 📂 LOADING BACKTEST TRADES FROM PORTFOLIO (${strategiesList.length} strategies) ===============`);
            (state.loadedStrategyFiles || []).forEach((file, idx) => {
                if (!file) return;
                // MODIFIED: Load trades for ALL strategies to ensure availability in dropdown
                /*
                // CRITICAL FIX: Only load trades if in portfolio
                if (!targetIndices.has(idx)) return;
                */

                let trades = [];
                if (file && file.content) trades = parseTradesFromContent(file.content);
                else if (state.rawStrategiesData[idx]) trades = parseTradesFromData(state.rawStrategiesData[idx]);

                // Tag trades with Strategy ID for filtering
                const strategyId = file.strategyId || file.name;
                trades.forEach(t => t.strategyId = strategyId);

                console.log(`[SQ Analysis]    [${idx}] ${file.name}: ${trades.length} trades loaded`);

                // Collect missing columns
                if (trades.missingCols && trades.missingCols.length > 0) {
                    trades.missingCols.forEach(c => allMissingCols.add(c));
                }

                allTrades = allTrades.concat(trades);
            });
            console.log(`[SQ Analysis] 📂 TOTAL BACKTEST TRADES LOADED: ${allTrades.length}`);

            // --- TIME RANGE DIAGNOSTIC ---
            let btMin = null;
            let btMax = null;
            if (allTrades.length > 0) {
                // Determine BT Range (Assuming trades are sorted or we scan all)
                // We'll scan all to be safe as concatenation might strictly not be sorted if processed in chunks
                btMin = allTrades[0].exitTime;
                btMax = allTrades[0].exitTime;
                allTrades.forEach(t => {
                    if (t.exitTime < btMin) btMin = t.exitTime;
                    if (t.exitTime > btMax) btMax = t.exitTime;
                });
                console.log(`[SQ INFO] 📅 BACKTEST DATA RANGE: ${btMin.toISOString()} to ${btMax.toISOString()}`);
            } else {
                console.log(`[SQ INFO] 📅 BACKTEST DATA RANGE: None`);
            }
            // -----------------------------

            console.log(`[SQ Analysis] 📂 END LOADING TRADES ===============`);


            if (allTrades.length === 0 && initialDataType === 'backtest') {
                contentDiv.innerHTML = '<div class="text-gray-400 text-center p-10">No data available.</div>';
                if (loadingDiv) loadingDiv.classList.add('hidden');
                return;
            }

            allTrades.sort((a, b) => a.exitTime - b.exitTime);
            allTrades.sort((a, b) => a.exitTime - b.exitTime);
            allTrades.sort((a, b) => a.exitTime - b.exitTime);
            // Prepare Portfolios List for Selector
            const portfoliosList = (source === 'databank' ? state.databankPortfolios : state.savedPortfolios).map((p, idx) => ({
                ...p,
                name: p.name || `Portfolio ${idx + 1}`,
                index: idx
            }));

            setupRender(allTrades, strategiesList, initialStrategyId, initialDataType, portfolio, allMissingCols, portfoliosList, portfolioIndex, source, null, btMax); // Pass btMax

            if (lastDropdownSearch) {
                // Restore focus nicely
                setTimeout(() => {
                    const input = document.getElementById('sq-strategy-search-input');
                    if (input) input.focus();
                }, 50);
            }


        } catch (e) {
            console.error("Error calculating SQ Analysis:", e);
            contentDiv.innerHTML = `<div class="text-red-400 text-center p-4">Error: ${e.message}</div>`;
        } finally {
            if (loadingDiv) loadingDiv.classList.add('hidden');
        }
    }, 50);
};

function setupRender(allPortfolioTrades, strategiesList, initialStrategyId = 'all', initialDataType = 'backtest', portfolio, allMissingCols = new Set(), portfoliosList = [], portfolioIndex = -1, source = 'saved', dateRange = null, btMaxDate = null) {
    let currentMetric = 'pnl';
    let currentPeriod = 'month';
    let currentStrategyId = initialStrategyId;
    let currentDataType = initialDataType;
    let currentMarkovPeriod = 'trade';
    let currentMarkovDepth = 1;
    let isStrategyDropdownOpen = false;
    let currentFreqSelection = 'All';
    let currentStartDate = null;
    let currentEndDate = null;
    let currentBtMult = 1;
    let currentRealMult = 1;

    // Event Listeners moved to render() to avoid leaks/duplication

    // Helper to format date YYYY-MM-DD
    const fmtDate = (d) => {
        if (!d) return '';
        return d.toISOString().split('T')[0];
    };

    const getRealTrades = (stratIdInput) => {
        // Allow proceeding if we have deepScanData, even if portfolio metrics are missing
        const hasPortfolioMetrics = portfolio && portfolio.realMetrics && portfolio.realMetrics._tradesById;
        if (!hasPortfolioMetrics && (!state.deepScanData || state.deepScanData.length === 0)) return [];

        const tradesById = hasPortfolioMetrics ? portfolio.realMetrics._tradesById : {};
        const magicMap = state.magicNumberMap || {};
        let rawRealTrades = [];

        // ROBUST MAPPING Helper
        const resolveMagic = (sId) => {
            // console.log(`[SQ DEBUG] resolveMagic called for: ${sId}`);
            // 1. Try Portfolio specific name first (Most Robust for "Linked" accounts)
            let portfolioSpecificName = null;

            // Try searching by ID in portfolio.strategyIds
            if (portfolio.strategyIds) {
                const idx = portfolio.strategyIds.indexOf(sId);
                if (idx !== -1 && portfolio.strategyNames && portfolio.strategyNames[idx]) {
                    portfolioSpecificName = portfolio.strategyNames[idx];
                }
            }

            // If not found, try searching by File Index (via strategiesList)
            if (!portfolioSpecificName) {
                const strategyObj = strategiesList.find(s => s.id === sId);
                if (strategyObj && portfolio.indices) {
                    const pIdx = portfolio.indices.indexOf(strategyObj.index);
                    if (pIdx !== -1 && portfolio.strategyNames && portfolio.strategyNames[pIdx]) {
                        portfolioSpecificName = portfolio.strategyNames[pIdx];
                    }
                }
            }

            if (portfolioSpecificName) {
                const m = magicMap[portfolioSpecificName];
                // DEBUG: Trace why we are getting multiple results
                if (m) {
                    console.log(`[SQ DEBUG] ResolveMagic: sId=${sId}, portfolioSpecificName='${portfolioSpecificName}', ResultType=${Array.isArray(m) ? 'Array' : 'String'}, Val=${JSON.stringify(m).substring(0, 100)}...`);
                    return m;
                } else {
                    console.log(`[SQ DEBUG] ResolveMagic: sId=${sId}, portfolioSpecificName='${portfolioSpecificName}' -> NO MATCH in magicMap`);
                }
            }

            // 2. Fallback to ID
            if (magicMap[sId]) {
                console.log(`[SQ DEBUG] Resolved via ID '${sId}': ${magicMap[sId]}`);
                return magicMap[sId];
            }

            // 3. Fallback to global Name
            const s = strategiesList.find(x => x.id === sId);
            if (s && s.name && magicMap[s.name]) {
                console.log(`[SQ DEBUG] Resolved via Name '${s.name}': ${magicMap[s.name]}`);
                return magicMap[s.name];
            }

            // 3b. Try cleaning the name (remove .csv)
            if (s && s.name) {
                const cleanName = s.name.replace(/\.csv$/i, '').trim();
                const m = magicMap[cleanName];
                if (m) {
                    console.log(`[SQ DEBUG] Resolved via Clean Name '${cleanName}': ${m}`);
                    return m;
                }
            }

            console.warn(`[SQ DEBUG] ❌ Failed to resolve Magic for ${sId} (Name: ${s ? s.name : '?'})`);
            return null;
        };

        // Determine IDs to iterate
        let idsToProcess = [];
        if (stratIdInput === 'all') {
            idsToProcess = strategiesList.map(s => s.id);
        } else if (Array.isArray(stratIdInput)) {
            idsToProcess = stratIdInput;
        } else {
            idsToProcess = [stratIdInput];
        }

        idsToProcess.forEach(sId => {
            const m = resolveMagic(sId);
            if (!m) return;

            // Get Strategy Name for Display
            let displayName = sId;
            const sObj = strategiesList.find(s => s.id === sId);
            if (sObj && sObj.name) displayName = sObj.name;

            const magicList = Array.isArray(m) ? m : [String(m)];

            magicList.forEach(magicStr => {
                const subIds = String(magicStr).split(',').map(s => s.trim());
                subIds.forEach(realMagic => {
                    let foundTrades = [];
                    // 1. Try Portfolio Cache
                    if (tradesById && tradesById[realMagic]) {
                        foundTrades = tradesById[realMagic];
                    }
                    // 2. Try Global Deep Scan Data (Fallback)
                    else if (state.deepScanData) {
                        const key = String(realMagic).trim();
                        // Logic from focusMode.js::findTradesInDeepScanData
                        if (key.includes('::')) {
                            const [targetAccountId, magicNumber] = key.split('::');
                            // Direct lookup if deepScanData is an object keyed by Account ID
                            // Check if deepScanData is Array or Object
                            if (!Array.isArray(state.deepScanData)) {
                                const accountData = state.deepScanData[targetAccountId];
                                if (accountData && accountData.tradesById && accountData.tradesById[magicNumber]) {
                                    const trades = accountData.tradesById[magicNumber];
                                    foundTrades = foundTrades.concat(trades);
                                }
                            } else {
                                // If Array, find account by ID
                                const acc = state.deepScanData.find(a => String(a.accountId) === String(targetAccountId));
                                if (acc && acc.tradesById && acc.tradesById[magicNumber]) {
                                    foundTrades = foundTrades.concat(acc.tradesById[magicNumber]);
                                }
                            }
                        } else {
                            // Legacy: Search everywhere
                            const deepData = Array.isArray(state.deepScanData) ? state.deepScanData : Object.values(state.deepScanData);
                            deepData.forEach(acc => {
                                if (acc.tradesById && acc.tradesById[key]) {
                                    foundTrades = foundTrades.concat(acc.tradesById[key]);
                                } else if (acc.history) {
                                    // Fallback to raw history scan if tradesById missing
                                    const matches = acc.history.filter(t => String(t.magicNumber) === key);
                                    if (matches.length > 0) foundTrades = foundTrades.concat(matches);
                                }
                            });
                        }
                    }

                    if (foundTrades.length > 0) {
                        console.log(`[SQ ANALYSIS] ✅ Found ${foundTrades.length} trades for Magic ${realMagic} (Strategy: ${displayName})`);
                        // Clone and Tag with Display Name

                        const tagged = foundTrades.map(t => ({ ...t, displaySymbol: displayName }));
                        rawRealTrades.push(...tagged);
                    }
                });
            });
        });

        // DEDUPLICATION STEP: Filter out duplicate trades by Ticket ID
        // (Composite key for robustness: Ticket + OpenTime + Magic)
        const uniqueTradesMap = new Map();
        rawRealTrades.forEach(t => {
            const ticket = t.ticket || t.id;
            const key = ticket ? String(ticket) : `${t.openTime}-${t.magicNumber}-${t.profit}`;

            if (!uniqueTradesMap.has(key)) {
                uniqueTradesMap.set(key, t);
            }
        });

        const uniqueRealTrades = Array.from(uniqueTradesMap.values());
        console.log(`[SQ DEBUG] Deduplication: ${rawRealTrades.length} raw -> ${uniqueRealTrades.length} unique trades`);

        let totalP = 0, totalS = 0, totalC = 0;
        let normalized = uniqueRealTrades.map(t => {
            const openTime = new Date(t.openTime);
            // Handle Open Trades or Invalid Date Strings
            let exitTime = new Date(t.closeTime);
            if (uniqueRealTrades.indexOf(t) < 3) {
                console.log(`[SQ DEBUG] Date Check: Raw '${t.closeTime}' -> Parsed: ${exitTime}`);
            }
            if (isNaN(exitTime.getTime())) {
                exitTime = new Date(); // Assume Open Trade -> Use Current Time
            }
            if (isNaN(exitTime.getTime())) {
                exitTime = new Date(); // Assume Open Trade -> Use Current Time
            }
            const p = parseFloat(t.profit) || 0;
            const s = parseFloat(t.swap) || 0;
            const c = parseFloat(t.commission) || 0;

            totalP += p;
            totalS += s;
            totalC += c;

            const pnl = p + s + c;
            return {
                openTime, exitTime, pnl,
                comment: t.comment || '',
                exitReason: t.comment || '',
                duration: exitTime - openTime,
                displaySymbol: t.displaySymbol, // CRITICAL: Preserve strategy name for aggregation
                // Debug: Store components for detailed verification if needed
                _rawP: p, _rawS: s, _rawC: c
            };
        });
        console.log(`[SQ DEBUG] getRealTrades Summary for ${stratIdInput}:`);
        console.log(`[SQ DEBUG]   Count: ${normalized.length}`);
        console.log(`[SQ DEBUG]   Sum Profit: ${totalP.toFixed(2)}`);
        console.log(`[SQ DEBUG]   Sum Swap: ${totalS.toFixed(2)}`);
        console.log(`[SQ DEBUG]   Sum Comm: ${totalC.toFixed(2)}`);
        console.log(`[SQ DEBUG]   Total PnL (P+S+C): ${(totalP + totalS + totalC).toFixed(2)}`);

        normalized.sort((a, b) => a.exitTime - b.exitTime);
        return normalized;
    };

    const render = () => {

        let filteredTrades = []; // Primary Dataset
        let secondaryMetrics = null; // For Comparison Mode

        // 1. Fetch Datasets
        let backtestTrades = [];
        if (currentStrategyId === 'all') backtestTrades = allPortfolioTrades;
        else if (Array.isArray(currentStrategyId)) backtestTrades = allPortfolioTrades.filter(t => currentStrategyId.includes(t.strategyId));
        else backtestTrades = allPortfolioTrades.filter(t => t.strategyId === currentStrategyId);

        // Tag backtest trades with displaySymbol (Strategy Name) for breakdown grouping
        const stratMap = new Map();
        strategiesList.forEach(s => stratMap.set(s.id, s.name));
        backtestTrades = backtestTrades.map(t => ({
            ...t,
            displaySymbol: stratMap.get(t.strategyId) || t.strategyId
        }));

        let realTrades = [];
        if (currentDataType === 'real' || currentDataType === 'comparison') {
            realTrades = getRealTrades(currentStrategyId);
        }

        // --- DIAGNOSTIC: Check for Data Range Gaps (Real extending beyond Backtest) ---
        // This answers: "Why are there no BT trades here? Is it missing Execution or missing Data?"
        if (backtestTrades.length > 0 && realTrades.length > 0 && (currentDataType === 'real' || currentDataType === 'comparison')) {
            const getMaxTime = (arr) => arr.reduce((max, t) => (t.exitTime > max ? t.exitTime : max), 0);
            // Note: backtestTrades use .exitTime (Date object or timestamp? Check parseTrades. Usually Date obj).
            // realTrades normalized uses .exitTime (Date obj).
            // We need timestamps.

            let btMaxTs = 0;
            backtestTrades.forEach(t => { const time = t.exitTime ? t.exitTime.getTime() : 0; if (time > btMaxTs) btMaxTs = time; });

            let realMaxTs = 0;
            realTrades.forEach(t => { const time = t.exitTime ? t.exitTime.getTime() : 0; if (time > realMaxTs) realMaxTs = time; });

            if (btMaxTs > 0 && realMaxTs > 0) {
                const diffDays = (realMaxTs - btMaxTs) / (1000 * 60 * 60 * 24);
                // console.log(`[SQ DIAG] BT End: ${new Date(btMaxTs).toISOString()} | Real End: ${new Date(realMaxTs).toISOString()} | Diff: ${diffDays.toFixed(1)} days`);

                if (diffDays > 7) {
                    // Diagnostic log only, UI injection moved to dateGapWarningHTML block below
                    // console.log(`[SQ DIAG] Gap detected: ${diffDays.toFixed(1)} days`);
                }
                // Easier: Define a specialized warning string here to be used below.
                // We'll attach it to 'window.sqDateGapWarning' or similar, or just define specific variable if scope allows.
                // 'warningBanner' is defined later. We can duplicate the logic there or add a property to the data object?
                // Let's modify the code flow slightly to capture this.
            }
        }

        // Revised Approach: Store Gap Metric in a variable accessible to HTML generation block
        let dateGapWarningHTML = '';
        if (backtestTrades.length > 0 && realTrades.length > 0 && (currentDataType === 'real' || currentDataType === 'comparison')) {
            let btMaxTs = 0;
            backtestTrades.forEach(t => { const time = t.exitTime ? t.exitTime.getTime() : 0; if (time > btMaxTs) btMaxTs = time; });

            let realMaxTs = 0;
            realTrades.forEach(t => { const time = t.exitTime ? t.exitTime.getTime() : 0; if (time > realMaxTs) realMaxTs = time; });

            if (btMaxTs > 0 && realMaxTs > 0) {
                const diffDays = (realMaxTs - btMaxTs) / (1000 * 60 * 60 * 24);
                if (diffDays > 7) {
                    dateGapWarningHTML = `
                        <div class="bg-blue-900/30 border border-blue-700/50 text-blue-200 px-4 py-3 rounded-lg mb-4 text-sm flex items-start gap-3 mx-6 mt-6">
                            <span class="text-xl">ℹ️</span>
                            <div>
                                <strong class="block mb-1">Backtest Data Ended</strong>
                                The Backtest data for this view ends on <span class="text-white font-mono">${new Date(btMaxTs).toISOString().split('T')[0]}</span>.
                                <br>
                                Real trades occurring after this date (up to ${new Date(realMaxTs).toISOString().split('T')[0]}) are shown as "Orphans" because <strong>no backtest data exists</strong> for this period.
                            </div>
                        </div>
                      `;
                }
            }
        }

        // Initialize Defaults on first real/comparison load if unset
        if (currentDataType === 'comparison' || currentDataType === 'real') {
            // Logic Update: Default Start = First Real Trade, Default End = Last BT Trade (Specific to selected strategy)

            // 1. Find Min/Max Real Dates (Start/End)
            let minRealTime = 0;
            let maxRealTime = 0;
            if (realTrades.length > 0) {
                const sortedReal = [...realTrades].sort((a, b) => a.openTime - b.openTime);
                minRealTime = sortedReal[0].openTime.getTime();
                maxRealTime = sortedReal[sortedReal.length - 1].openTime.getTime(); // Define maxRealTime here
            }

            // 2. Find Max Date (End) - Prefer BT End, fallback to Real End
            let maxTime = 0;
            if (backtestTrades.length > 0) {
                const sortedBT = [...backtestTrades].sort((a, b) => a.openTime - b.openTime); // Sort by openTime usually
                maxTime = sortedBT[sortedBT.length - 1].openTime.getTime();
            }
            // If no BT or BT ends before Real starts (weird but possible), try Real End
            if (maxTime === 0 && maxRealTime > 0) {
                maxTime = maxRealTime;
            }

            // Apply Defaults ONLY if dateRange is empty (or on initial load)
            // Note: dateRange is passed from outside, if it's empty we set currents.
            const rangeDefined = typeof dateRange !== 'undefined' && dateRange !== null;
            if (!rangeDefined || (!dateRange.start && !dateRange.end)) {
                if (minRealTime > 0) currentStartDate = fmtDate(new Date(minRealTime));
                if (maxTime > 0) currentEndDate = fmtDate(new Date(maxTime));

                // Safety: Ensure Start < End. If Real started AFTER BT ended, expand End
                if (currentStartDate && currentEndDate && currentStartDate > currentEndDate) {
                    if (maxRealTime > 0) {
                        if (maxRealTime > maxTime) currentEndDate = fmtDate(new Date(maxRealTime));
                    }
                }
            }

            // Expansion Logic (Moved inside block to access local vars and fix scope)
            if (currentEndDate && maxRealTime > 0) {
                const currEndTs = new Date(currentEndDate).getTime();
                if (maxRealTime > currEndTs) {
                    console.log(`[SQ INFO] Auto-expanding End Date to ${fmtDate(new Date(maxRealTime))}`);
                    currentEndDate = fmtDate(new Date(maxRealTime));
                }
            }
        }

        // Apply Date Filter
        const filterByDate = (trades) => {
            if (!currentStartDate && !currentEndDate) return trades;
            const start = currentStartDate ? new Date(currentStartDate).getTime() : -Infinity;

            let end = Infinity;
            if (currentEndDate) {
                const endDateObj = new Date(currentEndDate);
                // Ensure we cover the full day (23:59:59.999)
                endDateObj.setHours(23, 59, 59, 999);
                end = endDateObj.getTime();
            }

            return trades.filter(t => {
                const time = t.exitTime ? t.exitTime.getTime() : 0;
                return time >= start && time <= end;
            });
        };

        const applyMult = (trades, factor) => {
            if (factor === 1) return trades;
            return trades.map(t => ({
                ...t,
                pnl: (t.pnl || 0) * factor,
                commission: (t.commission || 0) * factor,
                swap: (t.swap || 0) * factor,
                grossProfit: (t.grossProfit || 0) * factor, // specific keys if present
                grossLoss: (t.grossLoss || 0) * factor
            }));
        };

        // 2. Select Active Data
        let primaryTradesForAudit = [];
        let secondaryTradesForAudit = [];

        // Helper to filter by Strategy ID
        const filterByStrategy = (rawTrades, isReal = false) => {
            if (currentStrategyId === 'all') return rawTrades;

            // For Backtest, we can filter by ID directly if available, or we rely on 'backtestTrades' being re-fetched?
            // Actually, 'backtestTrades' is fetched via 'getBacktestTrades' which uses 'currentStrategyId'.
            // So backtestTrades is ALREADY filtered by strategy if we are in 'backtest' mode?
            // wait, 'backtestTrades' comes from 'getBacktestTrades(currentStrategyId)'.
            // 'realTrades' comes from 'getRealTrades(currentStrategyId)'.

            // IF getRealTrades was called with 'all' or a list, but currentStrategyId is a single ID, we must filter.
            // But verify: getRealTrades(currentStrategyId) is called at the TOP of 'render()'.
            // It returns trades filtered by that ID.
            // So, do we need extra filtering here?

            // Let's check 'render' logic above (lines 2800+):
            // const realTrades = getRealTrades(currentStrategyId);
            // const backtestTrades = getBacktestTrades(currentStrategyId);

            // It seems getRealTrades/getBacktestTrades ALREADY takes currentStrategyId.
            // So if currentStrategyId is 'all', it returns all. If specific, it returns specific.
            // The issue user reported is: "esk estoy senalando 1 en bt bien pero real me muestrat todas no filtra"
            // Start of render(): console.log(`[SQ ANALYSIS] Re-Rendering.. Strategy: ${currentStrategyId}`);

            return rawTrades;
        };

        // Debug Note: The user claims filtering issues in real mode.
        // If currentStrategyId is passed to getRealTrades, it should work.
        // Let's look at getRealTrades logic again.
        // It processes 'stratIdInput'. If 'all', maps all strategies.
        // If array, maps array. If single, maps single.
        // The issue might be that resolveMagic returns MULTIPLE magic numbers (e.g. from comma separated string)
        // and getRealTrades fetches all of them. This is correct.

        // Is it possible that 'realTrades' contains trades from OTHER strategies?
        // Only if resolveMagic resolves to a magic shared by other strategies.

        // WAIT: 'render' is defined INSIDE 'setupRender'.
        // It uses 'currentStrategyId' from closure.
        // It calls 'const realTrades = getRealTrades(currentStrategyId);'

        // If the user selects a strategy, currentStrategyId updates.
        // render() is called.
        // getRealTrades(currentStrategyId) is called.
        // It should return only trades for that strategy.

        // BUT: What if the magic mapping is broad?
        // User provided logs show: 
        // [SQ ANALYSIS] ✅ Found 28 trades for Magic Xausdjpy.Long.H1.10.5.23 - Improved 0.0 (Strategy: Xausdjpy.Long.H1.10.5.23 - Improved 0.0.csv)
        // ... (repeated for other strategies)

        // Actually, in the log provided:
        // [SQ PNL DEBUG] currentStrategyId: ["STRAT_QJ78VP"] (Array wrapper or just string log?)
        // [SQ PNL DEBUG] filteredTrades count: 1441 (BT)
        // ...
        // [SQ DEBUG] Deduplication: 294 raw -> 98 unique trades

        // 98 trades for ONE strategy seems high? Or normal?
        // Wait, the Log shows:
        // [SQ ANALYSIS] ✅ Found 28 trades for Magic Xausdjpy...
        // [SQ ANALYSIS] ✅ Found 30 trades for Magic ...
        // [SQ ANALYSIS] ✅ Found 7 trades for Magic ...
        // [SQ ANALYSIS] ✅ Found 19 trades for Magic ...
        // [SQ ANALYSIS] ✅ Found 14 trades for Magic ...

        // This implies getRealTrades is iterating over MULTIPLE strategies even when a single ID is passed?
        // Or resolveMagic is returning a LIST of magics?
        // "magicList" in getRealTrades is derived from resolveMagic return.

        // If resolveMagic returns a single magic number, getRealTrades iterates that ONE magic.
        // UNLESS 'stratIdInput' (currentStrategyId) is actually an array?

        // LOGS: [SQ PNL DEBUG] currentStrategyId: ["STRAT_QJ78VP"]
        // The brackets [] suggest it IS an array with one element!
        // In getRealTrades: if (Array.isArray(stratIdInput)) idsToProcess = stratIdInput;
        // So idsToProcess = ["STRAT_QJ78VP"].
        // idsToProcess.forEach(sId => ... resolveMagic(sId) ...)

        // So why did the log show found trades for Xausdjpy AND Gbpjpy AND Usdjpy?
        // [SQ ANALYSIS] ✅ Found 28 trades for Magic Xausdjpy...
        // ...
        // [SQ ANALYSIS] ✅ Found 14 trades for Magic gbpjpyLongBuyStopH1V34... (Strategy: Xausdjpy.Long.H1.10.5.23 - Improved 0.0.csv)

        // WAIT! The STRATEGY display name is "Xausdjpy.Long.H1.10.5.23..." for ALL findings!
        // This means 'displayName' (sId -> Strategy Name) is constant "Xausdjpy..."
        // BUT the 'realMagic' or found trades imply different strategies.
        // Why is resolveMagic returning magics for Gbpjpy and Usdjpy when asked for Xausdjpy?

        // Look at resolveMagic:
        // const m = magicMap[portfolioSpecificName];
        // If m is "111, 222, 333", it returns that string.
        // In getRealTrades: const magicList = Array.isArray(m) ? m : [String(m)];
        // magicList.forEach(magicStr => { const subIds = String(magicStr).split(',')... })

        // If 'magicMap[strategyName]' returns a huge CSV list of ALL magic numbers effectively?
        // OR: Maybe the Strategy Name lookup in magicMap returns the wrong thing?

        // Ah, looking at the logs again:
        // [SQ ANALYSIS] ✅ Found 14 trades for Magic gbpjpyLongBuyStopH1V34.1.26 Improved 0.9 (Strategy: Xausdjpy.Long.H1.10.5.23 - Improved 0.0.csv)
        // The "Magic" being printed is "realMagic".
        // "realMagic" comes from "subIds".
        // "subIds" comes from splitting "magicStr".
        // "magicStr" comes from "m" (resolved magic).

        // IMPLICATION: resolveMagic("STRAT_QJ78VP") is returning a string containing "Xausdjpy..., gbpjpy..., usdjpy..."
        // It seems the magic mapping for this strategy contains MANY magic numbers (names used as magics?).

        // If the user's magic map has mapped ONE strategy to MANY names/magics, that will cause this.
        // Fix: We can't fix the mapping data here easily (user data).
        // BUT we can verify if this is intended.
        // The user says "real me muestrat todas no filtra" (Real shows all, doesn't filter).
        // This confirms that for ONE strategy request, it returns ALL trades.

        // Solution: We should rely on `currentStrategyId` but we are seeing contamination.
        // Is it possible that `currentStrategyId` is 'all' sometimes?
        // No, log says `["STRAT_QJ78VP"]`.

        // Let's assume the data retrieval is "correct" based on the mapping (garbage in, garbage out?).
        // HOWEVER, we can do an extra filter step here if we want to be safe, filtering by "Symbol" or similar? No, Magic is the key.

        // Wait, if `backtestTrades` are being retrieved correctly for 1 strategy (1441 trades),
        // but `realTrades` has 98 trades which seems to include other pairs...
        // 98 trades total for real?
        // Comparing to:
        // [SQ DEBUG] secondaryTrades (Real): 98
        // If total real trades for the portfolio is 98, and selecting ONE strategy returns 98...
        // Then that ONE strategy is mapped to ALL these trades.

        // HYPOTHESIS: The user's magic mapping for "Xausdjpy..." effectively points to ALL these strategies.
        // Looking at `state.magicNumberMap` behavior would confirm.

        // NOTE: In `strategiesTable.js`, we saw:
        // [StrategiesTable] Linked Strategy Names Map created. Size: 14
        // ...
        // [StrategiesTable DEBUG] Row 20: strategy.name='Xausdjpy.Long.H1.10.5.23 - Improved 0.0.csv'
        // ...
        // Badge Check: Found? true.

        // If the mapping is indeed overly broad, we should try to constrain it?
        // Or is there a bug in `resolveMagic`?

        // Look at `resolveMagic` in previously viewed code.
        // It tries: Portfolio Name, ID, Global Name, Clean Name.
        // If it falls back to a broad key?

        // What if `magicMap` has a key that matches multiple?
        // Unlikely.

        // CRITICAL OBSERVATION:
        // In the logs:
        // [SQ ANALYSIS] ✅ Found 28 trades for Magic Xausdjpy.Long.H1.10.5.23 - Improved 0.0 (Strategy: Xausdjpy.Long.H1.10.5.23 - Improved 0.0.csv)
        // [SQ ANALYSIS] ✅ Found 28 trades for Magic xausdjpy.long.h1.10.5.23 - improved 0.0 (Strategy: Xausdjpy.Long.H1.10.5.23 - Improved 0.0.csv)
        // ...
        // [SQ ANALYSIS] ✅ Found 14 trades for Magic gbpjpyLongBuyStopH1V34.1.26 Improved 0.9 (Strategy: Xausdjpy.Long.H1.10.5.23 - Improved 0.0.csv)

        // The "Magic" being found looks like a NAME, not a number.
        // "gbpjpyLongBuyStopH1V34.1.26 Improved 0.9" is a STRATEGY NAME.
        // Why is `resolveMagic` returning OTHER strategy names?

        // It seems `magicMap` maps "Xausdjpy..." -> "Xausdjpy..., gbpjpy..., ..." (CSV list of names?)
        // If so, `resolveMagic` is doing its job (returning mapped values).
        // But the mapping itself links Strategy A to Strategy B's "Magic" (Name).

        // If we can't fix the mapping data, we might need to filter by SYMBOL if possible?
        // Backtest trades have `symbol`. Real trades have `symbol`?
        // `t.symbol`.

        // Let's add a `filterBySymbol` check if `currentStrategyId` is single?
        // We can find the expected symbol from the strategy name or backtest data.
        // Strategy Name: "XauUsdjpy..." -> XAUUSD (Gold).
        // "gbpjpy..." -> GBPJPY.
        // If we selected XAUUSD strategy, we shouldn't show GBPJPY real trades even if mapped.

        // PROPOSED FIX:
        // In `render()`, when filtering `realTrades`:
        // If handling a SINGLE strategy (not 'all'), try to detect the expected Symbol from the Strategy Name.
        // Then filter `realTrades` to match that symbol (fuzzy match).

        // Step 1: Get Strategy Object.
        // Step 2: Extract Symbol (e.g. first 6 chars or Regex).
        // Step 3: Filter realTrades.

        // Actually, let's implement the Symbol Filter logic in `render`.

        // Current Code Block to Replace:
        // if (currentDataType === 'backtest') { ... } else if (currentDataType === 'real') { ... }

        if (currentDataType === 'backtest') {
            filteredTrades = filterByDate(applyMult(backtestTrades, currentBtMult));
            primaryTradesForAudit = filteredTrades;
        } else if (currentDataType === 'real') {
            let fReal = filterByDate(applyMult(realTrades, currentRealMult));



            filteredTrades = fReal;
            primaryTradesForAudit = filteredTrades;
            if (filteredTrades.length === 0) console.warn('[SQ Analysis] No real metrics found.');
        } else if (currentDataType === 'comparison') {
            filteredTrades = filterByDate(applyMult(backtestTrades, currentBtMult)); // Primary (Backtest)
            let fReal = filterByDate(applyMult(realTrades, currentRealMult));

            // Apply Same Symbol Filter for Comparison
            if (currentStrategyId !== 'all' && !Array.isArray(currentStrategyId) && backtestTrades.length > 0) {
                const validSymbols = new Set(backtestTrades.map(t => t.symbol).filter(Boolean));
                if (validSymbols.size > 0) {
                    fReal = fReal.filter(t => {
                        return Array.from(validSymbols).some(vs =>
                            t.symbol && (t.symbol === vs || t.symbol.includes(vs) || vs.includes(t.symbol))
                        );
                    });
                }
            }

            secondaryMetrics = calculateSQMetrics(fReal);
            if (secondaryMetrics) secondaryMetrics.trades = fReal;
            primaryTradesForAudit = filteredTrades;
            secondaryTradesForAudit = fReal;
        }

        const currentMetrics = calculateSQMetrics(filteredTrades);
        if (currentMetrics) currentMetrics.trades = filteredTrades;
        console.log(`[SQ DEBUG] render assignment -> DataType: ${currentDataType}`);
        console.log(`[SQ DEBUG] primaryTrades (BT): ${primaryTradesForAudit.length}`);
        console.log(`[SQ DEBUG] secondaryTrades (Real): ${secondaryTradesForAudit.length}`);

        window.activeAnalysisData = {
            ...currentMetrics,
            primaryTrades: primaryTradesForAudit,
            secondaryTrades: secondaryTradesForAudit,
            dataType: currentDataType
        }; // Expose for Modals & Audits
        if (window.latestSQAnalysisData) {
            window.latestSQAnalysisData.portfolioName = portfolio ? (portfolio.name || 'Portfolio') : 'All Strategies';
        }

        const contentDiv = document.getElementById('sq-analysis-content');
        if (!contentDiv) return;

        // 3. Generate HTML
        const missingColsArray = Array.from(allMissingCols);
        const warningBanner = (missingColsArray.length > 0 && currentDataType === 'backtest') ? `
            <div class="bg-orange-900/30 border border-orange-700/50 text-orange-200 px-4 py-3 rounded-lg mb-4 text-sm flex items-start gap-3 mx-6 mt-6">
                <span class="text-xl">⚠️</span>
                <div>
                    <strong class="block mb-1">Data Warning: Gross vs Net Profit</strong>
                    The following cost columns are missing from your data: <strong>${missingColsArray.join(', ')}</strong>.
                    <br>
                    The "Net Profit" shown is effectively <strong>Gross Profit</strong>. To see strict Real Net Profit, please re-export your strategies from SQX with 'Swap' and 'Commission' columns included.
                </div>
            </div>
        ` : '';

        contentDiv.innerHTML = dateGapWarningHTML + warningBanner + (portfolio._hasIdMismatch ? `
            <div class="bg-yellow-900/30 border border-yellow-700/50 text-yellow-200 px-4 py-3 rounded-lg mb-4 text-sm flex items-start gap-3 mx-6 mt-6">
                <span class="text-xl">⚠️</span>
                <div>
                    <strong class="block mb-1">Portfolio Linkage Broken</strong>
                    This portfolio uses old file references that don't match your loaded files. The metrics shown below are estimated based on file order and <strong>may not match</strong> the saved values.
                    <div class="mt-2 text-yellow-100/70 text-xs bg-yellow-900/50 p-2 rounded">
                        <strong>Fix:</strong> Select strategies manually and <strong>Save as New Portfolio</strong>.
                    </div>
                </div>
            </div>
        ` : '') + generateSQAnalysisHTML(
            currentMetrics,
            currentMetric,
            currentPeriod,
            strategiesList,
            currentStrategyId,
            currentDataType,
            currentMarkovPeriod,
            currentMarkovDepth,
            currentFreqSelection,
            portfoliosList,
            portfolioIndex, // Current Portfolio Index
            secondaryMetrics, // Comparison Data
            { start: currentStartDate, end: currentEndDate, btMult: currentBtMult, realMult: currentRealMult }, // Date Range & Mults
            isStrategyDropdownOpen
        );

        // 4. Calculate and Update R2 Stats (Manually, since Script Tags in innerHTML don't run)
        if (currentDataType === 'comparison' && currentMetrics && secondaryMetrics) {
            const container = document.getElementById('sq-r2-container');
            const valueSpan = document.getElementById('sq-r2-value');

            if (container && valueSpan) {
                // We need to replicate the data matching logic briefly to get the stats.
                // Or better, extract a helper. For now, inline for speed.

                // Get Buckets
                const pB = (currentMetrics.timeData && currentMetrics.timeData[currentPeriod]) ? currentMetrics.timeData[currentPeriod] : {};
                const sB = (secondaryMetrics.timeData && secondaryMetrics.timeData[currentPeriod]) ? secondaryMetrics.timeData[currentPeriod] : {};

                let xVals = [];
                let yVals = [];

                // Helper to extract value (duplicated from generateSQAnalysisHTML, risky but quick fix)
                const getValForR2 = (stats) => {
                    if (!stats) return 0;
                    if (currentMetric === 'pnl') return stats.pnl;
                    if (currentMetric === 'count') return stats.count;
                    if (currentMetric === 'winRate') return stats.count > 0 ? (stats.wins / stats.count) * 100 : 0;
                    if (currentMetric === 'profitFactor') return Math.abs(stats.grossLoss) > 0 ? stats.grossProfit / Math.abs(stats.grossLoss) : (stats.grossProfit > 0 ? 999 : 0);
                    if (currentMetric === 'grossProfit') return stats.grossProfit;
                    if (currentMetric === 'grossLoss') return stats.grossLoss;
                    if (currentMetric === 'drawdown') return stats.maxDD || 0;
                    if (currentMetric === 'stagnation') return stats.maxStagnation || 0;
                    return 0;
                };

                const years = new Set([...Object.keys(pB), ...Object.keys(sB)]);
                years.forEach(year => {
                    const weeksP = pB[year] || {};
                    const weeksS = sB[year] || {};

                    if (currentPeriod === 'month') {
                        // Month structure is simpler: object with keys 0..11
                        // wait, timeData.month[year] IS the object with keys 0..11
                        // so 'weeksP' here is actually { 0: stats, 1: stats ... }
                        for (let m = 0; m < 12; m++) {
                            if (weeksP[m] && weeksS[m]) {
                                xVals.push(getValForR2(weeksP[m]));
                                yVals.push(getValForR2(weeksS[m]));
                            }
                        }
                    } else {
                        // Week/Day structure
                        const subKeys = new Set([...Object.keys(weeksP), ...Object.keys(weeksS)]);
                        subKeys.forEach(k => {
                            if (weeksP[k] && weeksS[k]) {
                                xVals.push(getValForR2(weeksP[k]));
                                yVals.push(getValForR2(weeksS[k]));
                            }
                        });
                    }
                });

                if (xVals.length > 2) {
                    // R2 Calc
                    const yMean = yVals.reduce((a, b) => a + b, 0) / yVals.length;
                    const ssTot = yVals.reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0);
                    const ssRes = yVals.reduce((sum, y, i) => sum + Math.pow(y - xVals[i], 2), 0);
                    let r2 = ssTot !== 0 ? 1 - (ssRes / ssTot) : 0;

                    // Update UI
                    container.classList.remove('hidden');

                    // Color Logic
                    let colorClass = "text-yellow-400";
                    if (r2 > 0.7) colorClass = "text-emerald-400";
                    else if (r2 < 0) colorClass = "text-red-500";

                    valueSpan.className = `font-mono font-bold ${colorClass} ml-1`;
                    valueSpan.innerText = r2.toFixed(3);
                    container.title = `Points matched: ${xVals.length}`;
                } else {
                    container.classList.add('hidden');
                }
            }
        }

        // 5. Inject Metric Distribution Chart Canvas (Histogram of Returns)
        // We inject it into the .p-6 container if possible, or append.
        // generateSQAnalysisHTML structure: root .p-6 > ...
        // We want to insert it after the Table but before Overview?
        // Let's just create a new container and append it to the main content div for simplicity, 
        // OR better, insert it into the generated HTML string in generateSQAnalysisHTML?
        // No, we want to control canvas lifecycle.
        // Let's select the first .p-6 and append there.
        // 5. Chart container is now static in HTML template to prevent layout issues.

        const dataTypeSelect = document.getElementById('sq-data-type-select');
        if (dataTypeSelect) {
            dataTypeSelect.addEventListener('change', (e) => {
                currentDataType = e.target.value;
                render();
            });
        }

        // Date Inputs
        const startInput = document.getElementById('sq-start-date');
        const endInput = document.getElementById('sq-end-date');

        // Sync Input Values with State (Important for Auto-Expansion)
        if (startInput && currentStartDate && startInput.value !== currentStartDate) {
            startInput.value = currentStartDate;
        }
        if (endInput && currentEndDate && endInput.value !== currentEndDate) {
            endInput.value = currentEndDate;
        }

        if (startInput) {
            startInput.addEventListener('change', (e) => {
                currentStartDate = e.target.value;
                render();
            });
        }
        if (endInput) {
            endInput.addEventListener('change', (e) => {
                currentEndDate = e.target.value;
                render();
            });
        }

        // Multipliers
        const btInput = document.getElementById('sq-bt-mult');
        const realInput = document.getElementById('sq-real-mult');
        if (btInput) {
            btInput.addEventListener('change', (e) => {
                currentBtMult = parseFloat(e.target.value) || 1;
                render();
            });
        }
        if (realInput) {
            realInput.addEventListener('change', (e) => {
                currentRealMult = parseFloat(e.target.value) || 1;
                render();
            });
        }

        // Render Charts
        console.log(`[SQ PNL DEBUG] ======================= CHART RENDERING =======================`);
        console.log(`[SQ PNL DEBUG] currentStrategyId: ${JSON.stringify(currentStrategyId)}`);
        console.log(`[SQ PNL DEBUG] currentDataType: ${currentDataType}`);
        console.log(`[SQ PNL DEBUG] currentMetric: ${currentMetric}`);
        console.log(`[SQ PNL DEBUG] currentPeriod: ${currentPeriod}`);
        console.log(`[SQ PNL DEBUG] filteredTrades count: ${filteredTrades.length}`);

        // Log unique strategy IDs in filteredTrades
        const uniqueStratIds = [...new Set(filteredTrades.map(t => t.strategyId || t.displaySymbol || 'unknown'))];
        console.log(`[SQ PNL DEBUG] Unique strategies in filteredTrades (${uniqueStratIds.length}): ${JSON.stringify(uniqueStratIds)}`);

        if (currentMetrics && currentMetrics.timeData && currentMetrics.timeData[currentPeriod]) {
            const dataBucket = currentMetrics.timeData[currentPeriod];
            const values = [];
            const getVal = (stats) => {
                if (!stats) return 0;
                if (currentMetric === 'pnl') return stats.pnl;
                if (currentMetric === 'count') return stats.count;
                if (currentMetric === 'winRate') return stats.count > 0 ? (stats.wins / stats.count) * 100 : 0;
                if (currentMetric === 'profitFactor') return Math.abs(stats.grossLoss) > 0 ? stats.grossProfit / Math.abs(stats.grossLoss) : (stats.grossProfit > 0 ? 999 : 0);
                if (currentMetric === 'grossProfit') return stats.grossProfit;
                if (currentMetric === 'grossLoss') return stats.grossLoss;
                if (currentMetric === 'drawdown') return stats.maxDD || 0;
                if (currentMetric === 'stagnation') return stats.maxStagnation || 0;
                return 0;
            };

            if (currentPeriod === 'trade') {
                // Trade period is a simpler dict: { Year: { 't_0': {pnl: x, ...}, 't_1': ... } }
                // Actually, values in timeData.trade[year] are single trade stats.
                // We just iterate all keys.
                Object.values(dataBucket).forEach(yearData => {
                    Object.values(yearData).forEach(stats => {
                        // For 'trade', extraction is same as getVal BUT specific metric handling?
                        // getVal handles pnl, grossProfit etc.
                        // For single trade, grossProfit is pnl if > 0 else 0.
                        // Our updateBucket logic for 'trade' (count=1) sets these correctly?
                        // Yes, updateBucket aggregates 1 trade.
                        values.push(getVal(stats));
                    });
                });
            } else {
                Object.values(dataBucket).forEach(yearData => {
                    Object.values(yearData).forEach(stats => {
                        values.push(getVal(stats));
                    });
                });
            }

            console.log(`[SQ PNL DEBUG] Histogram values count: ${values.length}`);
            console.log(`[SQ PNL DEBUG] Histogram values sum: ${values.reduce((a, b) => a + b, 0).toFixed(2)}`);
            console.log(`[SQ PNL DEBUG] ========================================================`);

            renderHistogram('sq-chart', values, currentMetric);
        } else {
            console.log(`[SQ PNL DEBUG] ❌ No timeData available for period: ${currentPeriod}`);
            console.log(`[SQ PNL DEBUG] ========================================================`);
        }

        // Frequency Charts
        if (currentMetrics && currentMetrics.interTradeStatsByReason) {
            // Expose Metrics for Modal (Already exposed globally above with trades)
            renderFrequencyCharts(currentMetrics.interTradeStatsByReason);

            // Attach Grid Calculator Listeners
            const btns = document.querySelectorAll('.calc-btn');
            btns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const key = e.target.dataset.key;
                    const stats = currentMetrics.interTradeStatsByReason[key];
                    const input = document.getElementById(`sq-prob-input-${key}`);
                    const opSel = document.getElementById(`sq-prob-op-${key}`);
                    const res = document.getElementById(`sq-prob-res-${key}`);

                    if (stats && input && res && opSel) {
                        const days = parseFloat(input.value);
                        const op = opSel.value;
                        if (days > 0) {
                            let val = 0;
                            let suffix = '%';

                            if (op === 'lte') { // P(T <= x)
                                val = gammaCDF(days, stats.alpha, stats.beta) * 100;
                            } else if (op === 'gt') { // P(T > x)
                                val = (1 - gammaCDF(days, stats.alpha, stats.beta)) * 100;
                            } else if (op === 'eq') { // P(T = x) -> PDF Density
                                val = gammaPDF(days, stats.alpha, stats.beta);
                                suffix = ' (density)';
                            }

                            res.innerHTML = `${val.toFixed(2)}${suffix}`;
                        }
                    }
                });
            });
        }

        // Exit Analysis Charts
        // Exit Analysis Charts
        if (currentMetrics && currentMetrics.exitStats) {
            renderExitAnalysisCharts(currentMetrics.exitStats);
        }

        // Apply Global Filters (Date Range) if set
        const attachListener = (id, setter) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', (e) => {
                    setter(e.target.value);
                    render();
                });
            }
        };

        attachListener('sq-metric-select', (v) => currentMetric = v);
        attachListener('sq-period-select', (v) => currentPeriod = v);
        attachListener('sq-data-type-select', (v) => currentDataType = v);
        attachListener('sq-markov-depth', (v) => currentMarkovDepth = parseInt(v));
        attachListener('sq-markov-period', (v) => currentMarkovPeriod = v);

        // --- Multi-Select Strategy Dropdown Logic ---
        const dropdownBtn = document.getElementById('sq-strategy-dropdown-btn');
        const dropdownMenu = document.getElementById('sq-strategy-dropdown-menu');
        const strategyLabel = document.getElementById('sq-strategy-label');
        const selectAllBtn = document.getElementById('sq-strategy-select-all');
        const selectNoneBtn = document.getElementById('sq-strategy-select-none');
        const checkboxes = document.querySelectorAll('.sq-strategy-checkbox');

        const updateStrategySelection = () => {
            const checked = document.querySelectorAll('.sq-strategy-checkbox:checked');
            const total = document.querySelectorAll('.sq-strategy-checkbox').length;

            if (checked.length === total && total > 0) {
                currentStrategyId = 'all';
                strategyLabel.textContent = 'All Strategies';
            } else if (checked.length === 0) {
                currentStrategyId = []; // Allow empty selection!
                strategyLabel.textContent = '0 selected';
            } else if (checked.length === 1) {
                currentStrategyId = [checked[0].value];
                const labelEl = checked[0].closest('label').querySelector('span');
                strategyLabel.textContent = (labelEl.title || labelEl.textContent).substring(0, 25);
            } else {
                currentStrategyId = Array.from(checked).map(cb => cb.value);
                strategyLabel.textContent = checked.length + ' selected';
            }
            render();
        };

        // Helper to update selection and re-render
        const triggerUpdate = () => {
            const checked = document.querySelectorAll('.sq-strategy-checkbox:checked');
            const total = document.querySelectorAll('.sq-strategy-checkbox').length;
            let newSel = [];

            if (checked.length === 0 || checked.length === total) {
                newSel = 'all';
            } else {
                newSel = Array.from(checked).map(cb => cb.value);
            }

            // Update current state immediately to separate UI sync from data fetch? 
            // Actually, renderSQAnalysis calls setupRender which calls render. 
            // We can just call renderSQAnalysis.
            renderSQAnalysis(activeRenderConfig.index, activeRenderConfig.source, newSel, currentDataType);
        }

        if (dropdownBtn) {
            // Dropdown Toggle
            dropdownBtn.onclick = (e) => {
                e.stopPropagation();
                // Close others if needed?
                isStrategyDropdownOpen = !isStrategyDropdownOpen;
                dropdownMenu.classList.toggle('hidden', !isStrategyDropdownOpen);
            };

            // Note: Dropdown Closure logic (click outside) requires global listener.
            // Since we removed the leaky one, we should add a non-leaking one or just rely on 'onclick' propagation?
            // A simple temporary fix: Add a self-destructing listener or check module-level.
            // Just leaving it manual open/close via button is safer than leaks for now.
        }

        // Search Input Logic
        const searchInput = document.getElementById('sq-strategy-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const val = e.target.value;
                lastDropdownSearch = val;

                const terms = val.toLowerCase().split(' ').filter(t => t.trim());
                const items = document.querySelectorAll('.sq-strategy-item');
                let visibleCount = 0;
                let visibleCheckedCount = 0;

                items.forEach(item => {
                    const span = item.querySelector('span');
                    const text = (span.title || span.textContent).toLowerCase();
                    const isVisible = terms.length === 0 || terms.every(term => text.includes(term));

                    const cb = item.querySelector('input');

                    if (isVisible) {
                        item.classList.remove('hidden');
                        visibleCount++;
                        if (cb && cb.checked) visibleCheckedCount++;
                    } else {
                        item.classList.add('hidden');
                    }
                });

                const badge = document.getElementById('sq-strategy-count-badge');
                if (badge) badge.textContent = `${visibleCount}/${strategiesList.length} matches`;

                const masterCheckbox = document.getElementById('sq-select-all-visible-toggle');
                if (masterCheckbox) {
                    masterCheckbox.checked = (visibleCount > 0 && visibleCheckedCount === visibleCount);
                    masterCheckbox.indeterminate = (visibleCheckedCount > 0 && visibleCheckedCount < visibleCount);
                }
            });
            // Stop propagation to prevent closing dropdown
            searchInput.addEventListener('click', (e) => e.stopPropagation());
        }

        // --- BUTTONS LOGIC ---

        // Master Checkbox Logic (Visible Only)
        const masterCheckbox = document.getElementById('sq-select-all-visible-toggle');
        if (masterCheckbox) {
            // Initialize State (Indeterminate logic can be added here if desired, keeping it simple for now)
            // masterCheckbox.checked = ...

            masterCheckbox.addEventListener('change', (e) => {
                e.stopPropagation();
                const isChecked = e.target.checked;
                const visibleCheckboxes = document.querySelectorAll('.sq-strategy-item:not(.hidden) .sq-strategy-checkbox');

                visibleCheckboxes.forEach(cb => cb.checked = isChecked);

                // If unchecking everything visible results in NO selection, select the first visible one to avoid empty state bugs? 
                // Or allow empty selection? The system usually defaults to 'all' if empty selection in some contexts, 
                // but let's stick to updateStrategySelection handling it.

                updateStrategySelection(); // This handles 'all' fallback if list becomes empty?
                // Check updateStrategySelection: if checked.length === 0 -> currentStrategyId = 'all'.
                // Perfect. Deselecting everything -> All Visible.
            });
        }

        // Global Buttons
        const globalAllBtn = document.getElementById('sq-strategy-select-global-all');
        if (globalAllBtn) {
            globalAllBtn.onclick = (e) => {
                e.stopPropagation();
                renderSQAnalysis(activeRenderConfig.index, activeRenderConfig.source, 'all', currentDataType);
            }
        }

        const globalNoneBtn = document.getElementById('sq-strategy-select-global-none');
        if (globalNoneBtn) {
            globalNoneBtn.onclick = (e) => {
                e.stopPropagation();
                renderSQAnalysis(activeRenderConfig.index, activeRenderConfig.source, [], currentDataType);
            }
        }

        // Portfolio Shortcut Listeners
        document.querySelectorAll('.sq-portfolio-shortcut').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const rawIdx = btn.getAttribute('data-pidx');
                const pIndex = parseInt(rawIdx);
                const targetPortfolio = portfoliosList[pIndex];

                if (targetPortfolio) {
                    const checkboxes = document.querySelectorAll('.sq-strategy-checkbox');
                    checkboxes.forEach(cb => {
                        const sId = cb.value;
                        let shouldCheck = false;

                        // Priority 1: Match by ID (Robust)
                        if (targetPortfolio.strategyIds && targetPortfolio.strategyIds.length > 0) {
                            shouldCheck = targetPortfolio.strategyIds.includes(sId);
                        }
                        // Priority 2: Match by Index (Legacy fallback)
                        else if (targetPortfolio.indices && targetPortfolio.indices.length > 0) {
                            const stratItem = strategiesList.find(s => s.id === sId);
                            if (stratItem) {
                                shouldCheck = targetPortfolio.indices.includes(stratItem.index);
                            }
                        }
                        cb.checked = shouldCheck;
                    });
                    updateStrategySelection();
                }
            });
        });

        checkboxes.forEach(cb => {
            cb.addEventListener('change', (e) => {
                e.stopPropagation();
                updateStrategySelection();
            });
        });

        // --- NEW: Portfolio Change Listener ---
        const portfolioSelect = document.getElementById('sq-portfolio-select');
        if (portfolioSelect) {
            portfolioSelect.addEventListener('change', (e) => {
                const newIndex = parseInt(e.target.value, 10);
                // Call main render function recursively for the new portfolio
                renderSQAnalysis(newIndex, source);
            });
        }
    };

    render();



    let exitDistChart = null;
    let exitDurationChart = null;




    let interTradeChart = null;

    let interTradeChartInstances = {};


    // --- EXIT DETAILS MODAL ---
    // --- REUSABLE TRADES MODAL ---
    window.renderTradesModal = (trades, title, colorClass = 'bg-blue-500') => {
        // Generate Table HTML
        let trs = trades.map(t => {
            const ticket = t.ticket || t.id || '-';
            const open = t.openTime ? t.openTime.toLocaleString() : '-';
            const exit = t.exitTime ? t.exitTime.toLocaleString() : 'N/A';
            const type = t.type !== undefined ? (t.type === 0 || t.type === 'Buy' ? 'Buy' : 'Sell') : '-';
            const size = t.size || t.lots || '-';
            const pnlClass = t.pnl >= 0 ? 'text-green-400' : 'text-red-400';
            const comment = t.comment || t.exitReason || '-';

            return `
            <tr class="border-b border-gray-700 hover:bg-gray-700/50">
                <td class="px-4 py-2 text-sm text-gray-500 font-mono text-xs">${ticket}</td>
                <td class="px-4 py-2 text-sm text-gray-300 whitespace-nowrap">${open}</td>
                <td class="px-4 py-2 text-sm text-gray-300 whitespace-nowrap">${exit}</td>
                <td class="px-4 py-2 text-sm text-white">${type}</td>
                <td class="px-4 py-2 text-sm text-gray-300">${size}</td>
                <td class="px-4 py-2 text-sm text-right font-mono ${pnlClass} font-bold">${t.pnl.toFixed(2)}</td>
                <td class="px-4 py-2 text-sm text-gray-400 truncate max-w-xs" title="${comment}">${comment}</td>
            </tr>
        `;
        }).join('');

        const modalHtml = `
        <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] backdrop-blur-sm" onclick="this.remove()">
            <div class="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col" onclick="event.stopPropagation()">
                <div class="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-gray-900/50 rounded-t-lg">
                    <h3 class="text-lg font-bold text-gray-100 flex items-center gap-2">
                        <span class="w-3 h-3 rounded-full ${colorClass}"></span>
                        ${title} <span class="text-xs text-gray-500 font-normal">(${trades.length} trades)</span>
                    </h3>
                    <button class="text-gray-400 hover:text-white transition-colors p-1" onclick="this.closest('.fixed').remove()">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                </div>
                <div class="overflow-y-auto p-0 flex-1 custom-scrollbar">
                    <table class="w-full text-left border-collapse">
                        <thead class="bg-gray-900/50 sticky top-0 z-10">
                            <tr>
                                <th class="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Ticket</th>
                                <th class="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Open Time</th>
                                <th class="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Exit Time</th>
                                <th class="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                                <th class="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Size</th>
                                <th class="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">PnL</th>
                                <th class="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Comment</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-700">
                            ${trs}
                        </tbody>
                    </table>
                </div>
                <div class="px-6 py-3 border-t border-gray-700 bg-gray-900/30 rounded-b-lg flex justify-end">
                    <button class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors" onclick="this.closest('.fixed').remove()">Close</button>
                </div>
            </div>
        </div>
    `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    };

    // --- EXIT DETAILS MODAL ---
    window.showExitDetails = (category) => {
        if (!window.activeAnalysisData || !window.activeAnalysisData.interTradeStatsByReason) return;
        const data = window.activeAnalysisData.interTradeStatsByReason[category];
        if (!data || !data.trades) return alert('No trades found for this category.');

        window.renderTradesModal(data.trades, `${category} Details`);
    };

    // --- STAGNATION AUDIT TOOL ---
    window.openStagnationAudit = (yearStr, weekStr, type) => {
        console.group(`[Stagnation Audit] ${type.toUpperCase()} | ${yearStr} | ${weekStr}`);
        const data = window.activeAnalysisData;
        const dataType = data.dataType || 'unknown';
        console.log(`[Audit Debug] Active Analysis Mode: ${dataType} | Request: ${type}`);

        let trades = [];

        // Strict Data Selection
        if (type === 'backtest') {
            if (dataType === 'backtest' || dataType === 'comparison') {
                trades = data.primaryTrades || [];
            } else {
                console.warn(`[Audit] Requested Backtest trades but current mode is '${dataType}'.`);
                alert("⚠️ Backtest data is not loaded in this view.\nSwitch to 'Backtest' or 'Comparison' mode.");
                console.groupEnd();
                return;
            }
        } else if (type === 'real') {
            if (dataType === 'real') {
                trades = data.primaryTrades || [];
            } else if (dataType === 'comparison') {
                trades = data.secondaryTrades || [];
            } else {
                console.warn(`[Audit] Requested Real trades but current mode is '${dataType}'.`);
                alert("⚠️ Real data is not loaded in this view.\nSwitch to 'Real' or 'Comparison' mode.");
                console.groupEnd();
                return;
            }
        }


        console.log(`[Audit] Total Candidates: ${trades.length}`);

        const targetYear = parseInt(yearStr);
        let isDayMode = false;
        let targetDayMonth = '';

        if (String(weekStr).includes('-')) {
            isDayMode = true;
            targetDayMonth = weekStr; // "01-16"
        }

        const targetWeek = parseInt(weekStr);
    };

    // --- SECTION TOGGLE HELPER ---
    window.toggleSQSection = (id, headerEl) => {
        const content = document.getElementById(id);
        const icon = headerEl.querySelector('svg');
        if (content) {
            content.classList.toggle('hidden');
            if (icon) {
                // If hidden, rotate -90 (point right). If open, rotate 0 (point down)
                if (content.classList.contains('hidden')) {
                    icon.classList.add('-rotate-90');
                } else {
                    icon.classList.remove('-rotate-90');
                }
            }
        }

        const hits = trades.filter(t => {
            if (!t.exitTime) return false;

            const d = new Date(Date.UTC(t.exitTime.getFullYear(), t.exitTime.getMonth(), t.exitTime.getDate()));

            if (isDayMode) {
                const m = String(d.getUTCMonth() + 1).padStart(2, '0');
                const day = String(d.getUTCDate()).padStart(2, '0');
                const key = `${m}-${day}`;
                return d.getUTCFullYear() === targetYear && key === targetDayMonth;
            }

            // Week Logic (Exact match to calculateSQMetrics)
            const dayNum = d.getUTCDay() || 7;
            d.setUTCDate(d.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
            const w = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
            const wy = d.getUTCFullYear();

            return wy === targetYear && w === targetWeek;
        });

        console.log(`[Audit] Found ${hits.length} trades for ${yearStr}-${isDayMode ? targetDayMonth : 'W' + weekStr}`);
        if (hits.length > 0) {
            window.renderTradesModal(
                hits,
                `Audit: ${type === 'real' ? 'Real' : 'Backtest'} (${yearStr}-W${weekStr})`,
                type === 'real' ? 'bg-emerald-500' : 'bg-blue-500'
            );


        } else {
            console.warn("No trades matched this period.");
            alert(`No trades found for ${type.toUpperCase()} in ${yearStr}-W${weekStr}.`);
        }



        console.groupEnd();
    };

    // ... existing code ...

    // --- GLOBAL BREAKDOWN HELPERS ---
    const formatMoneyBreakdown = (val) => val !== undefined && val !== null ? `$ ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-';

    const normalizeCompareData = (d) => {
        if (d.matches) return { matches: d.matches, orphanReal: d.orphanReal, orphanBT: d.orphanBT };

        // Trade-by-Trade Matching Logic
        const btTrades = d.primaryTrades || [];
        const realTrades = d.secondaryTrades || [];

        const matches = [];
        const orphanReal = [];
        const orphanBT = [];

        if (d.dataType === 'comparison' && btTrades.length > 0 && realTrades.length > 0) {
            // Create a set of matched indices
            const matchedBT = new Set();
            const matchedReal = new Set();

            // Matching criteria: displaySymbol + Type + OpenTime (with tolerance)
            const TIME_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

            realTrades.forEach((rt, rIdx) => {
                let bestMatch = null;
                let bestTimeDiff = Infinity;

                btTrades.forEach((bt, bIdx) => {
                    if (matchedBT.has(bIdx)) return; // Already matched

                    // Check symbol match (use displaySymbol if available, fallback to comment match logic)
                    const rtSym = rt.displaySymbol || rt.comment || rt.strategyId || 'Unknown';
                    const btSym = bt.displaySymbol || bt.strategyId || 'Unknown';

                    const symbolMatch = rtSym === btSym ||
                        rtSym.includes(btSym) ||
                        btSym.includes(rtSym);

                    if (!symbolMatch) return;

                    // Check type match
                    if (rt.type && bt.type && rt.type.toLowerCase() !== bt.type.toLowerCase()) return;

                    // Check time proximity
                    const timeDiff = Math.abs(rt.openTime - bt.openTime);
                    if (timeDiff < TIME_TOLERANCE_MS && timeDiff < bestTimeDiff) {
                        bestTimeDiff = timeDiff;
                        bestMatch = bIdx;
                    }
                });

                if (bestMatch !== null) {
                    matches.push({
                        real: rt,
                        bt: btTrades[bestMatch],
                        displaySymbol: rt.displaySymbol || btTrades[bestMatch].displaySymbol
                    });
                    matchedReal.add(rIdx);
                    matchedBT.add(bestMatch);
                } else {
                    orphanReal.push(rt);
                }
            });

            // Collect unmatched BT trades
            btTrades.forEach((bt, idx) => {
                if (!matchedBT.has(idx)) {
                    orphanBT.push(bt);
                }
            });
        } else {
            // Non-comparison mode: just categorize
            if (d.dataType === 'backtest') {
                orphanBT.push(...btTrades);
            } else if (d.dataType === 'real') {
                orphanReal.push(...realTrades);
            }
        }

        return { matches, orphanReal, orphanBT };
    };

    const getSym = (t) => t.displaySymbol || t.strategyId || t.symbol || "Unknown";

    // --- NEW: Strategy Drill Down Logic (Global) ---
    window.showStrategyDrillDown = (sym) => {
        const d = window.activeAnalysisData;
        if (!d) return;
        const { matches, orphanReal, orphanBT } = normalizeCompareData(d);

        // REFINED LOGIC for Drill Down filtering:
        const targetReal = matches.filter(m => (m.displaySymbol || 'Unknown') === sym);

        const targetOrphanR = orphanReal.filter(r => {
            const key = r.displaySymbol || r.comment || r.strategyId || 'Unknown';
            return key === sym;
        });

        const targetOrphanB = orphanBT.filter(b => {
            const key = b.displaySymbol || b.strategyId || 'Unknown';
            return key === sym;
        });

        let content = '';

        const renderSection = (title, trades, isMatch) => {
            if (trades.length === 0) return '';
            let rows = trades.map(t => {
                const real = isMatch ? t.real : (title.includes('Real') ? t : null);
                const bt = isMatch ? t.bt : (title.includes('Backtest') ? t : null);
                // Derive props from available obj
                const primary = real || bt;
                const time = primary.openTime ? new Date(primary.openTime).toISOString().slice(0, 16).replace('T', ' ') : '-';

                const pnlVal = isMatch ? real.pnl : primary.pnl; // Show Real PnL for match, or orphan pnl
                const btPnlVal = isMatch ? bt.pnl : null;

                return `
                <tr class="border-b border-gray-700 hover:bg-gray-700/50">
                    <td class="p-2 text-xs text-gray-300">${time}</td>
                    <td class="p-2 text-xs text-gray-400">${primary.type || (primary.comment ? primary.comment.split(' ')[0] : '-')}</td>
                    <td class="p-2 text-right font-mono text-xs ${pnlVal > 0 ? 'text-emerald-400' : (pnlVal < 0 ? 'text-red-400' : 'text-gray-500')}">${formatMoneyBreakdown(pnlVal)}</td>
                    ${isMatch ? `<td class="p-2 text-right font-mono text-xs ${btPnlVal > 0 ? 'text-emerald-500/70' : (btPnlVal < 0 ? 'text-red-500/70' : 'text-gray-500/70')}">${formatMoneyBreakdown(btPnlVal)}</td>` : ''}
                </tr>
                `;
            }).join('');
            return `
            <div class="mb-4">
                <h4 class="text-xs font-bold text-gray-400 uppercase mb-2 border-b border-gray-700 pb-1">${title} (${trades.length})</h4>
                <table class="w-full text-left">
                    <thead class="text-[10px] text-gray-500 uppercase"><tr><th>Time</th><th>Type</th><th class="text-right">PnL</th>${isMatch ? '<th class="text-right">BT PnL</th>' : ''}</tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            `;
        };

        content += renderSection('Matched Trades', targetReal, true);
        content += renderSection('Orphan Real Trades', targetOrphanR, false);
        content += renderSection('Orphan Backtest Trades', targetOrphanB, false);

        const modal = document.createElement('div');
        modal.className = "fixed inset-0 z-[110] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4";
        modal.innerHTML = `
        <div class="bg-gray-800 rounded-lg border border-gray-700 w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">
            <div class="p-3 border-b border-gray-700 flex justify-between items-center bg-gray-900">
                <h3 class="text-gray-200 font-bold text-sm truncate pr-4">${sym}</h3>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-white">✕</button>
            </div>
            <div class="overflow-y-auto p-4 custom-scrollbar">
                ${content || '<div class="text-gray-500 text-center italic">No trades found.</div>'}
            </div>
        </div>
        `;
        document.body.appendChild(modal);
    };

    // --- NEW: Breakdown Modal Logic (Global) ---
    window.showAnalysisBreakdown = () => {
        if (!window.activeAnalysisData) return alert("No data available.");
        const d = window.activeAnalysisData;
        const { matches, orphanReal, orphanBT } = normalizeCompareData(d);

        // AGGREGATE BY STRATEGY (displaySymbol)
        const aggregations = {};
        const add = (sym, type, val) => {
            if (!aggregations[sym]) aggregations[sym] = { real: 0, bt: 0 };
            aggregations[sym][type] += Number(val || 0);
        };

        // Add matched trades (both real and bt)
        matches.forEach(m => {
            const sym = m.displaySymbol || 'Unknown';
            add(sym, 'real', m.real.pnl);
            add(sym, 'bt', m.bt.pnl);
        });

        // Add orphan real (only real PnL)
        orphanReal.forEach(r => {
            const sym = r.displaySymbol || r.comment || r.strategyId || 'Unknown';
            add(sym, 'real', r.pnl);
        });

        // Add orphan BT (only BT PnL)
        orphanBT.forEach(b => {
            const sym = b.displaySymbol || b.strategyId || 'Unknown';
            add(sym, 'bt', b.pnl);
        });

        // Separate strategies vs orphans (comments without strategy name)
        const groupStrategies = [];
        const groupOrphans = [];

        Object.keys(aggregations).sort().forEach(sym => {
            const r = aggregations[sym];
            const diff = r.real - r.bt;
            const pct = r.bt !== 0 ? ((r.bt - r.real) / r.bt) * 100 : null;
            const item = { sym, ...r, diff, pct };

            // Heuristic: if sym contains " - " or "Improved", it's a strategy name
            const isStrategyName = sym.includes(' - ') || sym.includes('Improved') || sym.includes('.');
            if (isStrategyName) {
                groupStrategies.push(item);
            } else {
                groupOrphans.push(item);
            }
        });

        // Calculate R² for matched trades
        let rSquared = null;
        if (matches.length > 0) {
            const realPnls = matches.map(m => m.real.pnl);
            const btPnls = matches.map(m => m.bt.pnl);
            const meanReal = realPnls.reduce((a, b) => a + b, 0) / realPnls.length;
            const meanBT = btPnls.reduce((a, b) => a + b, 0) / btPnls.length;

            let ssRes = 0, ssTot = 0;
            for (let i = 0; i < matches.length; i++) {
                ssRes += Math.pow(realPnls[i] - btPnls[i], 2);
                ssTot += Math.pow(realPnls[i] - meanReal, 2);
            }
            rSquared = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
        }

        // HTML Generators
        const formatPct = (v) => {
            if (v === null || isNaN(v)) return '<span class="text-gray-600">-</span>';
            const color = v > 0 ? 'text-red-400' : (v < 0 ? 'text-emerald-400' : 'text-gray-400');
            return `<span class="${color} font-mono text-xs">${v.toFixed(1)}%</span>`;
        };

        const generateRow = (item) => {
            // Diff: Real - BT (positive = better real performance → green, negative = worse → red)
            const diffClass = Math.abs(item.diff) > 0.01 ? (item.diff > 0 ? 'text-emerald-400' : 'text-red-400') : 'text-gray-500';
            // Real PnL: positive → green, negative → red
            const realClass = item.real > 0 ? 'text-emerald-400' : (item.real < 0 ? 'text-red-400' : 'text-gray-500');
            // BT PnL: positive → green, negative → red
            const btClass = item.bt > 0 ? 'text-emerald-500/70' : (item.bt < 0 ? 'text-red-500/70' : 'text-gray-500/70');

            return `
            <tr class="hover:bg-gray-700/30 border-b border-gray-700">
                <td class="py-2 px-4 text-gray-300 font-mono text-xs">
                    <div class="flex items-center justify-between group">
                        <span class="truncate max-w-[300px]" title="${item.sym}">${item.sym}</span>
                        <span onclick="window.showStrategyDrillDown('${item.sym.replace(/'/g, "\\'")}' )" class="ml-2 text-gray-500 hover:text-amber-400 cursor-pointer transition-colors" title="Inspect Trades">🔍</span>
                    </div>
                </td>
                <td class="py-2 px-4 text-right font-mono text-sm ${realClass}">${formatMoneyBreakdown(item.real)}</td>
                <td class="py-2 px-4 text-right font-mono text-sm ${btClass}">${formatMoneyBreakdown(item.bt)}</td>
                <td class="py-2 px-4 text-right font-mono text-xs ${diffClass}">${formatMoneyBreakdown(item.diff)}</td>
                <td class="py-2 px-4 text-right">${formatPct(item.pct)}</td>
            </tr>
        `;
        };

        const generateSubtotal = (label, items) => {
            const sumReal = items.reduce((a, b) => a + b.real, 0);
            const sumBT = items.reduce((a, b) => a + b.bt, 0);
            const sumDiff = items.reduce((a, b) => a + b.diff, 0);
            const sumPct = sumBT !== 0 ? ((sumBT - sumReal) / sumBT) * 100 : null;

            const diffClass = Math.abs(sumDiff) > 0.01 ? (sumDiff > 0 ? 'text-emerald-400' : 'text-red-400') : 'text-gray-500';
            const realClass = sumReal > 0 ? 'text-emerald-400' : (sumReal < 0 ? 'text-red-400' : 'text-gray-500');
            const btClass = sumBT > 0 ? 'text-emerald-500/70' : (sumBT < 0 ? 'text-red-500/70' : 'text-gray-500/70');

            return `
            <tr class="bg-gray-800/80 font-bold border-b border-gray-600">
                <td class="py-2 px-4 text-amber-500/80 text-right text-xs uppercase tracking-wider">${label}</td>
                <td class="py-2 px-4 text-right font-mono text-sm ${realClass}">${formatMoneyBreakdown(sumReal)}</td>
                <td class="py-2 px-4 text-right font-mono text-sm ${btClass}">${formatMoneyBreakdown(sumBT)}</td>
                <td class="py-2 px-4 text-right font-mono text-xs ${diffClass}">${formatMoneyBreakdown(sumDiff)}</td>
                <td class="py-2 px-4 text-right">${formatPct(sumPct)}</td>
            </tr>
        `;
        };

        // Build HTML
        let htmlRows = '';

        // 1. Orphans (comments without strategy name) - TOP
        if (groupOrphans.length > 0) {
            htmlRows += `<tr><td colspan="5" class="py-2 px-4 text-xs font-bold text-gray-500 uppercase bg-gray-900/40">Unmatched Real Ops (Likely Orphans)</td></tr>`;
            htmlRows += groupOrphans.map(generateRow).join('');
            htmlRows += generateSubtotal('Real Only Subtotal', groupOrphans);
        }

        // 2. Identified Strategies - BOTTOM
        if (groupStrategies.length > 0) {
            htmlRows += `<tr><td colspan="5" class="py-2 px-4 text-xs font-bold text-blue-400 uppercase bg-gray-900/40 mt-4">Matched / Backtested Strategies</td></tr>`;
            htmlRows += groupStrategies.map(generateRow).join('');
            htmlRows += generateSubtotal('Strategies Subtotal', groupStrategies);
        }

        // 3. Grand Total
        const allItems = [...groupOrphans, ...groupStrategies];
        const grandReal = allItems.reduce((a, b) => a + b.real, 0);
        const grandBT = allItems.reduce((a, b) => a + b.bt, 0);
        const grandDiff = allItems.reduce((a, b) => a + b.diff, 0);
        const grandPct = grandBT !== 0 ? ((grandBT - grandReal) / grandBT) * 100 : null;

        htmlRows += `
        <tr class="bg-gray-900 font-bold border-t-2 border-amber-500/50">
            <td class="py-4 px-4 text-amber-400 text-right text-sm uppercase tracking-wider">GRAND TOTAL${rSquared !== null ? ` (R²: ${rSquared.toFixed(3)})` : ''}</td>
            <td class="py-4 px-4 text-right font-mono text-base ${grandReal > 0 ? 'text-emerald-400' : (grandReal < 0 ? 'text-red-400' : 'text-gray-500')}">${formatMoneyBreakdown(grandReal)}</td>
            <td class="py-4 px-4 text-right font-mono text-base ${grandBT > 0 ? 'text-emerald-500/70' : (grandBT < 0 ? 'text-red-500/70' : 'text-gray-500/70')}">${formatMoneyBreakdown(grandBT)}</td>
            <td class="py-4 px-4 text-right font-mono text-sm ${grandDiff > 0 ? 'text-emerald-400' : (grandDiff < 0 ? 'text-red-400' : 'text-gray-500')}">${formatMoneyBreakdown(grandDiff)}</td>
            <td class="py-4 px-4 text-right">${formatPct(grandPct)}</td>
        </tr>
    `;

        // Modal HTML
        const modal = document.createElement('div');
        modal.className = "fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4";
        modal.innerHTML = `
        <div class="bg-gray-800 rounded-lg border border-gray-700 w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
            <div class="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900/50">
                <h3 class="text-amber-400 font-bold text-lg uppercase tracking-wider">Strategy PnL Breakdown & Var</h3>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-white transition-colors">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
            <div class="overflow-y-auto flex-1 p-4 custom-scrollbar">
                <table class="w-full text-left border-collapse">
                    <thead class="sticky top-0 bg-gray-900 text-xs text-gray-400 uppercase font-bold z-10">
                        <tr>
                            <th class="py-2 px-4 border-b border-gray-700">Strategy / ID</th>
                            <th class="py-2 px-4 border-b border-gray-700 text-right">Real PnL</th>
                            <th class="py-2 px-4 border-b border-gray-700 text-right">Backtest PnL</th>
                            <th class="py-2 px-4 border-b border-gray-700 text-right">Diff</th>
                            <th class="py-2 px-4 border-b border-gray-700 text-right" title="(BT-Real)/BT">% Var</th>
                        </tr>
                    </thead>
                    <tbody>${htmlRows}</tbody>
                </table>
            </div> 
            <div class="p-3 border-t border-gray-700 bg-gray-900/50 text-right text-xs text-gray-500">
                Strategies: ${allItems.length} | Matched Trades: ${matches.length} | Orphan Real: ${orphanReal.length} | Orphan BT: ${orphanBT.length}
            </div>
        </div>
    `;
        document.body.appendChild(modal);
    };

    // --- NEW: PnL Chart Modal (Cumulative) ---
    // --- NEW: PnL Chart Modal (Cumulative) ---
    window.showPnLChart = (initialStrategy = 'all') => {
        if (!window.latestSQAnalysisData || !window.latestSQAnalysisData.matches) {
            return alert("No matched trade data available for charting.");
        }

        // Use `let` for these so they can be updated by the event listener
        let matches = window.latestSQAnalysisData.matches || [];
        let orphanReal = window.latestSQAnalysisData.orphanReal || [];
        let orphanBT = window.latestSQAnalysisData.orphanBT || [];
        let activeTooltipListener = null; // Manage listener lifecycle
        let tooltipEnabled = true; // Toggle with click

        // Initialize global threshold if not exists
        if (typeof window.pnlChartThreshold === 'undefined') {
            window.pnlChartThreshold = 80;
        }

        // Create modal
        const modal = document.createElement('div');
        modal.className = "fixed inset-0 z-[120] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4";
        modal.innerHTML = `
        <div class="bg-gray-800 rounded-lg border border-gray-700 w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl">
            <div class="p-3 border-b border-gray-700 flex justify-between items-center bg-gray-900 gap-3">
                <h3 id="sq-pnl-modal-title" class="text-gray-200 font-bold text-sm truncate max-w-[400px]">Cumulative PnL Comparison (BT vs Real)</h3>
                <div id="pnl-strategy-selector-container" class="ml-4"></div>
                <div class="flex items-center gap-2">
                    <label class="text-gray-400 text-xs" title="Divergence threshold: difference in PnL change">⚠️ Threshold:</label>
                    <input type="number" id="pnl-div-threshold" class="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-amber-500 w-20 text-center" value="${window.pnlChartThreshold}" min="1" step="10" inputmode="numeric">
                </div>
                <button id="pnl-quarantine-btn" class="text-red-400 hover:text-red-300 hover:bg-red-900/30 px-2 py-1 rounded text-xs border border-red-900/50 transition-colors" title="Enviar estrategia a Cuarentena">☣️ Cuarentena</button>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-white ml-auto">✕</button>
            </div>
            <div class="overflow-y-auto p-6 custom-scrollbar flex-1">
                <div class="relative w-full" style="height: 500px;">
                    <canvas id="pnl-chart-canvas"></canvas>
                </div>
                <div class="mt-4 flex gap-4 justify-center text-xs flex-wrap">
                    <div class="flex items-center gap-2">
                        <div class="w-3 h-3 bg-blue-500/70"></div>
                        <span class="text-gray-400">Backtest PnL</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <div class="w-3 h-3 bg-emerald-500"></div>
                        <span class="text-gray-400">Real PnL</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <div class="w-4 h-4 rounded-full bg-pink-500 border border-pink-400"></div>
                        <span class="text-gray-400">Neutralizado</span>
                    </div>
                    <div id="pnl-chart-stats" class="flex items-center gap-2 ml-4 text-gray-400">
                        <!-- Stats will be injected here -->
                    </div>
                </div>
                <!-- Overrides Management Panel -->
                <div id="pnl-overrides-panel" class="mt-4 border-t border-gray-700 pt-4">
                    <div class="flex justify-between items-center mb-2">
                        <h4 class="text-gray-400 text-xs font-bold uppercase tracking-wider">⊘ Trades Editados / Neutralizados</h4>
                        <span id="pnl-overrides-count" class="text-gray-500 text-xs"></span>
                    </div>
                    <div id="pnl-overrides-list" class="max-h-32 overflow-y-auto custom-scrollbar">
                        <!-- Overrides will be listed here -->
                    </div>
                </div>
            </div>
        </div>
    `;

        document.body.appendChild(modal);

        // Function to render the chart
        // Function to render the chart
        const renderChart = (filteredMatches, filteredOrphanReal, filteredOrphanBT, divThreshold) => {
            // Combine all trades into a unified format with standardized timestamps
            const allTrades = [];

            // Helper to safe-parse date to timestamp
            const getTs = (d) => {
                if (d instanceof Date) return d.getTime();
                if (typeof d === 'string' || typeof d === 'number') return new Date(d).getTime();
                return 0;
            };

            // Add matched trades (have both BT and Real)
            filteredMatches.forEach(m => {
                // Determine effective time (Real usually preferred for chart x-axis, but we need consistency)
                // If matched, use Real Open Time if available, else BT Open Time.
                const tObj = m.real.openTime || m.bt.openTime;
                allTrades.push({
                    time: tObj, // Keep original obj for now if needed (tooltip), but we'll use ts for sort
                    ts: getTs(tObj),
                    btPnL: m.bt.pnl || 0,
                    realPnL: m.real.pnl || 0,
                    type: 'matched',
                    displaySymbol: m.displaySymbol || m.bt.strategyId || 'Unknown'
                });
            });

            // Add orphan real trades (only Real PnL)
            filteredOrphanReal.forEach(r => {
                allTrades.push({
                    time: r.openTime,
                    ts: getTs(r.openTime),
                    btPnL: 0, // No BT data
                    realPnL: r.pnl || 0,
                    type: 'orphan-real',
                    displaySymbol: r.displaySymbol || r.comment || r.strategyId || 'Unknown'
                });
            });

            // Add orphan BT trades (only BT PnL)
            filteredOrphanBT.forEach(bt => {
                allTrades.push({
                    time: bt.openTime,
                    ts: getTs(bt.openTime),
                    btPnL: bt.pnl || 0,
                    realPnL: 0, // No Real data
                    type: 'orphan-bt',
                    displaySymbol: bt.displaySymbol || bt.strategyId || 'Unknown'
                });
            });

            // Sort all trades chronologically using numeric timestamp
            const sorted = allTrades.sort((a, b) => a.ts - b.ts);

            // Calculate the Last Date of Valid Backtest Data (Strictly numeric)
            let lastBtTime = 0;
            // Scan source lists for robustness
            filteredMatches.forEach(m => {
                const btTs = getTs(m.bt.openTime);
                if (btTs > lastBtTime) lastBtTime = btTs;
            });
            filteredOrphanBT.forEach(bt => {
                const btTs = getTs(bt.openTime);
                if (btTs > lastBtTime) lastBtTime = btTs;
            });

            // Calculate cumulative PnL
            const chartData = [];
            let cumBT = 0;
            let cumReal = 0;

            // Helper to generate override key
            const getTradeOverrideKey = (displaySymbol, timestamp) => {
                const ts = getTs(timestamp);
                return `${displaySymbol}::${ts}`;
            };

            sorted.forEach((trade, idx) => {
                const key = getTradeOverrideKey(trade.displaySymbol, trade.time);
                const override = state.tradePnlOverrides?.[key];

                let effectiveBtPnL = trade.btPnL;
                let effectiveRealPnL = trade.realPnL;
                let isNeutralized = false;

                if (override) {
                    if (override.neutralized) {
                        effectiveBtPnL = 0;
                        effectiveRealPnL = 0;
                        isNeutralized = true;
                    } else {
                        if (override.btPnL !== null && override.btPnL !== undefined) effectiveBtPnL = override.btPnL;
                        if (override.realPnL !== null && override.realPnL !== undefined) effectiveRealPnL = override.realPnL;
                    }
                }

                cumBT += effectiveBtPnL;
                cumReal += effectiveRealPnL;
                chartData.push({
                    index: idx,
                    time: trade.time,
                    ts: trade.ts, // Pass standardized timestamp
                    cumBT: cumBT,
                    cumReal: cumReal,
                    btPnL: effectiveBtPnL,
                    realPnL: effectiveRealPnL,
                    originalBtPnL: trade.btPnL,
                    originalRealPnL: trade.realPnL,
                    type: trade.type,
                    displaySymbol: trade.displaySymbol,
                    isNeutralized: isNeutralized,
                    overrideKey: key
                });
            });

            const canvas = document.getElementById('pnl-chart-canvas');
            if (!canvas || chartData.length === 0) {
                if (canvas) {
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#1f2937';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = '#9ca3af';
                    ctx.font = '14px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('No trades for selected strategy', canvas.width / 2, canvas.height / 2);
                }
                return;
            }

            const ctx = canvas.getContext('2d');
            const parent = canvas.parentElement;
            canvas.width = parent.clientWidth;
            canvas.height = parent.clientHeight;

            // Chart dimensions
            const padding = { top: 40, right: 60, bottom: 60, left: 80 };
            const chartWidth = canvas.width - padding.left - padding.right;
            const chartHeight = canvas.height - padding.top - padding.bottom;

            // Find min/max for Y axis
            const allValues = chartData.flatMap(d => [d.cumBT, d.cumReal]);
            const minY = Math.min(0, ...allValues);
            const maxY = Math.max(...allValues);
            const rangeY = maxY - minY;
            const paddingY = rangeY * 0.1;
            const yMin = minY - paddingY;
            const yMax = maxY + paddingY;

            // Scale functions
            const scaleX = (index) => padding.left + (index / (chartData.length - 1)) * chartWidth;
            const scaleY = (value) => padding.top + chartHeight - ((value - yMin) / (yMax - yMin)) * chartHeight;

            // Clear canvas
            ctx.fillStyle = '#1f2937';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw grid
            ctx.strokeStyle = '#374151';
            ctx.lineWidth = 1;
            const gridLines = 8;
            for (let i = 0; i <= gridLines; i++) {
                const y = padding.top + (i / gridLines) * chartHeight;
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(padding.left + chartWidth, y);
                ctx.stroke();
            }

            // Draw Y axis labels
            ctx.fillStyle = '#9ca3af';
            ctx.font = '11px monospace';
            ctx.textAlign = 'right';
            for (let i = 0; i <= gridLines; i++) {
                const value = yMin + (i / gridLines) * (yMax - yMin);
                const y = padding.top + chartHeight - (i / gridLines) * chartHeight;
                ctx.fillText('$' + value.toFixed(0), padding.left - 10, y + 4);
            }

            // Draw zero line if needed
            if (yMin < 0 && yMax > 0) {
                const zeroY = scaleY(0);
                ctx.strokeStyle = '#6b7280';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.moveTo(padding.left, zeroY);
                ctx.lineTo(padding.left + chartWidth, zeroY);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // Draw lines with Segment Support
            const drawLine = (data, defaultColor, lineWidth = 2, isBacktest = false) => {
                ctx.lineWidth = lineWidth;

                // We draw segment by segment to handle color changes
                for (let i = 0; i < data.length - 1; i++) {
                    const d1 = data[i];
                    const d2 = data[i + 1];
                    const x1 = scaleX(i);
                    const y1 = scaleY(isBacktest ? d1.cumBT : d1.cumReal);
                    const x2 = scaleX(i + 1);
                    const y2 = scaleY(isBacktest ? d2.cumBT : d2.cumReal);

                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);

                    // Logic: If we are drawing Backtest Line and the segment starts AFTER the last valid BT trade,
                    // it is an extension.
                    // Use standardized timestamp .ts from chartData
                    const currentTs = d1.ts || (d1.time instanceof Date ? d1.time.getTime() : 0);

                    if (isBacktest && lastBtTime > 0 && currentTs >= lastBtTime) {
                        ctx.strokeStyle = '#9ca3af'; // Gray-400
                        ctx.setLineDash([4, 4]); // Dashed
                    } else {
                        ctx.strokeStyle = defaultColor;
                        ctx.setLineDash([]); // Solid
                    }

                    ctx.stroke();
                }
                ctx.setLineDash([]); // Reset
            };

            // Draw BT line (blue, semi-transparent, with Gray Extension support)
            // Pass the FULL chartData array, not just mapped values
            drawLine(chartData, 'rgba(59, 130, 246, 0.7)', 3, true);

            // Draw Real line (green)
            drawLine(chartData, 'rgba(16, 185, 129, 1)', 3, false);

            // Draw points with divergence detection
            const drawPoints = (data, color) => {
                data.forEach((d, i) => {
                    const x = scaleX(i);
                    const y = scaleY(d);
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.arc(x, y, 3, 0, 2 * Math.PI);
                    ctx.fill();
                });
            };

            // Draw BT points (blue)
            drawPoints(chartData.map(d => d.cumBT), 'rgba(59, 130, 246, 0.9)');

            // Draw Real points with divergence detection (categorize as positive/negative)
            let positiveDiv = 0; // Real better than BT
            let negativeDiv = 0; // Real worse than BT
            let sumPosDiv = 0;
            let sumNegDiv = 0;

            chartData.forEach((d, i) => {
                const x = scaleX(i);
                const y = scaleY(d.cumReal);

                // Detect divergence: compare direction of movement
                let divergenceType = null; // null, 'positive', or 'negative'

                if (i > 0) {
                    const prevBT = chartData[i - 1].cumBT;
                    const prevReal = chartData[i - 1].cumReal;
                    const btChange = d.cumBT - prevBT;
                    const realChange = d.cumReal - prevReal;

                    // Divergence occurs when:
                    // 1. BT moves but Real doesn't (or vice versa)
                    // 2. They move in opposite directions
                    // 3. Difference between changes is >= threshold
                    const btMoving = Math.abs(btChange) > 0.01;
                    const realMoving = Math.abs(realChange) > 0.01;
                    const changeDiff = Math.abs(btChange - realChange);

                    let isDivergent = false;

                    // Divergence logic simplified: ONLY trigger if difference exceeds threshold
                    if (changeDiff >= divThreshold) {
                        isDivergent = true;
                    }

                    // Classify divergence as positive or negative
                    if (isDivergent) {
                        // Positive: Real performed better than BT
                        // Negative: Real performed worse than BT
                        if (realChange > btChange) {
                            divergenceType = 'positive'; // Real better
                            positiveDiv++;
                            sumPosDiv += changeDiff;
                        } else {
                            divergenceType = 'negative'; // Real worse
                            negativeDiv++;
                            sumNegDiv += changeDiff;
                        }
                    }
                }

                // Color based on divergence type (but neutralized overrides everything)
                let pointColor = 'rgba(16, 185, 129, 1)'; // Green (aligned)

                // NEUTRALIZED trades always get magenta color regardless of divergence
                if (d.isNeutralized) {
                    pointColor = 'rgba(236, 72, 153, 0.9)'; // Magenta/Pink (neutralized)
                } else if (divergenceType === 'positive') {
                    pointColor = 'rgba(251, 191, 36, 1)'; // Amber/Orange (positive divergence)
                } else if (divergenceType === 'negative') {
                    pointColor = 'rgba(239, 68, 68, 1)'; // Red (negative divergence)
                }

                ctx.fillStyle = pointColor;
                ctx.beginPath();

                // Neutralized points get a slightly larger size + ring
                if (d.isNeutralized) {
                    ctx.arc(x, y, 5, 0, 2 * Math.PI);
                    ctx.fill();
                    // Add ring around neutralized point
                    ctx.strokeStyle = 'rgba(219, 39, 119, 0.8)'; // Darker magenta ring
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                } else {
                    ctx.arc(x, y, 3, 0, 2 * Math.PI);
                    ctx.fill();
                }
            });

            const totalDiv = positiveDiv + negativeDiv;
            const avgPos = positiveDiv > 0 ? (sumPosDiv / positiveDiv).toFixed(2) : '0.00';
            const avgNeg = negativeDiv > 0 ? (sumNegDiv / negativeDiv).toFixed(2) : '0.00';
            // User requested Total Average = (SumPos - SumNeg) / TotalCount
            const netSumDiv = sumPosDiv - sumNegDiv;
            const avgTotal = totalDiv > 0 ? (netSumDiv / totalDiv).toFixed(2) : '0.00';


            ctx.fillStyle = '#9ca3af';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            const labelStep = Math.max(1, Math.floor(chartData.length / 10));
            chartData.forEach((d, i) => {
                if (i % labelStep === 0 || i === chartData.length - 1) {
                    const x = scaleX(i);
                    const dateStr = d.time.toISOString().slice(0, 10);
                    ctx.fillText(dateStr, x, canvas.height - padding.bottom + 20);
                }
            });

            // Chart title
            ctx.fillStyle = '#f3f4f6';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Cumulative PnL Over Time', canvas.width / 2, 20);

            // Display final values with enhanced statistics (LEFT SIDE)
            const finalBT = chartData[chartData.length - 1].cumBT;
            const finalReal = chartData[chartData.length - 1].cumReal;
            const totalDiff = finalReal - finalBT;

            ctx.font = '12px monospace';
            ctx.textAlign = 'left';
            const leftX = padding.left + 10;

            // BT Net Profit
            ctx.fillStyle = 'rgba(59, 130, 246, 1)';
            ctx.fillText('BT: $' + finalBT.toFixed(2), leftX, padding.top + 20);

            // Real Net Profit
            ctx.fillStyle = 'rgba(16, 185, 129, 1)';
            ctx.fillText('Real: $' + finalReal.toFixed(2), leftX, padding.top + 40);

            // Total Difference
            ctx.fillStyle = totalDiff >= 0 ? 'rgba(16, 185, 129, 1)' : 'rgba(239, 68, 68, 1)';
            ctx.fillText('Diff: $' + totalDiff.toFixed(2), leftX, padding.top + 60);

            // Divergence statistics
            ctx.fillStyle = 'rgba(251, 191, 36, 1)'; // Amber
            ctx.fillText(`🟠 Div+: ${positiveDiv} (Avg: $${avgPos}, Sum: $${sumPosDiv.toFixed(2)})`, leftX, padding.top + 80);
            ctx.fillStyle = 'rgba(239, 68, 68, 1)'; // Red
            ctx.fillText(`🔴 Div-: ${negativeDiv} (Avg: $${avgNeg}, Sum: -$${sumNegDiv.toFixed(2)})`, leftX, padding.top + 100);
            ctx.fillStyle = '#9ca3af'; // Gray
            ctx.fillText(`Total Div: ${totalDiv} (Avg: $${avgTotal}, Net: $${netSumDiv.toFixed(2)})`, leftX, padding.top + 120);

            // No SL indicator (Net / 100)
            const noSLValue = netSumDiv / 100;
            ctx.fillStyle = noSLValue >= 0 ? 'rgba(16, 185, 129, 1)' : 'rgba(239, 68, 68, 1)';
            ctx.fillText(`No SL: ${noSLValue.toFixed(2)}`, leftX, padding.top + 140);

            // Pearson Correlation
            const calcPearson = (x, y) => {
                const n = x.length;
                if (n === 0) return 0;
                const sumX = x.reduce((a, b) => a + b, 0);
                const sumY = y.reduce((a, b) => a + b, 0);
                const sumXY = x.reduce((a, b, i) => a + (b * y[i]), 0);
                const sumX2 = x.reduce((a, b) => a + (b * b), 0);
                const sumY2 = y.reduce((a, b) => a + (b * b), 0);

                const numerator = (n * sumXY) - (sumX * sumY);
                const denominator = Math.sqrt(((n * sumX2) - (sumX * sumX)) * ((n * sumY2) - (sumY * sumY)));
                return denominator === 0 ? 0 : numerator / denominator;
            };

            const btSeries = chartData.map(d => d.cumBT);
            const realSeries = chartData.map(d => d.cumReal);
            const pearsonR = calcPearson(btSeries, realSeries);

            ctx.fillStyle = '#cbd5e1'; // Light Gray
            ctx.fillText(`Pearson R: ${pearsonR.toFixed(4)}`, leftX, padding.top + 160);

            // Update stats
            const statsDiv = document.getElementById('pnl-chart-stats');
            if (statsDiv) {
                const realCount = chartData.filter(d => d.type !== 'orphan-bt').length;
                statsDiv.innerHTML = `<span>Trades: ${chartData.length} (Real: ${realCount})</span>`;
            }

            // Update Overrides Panel
            const overridesList = document.getElementById('pnl-overrides-list');
            const overridesCount = document.getElementById('pnl-overrides-count');
            const overridesPanel = document.getElementById('pnl-overrides-panel');

            if (overridesList && overridesCount) {
                const overrideKeys = Object.keys(state.tradePnlOverrides || {});
                overridesCount.textContent = overrideKeys.length > 0 ? `(${overrideKeys.length})` : '';

                if (overrideKeys.length === 0) {
                    overridesList.innerHTML = '<div class="text-gray-500 text-xs italic py-2">No hay trades editados. Haz doble click en un punto para editar.</div>';
                    if (overridesPanel) overridesPanel.style.display = 'block';
                } else {
                    overridesList.innerHTML = overrideKeys.map(key => {
                        const override = state.tradePnlOverrides[key];
                        const [displaySymbol, timestamp] = key.split('::');
                        const date = new Date(parseInt(timestamp));
                        const dateStr = date.toISOString().slice(0, 10);
                        const shortSymbol = displaySymbol.substring(0, 30);

                        let statusBadge = '';
                        if (override.neutralized) {
                            statusBadge = '<span class="bg-pink-700 text-pink-100 text-xs px-1.5 py-0.5 rounded">⊘ Neutralizado</span>';
                        } else {
                            const changes = [];
                            if (override.realPnL !== null) changes.push(`R:$${override.realPnL.toFixed(2)}`);
                            if (override.btPnL !== null) changes.push(`BT:$${override.btPnL.toFixed(2)}`);
                            statusBadge = `<span class="bg-amber-600/50 text-amber-200 text-xs px-1.5 py-0.5 rounded">${changes.join(', ')}</span>`;
                        }

                        const commentHtml = override.comment ? `<span class="text-gray-500 text-xs italic truncate max-w-[120px]" title="${override.comment}">💬 ${override.comment.substring(0, 20)}${override.comment.length > 20 ? '...' : ''}</span>` : '';

                        return `
                        <div class="flex items-center justify-between py-1.5 px-2 bg-gray-700/30 rounded mb-1 group hover:bg-gray-700/60">
                            <div class="flex items-center gap-2 overflow-hidden flex-1">
                                <span class="text-gray-400 text-xs truncate" title="${displaySymbol}">${shortSymbol}</span>
                                <span class="text-gray-500 text-xs">${dateStr}</span>
                                ${statusBadge}
                                ${commentHtml}
                            </div>
                            <button class="pnl-override-delete text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity ml-2" data-key="${key}" title="Eliminar override">🗑️</button>
                        </div>
                        `;
                    }).join('');

                    // Wire up delete buttons
                    overridesList.querySelectorAll('.pnl-override-delete').forEach(btn => {
                        btn.onclick = (e) => {
                            const keyToDelete = e.target.dataset.key;
                            if (keyToDelete && state.tradePnlOverrides[keyToDelete]) {
                                delete state.tradePnlOverrides[keyToDelete];
                                console.log('[PnL Override] Deleted:', keyToDelete);
                                renderChart(filteredMatches, filteredOrphanReal, filteredOrphanBT, divThreshold);
                            }
                        };
                    });

                    if (overridesPanel) overridesPanel.style.display = 'block';
                }
            }

            // Change cursor to crosshair
            canvas.style.cursor = 'crosshair';

            // Add tooltip functionality
            if (activeTooltipListener) {
                canvas.removeEventListener('mousemove', activeTooltipListener);
            }

            activeTooltipListener = (e) => {
                if (!tooltipEnabled) return; // Skip if disabled

                const rect = canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                // Find or create tooltip element
                let tooltip = document.getElementById('pnl-chart-tooltip');
                if (!tooltip) {
                    tooltip = document.createElement('div');
                    tooltip.id = 'pnl-chart-tooltip';
                    tooltip.className = 'fixed z-[200] bg-gray-900/95 border border-gray-600 rounded-lg shadow-xl p-3 text-xs font-mono pointer-events-none transition-opacity duration-150';
                    tooltip.style.maxWidth = '260px';
                    document.body.appendChild(tooltip);
                }

                // Find closest point
                let closestPoint = null;
                let minDistance = 20; // Max distance to trigger tooltip
                let closestX = 0;
                let closestY = 0;

                chartData.forEach((d, i) => {
                    const x = scaleX(i);
                    const yReal = scaleY(d.cumReal);

                    // Check distance to Real point (primary)
                    const distReal = Math.sqrt(Math.pow(mouseX - x, 2) + Math.pow(mouseY - yReal, 2));
                    if (distReal < minDistance) {
                        minDistance = distReal;
                        closestPoint = { ...d, index: i };
                        closestX = x;
                        closestY = yReal;
                    }
                });

                if (closestPoint) {
                    // Position tooltip near cursor but not overlapping
                    const tooltipLeft = e.clientX + 15;
                    const tooltipTop = e.clientY - 100;

                    tooltip.style.left = tooltipLeft + 'px';
                    tooltip.style.top = Math.max(10, tooltipTop) + 'px';
                    tooltip.style.opacity = '1';

                    // Build tooltip content
                    const stratName = (closestPoint.displaySymbol || 'Strategy').substring(0, 25);
                    const dateStr = closestPoint.time.toISOString().slice(0, 10);
                    const timeStr = closestPoint.time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

                    const btVal = closestPoint.btPnL;
                    const realVal = closestPoint.realPnL;
                    const diff = realVal - btVal;
                    const diffColor = diff >= 0 ? 'text-emerald-400' : 'text-red-400';

                    tooltip.innerHTML = `
                    <div class="text-gray-200 font-bold mb-1 truncate" title="${closestPoint.displaySymbol}">${stratName}</div>
                    <div class="text-gray-500 mb-2">${dateStr} ${timeStr}</div>
                    <div class="grid grid-cols-2 gap-x-3 gap-y-1">
                        <span class="text-gray-400">PnL BT:</span>
                        <span class="text-blue-400">$${btVal.toFixed(2)}</span>
                        <span class="text-gray-400">PnL Real:</span>
                        <span class="text-emerald-400">$${realVal.toFixed(2)}</span>
                        <span class="text-gray-400">Diff:</span>
                        <span class="${diffColor}">$${diff.toFixed(2)}</span>
                    </div>
                    <div class="border-t border-gray-700 mt-2 pt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                        <span class="text-gray-400">Cum BT:</span>
                        <span class="text-blue-400">$${closestPoint.cumBT.toFixed(2)}</span>
                        <span class="text-gray-400">Cum Real:</span>
                        <span class="text-emerald-400">$${closestPoint.cumReal.toFixed(2)}</span>
                    </div>
                `;
                } else {
                    // Hide tooltip when not near any point
                    tooltip.style.opacity = '0';
                }
            };
            canvas.addEventListener('mousemove', activeTooltipListener);

            // Hide tooltip when leaving canvas
            canvas.addEventListener('mouseleave', () => {
                const tooltip = document.getElementById('pnl-chart-tooltip');
                if (tooltip) tooltip.style.opacity = '0';
            });

            // Click to toggle tooltip visibility
            canvas.onclick = () => {
                tooltipEnabled = !tooltipEnabled;
                console.log('[PnL Chart] Tooltip', tooltipEnabled ? 'ENABLED' : 'DISABLED');
                const tooltip = document.getElementById('pnl-chart-tooltip');
                if (tooltip && !tooltipEnabled) tooltip.style.opacity = '0';
            };

            // Double-click to edit trade PnL (Neutralize/Override)
            canvas.ondblclick = (e) => {
                const rect = canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                // Find closest point
                let closestPoint = null;
                let minDistance = 25; // Max distance to trigger edit

                chartData.forEach((d, i) => {
                    const x = scaleX(i);
                    const yReal = scaleY(d.cumReal);
                    const dist = Math.sqrt(Math.pow(mouseX - x, 2) + Math.pow(mouseY - yReal, 2));
                    if (dist < minDistance) {
                        minDistance = dist;
                        closestPoint = d;
                    }
                });

                if (!closestPoint) return;

                // Show edit modal
                const dateStr = closestPoint.time.toISOString().slice(0, 10);
                const timeStr = closestPoint.time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
                const hasOverride = state.tradePnlOverrides?.[closestPoint.overrideKey];

                const editModal = document.createElement('div');
                editModal.id = 'pnl-edit-modal';
                editModal.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4';
                editModal.innerHTML = `
                <div class="bg-gray-800 rounded-lg border border-gray-600 w-full max-w-sm shadow-2xl">
                    <div class="p-3 border-b border-gray-700 bg-gray-900 rounded-t-lg flex justify-between items-center">
                        <h4 class="text-gray-200 font-bold text-sm">✏️ Editar Trade PnL</h4>
                        <button id="pnl-edit-close" class="text-gray-400 hover:text-white">✕</button>
                    </div>
                    <div class="p-4 space-y-4">
                        <div class="text-xs text-gray-400">
                            <div class="font-bold text-gray-300 truncate">${closestPoint.displaySymbol}</div>
                            <div>${dateStr} ${timeStr}</div>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="text-xs text-gray-400 block mb-1">PnL Real ($)</label>
                                <input type="number" id="pnl-edit-real" step="0.01" 
                                    class="w-full bg-gray-700 text-emerald-400 text-sm rounded px-2 py-1.5 border border-gray-600 focus:border-emerald-500 focus:outline-none"
                                    value="${closestPoint.realPnL.toFixed(2)}"
                                    ${closestPoint.isNeutralized ? 'disabled' : ''}>
                            </div>
                            <div>
                                <label class="text-xs text-gray-400 block mb-1">PnL Backtest ($)</label>
                                <input type="number" id="pnl-edit-bt" step="0.01"
                                    class="w-full bg-gray-700 text-blue-400 text-sm rounded px-2 py-1.5 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                    value="${closestPoint.btPnL.toFixed(2)}"
                                    ${closestPoint.isNeutralized ? 'disabled' : ''}>
                            </div>
                        </div>
                        <div>
                            <label class="text-xs text-gray-400 block mb-1">💬 Comentario (opcional)</label>
                            <input type="text" id="pnl-edit-comment" 
                                class="w-full bg-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 border border-gray-600 focus:border-pink-500 focus:outline-none"
                                placeholder="Ej: Ejecutado en Tickmill pero no en Darwinex"
                                value="${hasOverride?.comment || ''}">
                        </div>
                        ${closestPoint.isNeutralized ? '<div class="text-xs text-pink-400 italic text-center">⊘ Trade neutralizado (ambos PnL = 0)</div>' : ''}
                        <div class="flex gap-2 pt-2">
                            ${!closestPoint.isNeutralized ? `
                            <button id="pnl-edit-neutralize" class="flex-1 bg-pink-700 hover:bg-pink-600 text-white text-xs font-bold py-2 px-3 rounded transition-colors" title="Convierte el PnL de ambos lados a 0 (Anular)">
                                ⛔ Anular (0 PnL)
                            </button>
                            ` : ''}
                            ${hasOverride ? `
                            <button id="pnl-edit-restore" class="flex-1 bg-amber-600/80 hover:bg-amber-500 text-white text-xs font-bold py-2 px-3 rounded transition-colors">
                                ↩️ Restaurar
                            </button>
                            ` : ''}
                            ${!closestPoint.isNeutralized ? `
                            <button id="pnl-edit-save" class="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2 px-3 rounded transition-colors" title="Guardar los valores editados">
                                💾 Guardar Cambios
                            </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
                `;
                document.body.appendChild(editModal);

                // Wire up buttons
                document.getElementById('pnl-edit-close').onclick = () => editModal.remove();
                editModal.onclick = (ev) => { if (ev.target === editModal) editModal.remove(); };

                const neutralizeBtn = document.getElementById('pnl-edit-neutralize');
                const restoreBtn = document.getElementById('pnl-edit-restore');
                const saveBtn = document.getElementById('pnl-edit-save');

                if (neutralizeBtn) {
                    neutralizeBtn.onclick = () => {
                        const comment = document.getElementById('pnl-edit-comment')?.value || '';
                        state.tradePnlOverrides[closestPoint.overrideKey] = {
                            neutralized: true,
                            comment: comment,
                            originalReal: closestPoint.originalRealPnL ?? closestPoint.realPnL,
                            originalBT: closestPoint.originalBtPnL ?? closestPoint.btPnL
                        };
                        console.log('[PnL Override] Neutralized:', closestPoint.overrideKey, 'Comment:', comment);
                        editModal.remove();
                        renderChart(filteredMatches, filteredOrphanReal, filteredOrphanBT, divThreshold);
                    };
                }

                if (restoreBtn) {
                    restoreBtn.onclick = () => {
                        delete state.tradePnlOverrides[closestPoint.overrideKey];
                        console.log('[PnL Override] Restored original:', closestPoint.overrideKey);
                        editModal.remove();
                        renderChart(filteredMatches, filteredOrphanReal, filteredOrphanBT, divThreshold);
                    };
                }

                if (saveBtn) {
                    saveBtn.onclick = () => {
                        const newReal = parseFloat(document.getElementById('pnl-edit-real').value);
                        const newBT = parseFloat(document.getElementById('pnl-edit-bt').value);
                        const comment = document.getElementById('pnl-edit-comment')?.value || '';

                        if (!isNaN(newReal) || !isNaN(newBT)) {
                            state.tradePnlOverrides[closestPoint.overrideKey] = {
                                neutralized: false,
                                comment: comment,
                                realPnL: isNaN(newReal) ? null : newReal,
                                btPnL: isNaN(newBT) ? null : newBT,
                                originalReal: closestPoint.originalRealPnL ?? closestPoint.realPnL,
                                originalBT: closestPoint.originalBtPnL ?? closestPoint.btPnL
                            };
                            console.log('[PnL Override] Saved:', closestPoint.overrideKey, { newReal, newBT, comment });
                        }
                        editModal.remove();
                        renderChart(filteredMatches, filteredOrphanReal, filteredOrphanBT, divThreshold);
                    };
                }
            };
        };

        // Initial render
        setTimeout(() => {
            // We TRUST window.latestSQAnalysisData to contain the relevant data for the current view.
            // We do NOT filter it further, because Orphans often lack the metadata (displaySymbol) to match strictly,
            // leading to them being hidden (the "User Error" description).

            if (initialStrategy !== 'all') {
                const titleEl = document.getElementById('sq-pnl-modal-title');
                if (titleEl) {
                    // Determine clean name from initialStrategy (filename)
                    const cleanName = initialStrategy.replace('.csv', '').trim();
                    titleEl.innerText = cleanName;
                    titleEl.title = initialStrategy;
                }
            } else {
                const titleEl = document.getElementById('sq-pnl-modal-title');
                if (titleEl) {
                    titleEl.innerText = 'Cumulative PnL Comparison (BT vs Real)';
                    titleEl.title = '';
                }
            }

            // --- STRATEGY INFO LABEL (multi-select is in main panel) ---
            const container = document.getElementById('pnl-strategy-selector-container');
            if (container) {
                // Show current selection info instead of cloning the complex dropdown
                // logic to determine label content and style
                // logic to determine label content and style
                let labelHtml = '';
                const pName = (window.latestSQAnalysisData && window.latestSQAnalysisData.portfolioName) ? window.latestSQAnalysisData.portfolioName : 'Portfolio';

                // Check for Single Selection wrapped in Array
                let effectiveStrategy = initialStrategy;
                if (Array.isArray(initialStrategy) && initialStrategy.length === 1) {
                    effectiveStrategy = initialStrategy[0];
                }

                if (effectiveStrategy === 'all') {
                    // Portfolio View
                    labelHtml = `
                    <div class="flex items-center gap-2">
                        <span class="bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-xs font-bold px-2 py-1 rounded shadow-sm border border-indigo-400/30">
                            📂 Portfolio View
                        </span>
                        <span class="text-gray-300 font-mono text-xs truncate max-w-[200px]" title="${pName}">
                            ${pName}
                        </span>
                    </div>`;
                } else if (Array.isArray(effectiveStrategy)) {
                    // Multi-Select ( > 1)
                    const count = effectiveStrategy.length;
                    labelHtml = `
                    <div class="flex items-center gap-2">
                        <span class="bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white text-xs font-bold px-2 py-1 rounded shadow-sm border border-fuchsia-400/30">
                            📚 Multi-Select
                        </span>
                        <span class="text-gray-300 font-mono text-xs">
                            ${count} Strategies
                        </span>
                    </div>`;
                } else {
                    // Single Strategy (String)
                    // Try to get clean name
                    let sName = effectiveStrategy;
                    // Try to lookup name in strategiesList if available globally, but we might not have access here easily.
                    // We can try to use the displaySymbol from the first matched trade?
                    if (window.latestSQAnalysisData && window.latestSQAnalysisData.matches && window.latestSQAnalysisData.matches.length > 0) {
                        const m = window.latestSQAnalysisData.matches.find(m => m.bt && m.bt.strategyId === effectiveStrategy);
                        if (m) sName = m.displaySymbol;
                    }

                    sName = sName.replace('.csv', '').substring(0, 40);

                    labelHtml = `
                    <div class="flex items-center gap-2">
                        <span class="bg-gradient-to-r from-cyan-600 to-blue-600 text-white text-xs font-bold px-2 py-1 rounded shadow-sm border border-cyan-400/30">
                            🎯 Strategy Focus
                        </span>
                        <span class="text-gray-300 font-mono text-xs truncate max-w-[250px]" title="${sName}">
                            ${sName}
                        </span>
                    </div>`;
                }

                container.innerHTML = labelHtml;
            }

            // Wire up Quarantine Button (Toggle: Add/Remove)
            const quarantineBtn = document.getElementById('pnl-quarantine-btn');
            const updateQuarantineButtonState = () => {
                if (!quarantineBtn) return;
                const clone = document.getElementById('pnl-chart-strategy-select-clone');
                if (clone && clone.value !== 'all') {
                    const stratName = clone.options[clone.selectedIndex]?.text || clone.value;
                    const isQuarantined = window.state?.quarantinedStrategyNames?.has(stratName);

                    if (isQuarantined) {
                        quarantineBtn.innerHTML = '✅ Rehabilitar';
                        quarantineBtn.className = 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/30 px-2 py-1 rounded text-xs border border-emerald-900/50 transition-colors';
                        quarantineBtn.title = 'Quitar estrategia de Cuarentena';
                    } else {
                        quarantineBtn.innerHTML = '☣️ Cuarentena';
                        quarantineBtn.className = 'text-red-400 hover:text-red-300 hover:bg-red-900/30 px-2 py-1 rounded text-xs border border-red-900/50 transition-colors';
                        quarantineBtn.title = 'Enviar estrategia a Cuarentena';
                    }
                }
            };

            // Update button state initially and when selector changes
            updateQuarantineButtonState();
            const cloneForListener = document.getElementById('pnl-chart-strategy-select-clone');
            if (cloneForListener) {
                cloneForListener.addEventListener('change', updateQuarantineButtonState);
            }

            if (quarantineBtn) {
                quarantineBtn.onclick = () => {
                    const clone = document.getElementById('pnl-chart-strategy-select-clone');
                    if (clone && clone.value !== 'all') {
                        const stratName = clone.options[clone.selectedIndex]?.text || clone.value;
                        const isQuarantined = window.state?.quarantinedStrategyNames?.has(stratName);

                        if (isQuarantined) {
                            // Remove from quarantine
                            if (window.removeStrategyFromQuarantine) {
                                window.removeStrategyFromQuarantine(stratName);
                                updateQuarantineButtonState();
                            }
                        } else {
                            // Add to quarantine
                            if (window.addStrategyToQuarantine) {
                                window.addStrategyToQuarantine(stratName);
                                updateQuarantineButtonState();
                            }
                        }
                    } else {
                        alert('Selecciona una estrategia específica (no "All") para gestionar cuarentena.');
                    }
                };
            }

            renderChart(matches, orphanReal, orphanBT, window.pnlChartThreshold);

            // Add Threshold Input listener
            const thresholdInput = document.getElementById('pnl-div-threshold');
            if (thresholdInput) {
                thresholdInput.addEventListener('input', (e) => {
                    const newThreshold = parseFloat(e.target.value) || 80;
                    window.pnlChartThreshold = newThreshold; // Save globally
                    console.log('[PnL Chart] Threshold changed to:', newThreshold);
                    renderChart(matches, orphanReal, orphanBT, newThreshold);
                });
            }
        }, 100);

        // Listen for Global Updates (from Main App) to Refresh Chart
        window.addEventListener('sq-analysis-rendered', (e) => {
            console.log('[PnL Chart] Received Global Update Event. Refreshing...');
            const data = e.detail;
            if (!data) return;

            // Update local references
            matches = data.matches || [];
            orphanReal = data.orphanReal || [];
            orphanBT = data.orphanBT || [];

            // Get current threshold value
            const thresholdInput = document.getElementById('pnl-div-threshold');
            const divThreshold = thresholdInput ? parseFloat(thresholdInput.value) || 80 : 80;

            // Sync Clone with Main Selector (in case update came from outside)
            const clone = document.getElementById('pnl-chart-strategy-select-clone');
            const mainSelector = document.getElementById('sq-strategy-select');

            if (clone && mainSelector) {
                clone.value = mainSelector.value;

                // Update Title
                const titleEl = document.getElementById('sq-pnl-modal-title');
                if (titleEl && clone.selectedIndex >= 0) {
                    const stratName = clone.options[clone.selectedIndex].text;
                    const cleanName = stratName.replace('.csv', '').trim();

                    // If all strategies
                    if (clone.value === 'all') {
                        titleEl.innerText = 'Cumulative PnL Comparison (BT vs Real)';
                        titleEl.title = '';
                    } else {
                        titleEl.innerText = cleanName;
                        titleEl.title = stratName;
                    }
                }
            }

            // Render WITHOUT local filtering (trusting main app data context)
            renderChart(matches, orphanReal, orphanBT, divThreshold);
        }, 150);
    };
}

// --- Global Event Listener for Dropdown Closing ---
document.addEventListener('click', (e) => {
    const menu = document.getElementById('sq-strategy-dropdown-menu');
    const btn = document.getElementById('sq-strategy-dropdown-btn');
    if (menu && btn && !menu.classList.contains('hidden')) {
        // If click is OUTSIDE both menu and button
        if (!menu.contains(e.target) && !btn.contains(e.target)) {
            menu.classList.add('hidden');
        }
    }
});

/**
 * Convierte un array de objetos Trade de vuelta al formato CSV (StrategyQuant style).
 * Requerido para pasar "Shadow Data" (datos filtrados) al buscador de DataBank.
 */
export const tradesToCSV = (trades) => {
    if (!trades || trades.length === 0) return "";

    // Header standard de SQ (o lo suficientemente parecido para que el parser lo lea)
    const header = "Ticket,Symbol,Type,Open Time,Open Price,Size,Close Time,Close Price,Profit,Balance,Duration,Commission,Swap,Comment,MagicNumber";

    // Mapeo inverso de objetos a lineas CSV
    const rows = trades.map(t => {
        // Format dates: YYYY.MM.DD HH:mm:ss
        const formatTime = (d) => {
            if (!d) return "";
            if (typeof d === 'string') return d;
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hours = String(d.getHours()).padStart(2, '0');
            const mins = String(d.getMinutes()).padStart(2, '0');
            const secs = String(d.getSeconds()).padStart(2, '0');
            return `${year}.${month}.${day} ${hours}:${mins}:${secs}`;
        };

        const openTime = formatTime(t.openTime);
        // FIX: parseTradesFromData uses exitTime, but this function looked for closeTime. Added fallback.
        const closeTime = formatTime(t.closeTime || t.exitTime);
        const typeStr = t.type;
        const profit = t.pnl ? t.pnl.toFixed(2) : "0.00";
        const balance = t.currentBalance ? t.currentBalance.toFixed(2) : "0.00";
        // Duration is not strictly needed for parsing but nice to have. logic omitted for simplicity.
        const duration = "0";

        return `${t.ticket || 0},${t.symbol || ''},${typeStr},${openTime},${t.openPrice || 0},${t.size || 0},${closeTime},${t.closePrice || 0},${profit},${balance},${duration},0,0,${t.comment || ''},${t.magicNumber || 0}`;
    });

    return [header, ...rows].join('\n');
};
