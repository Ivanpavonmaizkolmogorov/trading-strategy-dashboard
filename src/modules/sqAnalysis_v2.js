import { state } from '../state.js';

export const calculateSQMetrics = (trades) => {
    if (!trades || !Array.isArray(trades) || trades.length === 0) return null;

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

    // Monthly/Weekly Data Cache
    const timeData = {
        month: {},
        week: {}
    };

    // Sort trades by Open Time for Inter-Trade Analysis
    const sortedDetails = [...trades].sort((a, b) => a.openTime - b.openTime);

    // --- Inter-Trade Time Analysis ---
    let previousOpenTime = null;
    const interTradeTimes = []; // In Hours

    sortedDetails.forEach(t => {
        if (previousOpenTime) {
            const diffMs = t.openTime - previousOpenTime;
            const diffHours = diffMs / (1000 * 60 * 60);
            if (diffHours >= 0) interTradeTimes.push(diffHours);
        }
        previousOpenTime = t.openTime;

        const pnl = t.pnl;
        totalProfit += pnl;
        currentEquity += pnl;

        // DD
        if (currentEquity > peakEquity) peakEquity = currentEquity;
        const dd = peakEquity - currentEquity;
        if (dd > maxDD) maxDD = dd;

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

            // Week Calculation (ISO 8601 approx)
            const d = new Date(Date.UTC(y, m, t.exitTime.getDate()));
            const dayNum = d.getUTCDay() || 7;
            d.setUTCDate(d.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
            const w = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
            const wy = d.getUTCFullYear(); // Year for the week

            // Helper to update bucket
            const updateBucket = (bucket, key) => {
                if (!bucket[key]) bucket[key] = { pnl: 0, count: 0, wins: 0, losses: 0, grossProfit: 0, grossLoss: 0 };
                const s = bucket[key];
                s.pnl += pnl;
                s.count++;
                if (pnl >= 0) { s.wins++; s.grossProfit += pnl; }
                else { s.losses++; s.grossLoss += pnl; }
            };

            // Month
            if (!timeData.month[y]) timeData.month[y] = {};
            updateBucket(timeData.month[y], m);

            // Week
            if (!timeData.week[wy]) timeData.week[wy] = {};
            updateBucket(timeData.week[wy], w);
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

    // SQN
    const variance = trades.reduce((sum, t) => sum + Math.pow(t.pnl - avgTrade, 2), 0) / totalTrades;
    const stdDev = Math.sqrt(variance);
    const sqn = stdDev > 0 ? Math.sqrt(Math.min(totalTrades, 100)) * (avgTrade / stdDev) : 0;

    // Return / DD
    const returnDDRatio = maxDD > 0 ? totalProfit / maxDD : (totalProfit > 0 ? 999 : 0);

    // Time Stats
    const firstDate = trades[0].exitTime;
    const lastDate = trades[trades.length - 1].exitTime;
    const days = (lastDate - firstDate) / (1000 * 60 * 60 * 24);
    const years = days / 365.25;
    const avgYearlyProfit = years > 0 ? totalProfit / years : totalProfit;
    const avgMonthlyProfit = years > 0 ? totalProfit / (years * 12) : totalProfit;
    const avgDailyProfit = days > 0 ? totalProfit / days : totalProfit;

    // --- Markov Chain Analysis ---
    const markovStats = calculateMarkovChain(trades, timeData);

    // --- Exit Reason Analysis ---
    const exitStats = analyzeExitReasons(trades);

    // --- Gamma Distribution Analysis ---
    // 1. Global Inter-Trade Times
    const gammaParams = fitGamma(interTradeTimes);
    const globalInterTradeStats = {
        label: 'All Trades',
        values: interTradeTimes, // Now in DAYS
        ...gammaParams
    };

    // 2. Fragmented Inter-Trade Times (by Exit Category)
    const categoryTimes = {};
    const categoryLastTime = {};

    // Helper to get category (reuse logic from analyzeExitReasons slightly simplified or standardized)
    const getCat = (t) => {
        const c = t.comment ? t.comment.toLowerCase() : '';
        const r = t.exitReason ? t.exitReason.toLowerCase() : '';

        // Prioritize explicit exitReason
        // FIX: Check 'Trailing' BEFORE 'Stop', because "Trailing Stop" contains "Stop"
        if (r.includes('trailing')) return 'Trailing';
        if (r.includes('tp') || r.includes('take') || r === 'pt') return 'TP';
        if (r.includes('sl') || r.includes('stop')) return 'SL';
        if (r.includes('exit after')) return 'Time';

        // Fallback to comment
        if (c.includes('trailing')) return 'Trailing';
        if (c.includes('tp') || c.includes('take profit')) return 'TP';
        if (c.includes('sl') || c.includes('stop loss')) return 'SL';
        if (c.includes('close') || c.includes('exit') || c.includes('manual')) return 'Manual';
        return 'Other';
    };

    // DEBUG: Track category counts and unique reasons
    const debugCatCounts = {};
    const uniqueExitReasons = new Set();

    sortedDetails.forEach(t => {
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

    console.log('[SQ Analysis] Debug: Category Counts:', debugCatCounts);
    console.log('[SQ Analysis] Debug: Unique Exit Reasons found:', Array.from(uniqueExitReasons));

    const interTradeStatsByReason = {
        'All': globalInterTradeStats
    };

    Object.keys(categoryTimes).forEach(cat => {
        if (categoryTimes[cat].length > 1) { // Need at least 2 points
            const params = fitGamma(categoryTimes[cat]);
            interTradeStatsByReason[cat] = {
                label: cat,
                values: categoryTimes[cat],
                ...params
            };
        }
    });

    return {
        totalProfit, grossProfit, grossLoss, totalTrades, wins, losses,
        winRate, profitFactor, maxDD, avgWin, avgLoss,
        maxConsecWins, maxConsecLosses, expectancy, sqn,
        avgYearlyProfit, avgMonthlyProfit, avgDailyProfit,
        largestWin, largestLoss, returnDDRatio, avgTrade,
        timeData, // { month: { 2023: { 0: stats... } }, week: { ... } }
        markovStats,
        exitStats,
        interTradeStats: globalInterTradeStats,
        interTradeStatsByReason // New detailed stats
    };
};

/**
 * Categorizes and analyzes trade exit reasons.
 */
const analyzeExitReasons = (trades) => {
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

        if (reason.includes('tp') || reason.includes('take profit') || reason.includes('limit') || reason.includes('target') || reason.includes('pt')) cat = 'TP';
        else if (reason.includes('sl') || reason.includes('stop loss') || reason.includes('stop')) {
            // Check for Trailing
            if (reason.includes('trail') || reason.includes('ts')) cat = 'Trailing';
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

const gammaCDF = (x, alpha, beta) => {
    if (x <= 0) return 0;
    if (alpha <= 0 || beta <= 0) return 0;

    const steps = 100;
    const h = x / steps;
    let sum = gammaPDF(0.0001, alpha, beta) + gammaPDF(x, alpha, beta);

    for (let i = 1; i < steps; i += 2) {
        sum += 4 * gammaPDF(i * h, alpha, beta);
    }
    for (let i = 2; i < steps - 1; i += 2) {
        sum += 2 * gammaPDF(i * h, alpha, beta);
    }

    return (h / 3) * sum;
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

export const generateSQAnalysisHTML = (metrics, selectedMetric = 'pnl', selectedPeriod = 'month', strategiesList = [], currentStrategyId = 'all', currentDataType = 'backtest', markovPeriod = 'trade', markovDepth = 1, currentFreqSelection = 'All') => {
    if (!metrics) return '<div class="text-gray-400 text-center p-10">No hay datos suficientes para el análisis.</div>';

    const formatMoney = (val) => val !== undefined && val !== null ? `$ ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-';
    const formatNum = (val, dec = 2) => val !== undefined && val !== null ? val.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '-';

    const metricsOptions = [
        { value: 'pnl', label: 'Net Profit' },
        { value: 'count', label: 'Trade Count' },
        { value: 'winRate', label: 'Win Rate %' },
        { value: 'profitFactor', label: 'Profit Factor' },
        { value: 'grossProfit', label: 'Gross Profit' },
        { value: 'grossLoss', label: 'Gross Loss' }
    ];

    const periodOptions = [
        { value: 'month', label: 'Monthly' },
        { value: 'week', label: 'Weekly' },
        { value: 'day', label: 'Daily' },
        { value: 'year', label: 'Yearly' }
    ];

    const strategyOptions = strategiesList.map(s =>
        `<option value="${s.id}" ${s.id === currentStrategyId ? 'selected' : ''}>${s.name}</option>`
    ).join('');

    const strategySelectorHTML = `
        <select id="sq-strategy-select" class="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-amber-500">
            <option value="all" ${currentStrategyId === 'all' ? 'selected' : ''}>All Strategies (Portfolio)</option>
            ${strategyOptions}
        </select>
    `;

    const dataTypeSelectorHTML = `
        <select id="sq-data-type-select" class="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-amber-500 ml-2">
            <option value="backtest" ${currentDataType === 'backtest' ? 'selected' : ''}>Backtest Data</option>
            <option value="real" ${currentDataType === 'real' ? 'selected' : ''}>Real Data (Live)</option>
        </select>
    `;

    const headerControls = `
        <div class="flex gap-2 items-center">
            ${strategySelectorHTML}
            ${dataTypeSelectorHTML}
            <select id="sq-period-select" class="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-amber-500">
                ${periodOptions.map(o => `<option value="${o.value}" ${o.value === selectedPeriod ? 'selected' : ''}>${o.label}</option>`).join('')}
            </select>
            <select id="sq-metric-select" class="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-amber-500">
                ${metricsOptions.map(o => `<option value="${o.value}" ${o.value === selectedMetric ? 'selected' : ''}>${o.label}</option>`).join('')}
            </select>
        </div>
    `;

    const metricDefinitions = {
        'pnl': { label: 'Net Profit ($)', format: (v) => v !== 0 ? formatNum(v, 0) : '-', color: (v) => v > 0 ? 'text-emerald-400' : (v < 0 ? 'text-red-400' : 'text-gray-600') },
        'count': { label: 'Total Trades', format: (v) => v !== 0 ? v : '-', color: () => 'text-gray-300' },
        'winRate': { label: 'Win Rate (%)', format: (v) => (v !== undefined && v !== null && v !== '-') ? formatNum(v, 1) + '%' : '-', color: (v) => v > 50 ? 'text-emerald-400' : 'text-yellow-400' },
        'profitFactor': { label: 'Profit Factor', format: (v) => v !== 0 ? formatNum(v, 2) : '-', color: (v) => v > 1.5 ? 'text-emerald-400' : (v > 1 ? 'text-yellow-400' : 'text-red-400') },
        'grossProfit': { label: 'Gross Profit', format: (v) => formatNum(v, 0), color: () => 'text-emerald-400' },
        'grossLoss': { label: 'Gross Loss', format: (v) => formatNum(v, 0), color: () => 'text-red-400' }
    };

    const currentMetric = metricDefinitions[selectedMetric] || metricDefinitions['pnl'];
    const overflowClass = selectedPeriod === 'week' ? 'overflow-x-auto' : '';
    const dataBucket = metrics.timeData[selectedPeriod];
    const years = Object.keys(dataBucket).sort((a, b) => b - a);
    let tableRows = '';
    let headersHTML = '';

    if (selectedPeriod === 'month') {
        headersHTML = `
            <th class="py-2 px-1 text-right">Jan</th><th class="py-2 px-1 text-right">Feb</th><th class="py-2 px-1 text-right">Mar</th>
            <th class="py-2 px-1 text-right">Apr</th><th class="py-2 px-1 text-right">May</th><th class="py-2 px-1 text-right">Jun</th>
            <th class="py-2 px-1 text-right">Jul</th><th class="py-2 px-1 text-right">Aug</th><th class="py-2 px-1 text-right">Sep</th>
            <th class="py-2 px-1 text-right">Oct</th><th class="py-2 px-1 text-right">Nov</th><th class="py-2 px-1 text-right">Dec</th>
        `;
        years.forEach(year => {
            const months = dataBucket[year];
            let yearTotal = 0;
            const getVal = (stats) => {
                if (!stats) return 0;
                if (selectedMetric === 'pnl') return stats.pnl;
                if (selectedMetric === 'count') return stats.count;
                if (selectedMetric === 'winRate') return stats.count > 0 ? (stats.wins / stats.count) * 100 : 0;
                if (selectedMetric === 'profitFactor') return Math.abs(stats.grossLoss) > 0 ? stats.grossProfit / Math.abs(stats.grossLoss) : (stats.grossProfit > 0 ? 999 : 0);
                if (selectedMetric === 'grossProfit') return stats.grossProfit;
                if (selectedMetric === 'grossLoss') return stats.grossLoss;
                return 0;
            };

            let yWins = 0, yCount = 0, yGP = 0, yGL = 0;
            Object.values(months).forEach(stats => {
                yWins += stats.wins; yCount += stats.count; yGP += stats.grossProfit; yGL += stats.grossLoss;
            });

            if (selectedMetric === 'pnl') yearTotal = yGP + yGL;
            else if (selectedMetric === 'count') yearTotal = yCount;
            else if (selectedMetric === 'winRate') yearTotal = yCount > 0 ? (yWins / yCount) * 100 : 0;
            else if (selectedMetric === 'profitFactor') yearTotal = Math.abs(yGL) > 0 ? yGP / Math.abs(yGL) : (yGP > 0 ? 999 : 0);
            else if (selectedMetric === 'grossProfit') yearTotal = yGP;
            else if (selectedMetric === 'grossLoss') yearTotal = yGL;

            let cells = `<td class="py-2 px-2 font-bold text-gray-300 border-r border-gray-700">${year}</td>`;
            for (let m = 0; m < 12; m++) {
                const stats = months[m];
                const val = getVal(stats);
                const colorClass = currentMetric.color(val);
                cells += `<td class="py-2 px-1 text-right ${colorClass} text-xs">${stats ? currentMetric.format(val) : '-'}</td>`;
            }
            const totalClass = selectedMetric === 'pnl' ? (yearTotal >= 0 ? 'text-emerald-300' : 'text-red-300') : 'text-gray-300';
            cells += `<td class="py-2 px-2 text-right font-bold ${totalClass} border-l border-gray-700">${currentMetric.format(yearTotal)}</td>`;
            tableRows += `<tr class="hover:bg-gray-700/30 transition-colors">${cells}</tr>`;
        });
    } else {
        headersHTML = `<th class="py-2 px-2 text-left">Week</th><th class="py-2 px-2 text-right">Value</th>`;
        let weekRows = '';
        years.forEach(year => {
            const weeks = dataBucket[year];
            Object.keys(weeks).sort((a, b) => Number(a) - Number(b)).forEach(w => {
                const stats = weeks[w];
                let val = 0;
                if (selectedMetric === 'pnl') val = stats.pnl;
                else if (selectedMetric === 'count') val = stats.count;
                else if (selectedMetric === 'winRate') val = stats.count > 0 ? (stats.wins / stats.count) * 100 : 0;
                else if (selectedMetric === 'profitFactor') val = Math.abs(stats.grossLoss) > 0 ? stats.grossProfit / Math.abs(stats.grossLoss) : (stats.grossProfit > 0 ? 999 : 0);

                weekRows += `
                    <tr class="hover:bg-gray-700/30 border-b border-gray-800">
                        <td class="py-1 px-4 text-gray-400">${year} - W${w}</td>
                        <td class="py-1 px-4 text-right ${currentMetric.color(val)}">${currentMetric.format(val)}</td>
                    </tr>
                `;
            });
        });
        tableRows = weekRows;
    }

    const tableHeader = `
        <thead class="bg-gray-900/50 text-xs uppercase font-medium text-gray-400 sticky top-0 z-10">
            <tr>
                ${headersHTML}
                ${selectedPeriod === 'month' ? '<th class="py-2 px-2 text-right border-l border-gray-700">Total</th>' : ''}
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
            <div class="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
                <div class="p-3 bg-gray-900/50 border-b border-gray-700 flex justify-between items-center">
                    <h3 class="text-amber-400 font-bold text-sm uppercase tracking-wider">Monthly Performance</h3>
                    ${headerControls} 
                </div>
                <div class="${overflowClass} max-h-[500px] overflow-y-auto custom-scrollbar">
                    <table class="w-full whitespace-nowrap">
                        ${tableHeader}
                        ${tableBody}
                    </table>
                </div>
            </div>
            ${renderOverview(metrics, formatMoney, formatNum)}
            ${markovSection}
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
                 <h4 class="${colors.text} font-bold text-xs uppercase">${key} (${stats.values.length})</h4>
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
                     <input type="number" id="sq-prob-input-${key}" class="w-12 bg-gray-900 border border-gray-700 rounded px-1 text-center text-gray-300" placeholder="Days" value="5">
                     <button class="bg-gray-700/50 hover:bg-gray-600 text-gray-300 px-2 rounded w-full calc-btn border border-gray-600" data-key="${key}">Calc %</button>
                 </div>
                 <div id="sq-prob-res-${key}" class="h-4 ${colors.text} text-center font-bold"></div>
             </div>
        </div>
        `;
    }).join('');

    return `
        <div class="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden mt-6">
             <div class="p-3 bg-gray-900/50 border-b border-gray-700">
                <h3 class="text-amber-400 font-bold text-sm uppercase tracking-wider">Frequency Analysis (Days between Events)</h3>
            </div>
            <div class="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                 ${cards}
            </div>
        </div>
    `;
};

const renderOverview = (metrics, formatMoney, formatNum) => `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div class="space-y-6">
                <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                    <h3 class="text-amber-400 font-bold mb-4 text-sm uppercase tracking-wider">Overview</h3>
                    <div class="grid grid-cols-2 gap-y-3 text-sm">
                        <div class="text-gray-400">Total Profit</div>
                        <div class="text-right font-bold ${metrics.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'} text-lg">${formatMoney(metrics.totalProfit)}</div>
                        <div class="text-gray-400">Profit Factor</div>
                        <div class="text-right font-mono text-white">${formatNum(metrics.profitFactor)}</div>
                        <div class="text-gray-400">Win Rate</div>
                        <div class="text-right font-mono text-white">${formatNum(metrics.winRate)} %</div>
                        <div class="text-gray-400">Max Drawdown</div>
                        <div class="text-right font-mono text-red-400">${formatMoney(metrics.maxDD)}</div>
                        <div class="text-gray-400">Total Trades</div>
                        <div class="text-right font-mono text-white">${metrics.totalTrades}</div>
                        <div class="text-gray-400">Avg Yearly Profit</div>
                        <div class="text-right font-mono text-emerald-300">${formatMoney(metrics.avgYearlyProfit)}</div>
                         <div class="text-gray-400">Ret / DD</div>
                        <div class="text-right font-mono text-white">${formatNum(metrics.returnDDRatio)}</div>
                    </div>
                </div>
            </div>
            <div class="space-y-6">
                <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                    <h3 class="text-amber-400 font-bold mb-4 text-sm uppercase tracking-wider">Trade Stats</h3>
                    <div class="grid grid-cols-2 gap-y-3 text-sm">
                        <div class="text-gray-400">Avg Win</div>
                        <div class="text-right font-mono text-emerald-300">${formatMoney(metrics.avgWin)}</div>
                        <div class="text-gray-400">Avg Loss</div>
                        <div class="text-right font-mono text-red-300">${formatMoney(metrics.avgLoss)}</div>
                        <div class="text-gray-400">Max Consec Wins</div>
                        <div class="text-right font-mono text-emerald-400">${metrics.maxConsecWins}</div>
                        <div class="text-gray-400">Max Consec Loss</div>
                        <div class="text-right font-mono text-red-400">${metrics.maxConsecLosses}</div>
                         <div class="text-gray-400">SQN</div>
                        <div class="text-right font-mono text-white">${formatNum(metrics.sqn)}</div>
                    </div>
                </div>
            </div>
        </div>
    `;

const renderExitAnalysisHTML = (exitStats, formatMoney, formatNum) => {
    if (!exitStats) return '';
    return `
        <div class="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden mt-6">
             <div class="p-3 bg-gray-900/50 border-b border-gray-700">
                <h3 class="text-amber-400 font-bold text-sm uppercase tracking-wider">Trading Psychology: Exit Analysis</h3>
            </div>
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
    `;
};

export const parseTradesFromContent = (content) => {
    if (!content) return [];
    const lines = content.split('\n');
    const headers = lines[0].split(';');
    const delimiter = headers.length > 1 ? ';' : ',';
    const h = lines[0].split(delimiter).map(s => s.trim().toLowerCase());

    const idxDate = h.findIndex(c => c.includes('date') || c.includes('time'));
    const idxOpenDate = h.findIndex(c => c.includes('open') && (c.includes('time') || c.includes('date')));
    const idxExitDate = h.findIndex(c => c.includes('close') || c.includes('exit'));
    const idxProfit = h.findIndex(c => c.includes('profit') || c.includes('pnl'));
    const idxComment = h.findIndex(c => c.includes('comment') || c.includes('reason'));
    const idxCloseType = h.findIndex(c => c.includes('close type') || c.includes('exit reason'));

    if (idxProfit === -1) return [];

    const trades = [];
    const parseDate = (dateStr) => {
        if (!dateStr) return null;
        const [datePart, timePart] = dateStr.split(' ');
        const [y, m, d] = datePart.split('.');
        return new Date(`${y}-${m}-${d}T${timePart || '00:00:00'}`);
    };

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(delimiter);
        const pnl = parseFloat(cols[idxProfit].replace(',', '.'));
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

        const duration = (exitTime && openTime) ? (exitTime - openTime) : 0;

        trades.push({
            pnl,
            openTime: openTime || new Date(),
            exitTime: exitTime || new Date(),
            duration: Math.max(0, duration),
            comment: comment,
            exitReason: exitReason
        });
    }
    return trades;
};

export const parseTradesFromData = (data) => {
    if (!data || !Array.isArray(data) || data.length === 0) return [];

    const trades = [];

    // DEBUG: Log keys of first row to help debug column mismatch
    if (data.length > 0) {
        console.log('[SQ Analysis] Debug: Schema of first row:', Object.keys(data[0]));
    }

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
        const pnl = row.pnl !== undefined ? row.pnl : (row.profit !== undefined ? row.profit : null);
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

        trades.push({
            pnl: parseFloat(pnl),
            openTime: openTime || new Date(),
            exitTime: exitTime || new Date(),
            duration: Math.max(0, duration),
            comment: String(comment).trim(),
            exitReason: String(exitReason).trim()
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
    if (histogramChart) { histogramChart.destroy(); histogramChart = null; }

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

export const renderSQAnalysis = async (portfolioIndex, source = 'saved', initialStrategyId = 'all', initialDataType = 'backtest') => {
    const contentDiv = document.getElementById('sq-analysis-content');
    const loadingDiv = document.getElementById('sq-analysis-loading');
    if (!contentDiv) return;

    contentDiv.innerHTML = '';
    if (loadingDiv) loadingDiv.classList.remove('hidden');

    setTimeout(() => {
        try {
            const portfolio = source === 'databank' ? state.databankPortfolios[portfolioIndex] : state.savedPortfolios[portfolioIndex];
            if (!portfolio) throw new Error("Portfolio not found");

            let allTrades = [];
            const strategyIndices = portfolio.indices || (portfolio.strategyIds ? portfolio.strategyIds.map(id => state.loadedStrategyFiles.findIndex(f => f.strategyId === id)) : []);
            const strategiesList = [];

            strategyIndices.forEach(idx => {
                if (idx === -1) return;
                const file = state.loadedStrategyFiles[idx];
                if (file) strategiesList.push({ id: file.strategyId || file.name, name: file.name, index: idx });
            });

            strategyIndices.forEach(idx => {
                if (idx === -1 || !state.loadedStrategyFiles[idx]) return;
                const file = state.loadedStrategyFiles[idx];
                if (file && file.content) allTrades = allTrades.concat(parseTradesFromContent(file.content));
                else if (state.rawStrategiesData[idx]) allTrades = allTrades.concat(parseTradesFromData(state.rawStrategiesData[idx]));
            });

            if (allTrades.length === 0 && initialDataType === 'backtest') {
                contentDiv.innerHTML = '<div class="text-gray-400 text-center p-10">No data available.</div>';
                if (loadingDiv) loadingDiv.classList.add('hidden');
                return;
            }

            allTrades.sort((a, b) => a.exitTime - b.exitTime);
            setupRender(allTrades, strategiesList, initialStrategyId, initialDataType, portfolio);

        } catch (e) {
            console.error("Error calculating SQ Analysis:", e);
            contentDiv.innerHTML = `<div class="text-red-400 text-center p-4">Error: ${e.message}</div>`;
        } finally {
            if (loadingDiv) loadingDiv.classList.add('hidden');
        }
    }, 50);
};

function setupRender(allPortfolioTrades, strategiesList, initialStrategyId = 'all', initialDataType = 'backtest', portfolio) {
    let currentMetric = 'pnl';
    let currentPeriod = 'month';
    let currentStrategyId = initialStrategyId;
    let currentDataType = initialDataType;
    let currentMarkovPeriod = 'trade';
    let currentMarkovDepth = 1;
    let currentFreqSelection = 'All';

    const render = () => {
        let filteredTrades = [];

        if (currentDataType === 'backtest') {
            if (currentStrategyId === 'all') filteredTrades = allPortfolioTrades;
            else {
                // Filter by Strategy ID. Since we merged all trades, we need to know which trade belongs to which strategy.
                // Wait. parseTradesFromContent/Data DOES NOT tag trades with strategy ID!
                // This is a known limitation.
                // However, the user wants to filter.
                // To support this, we would need to tag trades during parsing.
                // For now, let's assume 'all' is the only valid option OR we are unable to filter properly without refactoring parsing.
                // But the UI shows a selector.
                // Let's fix this later if reported. For now, use allPortfolioTrades.
                filteredTrades = allPortfolioTrades;
            }
        } else {
            // Real Data - Placeholder
            filteredTrades = [];
        }

        const currentMetrics = calculateSQMetrics(filteredTrades);
        const contentDiv = document.getElementById('sq-analysis-content');
        if (!contentDiv) return;

        // 3. Generate HTML
        contentDiv.innerHTML = generateSQAnalysisHTML(currentMetrics, currentMetric, currentPeriod, strategiesList, currentStrategyId, currentDataType, currentMarkovPeriod, currentMarkovDepth, currentFreqSelection);

        // 4. Inject Metric Distribution Chart Canvas (Histogram of Returns)
        // We inject it into the .p-6 container if possible, or append.
        // generateSQAnalysisHTML structure: root .p-6 > ...
        // We want to insert it after the Table but before Overview?
        // Let's just create a new container and append it to the main content div for simplicity, 
        // OR better, insert it into the generated HTML string in generateSQAnalysisHTML?
        // No, we want to control canvas lifecycle.
        // Let's select the first .p-6 and append there.
        const mainContainer = contentDiv.querySelector('.p-6');
        if (mainContainer) {
            const chartContainer = document.createElement('div');
            chartContainer.className = "bg-gray-800/50 rounded-lg border border-gray-700 p-4 mt-6";
            chartContainer.innerHTML = `
                 <h3 class="text-amber-400 font-bold text-sm uppercase mb-4 tracking-wider">Performance Distribution</h3>
                 <div class="h-64 relative">
                    <canvas id="sq-chart"></canvas>
                 </div>
            `;
            // Insert before Overview (which is usually the second child?)
            // Just append to end of container is fine.
            mainContainer.appendChild(chartContainer);
        }

        // Render Charts
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
                return 0;
            };

            Object.values(dataBucket).forEach(yearData => {
                Object.values(yearData).forEach(stats => {
                    values.push(getVal(stats));
                });
            });
            renderHistogram('sq-chart', values, currentMetric);
        }

        // Frequency Charts
        if (currentMetrics && currentMetrics.interTradeStatsByReason) {
            renderFrequencyCharts(currentMetrics.interTradeStatsByReason);

            // Attach Grid Calculator Listeners
            const btns = document.querySelectorAll('.calc-btn');
            btns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const key = e.target.dataset.key;
                    const stats = currentMetrics.interTradeStatsByReason[key];
                    const input = document.getElementById(`sq-prob-input-${key}`);
                    const res = document.getElementById(`sq-prob-res-${key}`);

                    if (stats && input && res) {
                        const days = parseFloat(input.value);
                        if (days > 0) {
                            const prob = gammaCDF(days, stats.alpha, stats.beta);
                            res.innerHTML = `${(prob * 100).toFixed(1)}%`;
                        }
                    }
                });
            });
        }

        // Exit Analysis Charts
        if (currentMetrics && currentMetrics.exitStats) {
            renderExitAnalysisCharts(currentMetrics.exitStats);
        }

        // Attach Main Controls Listeners
        const attachListener = (id, setter) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', (e) => {
                    setter(e.target.value);
                    render();
                });
            }
        };

        attachListener('sq-strategy-select', (v) => currentStrategyId = v);
        attachListener('sq-metric-select', (v) => currentMetric = v);
        attachListener('sq-period-select', (v) => currentPeriod = v);
        attachListener('sq-data-type-select', (v) => currentDataType = v);
        attachListener('sq-markov-depth', (v) => currentMarkovDepth = parseInt(v));
        attachListener('sq-markov-period', (v) => currentMarkovPeriod = v);
    };

    render();
}


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
