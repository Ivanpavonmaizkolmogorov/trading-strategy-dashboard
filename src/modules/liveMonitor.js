import { state } from '../state.js';
import { fetchLinkedAccountData, recalculateStrategyBreakdown } from './myfxbookUI.js';
import { showToast } from './notifications.js';
import { loadPortfolioIntoEditor } from './portfolioBuilder.js';
import { openMagicMapper } from './magicMapper.js'; // We need to export this or similar

export const initLiveMonitor = () => {
    console.log('[LiveMonitor] Initializing...');
    // Any specific init logic
};

export const renderLiveMonitor = () => {
    const container = document.getElementById('live-monitor-content');
    if (!container) return;

    container.innerHTML = ''; // Clear previous content

    // Filter portfolios with linked accounts
    const monitoredPortfolios = state.savedPortfolios.filter(p => p.linkedAccountId);

    if (monitoredPortfolios.length === 0) {
        renderEmptyState(container);
        return;
    }

    // Sort by risk (closest to limit first)
    monitoredPortfolios.sort((a, b) => {
        const riskA = calculateRiskScore(a);
        const riskB = calculateRiskScore(b);
        return riskB - riskA; // Descending risk
    });

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6';

    monitoredPortfolios.forEach(portfolio => {
        const card = createMonitorCard(portfolio);
        grid.appendChild(card);
    });

    container.appendChild(grid);
};

function calculateRiskScore(portfolio) {
    if (!portfolio.realMetrics || !portfolio.metrics) return 0;
    const limit = portfolio.metrics.maxConsecutiveLosses || 1;
    const current = portfolio.realMetrics.consecutiveLosses?.maxConsecutiveLosses || 0; // Note: Myfxbook returns maxConsecutiveLosses in history, but for live monitoring we ideally want CURRENT streak. 
    // However, the backend currently calculates 'maxConsecutiveLosses' from the whole history. 
    // We need to check if we have 'currentStreak' available. 
    // Looking at analysis_engine.py, we added 'currentStreakCount'. 
    // We need to make sure myfxbook_client/app.py returns this too.
    // For now, let's assume we use the maxConsecutiveLosses from real history as a proxy for "worst case seen so far".

    // Actually, the user wants to know if they are breaking the record.
    return (current / limit) * 100;
}

function createMonitorCard(portfolio) {
    const card = document.createElement('div');
    card.className = 'bg-gray-800 rounded-xl border border-gray-700 shadow-lg overflow-hidden flex flex-col transition-transform hover:scale-[1.02] duration-200';

    // Data extraction
    const limit = portfolio.metrics.maxConsecutiveLosses || 0;
    // Ideally we want the CURRENT streak from Myfxbook, but we only have maxConsecutiveLosses from the fetch.
    // Let's use that for now, assuming the user wants to know if the account *ever* exceeded the backtest.
    const realMax = portfolio.realMetrics?.consecutiveLosses?.maxConsecutiveLosses || 0;

    // Calculate Health
    const percentage = limit > 0 ? (realMax / limit) * 100 : 0;

    let statusColor = 'bg-emerald-500';
    let statusText = 'SAFE';
    let statusMessage = 'Operativa Normal';
    let borderColor = 'border-gray-700';

    if (percentage >= 100) {
        statusColor = 'bg-red-600';
        statusText = 'BROKEN';
        statusMessage = 'Récord histórico superado. REVISAR.';
        borderColor = 'border-red-500 ring-2 ring-red-500/20';
    } else if (percentage >= 80) {
        statusColor = 'bg-orange-500';
        statusText = 'DANGER';
        statusMessage = 'CRÍTICO: Cerca del récord.';
        borderColor = 'border-orange-500';
    } else if (percentage >= 50) {
        statusColor = 'bg-yellow-500';
        statusText = 'CAUTION';
        statusMessage = 'Vigilancia requerida.';
        borderColor = 'border-yellow-500';
    }

    card.className = `bg-gray-800 rounded-xl border ${borderColor} shadow-lg overflow-hidden flex flex-col transition-transform hover:scale-[1.02] duration-200 relative`;

    const realMaxDD = portfolio.realMetrics?.maxDrawdown?.maxDrawdownDollars || 0;
    const limitDD = portfolio.metrics?.maxDrawdownInDollars || 0;

    // Current Drawdown from Account Info (if available)
    // Myfxbook 'drawdown' field is usually a percentage. 'equity' and 'balance' are absolute.
    // Let's calculate $ DD if possible, or use the % if that's what we have.
    // Actually, user asked for "DD current" and "percentage that divides current / historical".
    // If historical is $, we need current in $.
    // Myfxbook account info usually has: balance, equity, drawdown (%), profit, etc.
    // Current DD ($) = Balance - Equity (roughly, if Equity < Balance)
    const accountInfo = portfolio.realMetrics?.currentAccountStatus;
    let currentDD = 0;
    if (accountInfo) {
        const balance = parseFloat(accountInfo.balance || 0);
        const equity = parseFloat(accountInfo.equity || 0);
        if (balance > equity) {
            currentDD = balance - equity;
        }
    }

    // Degradation: Current DD ($) / Max Historical DD ($)
    // If Max Historical DD is 0, avoid division by zero.
    const degradation = realMaxDD > 0 ? (currentDD / realMaxDD) * 100 : 0;

    card.innerHTML = `
        <div class="p-5 flex-1">
            <div class="flex justify-between items-start mb-4">
                <div>
                    <h3 class="font-bold text-lg text-white truncate w-48" title="${portfolio.name}">${portfolio.name}</h3>
                    <div class="flex items-center gap-2 mt-1">
                        <span class="text-xs bg-blue-900/50 text-blue-200 px-2 py-0.5 rounded border border-blue-800">
                            🔗 ${portfolio.linkedAccountName || 'Myfxbook'}
                        </span>
                    </div>
                </div>
                <div class="${statusColor} text-white text-xs font-bold px-2 py-1 rounded uppercase tracking-wider shadow-sm">
                    ${statusText}
                </div>
            </div>

            <div class="grid grid-cols-2 gap-3 mb-6">
                <!-- Consecutive Losses -->
                <div class="bg-gray-900/50 p-2 rounded-lg border border-gray-700 text-center" title="Maximum Consecutive Losses in Closed Trades History">
                    <div class="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Max Loss (Real)</div>
                    <div class="text-xl font-bold text-white">${realMax}</div>
                    <div class="text-[9px] text-gray-500">Trades</div>
                </div>
                <div class="bg-gray-900/50 p-2 rounded-lg border border-gray-700 text-center relative overflow-hidden" title="Max Consecutive Losses allowed by Backtest">
                    <div class="absolute inset-0 bg-gradient-to-br from-blue-900/10 to-transparent"></div>
                    <div class="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Max Loss (Limit)</div>
                    <div class="text-xl font-bold text-blue-400">${limit}</div>
                    <div class="text-[9px] text-gray-500">Trades</div>
                </div>

                <!-- Drawdown -->
                <div class="bg-gray-900/50 p-2 rounded-lg border border-gray-700 text-center" title="Maximum Drawdown in Closed Trades History ($)">
                    <div class="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Max DD (Real)</div>
                    <div class="text-xl font-bold text-white">$${realMaxDD.toFixed(0)}</div>
                    <div class="text-[9px] text-gray-500">Closed</div>
                </div>
                <div class="bg-gray-900/50 p-2 rounded-lg border border-gray-700 text-center relative overflow-hidden" title="Max Drawdown allowed by Backtest ($)">
                    <div class="absolute inset-0 bg-gradient-to-br from-blue-900/10 to-transparent"></div>
                    <div class="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Max DD (Limit)</div>
                    <div class="text-xl font-bold text-blue-400">$${limitDD.toFixed(0)}</div>
                    <div class="text-[9px] text-gray-500">Backtest</div>
                </div>

                <!-- Current Drawdown & Degradation -->
                <div class="bg-gray-900/50 p-2 rounded-lg border border-gray-700 text-center" title="Current Open Drawdown (from Myfxbook)">
                    <div class="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Current DD</div>
                    <div class="text-xl font-bold ${currentDD > 0 ? 'text-red-400' : 'text-emerald-400'}">$${currentDD.toFixed(0)}</div>
                    <div class="text-[9px] text-gray-500">Open</div>
                </div>
                <div class="bg-gray-900/50 p-2 rounded-lg border border-gray-700 text-center relative overflow-hidden" title="Degradation: Current DD / Max Historical DD">
                    <div class="absolute inset-0 bg-gradient-to-br from-purple-900/10 to-transparent"></div>
                    <div class="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Degradation</div>
                    <div class="text-xl font-bold ${degradation > 80 ? 'text-red-500 animate-pulse' : (degradation > 50 ? 'text-orange-400' : 'text-purple-400')}">${degradation.toFixed(1)}%</div>
                    <div class="text-[9px] text-gray-500">of Max DD</div>
                </div>
            </div>
            
            <!-- Strategy Breakdown -->
            <div class="bg-gray-900/30 rounded-lg p-3 mb-4 border border-gray-700/50">
                <div class="text-[10px] uppercase text-gray-500 font-bold mb-2 flex justify-between items-end">
                    <span>Strategy Breakdown</span>
                    <span class="text-[9px] text-gray-600 font-normal cursor-help" title="Current Streak / Max Allowed (Backtest)">Real (Curr/Max) vs Backtest ℹ️</span>
                </div>
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-x-3 gap-y-1 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                    ${(() => {
            // 1. Collect and calculate data for all strategies
            const strategyData = portfolio.indices.map(idx => {
                const strategy = state.loadedStrategyFiles[idx];
                if (!strategy) return null;

                const strategyId = strategy.strategyId || strategy.name;
                const magicNum = state.magicNumberMap[strategyId];

                if (!magicNum) return null; // Skip unmapped

                let metrics = portfolio.realMetrics?.strategyBreakdown?.[strategyId];

                // Self-healing
                if (!metrics && magicNum && portfolio.realMetrics?._tradesById) {
                    recalculateStrategyBreakdown(portfolio);
                    metrics = portfolio.realMetrics?.strategyBreakdown?.[strategyId];
                }

                let backtestLimit = strategy.metrics?.maxConsecutiveLosses || strategy.analysis?.metrics?.maxConsecutiveLosses || 0;

                // Fallback: Calculate on the fly if missing using raw data
                const rawData = state.rawStrategiesData?.[idx];
                if (backtestLimit === 0 && rawData && Array.isArray(rawData)) {
                    backtestLimit = calculateMaxConsecutiveLosses(rawData);
                }

                // DEBUG LOG
                if (backtestLimit === 0) {
                    console.warn(`[LiveMonitor] Zero Backtest Limit for ${strategy.name}`, {
                        metrics: strategy.metrics,
                        analysisMetrics: strategy.analysis?.metrics,
                        hasRawData: !!rawData
                    });
                }
                if (!metrics) {
                    // console.warn(`[LiveMonitor] No Real Metrics for ${strategy.name} (Magic: ${magicNum})`);
                }
                const currentStreak = metrics?.currentConsecutiveLosses || 0;
                const realMax = metrics?.maxConsecutiveLosses || 0;
                const realMaxDD = metrics?.maxDrawdown || 0;

                const percentage = backtestLimit > 0 ? (currentStreak / backtestLimit) * 100 : 0;

                return {
                    strategy,
                    magicNum,
                    metrics,
                    backtestLimit,
                    currentStreak,
                    realMax,
                    realMaxDD,
                    percentage
                };
            }).filter(Boolean);

            // 2. Sort by Risk Percentage (Descending)
            strategyData.sort((a, b) => b.percentage - a.percentage);

            // 3. Render
            if (strategyData.length === 0) {
                return '<div class="text-xs text-gray-500 text-center italic py-2">No strategies linked to Magic Numbers</div>';
            }

            return strategyData.map(item => {
                const { strategy, magicNum, backtestLimit, currentStreak, realMax, realMaxDD, percentage } = item;
                const cappedPercentage = Math.min(percentage, 100);

                let barColor = 'bg-emerald-500';
                if (percentage >= 100) barColor = 'bg-red-600 animate-pulse';
                else if (percentage >= 80) barColor = 'bg-orange-500';
                else if (percentage >= 50) barColor = 'bg-yellow-500';

                return `
                                <div class="py-2 border-b border-gray-700/50 last:border-0 hover:bg-gray-700/20 px-1 rounded transition-colors">
                                    <div class="flex justify-between items-center text-xs mb-1">
                                        <span class="text-gray-300 truncate flex-1 min-w-0 font-medium mr-2" title="${strategy.name}">${strategy.name.replace('.csv', '')}</span>
                                        <div class="flex items-center gap-1 font-mono shrink-0">
                                            <span class="${percentage >= 80 ? 'text-red-400 font-bold' : 'text-gray-400'}">${currentStreak}</span>
                                            <span class="text-gray-600">/</span>
                                            <span class="text-gray-500">${backtestLimit}</span>
                                        </div>
                                    </div>
                                    <div class="h-1.5 bg-gray-700 rounded-full overflow-hidden relative">
                                        <div class="h-full ${barColor} transition-all duration-500" style="width: ${cappedPercentage}%"></div>
                                    </div>
                                    <div class="flex justify-between mt-1">
                                        <span class="text-[9px] text-gray-600 truncate max-w-[80px]" title="Magic: ${magicNum}">#${magicNum}</span>
                                        <div class="flex gap-2">
                                            <span class="text-[9px] text-gray-600 cursor-help" title="Max Consecutive Losses seen in Real Trading (Closed Trades)">Max Loss (Closed): ${realMax}</span>
                                            <span class="text-[9px] text-gray-600 cursor-help" title="Max Drawdown seen in Real Trading (Closed Trades)">Max DD (Closed): $${realMaxDD.toFixed(0)}</span>
                                        </div>
                                    </div>
                                </div>
                            `;
            }).join('');
        })()}
                </div>
            </div>

            <div class="mb-4">
                <div class="flex justify-between text-xs mb-1">
                    <span class="text-gray-400">Risk Level</span>
                    <span class="text-gray-300">${percentage.toFixed(0)}%</span>
                </div>
                <div class="h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div class="h-full ${statusColor} transition-all duration-500" style="width: ${Math.min(percentage, 100)}%"></div>
                </div>
                <p class="text-xs text-gray-400 mt-2 italic">"${statusMessage}"</p>
            </div>
        </div>

        <div class="bg-gray-900/80 p-3 border-t border-gray-700 flex gap-2">
            <button class="sync-btn flex-1 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold py-2 px-3 rounded transition-colors flex items-center justify-center gap-2" data-id="${portfolio.id}" title="Sync Account History">
                <span>🔄</span> Sync
            </button>
            <button class="map-btn flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 px-3 rounded transition-colors flex items-center justify-center gap-2" data-id="${portfolio.id}" title="Link Strategies to Magic Numbers">
                <span>🔗</span> Map
            </button>
            <button class="repair-btn flex-1 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold py-2 px-3 rounded transition-colors flex items-center justify-center gap-2" data-id="${portfolio.id}" title="Repair Portfolio">
                <span>🛠️</span> Repair
            </button>
        </div>
    `;

    // Event Listeners
    const syncBtn = card.querySelector('.sync-btn');
    syncBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        syncBtn.disabled = true;
        syncBtn.innerHTML = '<span>⏳</span> Syncing...';

        try {
            await fetchLinkedAccountData(portfolio);
            renderLiveMonitor(); // Re-render to show new data
            showToast('Account synced successfully', 'success');
        } catch (err) {
            console.error(err);
            showToast('Sync failed', 'error');
            syncBtn.innerHTML = '<span>🔄</span> Retry';
            syncBtn.disabled = false;
        }
    });

    const mapBtn = card.querySelector('.map-btn');
    mapBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openMagicMapper(portfolio);
    });

    const repairBtn = card.querySelector('.repair-btn');
    repairBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // We need to import this dynamically or ensure it's available
        import('./portfolioBuilder.js').then(mod => {
            // Find index
            const index = state.savedPortfolios.findIndex(p => p.id === portfolio.id);
            if (index !== -1) {
                mod.loadPortfolioIntoEditor(index);
                // Switch tab to Portfolio Builder (assuming tab ID 'builder')
                document.getElementById('tab-builder')?.click();
                showToast(`Loaded ${portfolio.name} for repair`, 'info');
            }
        });
    });

    return card;
}

function renderEmptyState(container) {
    container.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full text-gray-500 p-10">
            <div class="text-6xl mb-4">📡</div>
            <h3 class="text-xl font-bold text-gray-300 mb-2">No Monitored Accounts</h3>
            <p class="text-center max-w-md mb-6">Link your Myfxbook accounts to your portfolios to start monitoring their health here.</p>
            <button onclick="document.querySelector(&quot;.tab-btn[data-target='saved-portfolios-content']&quot;)?.click()" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-full transition-colors">
                Go to Saved Portfolios
            </button>
        </div>
        `;
}

function calculateMaxConsecutiveLosses(trades) {
    if (!trades || !Array.isArray(trades)) return 0;

    let maxLosses = 0;
    let currentLosses = 0;

    // Sort by date just in case
    const sortedTrades = [...trades].sort((a, b) => {
        const dateA = new Date(a.date || a.closeDate || a.entry_date);
        const dateB = new Date(b.date || b.closeDate || b.entry_date);
        return dateA - dateB;
    });

    for (const t of sortedTrades) {
        // Handle different property names for profit
        const profit = parseFloat(t.pnl || t.profit || t['Profit'] || 0);
        if (profit < 0) {
            currentLosses++;
            if (currentLosses > maxLosses) maxLosses = currentLosses;
        } else {
            currentLosses = 0;
        }
    }
    return maxLosses;
}
