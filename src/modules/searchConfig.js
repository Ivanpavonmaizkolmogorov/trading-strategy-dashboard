import { state } from '../state.js';
import { findDatabankPortfolios } from './databank.js';
import { dom } from '../dom.js';
import { showToast } from './notifications.js';
import { parseTradesFromData, filterTradesByDate } from './sqAnalysis_v2.js?v=11';
import { toggleLoading } from '../utils.js';

// Metric configuration
const METRIC_CONFIG = {
    sharpeRatio: { goal: 'maximize', label: 'Sharpe Ratio' },
    sortinoRatio: { goal: 'maximize', label: 'Sortino Ratio' },
    totalProfit: { goal: 'maximize', label: 'Beneficio Total' },
    profitFactor: { goal: 'maximize', label: 'Profit Factor' },
    sqn: { goal: 'maximize', label: 'SQN' },
    upi: { goal: 'maximize', label: 'UPI' },
    captureRatio: { goal: 'maximize', label: 'Capture Ratio' },
    winningPercentage: { goal: 'maximize', label: '% Ganadoras' },
    monthlyAvgProfit: { goal: 'maximize', label: 'Beneficio Mensual Prom.' },
    profitMaxDD_Ratio: { goal: 'maximize', label: 'Retorno/DD' },
    monthlyProfitToDollarDD: { goal: 'maximize', label: 'Beneficio Mensual/DD' },
    gammaFlowScore: { goal: 'maximize', label: 'Gamma Flow Score' },
    maxConsecutiveWins: { goal: 'maximize', label: 'Max Victorias Cons.' },
    cagr: { goal: 'maximize', label: 'CAGR %' },

    maxDrawdown: { goal: 'minimize', label: 'Max Drawdown %' },
    maxDrawdownInDollars: { goal: 'minimize', label: 'Max Drawdown $' },
    ulcerIndexInDollars: { goal: 'minimize', label: 'Ulcer Index $' },
    maxMarginRequired: { goal: 'minimize', label: 'Margen Req.' },
    maxStagnationDays: { goal: 'minimize', label: 'Estancamiento (Días)' },
    maxStagnationTrades: { goal: 'minimize', label: 'Estancamiento (Ops)' },
    maxConsecutiveLosses: { goal: 'minimize', label: 'Max Derrotas Cons.' },
    maxConsecutiveLosingMonths: { goal: 'minimize', label: 'Meses Perdedores Cons.' }
};

export { METRIC_CONFIG };

// Wizard State
export let wizardState = {
    step: 1,
    objective: null, // 'boost', 'satellite', 'lab'
    baseStrategies: [], // Array of { index, name, checked, isFixed }
    config: {}, // Final config
    modalElement: null
};

// UI Helpers
const createCard = (id, title, icon, description, badge = '') => `
    <div class="wizard-card cursor-pointer bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-blue-500 rounded-xl p-4 transition-all duration-200 group relative" data-id="${id}">
        ${badge ? `<span class="absolute top-2 right-2 text-[10px] uppercase font-bold bg-blue-900/30 text-blue-400 px-2 py-0.5 rounded-full">${badge}</span>` : ''}
        <div class="flex items-start gap-4">
            <div class="text-3xl group-hover:scale-110 transition-transform duration-200">${icon}</div>
            <div>
                <h4 class="font-bold text-gray-200 group-hover:text-blue-400 transition-colors">${title}</h4>
                <p class="text-xs text-gray-400 mt-1 leading-relaxed">${description}</p>
            </div>
        </div>
    </div>
`;

/**
 * Entry Point: Opens the Search Wizard
 */
export const openSearchConfigModal = (selectedIndices = [], options = {}) => {
    const isStrategyIndices = options.isStrategyIndices || false;

    // 1. Initialize State
    wizardState = {
        step: 1,
        objective: null,
        baseStrategies: [], // Will be populated in step 2 or via helpers
        config: getDefaultConfig(),
        modalElement: null,
        // New: Multi-Portfolio Context
        selectedPortfolioIndices: selectedIndices || [],
        isMultiPortfolioMode: (selectedIndices && selectedIndices.length > 0)
    };

    // Pre-resolve base strategies if needed for Lab mode later
    if (wizardState.isMultiPortfolioMode) {
        if (isStrategyIndices) {
            // Called from Strategies Table: indices ARE strategy indices, use directly
            wizardState.baseStrategies = selectedIndices.map(index => mapStrategy(index, true));
            console.log(`[DIAG-WIZARD] Strategy Indices mode: ${selectedIndices.length} strategies used directly as base`);
        } else {
            // Called from Saved Portfolios Table: indices are portfolio indices, resolve strategies
            wizardState.baseStrategies = resolveMultiPortfolioBaseStrategies(selectedIndices);
        }
    } else {
        wizardState.baseStrategies = resolveBaseStrategies(selectedIndices);
    }

    // Auto-detect objective if manually selected indices (Squad Builder)
    /* 
    DISABLED: Users complained about "mode mixing". We should NOT assume Lab mode.
    Let the user choose "Boost" (Improve Selection) or "Lab" (Mix Selection) explicitly.
    if (selectedIndices.length > 0) {
        wizardState.objective = 'lab'; 
        wizardState.step = 2;
    } 
    */
    if (state.searchBasePortfolioIndex !== null) {
        // If Base Portfolio is selected, don't auto-skip, let user choose Boost vs Satellite
    }

    renderWizard();
};

const resolveMultiPortfolioBaseStrategies = (portfolioIndices) => {
    const strategyIndices = new Set();
    portfolioIndices.forEach(pIdx => {
        const portfolio = state.savedPortfolios[pIdx];
        if (portfolio?.indices) {
            portfolio.indices.forEach(idx => strategyIndices.add(idx));
        }
    });
    return Array.from(strategyIndices).map(index => mapStrategy(index, true));
};

const resolveBaseStrategies = (selectedIndices) => {
    let strategies = [];
    // ... existing single portfolio logic ...
    // Note: The logic below was based on "selectedIndices" being STRATEGY indices if passed manually (Squad Builder)
    // But currently UI passes savedPortfolio indices to openSearchConfigModal only?
    // Let's assume resolveBaseStrategies is for the Single-Portfolio flow (Strategy Selection) or Boost mode

    if (state.searchBasePortfolioIndex !== null && state.searchBasePortfolioIndex !== undefined) {
        // Base Portfolio Selection (Standard flow)
        const baseIndices = Array.from(state.searchBaseStrategyIndices || []);
        strategies = baseIndices.map(index => mapStrategy(index, false));
    }
    return strategies;
};

const mapStrategy = (index, isFixedDefault) => {
    const file = state.loadedStrategyFiles[index];
    const result = {
        index: index,
        originalIndex: index, // Added: renderContextChecklist uses originalIndex for checkbox data-index
        name: file ? (file.name || `Estrategia #${index}`) : `Estrategia #${index}`,
        checked: true,
        isFixed: isFixedDefault
    };

    // DIAGNOSTIC: Log if file not found
    if (!file) {
        console.warn(`[DIAG-WIZARD] ⚠️ mapStrategy: Index ${index} has NO file in loadedStrategyFiles!`);
    }

    return result;
};

/**
 * Scans all loaded strategies to find the earliest entry date and latest exit date.
 * @returns {{ startDate: string|null, endDate: string|null }} ISO date strings (YYYY-MM-DD) or null
 */
const getDataDateBounds = () => {
    let minDate = null;
    let maxDate = null;

    if (!state.rawStrategiesData || state.rawStrategiesData.length === 0) {
        return { startDate: null, endDate: null };
    }

    for (const strategyTrades of state.rawStrategiesData) {
        if (!strategyTrades || strategyTrades.length === 0) continue;

        for (const trade of strategyTrades) {
            // Parse entry_date
            if (trade.entry_date) {
                try {
                    // Handle YYYY.MM.DD HH:MM:SS format
                    const entryStr = String(trade.entry_date).replace(/\./g, '-').split(' ')[0];
                    const entryDate = new Date(entryStr);
                    if (!isNaN(entryDate.getTime())) {
                        if (!minDate || entryDate < minDate) minDate = entryDate;
                    }
                } catch (e) { /* ignore parsing errors */ }
            }
            // Parse exit_date
            if (trade.exit_date) {
                try {
                    const exitStr = String(trade.exit_date).replace(/\./g, '-').split(' ')[0];
                    const exitDate = new Date(exitStr);
                    if (!isNaN(exitDate.getTime())) {
                        if (!maxDate || exitDate > maxDate) maxDate = exitDate;
                    }
                } catch (e) { /* ignore parsing errors */ }
            }
        }
    }

    // Format as YYYY-MM-DD for input[type=date]
    const formatDate = (d) => {
        if (!d) return null;
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    return {
        startDate: formatDate(minDate),
        endDate: formatDate(maxDate)
    };
};

const getDefaultConfig = () => {
    const dateBounds = getDataDateBounds();
    return {
        minSize: 1,
        maxSize: 7,
        correlationThreshold: 0.3,
        metric: 'profitMaxDD_Ratio',
        goal: 'maximize',
        // Default to using the actual data range if available
        useAllDates: !(dateBounds.startDate && dateBounds.endDate),
        startDate: dateBounds.startDate,
        endDate: dateBounds.endDate,
        searchMethod: 'auto',
        normalizationEnabled: false,
        satelliteCorrelationThreshold: 0.90,
        reShuffleInterval: 30
    };
};

// Main Render Loop
export const renderWizard = () => {
    // Create Modal if not exists
    if (!wizardState.modalElement) {
        wizardState.modalElement = document.createElement('div');
        wizardState.modalElement.className = 'fixed inset-0 bg-black/90 flex items-center justify-center z-50 animate-fade-in backdrop-blur-sm';
        document.body.appendChild(wizardState.modalElement);
    }

    const { step } = wizardState;
    let contentHTML = '';
    let footerHTML = '';
    let title = '';
    let icon = '';

    // --- STEP CONTENT ---
    if (step === 1) {
        title = 'Seleccionar Objetivo';
        icon = '🎯';
        if (wizardState.isMultiPortfolioMode) {
            contentHTML = `
                <div class="grid grid-cols-1 gap-4 mt-2">
                    <div class="p-3 bg-blue-900/30 border border-blue-700/50 rounded-lg text-center text-sm text-blue-200 mb-2">
                        Has seleccionado <strong>${wizardState.selectedPortfolioIndices.length} portafolios</strong>.
                    </div>
                    ${createCard('boost', 'Multi-Mejorar', '🚀⚡', 'Prueba combinaciones para mejorar TODOS los portafolios seleccionados. Mantiene las mejores estrategias y reemplaza las peores.')}
                    ${createCard('satellite', 'Multi-Satélite', '🛰️⚡', 'Encuentra un portafolio descorrelacionado de TODOS los seleccionados simultáneamente.')}
                    ${createCard('lab', 'Multi-Laboratorio', '🧪🧬', 'Combina estrategias de TODOS los portafolios seleccionados para crear híbridos.')}
                    ${createCard('hybrid', 'Satélite Híbrido', '🛰️🧪', 'Busca descorrelación externa Y mejora de rendimiento (Triple Filtro).', 'Nuevo')}
                    ${createCard('hybrid_satellite', 'Satélite Evolutivo', '🛰️🧬', 'Combina lo mejor de dos mundos: Potencia Evolutiva + Descorrelación. Genera estrategias Alpha que no se mueven igual que tu Base.', 'Nuevo')}
                </div>
            `;
        } else {
            contentHTML = `
                <div class="grid grid-cols-1 gap-4 mt-2">
                    ${createCard('boost', 'Mejorar y Reparar', '🚀', 'Mejora un portafolio existente o reemplaza estrategias degradadas.', 'Popular')}
                    ${createCard('satellite', 'Crear Satélite', '🛰️', 'Encuentra un portafolio nuevo totalmente descorrelacionado de tu Base.')}
                    ${createCard('lab', 'Laboratorio', '🧪', 'Entorno de pruebas para combinaciones manuales y permutaciones.')}
                    ${createCard('hybrid', 'Satélite Híbrido', '🛰️🧪', 'Usa tu base para minar, pero exige descorrelación externa (Triple Filtro).')}
                    ${createCard('evolution', 'Evolución Genética', '🧬🚀', 'Usa los mejores hallazgos del DataBank como semillas para seguir mejorando.', 'Nuevo')}
                    ${createCard('hybrid_satellite', 'Satélite Evolutivo', '🛰️🧬', 'Combina lo mejor de dos mundos: Potencia Evolutiva + Descorrelación. Genera estrategias Alpha que no se mueven igual que tu Base.', 'Nuevo')}
                </div>
            `;
        }
    } else if (step === 2) {
        if (wizardState.objective === 'boost' || wizardState.objective === 'hybrid') {
            title = 'Configurar Equipo Base';
            icon = '🛡️';
            contentHTML = renderContextChecklist(
                wizardState.objective === 'hybrid'
                    ? 'Selecciona las estrategias BASE para minería. (También se usarán como referencia para evitar correlación).'
                    : 'Selecciona las estrategias que quieres MANTENER (Fijas). Desmarca para Reemplazar.'
            );
        } else if (wizardState.objective === 'satellite') {
            title = 'Referencia Satélite';
            icon = '🛰️';
            contentHTML = renderContextChecklist(
                'Selecciona las estrategias de REFERENCIA. Desmarca las que quieras EXCLUIR de la correlación y del generador (BAN GLOBAL).'
            );
        } else if (wizardState.objective === 'evolution') {
            title = 'Selección de Semillas';
            icon = '🧬';

            const currentDatabankCount = state.databankPortfolios.length;
            const isEmpty = currentDatabankCount < 2;

            // Default top N
            if (!wizardState.evolutionTopN) wizardState.evolutionTopN = 10;
            const maxVal = Math.max(2, currentDatabankCount);

            contentHTML = `
                <div class="bg-indigo-900/20 border border-indigo-700/50 rounded-lg p-6 text-center">
                    <div class="text-4xl mb-4">🧬 🚀 📈</div>
                    <h3 class="text-xl font-bold text-gray-200 mb-2">Evolución Genética</h3>
                    <p class="text-sm text-gray-400 max-w-sm mx-auto mb-6">
                        El sistema tomará los <span class="text-white font-bold">Mejores Portafolios</span> del DataBank actual y buscará nuevas combinaciones entre sus estrategias.
                    </p>
                    
                    ${isEmpty ? `
                        <div class="bg-yellow-900/30 border border-yellow-600/50 p-4 rounded-lg mb-4">
                            <div class="text-yellow-400 font-bold mb-1">⚠️ DataBank con pocos datos</div>
                            <p class="text-xs text-yellow-200/80">
                                No tienes suficientes portafolios (mín. 2).<br>
                                El sistema iniciará en <strong>Fase 1: Sembrado Automático</strong> (Generación Aleatoria) hasta poblar el DataBank.
                            </p>
                        </div>
                         <div class="opacity-50 pointer-events-none filter grayscale">
                    ` : `<div>`}
                    
                         <div class="bg-gray-800/50 p-4 rounded-lg border border-gray-700 max-w-sm mx-auto">
                            <div class="flex justify-between items-center mb-2">
                                 <label class="text-xs font-bold text-gray-400 uppercase">Semillas (Top N)</label>
                                 <span id="wiz-evo-val" class="font-mono text-xl text-blue-400 font-bold">${Math.min(wizardState.evolutionTopN, maxVal)}</span>
                            </div>
                            <input type="range" id="wiz-evo-range" min="2" max="${maxVal}" value="${Math.min(wizardState.evolutionTopN, maxVal)}" 
                                class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500 mb-2">
                            <div class="flex justify-between text-[10px] text-gray-500">
                                <span>Top 2</span>
                                <span>Todos (${maxVal})</span>
                            </div>
                         </div>
                         
                         <div class="mt-4 text-xs text-indigo-300 bg-indigo-900/30 py-2 px-3 rounded inline-block border border-indigo-500/30">
                            ℹ️ Esto creará un "Pool Genético" restringido para refinar la calidad.
                         </div>
                    </div>
                    
                    <!-- EXCLUSION CHECKLIST (Added for Global Ban) -->
                    <div class="mt-4 bg-gray-800/40 border border-gray-700 rounded-lg p-4">
                        <div class="text-center mb-2">
                             <span class="font-bold text-gray-300">Exclusión Global</span>
                        </div>
                        ${renderContextChecklist('Desmarca para PROHIBIR esta estrategia en el proceso evolutivo.')}
                    </div>
                </div>
            `;
        } else if (wizardState.objective === 'hybrid_satellite') {
            title = 'Configuración Satélite Evolutivo';
            icon = '🛰️🧬';

            const currentDatabankCount = state.databankPortfolios.length;
            const isEmpty = currentDatabankCount < 2;
            const maxVal = Math.max(2, currentDatabankCount);
            if (!wizardState.evolutionTopN) wizardState.evolutionTopN = 10;
            const baseName = state.savedPortfolios[state.searchBasePortfolioIndex]?.name || 'Selección (Multi)';

            contentHTML = `
                <div class="space-y-6">
                    <!-- Section A: Evolution Config -->
                    <div class="bg-indigo-900/20 border border-indigo-700/50 rounded-lg p-4 text-center">
                        <div class="text-2xl mb-2">🧬 Evolución</div>
                        <p class="text-xs text-gray-400 mb-4">
                            Semillas del DataBank
                        </p>
                        
                        ${isEmpty ? `
                            <div class="bg-yellow-900/30 border border-yellow-600/50 p-2 rounded mb-2">
                                <span class="text-xs text-yellow-300">⚠️ Pocos datos. Iniciará con Sembrado.</span>
                            </div>
                        ` : ''}

                         <div class="bg-gray-800/50 p-3 rounded-lg border border-gray-700 max-w-sm mx-auto">
                            <div class="flex justify-between items-center mb-1">
                                 <label class="text-xs font-bold text-gray-400 uppercase">Top N</label>
                                 <span id="wiz-evo-val" class="font-mono text-lg text-blue-400 font-bold">${Math.min(wizardState.evolutionTopN, maxVal)}</span>
                            </div>
                            <input type="range" id="wiz-evo-range" min="2" max="${maxVal}" value="${Math.min(wizardState.evolutionTopN, maxVal)}" 
                                class="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500">
                         </div>
                    </div>

                    <!-- Section B: Satellite Config (Checklist) -->
                    <div class="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
                        <div class="text-center mb-2">
                            <span class="text-2xl">🛰️</span>
                            <span class="font-bold text-gray-200">Referencia Satélite</span>
                        </div>
                        
                        ${renderContextChecklist('Desmarca para EXCLUSIÓN GLOBAL (No se usará ni para correlación ni para generación).')}
                    </div>
                    
                    <div class="text-center text-xs text-gray-500 italic mt-2">
                        El bucle evolucionará estrategias que NO se parezcan a las seleccionadas arriba.
                    </div>
                </div>
            `;
        } else {
            title = 'Laboratorio de Minería';
            icon = '🧪';
            // Count total loaded strategies
            const totalLoaded = state.loadedStrategyFiles.length;
            const baseCount = wizardState.baseStrategies.filter(s => s.checked).length; // Though we might auto-select all, conceptually base is what user selected initially

            contentHTML = `
                <div class="bg-indigo-900/20 border border-indigo-700/50 rounded-lg p-6 text-center">
                    <div class="text-4xl mb-4">⛏️ 🧬 📈</div>
                    <h3 class="text-xl font-bold text-gray-200 mb-2">Modo Minería Genética</h3>
                    <p class="text-sm text-gray-400 max-w-sm mx-auto mb-4">
                        ${wizardState.isMultiPortfolioMode
                    ? 'El sistema buscará combinaciones que superen al <span class="text-white font-bold">Peor Portafolio</span> de los seleccionados.'
                    : 'El sistema intentará mejorar tu <span class="text-white font-bold">Portafolio Base</span> haciendo cruces.'}
                    </p>
                    
                    <div class="grid grid-cols-2 gap-4 text-left bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                        <div>
                            <div class="text-xs text-gray-500 uppercase">Pool de Minería</div>
                            <div class="text-xl font-mono text-green-400">${totalLoaded} Estrategias</div>
                            ${state.quarantinedStrategyNames.size > 0 ? `<div class="text-[10px] text-red-400 font-bold mt-1">⚠️ ${state.quarantinedStrategyNames.size} en Cuarentena</div>` : ''}
                        </div>
                        <div>
                            <div class="text-xs text-gray-500 uppercase">Base de Referencia</div>
                            <div class="text-xl font-mono text-blue-400">
                                ${wizardState.isMultiPortfolioMode
                    ? resolveMultiPortfolioBaseStrategies(wizardState.selectedPortfolioIndices).length
                    : resolveBaseStrategies([]).length} Estrategias
                            </div>
                        </div>
                    </div>

                    ${(() => {
                    // Logic to display Target Score (Base)
                    // Needs to use current metric setting (defaulting if needed)
                    const currentMetricKey = wizardState.config.metric || 'profitMaxDD_Ratio';
                    let targetScore = 0;
                    let label = 'Objetivo (Base)';

                    // Helper to safely get metric value
                    const getMetric = (portfolio) => {
                        if (!portfolio || !portfolio.metrics) return 0;
                        // normalize key access if needed (usually matching backend keys)
                        return portfolio.metrics[currentMetricKey] || 0;
                    };

                    if (wizardState.isMultiPortfolioMode) {
                        // Find MIN Score among selected
                        const scores = wizardState.selectedPortfolioIndices
                            .map(idx => state.savedPortfolios[idx])
                            .filter(p => p)
                            .map(p => getMetric(p));

                        targetScore = scores.length > 0 ? Math.min(...scores) : 0;
                        label = 'Objetivo (Mínimo)';
                    } else {
                        // Single Base
                        const baseIdx = state.searchBasePortfolioIndex;
                        if (baseIdx !== null && state.savedPortfolios[baseIdx]) {
                            targetScore = getMetric(state.savedPortfolios[baseIdx]);
                        }
                    }

                    // Only show if score is relevant
                    if (targetScore !== 0) {
                        return `
                                <div class="mt-4 text-xs bg-indigo-900/30 border border-indigo-500/30 rounded px-3 py-2 flex justify-between items-center">
                                    <span class="text-indigo-300">🎯 ${label}:</span>
                                    <div class="text-right">
                                        <div class="font-bold text-indigo-400">${currentMetricKey} &gt; ${targetScore.toFixed(4)}</div>
                                    </div>
                                </div>
                             `;
                    }
                    return '';
                })()}
                </div>
            `;
        }
    } else if (step === 3) {
        title = 'Parámetros de Búsqueda';
        icon = '⚙️';
        contentHTML = renderParametersForm();
    }

    // --- FOOTER BUTTONS ---
    if (step === 1) {
        footerHTML = `<button id="wiz-cancel" class="text-gray-500 hover:text-white transition-colors">Cancelar</button>`;
    } else {
        footerHTML = `
            <div class="flex justify-between w-full">
                <button id="wiz-back" class="text-gray-400 hover:text-white px-4 py-2">← Atrás</button>
                <div class="flex gap-3">
                    <button id="wiz-cancel" class="text-gray-500 hover:text-white px-4 py-2">Cancelar</button>
                    ${step === 3
                ? `<button id="wiz-start" class="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-8 py-2 rounded-lg font-bold shadow-lg shadow-blue-900/30 transform hover:scale-105 transition-all flex items-center gap-2"><span>🚀</span> Lanzar Búsqueda</button>`
                : `<button id="wiz-next" class="bg-gray-700 hover:bg-gray-600 text-white px-6 py-2 rounded-lg font-bold transition-colors">Siguiente →</button>`
            }
                </div>
            </div>
        `;
    }

    // --- RENDER ---
    wizardState.modalElement.innerHTML = `
        <div class="bg-gray-900 rounded-2xl border border-gray-700 w-[550px] max-w-full shadow-2xl flex flex-col max-h-[90vh]">
            <!-- Header -->
            <div class="p-6 border-b border-gray-800 flex justify-between items-center bg-gray-800/30 rounded-t-2xl">
                <div>
                    <h2 class="text-xl font-bold text-white flex items-center gap-2"><span>${icon}</span> ${title}</h2>
                    <div class="flex gap-1 mt-2">
                        <div class="h-1 w-8 rounded-full ${step >= 1 ? 'bg-blue-500' : 'bg-gray-700'}"></div>
                        <div class="h-1 w-8 rounded-full ${step >= 2 ? 'bg-blue-500' : 'bg-gray-700'}"></div>
                        <div class="h-1 w-8 rounded-full ${step >= 3 ? 'bg-blue-500' : 'bg-gray-700'}"></div>
                    </div>
                </div>
                <button id="wiz-close" class="text-gray-500 hover:text-white text-2xl">&times;</button>
            </div>

            <!-- Body -->
            <div class="p-6 overflow-y-auto custom-scrollbar flex-1">
                ${contentHTML}
            </div>

            <!-- Footer -->
            <div class="p-4 border-t border-gray-800 bg-gray-800/30 rounded-b-2xl flex justify-end">
                ${footerHTML}
            </div>
        </div>
    `;

    // --- ATTACH EVENTS ---
    attachWizardEvents();
};

const renderContextChecklist = (instruction) => {
    // Helper to format metrics (assuming it exists globally or is defined elsewhere)
    const formatMetric = (value) => (value || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    // Create a Set of checked strategy indices for quick lookup
    const selectedIndices = new Set(wizardState.baseStrategies.filter(s => s.checked).map(s => s.originalIndex));

    return `
        <div class="space-y-3">
            <p class="text-sm text-gray-400">${instruction}</p>
            <div class="bg-gray-950/50 rounded-lg border border-gray-700 p-2 max-h-[300px] overflow-y-auto custom-scrollbar">
                ${wizardState.baseStrategies.map(s => {
        const isChecked = selectedIndices.has(s.originalIndex); // Default checks based on selection
        const isQuarantined = state.quarantinedStrategyNames.has(s.name); // Check Quarantine

        // Determine label classes based on state
        const labelClasses = `flex items-center gap-2 p-1.5 rounded cursor-pointer transition-colors ${isChecked && !isQuarantined ? 'bg-indigo-900/30' : 'hover:bg-gray-700/50'} ${isQuarantined ? 'opacity-50 cursor-not-allowed' : ''}`;

        // Checkbox logic:
        // If Quarantined: Disabled and Unchecked (visual)
        const checkboxHtml = `
                        <input type="checkbox" class="wiz-context-checkbox w-4 h-4 text-indigo-500 rounded bg-gray-700 border-gray-600 focus:ring-indigo-500" 
                            data-index="${s.originalIndex}" 
                            ${!isQuarantined && isChecked ? 'checked' : ''}
                            ${isQuarantined ? 'disabled' : ''}>
                    `;

        return `
                        <label class="${labelClasses}">
                            ${checkboxHtml}
                            <div class="flex flex-col min-w-0">
                                <span class="text-xs font-medium ${isQuarantined ? 'text-red-400 line-through' : 'text-gray-300'} truncate" title="${s.name}">${s.name} ${isQuarantined ? '(Vetada)' : ''}</span>
                                <div class="flex items-center gap-2 text-[10px] text-gray-500">
                                    <span>Net: $${formatMetric(s.netProfit)}</span>
                                    <span>DD: $${formatMetric(s.maxDrawdown)}</span>
                                </div>
                            </div>
                        </label>
                    `;
    }).join('')}
            </div>
            <div class="flex justify-between text-xs text-gray-500 px-1">
                <span id="wiz-selection-count">${wizardState.baseStrategies.filter(s => s.checked && !state.quarantinedStrategyNames.has(s.name)).length} seleccionadas</span>
                <div class="flex gap-2">
                     <button id="wiz-check-corr" class="text-xs text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1 transition-colors">
                        📊 Analizar Correlación
                    </button>
                    <button id="wiz-toggle-all" class="text-sky-500 hover:text-sky-400">Marcar/Desmarcar Todo</button>
                </div>
            </div>
        </div>
    `;
};

const renderParametersForm = () => {
    // Reuse logic structure but simplified UI
    const config = wizardState.config;
    return `
        <div class="space-y-6">
            <!-- Metric & Goal -->
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Métrica Objetivo</label>
                    <select id="wiz-metric" class="w-full bg-gray-800 border border-gray-600 text-white text-sm rounded-lg p-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                        ${Object.keys(METRIC_CONFIG).map(k => `
                            <option value="${k}" ${config.metric === k ? 'selected' : ''}>${METRIC_CONFIG[k].label}</option>
                        `).join('')}
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Objetivo</label>
                    <select id="wiz-goal" class="w-full bg-gray-800 border border-gray-600 text-white text-sm rounded-lg p-2">
                        <option value="maximize" ${config.goal === 'maximize' ? 'selected' : ''}>Maximizar</option>
                        <option value="minimize" ${config.goal === 'minimize' ? 'selected' : ''}>Minimizar</option>
                    </select>
                </div>
            </div>

            <!-- Portfolio Size Constraints (Min/Max) -->
            <div>
                 <label class="text-xs font-bold text-gray-500 uppercase mb-2 block">Tamaño del Portafolio (Estrategias)</label>
                 <div class="grid grid-cols-2 gap-4">
                    <div>
                        <div class="flex justify-between mb-1">
                            <label class="text-[10px] text-gray-400 uppercase">Mínimo</label>
                        </div>
                        <input type="number" id="wiz-size-min" min="1" max="50" value="${config.minSize || 1}" 
                            class="w-full bg-gray-800 border border-gray-600 text-white text-sm rounded-lg p-2 text-center focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                    </div>
                    <div>
                        <div class="flex justify-between mb-1">
                            <label class="text-[10px] text-gray-400 uppercase">Máximo</label>
                        </div>
                        <input type="number" id="wiz-size-max" min="1" max="50" value="${config.maxSize}" 
                            class="w-full bg-gray-800 border border-gray-600 text-white text-sm rounded-lg p-2 text-center focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                    </div>
                 </div>
            </div>

            <!-- MT5 Incubation -->
            <div>
                <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Días Mínimos en MT5 (Incubación)</label>
                <div class="flex gap-2">
                    <input type="number" id="wiz-mt5-min-days" min="0" max="3650" value="${state.mt5IncubationMinDays || 0}" 
                        class="w-full bg-gray-800 border border-gray-600 text-white text-sm rounded-lg p-2 text-center focus:border-blue-500 focus:ring-1 focus:ring-blue-500" title="Excluir estrategias con menos días enchufadas. 0 = sin filtro.">
                </div>
                <p class="text-[10px] text-gray-500 mt-1 italic">
                    * Las estrategias con menos días serán excluidas de la búsqueda.
                </p>
            </div>

            <!-- Correlation & Dates -->
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Correlación Interna Máx</label>
                    <div class="flex gap-2">
                        <input type="number" id="wiz-corr" step="0.05" min="0.1" max="1.0" value="${config.correlationThreshold}" 
                             class="w-full bg-gray-800 border border-gray-600 text-white text-sm rounded-lg p-2 text-center" title="Límite entre estrategias dentro del nuevo portafolio">
                    </div>
                </div>
                ${wizardState.objective === 'satellite' || wizardState.objective === 'hybrid' || wizardState.objective === 'hybrid_satellite' ? `
                    <div class="flex gap-2">
                        <input type="number" id="wiz-sat-corr" step="0.05" min="0.1" max="1.0" value="${config.satelliteCorrelationThreshold !== undefined ? config.satelliteCorrelationThreshold : 0.90}" 
                             class="w-full bg-gray-900 border border-sky-600 text-sky-400 font-bold text-sm rounded-lg p-2 text-center" title="Límite del nuevo portafolio vs tu Base">
                    </div>
                </div>
                ` : `
                <div class="space-y-4">
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Rango de Datos</label>
                        <div class="space-y-2">
                             <label class="flex items-center gap-2 p-2 bg-gray-800 border border-gray-600 rounded-lg cursor-pointer">
                                <input type="checkbox" id="wiz-dates" class="form-checkbox h-4 w-4 text-blue-500 bg-gray-700 border-gray-500 rounded" ${config.useAllDates ? 'checked' : ''}>
                                <span class="text-xs text-gray-300">Usar Todo el Historial</span>
                            </label>
                            
                            <div id="wiz-date-inputs" class="${config.useAllDates ? 'hidden' : 'flex'} gap-2 animate-fade-in">
                                <div class="flex-1">
                                    <label class="text-[10px] text-gray-500 uppercase">Inicio</label>
                                    <input type="date" id="wiz-date-start" value="${config.startDate || ''}" 
                                        class="w-full bg-gray-800 border border-gray-600 text-white text-xs rounded p-1.5 focus:border-blue-500 max-w-[120px]">
                                </div>
                                <div class="flex-1">
                                    <label class="text-[10px] text-gray-500 uppercase">Fin</label>
                                    <input type="date" id="wiz-date-end" value="${config.endDate || ''}" 
                                        class="w-full bg-gray-800 border border-gray-600 text-white text-xs rounded p-1.5 focus:border-blue-500 max-w-[120px]">
                                </div>
                            </div>
                        </div>
                    </div>

                    ${wizardState.objective === 'lab' || wizardState.objective === 'hybrid' ? `
                    <div class="space-y-2">
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Intervalo Visual (Re-shuffle)</label>
                        <div class="flex gap-2 items-center">
                            <input type="number" id="wiz-reshuffle" step="5" min="5" value="${config.reShuffleInterval || 30}" 
                                class="w-full bg-gray-800 border border-gray-600 text-white text-sm rounded-lg p-2 text-center" title="Frecuencia visual de 'Analizando...'">
                            <span class="text-xs text-gray-500">its.</span>
                        </div>

                        ${(() => {
                // --- LOGIC TO DISPLAY BASE KPI ---
                const metricKey = config.metric;
                let targetScore = null;
                let label = 'Objetivo (Base)';

                // CASE A: Multi-Portfolio (Min Score)
                if (wizardState.isMultiPortfolioMode) {
                    const scores = wizardState.selectedPortfolioIndices
                        .map(idx => state.savedPortfolios[idx])
                        .filter(p => p)
                        .map(p => {
                            // Robust metric getter
                            if (typeof p[metricKey] !== 'undefined') return p[metricKey];
                            if (p.metrics && typeof p.metrics[metricKey] !== 'undefined') return p.metrics[metricKey];
                            return 0;
                        });

                    if (scores.length > 0) {
                        targetScore = Math.min(...scores);
                        label = 'Objetivo (Mínimo)';
                    }
                }
                // CASE B: Single Portfolio (Base Index)
                else {
                    const baseIndex = state.searchBasePortfolioIndex;
                    if (baseIndex !== null && baseIndex !== undefined) {
                        const basePortfolio = state.savedPortfolios[baseIndex];
                        if (basePortfolio) {
                            if (typeof basePortfolio[metricKey] !== 'undefined') targetScore = basePortfolio[metricKey];
                            else if (basePortfolio.metrics && typeof basePortfolio.metrics[metricKey] !== 'undefined') targetScore = basePortfolio.metrics[metricKey];
                        }
                    }
                }

                if (targetScore !== null && targetScore !== undefined) {
                    // Format value (simple 2-4 decimals)
                    const formattedVal = typeof targetScore === 'number' ? targetScore.toLocaleString('en-US', { maximumFractionDigits: 4 }) : targetScore;
                    const metricLabel = METRIC_CONFIG[metricKey]?.label || metricKey;

                    return `
                                    <div class="mt-2 text-xs bg-indigo-900/30 border border-indigo-500/30 rounded px-2 py-1.5 flex justify-between items-center">
                                        <span class="text-indigo-300">🎯 ${label}:</span>
                                        <div class="text-right">
                                            <div class="font-bold text-indigo-400">${metricLabel} > ${formattedVal}</div>
                                        </div>
                                    </div>
                                  `;
                }
                return '';
            })()}
                    </div>
                    ` : ''}
                </div>
                `}
            </div>
            
             </div>
             
             <!-- Strategy Source Pool -->
             <div class="bg-indigo-900/20 rounded-lg border border-indigo-700/50 p-3">
                 <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Pool de Búsqueda (Fuente)</label>
                 <div class="flex gap-4">
                     <label class="flex items-center gap-2 cursor-pointer">
                         <input type="checkbox" id="wiz-source-unused" class="form-checkbox h-4 w-4 text-emerald-500 bg-gray-800 border-gray-600 rounded focus:ring-emerald-500" checked>
                         <span class="text-sm text-gray-300">No Usadas (Nuevas)</span>
                     </label>
                     <label class="flex items-center gap-2 cursor-pointer">
                         <input type="checkbox" id="wiz-source-linked" class="form-checkbox h-4 w-4 text-blue-500 bg-gray-800 border-gray-600 rounded focus:ring-blue-500" checked>
                         <span class="text-sm text-gray-300">Vinculadas (En Uso)</span>
                     </label>
                 </div>
                 <p class="text-[10px] text-gray-500 mt-1 italic">
                    * Define qué estrategias puede usar el algoritmo para construir portafolios.
                 </p>
             </div>

             <!-- Search Method -->
             <div class="bg-gray-800/50 rounded-lg border border-gray-700 p-3">
                 <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Algoritmo</label>
                 <div class="flex gap-4">
                     <label class="flex items-center gap-2 cursor-pointer">
                         <input type="radio" name="wiz-method" value="auto" class="text-blue-500 bg-gray-700 border-gray-600 focus:ring-blue-500" ${config.searchMethod === 'auto' ? 'checked' : ''}>
                         <span class="text-sm text-gray-300">Auto</span>
                     </label>
                     <label class="flex items-center gap-2 cursor-pointer">
                         <input type="radio" name="wiz-method" value="monte_carlo" class="text-green-500 bg-gray-700 border-gray-600 focus:ring-green-500" ${config.searchMethod === 'monte_carlo' ? 'checked' : ''}>
                         <span class="text-sm text-gray-300">Monte Carlo</span>
                     </label>
                     <label class="flex items-center gap-2 cursor-pointer">
                         <input type="radio" name="wiz-method" value="brute_force" class="text-purple-500 bg-gray-700 border-gray-600 focus:ring-purple-500" ${config.searchMethod === 'brute_force' ? 'checked' : ''}>
                         <span class="text-sm text-gray-300">Fuerza Bruta</span>
                     </label>
                 </div>
             </div>

             <!-- Pre-Normalization (Risk) -->
             <div class="bg-indigo-900/20 rounded-lg border border-indigo-700/50 p-3">
                 <label class="flex items-center gap-2 cursor-pointer mb-2">
                     <input type="checkbox" id="wiz-norm-enabled" class="form-checkbox h-4 w-4 text-indigo-500 bg-gray-800 border-gray-600 rounded focus:ring-indigo-500" ${config.normalizationEnabled ? 'checked' : ''}>
                     <span class="text-sm font-bold text-indigo-300 uppercase">Pre-Normalización (Riesgo)</span>
                 </label>
                 
                 <div id="wiz-norm-controls" class="${config.normalizationEnabled ? '' : 'hidden opacity-50 pointer-events-none'} transition-all duration-200 grid grid-cols-2 gap-4 mt-2">
                     <div>
                         <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Métrica de Riesgo</label>
                         <select id="wiz-norm-metric" class="w-full bg-gray-800 border border-gray-600 text-white text-sm rounded-lg p-2">
                             <option value="max_dd" ${config.normalizationMetric === 'max_dd' ? 'selected' : ''}>Max Drawdown ($)</option>
                             <option value="ulcer_index" ${config.normalizationMetric === 'ulcer_index' ? 'selected' : ''}>Ulcer Index ($)</option>
                         </select>
                     </div>
                     <div>
                         <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Objetivo ($)</label>
                         <input type="number" id="wiz-norm-target" step="100" min="100" value="${config.normalizationTarget || 1000}" 
                             class="w-full bg-gray-800 border border-gray-600 text-white text-sm rounded-lg p-2 text-center">
                     </div>
                 </div>
                 <p class="text-[10px] text-gray-500 mt-2 italic">
                    * Normaliza cada candidato ANTES de filtrar. Útil para comparar peras con peras.
                 </p>
             </div>
        </div>
    `;
};

const attachWizardEvents = () => {
    const modal = wizardState.modalElement;

    // Global Close
    const closeBtn = modal.querySelector('#wiz-close');
    const cancelBtn = modal.querySelector('#wiz-cancel');
    const closeModal = () => { if (modal) modal.remove(); wizardState.modalElement = null; };
    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    // STEP 1: Objectives
    if (wizardState.step === 1) {
        modal.querySelectorAll('.wizard-card').forEach(card => {
            card.onclick = () => {
                wizardState.objective = card.dataset.id;

                // --- DYNAMIC POPULATION FOR EVOLUTION / HYBRID_SATELLITE ---
                // Populate checks with ALL loaded strategies for Global Exclusion
                if ((wizardState.objective === 'evolution' || wizardState.objective === 'hybrid_satellite') && wizardState.baseStrategies.length === 0) {
                    console.log('[SearchConfig] Auto-populating strategies for Global Exclusion checklist (From Saved Portfolios)...');

                    // Collect ALL unique strategy indices used in any Saved Portfolio
                    const uniqueIndices = new Set();
                    if (state.savedPortfolios && state.savedPortfolios.length > 0) {
                        state.savedPortfolios.forEach(p => {
                            if (p.indices) p.indices.forEach(i => uniqueIndices.add(i));
                        });
                    }

                    wizardState.baseStrategies = Array.from(uniqueIndices).sort((a, b) => a - b).map(index => mapStrategy(index, true));
                    console.log(`[SearchConfig] Found ${uniqueIndices.size} unique strategies in Saved Portfolios for exclusion list.`);
                }

                wizardState.step = 2;
                renderWizard();
            };
        });
    }

    // NEW: Auto-Check Function
    const checkAndWarnCorrelation = async () => {
        // Only relevant for Boost/Hybrid where Base is used
        if (wizardState.objective === 'satellite') return;

        const strategies = [];
        const selectedContextIndices = [];

        wizardState.baseStrategies.forEach(s => {
            const isQuarantined = state.quarantinedStrategyNames.has(s.name);
            if (s.checked && !isQuarantined && state.loadedStrategyFiles[s.originalIndex]) {
                strategies.push(state.loadedStrategyFiles[s.originalIndex]);
                selectedContextIndices.push(s.originalIndex);
            }
        });

        if (strategies.length < 2) return;

        try {
            // Use existing warning container or create one
            let warnContainer = document.getElementById('wiz-corr-warning');
            if (!warnContainer) {
                // Try to find Step 3 container
                const step3Container = document.getElementById('wiz-corr')?.closest('.grid');
                if (step3Container) {
                    warnContainer = document.createElement('div');
                    warnContainer.id = 'wiz-corr-warning';
                    warnContainer.className = 'col-span-2 hidden mt-2 p-3 bg-red-900/30 border border-red-700/50 rounded-lg flex items-start gap-3 animate-fade-in';
                    // Insert after the grid
                    step3Container.parentNode.insertBefore(warnContainer, step3Container.nextSibling);
                } else {
                    // Fallback for Step 2 if user goes back (keep finding checkbox list)
                    const checklist = wizardState.modalElement.querySelector('.wiz-context-checkbox')?.closest('.space-y-3');
                    if (checklist) {
                        warnContainer = document.createElement('div');
                        warnContainer.id = 'wiz-corr-warning';
                        warnContainer.className = 'hidden mt-2 p-3 bg-red-900/30 border border-red-700/50 rounded-lg flex items-start gap-3 animate-fade-in';
                        checklist.appendChild(warnContainer);
                    }
                }
            }

            if (warnContainer) warnContainer.classList.add('hidden'); // Reset

            const payload = {
                portfolio_indices: selectedContextIndices.map((_, i) => i), // Sequential indices matching the pre-filtered array
                strategies_data: selectedContextIndices.map(i => state.rawStrategiesData[i])
            };

            const response = await fetch('/analysis/correlation-matrix', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) return;
            const result = await response.json();
            const matrix = result.matrix;
            const threshold = wizardState.config.correlationThreshold || 0.30;

            let conflicts = [];
            for (let i = 0; i < matrix.length; i++) {
                for (let j = i + 1; j < matrix.length; j++) {
                    if (matrix[i][j] > threshold) {
                        conflicts.push({
                            s1: state.loadedStrategyFiles[selectedContextIndices[i]].name,
                            s2: state.loadedStrategyFiles[selectedContextIndices[j]].name,
                            val: matrix[i][j]
                        });
                    }
                }
            }

            if (conflicts.length > 0) {
                if (warnContainer) {
                    // Sort conflicts by severity
                    conflicts.sort((a, b) => b.val - a.val);
                    const topConflict = conflicts[0];

                    warnContainer.innerHTML = `
                        <div class="text-2xl">⚠️</div>
                        <div class="flex-1">
                            <h4 class="text-sm font-bold text-red-400">Conflicto de Correlación Detectado</h4>
                            <p class="text-xs text-gray-300 mt-1">
                                Has seleccionado ${conflicts.length} pares de estrategias que superan el límite (${threshold}).
                                <br>El algoritmo <strong>NO podrá iniciar</strong> si mantienes estas estrategias fijas.
                            </p>
                            <div class="mt-2 text-[10px] text-gray-400 bg-gray-900/50 p-2 rounded border border-gray-700">
                                <strong>Mayor conflicto:</strong> ${topConflict.val.toFixed(2)}<br>
                                • ${topConflict.s1}<br>
                                • ${topConflict.s2}
                            </div>
                            <button id="wiz-fix-corr" class="mt-2 text-xs text-red-300 underline hover:text-white">Ver Matriz Completa</button>
                        </div>
                     `;
                    warnContainer.classList.remove('hidden');

                    const fixBtn = warnContainer.querySelector('#wiz-fix-corr');
                    if (fixBtn) fixBtn.onclick = () => document.getElementById('wiz-check-corr').click();
                }
            }

        } catch (e) {
            console.error("Auto-corr check fail", e);
        }
    };


    // STEP 2: Context
    if (wizardState.step === 2) {
        const backBtn = modal.querySelector('#wiz-back');
        if (backBtn) backBtn.onclick = () => { wizardState.step = 1; renderWizard(); };

        const nextBtn = modal.querySelector('#wiz-next');
        if (nextBtn) nextBtn.onclick = () => { wizardState.step = 3; renderWizard(); };

        const checkboxes = modal.querySelectorAll('.wiz-context-checkbox');
        checkboxes.forEach(cb => {
            cb.onchange = (e) => {
                const idx = parseInt(e.target.dataset.index, 10);
                const strat = wizardState.baseStrategies.find(s => s.index === idx);
                if (strat) strat.checked = e.target.checked;

                // Update count text
                const countEl = modal.querySelector('#wiz-selection-count');
                if (countEl) countEl.textContent = `${wizardState.baseStrategies.filter(s => s.checked).length} seleccionadas`;

            };
        });

        const toggleBtn = modal.querySelector('#wiz-toggle-all');
        if (toggleBtn) {
            toggleBtn.onclick = () => { // Fixed: added onclick handler back
                const allChecked = wizardState.baseStrategies.every(s => s.checked);
                wizardState.baseStrategies.forEach(s => s.checked = !allChecked);
                renderWizard(); // Re-render to update UI
            };
        }

        // --- NEW: Correlation Analysis Button ---
        const corrBtn = modal.querySelector('#wiz-check-corr');
        if (corrBtn) {
            corrBtn.onclick = async () => {
                const { showPortfolioCorrelationModal } = await import('./portfolioCorrelation.js');

                // Gather checked strategies (excluding quarantined)
                const strategies = [];
                const selectedContextIndices = [];

                wizardState.baseStrategies.forEach(s => {
                    const isQuarantined = state.quarantinedStrategyNames.has(s.name);
                    if (s.checked && !isQuarantined && state.loadedStrategyFiles[s.originalIndex]) {
                        strategies.push(state.loadedStrategyFiles[s.originalIndex]);
                        selectedContextIndices.push(s.originalIndex);
                    }
                });

                if (strategies.length < 2) {
                    showToast('Selecciona al menos 2 estrategias válidas para correlacionar', 'warning');
                    return;
                }

                showToast('Calculando correlación...', 'info');
                try {
                    // 1. Fetch Correlation Matrix from Backend
                    // We use the same backend endpoint that handles raw strategy data
                    const payload = {
                        portfolio_indices: selectedContextIndices.map((_, i) => i), // Sequential indices matching the pre-filtered array
                        strategies_data: selectedContextIndices.map(i => state.rawStrategiesData[i])
                    };

                    const response = await fetch('/analysis/correlation-matrix', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (!response.ok) throw new Error('Error en cálculo');
                    const result = await response.json();

                    // 2. Adapt data for the existing Correlation Modal (portfolioCorrelation.js)
                    // The modal expects: { labels: [], matrix: [[...]] }
                    // Note: The modal might expect 'portfolios' array for tooltips, 
                    // so we create mock objects to satisfy it if needed.

                    const labels = selectedContextIndices.map(i => state.loadedStrategyFiles[i].name);

                    // Mock objects to ensure tooltip headers identify them as strategies
                    const mockPortfolios = labels.map(name => ({ name: name }));

                    const adaptedData = {
                        names: labels,
                        matrix: result.matrix,
                        portfolios: mockPortfolios
                    };

                    // 3. Show Modal
                    showPortfolioCorrelationModal(adaptedData);

                } catch (e) {
                    console.error(e);
                    showToast('Error al calcular correlación: ' + e.message, 'error');
                }
            };
        }
    }

    // Evolution Range
    const evoRange = modal.querySelector('#wiz-evo-range');
    if (evoRange) {
        evoRange.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            wizardState.evolutionTopN = val;
            modal.querySelector('#wiz-evo-val').textContent = val;
        });
    }

    // STEP 3: Params
    if (wizardState.step === 3) {
        const backBtn = modal.querySelector('#wiz-back');
        if (backBtn) backBtn.onclick = () => { wizardState.step = 2; renderWizard(); };

        // Date Toggle Logic
        const dateToggle = document.getElementById('wiz-dates');
        const dateInputs = document.getElementById('wiz-date-inputs');

        // [NEW] Initialize Flatpickr for Wizard
        let fpWizStart = null;
        let fpWizEnd = null;

        const initFlatpickr = () => {
            if (!fpWizStart) {
                const fpConfig = {
                    locale: "es",
                    dateFormat: "Y-m-d",
                    theme: "dark",
                    allowInput: true
                };
                fpWizStart = flatpickr("#wiz-date-start", fpConfig);
                fpWizEnd = flatpickr("#wiz-date-end", { ...fpConfig, defaultDate: wizardState.config.endDate || 'today' });
            }
        };

        if (dateToggle && dateInputs) {
            // Initialize immediately if visible
            if (!dateToggle.checked) {
                initFlatpickr();
            }

            dateToggle.addEventListener('change', (e) => {
                if (e.target.checked) {
                    dateInputs.classList.add('hidden');
                    dateInputs.classList.remove('flex');
                } else {
                    dateInputs.classList.remove('hidden');
                    dateInputs.classList.add('flex');
                    initFlatpickr(); // Initialize when shown
                }
            });
        }

        const startBtn = modal.querySelector('#wiz-start');
        if (startBtn) {
            // Clone to remove old listeners (quick hack)
            const newBtn = startBtn.cloneNode(true);
            startBtn.parentNode.replaceChild(newBtn, startBtn);

            newBtn.onclick = (e) => {
                // CRITICAL CHECK: Is the button actually visible?
                if (newBtn.offsetParent === null) {
                    return;
                }

                // Read config
                wizardState.config.metric = document.getElementById('wiz-metric').value;
                wizardState.config.goal = document.getElementById('wiz-goal').value;
                wizardState.config.minSize = parseInt(document.getElementById('wiz-size-min').value);
                wizardState.config.maxSize = parseInt(document.getElementById('wiz-size-max').value);
                wizardState.config.correlationThreshold = parseFloat(document.getElementById('wiz-corr').value);

                // Dates
                const useAllDates = document.getElementById('wiz-dates').checked;
                wizardState.config.useAllDates = useAllDates;
                if (!useAllDates) {
                    const s = document.getElementById('wiz-date-start').value;
                    const eDate = document.getElementById('wiz-date-end').value;

                    if (!s || !eDate) {
                        alert("⚠️ Por favor selecciona Fechas de Inicio y Fin, o marca 'Usar Todo el Historial'.");
                        return;
                    }

                    wizardState.config.startDate = s;
                    wizardState.config.endDate = eDate;
                }

                // Incubation Filter
                const mt5MinDaysInput = document.getElementById('wiz-mt5-min-days');
                if (mt5MinDaysInput) {
                    state.mt5IncubationMinDays = parseInt(mt5MinDaysInput.value) || 0;
                }

                executeSearch();
            };
        }

        // Metric Logic
        const metricSelect = modal.querySelector('#wiz-metric');
        const goalSelect = modal.querySelector('#wiz-goal');
        if (metricSelect) {
            metricSelect.onchange = (e) => {
                const metric = e.target.value;
                wizardState.config.metric = metric;
                if (METRIC_CONFIG[metric]) {
                    goalSelect.value = METRIC_CONFIG[metric].goal;
                    wizardState.config.goal = METRIC_CONFIG[metric].goal;
                }
                // Re-render to update the Target KPI display (just re-call renderWizard for simplicity)
                renderWizard();
            };
        }

        // Live Config Updates (Store in state for persistence if back/next)
        // Simple binding...
        // Live Config Updates (Store in state for persistence if back/next)
        modal.querySelector('#wiz-size-min')?.addEventListener('input', (e) => {
            wizardState.config.minSize = parseInt(e.target.value) || 1;
        });
        modal.querySelector('#wiz-size-max')?.addEventListener('input', (e) => {
            wizardState.config.maxSize = parseInt(e.target.value) || 7;
        });
        modal.querySelector('#wiz-goal')?.addEventListener('change', (e) => wizardState.config.goal = e.target.value);
        modal.querySelector('#wiz-goal')?.addEventListener('change', (e) => wizardState.config.goal = e.target.value);
        modal.querySelector('#wiz-corr')?.addEventListener('input', (e) => {
            wizardState.config.correlationThreshold = parseFloat(e.target.value);
            // Dynamic Check on Input Change
            if (window._corrCheckTimeout) clearTimeout(window._corrCheckTimeout);
            window._corrCheckTimeout = setTimeout(checkAndWarnCorrelation, 800);
        });
        modal.querySelector('#wiz-dates')?.addEventListener('change', (e) => wizardState.config.useAllDates = e.target.checked);
        modal.querySelectorAll('input[name="wiz-method"]').forEach(r => {
            r.addEventListener('change', (e) => wizardState.config.searchMethod = e.target.value);
        });
        modal.querySelector('#wiz-sat-corr')?.addEventListener('input', (e) => wizardState.config.satelliteCorrelationThreshold = parseFloat(e.target.value));

        // POOL SOURCE LISTENERS
        modal.querySelector('#wiz-source-unused')?.addEventListener('change', (e) => {
            wizardState.config.sourceUnused = e.target.checked;
            console.log('[SearchConfig] Source Unused:', e.target.checked);
        });
        modal.querySelector('#wiz-source-linked')?.addEventListener('change', (e) => {
            wizardState.config.sourceLinked = e.target.checked;
            console.log('[SearchConfig] Source Linked:', e.target.checked);
        });
        modal.querySelector('#wiz-reshuffle')?.addEventListener('input', (e) => wizardState.config.reShuffleInterval = parseInt(e.target.value));

        // Normalization Controls
        modal.querySelector('#wiz-norm-enabled')?.addEventListener('change', (e) => {
            wizardState.config.normalizationEnabled = e.target.checked;
            // Toggle visibility of controls
            const controls = modal.querySelector('#wiz-norm-controls');
            if (e.target.checked) {
                controls.classList.remove('hidden', 'opacity-50', 'pointer-events-none');
            } else {
                controls.classList.add('hidden', 'opacity-50', 'pointer-events-none');
            }
        });
        modal.querySelector('#wiz-norm-metric')?.addEventListener('change', (e) => wizardState.config.normalizationMetric = e.target.value);
        modal.querySelector('#wiz-norm-target')?.addEventListener('input', (e) => wizardState.config.normalizationTarget = parseFloat(e.target.value));

        // Trigger Check on Step Load (using default or carried-over threshold)
        setTimeout(() => {
            checkAndWarnCorrelation();
        }, 500);

    }
}; // End of attachWizardEvents


let _executeSearchRunning = false;
const executeSearch = () => {
    // Guard against double-fire (button clone sometimes triggers twice)
    if (_executeSearchRunning) {
        console.warn('[ExecuteSearch] ⚠️ Already running, ignoring duplicate call.');
        return;
    }
    _executeSearchRunning = true;
    // ========== DIAGNOSTIC LOGS ==========
    console.log('%c[DIAG-WIZARD] ═══════════════════════════════════════', 'color: #ff9900; font-weight: bold');
    console.log('%c[DIAG-WIZARD] executeSearch CALLED', 'color: #ff9900; font-weight: bold');
    console.trace("[DIAG-WIZARD] Trace for executeSearch call:");
    console.log('[DIAG-WIZARD] wizardState.objective:', wizardState.objective);
    console.log('[DIAG-WIZARD] wizardState.baseStrategies.length:', wizardState.baseStrategies.length);
    console.log('[DIAG-WIZARD] state.loadedStrategyFiles.length:', state.loadedStrategyFiles?.length);
    console.log('[DIAG-WIZARD] state.rawStrategiesData.length:', state.rawStrategiesData?.length);
    // ========== END DIAGNOSTIC LOGS ==========

    // 1. Identify Strategies to BAN (Unchecked in UI)
    const uncheckedIndices = new Set(
        wizardState.baseStrategies
            .filter(s => !s.checked)
            .map(s => s.index)
    );

    // 2. Identify Strategies to KEEP (Checked)
    const checkedIndices = wizardState.baseStrategies
        .filter(s => s.checked)
        .map(s => s.index);

    let fixedIndicesToSend = checkedIndices; // By default, only checked are fixed
    let allowedIndicesToSend = [];

    // Override Objective for Backend Mapping if needed
    let backendObjective = wizardState.objective;

    if (wizardState.objective === 'satellite') {
        fixedIndicesToSend = []; // Don't fix anything
        // Reference logic handled below
    } else if (wizardState.objective === 'lab' || wizardState.objective === 'boost' || wizardState.objective === 'hybrid') {
        // Mining Mode: Use ALL loaded strategies as the pool
        const totalStrategiesCount = state.loadedStrategyFiles.length;
        allowedIndicesToSend = Array.from({ length: totalStrategiesCount }, (_, i) => i);
        console.log('[DIAG-WIZARD] Lab/Boost/Hybrid: allowedIndices set to ALL:', totalStrategiesCount);
    } else if (wizardState.objective === 'evolution') {
        // Evolution Mode: Feed from Databank
        backendObjective = 'evolution';
        const totalStrategiesCount = state.loadedStrategyFiles.length;
        allowedIndicesToSend = Array.from({ length: totalStrategiesCount }, (_, i) => i);
        fixedIndicesToSend = [];
        console.log("[DIAG-WIZARD] Evolution Mode Initialized.");
    } else if (wizardState.objective === 'hybrid_satellite') {
        backendObjective = 'evolution';
        const totalStrategiesCount = state.loadedStrategyFiles.length;
        allowedIndicesToSend = Array.from({ length: totalStrategiesCount }, (_, i) => i);
        fixedIndicesToSend = [];
        console.log("[DIAG-WIZARD] Hybrid Satellite Mode Initialized.");
    }

    // --- GLOBAL BAN LOGIC ---
    let wizardBannedCount = 0;
    if (uncheckedIndices.size > 0) {
        allowedIndicesToSend = allowedIndicesToSend.filter(idx => !uncheckedIndices.has(idx));
        showToast(`⛔ Exclusión Global: ${uncheckedIndices.size} estrategias prohibidas.`, 'warning');
        wizardBannedCount = uncheckedIndices.size;
    }

    // --- QUARANTINE ENFORCEMENT ---
    if (state.quarantinedStrategyNames.size > 0) {
        const strategies = state.loadedStrategyFiles;
        const initialLen = allowedIndicesToSend.length;
        allowedIndicesToSend = allowedIndicesToSend.filter(idx => {
            const name = strategies[idx] ? strategies[idx].name : '';
            return !state.quarantinedStrategyNames.has(name);
        });

        // Also filter fixed
        fixedIndicesToSend = fixedIndicesToSend.filter(idx => {
            const name = strategies[idx] ? strategies[idx].name : '';
            return !state.quarantinedStrategyNames.has(name);
        });

        const quarantinedRemoved = initialLen - allowedIndicesToSend.length;
        if (quarantinedRemoved > 0) {
            showToast(`☣️ Cuarentena: ${quarantinedRemoved} estrategias eliminadas del pool.`, 'error');
        }
        state.bannedStrategiesCount = wizardBannedCount + quarantinedRemoved;
    } else {
        state.bannedStrategiesCount = wizardBannedCount;
    }

    // --- MT5 INCUBATION FILTER ---
    // Exclude strategies that haven't been connected to MT5 long enough
    // NOTE: We compute the connection date directly from deepScanData + magicNumberMap
    // because loadedStrategyFiles does NOT have realMetrics at search time.
    if (state.mt5IncubationMinDays > 0) {
        const strategies = state.loadedStrategyFiles;
        const today = new Date();
        const minDays = state.mt5IncubationMinDays;
        const initialLen = allowedIndicesToSend.length;

        // Helper: compute MT5 connection date for a strategy by its index
        const getMT5ConnectionDate = (idx) => {
            const file = strategies[idx];
            if (!file) return null;
            const name = file.name;
            const strategyId = file.strategyId || name;
            const cleanName = name.replace(/\.csv$/i, '');

            // Look up magic number(s) from the map
            const mapEntry = state.magicNumberMap?.[strategyId] ||
                             state.magicNumberMap?.[name] ||
                             state.magicNumberMap?.[cleanName];
            if (!mapEntry) return null;

            const magicKeys = Array.isArray(mapEntry) ? mapEntry : [mapEntry];
            let earliestDate = null;

            // Search across all deepScan accounts
            Object.entries(state.deepScanData || {}).forEach(([accountId, accountData]) => {
                const tradesMap = accountData?.tradesById || accountData?._tradesById;
                if (!tradesMap) return;

                magicKeys.forEach(magic => {
                    const keyStr = String(magic).trim();
                    // Try compound key (accountId::magic) and raw key
                    const keysToTry = [`${accountId}::${keyStr}`, keyStr];
                    keysToTry.forEach(k => {
                        const trades = tradesMap[k];
                        if (!trades || !Array.isArray(trades)) return;
                        trades.forEach(t => {
                            const tDate = new Date(t.openTime || t.openDate || t.closeTime || t.closeDate);
                            if (!isNaN(tDate.getTime())) {
                                const iso = tDate.toISOString();
                                if (!earliestDate || iso < earliestDate) {
                                    earliestDate = iso;
                                }
                            }
                        });
                    });
                });
            });

            return earliestDate;
        };

        allowedIndicesToSend = allowedIndicesToSend.filter(idx => {
            const connectionDate = getMT5ConnectionDate(idx);
            if (!connectionDate) return false; // No MT5 data = excluded when minDays > 0
            const daysConnected = Math.floor((today - new Date(connectionDate)) / (1000 * 60 * 60 * 24));
            return daysConnected >= minDays;
        });

        // Also filter fixed indices
        fixedIndicesToSend = fixedIndicesToSend.filter(idx => {
            const connectionDate = getMT5ConnectionDate(idx);
            if (!connectionDate) return false; // No MT5 data = excluded when minDays > 0
            const daysConnected = Math.floor((today - new Date(connectionDate)) / (1000 * 60 * 60 * 24));
            return daysConnected >= minDays;
        });

        const incubationRemoved = initialLen - allowedIndicesToSend.length;
        // Store for banner display
        state._incubationFilterResult = { removed: incubationRemoved, minDays };
        if (incubationRemoved > 0) {
            showToast(`🔵 Incubación: ${incubationRemoved} estrategias excluidas (< ${minDays} días en MT5).`, 'info');
        }
        console.log(`[SearchConfig] Incubation filter: min=${minDays}d, removed=${incubationRemoved}, remaining=${allowedIndicesToSend.length}`);
    } else {
        state._incubationFilterResult = null;
    }

    // --- VALIDATION: Prevent "Locked" Search in Boost/Hybrid Mode ---
    if ((wizardState.objective === 'boost' || wizardState.objective === 'hybrid') && fixedIndicesToSend.length >= wizardState.config.maxSize) {
        showToast(`⚠️ Conflicto: Has fijado ${fixedIndicesToSend.length} estrategias y el tamaño máximo es ${wizardState.config.maxSize}.<br>Sube el Máximo o desmarca estrategias.`, 'error', 8000);
        return;
    }

    // --- VALIDATION: Prevent search if pool is empty ---
    if (allowedIndicesToSend.length === 0) {
        showToast(`⚠️ Todo el pool ha sido filtrado (Cuarentena / Incubación). No hay estrategias para buscar.`, 'error', 8000);
        return;
    }

    if (allowedIndicesToSend.length < wizardState.config.minSize) {
        showToast(`⚠️ El pool (${allowedIndicesToSend.length}) es menor que el tamaño mínimo solicitado (${wizardState.config.minSize}). Baja el mínimo o relaja los filtros.`, 'error', 8000);
        return;
    }

    // 4. PRE-PROCESSING: Shadow Data for Date Filtering
    let shadowStrategiesData = null;
    let creationFilter = null;

    if (!wizardState.config.useAllDates && wizardState.config.startDate && wizardState.config.endDate) {
        console.log(`[ExecuteSearch] 📅 Date Filter Active: ${wizardState.config.startDate} to ${wizardState.config.endDate}`);

        creationFilter = {
            start: wizardState.config.startDate,
            end: wizardState.config.endDate
        };
    }

    // 5. Trigger Search
    import('./databank.js').then(async ({ findDatabankPortfolios }) => {
        let strategiesDataOverride = null;

        // Shadow Data Generation (Async safe here)
        if (creationFilter) {
            try {
                // [FIX] Show loading immediately and yield to let browser paint
                toggleLoading(true, 'Filtrando Datos', 'Preparando estrategias por fecha (puede tardar unos segundos)...');
                await new Promise(resolve => setTimeout(resolve, 50));

                // Bump version to force reload of patched file
                const { filterTradesByDate, parseTradesFromData, tradesToCSV } = await import('./sqAnalysis_v2.js?v=13');
                console.log('[ExecuteSearch] ⏳ Generating Shadow Data (CSV) for filtered period...');

                // Filter and convert back to CSV to keep payload small and ensure backend receives valid list of strings
                strategiesDataOverride = state.rawStrategiesData.map((raw, idx) => {
                    if (!raw) return "";

                    const trades = parseTradesFromData(raw);
                    const filteredTrades = filterTradesByDate(trades, creationFilter);

                    // DEBUG: Log first few strategies to see what's happening
                    if (idx < 3) {
                        console.log(`[SHADOW-DEBUG] Strat ${idx}: Raw Length: ${raw.length}`);
                        if (trades.length === 0) {
                            console.warn(`[SHADOW-DEBUG] Strat ${idx} parsed 0 trades! First 200 chars of raw data:`, raw.substring(0, 200));
                        }
                        console.log(`[SHADOW-DEBUG] Strat ${idx}: Raw Trades Parsed: ${trades.length}, Filtered: ${filteredTrades.length}`);

                        if (trades.length > 0) {
                            console.log(`[SHADOW-DEBUG] Strat ${idx} Sample Trade 0:`, trades[0]);
                            console.log(`[SHADOW-DEBUG] Filter:`, creationFilter);
                        }
                    }

                    // Map back to CSV String (Compact & Valid for Backend)
                    return tradesToCSV(filteredTrades);
                });
                console.log(`[ExecuteSearch] ✅ Shadow Data Ready (CSV Format).`);
            } catch (shadowErr) {
                console.error('[ExecuteSearch] ❌ Error generating Shadow Data:', shadowErr);
                showToast('Error generando datos filtrados: ' + shadowErr.message, 'error');
                return;
            }
        } else {
            // Explicitly nullify if no filter, to allow GC
            strategiesDataOverride = null;
        }

        // --- AUTO-ADJUST SIZE FOR BOOST MODE ---
        // In boost mode, the backend calculates effective_max_k = maxSize - fixedCount.
        // If maxSize <= fixedCount, no new strategies can be added (search produces nothing).
        // We auto-adjust to guarantee at least 1 new strategy beyond the fixed base.
        let finalMinSize = wizardState.config.minSize || 1;
        let finalMaxSize = wizardState.config.maxSize;

        if (wizardState.objective === 'boost' && fixedIndicesToSend.length > 0) {
            const fixedCount = fixedIndicesToSend.length;
            // minSize must be at least fixedCount + 1 (base + at least 1 new)
            if (finalMinSize <= fixedCount) {
                finalMinSize = fixedCount + 1;
                console.log(`[DIAG-WIZARD] Boost: Auto-adjusted minSize from ${wizardState.config.minSize} to ${finalMinSize} (fixed: ${fixedCount})`);
            }
            // maxSize must be at least fixedCount + 1
            if (finalMaxSize <= fixedCount) {
                finalMaxSize = fixedCount + 3; // Give some room to explore
                console.log(`[DIAG-WIZARD] Boost: Auto-adjusted maxSize from ${wizardState.config.maxSize} to ${finalMaxSize} (fixed: ${fixedCount})`);
            }
        }

        // Construct Payload/Config for findDatabankPortfolios
        const config = {
            objective: backendObjective,
            searchMethod: wizardState.config.searchMethod,
            metric: wizardState.config.metric,
            goal: wizardState.config.goal,
            minSize: finalMinSize,
            maxSize: finalMaxSize,
            correlationThreshold: wizardState.config.correlationThreshold,
            satelliteCorrelationThreshold: wizardState.config.satelliteCorrelationThreshold,
            reShuffleInterval: wizardState.config.reShuffleInterval || 30,

            // Date Filter
            useAllDates: wizardState.config.useAllDates,

            // Strategy Source Pool
            sourceUnused: wizardState.config.sourceUnused !== undefined ? wizardState.config.sourceUnused : true,
            sourceLinked: wizardState.config.sourceLinked !== undefined ? wizardState.config.sourceLinked : true,

            // Base Strategies (for Lab/Boost)
            fixedIndices: fixedIndicesToSend,
            allowedIndices: allowedIndicesToSend,

            // Multi-Satellite Reference
            referencePortfolios: [],
            referenceIndices: [],

            // Normalization
            normalizationEnabled: wizardState.config.normalizationEnabled || false,
            normalizationMetric: wizardState.config.normalizationMetric || 'max_dd',
            normalizationTarget: wizardState.config.normalizationTarget || 1000,

            // Context
            evolutionTopN: wizardState.evolutionTopN,

            // NEW: Shadow Data & Filter Metadata
            strategiesDataOverride: strategiesDataOverride,
            creationFilter: creationFilter
        };

        if (wizardState.isMultiPortfolioMode) {
            config.referencePortfolios = wizardState.selectedPortfolioIndices.map(idx => {
                const p = state.savedPortfolios[idx];
                if (!p || !p.indices) return [];
                return p.indices.filter(i => !uncheckedIndices.has(i));
            });
        } else {
            if (state.searchBasePortfolioIndex !== null) {
                const p = state.savedPortfolios[state.searchBasePortfolioIndex];
                if (p && (wizardState.objective === 'satellite' || wizardState.objective === 'hybrid' || wizardState.objective === 'hybrid_satellite')) {
                    const indices = p.indices || [];
                    config.referenceIndices = indices.filter(i => !uncheckedIndices.has(i));
                }
            }
        }

        // DEBUG PAYLOAD - DIAGNOSING DATE FILTER ISSUE
        console.log(`[ExecuteSearch-PAYLOAD-DEBUG] creationFilter:`, config.creationFilter);
        console.log(`[ExecuteSearch-PAYLOAD-DEBUG] strategiesDataOverride TYPE:`, typeof config.strategiesDataOverride);
        if (Array.isArray(config.strategiesDataOverride)) {
            console.log(`[ExecuteSearch-PAYLOAD-DEBUG] strategiesDataOverride LENGTH:`, config.strategiesDataOverride.length);
            const firstItem = config.strategiesDataOverride[0];
            const firstItemLen = firstItem ? firstItem.length : 0;
            console.log(`[ExecuteSearch-PAYLOAD-DEBUG] First item len:`, firstItemLen);
            console.log(`[ExecuteSearch-PAYLOAD-DEBUG] First item preview:`, firstItem ? firstItem.substring(0, 100) : "EMPTY");
        } else {
            console.log(`[ExecuteSearch-PAYLOAD-DEBUG] strategiesDataOverride IS NULL/UNDEFINED`);
        }

        // Clear the preprocessing loading overlay before handing off to search
        toggleLoading(false);
        findDatabankPortfolios(config);

        // Close wizard
        _executeSearchRunning = false;
        if (wizardState.modalElement) wizardState.modalElement.remove();
        wizardState.modalElement = null;
    }).catch(err => {
        toggleLoading(false);
        _executeSearchRunning = false;
        console.error('[ExecuteSearch] ❌ CRITICAL: Import/execution chain failed:', err);
        showToast('Error crítico al ejecutar búsqueda: ' + err.message, 'error');
    });
};
const startSearch = (config) => {
    // 1. Switch to DataBank tab
    const databankTabBtn = document.querySelector('button[data-target="databank-content"]');
    if (databankTabBtn) databankTabBtn.click();

    // 2. Update DataBank UI inputs to reflect Search settings (Sync UI)
    if (dom.databankSizeInput) dom.databankSizeInput.value = config.maxSize;
    if (dom.optimizationMetricSelect) dom.optimizationMetricSelect.value = config.metric;
    if (dom.optimizationGoalSelect) dom.optimizationGoalSelect.value = config.goal;
    if (dom.correlationFilterInput) dom.correlationFilterInput.value = config.correlationThreshold;

    // 3. Trigger search with custom config
    findDatabankPortfolios(config);
};
