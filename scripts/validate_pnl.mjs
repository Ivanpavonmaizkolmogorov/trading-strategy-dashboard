import fs from 'fs';
import path from 'path';

// --- Mocks to run frontend code in Node ---
global.window = {};
global.document = {
    createElement: () => ({ style: {} }),
    getElementById: () => null,
};
global.localStorage = { getItem: () => null, setItem: () => null };

// Import our new JS Models
import { TradeSeries } from '../src/models/TradeSeries.js';

const bbddFile = 'BBDD/analisis_estrategias_2026-02-24.json';

try {
    const rawData = fs.readFileSync(path.resolve('./', bbddFile), 'utf8');
    const db = JSON.parse(rawData);

    // Test 3 random strategies
    const testStrats = [db.strategies[0], db.strategies[5], db.strategies[10]].filter(Boolean);

    console.log("==========================================");
    console.log("🧪 RUNNING VALIDATION: BACKEND VS TRADESERIES");
    console.log("==========================================\n");

    let allPassed = true;

    testStrats.forEach((strat, index) => {
        const oldMetrics = strat.metrics;
        const rawTrades = strat.trades;

        // Emulate what State does: initialize TradeSeries
        const series = new TradeSeries(rawTrades);

        console.log(`[Test ${index + 1}] Strategy: ${strat.name}`);
        console.log(`Trades in history: ${rawTrades.length}`);

        const comparisons = [
            { name: "Total Profit ($)", old: oldMetrics.netProfit, new: series.totalProfit },
            { name: "Max Drawdown ($)", old: oldMetrics.maxDrawdownInDollars, new: series.maxDrawdown },
            { name: "Total Trades", old: oldMetrics.totalTrades, new: series.totalTrades },
            { name: "Win Rate (%)", old: oldMetrics.winningPercentage, new: series.winRate },
            { name: "Profit Factor", old: oldMetrics.profitFactor, new: series.profitFactor }
        ];

        let stratPassed = true;

        comparisons.forEach(comp => {
            // JS Float math might have tiny differences, so we check < 0.02 delta
            const diff = Math.abs(comp.old - comp.new);
            const passed = diff < 0.02 || (comp.old === 0 && comp.new === 0);

            if (!passed) stratPassed = false;

            console.log(`  - ${comp.name.padEnd(20)}: Backend = ${Number(comp.old).toFixed(2).padStart(10)} | Frontend = ${Number(comp.new).toFixed(2).padStart(10)} [${passed ? '✅' : '❌'}]`);
            if (!passed) {
                console.log(`      > DIFFERENCE DETECTED: ${diff.toFixed(4)}`);
                // Special edge cases like PF being infinity or different rounding
                if (comp.name === 'Profit Factor' && comp.old >= 99 && comp.new >= 99) {
                    console.log(`      > NOTE: Both are extremely high (probably no losses). Allowing pass.`);
                    stratPassed = true;
                }
            }
        });

        if (!stratPassed) allPassed = false;
        console.log("------------------------------------------\n");
    });

    if (allPassed) {
        console.log("🎉 ALL MATHEMATICAL VALIDATIONS PASSED! The new TradeSeries object is perfectly aligned with the Python Backend.");
    } else {
        console.log("⚠️ SOME VALIDATIONS FAILED. Please review the differences.");
    }

} catch (err) {
    console.error("Error running validation:", err);
}
