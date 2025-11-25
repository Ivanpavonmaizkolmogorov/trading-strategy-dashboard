import { state } from '../state.js';
import { formatMetricForDisplay } from '../utils.js';
import { focusMode } from './focusMode.js';
import { CustomizableTable } from './tableEngine.js';
import { openSearchConfigModal } from './searchConfig.js';

// Column definitions
const AVAILABLE_COLUMNS = [
    { id: 'name', label: 'Strategy Name', minWidth: 200 },
    { id: 'totalTrades', label: 'Trades', minWidth: 80 },
    { id: 'totalProfit', label: 'Net Profit', minWidth: 100 },
    { id: 'profitFactor', label: 'Profit Factor', minWidth: 100 },
    { id: 'winningPercentage', label: 'Win %', minWidth: 80 },
    { id: 'maxDrawdownInDollars', label: 'Max DD $', minWidth: 100 },
    { id: 'maxDrawdown', label: 'Max DD %', minWidth: 100 },
    { id: 'sharpeRatio', label: 'Sharpe', minWidth: 80 },
    { id: 'sqn', label: 'SQN', minWidth: 80 },
    { id: 'upi', label: 'UPI', minWidth: 80 },
    { id: 'cagr', label: 'CAGR %', minWidth: 80 },
    { id: 'avgTrade', label: 'Avg Trade', minWidth: 100 },
    { id: 'returnDD', label: 'Ret/DD', minWidth: 80 }
];

// Default configuration
const DEFAULT_CONFIG = {
    visibleColumns: ['name', 'totalTrades', 'totalProfit', 'profitFactor', 'winningPercentage', 'maxDrawdownInDollars', 'sharpeRatio'],
    columnWidths: {}
};

// Create table instance
const strategiesTable = new CustomizableTable({
    id: 'strategies',
    storageKey: 'strategiesTableConfig',
    columns: AVAILABLE_COLUMNS,
    defaultConfig: DEFAULT_CONFIG,
    containerId: 'strategies-content',
    buttonLabel: 'Columns',
    modalTitle: 'Configure Strategies Columns',
    onConfigChange: () => renderStrategiesTable()
});

// Sorting state
let sortConfig = {
    column: null,
    direction: 'asc'
};

// Selection state
export const selectedStrategies = new Set();

// Floating action bar state
let floatingActionBar = null;

export const initStrategiesTable = () => {
    strategiesTable.init();
};

export const renderStrategiesTable = () => {
    const tableHead = document.querySelector('#strategies-content thead tr');
    const tableBody = document.getElementById('strategies-table-body');
    if (!tableBody || !tableHead) return;

    console.log('[StrategiesTable] Rendering table with', window.analysisResults?.length || 0, 'strategies');

    const config = strategiesTable.getConfig();

    // 1. Render Headers
    tableHead.innerHTML = '';

    // Checkbox Header
    const thCheckbox = document.createElement('th');
    thCheckbox.className = 'px-4 py-3 w-10 text-left text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10';
    thCheckbox.innerHTML = '<span class="sr-only">Select</span>';
    tableHead.appendChild(thCheckbox);

    config.visibleColumns.forEach(colId => {
        const colDef = AVAILABLE_COLUMNS.find(c => c.id === colId);
        if (!colDef) return;

        const th = document.createElement('th');
        th.className = 'px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10 relative group select-none cursor-pointer hover:text-white transition-colors';

        // Sort Indicator
        let label = colDef.label;
        if (sortConfig.column === colId) {
            label += sortConfig.direction === 'asc' ? ' ▲' : ' ▼';
            th.className += ' text-blue-400';
        }
        th.textContent = label;
        th.dataset.colId = colId;

        // Click to sort
        th.addEventListener('click', (e) => {
            if (e.target.classList.contains('cursor-col-resize')) return;

            if (sortConfig.column === colId) {
                sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
            } else {
                sortConfig.column = colId;
                sortConfig.direction = 'desc';
            }
            renderStrategiesTable();
        });

        // Apply saved width OR auto-fit if first time
        if (config.columnWidths[colId]) {
            th.style.width = config.columnWidths[colId];
            th.style.minWidth = config.columnWidths[colId];
        } else {
            // First time: auto-fit after table is rendered
            setTimeout(() => autoFitColumn(th, colId), 0);
        }

        // Resizer handle
        const resizer = document.createElement('div');
        resizer.className = 'absolute right-0 top-0 bottom-0 w-1 cursor-col-resize bg-gray-600 hover:bg-blue-500 transition-colors';
        resizer.addEventListener('mousedown', initResize);
        resizer.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            autoFitColumn(th, colId);
        });
        th.appendChild(resizer);

        tableHead.appendChild(th);
    });

    // 2. Render Body
    tableBody.innerHTML = '';

    if (!window.analysisResults || window.analysisResults.length === 0) {
        const colSpan = config.visibleColumns.length + 1;
        tableBody.innerHTML = `<tr><td colspan="${colSpan}" class="p-4 text-center text-gray-500">No hay resultados de análisis disponibles.</td></tr>`;
        return;
    }

    let strategies = window.analysisResults.filter(r =>
        !r.is_saved_portfolio && !r.is_databank_portfolio && !r.isSavedPortfolio && !r.isPortfolio
    );

    // Update count badge
    const countBadge = document.getElementById('strategies-count');
    if (countBadge) {
        countBadge.textContent = strategies.length;
        countBadge.classList.remove('hidden');
    }

    if (strategies.length === 0) {
        const colSpan = config.visibleColumns.length + 1;
        tableBody.innerHTML = `<tr><td colspan="${colSpan}" class="p-4 text-center text-gray-500">No se encontraron estrategias individuales.</td></tr>`;
        return;
    }

    // Sort strategies
    if (sortConfig.column) {
        strategies.sort((a, b) => {
            const valA = getMetricValue(a, sortConfig.column);
            const valB = getMetricValue(b, sortConfig.column);

            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    strategies.forEach((strategy, index) => {
        const originalIndex = window.analysisResults.indexOf(strategy);
        const metrics = strategy.analysis?.metrics || strategy.analysis || strategy.metrics || {};
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-700/50 transition-colors cursor-pointer border-b border-gray-700 last:border-0';
        row.dataset.originalIndex = originalIndex; // ADD THIS for selectAll() to work

        // Checkbox Cell
        const tdCheckbox = document.createElement('td');
        tdCheckbox.className = 'px-4 py-3 w-10';
        tdCheckbox.innerHTML = `
            <input type="checkbox" class="form-checkbox h-4 w-4 text-blue-500 rounded border-gray-600 bg-gray-700 focus:ring-offset-gray-800"
                ${selectedStrategies.has(originalIndex) ? 'checked' : ''}>
        `;
        tdCheckbox.querySelector('input').addEventListener('change', (e) => {
            e.stopPropagation();
            if (e.target.checked) {
                selectedStrategies.add(originalIndex);
            } else {
                selectedStrategies.delete(originalIndex);
            }
            updateFloatingActionBar();
        });
        tdCheckbox.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT') {
                const checkbox = tdCheckbox.querySelector('input');
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            }
        });
        row.appendChild(tdCheckbox);

        // Data Cells
        config.visibleColumns.forEach(colId => {
            const td = document.createElement('td');
            td.className = 'px-4 py-3 text-gray-300 truncate';

            if (colId === 'name') {
                const fileName = strategy.fileName || strategy.name || 'Unknown';
                td.className += ' font-medium text-white';
                td.textContent = fileName;
                td.title = fileName;
            } else {
                const value = getMetricValue(strategy, colId);
                td.className += ' text-right';
                td.textContent = formatMetricForDisplay(value, colId);

                // Color positive/negative
                if (typeof value === 'number' && !['totalTrades', 'maxStagnationTrades', 'maxStagnationDays', 'maxConsecutiveLosingMonths'].includes(colId)) {
                    td.className += value >= 0 ? ' text-green-400' : ' text-red-400';
                }
            }
            row.appendChild(td);
        });

        // Row click handler
        row.addEventListener('click', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.closest('td').classList.contains('w-10')) {
                return;
            }
            console.log('Strategy clicked:', strategy);
        });

        // Focus Mode Click
        row.addEventListener('click', (e) => {
            // Ignore if clicking on checkbox or actions (if any)
            if (e.target.closest('input[type="checkbox"]') || e.target.closest('button') || e.target.closest('.cursor-col-resize')) return;

            focusMode.enable(strategy, 'strategy', row);
        });

        tableBody.appendChild(row);
    });

    // Update floating action bar visibility
    updateFloatingActionBar();
};

// Helper: Get metric value from strategy object
const getMetricValue = (strategy, metricKey) => {
    const metrics = strategy.analysis?.metrics || strategy.analysis || strategy.metrics || {};
    return metrics[metricKey] ?? (metricKey === 'name' ? strategy.fileName : 0);
};

// Auto-fit column to content
function autoFitColumn(th, colId) {
    const tableBody = document.getElementById('strategies-table-body');
    if (!tableBody) return;

    const rows = tableBody.querySelectorAll('tr');
    let maxWidth = 50; // Minimum width

    // Create temporary element to measure text
    const tempSpan = document.createElement('span');
    tempSpan.style.visibility = 'hidden';
    tempSpan.style.position = 'absolute';
    tempSpan.style.whiteSpace = 'nowrap';
    tempSpan.className = 'px-4 py-3 text-xs'; // Same padding as cells
    document.body.appendChild(tempSpan);

    // Measure header
    tempSpan.textContent = th.textContent;
    maxWidth = Math.max(maxWidth, tempSpan.offsetWidth + 20); // +20 for resizer

    // Measure all cells in this column
    const config = strategiesTable.getConfig();
    const colIndex = config.visibleColumns.indexOf(colId) + 1; // +1 for checkbox column

    rows.forEach(row => {
        const cell = row.children[colIndex];
        if (cell) {
            tempSpan.textContent = cell.textContent;
            maxWidth = Math.max(maxWidth, tempSpan.offsetWidth);
        }
    });

    document.body.removeChild(tempSpan);

    // Apply the width
    const newWidth = maxWidth + 'px';
    th.style.width = newWidth;
    th.style.minWidth = newWidth;

    // Save to config
    const tableConfig = strategiesTable.getConfig();
    tableConfig.columnWidths[colId] = newWidth;
    localStorage.setItem('strategiesTableConfig', JSON.stringify(tableConfig));
}

// Resizer functionality
let resizeData = null;

function initResize(e) {
    resizeData = {
        th: e.target.parentElement,
        startX: e.pageX,
        startWidth: e.target.parentElement.offsetWidth
    };
    document.addEventListener('mousemove', doResize);
    document.addEventListener('mouseup', stopResize);
    e.preventDefault();
}

function doResize(e) {
    if (!resizeData) return;
    const delta = e.pageX - resizeData.startX;
    const newWidth = Math.max(50, resizeData.startWidth + delta);
    resizeData.th.style.width = newWidth + 'px';
    resizeData.th.style.minWidth = newWidth + 'px';
}

function stopResize() {
    if (resizeData) {
        const colId = resizeData.th.dataset.colId;
        const newWidth = resizeData.th.style.width;

        const config = strategiesTable.getConfig();
        config.columnWidths[colId] = newWidth;
        localStorage.setItem('strategiesTableConfig', JSON.stringify(config));

        resizeData = null;
    }
    document.removeEventListener('mousemove', doResize);
    document.removeEventListener('mouseup', stopResize);
}

// Floating Action Bar
export const updateFloatingActionBar = () => {
    const count = selectedStrategies.size;

    if (count === 0) {
        if (floatingActionBar) {
            floatingActionBar.remove();
            floatingActionBar = null;
        }
        return;
    }

    if (!floatingActionBar) {
        floatingActionBar = document.createElement('div');
        floatingActionBar.id = 'strategies-floating-action-bar';
        floatingActionBar.className = 'fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-4 z-50 animate-slide-up';
        document.body.appendChild(floatingActionBar);
    }

    floatingActionBar.innerHTML = `
        <span class="font-bold text-lg">${count} ${count === 1 ? 'strategy' : 'strategies'} selected</span>
        <button id="fab-find-team-btn" class="bg-white text-purple-600 px-4 py-2 rounded-full font-bold hover:bg-gray-100 transition-all flex items-center gap-2">
            <span>⚡</span>
            <span>Find Team</span>
        </button>
        <button id="fab-deselect-all-btn" class="bg-red-500 hover:bg-red-600 px-3 py-2 rounded-full font-bold transition-all">
            Clear
        </button>
    `;

    document.getElementById('fab-find-team-btn').addEventListener('click', () => {
        const selectedIndices = Array.from(selectedStrategies);
        openSearchConfigModal(selectedIndices);
    });

    document.getElementById('fab-deselect-all-btn').addEventListener('click', () => {
        selectedStrategies.clear();
        renderStrategiesTable();
    });
};
