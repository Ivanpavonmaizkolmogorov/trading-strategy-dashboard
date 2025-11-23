import { state } from '../state.js';
import { formatMetricForDisplay } from '../utils.js';

// Default configuration
const DEFAULT_CONFIG = {
    visibleColumns: ['name', 'totalTrades', 'totalProfit', 'profitFactor', 'winningPercentage', 'maxDrawdownInDollars', 'sharpeRatio'],
    columnWidths: {}
};

// Available columns definition
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

let currentConfig = { ...DEFAULT_CONFIG };

export const initStrategiesTable = () => {
    // Load config from localStorage
    const savedConfig = localStorage.getItem('strategiesTableConfig');
    if (savedConfig) {
        try {
            currentConfig = { ...DEFAULT_CONFIG, ...JSON.parse(savedConfig) };
        } catch (e) {
            console.error('Error parsing saved table config', e);
        }
    }

    // Inject "Columns" button if not present
    injectControls();
};

const injectControls = () => {
    const header = document.querySelector('#strategies-content h2'); // Assuming there's a header
    // If we can't find a good place, we might need to modify index.html directly.
    // For now, let's assume we can append to the container above the table.
    const container = document.getElementById('strategies-content');
    if (!container) return;

    // Check if controls already exist
    if (document.getElementById('strategies-table-controls')) return;

    const controlsDiv = document.createElement('div');
    controlsDiv.id = 'strategies-table-controls';
    controlsDiv.className = 'flex justify-end mb-2';
    controlsDiv.innerHTML = `
        <button id="btn-configure-columns" class="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded text-sm flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Columns
        </button>
    `;

    // Insert before the table container (which usually has overflow-auto)
    const tableContainer = container.querySelector('.overflow-x-auto') || container.querySelector('table')?.parentElement;
    if (tableContainer) {
        container.insertBefore(controlsDiv, tableContainer);
    } else {
        container.prepend(controlsDiv);
    }

    document.getElementById('btn-configure-columns').addEventListener('click', openColumnConfigModal);
};

// Sorting state
let sortConfig = {
    column: null,
    direction: 'asc' // or 'desc'
};

// Selection state
const selectedStrategies = new Set();

export const renderStrategiesTable = () => {
    const tableHead = document.querySelector('#strategies-content thead tr');
    const tableBody = document.getElementById('strategies-table-body');
    if (!tableBody || !tableHead) return;

    // 1. Render Headers
    tableHead.innerHTML = '';

    // Checkbox Header
    const thCheckbox = document.createElement('th');
    thCheckbox.className = 'px-4 py-3 w-10 text-left text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10';
    thCheckbox.innerHTML = '<span class="sr-only">Select</span>';
    tableHead.appendChild(thCheckbox);

    currentConfig.visibleColumns.forEach(colId => {
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
            // Ignore if clicking resizer
            if (e.target.classList.contains('cursor-col-resize')) return;

            if (sortConfig.column === colId) {
                sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
            } else {
                sortConfig.column = colId;
                sortConfig.direction = 'desc'; // Default to desc for metrics usually
            }
            renderStrategiesTable();
        });

        // Apply saved width
        if (currentConfig.columnWidths[colId]) {
            th.style.width = currentConfig.columnWidths[colId];
            th.style.minWidth = currentConfig.columnWidths[colId]; // Enforce
        }

        // Resizer handle
        const resizer = document.createElement('div');
        resizer.className = 'absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity';
        resizer.addEventListener('mousedown', initResize);
        th.appendChild(resizer);

        tableHead.appendChild(th);
    });

    // 2. Render Body
    tableBody.innerHTML = '';

    if (!window.analysisResults || window.analysisResults.length === 0) {
        const colSpan = currentConfig.visibleColumns.length + 1;
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
        const colSpan = currentConfig.visibleColumns.length + 1;
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
        // We need the original index to identify the strategy correctly
        // Assuming strategies array order matches window.analysisResults filtered order
        // But for robustness, let's use the strategy object reference or a unique ID if available.
        // For now, we'll use the index in the filtered array as a proxy, but ideally we need a stable ID.
        // Let's assume strategy.name is unique enough for now, or add an ID.
        // Actually, let's find the index in window.analysisResults to be safe.
        const originalIndex = window.analysisResults.indexOf(strategy);

        const metrics = strategy.analysis?.metrics || strategy.analysis || strategy.metrics || {};
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-700/50 transition-colors cursor-pointer border-b border-gray-700 last:border-0';

        // Checkbox Cell
        const tdCheckbox = document.createElement('td');
        tdCheckbox.className = 'px-4 py-3 w-10';
        tdCheckbox.innerHTML = `
            <input type="checkbox" class="form-checkbox h-4 w-4 text-blue-500 rounded border-gray-600 bg-gray-700 focus:ring-offset-gray-800"
                ${selectedStrategies.has(originalIndex) ? 'checked' : ''}>
        `;
        tdCheckbox.querySelector('input').addEventListener('change', (e) => {
            e.stopPropagation(); // Prevent row click
            if (e.target.checked) {
                selectedStrategies.add(originalIndex);
            } else {
                selectedStrategies.delete(originalIndex);
            }
            updateFloatingActionBar();
        });
        // Also toggle on cell click
        tdCheckbox.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT') {
                e.stopPropagation();
                const checkbox = tdCheckbox.querySelector('input');
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            }
        });
        row.appendChild(tdCheckbox);

        currentConfig.visibleColumns.forEach(colId => {
            const td = document.createElement('td');
            td.className = 'px-4 py-3 text-gray-300 truncate';

            // Apply saved width to cells too for consistency
            if (currentConfig.columnWidths[colId]) {
                td.style.width = currentConfig.columnWidths[colId];
                td.style.maxWidth = currentConfig.columnWidths[colId]; // Truncate if too small
            }

            if (colId === 'name') {
                td.className += ' font-medium text-white';
                td.textContent = strategy.name || 'Unknown';
                td.title = strategy.name;
            } else {
                td.className += ' text-right';
                const val = metrics[colId];
                // Color coding for Profit
                if (colId === 'totalProfit' || colId === 'netProfit') {
                    td.className += val >= 0 ? ' text-green-400' : ' text-red-400';
                }
                td.textContent = formatMetricForDisplay(val, colId);
            }
            row.appendChild(td);
        });

        tableBody.appendChild(row);
    });

    updateFloatingActionBar();
};

const updateFloatingActionBar = () => {
    let bar = document.getElementById('squad-builder-bar');

    if (selectedStrategies.size === 0) {
        if (bar) bar.remove();
        return;
    }

    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'squad-builder-bar';
        bar.className = 'fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-4 z-50 animate-bounce-in';
        document.body.appendChild(bar);
    }

    bar.innerHTML = `
        <span class="font-medium">${selectedStrategies.size} Strategy${selectedStrategies.size > 1 ? 's' : ''} Selected</span>
        <div class="h-4 w-px bg-blue-400"></div>
        <button id="btn-find-team" class="font-bold hover:text-blue-200 flex items-center gap-2">
            <span>⚽</span> Find Team
        </button>
        <button id="btn-clear-selection" class="ml-2 text-blue-300 hover:text-white text-sm">
            &times;
        </button>
    `;

    // Re-attach listeners (since innerHTML wipes them)
    bar.querySelector('#btn-find-team').onclick = () => {
        import('./searchConfig.js').then(module => {
            module.openSearchConfigModal(Array.from(selectedStrategies));
        });
    };

    bar.querySelector('#btn-clear-selection').onclick = () => {
        selectedStrategies.clear();
        renderStrategiesTable();
    };
};

const getMetricValue = (strategy, colId) => {
    if (colId === 'name') return strategy.name || '';
    const metrics = strategy.analysis?.metrics || strategy.analysis || strategy.metrics || {};
    return metrics[colId] || 0;
};

// --- Column Configuration Modal ---
const openColumnConfigModal = () => {
    // Determine current order: Visible columns first, then the rest (hidden ones)
    let orderedColumns = [];

    // 1. Add visible columns in their current order
    currentConfig.visibleColumns.forEach(colId => {
        const col = AVAILABLE_COLUMNS.find(c => c.id === colId);
        if (col) orderedColumns.push({ ...col, visible: true });
    });

    // 2. Add remaining columns (hidden)
    AVAILABLE_COLUMNS.forEach(col => {
        if (!currentConfig.visibleColumns.includes(col.id)) {
            orderedColumns.push({ ...col, visible: false });
        }
    });

    // Create modal HTML
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-lg border border-gray-700 p-6 w-96 max-w-full shadow-xl">
            <h3 class="text-xl font-bold text-white mb-4">Configure Columns</h3>
            <p class="text-xs text-gray-400 mb-2">Check to show. Use arrows to reorder.</p>
            <div id="columns-list" class="space-y-2 max-h-96 overflow-y-auto mb-6">
                <!-- Items will be injected here -->
            </div>
            <div class="flex justify-end gap-3">
                <button id="btn-cancel-cols" class="px-4 py-2 text-gray-400 hover:text-white transition-colors">Cancel</button>
                <button id="btn-save-cols" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium transition-colors">Save</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const listContainer = modal.querySelector('#columns-list');

    // Function to render the list items
    const renderList = () => {
        listContainer.innerHTML = orderedColumns.map((col, index) => `
            <div class="flex items-center justify-between bg-gray-700/50 p-2 rounded hover:bg-gray-700 group" data-id="${col.id}">
                <label class="flex items-center space-x-3 cursor-pointer flex-1">
                    <input type="checkbox" value="${col.id}" 
                        ${col.visible ? 'checked' : ''}
                        class="form-checkbox h-5 w-5 text-blue-500 rounded border-gray-600 bg-gray-700 focus:ring-offset-gray-800">
                    <span class="text-gray-300 select-none">${col.label}</span>
                </label>
                <div class="flex gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                    <button class="btn-move-up p-1 hover:text-white text-gray-400" data-index="${index}" title="Move Up">
                        ▲
                    </button>
                    <button class="btn-move-down p-1 hover:text-white text-gray-400" data-index="${index}" title="Move Down">
                        ▼
                    </button>
                </div>
            </div>
        `).join('');

        // Re-attach listeners
        listContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const col = orderedColumns.find(c => c.id === e.target.value);
                if (col) col.visible = e.target.checked;
            });
        });

        listContainer.querySelectorAll('.btn-move-up').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.dataset.index);
                if (index > 0) {
                    // Swap
                    [orderedColumns[index], orderedColumns[index - 1]] = [orderedColumns[index - 1], orderedColumns[index]];
                    renderList();
                }
            });
        });

        listContainer.querySelectorAll('.btn-move-down').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.dataset.index);
                if (index < orderedColumns.length - 1) {
                    // Swap
                    [orderedColumns[index], orderedColumns[index + 1]] = [orderedColumns[index + 1], orderedColumns[index]];
                    renderList();
                }
            });
        });
    };

    renderList();

    // Event Listeners for Modal Buttons
    modal.querySelector('#btn-cancel-cols').onclick = () => modal.remove();
    modal.querySelector('#btn-save-cols').onclick = () => {
        // Construct new visibleColumns array based on the ordered list and visibility status
        const newVisibleColumns = orderedColumns
            .filter(col => col.visible)
            .map(col => col.id);

        currentConfig.visibleColumns = newVisibleColumns;

        saveConfig();
        renderStrategiesTable();
        modal.remove();
    };
};

// --- Resizing Logic ---
let activeResizer = null;
let startX = 0;
let startWidth = 0;
let activeColId = null;

const initResize = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const th = e.target.parentElement;
    activeColId = th.dataset.colId;
    activeResizer = th;
    startX = e.pageX;
    startWidth = th.offsetWidth;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
};

const onMouseMove = (e) => {
    if (!activeResizer) return;
    const diff = e.pageX - startX;
    const newWidth = Math.max(50, startWidth + diff); // Min 50px
    activeResizer.style.width = `${newWidth}px`;
    activeResizer.style.minWidth = `${newWidth}px`;
};

const onMouseUp = (e) => {
    if (activeResizer && activeColId) {
        currentConfig.columnWidths[activeColId] = activeResizer.style.width;
        saveConfig();

        // Re-render to apply width to all cells (not just header)
        renderStrategiesTable();
    }

    activeResizer = null;
    activeColId = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
};

const saveConfig = () => {
    localStorage.setItem('strategiesTableConfig', JSON.stringify(currentConfig));
};
