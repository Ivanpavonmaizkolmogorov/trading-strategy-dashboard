import { TradeSeries } from './TradeSeries.js';

/**
 * Strategy.js
 * Represents a single Trading Bot / Strategy.
 * Encapsulates its core identity (Magic Number, Name), its risk parameters,
 * and maintains two completely separate TradeSeries:
 *   1. backtestData: Historical simulation data (from CSVs, SQX, etc.)
 *   2. liveData: Real trades executed by the bot (fetched from MetaApi via Magic Number)
 */
export class Strategy {
    /**
     * @param {Object} config - Strategy configuration
     * @param {string} config.id - Unique ID of the strategy
     * @param {string} config.name - Display name
     * @param {number|string} config.magicNumber - The MetaTrader Magic Number identifying this bot's trades
     * @param {string} config.portfolioId - ID of the portfolio this strategy belongs to
     * @param {Object} riskParams - Risk Management configuration (IronRisk)
     * @param {number} riskParams.initialBalance - Starting balance assigned to this strategy
     * @param {number} riskParams.maxDailyDrawdownPct - Max allowed daily loss % (e.g. 5 for 5%)
     * @param {number} riskParams.maxTotalDrawdownPct - Max allowed total loss % (e.g. 20 for 20%)
     */
    constructor(config = {}, riskParams = {}) {
        // --- Identity ---
        this.id = config.id || `strat_${Date.now()}`;
        this.name = config.name || 'Unnamed Strategy';
        this.magicNumber = config.magicNumber || null;
        this.portfolioId = config.portfolioId || null;

        // --- IronRisk Parameters ---
        this.initialBalance = riskParams.initialBalance || 10000;
        this.maxDailyDrawdownPct = riskParams.maxDailyDrawdownPct || 5.0; // 5% default panic limit
        this.maxTotalDrawdownPct = riskParams.maxTotalDrawdownPct || 20.0;

        // --- Performance Data (The Children) ---
        // Backtest/Simulated operations
        this.backtestData = new TradeSeries([]);

        // Real Live operations (fed from MetaApi via get_deals_by_time_range)
        this.liveData = new TradeSeries([]);

        // --- State ---
        this.status = 'ACTIVE'; // 'ACTIVE', 'PAUSED', 'STOPPED_BY_RISK'
    }

    /**
     * Feeds simulated/historical trades into the backtest series
     * @param {Array} rawTrades 
     */
    loadBacktestTrades(rawTrades) {
        this.backtestData = new TradeSeries(rawTrades);
    }

    /**
     * Feeds real, live deals fetched from MetaApi into the live series.
     * These should be already filtered by this.magicNumber.
     * @param {Array} realDeals 
     */
    updateLiveDeals(realDeals) {
        this.liveData = new TradeSeries(realDeals);

        // Every time we update live deals, IronRisk checks if we need to panic
        this.checkRiskLimits();
    }

    /**
     * Calculates if the live performance has breached the configured max drawdowns.
     * If so, flags the strategy state to STOPPED_BY_RISK.
     */
    checkRiskLimits() {
        if (this.status === 'STOPPED_BY_RISK') return; // Already stopped

        const coreLiveMetrics = this.liveData._calculateCoreMetrics();

        // 1. Check Total Drawdown
        // Real maxDD in cash format / initialBalance
        const currentTotalDDPct = (coreLiveMetrics.maxDD / this.initialBalance) * 100;
        if (currentTotalDDPct >= this.maxTotalDrawdownPct) {
            this.status = 'STOPPED_BY_RISK';
            console.error(`🚨 IRONRISK PANIC: Strategy ${this.name} breached Total DD limit (${currentTotalDDPct.toFixed(2)}% >= ${this.maxTotalDrawdownPct}%)`);
            return;
        }

        // 2. Check Daily Drawdown (PnL Cerrado Hoy + PnL Flotante si lo pasáramos)
        // Here we could get today's closed PnL using the liveData.dailyPnL object:
        const todayStr = new Date().toISOString().split('T')[0];
        const todayClosedPnL = coreLiveMetrics.dailyPnL[todayStr] || 0;

        // (Assuming we also inject floating PnL somehow, but just checking closed for now):
        const currentDailyDDPct = (Math.abs(Math.min(0, todayClosedPnL)) / this.initialBalance) * 100;

        if (currentDailyDDPct >= this.maxDailyDrawdownPct) {
            this.status = 'STOPPED_BY_RISK';
            console.error(`🚨 IRONRISK PANIC: Strategy ${this.name} breached Daily DD limit (${currentDailyDDPct.toFixed(2)}% >= ${this.maxDailyDrawdownPct}%)`);
        }
    }

    /**
     * Compares live performance vs expected (backtest) performance for Dashboarding
     * @returns {Object} Deviations
     */
    getDeviations() {
        const live = this.liveData._calculateCoreMetrics();
        const bt = this.backtestData._calculateCoreMetrics();

        // Prevent division by zero if backtest has no data yet
        if (!bt.totalTrades) return null;

        return {
            winRateDev: live.winRate - bt.winRate,
            drawdownDev: live.maxDD - bt.maxDD,
            // Is live DD 2x worse than Historical Max DD?
            isDrawdownWorseThanExpected: live.maxDD > (bt.maxDD * 1.5)
        };
    }
}
