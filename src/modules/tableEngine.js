/**
 * Generic CustomizableTable Engine
 * Provides reusable table configuration, column visibility, ordering, and persistence.
 */

export class CustomizableTable {
    constructor(config) {
        this.id = config.id;                          // Unique identifier (e.g., 'strategies')
        this.storageKey = config.storageKey;          // localStorage key
        this.columns = config.columns;                // Column definitions
        this.defaultConfig = config.defaultConfig;    // Default configuration
        this.containerId = config.containerId;        // DOM container ID
        this.onConfigChange = config.onConfigChange;  // Callback after save
        this.buttonLabel = config.buttonLabel || 'Columns';
        this.modalTitle = config.modalTitle || 'Configure Columns';

        this.currentConfig = { ...this.defaultConfig };
    }

    /**
     * Initialize the table: load config and inject controls
     */
    init() {
        // Load config from localStorage
        const savedConfig = localStorage.getItem(this.storageKey);
        if (savedConfig) {
            try {
                this.currentConfig = { ...this.defaultConfig, ...JSON.parse(savedConfig) };
            } catch (e) {
                console.error(`Error parsing ${this.storageKey}:`, e);
            }
        }

        // Inject controls
        this.injectControls();
    }

    /**
     * Inject the "Columns" button into the container
     */
    injectControls() {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        // Check if controls already exist
        const controlsId = `${this.id}-table-controls`;
        if (document.getElementById(controlsId)) return;

        const controlsDiv = document.createElement('div');
        controlsDiv.id = controlsId;
        controlsDiv.className = 'flex justify-end mb-2';
        controlsDiv.innerHTML = `
            <button id="btn-configure-${this.id}-columns" class="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded text-sm flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                ${this.buttonLabel}
            </button>
        `;

        // Insert before the table container
        const tableContainer = container.querySelector('.overflow-x-auto') || container.querySelector('table')?.parentElement;
        if (tableContainer) {
            container.insertBefore(controlsDiv, tableContainer);
        } else {
            container.prepend(controlsDiv);
        }

        document.getElementById(`btn-configure-${this.id}-columns`).addEventListener('click', () => this.openConfigModal());
    }

    /**
     * Open the column configuration modal
     */
    openConfigModal() {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
        modal.id = `${this.id}-column-config-modal`;

        modal.innerHTML = `
            <div class="bg-gray-800 rounded-lg border border-gray-700 p-6 w-[600px] max-w-full max-h-[80vh] overflow-auto">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold text-white">${this.modalTitle}</h3>
                    <button id="close-${this.id}-column-modal" class="text-gray-400 hover:text-white text-2xl">&times;</button>
                </div>
                
                <p class="text-gray-400 text-sm mb-4">Select which columns to display. Drag to reorder.</p>
                
                <!-- Select All / Deselect All -->
                <div class="flex items-center gap-3 bg-gray-700/50 p-3 rounded mb-3 border border-gray-600">
                    <input type="checkbox" id="${this.id}-select-all" class="form-checkbox h-4 w-4 text-blue-500 rounded border-gray-600 bg-gray-700">
                    <label for="${this.id}-select-all" class="text-white font-semibold cursor-pointer">Select All / Deselect All</label>
                </div>
                
                <div class="space-y-2" id="${this.id}-column-list">
                    ${this.columns.map((col, index) => {
            const isVisible = this.currentConfig.visibleColumns.includes(col.id);
            const isLocked = col.alwaysVisible;

            return `
                            <div class="flex items-center gap-3 bg-gray-700 p-3 rounded ${isLocked ? 'opacity-60' : 'cursor-move hover:bg-gray-600'} transition-colors" ${isLocked ? '' : 'draggable="true"'} data-column-id="${col.id}">
                                ${isLocked
                    ? '<svg class="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>'
                    : '<svg class="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>'
                }
                                <input type="checkbox" id="col-${this.id}-${col.id}" ${isVisible || isLocked ? 'checked' : ''} ${isLocked ? 'disabled' : ''} class="form-checkbox h-4 w-4 text-blue-500 rounded border-gray-600 bg-gray-700">
                                <label for="col-${this.id}-${col.id}" class="text-white flex-1 cursor-pointer">${col.label}</label>
                                ${!isLocked ? `
                                <div class="flex gap-1">
                                    <button class="move-up-btn text-gray-400 hover:text-white" data-column-id="${col.id}" ${index === 0 ? 'disabled' : ''}>▲</button>
                                    <button class="move-down-btn text-gray-400 hover:text-white" data-column-id="${col.id}" ${index === this.columns.length - 1 ? 'disabled' : ''}>▼</button>
                                </div>` : ''}
                            </div>
                        `;
        }).join('')}
                </div>
                
                <div class="mt-6 flex justify-end gap-3">
                    <button id="reset-${this.id}-columns-btn" class="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded">Reset to Default</button>
                    <button id="save-${this.id}-columns-btn" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold">Save</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Event listeners
        document.getElementById(`close-${this.id}-column-modal`).onclick = () => modal.remove();
        document.getElementById(`save-${this.id}-columns-btn`).onclick = () => {
            this.saveColumnConfig(modal);
            modal.remove();
        };
        document.getElementById(`reset-${this.id}-columns-btn`).onclick = () => {
            this.resetToDefault();
            modal.remove();
        };

        // Drag and drop
        this.setupDragAndDrop(modal);

        // Select All / Deselect All functionality
        const selectAllCheckbox = document.getElementById(`${this.id}-select-all`);
        const columnCheckboxes = modal.querySelectorAll(`input[type="checkbox"][id^="col-${this.id}-"]:not([disabled])`);

        // Set initial state of select all checkbox
        const updateSelectAllState = () => {
            const allChecked = Array.from(columnCheckboxes).every(cb => cb.checked);
            const someChecked = Array.from(columnCheckboxes).some(cb => cb.checked);
            selectAllCheckbox.checked = allChecked;
            selectAllCheckbox.indeterminate = someChecked && !allChecked;
        };
        updateSelectAllState();

        // Handle select all checkbox click
        selectAllCheckbox.onchange = () => {
            const shouldCheck = selectAllCheckbox.checked;
            columnCheckboxes.forEach(cb => {
                cb.checked = shouldCheck;
            });
        };

        // Update select all state when individual checkboxes change
        columnCheckboxes.forEach(cb => {
            cb.addEventListener('change', updateSelectAllState);
        });

        // Up/Down buttons
        modal.querySelectorAll('.move-up-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                this.moveColumn(modal, btn.dataset.columnId, -1);
            };
        });

        modal.querySelectorAll('.move-down-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                this.moveColumn(modal, btn.dataset.columnId, 1);
            };
        });
    }

    /**
     * Setup drag and drop for column reordering
     */
    setupDragAndDrop(modal) {
        const list = modal.querySelector(`#${this.id}-column-list`);
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
                const afterElement = this.getDragAfterElement(list, e.clientY);
                if (afterElement == null) {
                    list.appendChild(draggedElement);
                } else {
                    list.insertBefore(draggedElement, afterElement);
                }
            };
        });
    }

    /**
     * Get element after which to insert dragged element
     */
    getDragAfterElement(container, y) {
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
    }

    /**
     * Move column up or down
     */
    moveColumn(modal, columnId, direction) {
        const list = modal.querySelector(`#${this.id}-column-list`);
        const items = Array.from(list.children);
        const index = items.findIndex(item => item.dataset.columnId === columnId);

        if (direction === -1 && index > 0) {
            list.insertBefore(items[index], items[index - 1]);
        } else if (direction === 1 && index < items.length - 1) {
            list.insertBefore(items[index + 1], items[index]);
        }
    }

    /**
     * Save column configuration
     */
    saveColumnConfig(modal) {
        const list = modal.querySelector(`#${this.id}-column-list`);
        const items = Array.from(list.children);

        const visibleColumns = [];
        items.forEach(item => {
            const columnId = item.dataset.columnId;
            const checkbox = item.querySelector('input[type="checkbox"]');
            if (checkbox && checkbox.checked) {
                visibleColumns.push(columnId);
            }
        });

        this.currentConfig.visibleColumns = visibleColumns;
        localStorage.setItem(this.storageKey, JSON.stringify(this.currentConfig));

        // Trigger callback
        if (this.onConfigChange) {
            this.onConfigChange();
        }
    }

    /**
     * Reset to default configuration
     */
    resetToDefault() {
        this.currentConfig = { ...this.defaultConfig };
        localStorage.setItem(this.storageKey, JSON.stringify(this.currentConfig));

        // Trigger callback
        if (this.onConfigChange) {
            this.onConfigChange();
        }
    }

    /**
     * Get current configuration
     */
    getConfig() {
        return this.currentConfig;
    }
    /**
     * Update configuration programmatically
     */
    updateConfig(newConfig) {
        this.currentConfig = newConfig;
        localStorage.setItem(this.storageKey, JSON.stringify(this.currentConfig));

        // Trigger callback
        if (this.onConfigChange) {
            this.onConfigChange();
        }
    }
}
