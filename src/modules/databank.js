import { state } from '../state.js';
import { dom } from '../dom.js';
import { ALL_METRICS, SELECTION_COLORS } from '../config.js?v=7'; // ALL_METRICS y SELECTION_COLORS se siguen usando
import { hideError, displayError, toggleLoading, formatMetricForDisplay } from '../utils.js'; // Estas utilidades se siguen usando
import { showToast } from './notifications.js';
import { initDatabankTable, getDatabankTableConfig, ensureColumnVisible, hideColumn } from './databankTable.js?v=8';
import { focusMode } from './focusMode.js';
import { generatePortfolioId } from '../utils.js'; // Import ID generator
import { loadBrokerConfig } from './brokerConfig.js';

import { calculateSQMetrics, parseTradesFromContent, parseTradesFromData } from './sqAnalysis_v2.js?v=10';
import { getFullAnalysisFromBackend } from '../analysis.js';

/**
 * Actualiza el indicador visual de estado del DataBank.
 * @param {string} status - 'connecting' | 'searching' | 'paused' | 'stopped' | 'completed' | 'error' | 'hidden'
 * @param {string} message - Mensaje a mostrar
 */
const setDatabankStatus = (status, message = '') => {
    // 1. Check for Detailed Card Mode first
    const cardStatusMsg = document.getElementById('databank-card-status-msg');

    // Config definition
    const statusConfig = {
        hidden: { icon: '', class: 'hidden' },
        connecting: { icon: '📡', class: 'animate-pulse', color: 'text-blue-400' },
        searching: { icon: '🔨', class: 'animate-bounce', color: 'text-yellow-400' },
        paused: { icon: '⏸️', class: '', color: 'text-orange-400' },
        stopped: { icon: '⏹️', class: '', color: 'text-red-400' },
        completed: { icon: '✅', class: '', color: 'text-green-400' },
        error: { icon: '❌', class: '', color: 'text-red-500' },
        evolution: { icon: '🧬', class: 'animate-pulse', color: 'text-purple-400', special: true }
    };

    let config = statusConfig[status] || statusConfig.hidden;

    // Check for Evolution Context in message to override visual style
    if (status === 'searching' && message.includes('Evolución Genética')) {
        config = statusConfig.evolution;
    }

    // PATH A: Detailed Card Mode
    if (cardStatusMsg) {
        // Ensure parent container is visible if we are updating the card
        const statusContainer = document.getElementById('databank-status-bar');
        if (statusContainer && statusContainer.classList.contains('hidden')) {
            statusContainer.classList.remove('hidden');
        }

        if (config.special) {
            cardStatusMsg.innerHTML = `<span class="font-bold text-purple-300">🧬 Evolución:</span> ${message.replace('Evolución Genética', '').trim()}`;
        } else {
            // Use the icon from config but keep text simpler as it's a tight space
            cardStatusMsg.innerHTML = `${config.icon} ${message}`;
            // Optional: Update color based on status if needed, but the default yellow is usually fine for search
            if (config.color) {
                // Remove old color classes and add new one logic is complex, simpler to just set className
                // cardStatusMsg.className = `font-bold mb-1 truncate ${config.color}`; 
            }
        }
        return;
    }

    // PATH B: Legacy Mode (Fallback)
    const statusBar = document.getElementById('databank-status-bar');
    const statusIcon = document.getElementById('databank-status-icon');
    const statusText = document.getElementById('databank-status-text');

    if (!statusBar || !statusIcon || !statusText) return;

    if (status === 'hidden') {
        statusBar.classList.add('hidden');
    } else {
        statusBar.classList.remove('hidden');
        statusIcon.innerHTML = `<span class="${config.class} ${config.color} text-xl">${config.icon}</span>`;

        if (config.special) {
            statusText.innerHTML = `<span class="font-bold text-purple-300">Evolución Activa:</span> <span class="text-gray-300">${message.replace('Evolución Genética', '').trim()} in progress...</span>`;
        } else {
            statusText.innerHTML = `<span class="text-gray-300">${message}</span>`;
        }

        // Execution Feedback: Show Banned Count if active (Only in simple mode)
        if (state.bannedStrategiesCount > 0) {
            statusText.innerHTML += ` <span class="ml-3 text-xs bg-red-900/50 text-red-300 px-2 py-0.5 rounded border border-red-700/50" title="Estrategias excluidas globalmente">⛔ ${state.bannedStrategiesCount} Excluidas</span>`;
        }

        statusText.className = `text-sm ${config.color}`;
    }
};

export const updateDatabankCount = () => {
    const countBadge = document.getElementById('databank-count');
    if (countBadge) {
        countBadge.textContent = state.databankPortfolios.length;
        countBadge.classList.remove('hidden');
    }
};

/**
 * Inicia la búsqueda de portafolios en el DataBank.
 */
// --- EVOLUTION MANAGER ---
const evolutionManager = {
    active: false,
    generation: 0,
    timer: null,
    config: null,
    phase: 'idle', // 'seeding', 'breeding', 'mutation'
    abortController: null,

    start: function (config) {
        if (this.active) this.stop();
        this.active = true;
        this.generation = 1;
        this.config = config;
        this.phase = 'seeding';

        console.log("[Evolution] Starting Evolution Loop...");
        this.runGeneration();
    },

    stop: function () {
        console.log("[Evolution] Stopping Loop.");
        this.active = false;
        if (this.timer) clearTimeout(this.timer);
        if (this.abortController) this.abortController.abort();
        // Force clear layout timer interval
        if (state.searchTimerInterval) {
            clearInterval(state.searchTimerInterval);
            state.searchTimerInterval = null;
        }
        state.searchStartTime = null; // Reset start time on explicit stop
        this.phase = 'idle';
        setDatabankStatus('stopped', 'Evolución detenida.');

        // Reset UI buttons
        if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.disabled = false;
        if (dom.stopSearchBtn) dom.stopSearchBtn.disabled = true;
        if (dom.pauseSearchBtn) dom.pauseSearchBtn.disabled = true;
        if (dom.clearDatabankBtn) dom.clearDatabankBtn.disabled = false;
        if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
    },

    runGeneration: async function () {
        if (!this.active) return;

        // Ensure clean timer state at start of generation
        if (state.searchTimerInterval) clearInterval(state.searchTimerInterval);

        // 1. Determine Phase based on Databank State
        const databankCount = state.databankPortfolios.length;
        const topN = this.config.evolutionTopN || 10;

        let generationDuration = 30000; // Default 30s
        let nextPhase = 'breeding';
        let statusMsg = '';
        let phaseIcon = '';

        // Internal Loop Logic
        if (databankCount < 2) {
            // PHASE: SEEDING (Not enough data)
            this.phase = 'seeding';
            generationDuration = 20000;
            statusMsg = `Fase 1: Sembrado(Gen ${this.generation})`;
            phaseIcon = '🌱';
            nextPhase = 'seeding';
        } else {
            // Deciding between Breeding (Exploit) and Mutation (Explore)
            if (this.phase === 'seeding') {
                this.phase = 'breeding';
            } else if (this.phase === 'breeding') {
                this.phase = 'mutation';
            } else {
                this.phase = 'breeding';
            }
        }

        console.log(`[Evolution]-- - GENERATION ${this.generation} START-- - `);
        console.log(`[Evolution] Phase: ${this.phase.toUpperCase()} | Databank Size: ${databankCount} `);

        // 2. Configure Payload for this Phase
        const genPayload = { ...this.config };

        // Reset specific fields
        genPayload.fixedIndices = [];
        // Support for Hybrid Satellite: Keep referenceIndices if present in config, otherwise clear
        if (!genPayload.referenceIndices) genPayload.referenceIndices = [];

        if (this.phase === 'seeding') {
            // Random Search
            genPayload.objective = 'search';
            genPayload.searchMethod = 'monte_carlo';
            statusMsg = `Sembrado: Buscando candidatos iniciales...`;
            console.log(`[Evolution] Action: Random Seeding to populate Databank.`);
        } else if (this.phase === 'breeding') {
            // BREEDING: Strict. Use Top N strategies ONLY.
            genPayload.objective = 'lab';
            phaseIcon = '🧬';
            statusMsg = `Breeding: Cruzando Top ${Math.min(topN, databankCount)} (Gen ${this.generation})`;

            // Extract DNA
            const topPortfolios = state.databankPortfolios.slice(0, topN);
            const dnaSet = new Set();
            topPortfolios.forEach(p => p.indices.forEach(i => dnaSet.add(i)));

            // FILTER: Global Ban Enforcement
            // Only allow seeds that are present in the global 'allowedIndices' (whitelist)
            let dna = Array.from(dnaSet);
            if (this.config.allowedIndices && this.config.allowedIndices.length > 0) {
                const allowedSet = new Set(this.config.allowedIndices);
                dna = dna.filter(idx => allowedSet.has(idx));
            }

            // FILTER: DYNAMIC QUARANTINE (Live Check)
            // Even if allowed initially, check if strategy is NOW in quarantine
            if (state.quarantinedStrategyNames.size > 0) {
                const initialDnaSize = dna.length;
                dna = dna.filter(idx => {
                    const name = state.loadedStrategyFiles[idx] ? state.loadedStrategyFiles[idx].name : '';
                    return !state.quarantinedStrategyNames.has(name);
                });
                if (dna.length < initialDnaSize) {
                    console.log(`[Evolution] Quarantine Enforcement: Removed ${initialDnaSize - dna.length} banned seeds.`);
                }
            }

            genPayload.fixedIndices = dna; // Use as Base
            genPayload.allowedIndices = dna; // RESTRICT pool to ONLY these strategies

            console.log(`[Evolution] Action: Breeding Top ${topPortfolios.length} Portfolios.`);
            console.log(`[Evolution] DNA Source(Portfolios): `, topPortfolios.map(p => p.name || 'Unnamed'));
            console.log(`[Evolution] Extracted Seeds(Strategies): `, dna);
        } else if (this.phase === 'mutation') {
            // MUTATION: Hybrid.
            genPayload.objective = 'lab';
            phaseIcon = '🦠';
            statusMsg = `Mutación: Introduciendo variabilidad(Gen ${this.generation})`;

            // Extract DNA for Base
            const topPortfolios = state.databankPortfolios.slice(0, topN);
            const dnaSet = new Set();
            topPortfolios.forEach(p => p.indices.forEach(i => dnaSet.add(i)));

            // FILTER: Global Ban Enforcement
            let dna = Array.from(dnaSet);
            if (this.config.allowedIndices && this.config.allowedIndices.length > 0) {
                const allowedSet = new Set(this.config.allowedIndices);
                dna = dna.filter(idx => allowedSet.has(idx));
            }

            // FILTER: DYNAMIC QUARANTINE (Live Check)
            if (state.quarantinedStrategyNames.size > 0) {
                dna = dna.filter(idx => {
                    const name = state.loadedStrategyFiles[idx] ? state.loadedStrategyFiles[idx].name : '';
                    return !state.quarantinedStrategyNames.has(name);
                });
            }

            genPayload.fixedIndices = dna; // Base Seeds
            // allowedIndices is ALREADY all strategies (from original payload or default)
            console.log(`[Evolution] Action: Mutation.Using DNA from Top ${topPortfolios.length} as Base.`);
            console.log(`[Evolution] Hybrid Mode: Mixing ${dna.length} Base Strategies with GLOBAL Pool.`);
        }

        // 3. Update Status UI
        let displayMsg = `${phaseIcon} ${statusMsg}`;
        if (this.config.satelliteCorrelationThreshold) {
            displayMsg += ` | 🛰️ Sat Corr < ${this.config.satelliteCorrelationThreshold}`;
        }
        setDatabankStatus('evolution', displayMsg);

        // 4. Execute Backend Search (NON-BLOCKING)
        this.abortController = new AbortController();

        // We do NOT await here, so the timer can run in parallel
        executeBackendSearch(genPayload, this.abortController.signal, (type, data) => {
            if (type === 'error' && this.active) {
                console.warn("Generation error (stream):", data);
            }
        }).catch(e => {
            if (e.name !== 'AbortError') {
                console.error("Evolution Loop Async Error:", e);
            }
        });

        // 5. Schedule Next Generation
        if (this.active) {
            console.log(`[Evolution] Generation ${this.generation} running for ${generationDuration}ms...`);
            this.timer = setTimeout(() => {
                console.log(`[Evolution] Generation ${this.generation} DONE.Switching...`);
                // Time's up! Kill current search
                if (this.abortController) this.abortController.abort();

                // Proceed to next gen
                this.generation++;
                this.runGeneration();
            }, generationDuration);
        }
    }
};

/**
 * Executes a single backend search session.
 */
const executeBackendSearch = async (config, signal, onCallback) => {
    console.log("[DataBank] executeBackendSearch called with config:", config);
    // 1. Prepare Request Body
    const requestBody = {
        strategy_names: state.loadedStrategyFiles.map(f => f.name),
        strategies_data: state.rawStrategiesData,
        broker_config: loadBrokerConfig(),
        params: {
            metric_to_optimize_key: config.metric || 'sharpeRatio',
            optimization_goal: config.goal || 'maximize',
            correlation_threshold: config.correlationThreshold !== undefined
                ? config.correlationThreshold
                : (dom.correlationFilterInput ? parseFloat(dom.correlationFilterInput.value) : 0.90),
            satellite_correlation_threshold: config.satelliteCorrelationThreshold !== undefined
                ? config.satelliteCorrelationThreshold
                : 0.90,
            max_size: config.maxSize || (dom.databankSizeInput ? parseInt(dom.databankSizeInput.value, 10) : 20),

            base_indices: config.fixedIndices || [],
            allowed_indices: config.allowedIndices || [],
            reference_portfolios: config.referencePortfolios || [],
            reference_indices: config.referenceIndices || [],

            objective: config.objective || 'search',
            metric_name: config.metricName || config.metric || 'Sharpe Ratio',
            search_threshold: dom.searchThresholdInput ? parseInt(dom.searchThresholdInput.value, 10) : 500000,
            use_all_dates: config.useAllDates !== undefined ? config.useAllDates : true,
            search_method: config.searchMethod || 'auto',

            normalization_metric: config.normalizationEnabled ? config.normalizationMetric : null,
            normalization_target: config.normalizationEnabled ? config.normalizationTarget : null,
            cagr_scaling_metric: config.cagrScalingEnabled ? config.cagrScalingMetric : null,
            cagr_scaling_operator: config.cagrScalingEnabled ? config.cagrScalingOperator : 'multiply',
            re_shuffle_interval: config.reShuffleInterval || 30
        }
    };

    // --- POOL FILTERING LOGIC ---
    // 0. Identify Quarantined Indices (Always Exclude)
    const quarantinedIndices = new Set();
    if (state.quarantinedStrategyNames && state.quarantinedStrategyNames.size > 0) {
        state.loadedStrategyFiles.forEach((file, idx) => {
            const fName = file.name.trim();
            if (state.quarantinedStrategyNames.has(fName)) {
                quarantinedIndices.add(idx);
            }
        });
        // Console log removed for cleaner output
    }

    // Calculate allowed_indices based on "Strategy Source" checkboxes if passed in config
    // If config.sourceUnused or config.sourceLinked are defined (passed from Wizard)
    if (config.sourceUnused !== undefined || config.sourceLinked !== undefined) {
        const useUnused = config.sourceUnused !== false; // Default true if undefined
        const useLinked = config.sourceLinked !== false; // Default true if undefined

        if (!useUnused || !useLinked || quarantinedIndices.size > 0) {
            console.log(`[Search] Applying Pool Filter: Unused=${useUnused}, Linked=${useLinked}, Quarantined=${quarantinedIndices.size}`);

            // 1. Identify Linked Indices
            const linkedIndices = new Set();
            if (state.savedPortfolios) {
                state.savedPortfolios.forEach(p => {
                    if (p.indices) p.indices.forEach(i => linkedIndices.add(i));
                });
            }

            // 2. Filter All Loaded Indices
            const allIndices = state.loadedStrategyFiles.map((_, i) => i);
            const filteredIndices = allIndices.filter(idx => {
                // Global Ban Check
                if (quarantinedIndices.has(idx)) return false;

                const isLinked = linkedIndices.has(idx);
                if (isLinked) return useLinked;
                return useUnused;
            });

            // 3. Intersect with existing allowed_indices if any
            if (requestBody.params.allowed_indices && requestBody.params.allowed_indices.length > 0) {
                const existingSet = new Set(requestBody.params.allowed_indices);
                requestBody.params.allowed_indices = filteredIndices.filter(i => existingSet.has(i));
            } else {
                requestBody.params.allowed_indices = filteredIndices;
            }

            console.log(`[Search] Pool filtered from ${allIndices.length} to ${requestBody.params.allowed_indices.length} strategies.`);
        }
    } else {
        // Default Case (No Source Filter) - BUT MUST RESPECT QUARANTINE
        if (!requestBody.params.allowed_indices || requestBody.params.allowed_indices.length === 0) {
            if (quarantinedIndices.size > 0) {
                requestBody.params.allowed_indices = state.loadedStrategyFiles.map((_, i) => i).filter(i => !quarantinedIndices.has(i));
                console.log(`[Search] Default Pool applied with Quarantine: ${requestBody.params.allowed_indices.length} allowed.`);
            } else {
                requestBody.params.allowed_indices = state.loadedStrategyFiles.map((_, i) => i);
            }
        } else {
            // Explicit allowed_indices exist, but we must ensure they don't contain quarantined ones
            // (Sanity Check)
            if (quarantinedIndices.size > 0) {
                const originalLen = requestBody.params.allowed_indices.length;
                requestBody.params.allowed_indices = requestBody.params.allowed_indices.filter(i => !quarantinedIndices.has(i));
                if (requestBody.params.allowed_indices.length < originalLen) {
                    console.log(`[Search] Pruned ${originalLen - requestBody.params.allowed_indices.length} quarantined strategies from explicit list.`);
                }
            }
        }
    }
    // ----------------------------

    // --- ALWAYS RENDER DETAILED STATUS CARD ---
    // --- ALWAYS RENDER DETAILED STATUS CARD ---
    const useUnused = config.sourceUnused !== false;
    const useLinked = config.sourceLinked !== false;
    // Handle edge case where allowed_indices is empty but search is running (implies all)


    // Calculate Detailed Counts for Display
    let totalStratCount = requestBody.params.allowed_indices ? requestBody.params.allowed_indices.length : state.loadedStrategyFiles.length;
    if (totalStratCount === 0 && state.loadedStrategyFiles.length > 0) totalStratCount = state.loadedStrategyFiles.length;

    let newCount = 0;
    let usedCount = 0;

    // Quick calculation of breakdown
    const tempLinkedIndices = new Set();
    if (state.savedPortfolios) {
        state.savedPortfolios.forEach(p => {
            if (p.indices) p.indices.forEach(i => tempLinkedIndices.add(i));
        });
    }

    if (requestBody.params.allowed_indices && requestBody.params.allowed_indices.length > 0) {
        requestBody.params.allowed_indices.forEach(idx => {
            if (tempLinkedIndices.has(idx)) usedCount++;
            else newCount++;
        });
    } else {
        state.loadedStrategyFiles.forEach((_, idx) => {
            if (tempLinkedIndices.has(idx)) usedCount++;
            else newCount++;
        });
    }

    const poolSummary = `Nuevas: ${newCount} | Usadas: ${usedCount} (Total: ${totalStratCount})`;

    const objKey = config.objective || 'search';
    const objLabelMap = {
        'boost': 'Mejorando Portafolio',
        'satellite': 'Buscando Satélite',
        'lab': 'Exploración de Laboratorio',
        'hybrid': 'Satélite Híbrido',
        'hybrid_satellite': 'Satélite Evolutivo',
        'evolution': 'Evolución Genética'
    };

    // FIX: Show "Mode (Activity)" logic as requested
    console.log('[Databank] Generating Label. Active:', evolutionManager.active, 'Obj:', objKey);
    let objLabel = objLabelMap[objKey] || 'Búsqueda Estándar';

    if (evolutionManager.active && evolutionManager.config) {
        const originalObj = evolutionManager.config.objective;
        let baseModeLabel = '';

        if (originalObj === 'hybrid_satellite') baseModeLabel = 'Satélite Evolutivo';
        else if (originalObj === 'evolution') baseModeLabel = 'Evolución Genética';

        if (baseModeLabel) {
            // If current internal objective is different (e.g. 'lab' driving the evolution), append it as context
            if (objKey !== originalObj) {
                // Map internal key to short readable string
                const internalMap = { 'lab': 'Lab', 'search': 'Sembrado', 'boost': 'Boost' };
                const internalLabel = internalMap[objKey] || objKey;
                objLabel = `${baseModeLabel} <span class="text-xs text-gray-400">| ${internalLabel}</span>`;
            } else {
                objLabel = baseModeLabel;
            }
        }
    }

    const metricLabel = config.metric || 'Sharpe';
    const goalArrow = config.goal === 'minimize' ? '⬇️' : '⬆️';
    const constraints = `Corr < ${config.correlationThreshold || 0.9} | Size: ${config.maxSize || '?'}`;
    const algo = config.searchMethod === 'auto' ? 'Auto' : (config.searchMethod || 'Auto');

    const statusContainer = document.getElementById('databank-status-bar');
    if (statusContainer) {
        // Calculate initial timer string to prevent 00:00 flicker on re-render
        let initialTimeStr = "00:00";
        if (state.searchStartTime) {
            const elapsed = Math.floor((Date.now() - state.searchStartTime) / 1000);
            const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const secs = (elapsed % 60).toString().padStart(2, '0');
            initialTimeStr = `${mins}:${secs}`;
        }

        statusContainer.classList.remove('hidden');
        statusContainer.innerHTML = `
        <div class="flex flex-col gap-1 text-[10px] font-mono leading-tight bg-gray-900/90 p-2 rounded border border-gray-700 shadow-xl backdrop-blur-sm animate-fade-in min-w-[240px]">
            <div class="font-bold text-blue-400 border-b border-gray-700 pb-1 mb-1 flex justify-between items-center">
                <span>${objLabel}</span>
                <div class="flex items-center gap-2">
                    <span id="databank-timer" class="font-mono text-xs text-blue-300">${initialTimeStr}</span>
                    <span class="text-white animate-pulse">Running...</span>
                </div>
            </div>
            <div class="grid grid-cols-1 gap-0.5 text-gray-400">
                    <!-- Dynamic Status Line -->
                <div class="text-yellow-400 font-bold mb-1 truncate" id="databank-card-status-msg">🚀 Inicializando...</div>
                
                <div class="flex justify-between"><span>🎯 Meta:</span> <span class="text-gray-200">${metricLabel} ${goalArrow}</span></div>
                <div class="flex justify-between"><span>📚 Pool:</span> <span class="text-emerald-400 font-bold">${poolSummary}</span></div>
                <div class="flex justify-between"><span>⛓️ Const:</span> <span class="text-gray-300">${constraints}</span></div>
                <div class="flex justify-between"><span>🤖 Algo:</span> <span>${algo}</span></div>
                ${config.normalizationEnabled ? `<div class="flex justify-between text-indigo-400"><span>⚖️ Norm:</span> <span>${config.normalizationTarget}</span></div>` : ''}
            </div>
        </div>
    `;
    }

    // --- TIMER LOGIC ---
    // Make timer cumulative: Only set start time if it doesn't exist (i.e. first run of session)
    if (!state.searchStartTime) {
        state.searchStartTime = Date.now();
    }

    // Always clear old interval and restart it (safe)
    if (state.searchTimerInterval) clearInterval(state.searchTimerInterval);
    state.searchTimerInterval = setInterval(() => {
        const timerEl = document.getElementById('databank-timer');
        if (timerEl) {
            const elapsed = Math.floor((Date.now() - state.searchStartTime) / 1000);
            const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const secs = (elapsed % 60).toString().padStart(2, '0');
            timerEl.textContent = `${mins}:${secs}`;
        }
    }, 1000);

    // Save configuration state
    state.currentOptimizationData = {
        ...requestBody.params,
        normalizationEnabled: config.normalizationEnabled
    };

    try {
        const response = await fetch('/databank/find-portfolios-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: signal
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status} `);
        if (!response.body) throw new Error("No response body received");

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                console.log("[DataBank] Stream reader done (Backend closed connection).");
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            let boundary = buffer.indexOf('\n\n');

            while (boundary !== -1) {
                const message = buffer.substring(0, boundary);
                buffer = buffer.substring(boundary + 2);

                if (message.startsWith('data:')) {
                    const jsonData = message.substring(5).trim();
                    if (!jsonData) continue;
                    try {
                        const data = JSON.parse(jsonData);
                        // --- HANDLING ---
                        if (data.status === 'info' || data.status === 'progress' || data.status === 'scanning') {
                            if (!evolutionManager.active || config.objective !== 'search') {
                                setDatabankStatus('searching', data.message);
                            }
                        } else if (data.status === 'paused') {
                            setDatabankStatus('paused', data.message);
                        } else if (data.status === 'stopped') {
                            // Handled by abort mostly
                        } else if (data.status === 'error') {
                            if (onCallback) onCallback('error', data.message);
                            else displayError(data.message);
                        } else if (data.status !== 'completed' && data.status !== 'resumed') {
                            // Valid Portfolio
                            const newPortfolio = data;
                            if (!newPortfolio.name && newPortfolio.indices) newPortfolio.name = newPortfolio.indices.map(i => state.loadedStrategyFiles[i]?.name.replace('.csv', '') || `Estrat.${i + 1} `).join(', ');
                            addToDatabankIfBetter(newPortfolio, parseInt(dom.databankSizeInput?.value || 20, 10));

                            if (!window.databankUpdateScheduled) {
                                window.databankUpdateScheduled = true;
                                setTimeout(() => { updateDatabankDisplay(); window.databankUpdateScheduled = false; }, 500);
                            }
                        }
                    } catch (e) {
                        console.error("JSON Parse Error:", e);
                    }
                }
                boundary = buffer.indexOf('\n\n');
            }
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error("Stream Error:", error);
            displayError("Error durante la búsqueda: " + error.message);
            if (onCallback) onCallback('error', error);
        }
    } finally {
        // Only stop timer if NOT in evolution mode. 
        // In evolution, the "generation" persists even if search finishes early.
        if (!evolutionManager.active) {
            if (state.searchTimerInterval) clearInterval(state.searchTimerInterval);
        } else {
            console.log("[DataBank] Search finished, but keeping timer alive for Evolution wait phase.");
        }
    }

    if (onCallback) onCallback('done');
};

export const stopDatabankSearch = () => {
    // Reset global time
    state.searchStartTime = null;

    if (evolutionManager.active) {
        evolutionManager.stop();
    } else {
        // Stop normal search
        if (evolutionManager.abortController) {
            evolutionManager.abortController.abort();
            evolutionManager.abortController = null;
        }
        if (state.searchTimerInterval) clearInterval(state.searchTimerInterval); // Timer cleanup
        setDatabankStatus('stopped', 'Búsqueda detenida por el usuario.');

        // Restore UI
        if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.disabled = false;
        if (dom.clearDatabankBtn) dom.clearDatabankBtn.disabled = false;
        if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
        if (dom.pauseSearchBtn) dom.pauseSearchBtn.disabled = true;
        if (dom.stopSearchBtn) dom.stopSearchBtn.disabled = true;

        // Call Backend Stop
        fetch('/databank/stop', { method: 'POST' }).catch(err => console.error("Error stopping backend:", err));
    }
};

/**
 * Inicia la búsqueda de portafolios en el DataBank.
 */
export const findDatabankPortfolios = async (customConfig = {}) => {
    if (state.rawStrategiesData.length < 2) {
        displayError("Necesitas al menos 2 estrategias cargadas para buscar portafolios.");
        return;
    }
    hideError();

    // Reset UI State
    if (dom.pauseSearchBtn) dom.pauseSearchBtn.disabled = false;
    if (dom.stopSearchBtn) dom.stopSearchBtn.disabled = false;
    if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.disabled = true;
    if (dom.clearDatabankBtn) dom.clearDatabankBtn.disabled = true;
    if (dom.databankSizeInput) dom.databankSizeInput.disabled = true;

    // Persistence Safety
    if (!state.databankPortfolios) state.databankPortfolios = [];

    // Check Evolution Mode
    if (customConfig.objective === 'evolution') {
        evolutionManager.start(customConfig);
        return;
    }

    // Normal Search
    updateDatabankDisplay();
    setDatabankStatus('connecting', 'Conectando con el backend...');

    // Create a generic abort controller for the simple search 
    evolutionManager.abortController = new AbortController();

    await executeBackendSearch(customConfig, evolutionManager.abortController.signal, (type) => {
        if (type === 'done' || type === 'error') {
            setDatabankStatus('completed', 'Búsqueda finalizada');
            // Restore UI
            if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.disabled = false;
            if (dom.clearDatabankBtn) dom.clearDatabankBtn.disabled = false;
            if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
            if (dom.pauseSearchBtn) dom.pauseSearchBtn.disabled = true;
            if (dom.stopSearchBtn) dom.stopSearchBtn.disabled = true;
        }
    });
};



/**
 * Añade un portafolio al DataBank si es mejor que los existentes.
 */
const addToDatabankIfBetter = (portfolioData, maxSize) => {
    // Esta función se asegura de que el DataBank solo contenga la mejor versión de cada
    // combinación de estrategias única, evitando duplicados.

    const { indices, metricValue, optimizationGoal } = portfolioData;
    const key = indices.sort((a, b) => a - b).join(',');

    const existingIndex = state.databankPortfolios.findIndex(p => p.key === key);

    if (existingIndex > -1) {
        const existingPortfolio = state.databankPortfolios[existingIndex];
        const isNewBetter = (optimizationGoal === 'maximize')
            ? metricValue > existingPortfolio.metricValue
            : metricValue < existingPortfolio.metricValue;

        if (isNewBetter) {
            state.databankPortfolios[existingIndex] = { ...portfolioData, key };
        } else {
            return;
        }
    } else {
        state.databankPortfolios.push({ ...portfolioData, key });
    }

    state.databankPortfolios.sort((a, b) => {
        const valA = isFinite(a.metricValue) ? a.metricValue : (optimizationGoal === 'maximize' ? -Infinity : Infinity);
        const valB = isFinite(b.metricValue) ? b.metricValue : (optimizationGoal === 'maximize' ? -Infinity : Infinity);
        return optimizationGoal === 'maximize' ? valB - valA : valA - valB;
    });

    if (state.databankPortfolios.length > maxSize) {
        state.databankPortfolios = state.databankPortfolios.slice(0, maxSize);
        console.log(`[DEBUG DATABANK] Sliced to maxSize(${maxSize}).New count: ${state.databankPortfolios.length} `);
    } else {
        console.log(`[DEBUG DATABANK] Portfolio added / updated.Current count: ${state.databankPortfolios.length} (Max: ${maxSize})`);
    }
};

/**
 * Actualiza la tabla del DataBank en la UI.
 */
export const updateDatabankDisplay = () => {
    updateDatabankCount();

    // Initialize table if needed
    initDatabankTable();

    if (state.databankPortfolios.length === 0) {
        dom.databankEmptyRow.classList.remove('hidden');
        dom.databankTableBody.innerHTML = '';
        dom.databankTableBody.appendChild(dom.databankEmptyRow);
        dom.databankTableHeader.innerHTML = '';
        return;
    }

    dom.databankEmptyRow.classList.add('hidden');

    // Get custom column configuration
    const config = getDatabankTableConfig();
    const visibleColumns = config.visibleColumns;

    // 2. Render Headers
    dom.databankTableHeader.innerHTML = '';
    const headerRow = document.createElement('tr');

    // Checkbox header
    const thCheckbox = document.createElement('th');
    thCheckbox.className = 'px-4 py-3 w-8 text-left text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10';
    thCheckbox.innerHTML = '<input type="checkbox" id="databank-select-all" class="form-checkbox h-4 w-4 bg-gray-800 border-gray-600 rounded text-sky-500 focus:ring-sky-600">';
    headerRow.appendChild(thCheckbox);

    // Rank header
    const thRank = document.createElement('th');
    thRank.className = 'px-4 py-3 w-12 text-left text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10 relative group select-none cursor-pointer hover:text-white transition-colors';
    if (state.databankSortConfig.key === 'metricValue') {
        thRank.className += ' text-blue-400';
    }
    const rankLabel = 'Rank' + (state.databankSortConfig.key === 'metricValue' ? (state.databankSortConfig.order === 'asc' ? ' ▲' : ' ▼') : '');
    thRank.textContent = rankLabel;
    thRank.dataset.sortKey = 'metricValue';

    // Resizer
    const rankResizer = document.createElement('div');
    rankResizer.className = 'absolute right-0 top-0 bottom-0 w-1 cursor-col-resize bg-gray-600 hover:bg-blue-500 transition-colors';
    rankResizer.addEventListener('mousedown', initDatabankResize);
    thRank.appendChild(rankResizer);
    headerRow.appendChild(thRank);

    // Data columns
    visibleColumns.forEach(key => {
        const colInfo = ALL_METRICS[key];
        if (!colInfo) return;

        const th = document.createElement('th');
        th.className = 'px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10 relative group select-none cursor-pointer hover:text-white transition-colors';

        const isSorting = state.databankSortConfig.key === key;
        if (isSorting) {
            th.className += ' text-blue-400';
        }

        const label = colInfo.label + (isSorting ? (state.databankSortConfig.order === 'asc' ? ' ▲' : ' ▼') : '');
        th.textContent = label;
        th.dataset.sortKey = key;
        th.dataset.colId = key;
        if (key === 'metricValue') {
            th.id = 'databank-metric-header';
        }

        // Apply saved width OR auto-fit if first time
        if (config.columnWidths && config.columnWidths[key]) {
            th.style.width = config.columnWidths[key];
            th.style.minWidth = config.columnWidths[key];
        } else {
            // First time: auto-fit after table is rendered
            // Special case: name column has max-width limit (contains multiple strategy names)
            if (key === 'name') {
                th.style.maxWidth = '300px';
                th.style.width = '300px';
                th.style.minWidth = '200px';
                // Save this default width
                if (!config.columnWidths) config.columnWidths = {};
                config.columnWidths[key] = '300px';
                localStorage.setItem('databankTableConfig_v6', JSON.stringify(config));
            } else {
                setTimeout(() => autoFitDatabankColumn(th, key), 0);
            }
        }



        // Click to sort
        th.addEventListener('click', (e) => {
            if (e.target.classList.contains('cursor-col-resize')) return;
            sortDatabank(th);
        });

        // Resizer
        const resizer = document.createElement('div');
        resizer.className = 'absolute right-0 top-0 bottom-0 w-1 cursor-col-resize bg-gray-600 hover:bg-blue-500 transition-colors';
        resizer.addEventListener('mousedown', initDatabankResize);
        resizer.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            autoFitDatabankColumn(th, key);
        });
        th.appendChild(resizer);
        headerRow.appendChild(th);
    });

    // Action header
    const thAction = document.createElement('th');
    thAction.className = 'px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-900 z-10';
    thAction.textContent = 'Acción';
    headerRow.appendChild(thAction);

    dom.databankTableHeader.appendChild(headerRow);

    const metricHeader = document.getElementById('databank-metric-header');

    let html = '';
    const rankColors = ['bg-amber-400', 'bg-slate-300', 'bg-yellow-600'];

    state.databankPortfolios.forEach((p, index) => {
        if (index === 0) {
            // Debugging removed
        }
        let rowClass = (index < 3 && state.databankSortConfig.key === 'metricValue') ? 'databank-top3' : '';
        const selectionIndex = state.selectedRows.databank.indexOf(index);
        if (selectionIndex !== -1) {
            rowClass = SELECTION_COLORS[selectionIndex % SELECTION_COLORS.length];
        }

        let rankBadge = `<span class="font-bold">${index + 1}</span>`;
        if (index < 3 && state.databankSortConfig.key === 'metricValue') {
            rankBadge = `<span class="inline-block text-xs py-0.5 px-2 ${rankColors[index]} text-gray-900 rounded-full font-bold">#${index + 1}</span>`;
        }

        html += `<tr class="${rowClass} hover:bg-gray-700/50 transition-colors cursor-pointer border-b border-gray-700 last:border-0" data-row-type="databank" data-row-index="${index}">
                <td class="px-4 py-3"><input type="checkbox" data-index="${index}" class="databank-row-checkbox form-checkbox h-4 w-4 bg-gray-800 border-gray-600 rounded text-sky-500 focus:ring-sky-600"></td>
                <td class="px-4 py-3 text-center">${rankBadge}</td>`;

        visibleColumns.forEach(key => {
            // Safety check: ensure column exists in definition to match header rendering
            const colInfo = ALL_METRICS[key];
            if (!colInfo) return;

            if (key === 'name') {
                let constructedName = p.name;
                if (!constructedName && p.indices) {
                    constructedName = p.indices.map(i => state.loadedStrategyFiles[i]?.name || `Estrat ${i + 1} `).join(', ');
                }
                // Compact View: Single line with ellipsis, full list in tooltip
                const count = p.indices ? p.indices.length : 0;
                const shortText = `${count} Estrategias: ${constructedName} `;
                html += `<td class="px-4 py-3 text-gray-300 max-w-xs truncate" title="${constructedName}">
    <div class="truncate text-sm">${shortText}</div>
                         </td>`;
            } else {
                // Get value from metrics or analysis.metrics
                let value;
                if (key === 'metricValue') {
                    value = p.metricValue;
                } else if (key === 'strategyCount') {
                    value = p.indices ? p.indices.length : 0;
                    // console.log(`[DEBUG] Row ${ index } - strategyCount: `, value, 'Indices:', p.indices);
                } else if (key === 'returnDD') {
                    // Mapping for Ret/DD
                    const metrics = p.metrics || p.analysis?.metrics || p.analysis || {};
                    value = metrics['profitMaxDD_Ratio'];
                } else if (key === 'cagr_custom_score') {
                    // Fallback to metricValue (Optimization Goal) if specific custom score is missing
                    value = p.metrics?.[key] ?? p.analysis?.metrics?.[key] ?? p.metricValue;
                } else {
                    value = p.metrics?.[key] ?? p.analysis?.metrics?.[key] ?? p.analysis?.[key];
                }

                if (index === 0) {
                    // console.log(`[DEBUG FRONTEND] Col '${key}': Value extracted: `, value);
                    if (key === 'correlationWithBase') console.log(`[DEBUG FRONTEND] correlationWithBase value: `, value, 'Metrics:', p.metrics);
                }

                html += `<td class="px-4 py-3 text-gray-300 text-right whitespace-nowrap">${formatMetricForDisplay(value, key)}</td>`;
            }
        });


        // Add action column
        html += `<td class="px-4 py-3 text-center sticky right-0 bg-gray-800 z-10 whitespace-nowrap">
                    <button class="view-strategy-risk-btn text-gray-400 hover:text-sky-400 text-lg px-1 mr-2" title="Ver Riesgo Base" data-index="${index}" data-source="databank">👁️</button>
                    <button class="databank-save-single-btn bg-sky-700 hover:bg-sky-800 text-white font-bold py-1 px-2 rounded text-xs" data-index="${index}">Guardar</button>
                 </td></tr>`;
    });
    dom.databankTableBody.innerHTML = html;

    const firstPortfolio = state.databankPortfolios[0];
    if (metricHeader && firstPortfolio && firstPortfolio.metricName) {
        metricHeader.textContent = firstPortfolio.metricName;
    }
};

// Make globally accessible for databankTable modal
window.updateDatabankDisplay = updateDatabankDisplay;

// Auto-fit column to content
// Auto-fit column to content
function autoFitDatabankColumn(th, colId) {
    const tableBody = dom.databankTableBody;
    if (!tableBody) return;

    const rows = tableBody.querySelectorAll('tr');
    let maxWidth = 50;

    const tempSpan = document.createElement('span');
    tempSpan.style.visibility = 'hidden';
    tempSpan.style.position = 'absolute';
    tempSpan.style.whiteSpace = 'nowrap';
    tempSpan.className = 'px-4 py-3 text-xs';
    document.body.appendChild(tempSpan);

    // Measure header
    tempSpan.textContent = th.textContent;
    maxWidth = Math.max(maxWidth, tempSpan.offsetWidth + 20);

    // Measure cells
    const config = getDatabankTableConfig();
    const colIndex = config.visibleColumns.indexOf(colId) + 2; // +2 for checkbox and rank

    rows.forEach(row => {
        const cell = row.children[colIndex];
        if (cell) {
            tempSpan.textContent = cell.textContent;
            maxWidth = Math.max(maxWidth, tempSpan.offsetWidth);
        }
    });

    document.body.removeChild(tempSpan);

    const newWidth = maxWidth + 'px';
    th.style.width = newWidth;
    th.style.minWidth = newWidth;

    const tableConfig = getDatabankTableConfig();
    if (!tableConfig.columnWidths) tableConfig.columnWidths = {};
    tableConfig.columnWidths[colId] = newWidth;
    localStorage.setItem('databankTableConfig', JSON.stringify(tableConfig));
}

/**
 * Initialize Focus Mode listeners for DataBank
 */
export const initDatabankFocus = () => {
    if (!dom.databankTableBody) return;

    dom.databankTableBody.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        if (!row) return;

        // Ignore if clicking on checkbox or buttons
        if (e.target.closest('input[type="checkbox"]') || e.target.closest('button')) return;

        const index = row.dataset.rowIndex;
        if (index !== undefined) {
            const portfolio = state.databankPortfolios[index];
            if (portfolio) {
                focusMode.enable(portfolio, 'databank', row);
            }
        }
    });
};

// Resizer functionality (copied from Strategies)
let databankResizeData = null;

function initDatabankResize(e) {
    databankResizeData = {
        th: e.target.parentElement,
        startX: e.pageX,
        startWidth: e.target.parentElement.offsetWidth
    };
    document.addEventListener('mousemove', doDatabankResize);
    document.addEventListener('mouseup', stopDatabankResize);
    e.preventDefault();
}

function doDatabankResize(e) {
    if (!databankResizeData) return;
    const delta = e.pageX - databankResizeData.startX;
    const newWidth = Math.max(50, databankResizeData.startWidth + delta);
    databankResizeData.th.style.width = newWidth + 'px';
    databankResizeData.th.style.minWidth = newWidth + 'px';
}

function stopDatabankResize() {
    if (databankResizeData) {
        const colId = databankResizeData.th.dataset.colId || databankResizeData.th.dataset.sortKey;
        const newWidth = databankResizeData.th.style.width;

        const config = getDatabankTableConfig();
        if (!config.columnWidths) config.columnWidths = {};
        config.columnWidths[colId] = newWidth;
        localStorage.setItem('databankTableConfig', JSON.stringify(config));

        databankResizeData = null;
    }
    document.removeEventListener('mousemove', doDatabankResize);
    document.removeEventListener('mouseup', stopDatabankResize);
}



/**
 * Ordena la tabla del DataBank.
 */
// Make globally accessible
window.renderBaseStrategiesConfig = renderBaseStrategiesConfig;

/**
 * Renders the configuration panel for Base Strategies (Locked/Fixed)
 */
export function renderBaseStrategiesConfig() {
    // 1. Find or Create Container
    // We want to insert it before the "Find Portfolios" button or controls area.
    // Let's assume there is a container holding the search button.
    const searchBtn = document.getElementById('find-databank-portfolios-btn');
    if (!searchBtn) return;

    const parentContainer = searchBtn.closest('.flex.flex-wrap') || searchBtn.parentElement;
    let configContainer = document.getElementById('base-strategies-config-container');

    if (state.searchBasePortfolioIndex === null) {
        if (configContainer) configContainer.classList.add('hidden');
        return;
    }

    if (!configContainer) {
        configContainer = document.createElement('div');
        configContainer.id = 'base-strategies-config-container';
        configContainer.className = 'w-full bg-slate-800/50 border border-slate-700 rounded p-3 mb-4 mt-2';
        parentContainer.insertBefore(configContainer, parentContainer.firstChild); // Insert at top of controls
    }

    configContainer.classList.remove('hidden');

    // 2. Get Portfolio Data
    const portfolio = state.savedPortfolios[state.searchBasePortfolioIndex];
    if (!portfolio) {
        configContainer.classList.add('hidden');
        return;
    }

    // 3. Render Content
    let strategiesListHTML = '';

    // Use indices approach for rendering logic
    // We already resolved indices into state.searchBaseStrategyIndices
    // But we need to map them back to names/files to show checks

    // Get ALL strategies that were originally in the portfolio (even if unchecked now, we need to show them)
    // We can iterate state.loadedStrategyFiles and check if they are in the 'original' set.
    // BUT we didn't store the 'original set' separately from the 'active set'.
    // We should re-derive the list from the portfolio object every time, 
    // but check the state.searchBaseStrategyIndices for the checked state.

    let potentialIndices = [];
    if (portfolio.strategyIds && portfolio.strategyIds.length > 0) {
        portfolio.strategyIds.forEach(id => {
            const idx = state.loadedStrategyFiles.findIndex(f => f.strategyId === id);
            if (idx !== -1) potentialIndices.push(idx);
        });
    } else if (portfolio.indices) {
        potentialIndices = portfolio.indices;
    }

    potentialIndices.forEach(idx => {
        const file = state.loadedStrategyFiles[idx];
        if (!file) return;

        const isChecked = state.searchBaseStrategyIndices.has(idx);

        strategiesListHTML += `
    < label class="flex items-center space-x-2 text-xs bg-slate-900/50 p-1.5 rounded cursor-pointer hover:bg-slate-700 transition-colors" >
        <input type="checkbox"
            class="form-checkbox h-3 w-3 text-sky-500 rounded border-gray-600 bg-gray-800 focus:ring-sky-600 base-strategy-checkbox"
            value="${idx}"
            ${isChecked ? 'checked' : ''}>
            <span class="truncate max-w-[150px] text-gray-300" title="${file.name}">${file.name.replace('.csv', '')}</span>
        </label>
`;
    });

    configContainer.innerHTML = `
    < div class="flex items-center justify-between mb-2 border-b border-slate-700/50 pb-1" >
            <h4 class="text-xs font-semibold text-sky-400 flex items-center gap-2">
                <span>🛡️ Base Team: ${portfolio.name}</span>
                <span class="text-[10px] text-gray-500 font-normal">(${state.searchBaseStrategyIndices.size} locked)</span>
            </h4>
            <button class="text-[10px] text-gray-400 hover:text-white hover:bg-red-900/30 px-2 rounded" onclick="window.clearBasePortfolioSelection()">
                Clear Selection
            </button>
        </div >
        <div class="flex flex-wrap gap-2 max-h-[100px] overflow-y-auto custom-scrollbar">
            ${strategiesListHTML}
        </div>
        <div class="mt-2 text-[10px] text-gray-500 italic">
            * Selected strategies will be locked in the search. Uncheck to treat them as optional candidates.
        </div>
`;

    // Add listeners
    const checkboxes = configContainer.querySelectorAll('.base-strategy-checkbox');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', (e) => {
            const idx = parseInt(e.target.value, 10);
            if (e.target.checked) {
                state.searchBaseStrategyIndices.add(idx);
            } else {
                state.searchBaseStrategyIndices.delete(idx);
            }
            // Re-render to update counts? Or just update UI count text.
            // Re-render is safer for counts.
            renderBaseStrategiesConfig();
        });
    });
}

// Helper to clear selection from UI
window.clearBasePortfolioSelection = () => {
    state.searchBasePortfolioIndex = null;
    state.searchBaseStrategyIndices.clear();

    // Uncheck radio buttons
    const radios = document.querySelectorAll('input[name="base-portfolio-select"]');
    radios.forEach(r => r.checked = false);

    renderBaseStrategiesConfig();

    if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.classList.add('hidden');
};

export const sortDatabank = (headerEl) => {
    const isRunning = dom.findDatabankPortfoliosBtn.disabled && !state.isSearchPaused && !state.isSearchStopped;
    if (isRunning) return;

    const sortKey = headerEl.dataset.sortKey;
    if (!sortKey) return;

    let newOrder;
    if (state.databankSortConfig.key === sortKey) {
        newOrder = state.databankSortConfig.order === 'asc' ? 'desc' : 'asc';
    } else {
        const metricsToMinimize = ['maxDrawdown', 'maxDrawdownInDollars', 'maxStagnationTrades', 'maxConsecutiveLosses', 'avgLoss', 'downsideCapture', 'maxConsecutiveLosingMonths'];
        newOrder = metricsToMinimize.includes(sortKey) ? 'asc' : 'desc';
    }

    if (sortKey === 'metricValue') {
        const optimizationGoal = state.databankPortfolios[0]?.optimizationGoal || dom.optimizationGoalSelect.value;
        if (state.databankSortConfig.key !== 'metricValue') {
            newOrder = (optimizationGoal === 'maximize') ? 'desc' : 'asc';
        }
    }

    state.databankSortConfig.key = sortKey;
    state.databankSortConfig.order = newOrder;

    document.querySelectorAll('#databank-table-header th.sortable').forEach(th => th.removeAttribute('data-order'));
    headerEl.dataset.order = newOrder;

    state.databankPortfolios.sort((a, b) => {
        let valA, valB;
        if (sortKey === 'name') { valA = a.name || ''; valB = b.name || ''; }
        else if (sortKey === 'metricValue') { valA = a.metricValue; valB = b.metricValue; }
        else if (sortKey === 'strategyCount') { valA = a.indices ? a.indices.length : 0; valB = b.indices ? b.indices.length : 0; }
        else { valA = a.metrics[sortKey]; valB = b.metrics[sortKey]; }

        if (typeof valA === 'number') {
            const goal = (newOrder === 'desc') ? 'maximize' : 'minimize';
            valA = isFinite(valA) ? valA : (goal === 'maximize' ? -Infinity : Infinity);
            valB = isFinite(valB) ? valB : (goal === 'maximize' ? -Infinity : Infinity);
        }

        if (valA < valB) return state.databankSortConfig.order === 'asc' ? -1 : 1;
        if (valA > valB) return state.databankSortConfig.order === 'asc' ? 1 : -1;
        return 0;
    });

    updateDatabankDisplay();
};

// This code block is assumed to be part of a function that initiates the databank search,
// such as `findDatabankPortfolios` or similar, and is placed here based on the user's instruction
// to restore the streaming implementation.
// It is placed before `clearDatabank` as it's a new top-level export or function.
// 2. Realizar la petición POST para iniciar el stream en el backend
// Usamos fetch solo para enviar los datos y disparar el proceso
// This block is likely part of an async function, e.g., `export const findDatabankPortfolios = async () => { ... }`
// For the purpose of this edit, it's inserted as a standalone block as per the instruction's context.
/*
    try {
        const response = await fetch('/databank/find-portfolios-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody) // `requestBody` would need to be defined in the actual function
        });
 
        if (!response.ok) {
            throw new Error("El backend no pudo iniciar el proceso de streaming.");
        }
 
        console.log("Conexión de streaming establecida. Escuchando resultados...");
        setDatabankStatus('searching', 'Escuchando resultados del backend...');
 
        let searchMode = ''; // Variable para almacenar el modo de búsqueda
 
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = ''; // Buffer para acumular datos del stream
 
        // Usamos un bucle 'while' en lugar de recursión para evitar el desbordamiento de la pila (stack overflow)
        async function processStream() {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    setDatabankStatus('completed', 'Búsqueda completada');
                    // Re-habilitar botones
                    if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.disabled = false;
                    if (dom.clearDatabankBtn) dom.clearDatabankBtn.disabled = false;
                    if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
                    if (dom.pauseSearchBtn) dom.pauseSearchBtn.disabled = true;
                    if (dom.stopSearchBtn) dom.stopSearchBtn.disabled = true;
                    break; // Salir del bucle
                }
 
                // Añadir el nuevo trozo de datos al buffer
                buffer += decoder.decode(value, { stream: true });
 
                // Buscar mensajes completos en el buffer (delimitados por '\n\n')
                let boundary = buffer.indexOf('\n\n');
                while (boundary !== -1) {
                    const message = buffer.substring(0, boundary);
                    buffer = buffer.substring(boundary + 2); // Eliminar el mensaje procesado del buffer
 
                    if (message.startsWith('data:')) {
                        const jsonData = message.substring(5).trim(); // Eliminar 'data: '
                        if (!jsonData) continue;
 
                        try {
                            const data = JSON.parse(jsonData);
 
                            if (data.status === 'info' || data.status === 'progress') {
                                if (!searchMode) {
                                    if (data.message.toLowerCase().includes('monte carlo')) searchMode = '[Monte Carlo]';
                                    else if (data.message.toLowerCase().includes('exhaustiva')) searchMode = '[Exhaustiva]';
                                }
                                setDatabankStatus('searching', data.message);
                            } else if (data.status === 'paused') {
                                dom.pauseSearchBtn.textContent = 'Reanudar';
                                // Mantener Stop habilitado durante la pausa
                                setDatabankStatus('paused', data.message);
                            } else if (data.status === 'resumed') {
                                dom.pauseSearchBtn.textContent = 'Pausar';
                                setDatabankStatus('searching', data.message);
                            } else if (data.status === 'stopped') {
                                dom.stopSearchBtn.disabled = true;
                                dom.pauseSearchBtn.disabled = true;
                                dom.pauseSearchBtn.textContent = 'Pausar';
                                setDatabankStatus('stopped', data.message);
                            } else if (data.status === 'error') {
                                displayError(data.message); // `displayError` would need to be defined
                                setDatabankStatus('error', 'Error en la búsqueda');
                                // Re-habilitar botones
                                if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.disabled = false;
                                if (dom.clearDatabankBtn) dom.clearDatabankBtn.disabled = false;
                                if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
                                if (dom.pauseSearchBtn) dom.pauseSearchBtn.disabled = true;
                                if (dom.stopSearchBtn) dom.stopSearchBtn.disabled = true;
                                reader.cancel(); // Detener la lectura del stream
                            } else if (data.status === 'completed') {
                                setDatabankStatus('completed', 'Búsqueda completada');
                                // Re-habilitar botones
                                if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.disabled = false;
                                if (dom.clearDatabankBtn) dom.clearDatabankBtn.disabled = false;
                                if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
                                if (dom.pauseSearchBtn) dom.pauseSearchBtn.disabled = true;
                                if (dom.stopSearchBtn) dom.stopSearchBtn.disabled = true;
                                reader.cancel();
                            } else {
                                const newPortfolio = data;
                                if (!newPortfolio.name && newPortfolio.indices) newPortfolio.name = newPortfolio.indices.map(i => state.loadedStrategyFiles[i]?.name.replace('.csv', '') || `Estrat.${ i + 1 } `).join(', ');
                                addToDatabankIfBetter(newPortfolio, parseInt(dom.databankSizeInput?.value || 20, 10)); // `addToDatabankIfBetter` would need to be defined
                                // Throttle: Solo actualizar la UI cada 500ms para mantenerla responsive
                                if (!window.databankUpdateScheduled) {
                                    window.databankUpdateScheduled = true;
                                    setTimeout(() => {
                                        updateDatabankDisplay();
                                        window.databankUpdateScheduled = false;
                                    }, 500);
                                }
                            }
                        } catch (e) {
                            console.error("Error al parsear JSON del stream:", e, "Datos recibidos:", jsonData);
                        }
                    }
                    boundary = buffer.indexOf('\n\n'); // Buscar el siguiente mensaje
                }
            }
        }
        processStream(); // Inicia la lectura del stream
    } catch (error) {
        console.error("Error al iniciar el stream de búsqueda:", error);
        displayError("Error al iniciar la búsqueda de portafolios: " + error.message);
        setDatabankStatus('error', 'Error al iniciar la búsqueda');
        // Re-habilitar botones
        if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.disabled = false;
        if (dom.clearDatabankBtn) dom.clearDatabankBtn.disabled = false;
        if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
        if (dom.pauseSearchBtn) dom.pauseSearchBtn.disabled = true;
        if (dom.stopSearchBtn) dom.stopSearchBtn.disabled = true;
    }
*/

/**
 * Guarda un portafolio desde el DataBank a la lista de portafolios guardados.
 */
export const savePortfolioFromDatabank = (portfolioIndex, metrics) => {
    const portfolio = state.databankPortfolios[portfolioIndex];
    if (!portfolio) return false;

    const isDuplicate = state.savedPortfolios.some(p =>
        p.indices.length === portfolio.indices.length &&
        p.indices.every(i => portfolio.indices.includes(i)) &&
        !p.weights
    );

    if (isDuplicate) {
        console.warn(`Portfolio ${portfolio.key} ya está guardado.`);
        return false;
    }

    const names = portfolio.indices.map(i => state.loadedStrategyFiles[i].name.replace('.csv', '')).join('+');
    const strategyIds = portfolio.indices.map(i => state.loadedStrategyFiles[i].strategyId);
    const strategyNames = portfolio.indices.map(i => state.loadedStrategyFiles[i].name.replace('.csv', ''));

    // Calculate SQ Metrics for persistence
    let allTrades = [];
    portfolio.indices.forEach(idx => {
        const file = state.loadedStrategyFiles[idx];
        if (file && file.content) {
            const trades = parseTradesFromContent(file.content);
            allTrades = allTrades.concat(trades);
        } else if (state.rawStrategiesData[idx]) {
            // Fallback: Use rawStrategiesData if content is missing
            const trades = parseTradesFromData(state.rawStrategiesData[idx]);
            allTrades = allTrades.concat(trades);
        }
    });
    allTrades.sort((a, b) => a.exitTime - b.exitTime);
    const sqMetrics = calculateSQMetrics(allTrades);

    state.savedPortfolios.push({
        name: `P - DB(${names}) ${portfolio.metricName} `,
        indices: portfolio.indices,
        strategyIds: strategyIds, // <--- SAVE STRATEGY IDs
        strategyNames: strategyNames, // <--- SAVE STRATEGY NAMES
        id: generatePortfolioId(`P - DB(${names})`, strategyIds),
        weights: null,
        metrics: portfolio.metrics || metrics, // Use passed metrics if available
        sqMetrics: sqMetrics, // <--- SAVE SQ METRICS
        comments: `Guardado desde DataBank.Métrica: ${portfolio.metricName} (${portfolio.metricValue.toFixed(2)})`
    });
    // Adjuntamos las métricas pre-calculadas para evitar re-análisis innecesario
    return true;
};

/**
 * Limpia el DataBank.
 */
export const clearDatabank = () => {
    state.databankPortfolios = [];
    state.isSearchPaused = false;
    state.isSearchStopped = false;
    setDatabankStatus('hidden');
    updateDatabankDisplay();
    // databankSection ya no existe en el nuevo layout
    if (dom.databankSection) dom.databankSection.classList.add('hidden');
};

// --- PURGE FEATURE ---
export const openPurgeModal = () => {
    // 1. Identify strategies in Databank
    const usageMap = new Map(); // index -> count
    state.databankPortfolios.forEach(p => {
        p.indices.forEach(idx => {
            usageMap.set(idx, (usageMap.get(idx) || 0) + 1);
        });
    });

    if (usageMap.size === 0) {
        showToast('El Databank está vacío. Nada que purgar.', 'info');
        return;
    }

    // 2. Create Modal Content
    // We reuse the generic modal logic or inject a new one. 
    // For simplicity, we create a temporary modal overlay.
    const modalId = 'purge-modal';
    let modal = document.getElementById(modalId);
    if (modal) modal.remove();

    const strategyItems = Array.from(usageMap.entries()).map(([idx, count]) => {
        const file = state.loadedStrategyFiles[idx];
        const name = file ? file.name : `Unknown Strategy ${idx}`;
        return `
            <label class="flex items-center space-x-3 p-2 hover:bg-gray-700/50 rounded cursor-pointer border border-transparent hover:border-gray-600 transition-all">
        <input type="checkbox" class="purge-checkbox form-checkbox h-4 w-4 text-red-500 rounded border-gray-600 bg-gray-800 focus:ring-red-500" value="${idx}">
            <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-gray-200 truncate" title="${name}">${name}</div>
                <div class="text-xs text-gray-500">Presente en ${count} portafolios</div>
            </div>
        </label>
`;
    }).join('');

    const modalHTML = `
        <div id="${modalId}" class="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div class="bg-gray-800 rounded-xl shadow-2xl border border-gray-700 w-[500px] max-w-full flex flex-col max-h-[85vh]">
            <div class="p-6 border-b border-gray-700 flex justify-between items-center bg-gray-800/50 rounded-t-xl">
                <h3 class="text-xl font-bold text-white flex items-center gap-2">
                    <span>🧹</span> Purgar Estrategias
                </h3>
                <button id="close-purge-btn" class="text-gray-400 hover:text-white transition-colors">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>

            <div class="p-4 bg-yellow-900/20 border-b border-yellow-700/30">
                <p class="text-xs text-yellow-200">
                    ⚠️ Las estrategias seleccionadas se eliminarán de TODOS los portafolios del Databank.
                    Los portafolios afectados se recalcularán automáticamente.
                    Si un portafolio se queda vacío, será eliminado.
                </p>
            </div>

            <div class="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-2">
                ${strategyItems}
            </div>

            <div class="p-4 border-t border-gray-700 bg-gray-800/50 rounded-b-xl flex justify-end gap-3">
                <button id="cancel-purge-btn" class="px-4 py-2 text-gray-400 hover:text-white font-medium transition-colors">Cancelar</button>
                <button id="confirm-purge-btn" class="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-red-900/30 transform hover:scale-105 transition-all flex items-center gap-2">
                    <span>🗑️</span> Confirmar Purga
                </button>
            </div>
        </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // 3. Attach Events
    const closeModal = () => document.getElementById(modalId)?.remove();
    document.getElementById('close-purge-btn').onclick = closeModal;
    document.getElementById('cancel-purge-btn').onclick = closeModal;

    document.getElementById('confirm-purge-btn').onclick = () => {
        const checkboxes = document.querySelectorAll('.purge-checkbox:checked');
        const indicesToRemove = Array.from(checkboxes).map(cb => parseInt(cb.value, 10));

        if (indicesToRemove.length === 0) {
            showToast('Selecciona al menos una estrategia para purgar.', 'warning');
            return;
        }

        if (confirm(`¿Eliminar ${indicesToRemove.length} estrategias y recalcular el Databank?`)) {
            closeModal();
            purgeStrategiesFromDatabank(indicesToRemove);
        }
    };
};

const purgeStrategiesFromDatabank = async (indicesToRemove) => {
    const removeSet = new Set(indicesToRemove);
    let removedCount = 0;
    let modifiedPortfoliosCount = 0;

    toggleLoading(true, 'Purgando y Recalculando...');

    // 1. First Pass: Identify Portfolios to Keep and Modify
    const tempDatabank = [];
    const portfoliosToAnalyze = [];

    // Track original indices to map back results

    for (const [index, p] of state.databankPortfolios.entries()) {
        const originalCount = p.indices.length;
        const newIndices = p.indices.filter(i => !removeSet.has(i));

        if (newIndices.length === 0) {
            // Portfolio Empty -> Drop
            removedCount++;
            continue;
        }

        if (newIndices.length !== originalCount) {
            // Modified -> Needs Recalculation
            modifiedPortfoliosCount++;

            // Create a "pending" portfolio object
            const pendingPortfolio = {
                ...p,
                indices: newIndices,
                name: p.name.includes('(Purged)') ? p.name : p.name + ' (Purged)',
                metrics: {}, // Reset metrics as they are invalid
                isPending: true
            };

            tempDatabank.push(pendingPortfolio);

            // Add to backend analysis queue
            // Note: Databank portfolios are equal-weight
            portfoliosToAnalyze.push({
                indices: newIndices,
                weights: null,
                is_databank_portfolio: true,
                temp_databank_index: tempDatabank.length - 1 // Index in the NEW temp array
            });

        } else {
            // Unchanged -> Keep as is
            tempDatabank.push(p);
        }
    }

    // 2. If nothing modified, just update and exit
    if (portfoliosToAnalyze.length === 0) {
        state.databankPortfolios = tempDatabank;
        updateDatabankCount();
        updateDatabankDisplay();
        toggleLoading(false);
        showToast(`✅ Purga Completa. Eliminados: ${removedCount}.`, 'success');
        return;
    }

    // 3. Call Backend for Recalculation (Async)
    // We keep the loading screen active
    toggleLoading(true, 'Recalculando Métricas', `Analizando ${portfoliosToAnalyze.length} portafolios modificados...`);

    try {
        // Use existing function from analysis.js
        // We pass false for risk normalization to get raw metrics first (standard Databank behavior)
        const backendResults = await getFullAnalysisFromBackend(state.rawStrategiesData, portfoliosToAnalyze, false, 0);

        // 4. Update Temp Databank with Results
        // The backend returns results in the ORDER of the list we sent (after the strategies)
        // But getFullAnalysisFromBackend returns [Strategy1, Strategy2, ... Portfolio1, Portfolio2 ...]
        // So we need to slice it.

        const numStrategies = state.loadedStrategyFiles.length;
        const portfolioResults = backendResults.slice(numStrategies);

        portfolioResults.forEach((result, i) => {
            // FIX: Map by index as backend might not echo custom fields
            const requestItem = portfoliosToAnalyze[i];

            if (requestItem && requestItem.temp_databank_index !== undefined) {
                const targetPortfolio = tempDatabank[requestItem.temp_databank_index];

                if (targetPortfolio && result && result.metrics) {
                    targetPortfolio.metrics = result.metrics;
                    targetPortfolio.isPending = false;

                    // Update Sorting Metric Value if possible
                    if (targetPortfolio.metricName && result.metrics[targetPortfolio.metricName]) {
                        targetPortfolio.metricValue = result.metrics[targetPortfolio.metricName];
                    } else if (result.metrics.profitMaxDD_Ratio) {
                        // Fallback defaults
                        targetPortfolio.metricValue = result.metrics.profitMaxDD_Ratio;
                    }
                }
            }
        });

        // 5. Finalize State
        state.databankPortfolios = tempDatabank;
        updateDatabankCount();
        updateDatabankDisplay();

        showToast(`✅ Purga y Recálculo Completos. Modificados: ${modifiedPortfoliosCount}, Eliminados: ${removedCount}.`, 'success');

    } catch (error) {
        console.error("Error recalculating purged portfolios:", error);
        displayError("Hubo un error al recalcular las métricas tras la purga. Revisa la consola.");

        // Fallback: Save what we have, even if metrics are empty/broken, to prevent data loss
        state.databankPortfolios = tempDatabank;
        updateDatabankDisplay();
    } finally {
        toggleLoading(false);
    }
};

// Eliminamos las importaciones de analysis.js que ya no se usan aquí
// import { processStrategyData, calculateCorrelationMatrix } from '../analysis.js';
// import { reAnalyzeAllData } from '../analysis.js';