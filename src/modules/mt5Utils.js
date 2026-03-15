/**
 * Shared utility for calculating the first MT5 connection date of a given strategy.
 * Used by both the UI rendering (strategiesTable.js) and search filtering (searchConfig.js)
 * to ensure 100% parity between what the user sees and what gets filtered.
 */

export function getStrategyMT5ConnectionTimestamp(strategyName, strategyId, magicNumberMap, deepScanData) {
    if ((!strategyName && !strategyId) || !magicNumberMap || !deepScanData) return null;
    
    const nameStr = strategyName || '';
    const idStr = strategyId || nameStr;
    const normalizeName = s => (s || '').replace(/\.csv$/i, '').trim().toLowerCase().replace(/\s+/g, ' ');

    // 1. Resolve strategy ID to magic numbers
    const keysForMagic = [
        idStr,
        nameStr,
        normalizeName(nameStr),
        String(nameStr).replace(/\.csv$/i, '').trim()
    ];

    let magics = [];
    keysForMagic.forEach(k => {
        if (k && magicNumberMap[k]) {
            const val = magicNumberMap[k];
            magics = magics.concat(Array.isArray(val) ? val : [val]);
        }
    });

    if (magics.length === 0) return null;

    let earliestDate = Infinity;

    // 2. Scan trades to find the oldest entry
    magics.forEach(magic => {
        const key = String(magic).trim();
        if (key.includes('::')) {
            // Composite format: accountId::magicNumber
            const [targetAccountId, magicNumber] = key.split('::');
            const accountData = deepScanData[targetAccountId];
            if (accountData) {
                const tMap = accountData.tradesById || accountData._tradesById;
                const trades = tMap ? tMap[magicNumber] : null;
                if (trades && Array.isArray(trades)) {
                    trades.forEach(t => {
                        const dateVal = t.openTime || t.entry_date || t.date;
                        if (dateVal) {
                            const ts = new Date(dateVal).getTime();
                            if (!isNaN(ts) && ts < earliestDate) earliestDate = ts;
                        }
                    });
                }
            }
        } else {
            // Legacy format: search all accounts
            Object.values(deepScanData).forEach(accountData => {
                const tMap = accountData.tradesById || accountData._tradesById;
                if (!tMap) return;
                const trades = tMap[key];
                if (trades && Array.isArray(trades)) {
                    trades.forEach(t => {
                        const dateVal = t.openTime || t.entry_date || t.date;
                        if (dateVal) {
                            const ts = new Date(dateVal).getTime();
                            if (!isNaN(ts) && ts < earliestDate) earliestDate = ts;
                        }
                    });
                }
            });
        }
    });

    if (earliestDate === Infinity) return null;
    return earliestDate; // Return timestamp so consumers can format it as needed
}
