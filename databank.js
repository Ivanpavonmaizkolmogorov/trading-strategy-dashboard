import { state } from '../state.js';
import { dom } from '../dom.js';
import { ALL_METRICS, SELECTION_COLORS } from '../config.js';
import { hideError, displayError, toggleLoading, formatMetricForDisplay } from '../utils.js';
import { processStrategyData, calculateCorrelationMatrix } from '../analysis.js';
import { reAnalyzeAllData } from '../analysis.js';

/**
 * Inicia la búsqueda de portafolios en el DataBank.
 */
export const findDatabankPortfolios = async () => {
    hideError();
    if (state.rawStrategiesData.length < 2) {
        displayError("Necesitas al menos 2 estrategias cargadas para buscar portafolios.");
        return;
    }

    const findModeIndicator = document.getElementById('find-mode-indicator');
    findModeIndicator.textContent = state.selectedPortfolioIndices.size > 0 ? '(Búsqueda de Complementos)' : '(Búsqueda Global)';

    state.databankPortfolios = [];
    state.isSearchPaused = false;
    state.isSearchStopped = false;

    dom.databankSection.classList.remove('hidden');
    dom.databankStatus.innerHTML = `🏁 Preparando búsqueda...`;
    dom.pauseSearchBtn.disabled = false;
    dom.stopSearchBtn.disabled = false;
    dom.pauseSearchBtn.textContent = 'Pausar';
    toggleLoading(true, 'findDatabankPortfoliosBtn', 'findBestBtnText', 'findBestBtnSpinner');
    dom.clearDatabankBtn.disabled = true;
    if (dom.databankSizeInput) dom.databankSizeInput.disabled = true;

    try {
        await new Promise(resolve => setTimeout(resolve, 50));

        const metricToOptimizeKey = dom.optimizationMetricSelect.value;
        const optimizationGoal = dom.optimizationGoalSelect.value;

        state.databankSortConfig.key = 'metricValue';
        state.databankSortConfig.order = (optimizationGoal === 'maximize') ? 'desc' : 'asc';

        document.querySelectorAll('#databank-table-header th.sortable').forEach(th => th.removeAttribute('data-order'));
        const primaryMetricHeader = document.getElementById('databank-metric-header');
        if(primaryMetricHeader) primaryMetricHeader.dataset.order = state.databankSortConfig.order;

        updateDatabankDisplay();
        const correlationThreshold = parseFloat(dom.correlationFilterInput.value);
        const maxSize = parseInt(dom.databankSizeInput.value, 10);
        const metricName = dom.optimizationMetricSelect.options[dom.optimizationMetricSelect.selectedIndex].text;

        const databankMetricHeader = document.getElementById('databank-metric-header');
        if (databankMetricHeader) databankMetricHeader.textContent = metricName;

        dom.databankStatus.innerHTML = `🔍 Calculando correlaciones...`;
        await new Promise(resolve => setTimeout(resolve, 10));

        const individualAnalyses = state.rawStrategiesData.map(data => processStrategyData(data, state.rawBenchmarkData)).filter(Boolean);
        if(individualAnalyses.length !== state.rawStrategiesData.length){
            displayError("Algunas estrategias no pudieron ser analizadas individualmente. Verifica los datos.");
        }
        const fullCorrelationMatrix = calculateCorrelationMatrix(individualAnalyses.map((analysis, i) => ({ analysis, originalIndex: i })));

        dom.databankStatus.innerHTML = `🔍 Generando combinaciones...`;
        await new Promise(resolve => setTimeout(resolve, 10));

        let allCombinations, totalCombinations;
        const baseIndices = Array.from(state.selectedPortfolioIndices);

        if (baseIndices.length > 0) {
            findModeIndicator.textContent = '(Búsqueda de Complementos)';
            if (baseIndices.length > 1) {
                for (let i = 0; i < baseIndices.length; i++) {
                    for (let j = i + 1; j < baseIndices.length; j++) {
                        if (fullCorrelationMatrix[baseIndices[i]][baseIndices[j]] > correlationThreshold) {
                            const name1 = state.loadedStrategyFiles[baseIndices[i]].name.replace('.csv', '');
                            const name2 = state.loadedStrategyFiles[baseIndices[j]].name.replace('.csv', '');
                            const corrValue = fullCorrelationMatrix[baseIndices[i]][baseIndices[j]].toFixed(3);
                            const errorMsg = `Búsqueda detenida. Las estrategias base seleccionadas '${name1}' y '${name2}' tienen una correlación de ${corrValue}, que supera el máximo permitido de ${correlationThreshold}.`;
                            displayError(errorMsg);
                            dom.databankStatus.innerHTML = `❌ Error de correlación base.`;
                            toggleLoading(false, 'findDatabankPortfoliosBtn', 'findBestBtnText', 'findBestBtnSpinner');
                            dom.clearDatabankBtn.disabled = false;
                            if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
                            return;
                        }
                    }
                }
            }
            const candidateIndices = state.rawStrategiesData.map((_, i) => i).filter(i => !baseIndices.includes(i));
            const maxComplementSize = Math.min(candidateIndices.length, 12 - baseIndices.length);
            const complementCombinations = getCombinations(candidateIndices, 1, maxComplementSize);
            allCombinations = mapGenerator(complementCombinations, complement => [...baseIndices, ...complement].sort((a, b) => a - b));
            totalCombinations = countCombinations(candidateIndices.length, 1, maxComplementSize);
        } else {
            findModeIndicator.textContent = '(Búsqueda Global)';
            const indices = state.rawStrategiesData.map((_, i) => i);
            const maxComboSize = Math.min(indices.length, 12);
            allCombinations = getCombinations(indices, 2, maxComboSize);
            totalCombinations = countCombinations(indices.length, 2, maxComboSize);
        }
        
        if (totalCombinations === 0) {
             dom.databankStatus.innerHTML = `ℹ️ No hay combinaciones posibles para analizar.`;
             toggleLoading(false, 'findDatabankPortfoliosBtn', 'findBestBtnText', 'findBestBtnSpinner');
             dom.clearDatabankBtn.disabled = false;
             if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
             return;
        }

        dom.databankStatus.innerHTML = `🔍 Iniciando análisis de ${totalCombinations} combinaciones...`;

        let idx = 0;
        for (const combo of allCombinations) {
            while (state.isSearchPaused && !state.isSearchStopped) {
                dom.databankStatus.innerHTML = `⏸️ PAUSADO (${((idx / totalCombinations) * 100).toFixed(1)}%) - ${state.databankPortfolios.length} en DataBank`;
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            if (state.isSearchStopped) {
                dom.databankStatus.innerHTML = `⏹️ Detenido en ${idx}/${totalCombinations} (${((idx / totalCombinations) * 100).toFixed(1)}%) - ${state.databankPortfolios.length} en DataBank`;
                break;
            }

            let isCombinationValid = true;
            for (let i = 0; i < combo.length; i++) {
                for (let j = i + 1; j < combo.length; j++) {
                    if (combo[i] >= fullCorrelationMatrix.length || combo[j] >= fullCorrelationMatrix.length || !fullCorrelationMatrix[combo[i]] || combo[j] >= fullCorrelationMatrix[combo[i]].length) {
                         console.warn(`Índice fuera de rango en matriz de correlación: ${combo[i]}, ${combo[j]} para combo ${combo}. Saltando combo.`);
                         isCombinationValid = false;
                         break;
                     }
                    if (fullCorrelationMatrix[combo[i]][combo[j]] > correlationThreshold) {
                        isCombinationValid = false;
                        break;
                    }
                }
                if (!isCombinationValid) break;
            }

            if (!isCombinationValid) {
                 if (idx % 100 === 0 || idx === totalCombinations - 1) {
                     const progress = (((idx + 1) / totalCombinations) * 100).toFixed(1);
                     dom.databankStatus.innerHTML = `🔍 Progreso: ${progress}% (${idx + 1}/${totalCombinations}) - ${state.databankPortfolios.length} en DataBank`;
                     await new Promise(resolve => setTimeout(resolve, 1));
                 }
                continue;
            }

            const equalWeight = 1 / combo.length;
            const portfolioTrades = combo.flatMap(index =>
                state.rawStrategiesData[index] ? state.rawStrategiesData[index].map(trade => ({ ...trade, pnl: trade.pnl * equalWeight })) : []
            );

            if (portfolioTrades.length === 0) {
                 console.warn(`No trades found for combo ${combo}, possibly missing raw data. Skipping.`);
                 if (idx % 100 === 0 || idx === totalCombinations - 1) {
                     const progress = (((idx + 1) / totalCombinations) * 100).toFixed(1);
                     dom.databankStatus.innerHTML = `🔍 Progreso: ${progress}% (${idx + 1}/${totalCombinations}) - ${state.databankPortfolios.length} en DataBank`;
                     await new Promise(resolve => setTimeout(resolve, 1));
                 }
                 continue;
             }

            const analysisResult = processStrategyData(portfolioTrades, state.rawBenchmarkData);

            if (analysisResult && analysisResult.metrics.hasOwnProperty(metricToOptimizeKey)) {
                const metricValue = analysisResult.metrics[metricToOptimizeKey];
                if (metricValue !== undefined && metricValue !== null && !isNaN(metricValue)) {
                    const portfolioName = combo.map(i => (state.loadedStrategyFiles[i] ? state.loadedStrategyFiles[i].name : `Estrat ${i+1}`)).map(name => name.replace('.csv', '')).join(', ');
                    const portfolioData = {
                        indices: combo,
                        name: portfolioName,
                        metricValue: metricValue,
                        metrics: analysisResult.metrics,
                        metricName: metricName,
                        metricNameKey: metricToOptimizeKey,
                        optimizationGoal: optimizationGoal
                    };
                    addToDatabankIfBetter(portfolioData, maxSize);
                }
            }

            idx++;

            if (idx % 20 === 0 || idx === totalCombinations - 1) {
                const progress = (((idx + 1) / totalCombinations) * 100).toFixed(1);
                dom.databankStatus.innerHTML = `🔍 Progreso: ${progress}% (${idx + 1}/${totalCombinations}) - ${state.databankPortfolios.length} en DataBank`;
                updateDatabankDisplay();
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        updateDatabankDisplay();
        if (!state.isSearchStopped) {
             dom.databankStatus.innerHTML = `✅ Búsqueda completada (${totalCombinations}/${totalCombinations}) - ${state.databankPortfolios.length} en DataBank`;
        }

    } catch (error) {
        console.error("Error buscando portafolios en DataBank:", error);
        displayError("Ocurrió un error durante la búsqueda en DataBank.");
        dom.databankStatus.innerHTML = `❌ Error en la búsqueda.`;
    } finally {
        toggleLoading(false, 'findDatabankPortfoliosBtn', 'findBestBtnText', 'findBestBtnSpinner');
        dom.pauseSearchBtn.disabled = true;
        dom.stopSearchBtn.disabled = true;
        dom.clearDatabankBtn.disabled = false;
        if (dom.databankSizeInput) dom.databankSizeInput.disabled = false;
        state.isSearchPaused = false;
        state.isSearchStopped = false;
    }
};

/**
 * Añade un portafolio al DataBank si es mejor que los existentes.
 */
const addToDatabankIfBetter = (portfolioData, maxSize) => {
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
    }
};

/**
 * Actualiza la tabla del DataBank en la UI.
 */
export const updateDatabankDisplay = () => {
    if (state.databankPortfolios.length === 0) {
        dom.databankEmptyRow.classList.remove('hidden');
        dom.databankTableBody.innerHTML = '';
        dom.databankTableBody.appendChild(dom.databankEmptyRow);
        dom.databankTableHeader.innerHTML = '';
        return;
    }

    dom.databankEmptyRow.classList.add('hidden');

    const activeViewColumns = state.tableViews.databank[state.activeViews.databank]?.columns || state.tableViews.databank['default'].columns;
    let headerHTML = '<tr>';
    headerHTML += `<th class="p-1.5 w-8 align-bottom"><input type="checkbox" id="databank-select-all" class="form-checkbox h-4 w-4 bg-gray-800 border-gray-600 rounded text-sky-500 focus:ring-sky-600"></th>`;
    headerHTML += `<th class="p-2 w-12 sortable align-bottom" data-sort-key="metricValue" ${state.databankSortConfig.key === 'metricValue' ? `data-order="${state.databankSortConfig.order}"` : ''}>Rank</th>`;
    
    activeViewColumns.forEach(key => {
        const colInfo = ALL_METRICS[key];
        if (colInfo) {
            const orderIndicator = state.databankSortConfig.key === key ? `data-order="${state.databankSortConfig.order}"` : '';
            const id = key === 'metricValue' ? 'id="databank-metric-header"' : '';
            if (key === 'name') {
                headerHTML += `<th class="${colInfo.class} sortable" ${id} data-sort-key="${key}" ${orderIndicator}>${colInfo.label}</th>`;
            } else {
                headerHTML += `<th class="${colInfo.class.replace('text-right', 'text-center')} sortable" ${id} data-sort-key="${key}" ${orderIndicator}><div class="corr-header">${colInfo.label}</div></th>`;
            }
        }
    });
    headerHTML += `<th class="p-2 text-center sticky right-0 bg-gray-700 z-20 align-bottom">Acción</th>`;
    headerHTML += '</tr>';
    dom.databankTableHeader.innerHTML = headerHTML;
    
    const metricHeader = document.getElementById('databank-metric-header');
    if (metricHeader) {
        metricHeader.textContent = state.databankPortfolios[0]?.metricName || 'Métrica';
    }

    let html = '';
    const rankColors = ['bg-amber-400', 'bg-slate-300', 'bg-yellow-600'];
    
    state.databankPortfolios.forEach((p, index) => {
        let rowClass = (index < 3 && state.databankSortConfig.key === 'metricValue') ? 'databank-top3' : '';
        const selectionIndex = state.selectedRows.databank.indexOf(index);
        if (selectionIndex !== -1) {
            rowClass = SELECTION_COLORS[selectionIndex % SELECTION_COLORS.length];
        }
        
        let rankBadge = `<span class="font-bold">${index + 1}</span>`;
        if (index < 3 && state.databankSortConfig.key === 'metricValue') {
            rankBadge = `<span class="inline-block text-xs py-0.5 px-2 ${rankColors[index]} text-gray-900 rounded-full font-bold">#${index + 1}</span>`;
        }

        html += `<tr class="${rowClass} hover:bg-gray-700/50 text-xs cursor-pointer" data-row-type="databank" data-row-index="${index}">
                <td class="p-2"><input type="checkbox" data-index="${index}" class="databank-row-checkbox form-checkbox h-4 w-4 bg-gray-800 border-gray-600 rounded text-sky-500 focus:ring-sky-600"></td>
                <td class="p-2 text-center">${rankBadge}</td>`;

        activeViewColumns.forEach(key => {
            if (key === 'name') {
                const names = p.name || p.indices.map(i => (state.loadedStrategyFiles[i] ? state.loadedStrategyFiles[i].name : `Estrat ${i+1}`)).map(name => `<div class="copyable-strategy p-0.5 rounded-sm" title="Copiar '${name.replace('.csv', '')}'">${name.replace('.csv', '')}</div>`).join('');
                html += `<td class="p-2 text-gray-300 max-w-xs">${names}</td>`;
            } else {
                const value = key === 'metricValue' ? p.metricValue : p.metrics[key];
                html += `<td class="p-2 text-right">${formatMetricForDisplay(value, key)}</td>`;
            }
        });

        html += `<td class="p-2 text-center sticky right-0 bg-gray-800 z-10"><button class="databank-save-single-btn bg-sky-700 hover:bg-sky-800 text-white font-bold py-1 px-2 rounded text-xs" data-index="${index}">Guardar</button></td></tr>`;
    });
    dom.databankTableBody.innerHTML = html;
};

/**
 * Ordena la tabla del DataBank.
 */
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

/**
 * Guarda un portafolio desde el DataBank a la lista de portafolios guardados.
 */
export const savePortfolioFromDatabank = (portfolioIndex) => {
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

    const names = portfolio.indices.map(i => state.loadedStrategyFiles[i].name.replace('.csv', '').substring(0, 5)).join('+');
    
    state.savedPortfolios.push({
        name: `P-DB (${names}) ${portfolio.metricName}`,
        indices: portfolio.indices,
        id: state.nextPortfolioId++,
        weights: null,
        comments: `Guardado desde DataBank. Métrica: ${portfolio.metricName} (${portfolio.metricValue.toFixed(2)})`
    });
    return true;
};

/**
 * Limpia el DataBank.
 */
export const clearDatabank = () => {
    state.databankPortfolios = [];
    state.isSearchPaused = false;
    state.isSearchStopped = false;
    dom.databankStatus.innerHTML = 'DataBank limpiado.';
    updateDatabankDisplay();
    dom.databankSection.classList.add('hidden');
};

// --- Helper Functions ---

function* getCombinations(arr, minSize = 2, maxSize = arr.length) {
    function* combine(startIndex, currentCombination, k) {
        if (currentCombination.length === k) { yield [...currentCombination]; return; }
        if (startIndex === arr.length) return;
        for (let i = startIndex; i < arr.length; i++) {
            currentCombination.push(arr[i]);
            yield* combine(i + 1, currentCombination, k);
            currentCombination.pop();
        }
    }
    for (let k = minSize; k <= maxSize; k++) {
        yield* combine(0, [], k);
    }
}

function* mapGenerator(generator, mapFn) {
    for (const value of generator) {
        yield mapFn(value);
    }
}

const countCombinations = (n, minSize, maxSize) => {
    const combinations = (n_c, k_c) => {
        if (k_c < 0 || k_c > n_c) return 0;
        if (k_c === 0 || k_c === n_c) return 1;
        if (k_c > n_c / 2) k_c = n_c - k_c;
        let res = 1;
        for (let i = 1; i <= k_c; i++) {
            res = res * (n_c - i + 1) / i;
        }
        return Math.round(res);
    };
    let total = 0;
    for (let k = minSize; k <= maxSize; k++) {
        total += combinations(n, k);
    }
    return total;
};