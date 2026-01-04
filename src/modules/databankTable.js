import { state } from '../state.js';
import { dom } from '../dom.js';
import { ALL_METRICS } from '../config.js?v=7';
import { formatMetricForDisplay } from '../utils.js';
import { CustomizableTable } from './tableEngine.js';
import { initDatabankFocus } from './databank.js';

// Column definitions
const AVAILABLE_COLUMNS = [
    { id: 'name', label: 'Strategies', minWidth: 200 },
    { id: 'cagr_custom_score', label: 'Optimized Score', minWidth: 100 },
    { id: 'totalTrades', label: 'Trades', minWidth: 80 },
    { id: 'totalProfit', label: 'Net Profit', minWidth: 100 },
    { id: 'returnDD', label: 'Ret/DD', minWidth: 80 },
    { id: 'upi', label: 'UPI', minWidth: 80 },
    { id: 'sortinoRatio', label: 'Sortino', minWidth: 80 },
    { id: 'sharpeRatio', label: 'Sharpe', minWidth: 80 },
    { id: 'sharpeRatioTrade', label: 'Sharpe (Trade)', minWidth: 80 },
    { id: 'maxDrawdownInDollars', label: 'Max DD $', minWidth: 100 },
    { id: 'maxStagnationTrades', label: 'Stag. Trades', minWidth: 100 },
    { id: 'maxStagnationDays', label: 'Stag. Days', minWidth: 100 },
    { id: 'winningPercentage', label: 'Win %', minWidth: 80 },
    { id: 'profitFactor', label: 'Profit Factor', minWidth: 100 },
    { id: 'sqn', label: 'SQN', minWidth: 80 },
    { id: 'maxDrawdown', label: 'Max DD %', minWidth: 100 },
    { id: 'cagr', label: 'CAGR %', minWidth: 80 },
    { id: 'captureRatio', label: 'Capture Ratio', minWidth: 100 },
    { id: 'monthlyAvgProfit', label: 'Monthly Avg', minWidth: 100 },
    { id: 'strategyCount', label: 'Strategies #', minWidth: 80 },
    { id: 'maxMarginRequired', label: 'Max Margin', minWidth: 100 },
    { id: 'gammaFlowScore', label: 'Gamma Flow Score', minWidth: 100 }
];

// Default configuration
const DEFAULT_CONFIG = {
    visibleColumns: ['name', 'gammaFlowScore', 'totalTrades', 'totalProfit', 'returnDD', 'upi', 'sortinoRatio', 'sharpeRatio', 'maxDrawdownInDollars', 'maxMarginRequired', 'maxStagnationTrades', 'maxStagnationDays', 'winningPercentage', 'profitFactor', 'sqn', 'cagr'],
    columnWidths: {}
};

// Create table instance
const databankTable = new CustomizableTable({
    id: 'databank',
    storageKey: 'databankTableConfig_v8', // Bump version to force reset if needed, or just handle gracefully
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

export const ensureColumnVisible = (columnId) => {
    const config = databankTable.getConfig();
    let configChanged = false;

    // Force 'cagr_custom_score' to index 1 (after checkbox/rank) if requested
    if (columnId === 'cagr_custom_score') {
        const currentIndex = config.visibleColumns.indexOf(columnId);
        // We want it at index 1 for "start" (0 might be rank or checkbox depending on implementation, usually name is 0 in config but rendered after rank)
        // In CONFIG: usually ['name', 'col1', ...]
        // If we want it BEFORE name:
        const targetIndex = 0; // Config index 0 means first data column (after fixed checkbox/rank headers)

        if (currentIndex === -1) {
            console.log(`[DataBank] Auto-showing and moving to start: ${columnId}`);
            config.visibleColumns.unshift(columnId);
            configChanged = true;
        } else if (currentIndex !== targetIndex) {
            console.log(`[DataBank] Reordering optimization metric to start (current: ${currentIndex})`);
            config.visibleColumns.splice(currentIndex, 1);
            config.visibleColumns.unshift(columnId);
            configChanged = true;
        }
    } else {
        if (!config.visibleColumns.includes(columnId)) {
            console.log(`[DataBank] Auto-showing column: ${columnId}`);
            config.visibleColumns.push(columnId);
            configChanged = true;
        }
    }

    if (configChanged) {
        databankTable.updateConfig(config);
    } else {
        console.log(`[DataBank] Column already correct: ${columnId}`);
    }
};

export const hideColumn = (columnId) => {
    const config = databankTable.getConfig();
    if (config.visibleColumns.includes(columnId)) {
        console.log(`[DataBank] Auto-hiding column: ${columnId}`);
        config.visibleColumns = config.visibleColumns.filter(c => c !== columnId);
        databankTable.updateConfig(config);
    }
};
