import { state, saveSavedPortfolios } from '../state.js';
import { showToast } from './notifications.js';
import { displaySavedPortfoliosList } from '../ui.js';

let activePortfolioIndex = null;
let editingAccountId = null;
let lastGlobalRiskValue = 0;

/**
 * Generates the HTML for the Slave Accounts Modal and injects it into the body.
 */
const ensureSlaveAccountsModalExists = () => {
    if (document.getElementById('slave-accounts-modal')) return;

    const modalHTML = `
    <div id="slave-accounts-modal" class="fixed inset-0 bg-gray-900/80 backdrop-blur-sm z-50 hidden flex items-center justify-center opacity-0 transition-opacity duration-300">
        <div class="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col transform scale-95 transition-transform duration-300" id="slave-accounts-modal-content">
            <!-- Header -->
            <div class="flex justify-between items-center p-6 border-b border-gray-700 bg-gray-800/50 rounded-t-xl">
                <div>
                    <h2 class="text-2xl font-bold text-white flex items-center gap-2">
                        <span class="text-sky-400">👥</span> Gestión de Cuentas Esclavas
                    </h2>
                    <p class="text-gray-400 text-sm mt-1" id="slave-accounts-portfolio-name">Portafolio: ...</p>
                </div>
                <button id="close-slave-accounts-modal" class="text-gray-400 hover:text-white transition-colors">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>

            <!-- Body -->
            <div class="flex-1 overflow-hidden flex flex-col md:flex-row">
                <!-- Left: Accounts List -->
                <div class="flex-1 p-6 overflow-y-auto border-r border-gray-700">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-semibold text-white">Cuentas Vinculadas</h3>
                        <button id="btn-new-slave-account" class="bg-sky-600 hover:bg-sky-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1">
                            <span>+</span> Nueva Cuenta
                        </button>
                    </div>
                    <div id="slave-accounts-list" class="space-y-3">
                        <!-- List items will be injected here -->
                        <div class="text-center text-gray-500 py-8">No hay cuentas esclavas configuradas.</div>
                    </div>
                </div>

                <!-- Right: Edit Form -->
                <div class="w-full md:w-96 p-6 bg-gray-900/30 flex flex-col border-l border-gray-700 hidden overflow-y-auto" id="slave-account-form-container">
                    <h3 class="text-lg font-semibold text-white mb-4" id="slave-account-form-title">Añadir Cuenta</h3>
                    
                    <form id="slave-account-form" class="space-y-4">
                        <!-- Name -->
                        <div>
                            <label class="block text-xs font-medium text-gray-400 mb-1">Nombre de la Cuenta</label>
                            <input type="text" id="sa-name" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-sky-500" placeholder="Ej: Hermano 1" required>
                        </div>

                        <!-- Risk Settings -->
                        <div class="bg-gray-800/50 p-3 rounded-lg border border-gray-700/50">
                            <label class="block text-xs font-medium text-sky-400 mb-2 uppercase tracking-wide">Gestión de Riesgo Global</label>
                            
                            <div class="mb-3">
                                <label class="block text-xs text-gray-400 mb-1">Tipo de Riesgo</label>
                                <select id="sa-risk-type" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-sky-500">
                                    <option value="risk_per_op" selected>Riesgo por Op. (Cash/Points)</option>
                                    <option value="fixed_lot">Lotaje Fijo (Fixed Lot)</option>
                                    <option value="risk_percent">% de Riesgo (Risk %)</option>
                                    <option value="multiplier">Multiplicador (Multiplier)</option>
                                </select>
                            </div>

                            <div class="mb-4">
                                <label class="block text-xs text-gray-400 mb-1">Valor Base (Aplica a todas)</label>
                                <div class="flex items-center gap-3">
                                    <input type="number" id="sa-risk-value" step="0.01" class="w-24 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-sky-500 text-center font-bold" placeholder="0.01" required>
                                    <input type="range" id="sa-risk-slider" class="flex-1 h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-sky-500">
                                </div>
                                <p class="text-[10px] text-gray-500 mt-1" id="sa-risk-help">Ej: 100 = 100 USD/EUR por operación</p>
                            </div>
                        </div>

                        <!-- Per-Strategy Risk -->
                        <div class="bg-gray-800/50 p-3 rounded-lg border border-gray-700/50">
                            <label class="block text-xs font-medium text-emerald-400 mb-2 uppercase tracking-wide">Riesgo por Estrategia</label>
                            <div id="sa-strategies-container" class="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                                <!-- Strategy inputs generated here -->
                                <p class="text-xs text-gray-500 italic">Cargando estrategias...</p>
                            </div>
                        </div>

                        <!-- Optional Credentials -->
                        <div class="bg-gray-800/50 p-3 rounded-lg border border-gray-700/50">
                            <label class="block text-xs font-medium text-amber-400 mb-2 uppercase tracking-wide">Credenciales (Opcional)</label>
                            
                            <div class="mb-3">
                                <label class="block text-xs text-gray-400 mb-1">Número de Cuenta</label>
                                <input type="text" id="sa-account-number" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-sky-500" placeholder="12345678">
                            </div>

                            <div class="mb-3">
                                <label class="block text-xs text-gray-400 mb-1">Contraseña Maestra</label>
                                <input type="password" id="sa-password-master" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-sky-500" placeholder="••••••••">
                            </div>

                            <div class="mb-3">
                                <label class="block text-xs text-gray-400 mb-1">Contraseña Inversor</label>
                                <input type="password" id="sa-password-investor" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-sky-500" placeholder="••••••••">
                            </div>

                            <div>
                                <label class="block text-xs text-gray-400 mb-1">Servidor Broker</label>
                                <input type="text" id="sa-broker-server" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-sky-500" placeholder="Ej: ICMarkets-Demo">
                            </div>
                        </div>

                        <!-- Actions -->
                        <div class="flex gap-2 pt-2">
                            <button type="button" id="btn-cancel-slave-account" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg text-sm transition-colors">Cancelar</button>
                            <button type="submit" class="flex-1 bg-sky-600 hover:bg-sky-500 text-white py-2 rounded-lg text-sm font-bold transition-colors">Guardar</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Initialize Event Listeners for the modal
    initSlaveAccountsModalEvents();
};

/**
 * Initializes event listeners for the modal elements.
 */
const initSlaveAccountsModalEvents = () => {
    const modal = document.getElementById('slave-accounts-modal');
    const closeBtn = document.getElementById('close-slave-accounts-modal');
    const newBtn = document.getElementById('btn-new-slave-account');
    const cancelBtn = document.getElementById('btn-cancel-slave-account');
    const form = document.getElementById('slave-account-form');
    const riskTypeSelect = document.getElementById('sa-risk-type');
    const riskValueInput = document.getElementById('sa-risk-value');
    const riskSlider = document.getElementById('sa-risk-slider');

    // Close Modal
    const closeModal = () => {
        modal.classList.add('opacity-0');
        modal.querySelector('#slave-accounts-modal-content').classList.add('scale-95');
        setTimeout(() => {
            modal.classList.add('hidden');
            resetForm();
        }, 300);
    };

    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // New Account Button
    newBtn.addEventListener('click', () => {
        resetForm();
        document.getElementById('slave-account-form-container').classList.remove('hidden');
        document.getElementById('slave-account-form-title').textContent = 'Añadir Cuenta';
        document.getElementById('sa-name').focus();
        // Trigger change to set initial slider range
        riskTypeSelect.dispatchEvent(new Event('change'));
    });

    // Cancel Button
    cancelBtn.addEventListener('click', () => {
        document.getElementById('slave-account-form-container').classList.add('hidden');
        resetForm();
    });

    // Risk Type Change (Update Help Text & Slider Range)
    riskTypeSelect.addEventListener('change', () => {
        const helpText = document.getElementById('sa-risk-help');
        const val = riskTypeSelect.value;

        if (val === 'fixed_lot') {
            helpText.textContent = 'Ej: 0.01 lotes por operación';
            riskSlider.min = 0.01; riskSlider.max = 1.0; riskSlider.step = 0.01;
            if (!riskValueInput.value) riskValueInput.value = 0.01;
        } else if (val === 'risk_percent') {
            helpText.textContent = 'Ej: 1.0 = 1% del balance por operación';
            riskSlider.min = 0.1; riskSlider.max = 5.0; riskSlider.step = 0.1;
            if (!riskValueInput.value) riskValueInput.value = 1.0;
        } else if (val === 'multiplier') {
            helpText.textContent = 'Ej: 1.0 = Mismo tamaño que original, 0.5 = Mitad';
            riskSlider.min = 0.1; riskSlider.max = 5.0; riskSlider.step = 0.1;
            if (!riskValueInput.value) riskValueInput.value = 1.0;
        } else if (val === 'risk_per_op') {
            helpText.textContent = 'Ej: 100 = 100 USD/EUR por operación';
            riskSlider.min = 10; riskSlider.max = 500; riskSlider.step = 10;
            if (!riskValueInput.value) riskValueInput.value = 100;
        }

        // Sync slider to input if value is within range
        riskSlider.value = riskValueInput.value;
        lastGlobalRiskValue = parseFloat(riskValueInput.value) || 0; // Initialize baseline
    });

    // Sync Input -> Slider
    riskValueInput.addEventListener('input', () => {
        riskSlider.value = riskValueInput.value;
    });

    // Sync Slider -> Input & Strategies (Proportional)
    const syncStrategiesProportionally = (newValue) => {
        const currentGlobal = parseFloat(newValue);
        if (isNaN(currentGlobal)) return;

        // Calculate ratio
        let ratio = 1;
        if (lastGlobalRiskValue !== 0) {
            ratio = currentGlobal / lastGlobalRiskValue;
        }

        // Apply to strategies
        document.querySelectorAll('.sa-strategy-risk-input').forEach(input => {
            const currentStratVal = parseFloat(input.value) || 0;
            let newStratVal;

            if (lastGlobalRiskValue === 0) {
                // Fallback: If starting from 0, just overwrite (or add difference?)
                // Overwriting is safer for 0 -> N transition
                newStratVal = currentGlobal;
            } else {
                newStratVal = currentStratVal * ratio;
            }

            // Round to 2 decimals to avoid floating point mess
            input.value = Math.round(newStratVal * 100) / 100;
        });

        lastGlobalRiskValue = currentGlobal;
    };

    riskSlider.addEventListener('input', () => {
        riskValueInput.value = riskSlider.value;
        syncStrategiesProportionally(riskSlider.value);
    });

    riskValueInput.addEventListener('change', () => { // Use change for manual input to avoid jumpiness
        riskSlider.value = riskValueInput.value;
        syncStrategiesProportionally(riskValueInput.value);
    });

    // Form Submit
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        saveSlaveAccount();
    });
};

/**
 * Resets the form to default state.
 */
const resetForm = () => {
    const form = document.getElementById('slave-account-form');
    form.reset();
    editingAccountId = null;
    document.getElementById('sa-risk-help').textContent = 'Ej: 100 = 100 USD/EUR por operación';
    document.getElementById('sa-risk-type').value = 'risk_per_op';
    // Reset strategy inputs
    document.querySelectorAll('.sa-strategy-risk-input').forEach(input => input.value = '');
};

/**
 * Opens the Slave Accounts Modal for a specific portfolio.
 * @param {number} portfolioIndex - Index of the portfolio in state.savedPortfolios.
 */
export const openSlaveAccountsModal = (portfolioIndex) => {
    console.log('[SlaveAccounts] openSlaveAccountsModal called for index:', portfolioIndex);
    ensureSlaveAccountsModalExists();
    activePortfolioIndex = portfolioIndex;

    const portfolio = state.savedPortfolios[portfolioIndex];
    if (!portfolio) return;

    // Update Header
    document.getElementById('slave-accounts-portfolio-name').textContent = `Portafolio: ${portfolio.name}`;

    // Render List
    renderSlaveAccountsList();

    // Populate Strategy Risk Inputs (New Logic)
    populateStrategyRiskInputs(portfolio);

    // Initialize baseline for proportional adjustment
    lastGlobalRiskValue = 0; // Default for new account

    // Show Modal
    const modal = document.getElementById('slave-accounts-modal');
    modal.classList.remove('hidden');
    // Trigger reflow
    void modal.offsetWidth;
    modal.classList.remove('opacity-0');
    modal.querySelector('#slave-accounts-modal-content').classList.remove('scale-95');

    // Hide form initially
    document.getElementById('slave-account-form-container').classList.add('hidden');
};

/**
 * Populates the per-strategy risk inputs based on the portfolio's strategies.
 */
const populateStrategyRiskInputs = (portfolio) => {
    const container = document.getElementById('sa-strategies-container');
    container.innerHTML = '';

    // Determine strategies
    let strategies = [];
    if (portfolio.strategyIds && portfolio.strategyIds.length > 0) {
        // Map IDs to names using loaded files
        strategies = portfolio.strategyIds.map(id => {
            const file = state.loadedStrategyFiles.find(f => f.strategyId === id);
            return { id: id, name: file ? file.name.replace('.csv', '') : `Strategy ${id}` };
        });
    } else if (portfolio.indices) {
        // Fallback to indices
        strategies = portfolio.indices.map(index => {
            const file = state.loadedStrategyFiles[index];
            return { id: file ? file.strategyId : `idx-${index}`, name: file ? file.name.replace('.csv', '') : `Strategy ${index}` };
        });
    }

    if (strategies.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-500 italic">No se encontraron estrategias en este portafolio.</p>';
        return;
    }

    strategies.forEach(strat => {
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between bg-gray-700/30 p-2 rounded border border-gray-600/30';
        div.innerHTML = `
            <span class="text-xs text-gray-300 truncate w-32" title="${strat.name}">${strat.name}</span>
            <div class="flex items-center gap-2">
                <input type="number" step="1" data-strategy-id="${strat.id}" class="sa-strategy-risk-input w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white text-right focus:outline-none focus:border-sky-500" placeholder="Default">
            </div>
        `;
        container.appendChild(div);
    });
};

/**
 * Renders the list of slave accounts in the modal.
 */
const renderSlaveAccountsList = () => {
    const portfolio = state.savedPortfolios[activePortfolioIndex];
    const listContainer = document.getElementById('slave-accounts-list');

    if (!portfolio.slaveAccounts || portfolio.slaveAccounts.length === 0) {
        listContainer.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-gray-500">
                <svg class="w-12 h-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                <p>No hay cuentas esclavas configuradas</p>
                <p class="text-xs mt-1">Añade una para empezar a copiar operaciones</p>
            </div>`;
        return;
    }

    listContainer.innerHTML = '';
    portfolio.slaveAccounts.forEach(account => {
        const item = document.createElement('div');
        item.className = 'bg-gray-700/50 border border-gray-600 rounded-lg p-4 hover:bg-gray-700 transition-colors group';

        let riskLabel = '';
        let riskColor = 'text-gray-400';
        if (account.riskType === 'fixed_lot') { riskLabel = `${account.riskValue} Lots`; riskColor = 'text-sky-400'; }
        else if (account.riskType === 'risk_percent') { riskLabel = `${account.riskValue}% Risk`; riskColor = 'text-purple-400'; }
        else if (account.riskType === 'multiplier') { riskLabel = `${account.riskValue}x Multiplier`; riskColor = 'text-emerald-400'; }
        else if (account.riskType === 'risk_per_op') { riskLabel = `${account.riskValue} / Op`; riskColor = 'text-amber-400'; }

        item.innerHTML = `
            <div class="flex justify-between items-start">
                <div>
                    <h4 class="font-bold text-white text-lg">${account.name}</h4>
                    <div class="flex items-center gap-2 mt-1">
                        <span class="text-xs font-mono bg-gray-800 px-2 py-0.5 rounded border border-gray-600 ${riskColor}">${riskLabel}</span>
                        ${account.accountNumber ? `<span class="text-xs text-gray-400 flex items-center gap-1">🆔 ${account.accountNumber}</span>` : ''}
                    </div>
                    ${account.brokerServer ? `<p class="text-xs text-gray-500 mt-1">📡 ${account.brokerServer}</p>` : ''}
                </div>
                <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button class="btn-edit-account text-gray-400 hover:text-white p-1" title="Editar">✏️</button>
                    <button class="btn-delete-account text-red-500 hover:text-red-400 p-1" title="Eliminar">🗑️</button>
                </div>
            </div>
        `;

        // Edit Action
        item.querySelector('.btn-edit-account').addEventListener('click', () => editSlaveAccount(account.id));

        // Delete Action
        item.querySelector('.btn-delete-account').addEventListener('click', () => deleteSlaveAccount(account.id));

        listContainer.appendChild(item);
    });
};

/**
 * Saves (Adds or Updates) a slave account.
 */
const saveSlaveAccount = () => {
    const name = document.getElementById('sa-name').value;
    const riskType = document.getElementById('sa-risk-type').value;
    const riskValue = parseFloat(document.getElementById('sa-risk-value').value);
    const accountNumber = document.getElementById('sa-account-number').value;
    const masterPassword = document.getElementById('sa-password-master').value;
    const investorPassword = document.getElementById('sa-password-investor').value;
    const brokerServer = document.getElementById('sa-broker-server').value;

    if (!name || isNaN(riskValue)) {
        showToast('Por favor completa los campos requeridos', 'error');
        return;
    }

    // Collect per-strategy risk
    const strategiesRisk = {};
    document.querySelectorAll('.sa-strategy-risk-input').forEach(input => {
        const id = input.dataset.strategyId;
        const val = parseFloat(input.value);
        if (!isNaN(val)) {
            strategiesRisk[id] = val;
        }
    });

    const portfolio = state.savedPortfolios[activePortfolioIndex];
    if (!portfolio.slaveAccounts) portfolio.slaveAccounts = [];

    const accountData = {
        id: editingAccountId || Date.now().toString(),
        name,
        riskType,
        riskValue,
        strategiesRisk, // <--- Save specific risks
        accountNumber,
        masterPassword,
        investorPassword,
        brokerServer,
        isEnabled: true
    };

    if (editingAccountId) {
        // Update
        const index = portfolio.slaveAccounts.findIndex(a => a.id === editingAccountId);
        if (index !== -1) {
            portfolio.slaveAccounts[index] = accountData;
            showToast('Cuenta actualizada', 'success');
        }
    } else {
        // Add
        portfolio.slaveAccounts.push(accountData);
        showToast('Cuenta añadida', 'success');
    }

    // Persist
    saveSavedPortfolios();

    // Refresh UI
    renderSlaveAccountsList();
    document.getElementById('slave-account-form-container').classList.add('hidden');
    resetForm();

    // Refresh Main Table (to show indicator if we add one later)
    displaySavedPortfoliosList();
};

/**
 * Prepares the form for editing an account.
 */
const editSlaveAccount = (accountId) => {
    const portfolio = state.savedPortfolios[activePortfolioIndex];
    const account = portfolio.slaveAccounts.find(a => a.id === accountId);
    if (!account) return;

    editingAccountId = accountId;

    document.getElementById('sa-name').value = account.name;
    document.getElementById('sa-risk-type').value = account.riskType;
    document.getElementById('sa-risk-value').value = account.riskValue;
    document.getElementById('sa-account-number').value = account.accountNumber || '';
    document.getElementById('sa-password-master').value = account.masterPassword || '';
    document.getElementById('sa-password-investor').value = account.investorPassword || '';
    document.getElementById('sa-broker-server').value = account.brokerServer || '';

    // Trigger change event to update help text
    document.getElementById('sa-risk-type').dispatchEvent(new Event('change'));

    // Populate strategy inputs
    if (account.strategiesRisk) {
        document.querySelectorAll('.sa-strategy-risk-input').forEach(input => {
            const id = input.dataset.strategyId;
            if (account.strategiesRisk[id] !== undefined) {
                input.value = account.strategiesRisk[id];
            } else {
                input.value = account.riskValue; // Fallback to global
            }
        });
    } else {
        // If no specific risks saved, use global
        document.querySelectorAll('.sa-strategy-risk-input').forEach(input => {
            input.value = account.riskValue;
        });
    }

    document.getElementById('slave-account-form-container').classList.remove('hidden');
    document.getElementById('slave-account-form-title').textContent = 'Editar Cuenta';
    document.getElementById('sa-name').focus();
};

/**
 * Deletes a slave account.
 */
const deleteSlaveAccount = (accountId) => {
    if (!confirm('¿Estás seguro de que quieres eliminar esta cuenta?')) return;

    const portfolio = state.savedPortfolios[activePortfolioIndex];
    portfolio.slaveAccounts = portfolio.slaveAccounts.filter(a => a.id !== accountId);

    // Persist
    saveSavedPortfolios();

    showToast('Cuenta eliminada', 'success');
    renderSlaveAccountsList();

    // If editing this one, close form
    if (editingAccountId === accountId) {
        document.getElementById('slave-account-form-container').classList.add('hidden');
        resetForm();
    }

    displaySavedPortfoliosList();
};
