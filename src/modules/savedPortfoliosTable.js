import { state } from '../state.js';
import { ALL_METRICS } from '../config.js';
import { formatMetricForDisplay } from '../utils.js';
import { CustomizableTable } from './tableEngine.js';
import { initSavedPortfoliosFocus } from '../ui.js';

// Column definitions
const AVAILABLE_COLUMNS = [
    { id: 'name', label: 'Portfolio Name', minWidth: 200, alwaysVisible: true },
    { id: 'totalProfit', label: 'Net Profit', minWidth: 100 },
    { id: 'profitFactor', label: 'Profit Factor', minWidth: 100 },
    { id: 'winningPercentage', label: 'Win %', minWidth: 80 },
    { id: 'maxDrawdown', label: 'Max DD %', minWidth: 100 },
    { id: 'maxDrawdownInDollars', label: 'Max DD $', minWidth: 100 },
    { id: 'sharpeRatio', label: 'Sharpe', minWidth: 80 },
    { id: 'sortinoRatio', label: 'Sortino', minWidth: 80 },
    { id: 'sqn', label: 'SQN', minWidth: 80 },
    { id: 'upi', label: 'UPI', minWidth: 80 },
    { id: 'captureRatio', label: 'Capture Ratio', minWidth: 100 },
    { id: 'monthlyAvgProfit', label: 'Monthly Avg', minWidth: 100 },
    { id: 'totalTrades', label: 'Trades', minWidth: 80 },
];

// Default configuration
const DEFAULT_CONFIG = {
    visibleColumns: ['name', 'sharpeRatio', 'totalProfit', 'maxDrawdown', 'profitFactor', 'winningPercentage'],
    columnWidths: {}
};

// Create table instance
const savedPortfoliosTable = new CustomizableTable({
    id: 'saved-portfolios',
    storageKey: 'savedPortfoliosTableConfig',
    columns: AVAILABLE_COLUMNS,
    defaultConfig: DEFAULT_CONFIG,
    containerId: 'saved-portfolios-content',
    buttonLabel: 'Columns',
    modalTitle: 'Configure Saved Portfolios Columns',
    onConfigChange: () => {
        if (typeof window.displaySavedPortfoliosList === 'function') {
            window.displaySavedPortfoliosList();
        }
    }
});

export const initSavedPortfoliosTable = () => {
    savedPortfoliosTable.init();
    initSavedPortfoliosFocus();
};

export const getSavedPortfoliosTableConfig = () => {
    return savedPortfoliosTable.getConfig();
};
