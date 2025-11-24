import { state } from '../state.js';
import { dom } from '../dom.js';
import { ALL_METRICS } from '../config.js';
import { formatMetricForDisplay } from '../utils.js';
import { CustomizableTable } from './tableEngine.js';
import { initDatabankFocus } from './databank.js';

// Column definitions
const AVAILABLE_COLUMNS = [
    { id: 'name', label: 'Strategies', minWidth: 200 },
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
];

// Default configuration
const DEFAULT_CONFIG = {
    visibleColumns: ['name', 'sharpeRatio', 'totalProfit', 'maxDrawdown', 'profitFactor'],
    columnWidths: {}
};

// Create table instance
const databankTable = new CustomizableTable({
    id: 'databank',
    storageKey: 'databankTableConfig',
    columns: AVAILABLE_COLUMNS,
    defaultConfig: DEFAULT_CONFIG,
    containerId: 'databank-content',
    buttonLabel: 'Columns',
    modalTitle: 'Configure DataBank Columns',
    onConfigChange: () => {
        if (typeof window.updateDatabankDisplay === 'function') {
            window.updateDatabankDisplay();
        }
    }
});

export const initDatabankTable = () => {
    databankTable.init();
    initDatabankFocus();
};

export const getDatabankTableConfig = () => {
    return databankTable.getConfig();
};
