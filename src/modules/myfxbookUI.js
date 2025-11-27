// Myfxbook Account Management UI
import { state } from '../state.js';
import { dom } from '../dom.js';

let currentCredentials = null;
let myfxbookModal = null;

export function initMyfxbookUI() {
    console.log('[Myfxbook UI] Initializing...');

    // Attach to existing button in HTML
    const myfxbookBtn = document.getElementById('myfxbook-connect-btn');

    if (myfxbookBtn) {
        myfxbookBtn.onclick = openMyfxbookModal;
        console.log('[Myfxbook UI] Button connected');
    } else {
        console.warn('[Myfxbook UI] Button not found in HTML');
    }
}

function openMyfxbookModal() {
    console.log('[Myfxbook UI] Opening modal');

    // Create modal if it doesn't exist
    if (!myfxbookModal) {
        myfxbookModal = createMyfxbookModal();
        document.body.appendChild(myfxbookModal);
    }

    myfxbookModal.classList.remove('hidden');
}

function closeMyfxbookModal() {
    if (myfxbookModal) {
        myfxbookModal.classList.add('hidden');
    }
}

function createMyfxbookModal() {
    // Cleanup existing modal if any (prevents ID collisions on reload)
    const existing = document.getElementById('myfxbook-modal');
    if (existing) {
        existing.remove();
        console.log('[Myfxbook UI] Removed existing modal instance');
    }

    const modal = document.createElement('div');
    modal.id = 'myfxbook-modal';
    modal.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 hidden p-4';

    modal.innerHTML = `
        <div class="bg-gray-800 rounded-xl border border-gray-700 w-[600px] max-w-full shadow-2xl max-h-[90vh] flex flex-col">
            <!-- Header -->
            <div class="flex justify-between items-center p-6 border-b border-gray-700">
                <h2 class="text-2xl font-bold text-white flex items-center gap-2">
                    <span>🩺</span>
                    <span>Connect Myfxbook Account</span>
                </h2>
                <button id="close-myfxbook-modal" class="text-gray-400 hover:text-white text-3xl">×</button>
            </div>
            
            <!-- Scrollable Content -->
            <div class="overflow-y-auto p-6 flex-1">
            
            <!-- Info Box -->
            <div class="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4 mb-4">
                <p class="text-sm text-yellow-200 font-semibold mb-2">
                    ⚠️ <strong>Importante: API de Myfxbook vs Login Web</strong>
                </p>
                <p class="text-xs text-yellow-300 mb-2">
                    <strong>La API de Myfxbook es diferente del login web.</strong> Aunque uses Google para entrar a la web, la API requiere credenciales específicas.
                </p>
                <p class="text-xs text-yellow-300 font-semibold">
                    📖 Consulta la documentación oficial:
                </p>
                <a href="https://www.myfxbook.com/api" target="_blank" class="text-xs text-blue-400 underline block mt-1">
                    https://www.myfxbook.com/api
                </a>
            </div>
            
            <div class="bg-blue-900/30 border border-blue-700 rounded-lg p-4 mb-6">
                <p class="text-sm text-blue-200 mb-2">
                    💡 <strong>Account ID:</strong> Encuéntralo en tu perfil
                </p>
                <p class="text-xs text-blue-300">
                    1. Ve a "Portfolio" en el menú <br>
                    2. Selecciona una cuenta<br>
                    3. El ID está en la URL: <code class="bg-gray-900 px-1 rounded">myfxbook.com/portfolio/nombre/<strong class="text-blue-400">12345</strong></code>
                </p>
            </div>
            
            <!-- Form -->
            <form id="myfxbook-test-form" class="space-y-4">
                <!-- Email -->
                <div>
                    <label class="block text-gray-300 text-sm font-semibold mb-2">
                        Email
                    </label>
                    <input 
                        type="email" 
                        id="myfxbook-email" 
                        required
                        placeholder="your@email.com"
                        class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                    />
                </div>
                
                <!-- Password -->
                <div>
                    <label class="block text-gray-300 text-sm font-semibold mb-2">
                        Password
                    </label>
                    <input 
                        type="password" 
                        id="myfxbook-password" 
                        required
                        placeholder="••••••••"
                        class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                    />
                </div>
                
                <!-- Result Area -->
                <div id="myfxbook-result" class="hidden">
                    <!-- Success/Error messages will appear here -->
                </div>
                
                <!-- Buttons -->
                <div class="flex gap-3 pt-4">
                    <button 
                        type="button"
                        id="cancel-myfxbook-btn"
                        class="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-semibold transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                        type="submit"
                        id="test-myfxbook-btn"
                        class="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
                    >
                        <span id="test-btn-icon">🔓</span>
                        <span id="test-btn-text">Login & Fetch Accounts</span>
                    </button>
                </div>
                
                <!-- Result Display -->
                <div id="myfxbook-result" class="hidden mt-4"></div>
            </form>
            
            
            </div>
            <!-- End Scrollable Content -->
        </div>
    `;

    // Event listeners
    modal.querySelector('#close-myfxbook-modal').onclick = closeMyfxbookModal;
    modal.querySelector('#cancel-myfxbook-btn').onclick = closeMyfxbookModal;
    modal.querySelector('#myfxbook-test-form').onsubmit = handleLogin;

    // Close on backdrop click
    modal.onclick = (e) => {
        if (e.target === modal) closeMyfxbookModal();
    };

    return modal;
}

// ... (skip to handleLogin)
async function handleLogin(e) {
    e.preventDefault();
    console.log('[Myfxbook UI] handleLogin triggered');

    const form = e.target;
    const emailInput = form.querySelector('input[type="email"]');
    const passwordInput = form.querySelector('input[type="password"]');

    const email = emailInput ? emailInput.value : '';
    const password = passwordInput ? passwordInput.value : '';

    // Store credentials for later use (linking)
    currentCredentials = { email, password };

    const resultDiv = form.querySelector('#myfxbook-result') || document.getElementById('myfxbook-result');
    const testBtn = form.querySelector('#test-myfxbook-btn');
    const btnIcon = form.querySelector('#test-btn-icon');
    const btnText = form.querySelector('#test-btn-text');

    // Show loading state
    testBtn.disabled = true;
    btnIcon.textContent = '⏳';
    btnText.textContent = 'Fetching Accounts...';
    resultDiv.classList.add('hidden');

    console.log('[Myfxbook UI] Logging in...', { email });

    try {
        const response = await fetch('http://localhost:8001/myfxbook/get-accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            renderAccountsList(data.accounts);
        } else {
            showError(data.detail || 'Login failed');
        }

    } catch (error) {
        console.error('[Myfxbook UI] Error:', error);
        showError(`Network error: ${error.message}`);
    } finally {
        // Reset button
        testBtn.disabled = false;
        btnIcon.textContent = '🔓';
        btnText.textContent = 'Login & Fetch Accounts';
    }
}

function renderAccountsList(accounts) {
    const contentDiv = document.querySelector('#myfxbook-modal .overflow-y-auto');

    contentDiv.innerHTML = `
        <div class="p-4">
            <h3 class="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span>📋</span> Select Account to Link
            </h3>
            <p class="text-gray-400 text-sm mb-6">Found ${accounts.length} accounts associated with your email.</p>
            
            <div class="space-y-3">
                ${accounts.map(acc => `
                    <div class="bg-gray-700/50 border border-gray-600 p-4 rounded-lg flex justify-between items-center hover:bg-gray-700 transition-colors">
                        <div>
                            <div class="font-bold text-white text-lg">${acc.name}</div>
                            <div class="text-sm text-gray-400 flex gap-3 mt-1">
                                <span class="bg-gray-800 px-2 py-0.5 rounded text-xs">ID: ${acc.id}</span>
                                <span class="bg-gray-800 px-2 py-0.5 rounded text-xs">Acc #: ${acc.accountId}</span>
                            </div>
                        </div>
                        <button 
                            class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold shadow-lg shadow-blue-900/20 transition-all transform hover:scale-105 link-account-btn" 
                            data-id="${acc.id}" 
                            data-name="${acc.name}" 
                            data-account-id="${acc.accountId}"
                        >
                            Link 🔗
                        </button>
                    </div>
                `).join('')}
            </div>
            
            <button id="back-to-login-btn" class="mt-8 text-gray-400 hover:text-white text-sm underline">
                ← Back to Login
            </button>
        </div>
    `;

    contentDiv.querySelectorAll('.link-account-btn').forEach(btn => {
        btn.onclick = () => openLinkModal(btn.dataset);
    });

    contentDiv.querySelector('#back-to-login-btn').onclick = () => {
        closeMyfxbookModal();
        setTimeout(openMyfxbookModal, 300);
    };
}

function openLinkModal(accountData) {
    const contentDiv = document.querySelector('#myfxbook-modal .overflow-y-auto');
    const savedPortfolios = state.savedPortfolios;

    if (savedPortfolios.length === 0) {
        alert("No saved portfolios found. Please create and save a portfolio first.");
        return;
    }

    contentDiv.innerHTML = `
        <div class="p-4">
            <h3 class="text-xl font-bold text-white mb-2">Link "${accountData.name}"</h3>
            <p class="text-gray-400 text-sm mb-6">Select a saved portfolio to link this Myfxbook account to.</p>
            
            <div class="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
                ${savedPortfolios.map((p, index) => `
                    <div class="bg-gray-700/50 border border-gray-600 p-3 rounded-lg flex justify-between items-center cursor-pointer hover:bg-gray-600 transition-colors portfolio-select-item" data-index="${index}">
                        <div class="flex-1">
                            <div class="font-bold text-white flex items-center gap-2">
                                ${p.name}
                                ${p.linkedAccountId ? '<span class="text-[10px] bg-blue-900 text-blue-200 px-1 rounded border border-blue-700">Linked</span>' : ''}
                            </div>
                            <div class="grid grid-cols-3 gap-2 mt-1 text-xs text-gray-400">
                                <div>Strat: <span class="text-gray-300">${p.indices ? p.indices.length : 0}</span></div>
                                <div>Profit: <span class="text-emerald-400">$${p.metrics?.totalProfit?.toFixed(0) || 0}</span></div>
                                <div>Ret/DD: <span class="text-blue-400">${p.metrics?.profitMaxDD_Ratio?.toFixed(2) || 0}</span></div>
                            </div>
                        </div>
                        <div class="w-4 h-4 rounded-full border border-gray-400 selection-indicator ml-3"></div>
                    </div>
                `).join('')}
            </div>

            <div class="flex gap-3 mt-6">
                <button id="cancel-link-btn" class="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg">Cancel</button>
                <button id="confirm-link-btn" class="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed" disabled>Confirm Link</button>
            </div>
        </div>
    `;

    let selectedIndex = null;

    contentDiv.querySelectorAll('.portfolio-select-item').forEach(item => {
        item.onclick = () => {
            contentDiv.querySelectorAll('.portfolio-select-item').forEach(i => {
                i.classList.remove('bg-blue-900/30', 'border-blue-500');
                i.querySelector('.selection-indicator').classList.remove('bg-blue-500', 'border-transparent');
            });

            item.classList.add('bg-blue-900/30', 'border-blue-500');
            item.querySelector('.selection-indicator').classList.add('bg-blue-500', 'border-transparent');

            selectedIndex = parseInt(item.dataset.index);
            document.getElementById('confirm-link-btn').disabled = false;
        };
    });

    document.getElementById('cancel-link-btn').onclick = () => {
        closeMyfxbookModal();
    };

    document.getElementById('confirm-link-btn').onclick = () => {
        if (selectedIndex !== null) {
            linkAccount(accountData, selectedIndex);
        }
    };
}

function linkAccount(accountData, portfolioIndex) {
    const portfolio = state.savedPortfolios[portfolioIndex];

    state.linkedAccounts.push({
        ...accountData,
        portfolioId: portfolio.id,
        portfolioIndex: portfolioIndex,
        linkedAt: new Date().toISOString()
    });

    portfolio.linkedAccountId = accountData.id;
    portfolio.linkedAccountName = accountData.name;

    console.log('[Myfxbook UI] Linked account:', accountData, 'to portfolio:', portfolio.name);

    closeMyfxbookModal();

    document.dispatchEvent(new CustomEvent('portfolioLinked', { detail: { portfolioIndex } }));

    if (currentCredentials && currentCredentials.email && currentCredentials.password) {
        fetchLinkedAccountData(portfolio, currentCredentials.email, currentCredentials.password, accountData.id);
    } else {
        console.warn('[Myfxbook UI] No credentials found for sync. Please re-login.');
        import('./notifications.js').then(mod => mod.showToast(`Linked, but sync failed (re-login required)`, 'warning'));
    }

    import('./notifications.js').then(mod => mod.showToast(`Linked ${accountData.name} to ${portfolio.name}`, 'success'));
}

export function unlinkAccount(portfolioIndex) {
    const portfolio = state.savedPortfolios[portfolioIndex];
    if (!portfolio) return;

    const accountName = portfolio.linkedAccountName || 'Account';

    // Remove from state.linkedAccounts
    state.linkedAccounts = state.linkedAccounts.filter(l => l.portfolioId !== portfolio.id);

    // Clear portfolio properties
    delete portfolio.linkedAccountId;
    delete portfolio.linkedAccountName;
    delete portfolio.realMetrics;

    console.log(`[Myfxbook UI] Unlinked ${accountName} from ${portfolio.name}`);

    // Refresh UI
    document.dispatchEvent(new CustomEvent('portfolioUnlinked', { detail: { portfolioIndex } }));
    import('../ui.js').then(mod => mod.displaySavedPortfoliosList());
    import('./notifications.js').then(mod => mod.showToast(`Unlinked ${accountName}`, 'info'));
}

async function fetchLinkedAccountData(portfolio, email, password, accountId) {
    console.log(`[Myfxbook] Fetching history for linked account ${accountId}...`);

    import('./notifications.js').then(mod => mod.showToast(`Syncing history for ${portfolio.name}...`, 'info'));

    try {
        const response = await fetch('http://localhost:8001/myfxbook/get-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, account_id: accountId })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            console.log(`[Myfxbook] History synced. ${data.count} trades.`);

            portfolio.realMetrics = {
                lastSync: new Date().toISOString(),
                tradesCount: data.count,
                consecutiveLosses: data.metrics.consecutiveLosses,
                totalProfit: data.history.reduce((sum, t) => sum + (t.profit || 0), 0)
            };

            import('../ui.js').then(mod => mod.displaySavedPortfoliosList());
            import('./notifications.js').then(mod => mod.showToast(`Sync complete for ${portfolio.name}`, 'success'));

        } else {
            console.error('[Myfxbook] Sync failed:', data);
            import('./notifications.js').then(mod => mod.showToast(`Sync failed: ${data.detail}`, 'error'));
        }
    } catch (error) {
        console.error('[Myfxbook] Network error during sync:', error);
    }
}

function showError(message) {
    const resultDiv = document.getElementById('myfxbook-result');
    if (resultDiv) {
        resultDiv.className = 'bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-200 text-sm mt-4';
        resultDiv.textContent = message;
        resultDiv.classList.remove('hidden');
    }
}
