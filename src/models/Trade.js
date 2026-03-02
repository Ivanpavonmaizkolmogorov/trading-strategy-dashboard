/**
 * Trade.js
 * Represents an individual Trade with standardized PnL and Time processing.
 */

export class Trade {
    constructor(data, overrides = {}) {
        this.originalData = data;

        // 1. Time parsing (store as timestamps for fast filtering)
        let dateStr = data.exit_date || data.exitTime || data.closeTime || data.closeDate || data.entry_date;
        if (typeof dateStr === 'string' && dateStr.includes('.')) {
            dateStr = dateStr.replace(/\./g, '-');
        }
        this.exitTime = dateStr ? new Date(dateStr) : null;
        this.exitTimestamp = this.exitTime ? this.exitTime.getTime() : 0;

        let openStr = data.entry_date || data.entryTime || data.openTime || data.openDate;
        if (typeof openStr === 'string' && openStr.includes('.')) {
            openStr = openStr.replace(/\./g, '-');
        }
        this.openTime = openStr ? new Date(openStr) : null;
        this.openTimestamp = this.openTime ? this.openTime.getTime() : 0;

        // 2. Base financials (Standardizing profit, commission, swap into PnL)
        // Some CSVs call it profit, some call it pnl.
        this.profit = parseFloat(data.profit ?? data.pnl ?? 0) || 0;
        this.commission = parseFloat(data.commission ?? 0) || 0;
        this.swap = parseFloat(data.swap ?? 0) || 0;

        // Calculate Base Net PnL securely
        this.baseNetPnL = this.profit + this.commission + this.swap;

        // 3. Applying Manual Overrides from State
        this.applyOverrides(overrides);

        this.exitReason = data.exitReason || data['close type'] || data.comment || '';
        this.magicNumber = data.magic || data.magicNumber || null;
    }

    applyOverrides(overrides = {}) {
        const overrideKey1 = this.originalData.id || this.originalData.ticket;
        const overrideKey2 = this.originalData.strategyId ? `${this.originalData.strategyId}::${this.exitTimestamp}` : null;

        const override = overrides[overrideKey1] || (overrideKey2 ? overrides[overrideKey2] : null);

        this.isNeutralized = override ? !!override.neutralized : false;

        if (override) {
            if (override.realPnL !== undefined && override.realPnL !== null) {
                this.pnl = override.realPnL;
            } else if (override.btPnL !== undefined && override.btPnL !== null) {
                this.pnl = override.btPnL;
            } else {
                this.pnl = this.baseNetPnL;
            }
        } else {
            this.pnl = this.baseNetPnL;
        }

        // If neutralized, PnL is effectively 0 for metrics calculations globally
        if (this.isNeutralized) {
            this.pnl = 0;
        }
    }
}
