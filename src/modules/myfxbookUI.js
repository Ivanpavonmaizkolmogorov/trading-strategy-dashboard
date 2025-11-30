// Myfxbook Account Management UI
import { state } from '../state.js';
import { dom } from '../dom.js';

let currentCredentials = null;
let myfxbookModal = null;
let pendingSync = false;

export function initMyfxbookUI() {
    console.log('[Myfxbook UI] Initializing...');
}

export function openMyfxbookModal() {
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
    // Store credentials for later use (linking)
    currentCredentials = { email, password };
    state.myfxbookCredentials = { email, password }; // Persist in session state

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
        const response = await fetch('/myfxbook/get-accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            if (pendingSync) {
                console.log('[Myfxbook UI] Login successful during Sync All. Resuming sync...');
                pendingSync = false;
                closeMyfxbookModal();
                refreshAllAccounts();
                return;
            }
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

// Helper para normalizar comentarios (Smart Grouping)
export const normalizeComment = (comment) => {
    if (!comment) return '';
    let normalized = comment;

    // 1. Eliminar sufijos de SL/TP/TP2/etc: [sl 123.45], [tp 123.45], [tp]
    // Regex: \[ seguido de (sl o tp o tpNumero) seguido de cualquier cosa hasta \]
    normalized = normalized.replace(/\[(sl|tp|tp\d*).*?\]/gi, '');

    // 2. Eliminar contadores y sufijos comunes recursivamente
    // _1, _26, _I, _Impr, _V1, _H1_1_5_23
    // Estrategia: Eliminar cualquier secuencia al final que sea _ seguido de digitos o letras cortas (I, Impr, V5)
    // Repetimos hasta que no cambie
    let prev;
    do {
        prev = normalized;
        // Eliminar _1, _26, _I, _Impr, _v5, _H1 (si es sufijo de variante)
        // Cuidado con H1 si es parte del nombre base. Pero si está al final tras otros sufijos...
        // Vamos a ser agresivos con patrones que parecen contadores o versiones
        normalized = normalized.replace(/_(\d+|I|Impr|v\d+|H\d+)\s*$/i, '');

        // Eliminar fechas/versiones complejas tipo _1_5_23
        normalized = normalized.replace(/_\d+_\d+_\d+\s*$/i, '');

        normalized = normalized.replace(/_+$/, ''); // Remove trailing underscores
    } while (normalized !== prev);

    // 3. Detectar y eliminar duplicaciones (e.g. "Name_Name")
    // Si el string contiene la misma secuencia repetida dos veces separada por _ o nada
    // Ej: "97UsdjpyBuyStPlV5_H1_1_5_23_97UsdjpyBuyStPlV5_H1_1_5_23_"
    // Normalizamos quitando _ al final primero
    normalized = normalized.replace(/_+$/, '');

    if (normalized.length > 10) {
        const half = Math.floor(normalized.length / 2);
        // Check if the second half starts with the first few chars of first half?
        // Better: Check if string is "X_X" or "XX"
        // Try to find the longest repeating prefix
        for (let len = Math.floor(normalized.length / 2); len > 5; len--) {
            const prefix = normalized.substring(0, len);
            const remainder = normalized.substring(len);
            // Si el resto empieza por _ y luego el prefix, o es igual al prefix
            if (remainder === prefix || remainder === `_${prefix}`) {
                normalized = prefix;
                break;
            }
        }
    }

    return normalized.trim();
};

// Function to clean existing metrics in memory without re-fetching
export function cleanMetrics(portfolio) {
    if (!portfolio.realMetrics || !portfolio.realMetrics.magicStats) return false;

    const oldStats = portfolio.realMetrics.magicStats;
    const newStats = {};
    let changed = false;

    Object.entries(oldStats).forEach(([key, stat]) => {
        const normalizedKey = normalizeComment(key);

        if (normalizedKey !== key) {
            changed = true;
        }

        if (!newStats[normalizedKey]) {
            newStats[normalizedKey] = {
                ...stat,
                id: normalizedKey,
                tradesCount: 0,
                totalProfit: 0,
                lots: 0,
                wonTrades: 0,
                lostTrades: 0,
                _exampleRaw: stat._exampleRaw || key // Preserve original example
            };
        }

        // Aggregate stats
        newStats[normalizedKey].tradesCount += stat.tradesCount || 0;
        newStats[normalizedKey].totalProfit += stat.totalProfit || 0;
        newStats[normalizedKey].lots += stat.lots || 0;
        newStats[normalizedKey].wonTrades += stat.wonTrades || 0;
        newStats[normalizedKey].lostTrades += stat.lostTrades || 0;
    });

    if (changed) {
        console.log('[Myfxbook] Metrics cleaned and aggregated.');
        portfolio.realMetrics.magicStats = newStats;
        return true;
    }
    return false;
}

export async function fetchLinkedAccountData(portfolio, email = null, password = null, accountId = null) {
    const finalAccountId = accountId || portfolio.linkedAccountId;
    const finalEmail = email || (state.myfxbookCredentials ? state.myfxbookCredentials.email : null);
    const finalPassword = password || (state.myfxbookCredentials ? state.myfxbookCredentials.password : null);

    if (!finalEmail || !finalPassword) {
        console.warn('[Myfxbook] No credentials available for sync.');
        import('./notifications.js').then(mod => mod.showToast('Please login to Myfxbook to sync data', 'warning'));
        return;
    }

    console.log(`[Myfxbook] Fetching history for linked account ${finalAccountId}...`);
    import('./notifications.js').then(mod => mod.showToast(`Syncing history for ${portfolio.name}...`, 'info'));

    try {
        const response = await fetch('/myfxbook/get-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: finalEmail,
                password: finalPassword,
                account_id: finalAccountId,
                _t: Date.now()
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            console.log(`[Myfxbook] History synced. ${data.count} trades.`);

            const strategyBreakdown = {};
            const magicMap = state.magicNumberMap || {};

            // 1. Agrupar trades por ID Normalizado
            const tradesById = {};
            // Aseguramos que data.history sea un array
            const history = Array.isArray(data.history) ? data.history : [];

            console.log(`[Myfxbook] Processing ${history.length} trades for normalization...`);

            history.forEach(trade => {
                // Prioridad: Comentario completo > Magic Number > Magic
                let rawId = trade.comment || trade.magicNumber || trade.magic;

                if (rawId !== undefined && rawId !== '') {
                    // Normalizar ID
                    const idStr = String(rawId);
                    // Si es un comentario (no solo números), aplicamos normalización inteligente
                    const isNumeric = /^\d+$/.test(idStr);
                    const normalizedId = isNumeric ? idStr : normalizeComment(idStr);

                    // if (history.length < 50) { // Log first few for debug
                    //     console.log(`[Myfxbook] Norm: "${idStr}" -> "${normalizedId}"`);
                    // }

                    if (!tradesById[normalizedId]) {
                        tradesById[normalizedId] = [];
                        // Guardamos un ejemplo del ID original para mostrar en tooltips
                        tradesById[normalizedId]._exampleRaw = idStr;
                    }
                    tradesById[normalizedId].push(trade);
                }
            });

            // 2. Calcular estadísticas generales por ID Normalizado (para el Mapper)
            const magicStats = {};
            Object.keys(tradesById).forEach(id => {
                const trades = tradesById[id];
                // Encontrar el símbolo más frecuente
                const symbols = {};
                trades.forEach(t => symbols[t.symbol] = (symbols[t.symbol] || 0) + 1);
                const topSymbol = Object.keys(symbols).sort((a, b) => symbols[b] - symbols[a])[0];

                magicStats[id] = {
                    id: id, // ID Normalizado
                    exampleRaw: tradesById[id]._exampleRaw || id, // Ejemplo original
                    symbol: topSymbol,
                    totalProfit: trades.reduce((sum, t) => sum + (t.profit || 0), 0),
                    tradesCount: trades.length,
                    lastTradeDate: trades.reduce((max, t) => t.closeDate > max ? t.closeDate : max, '')
                };
            });

            // Store real metrics
            portfolio.realMetrics = {
                lastSync: new Date().toISOString(),
                tradesCount: data.count,
                consecutiveLosses: data.metrics.consecutiveLosses,
                maxDrawdown: data.metrics.maxDrawdown,
                currentAccountStatus: data.accountInfo, // Store current account status (DD, Equity, etc.)
                totalProfit: history.reduce((sum, t) => sum + (t.profit || 0), 0),
                strategyBreakdown: {}, // Will be populated by recalculate
                magicStats: magicStats,
                _tradesById: tradesById // Store raw grouped trades for recalculation
            };

            // Calculate strategy breakdown using the shared function (ensures consistency)
            recalculateStrategyBreakdown(portfolio);

            // Force save to localStorage
            import('../state.js').then(mod => {
                // Assuming savePortfolios exists or we trigger it via event
                document.dispatchEvent(new CustomEvent('requestSavePortfolios'));
            });

            import('../ui.js').then(mod => mod.displaySavedPortfoliosList());
            import('./notifications.js').then(mod => mod.showToast(`Sync complete for ${portfolio.name}...`, 'success'));

        } else {
            console.error('[Myfxbook] Sync failed:', data);
            import('./notifications.js').then(mod => mod.showToast(`Sync failed: ${data.detail} `, 'error'));
            throw new Error(data.detail);
        }
    } catch (error) {
        console.error('[Myfxbook] Network error during sync:', error);
        throw error;
    }
}
// Check if we need to re-normalize metrics on load
export function checkAndRenormalizeMetrics(portfolio) {
    if (!portfolio.realMetrics || !portfolio.realMetrics.magicStats) return;

    const stats = portfolio.realMetrics.magicStats;
    const keys = Object.keys(stats);

    // Check for "dirty" keys that should have been cleaned OR missing raw trade data
    const hasDirtyKeys = keys.some(k =>
        k.includes('[sl') ||
        k.includes('[tp') ||
        /_(\d+|I|Impr)$/.test(k) ||
        k.length > 50 // Suspiciously long keys
    );

    const missingRawData = !portfolio.realMetrics._tradesById;

    if (hasDirtyKeys || missingRawData) {
        console.log('[Myfxbook] Detected dirty IDs or missing raw data. Forcing re-sync/normalization...');
        fetchLinkedAccountData(portfolio);
    }
}

// Call this when loading portfolios
document.addEventListener('DOMContentLoaded', () => {
    // Wait a bit for state to load
    setTimeout(() => {
        if (state.savedPortfolios) {
            state.savedPortfolios.forEach(p => {
                if (p.linkedAccountId) {
                    checkAndRenormalizeMetrics(p);
                }
            });
        }
    }, 2000);
});
function showError(message) {
    const resultDiv = document.getElementById('myfxbook-result');
    if (resultDiv) {
        resultDiv.className = 'bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-200 text-sm mt-4';
        resultDiv.textContent = message;
        resultDiv.classList.remove('hidden');
    }
}

export function recalculateStrategyBreakdown(portfolio) {
    if (!portfolio.realMetrics || !portfolio.realMetrics._tradesById) return;

    const tradesById = portfolio.realMetrics._tradesById;
    const magicMap = state.magicNumberMap || {};
    const strategyBreakdown = {};

    console.log('[Myfxbook] Recalculating. Available IDs:', Object.keys(tradesById));

    Object.entries(magicMap).forEach(([strategyId, mappedIds]) => {
        let ids = [];
        if (Array.isArray(mappedIds)) {
            ids = mappedIds;
        } else if (typeof mappedIds === 'string') {
            ids = mappedIds.split(',').map(s => s.trim());
        } else {
            ids = [mappedIds];
        }

        // console.log(`[Myfxbook] Strategy ${strategyId} maps to:`, ids);

        let allTrades = [];
        ids.forEach(id => {
            const idStr = String(id);
            if (tradesById[idStr]) {
                allTrades = allTrades.concat(tradesById[idStr]);
            } else {
                // console.warn(`[Myfxbook] ID ${idStr} not found in tradesById`);
            }
        });

        // Recalculate metrics
        let maxLosses = 0;
        let currentLosses = 0;
        let runningBalance = 0;
        let maxBalance = 0;
        let maxDD = 0;

        allTrades.sort((a, b) => new Date(a.closeTime) - new Date(b.closeTime));

        allTrades.forEach(t => {
            const profit = parseFloat(t.profit);

            // Consecutive Losses
            if (profit < 0) {
                currentLosses++;
                if (currentLosses > maxLosses) maxLosses = currentLosses;
            } else {
                currentLosses = 0;
            }

            // Drawdown Calculation (Approximate based on closed trades)
            runningBalance += profit;
            if (runningBalance > maxBalance) maxBalance = runningBalance;
            const dd = maxBalance - runningBalance;
            if (dd > maxDD) maxDD = dd;
        });

        strategyBreakdown[strategyId] = {
            mappedIds: ids,
            tradesCount: allTrades.length,
            totalProfit: allTrades.reduce((sum, t) => sum + (t.profit || 0), 0),
            maxConsecutiveLosses: maxLosses,
            currentConsecutiveLosses: currentLosses,
            maxDrawdown: maxDD
        };
    });

    portfolio.realMetrics.strategyBreakdown = strategyBreakdown;
    console.log('[Myfxbook] Strategy breakdown recalculated based on new mapping.');
}

export async function refreshAllAccounts() {
    console.log('[Myfxbook] Refreshing all linked accounts...');

    // Check credentials first
    if (!state.myfxbookCredentials || !state.myfxbookCredentials.email) {
        import('./notifications.js').then(mod => mod.showToast('Please login to Myfxbook to sync.', 'warning'));
        pendingSync = true;
        openMyfxbookModal();
        return;
    }

    const portfolios = state.savedPortfolios.filter(p => p.linkedAccountId);

    if (portfolios.length === 0) {
        import('./notifications.js').then(mod => mod.showToast('No linked accounts to sync.', 'info'));
        return;
    }

    import('./notifications.js').then(mod => mod.showToast(`Syncing ${portfolios.length} accounts...`, 'info'));

    const promises = portfolios.map(p => fetchLinkedAccountData(p));
    await Promise.all(promises);

    import('./notifications.js').then(mod => mod.showToast('All accounts synced.', 'success'));
}
