
/**
 * Helper to get real trades for a single strategy index using robust mapping.
 */
const getRealTradesForStrategy = (index) => {
    const normalize = s => s.replace(/\.csv$/i, '').trim();
    let allRealTrades = [];

    // 1. Resolve Strategy ID/Name
    let file = state.loadedStrategyFiles[index];
    const strategyOrPortfolio = window.analysisResults[index];
    if (!strategyOrPortfolio) return [];

    const rawName = strategyOrPortfolio.name;
    const normalizedName = normalize(rawName);

    // Fuzzy match if needed
    if (!file || normalize(file.name) !== normalizedName) {
        file = state.loadedStrategyFiles.find(f => normalize(f.name) === normalizedName);
    }

    const sId = file ? (file.strategyId || file.name) : rawName;

    // 2. Lookups
    const mapById = state.magicNumberMap[sId];
    const mapByName = state.magicNumberMap[rawName];
    const mapByNormName = state.magicNumberMap[normalizedName];

    // 3. Priority
    let magicRaw = null;
    if (Array.isArray(mapById) && mapById.length > 0) magicRaw = mapById;
    else if (Array.isArray(mapByNormName) && mapByNormName.length > 0) magicRaw = mapByNormName;
    else if (Array.isArray(mapByName) && mapByName.length > 0) magicRaw = mapByName;
    else magicRaw = mapById || mapByNormName || mapByName;

    if (magicRaw) {
        const magics = Array.isArray(magicRaw) ? magicRaw : (typeof magicRaw === 'string' ? magicRaw.split(',') : [String(magicRaw)]);
        state.savedPortfolios.forEach(p => {
            if (p.realMetrics && p.realMetrics._tradesById) {
                magics.forEach(m => {
                    const found = p.realMetrics._tradesById[m.trim()];
                    if (found) allRealTrades = allRealTrades.concat(found);
                });
            }
        });
    }

    return allRealTrades;
};

/**
 * Audit a portfolio to ensure individual strategy trades sum up to the portfolio total.
 */
const auditPortfolio = (portfolioIndex) => {
    const portfolio = state.savedPortfolios[portfolioIndex];
    if (!portfolio || !portfolio.realMetrics || !portfolio.realMetrics.totalRealTrades) return;

    console.group(`[AUDIT] Portfolio Consistency Check: ${portfolio.name}`);

    let calculatedTotalTrades = 0;
    let calculatedTotalProfit = 0;

    portfolio.indices.forEach(strategyIndex => {
        const trades = getRealTradesForStrategy(strategyIndex);
        calculatedTotalTrades += trades.length;
        calculatedTotalProfit += trades.reduce((sum, t) => sum + (t.profit || 0) + (t.commission || 0) + (t.swap || 0), 0);
    });

    const reportedTotalTrades = portfolio.realMetrics.totalRealTrades;
    const reportedTotalProfit = portfolio.realMetrics.totalRealProfit;

    console.log(`Trades: Calculated ${calculatedTotalTrades} vs Reported ${reportedTotalTrades}`);
    console.log(`Profit: Calculated ${calculatedTotalProfit.toFixed(2)} vs Reported ${reportedTotalProfit.toFixed(2)}`);

    if (calculatedTotalTrades === reportedTotalTrades) {
        console.log(`%c✅ TRADE COUNT MATCH`, 'color: green; font-weight: bold;');
    } else {
        console.error(`❌ TRADE COUNT MISMATCH (Diff: ${reportedTotalTrades - calculatedTotalTrades})`);
        console.warn(`Potential causes: 
         1. Strategy mapping missing for some strategies in portfolio.
         2. Portfolio aggregation logic differs from individual lookup.
         `);
    }

    console.groupEnd();
};

