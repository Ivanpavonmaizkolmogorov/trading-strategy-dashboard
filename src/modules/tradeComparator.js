import { state } from '../state.js';
import { formatMetricForDisplay } from '../utils.js';
import { normalizeComment } from './myfxbookUI.js';

/**
 * Main entry point for the Real vs SQ Comparison Tab.
 * Triggered when user switches to this view mode.
 */
export const initComparisonTab = () => {
    const container = document.getElementById('comparison-table-container'); // Reusing existing container or create new
    if (!container) return;

    // Clear previous content
    container.innerHTML = '';
    container.classList.remove('hidden');

    // 1. Get Active Portfolio (Assuming Focus Mode logic or First Saved)
    // For now, we compare ALL linked portfolios or the one currently "Focused"
    // Ideally, the user selects a portfolio to audit.
    // If we are in "Saved Portfolios" tab, and specific portfolio is 'Active' in viewer...
    // Let's assume we want to audit the portfolio currently visualized in the Equity Chart.

    // We can iterate state.savedPortfolios and see which one is "active" or just list all linked ones.
    const linkedPortfolios = state.savedPortfolios.filter(p =>
        p.linkedAccountId && p.realMetrics && p.realMetrics._tradesById
    );

    if (linkedPortfolios.length === 0) {
        renderEmptyState(container, 'No hay portafolios vinculados a Myfxbook.');
        return;
    }

    // 2. Render Selection or List
    // If only 1, show it. If multiple, maybe tabs or sequential?
    // Let's render a summary table for ALL linked portfolios/strategies.

    const allComparisons = [];

    linkedPortfolios.forEach(portfolio => {
        const comparisons = calculateComparisons(portfolio);
        allComparisons.push(...comparisons);
    });

    renderComparisonView(container, allComparisons);
};

const renderEmptyState = (container, msg) => {
    container.innerHTML = `
        <div class="flex flex-col items-center justify-center p-8 text-gray-500">
            <span class="text-4xl mb-2">🤷‍♂️</span>
            <p>${msg}</p>
        </div>
    `;
};

// Core Logic: Matches Real trades with SQ trades.
const calculateComparisons = (portfolio) => {
    const comparisons = [];
    if (!portfolio.realMetrics || !portfolio.realMetrics._tradesById) return [];

    const magicMap = state.magicNumberMap || {};
    const allRealTrades = Object.values(portfolio.realMetrics._tradesById).flat();

    console.log(`[Audit] Total Real Trades in Portfolio: ${allRealTrades.length}`);
    const claimedRealTrades = new Set();
    const isClaimed = (t) => claimedRealTrades.has(t.id || t.ticket || t.comment);

    // 0. Time Window Definition (Strict)
    // Start: First Real Trade (Global Limit) - We only care about Backtest trades occurring AFTER real trading began.
    let globalFirstRealTime = Infinity;
    if (allRealTrades.length > 0) {
        globalFirstRealTime = allRealTrades.reduce((min, t) => {
            const time = new Date(t.openTime || t.OpenTime).getTime();
            return time < min ? time : min;
        }, Infinity);
    } else {
        globalFirstRealTime = 0;
    }

    // Iterate through Strategies in Portfolio
    portfolio.indices.forEach((stratIndex, i) => {
        // Fix: strategyNames is usually on portfolio root, not metrics
        const stratName = portfolio.strategyNames?.[i] || portfolio.metrics?.strategyNames?.[i] || `Strategy ${stratIndex}`;

        console.log(`[Audit] Processing Strategy: ${stratName} (Index: ${stratIndex})`);

        // 1. Get SQ Trades (Backtest)
        if (!state.rawStrategiesData || !state.rawStrategiesData[stratIndex]) {
            console.warn(`[Audit] No raw data found for strategy ${stratName} (Index ${stratIndex}). Reuse imported files?`);
            comparisons.push({ strategyName: stratName, error: 'Datos de Backtest no disponibles. ¿Has importado el CSV?' });
            return;
        }

        const sqTrades = state.rawStrategiesData[stratIndex];
        console.log(`[Audit] SQ Trades found: ${sqTrades.length}`);

        // Strategy Specific End Date (Last SQ Trade)
        // End: Last Backtest Trade (Strategy Limit) - We only care about Real trades occurring BEFORE the backtest ends (comparable range).
        let lastSQTime = 0;
        if (sqTrades.length > 0) {
            lastSQTime = sqTrades.reduce((max, t) => {
                const time = new Date(t.exit_date || t.close_date || t.date).getTime();
                return time > max ? time : max;
            }, 0);
        } else {
            lastSQTime = Date.now();
        }

        // Filter SQ Trades (Missed Candidates): Only those AFTER globalFirstRealTime
        const relevantSQTrades = sqTrades.filter(t => {
            const time = new Date(t.exit_date || t.close_date || t.date).getTime();
            return time >= globalFirstRealTime;
        });

        const matches = [];
        const orphanSQ = [];

        // Match SQ Trades to Real Trades (Forward Pass)
        relevantSQTrades.forEach(sqT => {
            // Criteria: Symbol, Type, Lot, Close Time
            // SQ Close Time: sqT.close_date || sqT.exit_date

            // SQ Close Time: Try multiple common keys before falling back to date (Open Time)
            const sqExitTime = new Date(
                sqT.exit_date ||
                sqT.close_date ||
                sqT['close time'] ||
                sqT['exit time'] ||
                sqT['close date'] ||
                sqT['exit date'] ||
                sqT.date // Fallback (likely Open Time, but better than NaN)
            ).getTime();
            const sqSymbol = sqT.symbol || '';
            const sqType = sqT.type || ''; // 'Buy', 'Sell'
            const sqLot = parseFloat(sqT.size || sqT.lots || 0);

            // Find best candidate in allRealTrades
            const candidates = allRealTrades.filter(realT => {
                // DATE CONSTRAINT: Real Trade must be BEFORE lastSQTime (plus buffer)
                const rTime = new Date(realT.closeTime || realT.CloseTime).getTime();
                if (rTime > lastSQTime + 86400000) return false;

                if (isClaimed(realT)) return false;

                // 1. Symbol Match (Fuzzy)
                const rSym = realT.symbol || realT.Symbol || '';
                if (!rSym.toLowerCase().includes(sqSymbol.toLowerCase()) && !sqSymbol.toLowerCase().includes(rSym.toLowerCase())) return false;

                // 2. Type Match
                const rType = (realT.action || realT.Action || '').toLowerCase();
                const sType = sqType.toLowerCase();
                if (!rType.includes(sType) && !sType.includes(rType)) return false;

                // 3. Lot Match (Tolerance 0.01)
                const rLot = parseFloat(realT.lots || realT.Size || 0);
                if (Math.abs(rLot - sqLot) > 0.01) return false;

                // 4. Close Time Match (Tolerance 90 mins = 5400000 ms)
                const rCloseTime = new Date(realT.closeTime || realT.CloseTime).getTime();
                const diffMs = Math.abs(rCloseTime - sqExitTime);
                return diffMs < 5400000;
            });

            if (candidates.length > 0) {
                // Pick closest by Close Time
                candidates.sort((a, b) => {
                    const aTime = new Date(a.closeTime || a.CloseTime).getTime();
                    const bTime = new Date(b.closeTime || b.CloseTime).getTime();
                    return Math.abs(aTime - sqExitTime) - Math.abs(bTime - sqExitTime);
                });

                const bestMatch = candidates[0];
                matches.push({ sq: sqT, real: bestMatch });

                // Mark as claimed
                const bestId = bestMatch.id || bestMatch.ticket || bestMatch.comment;
                claimedRealTrades.add(bestId);
            } else {
                orphanSQ.push(sqT);
            }
        });

        // Identify Orphans Real (Ghosts)
        // Find unclaimed real trades that match this strategy's symbol AND are within valid filtered window
        let orphanReal = [];
        if (sqTrades.length > 0) {
            const targetSymbol = sqTrades[0].symbol || '';
            orphanReal = allRealTrades.filter(realT => {
                if (isClaimed(realT)) return false;

                // Date Check: Must be within [Start Real, End SQ]
                const rTime = new Date(realT.closeTime || realT.CloseTime).getTime();
                if (rTime < globalFirstRealTime || rTime > lastSQTime + 86400000) return false;

                // Symbol check
                const rSym = realT.symbol || realT.Symbol || '';
                return rSym.toLowerCase().includes(targetSymbol.toLowerCase()) || targetSymbol.toLowerCase().includes(rSym.toLowerCase());
            });
        }

        console.log(`[Audit] Heuristic Matches found: ${matches.length}`);

        comparisons.push({
            strategyName: stratName,
            matches,
            orphanReal,
            orphanSQ,
            matchRate: matches.length / (matches.length + orphanReal.length + orphanSQ.length) || 0 // rough metric
        });
    });

    return comparisons;
};


const renderComparisonView = (container, comparisons) => {
    // Save to window for detailing
    window._auditComparisons = comparisons;

    const tableInfo = comparisons.map((c, index) => {
        if (c.error) {
            return `
        <div class="bg-gray-800 rounded-lg p-4 border border-red-900/50 flex flex-col gap-2">
            <h3 class="text-sm font-bold text-gray-300 truncate" title="${c.strategyName}">${c.strategyName}</h3>
            <span class="text-xs text-red-500 font-mono">${c.error}</span>
        </div>`;
        }

        // Calculate Stats
        const matchCount = c.matches.length;
        const ghostCount = c.orphanReal.length;
        const missedCount = c.orphanSQ.length;
        // const quality = (matchCount / (matchCount + ghostCount + missedCount)) * 100;

        return `
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700 flex flex-col gap-3 shadow-lg hover:border-gray-600 transition-colors">
            <div class="flex justify-between items-start">
                <h3 class="text-sm font-bold text-gray-200 truncate w-[70%]" title="${c.strategyName}">${c.strategyName}</h3>
                <span class="text-xs font-mono bg-gray-900 px-2 py-1 rounded text-blue-400">Idx: ${index}</span>
            </div>
            
            <div class="grid grid-cols-3 gap-2 text-center text-xs">
                <div class="bg-emerald-900/30 p-2 rounded flex flex-col">
                    <span class="text-emerald-400 font-bold text-lg">${matchCount}</span>
                    <span class="text-gray-500 uppercase text-[9px]">Match</span>
                </div>
                <div class="bg-red-900/30 p-2 rounded flex flex-col">
                    <span class="text-red-400 font-bold text-lg">${ghostCount}</span>
                    <span class="text-gray-500 uppercase text-[9px]">Ghosts</span>
                </div>
                <div class="bg-yellow-900/30 p-2 rounded flex flex-col">
                    <span class="text-yellow-400 font-bold text-lg">${missedCount}</span>
                    <span class="text-gray-500 uppercase text-[9px]">Missed</span>
                </div>
            </div>
            
            <!-- Detail Button -->
            <button class="w-full text-center text-xs bg-gray-700 hover:bg-gray-600 text-white py-2 rounded transition-colors"
                onclick="window.openAuditDetailModal(${index})">
                🔍 Ver Detalle
            </button>
        </div>
    `;
    }).join('');

    container.innerHTML = `
        <div class="p-4">
            <h2 class="text-lg font-bold mb-4 text-gray-200 flex items-center gap-2">
                <span>🕵️</span> Auditoría Real vs Backtest
            </h2>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                ${tableInfo}
            </div>
        </div>
    `;
};

window.openAuditDetailModal = (index) => {
    const comparison = window._auditComparisons[index];
    if (!comparison) return;

    // Create Modal
    let modal = document.getElementById('audit-detail-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'audit-detail-modal';
    modal.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/95 backdrop-blur-md p-4';

    // Sort all events by date to interleave them effectively in a single timeline view?
    // Or Side-by-Side? Side-by-Side is better for direct comparison.
    // Matched rows aligned. Orphans inserted.

    // Construct Rows
    // We can't perfectly align orphans without complex logic, but we can list Matches first, then Ghosts, then Missed?
    // User requested "Comparisons... operations in Myfxbook but not Backtest... etc".
    // A single table with 3 sections creates clarity.

    // SECTION 1: MATCHED
    const matchRows = comparison.matches.map(m => `
        <tr class="bg-emerald-900/10 hover:bg-emerald-900/20">
            <td class="p-2 border-r border-gray-700 text-xs text-gray-300">${formatDate(m.real.openTime || m.real.OpenTime)}</td>
            <td class="p-2 border-r border-gray-700 text-xs ${(m.real.action || m.real.Action || '').toLowerCase().includes('buy') ? 'text-green-400' : 'text-red-400'}">${m.real.action || m.real.Action}</td>
            <td class="p-2 border-r border-gray-700 text-xs font-mono">${m.real.openPrice || m.real.OpenPrice}</td>
            
            <td class="p-2 border-r border-gray-700 text-center text-emerald-500 font-bold">✅</td>
            
            <td class="p-2 border-r border-gray-700 text-xs text-gray-300">${formatDate(m.sq.date)}</td>
            <td class="p-2 border-r border-gray-700 text-xs ${m.sq.type.includes('Buy') ? 'text-green-400' : 'text-red-400'}">${m.sq.type}</td>
            <td class="p-2 text-xs font-mono text-gray-300">${m.sq.price}</td>
        </tr>
    `).join('');

    // SECTION 2: HOSTS (Real Only)
    const ghostRows = comparison.orphanReal.map(r => `
        <tr class="bg-red-900/10 hover:bg-red-900/20">
            <td class="p-2 border-r border-gray-700 text-xs text-gray-300">${formatDate(r.openTime || r.OpenTime)}</td>
            <td class="p-2 border-r border-gray-700 text-xs ${(r.action || r.Action || '').toLowerCase().includes('buy') ? 'text-green-400' : 'text-red-400'}">${r.action || r.Action}</td>
            <td class="p-2 border-r border-gray-700 text-xs font-mono">${r.openPrice || r.OpenPrice}</td>
            
            <td class="p-2 border-r border-gray-700 text-center text-red-500 font-bold">❌</td>
            
            <td class="p-2 border-r border-gray-700" colspan="3"><span class="text-xs text-gray-500 italic">No existe en Backtest</span></td>
        </tr>
    `).join('');

    // SECTION 3: MISSED (SQ Only)
    const missedRows = comparison.orphanSQ.map(s => `
        <tr class="bg-yellow-900/10 hover:bg-yellow-900/20">
            <td class="p-2 border-r border-gray-700" colspan="3"><span class="text-xs text-gray-500 italic">No ejecutada en Real</span></td>
            
            <td class="p-2 border-r border-gray-700 text-center text-yellow-500 font-bold">⚠️</td>
            
            <td class="p-2 border-r border-gray-700 text-xs text-gray-300">${formatDate(s.date)}</td>
            <td class="p-2 border-r border-gray-700 text-xs ${s.type.includes('Buy') ? 'text-green-400' : 'text-red-400'}">${s.type}</td>
            <td class="p-2 text-xs font-mono text-gray-300">${s.price}</td>
        </tr>
    `).join('');

    modal.innerHTML = `
        <div class="bg-gray-800 rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col border border-gray-700">
            <div class="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900 rounded-t-xl">
                 <div>
                    <h3 class="text-xl font-bold text-white flex items-center gap-2">
                        <span>🔍</span> Detalle de Ejecución: <span class="text-blue-400">${comparison.strategyName}</span>
                    </h3>
                    <p class="text-xs text-gray-400 mt-1">Comparando historial Real (Myfxbook) vs Backtest (SQ) en periodo superpuesto.</p>
                 </div>
                 <button class="text-gray-400 hover:text-white text-2xl px-2" onclick="document.getElementById('audit-detail-modal').remove()">&times;</button>
            </div>
            
            <div class="flex-1 overflow-auto custom-scrollbar p-0">
                <table class="w-full text-left border-collapse">
                    <thead class="bg-gray-800 sticky top-0 z-10 text-[10px] uppercase text-gray-500 font-bold">
                        <tr>
                            <th class="p-2 border-r border-gray-700 bg-gray-800 w-[30%] text-center border-b-2 border-blue-500 text-blue-400" colspan="3">Real (Myfxbook)</th>
                            <th class="p-2 border-r border-gray-700 bg-gray-800 w-[5%]"></th>
                            <th class="p-2 bg-gray-800 w-[30%] text-center border-b-2 border-purple-500 text-purple-400" colspan="3">Backtest (SQ)</th>
                        </tr>
                        <tr class="bg-gray-750">
                            <th class="p-2 border-r border-gray-700">Fecha</th>
                            <th class="p-2 border-r border-gray-700">Tipo</th>
                            <th class="p-2 border-r border-gray-700">Precio</th>
                            <th class="p-2 border-r border-gray-700 text-center">Status</th>
                            <th class="p-2 border-r border-gray-700">Fecha</th>
                            <th class="p-2 border-r border-gray-700">Tipo</th>
                            <th class="p-2">Precio</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-700/50">
                        <!-- Match Section Header -->
                        ${matchRows.length > 0 ? `<tr class="bg-gray-700/30"><td colspan="7" class="p-1 px-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Coincidencias (${matchRows.length})</td></tr>` : ''}
                        ${matchRows}
                        
                        <!-- Ghost Section Header -->
                        ${ghostRows.length > 0 ? `<tr class="bg-gray-700/30"><td colspan="7" class="p-1 px-3 text-[10px] font-bold text-red-400 uppercase tracking-wider">Fantasmas (Solo Real) (${ghostRows.length})</td></tr>` : ''}
                        ${ghostRows}

                        <!-- Missed Section Header -->
                        ${missedRows.length > 0 ? `<tr class="bg-gray-700/30"><td colspan="7" class="p-1 px-3 text-[10px] font-bold text-yellow-400 uppercase tracking-wider">Perdidas (Solo SQ) (${missedRows.length})</td></tr>` : ''}
                        ${missedRows}
                    </tbody>
                </table>
            </div>
            
            <div class="p-3 border-t border-gray-700 bg-gray-900 rounded-b-xl flex justify-end">
                <button class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm" onclick="document.getElementById('audit-detail-modal').remove()">Cerrar</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
};

const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    // Format: DD/MM/YYYY HH:mm
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('es-ES', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    });
};
