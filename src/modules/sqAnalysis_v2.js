import { state } from '../state.js';

export const calculateSQMetrics = (trades) => {
    if (!trades || trades.length === 0) return null;

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
    let maxDDPercent = 0; // Placeholder, requires equity curve
    let peakEquity = 0;
    let currentEquity = 0;
    let largestWin = 0;
    let largestLoss = 0;

    // Monthly/Weekly Data Cache
    const timeData = {
        month: {},
        week: {}
    };

    trades.forEach(t => {
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

    // CAGR (Simple approx)
    // Assuming initial capital is not known here, we can only calculate % if we knew it.
    // But user asked for "Yearly Avg % Return". Without initial capital, we can't give %.
    // We'll stick to $ for now or use a default base if needed, but better to show N/A or just $.

    // --- Markov Chain Analysis ---
    const markovStats = calculateMarkovChain(trades, timeData);

    return {
        totalProfit, grossProfit, grossLoss, totalTrades, wins, losses,
        winRate, profitFactor, maxDD, avgWin, avgLoss,
        maxConsecWins, maxConsecLosses, expectancy, sqn,
        avgYearlyProfit, avgMonthlyProfit, avgDailyProfit,
        largestWin, largestLoss, returnDDRatio, avgTrade,
        timeData, // { month: { 2023: { 0: stats... } }, week: { ... } }
        markovStats
    };
};

// --- MARKOV HELPER FUNCTIONS ---

const getMarkovSequence = (data, depth = 1) => {
    // Generate sequence of states: 'W' (Win >= 0), 'L' (Loss < 0)
    const states = data.map(val => val >= 0 ? 'W' : 'L');

    const transitions = {};

    // Loop through states to build transitions
    for (let i = depth; i < states.length; i++) {
        // Build previous sequence key, e.g., "W-W"
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

    // Calculate for multiple depths
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

export const generateSQAnalysisHTML = (metrics, selectedMetric = 'pnl', selectedPeriod = 'month', strategiesList = [], currentStrategyId = 'all', currentDataType = 'backtest', markovPeriod = 'trade', markovDepth = 1) => {
    if (!metrics) return '<div class="text-gray-400 text-center p-10">No hay datos suficientes para el análisis.</div>';

    const formatMoney = (val) => val !== undefined && val !== null ? `$ ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-';
    const formatNum = (val, dec = 2) => val !== undefined && val !== null ? val.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '-';

    // Metric Definitions
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

    // Strategy Selector HTML
    const strategyOptions = strategiesList.map(s =>
        `<option value="${s.id}" ${s.id === currentStrategyId ? 'selected' : ''}>${s.name}</option>`
    ).join('');

    const strategySelectorHTML = `
        <select id="sq-strategy-select" class="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-amber-500">
            <option value="all" ${currentStrategyId === 'all' ? 'selected' : ''}>All Strategies (Portfolio)</option>
            ${strategyOptions}
        </select>
    `;

    // Data Type Selector HTML
    // We need currentDataType passed to this function? Yes, but signature might not have it updated in my view.
    // Let's check signature. It was updated in Step 449 to: (metrics, selectedMetric = 'pnl', selectedPeriod = 'month', strategiesList = [], currentStrategyId = 'all', currentDataType = 'backtest')
    // Wait, I need to check if I updated the signature in the file view I just saw.
    // In Step 560 view, line 130 is: export const generateSQAnalysisHTML = (metrics, selectedMetric = 'pnl', selectedPeriod = 'month') => {
    // It seems I reverted the signature change or didn't apply it correctly in the mess of fixes.
    // I need to update the signature AND add the controls.

    const dataTypeSelectorHTML = `
        <select id="sq-datatype-select" class="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-amber-500 ml-2">
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
            <select id="sq-monthly-metric-select" class="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-amber-500">
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

    // For dynamic table width
    const overflowClass = selectedPeriod === 'week' ? 'overflow-x-auto' : '';

    // Generate Table Rows
    const dataBucket = metrics.timeData[selectedPeriod];
    const years = Object.keys(dataBucket).sort((a, b) => b - a); // Descending
    let tableRows = '';

    // Headers
    let headersHTML = '';
    if (selectedPeriod === 'month') {
        headersHTML = `
            <th class="py-2 px-1 text-right">Jan</th><th class="py-2 px-1 text-right">Feb</th><th class="py-2 px-1 text-right">Mar</th>
            <th class="py-2 px-1 text-right">Apr</th><th class="py-2 px-1 text-right">May</th><th class="py-2 px-1 text-right">Jun</th>
            <th class="py-2 px-1 text-right">Jul</th><th class="py-2 px-1 text-right">Aug</th><th class="py-2 px-1 text-right">Sep</th>
            <th class="py-2 px-1 text-right">Oct</th><th class="py-2 px-1 text-right">Nov</th><th class="py-2 px-1 text-right">Dec</th>
        `;
    } else {
        // For weeks, we just show a generic grid or maybe just list weeks? 
        // Showing 52 columns is too much. 
        // StrategyQuant usually shows weeks in a vertical list or a heatmap.
        // Given the constraint of the table format, maybe we just show "Week 1-52" is impossible.
        // Let's stick to a simpler representation for weeks: A list of weeks per year?
        // Or maybe just show the last 52 weeks?
        // The user asked for "por semanas".
        // Let's try to fit 52 weeks? No.
        // Let's render a vertical list for weeks if selected, OR grouped by Quarter?
        // For now, let's keep the Year row but maybe just show Total?
        // Actually, standard SQ view for weeks is usually a long list.
        // Let's implement a scrollable horizontal table for weeks or just 4 quarters?
        // Let's stick to Month for the main view and maybe just warn/disable week for now if it's too complex for this table structure?
        // No, user specifically asked for it.
        // Let's render weeks as rows: Year | Week | Metric.
        headersHTML = `<th class="py-2 px-2 text-left">Week</th><th class="py-2 px-2 text-right">Value</th>`;
    }

    if (selectedPeriod === 'month') {
        years.forEach(year => {
            const months = dataBucket[year];

            // Calculate Year Total
            let yearTotal = 0;
            // Helper to get val
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

            // Aggregate Year Total
            // Note: For ratios like WinRate/PF, we need to aggregate underlying stats first
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
        // Weekly View: Flatten to Year-Week rows
        // This is a different table structure.
        // Let's just show a list of weeks.
        tableRows = `<tr><td colspan="14" class="p-4 text-center text-gray-500">Weekly view is displayed as a list below due to width constraints.</td></tr>`;

        // We will build a separate list for weeks if selected
        // Or we can try to fit 52 weeks in a scrollable div?
        // Let's just render Year | Week | Value for now to be safe.
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

        const tableHeader = `
            <thead class="bg-gray-900/50 text-xs uppercase font-medium text-gray-400 sticky top-0 z-10">
                <tr>
                    ${headersHTML}
                </tr>
            </thead>
        `;

        const tableBody = `
            <tbody class="divide-y divide-gray-800 text-sm">
                ${weekRows}
            </tbody>
        `;

        // Override the main table structure for weeks
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
        </div>
    `;
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
        markovRows = '<tr><td colspan="4" class="p-4 text-center text-gray-500">No data available for this configuration.</td></tr>';
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
                <h3 class="text-amber-400 font-bold text-sm uppercase tracking-wider">Markov Chain Analysis (Win/Loss Probability)</h3>
                ${markovControls}
            </div>
            <div class="max-h-[300px] overflow-y-auto custom-scrollbar">
                <table class="w-full whitespace-nowrap text-sm">
                    <thead class="bg-gray-900/50 text-xs uppercase font-medium text-gray-400 sticky top-0">
                        <tr>
                            <th class="py-2 px-4 text-left">Previous Sequence</th>
                            <th class="py-2 px-4 text-right">Next: WIN Probability</th>
                            <th class="py-2 px-4 text-right">Next: LOSS Probability</th>
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
        </div>
    `;
};

const renderOverview = (metrics, formatMoney, formatNum) => `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Left Column: Overview -->
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
                        
                        <div class="text-gray-400">Max Drawdown $</div>
                        <div class="text-right font-mono text-red-400">${formatMoney(metrics.maxDD)}</div>
                        
                        <div class="text-gray-400">Total Trades</div>
                        <div class="text-right font-mono text-white">${metrics.totalTrades}</div>
                        
                        <div class="text-gray-400">Avg Yearly Profit</div>
                        <div class="text-right font-mono text-emerald-300">${formatMoney(metrics.avgYearlyProfit)}</div>

                        <div class="text-gray-400">Return / DD</div>
                        <div class="text-right font-mono text-white">${formatNum(metrics.returnDDRatio)}</div>
                    </div>
                </div>

                <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                    <h3 class="text-amber-400 font-bold mb-4 text-sm uppercase tracking-wider">Stats & Quality</h3>
                    <div class="grid grid-cols-2 gap-y-3 text-sm">
                        <div class="text-gray-400">SQN Score</div>
                        <div class="text-right font-mono ${metrics.sqn > 2 ? 'text-emerald-400' : 'text-yellow-400'}">${formatNum(metrics.sqn)}</div>
                        
                        <div class="text-gray-400">Expectancy ($)</div>
                        <div class="text-right font-mono ${metrics.expectancy > 0 ? 'text-emerald-400' : 'text-red-400'}">${formatMoney(metrics.expectancy)}</div>
                        
                        <div class="text-gray-400">Avg Trade</div>
                        <div class="text-right font-mono text-white">${formatMoney(metrics.avgTrade)}</div>
                    </div>
                </div>
            </div>

            <!-- Right Column: Trades & Streaks -->
    <div class="space-y-6">
        <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            <h3 class="text-amber-400 font-bold mb-4 text-sm uppercase tracking-wider">Trades Analysis</h3>
            <div class="grid grid-cols-2 gap-y-3 text-sm">
                <div class="text-gray-400">Gross Profit</div>
                <div class="text-right font-mono text-emerald-400">${formatMoney(metrics.grossProfit)}</div>

                <div class="text-gray-400">Gross Loss</div>
                <div class="text-right font-mono text-red-400">${formatMoney(metrics.grossLoss)}</div>

                <div class="text-gray-400">Avg Win</div>
                <div class="text-right font-mono text-emerald-300">${formatMoney(metrics.avgWin)}</div>

                <div class="text-gray-400">Avg Loss</div>
                <div class="text-right font-mono text-red-300">${formatMoney(metrics.avgLoss)}</div>

                <div class="text-gray-400">Largest Win</div>
                <div class="text-right font-mono text-emerald-400">${formatMoney(metrics.largestWin)}</div>

                <div class="text-gray-400">Largest Loss</div>
                <div class="text-right font-mono text-red-400">${formatMoney(metrics.largestLoss)}</div>

                <div class="text-gray-400">Max Consec Wins</div>
                <div class="text-right font-mono text-emerald-400">${metrics.maxConsecWins}</div>

                <div class="text-gray-400">Max Consec Losses</div>
                <div class="text-right font-mono text-red-400">${metrics.maxConsecLosses}</div>
            </div>
        </div>
    </div>
`;

export const parseTradesFromContent = (content) => {
    if (!content) {
        console.warn('[SQ Analysis] No content to parse.');
        return [];
    }
    const lines = content.split('\n');
    const headers = lines[0].split(';');
    const delimiter = headers.length > 1 ? ';' : ',';

    console.log(`[SQ Analysis] Parsing content.Lines: ${lines.length}, Delimiter: '${delimiter}'`);
    console.log(`[SQ Analysis]Headers: ${lines[0]} `);

    const h = lines[0].split(delimiter).map(s => s.trim().toLowerCase());
    const idxDate = h.findIndex(c => c.includes('date') || c.includes('time'));
    const idxExitDate = h.findIndex(c => c.includes('exit') || c.includes('close time'));
    const idxProfit = h.findIndex(c => c.includes('profit') || c.includes('pnl'));

    console.log(`[SQ Analysis]Indices - Date: ${idxDate}, Exit: ${idxExitDate}, Profit: ${idxProfit} `);

    if (idxProfit === -1) {
        console.warn('[SQ Analysis] Profit column not found.');
        return [];
    }

    const trades = [];
    const parseDate = (dateStr) => {
        if (!dateStr) return null;
        const [datePart, timePart] = dateStr.split(' ');
        const [y, m, d] = datePart.split('.');
        return new Date(`${y} -${m} -${d}T${timePart || '00:00:00'} `);
    };

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(delimiter);

        const pnl = parseFloat(cols[idxProfit].replace(',', '.'));
        if (isNaN(pnl)) continue;

        let exitTime = new Date();
        if (idxExitDate !== -1) exitTime = parseDate(cols[idxExitDate]);
        else if (idxDate !== -1) exitTime = parseDate(cols[idxDate]);

        trades.push({
            pnl,
            exitTime: exitTime || new Date()
        });
    }
    console.log(`[SQ Analysis] Parsed ${trades.length} trades.`);
    return trades;
};

export const parseTradesFromData = (data) => {
    if (!data || !Array.isArray(data) || data.length === 0) return [];

    const trades = [];
    const parseDate = (dateInput) => {
        if (!dateInput) return null;

        // If it's already a Date object
        if (dateInput instanceof Date && !isNaN(dateInput.getTime())) return dateInput;

        // If it's a number (timestamp)
        if (typeof dateInput === 'number') return new Date(dateInput);

        const dateStr = String(dateInput).trim();

        // Try standard Date constructor first
        let date = new Date(dateStr);
        if (!isNaN(date.getTime())) return date;

        // Fallback to custom parsing for DD.MM.YYYY or YYYY.MM.DD
        if (dateStr.includes(' ')) {
            const [datePart, timePart] = dateStr.split(' ');
            if (datePart.includes('.')) {
                const parts = datePart.split('.');
                if (parts.length === 3) {
                    // Assume YYYY.MM.DD if first part is 4 digits, else DD.MM.YYYY
                    if (parts[0].length === 4) {
                        return new Date(`${parts[0]} -${parts[1]} -${parts[2]}T${timePart || '00:00:00'} `);
                    } else {
                        return new Date(`${parts[2]} -${parts[1]} -${parts[0]}T${timePart || '00:00:00'} `);
                    }
                }
            }
        }
        return null;
    };

    data.forEach(row => {
        // pnl is normalized by parseCsv
        const pnl = row.pnl !== undefined ? row.pnl : (row.profit !== undefined ? row.profit : null);
        if (pnl === null || isNaN(pnl)) return;

        let exitTime = null;
        // exit_date is normalized by parseCsv
        if (row.exit_date) exitTime = parseDate(row.exit_date);
        else if (row.date) exitTime = parseDate(row.date);
        else if (row.close_time) exitTime = parseDate(row.close_time);

        trades.push({
            pnl: parseFloat(pnl),
            exitTime: exitTime || new Date()
        });
    });

    return trades;
};

// ... existing imports ...

// --- Helper Functions for Histogram ---

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

    // If all values are the same (e.g. 0), handle gracefully
    if (min === max) {
        return {
            labels: [min.toFixed(2)],
            data: [values.length]
        };
    }

    const range = max - min;
    const step = range / binCount;
    const bins = new Array(binCount).fill(0);
    const labels = [];

    for (let i = 0; i < binCount; i++) {
        const start = min + (i * step);
        const end = min + ((i + 1) * step);
        labels.push(`${start.toFixed(0)} to ${end.toFixed(0)} `);
    }

    values.forEach(v => {
        let bucketIndex = Math.floor((v - min) / step);
        if (bucketIndex >= binCount) bucketIndex = binCount - 1; // Catch max value
        bins[bucketIndex]++;
    });

    return { labels, data: bins };
};

let histogramChart = null;

const renderHistogram = (canvasId, values, label, colorFunc) => {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (histogramChart) {
        histogramChart.destroy();
        histogramChart = null;
    }

    const stats = calculateStatistics(values);
    const { labels, data } = calculateHistogramData(values, 15); // 15 bins

    // Chart.js annotation plugin must be registered globally or locally
    // Assuming it's loaded via CDN as requested

    histogramChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Frequency',
                data: data,
                backgroundColor: 'rgba(56, 189, 248, 0.5)', // Sky-400 with opacity
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
                tooltip: {
                    callbacks: {
                        title: (items) => `Range: ${items[0].label} `,
                        label: (item) => `Count: ${item.raw} `
                    }
                },
                annotation: {
                    annotations: {
                        lineMean: {
                            type: 'line',
                            xMin: stats.mean, // This won't work directly on a category axis bar chart easily without mapping value to index
                            // For a simple histogram on category axis, drawing vertical lines at specific *values* is tricky 
                            // because the x-axis is categorical (bins).
                            // Solution: We need to find which bin the value falls into, or use a linear x-axis scatter/bar.
                            // BUT, for simplicity and robustness with Chart.js bar charts, we can approximate the index 
                            // OR just display the stats in the legend/title.
                            // 
                            // BETTER APPROACH for "Density Function" look:
                            // Use a linear X-axis and bar chart where x is the midpoint of the bin.
                            // This allows drawing annotation lines at exact X values.
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(75, 85, 99, 0.2)' },
                    ticks: { color: '#9ca3af' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#9ca3af', maxRotation: 45, minRotation: 45 }
                }
            }
        }
    });

    // RE-IMPLEMENTATION FOR ANNOTATIONS ON CATEGORY AXIS
    // Since mapping exact values to category bins is complex, we will overlay the stats 
    // as a text summary ABOVE the chart for clarity, and try to draw lines if possible.
    // Actually, let's use a "Scatter" chart with bars to simulate histogram on linear axis? 
    // No, that's too complex.
    // Let's stick to the user request: "marca linea vertical".
    // To do this on a category axis, we need to map the value to the bin index.

    // Helper to map value to x-axis index (approximate)
    const mapValueToBinIndex = (val) => {
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min;
        if (range === 0) return 0;
        const step = range / 15;
        let idx = (val - min) / step;
        return Math.min(Math.max(idx, 0), 14.99); // Clamp to 0-14
    };

    const meanIdx = mapValueToBinIndex(stats.mean);
    const medianIdx = mapValueToBinIndex(stats.median);
    const p95Idx = mapValueToBinIndex(stats.p95);
    const zeroIdx = mapValueToBinIndex(0);

    histogramChart.options.plugins.annotation.annotations = {
        zeroLine: {
            type: 'line',
            xMin: zeroIdx,
            xMax: zeroIdx,
            borderColor: 'rgb(156, 163, 175)', // Gray-400
            borderWidth: 2,
            label: {
                display: true,
                content: '0',
                position: 'end',
                yAdjust: -10,
                backgroundColor: 'rgba(107, 114, 128, 0.8)',
                color: 'white',
                font: { size: 10 }
            }
        },
        meanLine: {
            type: 'line',
            xMin: meanIdx,
            xMax: meanIdx,
            borderColor: 'rgb(34, 197, 94)', // Green
            borderWidth: 2,
            borderDash: [6, 6],
            label: {
                display: true,
                content: `Mean: ${stats.mean.toFixed(0)} `,
                position: 'start',
                backgroundColor: 'rgba(34, 197, 94, 0.8)',
                color: 'white',
                font: { size: 10 }
            }
        },
        medianLine: {
            type: 'line',
            xMin: medianIdx,
            xMax: medianIdx,
            borderColor: 'rgb(59, 130, 246)', // Blue
            borderWidth: 2,
            borderDash: [3, 3],
            label: {
                display: true,
                content: `Median: ${stats.median.toFixed(0)} `,
                position: 'end', // Put at bottom/top opposite to mean to avoid overlap?
                yAdjust: 20,
                backgroundColor: 'rgba(59, 130, 246, 0.8)',
                color: 'white',
                font: { size: 10 }
            }
        },
        p95Line: {
            type: 'line',
            xMin: p95Idx,
            xMax: p95Idx,
            borderColor: 'rgb(168, 85, 247)', // Purple
            borderWidth: 2,
            label: {
                display: true,
                content: `95 %: ${stats.p95.toFixed(0)} `,
                position: 'start',
                yAdjust: 40,
                backgroundColor: 'rgba(168, 85, 247, 0.8)',
                color: 'white',
                font: { size: 10 }
            }
        }
    };
    histogramChart.update();
};


export const renderSQAnalysis = async (portfolioIndex, source = 'saved', initialStrategyId = 'all', initialDataType = 'backtest') => {
    console.log('[SQ Analysis v2] Render called', { portfolioIndex, source, initialStrategyId, initialDataType });
    const contentDiv = document.getElementById('sq-analysis-content');
    const loadingDiv = document.getElementById('sq-analysis-loading');

    if (!contentDiv) return;

    contentDiv.innerHTML = '';
    if (loadingDiv) loadingDiv.classList.remove('hidden');

    setTimeout(() => {
        try {
            const portfolio = source === 'databank' ? state.databankPortfolios[portfolioIndex] : state.savedPortfolios[portfolioIndex];
            if (!portfolio) throw new Error("Portfolio not found");

            // 1. Try to use cached metrics first (ONLY for backtest)
            // For Real data, we likely won't cache it on the portfolio object the same way, or we need separate cache.
            // MUST check for markovStats to ensure we have the new data structure, otherwise force recalc.
            if (initialDataType === 'backtest' && portfolio.sqMetrics && portfolio.sqMetrics.timeData && portfolio.sqMetrics.markovStats) {
                console.log('[SQ Analysis] Using cached metrics.');
                setupRender(portfolio.sqMetrics, [], initialStrategyId, initialDataType, portfolio);
                if (loadingDiv) loadingDiv.classList.add('hidden');
                return;
            }

            // 2. Fallback: Calculate from raw files (Backtest) OR Real Data
            let allTrades = [];
            const strategyIndices = portfolio.indices || (portfolio.strategyIds ? portfolio.strategyIds.map(id => state.loadedStrategyFiles.findIndex(f => f.strategyId === id)) : []);

            // Extract Strategy Info for Selector
            const strategiesList = [];
            strategyIndices.forEach(idx => {
                if (idx === -1) return;
                const file = state.loadedStrategyFiles[idx];
                if (file) {
                    strategiesList.push({
                        id: file.strategyId || file.name, // Use ID if available, else name
                        name: file.name,
                        index: idx
                    });
                }
            });

            // Load Backtest Trades
            strategyIndices.forEach(idx => {
                if (idx === -1 || !state.loadedStrategyFiles[idx]) return;
                const file = state.loadedStrategyFiles[idx];
                if (file && file.content) {
                    allTrades = allTrades.concat(parseTradesFromContent(file.content));
                } else if (state.rawStrategiesData[idx]) {
                    allTrades = allTrades.concat(parseTradesFromData(state.rawStrategiesData[idx]));
                }
            });

            if (allTrades.length === 0 && initialDataType === 'backtest') {
                contentDiv.innerHTML = '<div class="text-gray-400 text-center p-10">No data available.</div>';
                if (loadingDiv) loadingDiv.classList.add('hidden');
                return;
            }

            allTrades.sort((a, b) => a.exitTime - b.exitTime);
            const fullPortfolioTrades = allTrades;

            setupRender(fullPortfolioTrades, strategiesList, initialStrategyId, initialDataType, portfolio);

        } catch (e) {
            console.error("Error calculating SQ Analysis:", e);
            contentDiv.innerHTML = `< div class="text-red-400 text-center p-4" > Error: ${e.message}</div > `;
        } finally {
            if (loadingDiv) loadingDiv.classList.add('hidden');
        }
    }, 50);

    function setupRender(allPortfolioTrades, strategiesList, initialStrategyId = 'all', initialDataType = 'backtest', portfolio) {
        let currentMetric = 'pnl';
        let currentPeriod = 'month';
        let currentStrategyId = initialStrategyId;
        let currentDataType = initialDataType; // 'backtest' or 'real'
        let currentMarkovPeriod = 'trade'; // Default
        let currentMarkovDepth = 1; // Default

        const render = () => {
            let filteredTrades = [];

            if (currentDataType === 'backtest') {
                // 1. Filter Backtest Trades
                filteredTrades = allPortfolioTrades;
                if (currentStrategyId !== 'all') {
                    const selectedStrat = strategiesList.find(s => s.id === currentStrategyId);
                    if (selectedStrat) {
                        const file = state.loadedStrategyFiles[selectedStrat.index];
                        if (file && file.content) {
                            filteredTrades = parseTradesFromContent(file.content);
                        } else if (state.rawStrategiesData[selectedStrat.index]) {
                            filteredTrades = parseTradesFromData(state.rawStrategiesData[selectedStrat.index]);
                        }
                        filteredTrades.sort((a, b) => a.exitTime - b.exitTime);
                    } else {
                        filteredTrades = allPortfolioTrades;
                    }
                }
            } else {
                // 2. Fetch Real Trades
                // Logic to extract real trades from portfolio.realMetrics
                // We need to filter by strategy if selected
                if (portfolio.realMetrics && portfolio.realMetrics._tradesById) {
                    let targetMagics = [];

                    if (currentStrategyId === 'all') {
                        // All magics in the portfolio
                        targetMagics = Object.keys(portfolio.realMetrics._tradesById);
                    } else {
                        // Find magics for the selected strategy
                        // We need the magic map
                        const magicRaw = state.magicNumberMap[currentStrategyId] || state.magicNumberMap[strategiesList.find(s => s.id === currentStrategyId)?.name];
                        if (magicRaw) {
                            if (typeof magicRaw === 'string') targetMagics = magicRaw.split(',').map(m => m.trim());
                            else if (Array.isArray(magicRaw)) targetMagics = magicRaw;
                            else targetMagics = [String(magicRaw)];
                        }
                    }

                    targetMagics.forEach(magic => {
                        const trades = portfolio.realMetrics._tradesById[magic];
                        if (trades) {
                            // Map real trades to common format
                            trades.forEach(t => {
                                filteredTrades.push({
                                    pnl: (t.profit || 0) + (t.swap || 0) + (t.commission || 0),
                                    exitTime: new Date(t.closeTime),
                                    grossProfit: t.profit > 0 ? t.profit : 0, // Approx
                                    grossLoss: t.profit < 0 ? t.profit : 0, // Approx
                                    wins: t.profit > 0 ? 1 : 0,
                                    count: 1
                                });
                            });
                        }
                    });
                    filteredTrades.sort((a, b) => a.exitTime - b.exitTime);
                }
            }

            // 2. Recalculate Metrics
            const currentMetrics = calculateSQMetrics(filteredTrades);

            // 3. Generate HTML
            contentDiv.innerHTML = generateSQAnalysisHTML(currentMetrics, currentMetric, currentPeriod, strategiesList, currentStrategyId, currentDataType, currentMarkovPeriod, currentMarkovDepth);

            // 4. Inject Chart Canvas
            const chartContainer = document.createElement('div');
            chartContainer.className = "bg-gray-800/50 rounded-lg border border-gray-700 p-4 mt-6";
            chartContainer.innerHTML = `
    <h3 class="text-amber-400 font-bold text-sm uppercase tracking-wider mb-4">Distribution Analysis (${currentMetric.toUpperCase()})</h3>
        <div class="relative h-64 w-full">
            <canvas id="sq-histogram-chart"></canvas>
        </div>
`;
            contentDiv.querySelector('.p-6').appendChild(chartContainer);

            // 5. Extract Data for Histogram
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

            // 6. Render Chart
            renderHistogram('sq-histogram-chart', values, currentMetric);

            // 7. Re-attach listeners
            const metricSelect = document.getElementById('sq-monthly-metric-select');
            if (metricSelect) {
                metricSelect.addEventListener('change', (e) => {
                    currentMetric = e.target.value;
                    render();
                });
            }

            const periodSelect = document.getElementById('sq-period-select');
            if (periodSelect) {
                periodSelect.addEventListener('change', (e) => {
                    currentPeriod = e.target.value;
                    render();
                });
            }

            const strategySelect = document.getElementById('sq-strategy-select');
            if (strategySelect) {
                strategySelect.addEventListener('change', (e) => {
                    currentStrategyId = e.target.value;
                    render();
                });
            }

            const dataTypeSelect = document.getElementById('sq-datatype-select');
            if (dataTypeSelect) {
                dataTypeSelect.addEventListener('change', (e) => {
                    currentDataType = e.target.value;
                    render();
                });
            }

            const markovDepthSelect = document.getElementById('sq-markov-depth');
            if (markovDepthSelect) {
                markovDepthSelect.addEventListener('change', (e) => {
                    currentMarkovDepth = parseInt(e.target.value);
                    render();
                });
            }

            const markovPeriodSelect = document.getElementById('sq-markov-period');
            if (markovPeriodSelect) {
                markovPeriodSelect.addEventListener('change', (e) => {
                    currentMarkovPeriod = e.target.value;
                    render();
                });
            }
        };

        render();
    }
};
