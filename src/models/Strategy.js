import { TradeSeries } from './TradeSeries.js';

/**
 * Strategy.js
 * Represents a single Trading Bot / Strategy.
 * Encapsulates its core identity (Magic Number, Name) and maintains 
 * two completely separate TradeSeries:
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
     */
    constructor(config = {}) {
        // --- Identity ---
        this.id = config.id || `strat_${Date.now()}`;
        this.name = config.name || 'Unnamed Strategy';
        this.magicNumber = config.magicNumber || null;
        this.portfolioId = config.portfolioId || null;

        // --- Performance Data (The Children) ---
        // Backtest/Simulated operations
        this.backtestData = new TradeSeries([]);

        // Real Live operations (fed from MetaApi via get_deals_by_time_range)
        this.liveData = new TradeSeries([]);
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
