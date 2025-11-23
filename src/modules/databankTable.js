import { state } from '../state.js';
import { dom } from '../dom.js';
import { ALL_METRICS } from '../config.js';
import { formatMetricForDisplay } from '../utils.js';

// Default configuration for DataBank table
const DEFAULT_CONFIG = {
    visibleColumns: ['name', 'sharpeRatio', 'totalProfit', 'maxDrawdown', 'profitFactor'],
    columnWidths: {}
};

// Core columns (always visible)
const CORE_COLUMNS = [
    { id: 'rank', label: 'Rank', minWidth: 60, alwaysVisible: true },
    { id: 'metricValue', label: '[Dynamic Metric]', minWidth: 100, alwaysVisible: true },
];

// Available additional columns
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

let currentConfig = { ...DEFAULT_CONFIG };

export const initDatabankTable = () => {
    // Load config from localStorage
    const savedConfig = localStorage.getItem('databankTableConfig');
    if (savedConfig) {
        try {
            currentConfig = { ...DEFAULT_CONFIG, ...JSON.parse(savedConfig) };
        } catch (e) {
            console.error('Error parsing saved DataBank table config', e);
        }
    }

    // Inject "Columns" button if not present
    injectControls();
};

const injectControls = () => {
    const container = document.getElementById('databank-content');
    if (!container) return;

    // Check if controls already exist
    if (document.getElementById('databank-table-controls')) return;

    const controlsDiv = document.createElement('div');
    controlsDiv.id = 'databank-table-controls';
    controlsDiv.className = 'flex justify-end mb-2';
    controlsDiv.innerHTML = `
        <button id="btn-configure-databank-columns" class="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded text-sm flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Columns
        </button>
    `;

    // Insert before the table container
    const tableContainer = container.querySelector('.overflow-x-auto') || container.querySelector('table')?.parentElement;
    if (tableContainer) {
        container.insertBefore(controlsDiv, tableContainer);
    } else {
        container.prepend(controlsDiv);
    }

    document.getElementById('btn-configure-databank-columns').addEventListener('click', openColumnConfigModal);
};

const openColumnConfigModal = () => {
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
    modal.id = 'databank-column-config-modal';

    modal.innerHTML = `
        <div class="bg-gray-800 rounded-lg border border-gray-700 p-6 w-[600px] max-w-full max-h-[80vh] overflow-auto">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-white">Configure DataBank Columns</h3>
                <button id="close-databank-column-modal" class="text-gray-400 hover:text-white text-2xl">&times;</button>
            </div>
            
            <p class="text-gray-400 text-sm mb-4">Select which metrics to display in the DataBank table. Drag to reorder.</p>
            
            <div class="space-y-2" id="databank-column-list">
                ${AVAILABLE_COLUMNS.map((col, index) => `
                    <div class="flex items-center gap-3 bg-gray-700 p-3 rounded cursor-move hover:bg-gray-600 transition-colors" draggable="true" data-column-id="${col.id}">
                        <svg class="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
                        </svg>
                        <input type="checkbox" id="col-${col.id}" ${currentConfig.visibleColumns.includes(col.id) ? 'checked' : ''} class="form-checkbox h-4 w-4 text-blue-500 rounded border-gray-600 bg-gray-700">
                        <label for="col-${col.id}" class="text-white flex-1 cursor-pointer">${col.label}</label>
                        <div class="flex gap-1">
                            <button class="move-up-btn text-gray-400 hover:text-white" data-column-id="${col.id}" ${index === 0 ? 'disabled' : ''}>▲</button>
                            <button class="move-down-btn text-gray-400 hover:text-white" data-column-id="${col.id}" ${index === AVAILABLE_COLUMNS.length - 1 ? 'disabled' : ''}>▼</button>
                        </div>
                    </div>
                `).join('')}
            </div>
            
            <div class="mt-6 flex justify-end gap-3">
                <button id="reset-databank-columns-btn" class="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded">Reset to Default</button>
                <button id="save-databank-columns-btn" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold">Save</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Event listeners
    document.getElementById('close-databank-column-modal').onclick = () => modal.remove();
    document.getElementById('save-databank-columns-btn').onclick = () => {
        saveColumnConfig();
        modal.remove();
    };
    document.getElementById('reset-databank-columns-btn').onclick = () => {
        currentConfig = { ...DEFAULT_CONFIG };
        localStorage.setItem('databankTableConfig', JSON.stringify(currentConfig));
        modal.remove();
        // Trigger re-render
        if (typeof window.updateDatabankDisplay === 'function') {
            window.updateDatabankDisplay();
        }
    };

    // Drag and drop
    setupDragAndDrop();

    // Up/Down buttons
    modal.querySelectorAll('.move-up-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const columnId = btn.dataset.columnId;
            const list = document.getElementById('databank-column-list');
            const items = Array.from(list.children);
            const index = items.findIndex(item => item.dataset.columnId === columnId);
            if (index > 0) {
                list.insertBefore(items[index], items[index - 1]);
            }
        };
    });

    modal.querySelectorAll('.move-down-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const columnId = btn.dataset.columnId;
            const list = document.getElementById('databank-column-list');
            const items = Array.from(list.children);
            const index = items.findIndex(item => item.dataset.columnId === columnId);
            if (index < items.length - 1) {
                list.insertBefore(items[index + 1], items[index]);
            }
        };
    });
};

const setupDragAndDrop = () => {
    const list = document.getElementById('databank-column-list');
    let draggedElement = null;

    list.querySelectorAll('[draggable="true"]').forEach(item => {
        item.ondragstart = (e) => {
            draggedElement = item;
            item.classList.add('opacity-50');
        };

        item.ondragend = () => {
            item.classList.remove('opacity-50');
        };

        item.ondragover = (e) => {
            e.preventDefault();
            const afterElement = getDragAfterElement(list, e.clientY);
            if (afterElement == null) {
                list.appendChild(draggedElement);
            } else {
                list.insertBefore(draggedElement, afterElement);
            }
        };
    });
};

const getDragAfterElement = (container, y) => {
    const draggableElements = [...container.querySelectorAll('[draggable="true"]:not(.opacity-50)')];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;

        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
};

const saveColumnConfig = () => {
    const list = document.getElementById('databank-column-list');
    const items = Array.from(list.children);

    const visibleColumns = [];
    items.forEach(item => {
        const columnId = item.dataset.columnId;
        const checkbox = item.querySelector('input[type="checkbox"]');
        if (checkbox && checkbox.checked) {
            visibleColumns.push(columnId);
        }
    });

    currentConfig.visibleColumns = visibleColumns;
    localStorage.setItem('databankTableConfig', JSON.stringify(currentConfig));

    // Trigger re-render
    if (typeof window.updateDatabankDisplay === 'function') {
        window.updateDatabankDisplay();
    }
};

// Export current config getter
export const getDatabankTableConfig = () => currentConfig;
