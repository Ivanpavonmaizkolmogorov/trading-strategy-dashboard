/**
 * brokerUI.js
 * Handles the User Interface for Broker Configuration.
 */

import { loadBrokerConfig, saveBrokerConfig, getSymbolConfig } from './brokerConfig.js';

let modal = null;
let config = null;

export const initBrokerUI = () => {
    // Create Modal HTML if not exists
    if (!document.getElementById('broker-config-modal')) {
        const modalHtml = `
        <div id="broker-config-modal" class="fixed inset-0 bg-gray-900 bg-opacity-95 hidden items-center justify-center z-50 backdrop-blur-sm">
            <div class="bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-gray-700">
                <!-- Header -->
                <div class="flex justify-between items-center p-6 border-b border-gray-700 bg-gray-800/50 rounded-t-xl">
                    <div>
                        <h3 class="text-2xl font-bold text-white">Broker Configuration</h3>
                        <p class="text-sm text-gray-400 mt-1">Define leverage and contract sizes for margin calculation</p>
                    </div>
                    <button id="close-broker-modal-btn" class="text-gray-400 hover:text-white transition-colors p-2 hover:bg-gray-700 rounded-lg">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>

                <!-- Body -->
                <div class="flex-1 overflow-auto p-6 custom-scrollbar">
                    
                    <!-- Global Settings -->
                    <div class="mb-8 p-4 bg-gray-700/30 rounded-lg border border-gray-600">
                        <label class="block text-sm font-medium text-gray-300 mb-2">Default Leverage (1:X)</label>
                        <div class="flex items-center gap-4">
                            <input type="number" id="broker-default-leverage" class="bg-gray-900 border border-gray-600 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-32 p-2.5" placeholder="30" min="1">
                            <span class="text-xs text-gray-500">Used when no specific symbol configuration is found.</span>
                        </div>
                    </div>

                    <!-- Symbol Settings -->
                    <div class="mb-4 flex justify-between items-center">
                        <h4 class="text-lg font-semibold text-white">Symbol Configurations</h4>
                        <button id="add-symbol-config-btn" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition-colors">
                            + Add Symbol
                        </button>
                    </div>

                    <div class="overflow-x-auto rounded-lg border border-gray-700">
                        <table class="w-full text-left text-sm text-gray-400">
                            <thead class="text-xs text-gray-300 uppercase bg-gray-700/50">
                                <tr>
                                    <th class="px-4 py-3">Symbol</th>
                                    <th class="px-4 py-3">Leverage (1:X)</th>
                                    <th class="px-4 py-3">Contract Size</th>
                                    <th class="px-4 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="broker-symbols-table-body" class="divide-y divide-gray-700">
                                <!-- Rows -->
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Footer -->
                <div class="p-4 border-t border-gray-700 bg-gray-800/50 rounded-b-xl flex justify-end gap-3">
                    <button id="cancel-broker-config-btn" class="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors border border-gray-600">
                        Cancel
                    </button>
                    <button id="save-broker-config-btn" class="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors border border-blue-500 shadow-lg shadow-blue-900/20">
                        Save Configuration
                    </button>
                </div>
            </div>
        </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    modal = document.getElementById('broker-config-modal');

    // Event Listeners
    document.getElementById('close-broker-modal-btn').onclick = closeBrokerModal;
    document.getElementById('cancel-broker-config-btn').onclick = closeBrokerModal;
    document.getElementById('save-broker-config-btn').onclick = saveAndClose;
    document.getElementById('add-symbol-config-btn').onclick = addEmptyRow;

    // Add button to main UI (e.g., in Config tab or Header)
    // For now, let's assume we call openBrokerModal() from somewhere.
    // We'll expose it globally.
};

export const openBrokerModal = () => {
    config = loadBrokerConfig();
    renderUI();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

const closeBrokerModal = () => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
};

const renderUI = () => {
    document.getElementById('broker-default-leverage').value = config.defaultLeverage;
    const tbody = document.getElementById('broker-symbols-table-body');
    tbody.innerHTML = '';

    Object.entries(config.symbols).forEach(([symbol, data]) => {
        addSymbolRow(symbol, data.leverage, data.contractSize);
    });
};

const addSymbolRow = (symbol = '', leverage = 30, contractSize = 100000) => {
    const tbody = document.getElementById('broker-symbols-table-body');
    const tr = document.createElement('tr');
    tr.className = 'bg-gray-800 hover:bg-gray-700/50 transition-colors';
    tr.innerHTML = `
        <td class="px-4 py-2">
            <input type="text" value="${symbol}" class="symbol-input bg-gray-900 border border-gray-600 text-white text-sm rounded focus:ring-blue-500 focus:border-blue-500 block w-full p-1.5 uppercase" placeholder="EURUSD">
        </td>
        <td class="px-4 py-2">
            <input type="number" value="${leverage}" class="leverage-input bg-gray-900 border border-gray-600 text-white text-sm rounded focus:ring-blue-500 focus:border-blue-500 block w-full p-1.5" min="1">
        </td>
        <td class="px-4 py-2">
            <input type="number" value="${contractSize}" class="contract-input bg-gray-900 border border-gray-600 text-white text-sm rounded focus:ring-blue-500 focus:border-blue-500 block w-full p-1.5" min="1">
        </td>
        <td class="px-4 py-2 text-right">
            <button class="delete-row-btn text-red-400 hover:text-red-300 p-1">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
        </td>
    `;

    tr.querySelector('.delete-row-btn').onclick = () => tr.remove();
    tbody.appendChild(tr);
};

const addEmptyRow = () => {
    addSymbolRow('', config.defaultLeverage, 100000);
};

const saveAndClose = () => {
    const newConfig = {
        defaultLeverage: parseInt(document.getElementById('broker-default-leverage').value) || 30,
        symbols: {}
    };

    const rows = document.querySelectorAll('#broker-symbols-table-body tr');
    rows.forEach(row => {
        const symbol = row.querySelector('.symbol-input').value.trim().toUpperCase();
        const leverage = parseInt(row.querySelector('.leverage-input').value) || 30;
        const contractSize = parseFloat(row.querySelector('.contract-input').value) || 100000;

        if (symbol) {
            newConfig.symbols[symbol] = { leverage, contractSize };
        }
    });

    saveBrokerConfig(newConfig);
    closeBrokerModal();
    // Optional: Trigger re-analysis if needed
    // window.dispatchEvent(new CustomEvent('brokerConfigUpdated'));
};

// Expose globally
window.openBrokerModal = openBrokerModal;
window.initBrokerUI = initBrokerUI;
