import { state } from './state.js';
import { dom } from './dom.js';
import { displayError, toggleLoading, parseCsv } from './utils.js';
import { displayResults, updateAnalysisModeSelector, renderPortfolioComparisonCharts, renderFeaturedPortfolio } from './ui.js';

/**
 * Inicia el proceso de análisis principal. Carga los archivos y lanza el primer análisis.
 */
export const runAnalysis = async () => {
    displayError(''); // Ocultar errores previos
    // destroyAllCharts(); // Se gestiona dentro de displayResults

    if (state.loadedStrategyFiles.length === 0 || !dom.benchmarkFileInput.files[0]) {
        displayError('Por favor, selecciona al menos un archivo de estrategia y un archivo de benchmark.');
        return;
    }

    toggleLoading(true, 'analyzeBtn', 'analyzeBtnText', 'analyzeBtnSpinner');
    dom.resultsDiv.classList.add('hidden');

    try {
        state.rawBenchmarkData = await parseCsv(dom.benchmarkFileInput.files[0]);
        if (!state.rawBenchmarkData[0].hasOwnProperty('date') || !state.rawBenchmarkData[0].hasOwnProperty('price')) {
            throw new Error(`El archivo de benchmark debe tener columnas de fecha y precio. Detectadas: [${Object.keys(state.rawBenchmarkData[0]).join(', ')}]`);
        }
        const strategiesPromises = state.loadedStrategyFiles.map(file => parseCsv(file));
        state.rawStrategiesData = await Promise.all(strategiesPromises);

        reAnalyzeAllData(); // Análisis inicial
    } catch (error) {
        console.error("Error en el proceso de análisis:", error);
        displayError(error.message);
    } finally {
        toggleLoading(false, 'analyzeBtn', 'analyzeBtnText', 'analyzeBtnSpinner');
    }
};

/**
 * Calcula el factor de escala de riesgo basado en el input del usuario.
 * @returns {number} El factor de escala (ej: 1.5 para 150$).
 */
const getRiskScaleFactor = () => {
    if (!dom.riskPerTradeInput) return 1.0;
    const riskPerTrade = parseFloat(dom.riskPerTradeInput.value);
    return (riskPerTrade > 0) ? riskPerTrade / 100.0 : 1.0;
};
/**
 * Vuelve a calcular y mostrar todos los resultados basándose en el estado actual (filtros, selecciones, etc.).
 */
export const reAnalyzeAllData = () => {
    state.selectedPortfolioIndices.clear();
    document.querySelectorAll('.portfolio-checkbox:checked').forEach(cb => {
        state.selectedPortfolioIndices.add(parseInt(cb.dataset.index));
    });

    updateAnalysisModeSelector();

    const filterMode = dom.analysisModeSelect.value;
    let filterSourceTrades = null;

    if (filterMode === 'portfolio') {
        if (state.selectedPortfolioIndices.size > 0) {
            const portfolioTrades = [];
            state.selectedPortfolioIndices.forEach(index => portfolioTrades.push(...state.rawStrategiesData[index]));
            filterSourceTrades = portfolioTrades;
        }
    } else if (filterMode !== '-1') {
        const filterIndex = parseInt(filterMode);
        filterSourceTrades = state.rawStrategiesData[filterIndex];
    }

    const isRiskNormalized = dom.normalizeRiskCheckbox.checked;
    const targetMaxDD = isRiskNormalized ? parseFloat(document.getElementById('target-max-dd').value) : 0;

    const riskScaleFactor = getRiskScaleFactor();

    let allAnalysisResults = state.rawStrategiesData.map((strategyData, i) => ({
        name: state.loadedStrategyFiles[i].name.replace('.csv', ''),
        analysis: (() => {
            // 1. Aplicar el ajuste de riesgo por operación global.
            let tradesForAnalysis = strategyData.map(trade => ({ ...trade, pnl: trade.pnl * riskScaleFactor }));

            // 2. Si está activa, aplicar la normalización de riesgo global.
            if (isRiskNormalized && targetMaxDD > 0) {
                const preAnalysis = processStrategyData(tradesForAnalysis, state.rawBenchmarkData, filterSourceTrades);
                if (preAnalysis && preAnalysis.metrics.maxDrawdownInDollars > 0) {
                    const scaleFactor = targetMaxDD / preAnalysis.metrics.maxDrawdownInDollars;
                    tradesForAnalysis = tradesForAnalysis.map(trade => ({ ...trade, pnl: trade.pnl * scaleFactor }));
                }
            }
            return processStrategyData(tradesForAnalysis, state.rawBenchmarkData, filterSourceTrades);
        })(),
        originalIndex: i,
        isSavedPortfolio: false,
        isCurrentPortfolio: false,
    }));

    state.savedPortfolios.forEach((p, i) => {
        const weights = p.weights || Array(p.indices.length).fill(1 / p.indices.length);
        let tradesForAnalysis = [];
        const riskConfig = p.riskConfig || {};

        const strategyTradeData = p.indices.map(index => state.rawStrategiesData[index]);

        // 1. Construir portafolio con pesos y ajuste de riesgo global.
        if (weights) {
            strategyTradeData.forEach((trades, strategyIndex) => {
                const weight = weights[strategyIndex];
                trades.forEach(trade => tradesForAnalysis.push({ ...trade, pnl: (trade.pnl * riskScaleFactor * weight) }));
            });
        }

        let finalTradesForAnalysis = tradesForAnalysis;

        // 2. Aplicar escalado de riesgo (la normalización global tiene prioridad).
        if (isRiskNormalized && targetMaxDD > 0) {
            // Aplicar normalización de riesgo GLOBAL
            const preAnalysis = processStrategyData(tradesForAnalysis, state.rawBenchmarkData, filterSourceTrades);
            if (preAnalysis && preAnalysis.metrics.maxDrawdownInDollars > 0) {
                const scaleFactor = targetMaxDD / preAnalysis.metrics.maxDrawdownInDollars;
                finalTradesForAnalysis = tradesForAnalysis.map(trade => ({ ...trade, pnl: trade.pnl * scaleFactor }));
            }
        } else if (riskConfig.isScaled && riskConfig.targetMaxDD > 0) {
            // Aplicar escalado de riesgo ESPECÍFICO del portafolio
            const baseTradesForPreAnalysis = [];
            strategyTradeData.forEach((trades, strategyIndex) => {
                const weight = weights[strategyIndex];
                trades.forEach(trade => baseTradesForPreAnalysis.push({ ...trade, pnl: (trade.pnl * weight) }));
            });
            
            const preAnalysis = processStrategyData(baseTradesForPreAnalysis, state.rawBenchmarkData, filterSourceTrades);
            if (preAnalysis && preAnalysis.metrics.maxDrawdownInDollars > 0) {
                const scaleFactor = riskConfig.targetMaxDD / preAnalysis.metrics.maxDrawdownInDollars;
                // Aplicamos el factor de escala a los trades que ya tienen el ajuste de riesgo global.
                finalTradesForAnalysis = tradesForAnalysis.map(trade => ({ ...trade, pnl: trade.pnl * scaleFactor }));
            }
        }

        const analysis = processStrategyData(finalTradesForAnalysis, state.rawBenchmarkData, filterSourceTrades);

        if (analysis) {
            allAnalysisResults.push({
                name: p.name,
                analysis: analysis,
                isSavedPortfolio: true,
                isCurrentPortfolio: false,
                savedIndex: i,
                indices: p.indices,
                weights: p.weights,
                riskConfig: p.riskConfig
            });
        }
    });

    if (state.selectedPortfolioIndices.size > 0) {
        const portfolioTrades = [];
        const equalWeight = 1 / state.selectedPortfolioIndices.size;
        // 1. Construir portafolio con pesos y ajuste de riesgo global.
        state.selectedPortfolioIndices.forEach(index => {
            state.rawStrategiesData[index].forEach(trade => {
                portfolioTrades.push({ ...trade, pnl: (trade.pnl * riskScaleFactor) * equalWeight });
            });
        });

        // 2. Si está activa, aplicar la normalización de riesgo global.
        let finalTradesForAnalysis = portfolioTrades;
        if (isRiskNormalized && targetMaxDD > 0) {
            const preAnalysis = processStrategyData(portfolioTrades, state.rawBenchmarkData, filterSourceTrades);
            if (preAnalysis && preAnalysis.metrics.maxDrawdownInDollars > 0) {
                const scaleFactor = targetMaxDD / preAnalysis.metrics.maxDrawdownInDollars;
                finalTradesForAnalysis = portfolioTrades.map(trade => ({ ...trade, pnl: trade.pnl * scaleFactor }));
            }
        }
        const portfolioAnalysis = processStrategyData(finalTradesForAnalysis, state.rawBenchmarkData, filterSourceTrades);
        if (portfolioAnalysis) {
            allAnalysisResults.push({ name: 'Portafolio Actual', isPortfolio: true, isCurrentPortfolio: true, analysis: portfolioAnalysis });
        }
    }

    if (state.comparisonPortfolioIndex !== null && state.savedPortfolios[state.comparisonPortfolioIndex]) {
        const portfolioToCompare = state.savedPortfolios[state.comparisonPortfolioIndex];
        // 1. Construir portafolio "Original" (equal weight) con ajuste de riesgo global.
        let originalTrades = portfolioToCompare.indices.flatMap(index => 
            state.rawStrategiesData[index].map(trade => ({ ...trade, pnl: (trade.pnl * riskScaleFactor) * (1 / portfolioToCompare.indices.length) }))
        );

        let finalTradesForAnalysis = originalTrades;
        // 2. Si está activa, aplicar la normalización de riesgo global.
        if (isRiskNormalized && targetMaxDD > 0) {
            const preAnalysis = processStrategyData(originalTrades, state.rawBenchmarkData, filterSourceTrades);
            if (preAnalysis && preAnalysis.metrics.maxDrawdownInDollars > 0) {
                const scaleFactor = targetMaxDD / preAnalysis.metrics.maxDrawdownInDollars;
                finalTradesForAnalysis = originalTrades.map(trade => ({ ...trade, pnl: trade.pnl * scaleFactor }));
            }
        }

        const originalAnalysis = processStrategyData(finalTradesForAnalysis, state.rawBenchmarkData, filterSourceTrades);

        if (originalAnalysis) {
            allAnalysisResults.push({
                name: `${portfolioToCompare.name} (Original)`,
                analysis: originalAnalysis,
                isSavedPortfolio: true,
                isTemporaryOriginal: true,
                savedIndex: 999 + state.comparisonPortfolioIndex // unique index for color
            });
        }
    }

    displayResults(allAnalysisResults);
};

/**
 * Procesa un conjunto de trades y datos de benchmark para calcular todas las métricas y curvas.
 * @param {Array} tradesToAnalyze - Array de objetos de trade.
 * @param {Array} benchmark - Array de datos del benchmark.
 * @param {Array|null} filterSourceTrades - Trades para filtrar el tiempo de análisis.
 * @returns {Object|null} Objeto con los resultados del análisis o null si no es posible.
 * @note Esta función ya no se preocupa por el `size`. Recibe los trades con el PnL ya ajustado.
 */
export const processStrategyData = (tradesToAnalyze, benchmark, filterSourceTrades = null) => {
    if (!tradesToAnalyze || tradesToAnalyze.length === 0) return null;

    

    let benchmarkToUse = benchmark;
    if (filterSourceTrades) {
        const inTradeDates = new Set();
        filterSourceTrades.forEach(trade => {
            let currentDate = new Date(trade.entry_date);
            const endDate = new Date(trade.exit_date);
            if (isNaN(currentDate.getTime()) || isNaN(endDate.getTime())) return;
            while (currentDate <= endDate) {
                inTradeDates.add(currentDate.toISOString().split('T')[0]);
                currentDate.setDate(currentDate.getDate() + 1);
            }
        });
        benchmarkToUse = benchmark.filter(row => inTradeDates.has(new Date(row.date).toISOString().split('T')[0]));
        if (benchmarkToUse.length < 2) return null;
    }

    const benchmarkPrices = new Map();
    benchmarkToUse.forEach(row => {
        const date = new Date(row.date);
        const price = parseFloat(row.price);
        if (!isNaN(date.getTime()) && !isNaN(price)) benchmarkPrices.set(date.toISOString().split('T')[0], price);
    });
    if (benchmarkPrices.size === 0) return null;
    const sortedDates = [...benchmarkPrices.keys()].sort();

    const dailyPnl = new Map();
    tradesToAnalyze.forEach(trade => {
        const pnl = parseFloat(trade.pnl);
        const exitDate = new Date(trade.exit_date);

        if (!isNaN(pnl) && !isNaN(exitDate.getTime())) {
            const dateStr = exitDate.toISOString().split('T')[0];
            dailyPnl.set(dateStr, (dailyPnl.get(dateStr) || 0) + pnl);
        }
    });

    let currentEquity = 10000;
    const equityCurveData = [];
    sortedDates.forEach(date => {
        if (dailyPnl.has(date)) currentEquity += dailyPnl.get(date);
        equityCurveData.push({ x: date, y: currentEquity });
    });

    const labels = equityCurveData.map(p => p.x);
    const portfolioValues = equityCurveData.map(p => p.y);
    const benchmarkData = labels.map(date => ({ x: date, y: benchmarkPrices.get(date) }));

    let upi = 0, maxDrawdown = 0, monthlyAvgProfit = 0, profitMaxDD_Ratio = 0, maxDrawdownInDollars = 0, monthlyProfitToDollarDD = 0;

    if (portfolioValues.length > 1) {
        const startDate = new Date(labels[0]);
        const endDate = new Date(labels[labels.length - 1]);
        const diffInMillis = endDate.getTime() - startDate.getTime();
        const durationInDays = diffInMillis > 0 ? diffInMillis / (1000 * 60 * 60 * 24) : 0;
        const durationInYears = durationInDays / 365.25;
        const durationInMonths = diffInMillis > 0 ? diffInMillis / (1000 * 60 * 60 * 24 * 30.44) : 0;

        const initialEquity = portfolioValues[0] || 1;
        const finalEquity = portfolioValues[portfolioValues.length - 1] || 1;
        const totalProfit = finalEquity - initialEquity;
        monthlyAvgProfit = durationInMonths > 0 ? totalProfit / durationInMonths : 0;

        let cagrPct = 0;
        if (initialEquity > 0 && finalEquity > 0 && durationInYears > 0) {
            cagrPct = (Math.pow(finalEquity / initialEquity, 1.0 / durationInYears) - 1) * 100.0;
        }

        let peakEquity = initialEquity;
        let squaredDrawdownSum = 0;
        for (const currentPoint of portfolioValues) {
            peakEquity = Math.max(peakEquity, currentPoint);
            const drawdown = (peakEquity - currentPoint) / peakEquity;
            maxDrawdown = Math.max(maxDrawdown, drawdown);
            maxDrawdownInDollars = Math.max(maxDrawdownInDollars, peakEquity - currentPoint);
            squaredDrawdownSum += Math.pow(((currentPoint / peakEquity) - 1) * 100.0, 2);
        }
        maxDrawdown *= 100;

        const ulcerIndex = portfolioValues.length > 0 ? Math.sqrt(squaredDrawdownSum / portfolioValues.length) : 0;
        upi = ulcerIndex > 0 ? cagrPct / ulcerIndex : (cagrPct > 0 ? Infinity : 0);
        const realTotalProfit = Array.from(dailyPnl.values()).reduce((sum, pnl) => sum + pnl, 0);

        if (maxDrawdownInDollars > 0) {
            monthlyProfitToDollarDD = (monthlyAvgProfit / maxDrawdownInDollars) * 100;
            profitMaxDD_Ratio = totalProfit / maxDrawdownInDollars;
        } else if (totalProfit > 0) {
            monthlyProfitToDollarDD = Infinity;
            profitMaxDD_Ratio = Infinity;
        }
    }

    const portfolioReturns = [], benchmarkReturns = [];
    let lastPortfolioValue = portfolioValues.length > 0 ? portfolioValues[0] : 0;
    let lastBenchmarkValue = benchmarkData.length > 0 ? benchmarkData[0].y : 0;
    for (let i = 1; i < labels.length; i++) {
        const pReturn = (lastPortfolioValue > 0) ? (portfolioValues[i] / lastPortfolioValue) - 1 : 0;
        const bReturn = (lastBenchmarkValue > 0 && benchmarkData[i]?.y != null) ? (benchmarkData[i].y / lastBenchmarkValue) - 1 : 0;
        portfolioReturns.push(pReturn);
        benchmarkReturns.push(bReturn);
        lastPortfolioValue = portfolioValues[i];
        if (benchmarkData[i]?.y != null) lastBenchmarkValue = benchmarkData[i].y;
    }

    const rollingSortinoData = [];
    const windowSize = 252;
    if (portfolioReturns.length >= windowSize) {
        for (let i = windowSize; i < portfolioReturns.length; i++) {
            const window = portfolioReturns.slice(i - windowSize, i);
            const sortino = calculateSortino(window);
            rollingSortinoData.push({ x: labels[i], y: isFinite(sortino) ? sortino : null });
        }
    }

    const positiveBenchDays = { portfolio: [], benchmark: [] };
    const negativeBenchDays = { portfolio: [], benchmark: [] };
    benchmarkReturns.forEach((bReturn, i) => {
        if (bReturn > 0) { positiveBenchDays.portfolio.push(portfolioReturns[i]); positiveBenchDays.benchmark.push(bReturn); }
        else if (bReturn < 0) { negativeBenchDays.portfolio.push(portfolioReturns[i]); negativeBenchDays.benchmark.push(bReturn); }
    });

    const arithmeticMean = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const geoMean = arr => arr.length === 0 ? 0 : Math.pow(arr.reduce((acc, val) => acc * (1 + val), 1), 1 / arr.length) - 1;
    const sortinoRatio = calculateSortino(portfolioReturns);
    const upsideCapture = (geoMean(positiveBenchDays.benchmark) !== 0) ? (geoMean(positiveBenchDays.portfolio) / geoMean(positiveBenchDays.benchmark)) * 100 : 0;
    const downsideCapture = (geoMean(negativeBenchDays.benchmark) !== 0) ? (geoMean(negativeBenchDays.portfolio) / geoMean(negativeBenchDays.benchmark)) * 100 : 0;
    const avgPortfolioReturnOnDownDays = arithmeticMean(negativeBenchDays.portfolio);
    const avgPortfolioReturnOnUpDays = arithmeticMean(positiveBenchDays.portfolio);
    const captureRatio = downsideCapture > 0 ? upsideCapture / downsideCapture : Infinity;

    let maxStagnationTrades = 0, maxConsecutiveLosses = 0, currentConsecutiveLosses = 0, maxConsecutiveWins = 0, currentConsecutiveWins = 0;
    if (tradesToAnalyze.length > 0) {
        const sortedTrades = [...tradesToAnalyze].sort((a, b) => new Date(a.exit_date) - new Date(b.exit_date));
        let tradeEquity = 10000, peakTradeEquity = 10000, currentStagnation = 0;
        for (const trade of sortedTrades) {
            tradeEquity += trade.pnl;
            if (tradeEquity > peakTradeEquity) {
                peakTradeEquity = tradeEquity;
                currentStagnation = 0;
            } else {
                currentStagnation++;
            }
            maxStagnationTrades = Math.max(maxStagnationTrades, currentStagnation);

            if (trade.pnl < 0) { currentConsecutiveLosses++; currentConsecutiveWins = 0; }
            else if (trade.pnl > 0) { currentConsecutiveWins++; currentConsecutiveLosses = 0; }
            maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentConsecutiveLosses);
            maxConsecutiveWins = Math.max(maxConsecutiveWins, currentConsecutiveWins);
        }
    }

    const meanPortfolioReturn = arithmeticMean(portfolioReturns);
    const stdDev = Math.sqrt(portfolioReturns.map(x => Math.pow(x - meanPortfolioReturn, 2)).reduce((a, b) => a + b, 0) / portfolioReturns.length);
    const sharpeRatio = stdDev > 0 ? (meanPortfolioReturn / stdDev) * Math.sqrt(252) : Infinity;

    let grossProfit = 0, grossLoss = 0;
    const winningTrades = tradesToAnalyze.filter(t => t.pnl > 0);
    const losingTrades = tradesToAnalyze.filter(t => t.pnl < 0);
    winningTrades.forEach(t => grossProfit += t.pnl);
    losingTrades.forEach(t => grossLoss += t.pnl);
    const profitFactor = grossLoss !== 0 ? Math.abs(grossProfit / grossLoss) : Infinity;
    const totalTradesWithOutcome = winningTrades.length + losingTrades.length;
    const winningPercentage = totalTradesWithOutcome > 0 ? (winningTrades.length / totalTradesWithOutcome) * 100 : 0;
    const avgWin = winningTrades.length > 0 ? grossProfit / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? Math.abs(grossLoss / losingTrades.length) : 0;

    const monthlyPerformance = {};
    tradesToAnalyze.forEach(trade => {
        const pnl = parseFloat(trade.pnl);
        const exitDate = new Date(trade.exit_date);
        if (!isNaN(pnl) && !isNaN(exitDate.getTime())) {
            const year = exitDate.getFullYear();
            const month = exitDate.getMonth();
            if (!monthlyPerformance[year]) monthlyPerformance[year] = Array(12).fill(0);
            monthlyPerformance[year][month] += pnl;
        }
    });

    let maxConsecutiveLosingMonths = 0;
    const monthlyYears = Object.keys(monthlyPerformance).sort((a, b) => a - b);
    if (monthlyYears.length > 0) {
        let currentStreak = 0;
        for (const year of monthlyYears) {
            for (const pnl of monthlyPerformance[year]) {
                if (pnl < 0) currentStreak++;
                else { maxConsecutiveLosingMonths = Math.max(maxConsecutiveLosingMonths, currentStreak); currentStreak = 0; }
            }
        }
        maxConsecutiveLosingMonths = Math.max(maxConsecutiveLosingMonths, currentStreak);
    }

    let maxStagnationDays = 0;
    if (portfolioValues.length > 0) {
        let peakEquity = portfolioValues[0], peakDate = new Date(labels[0]);
        for (let i = 0; i < portfolioValues.length; i++) {
            if (portfolioValues[i] >= peakEquity) {
                peakEquity = portfolioValues[i];
                peakDate = new Date(labels[i]);
            } else {
                maxStagnationDays = Math.max(maxStagnationDays, Math.ceil((new Date(labels[i]) - peakDate) / (1000 * 60 * 60 * 24)));
            }
        }
    }

    const tradePnls = tradesToAnalyze.map(t => t.pnl);
    let sqn = 0;
    if (tradePnls.length > 0) {
        const avgPnl = tradePnls.reduce((a, b) => a + b, 0) / tradePnls.length;
        const stdDevPnl = Math.sqrt(tradePnls.map(x => Math.pow(x - avgPnl, 2)).reduce((a, b) => a + b, 0) / tradePnls.length);
        if (stdDevPnl > 0) sqn = (Math.sqrt(tradePnls.length) * avgPnl) / stdDevPnl;
    }

    const positivePnlTrades = tradesToAnalyze.filter(t => t.pnl > 0).sort((a, b) => a.pnl - b.pnl);
    const totalProfit = positivePnlTrades.reduce((sum, t) => sum + t.pnl, 0);
    let cumulativeProfit = 0;
    const lorenzData = [{ x: 0, y: 0 }];
    if (totalProfit > 0) {
        positivePnlTrades.forEach((trade, index) => {
            cumulativeProfit += trade.pnl;
            lorenzData.push({ x: (index + 1) / positivePnlTrades.length * 100, y: (cumulativeProfit / totalProfit) * 100 });
        });
    }

    return {
        labels, portfolioValues, benchmarkData,
        returnsData: portfolioReturns.map((p, i) => ({ x: benchmarkReturns[i] * 100, y: p * 100 })),
        metrics: { upsideCapture, downsideCapture, sortinoRatio, avgPortfolioReturnOnDownDays, avgPortfolioReturnOnUpDays, upi, captureRatio, maxStagnationTrades, maxConsecutiveLosses, maxConsecutiveWins, maxDrawdown, maxDrawdownInDollars, monthlyAvgProfit, profitMaxDD_Ratio, sharpeRatio, profitFactor, winningPercentage, avgWin, avgLoss, monthlyProfitToDollarDD, maxConsecutiveLosingMonths, totalTrades: tradesToAnalyze.length, maxStagnationDays, sqn },
        lorenzData, dailyReturnsMap: new Map(Array.from(dailyPnl.entries()).map(([date, pnl]) => [date, pnl])), rollingSortinoData, monthlyPerformance
    };
};

export const calculateSortino = (returns, annualizationFactor = 252) => {
    if (returns.length < 2) return 0;
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const negativeReturns = returns.filter(r => r < 0);
    if (negativeReturns.length === 0) return Infinity;

    const downsideDeviation = Math.sqrt(negativeReturns.reduce((acc, r) => acc + Math.pow(r, 2), 0) / returns.length);

    return downsideDeviation > 0 ? (meanReturn * Math.sqrt(annualizationFactor)) / downsideDeviation : Infinity;
};

export const calculateCorrelationMatrix = (strategies) => {
    const allDates = new Set();
    strategies.forEach(s => s.analysis.dailyReturnsMap.forEach((_, date) => allDates.add(date)));
    const sortedDates = Array.from(allDates).sort();

    const returnVectors = strategies.map(s => {
        return sortedDates.map(date => s.analysis.dailyReturnsMap.get(date) || 0);
    });

    const matrix = Array(strategies.length).fill(0).map(() => Array(strategies.length).fill(0));

    for (let i = 0; i < strategies.length; i++) {
        for (let j = i; j < strategies.length; j++) {
            const corr = pearsonCorrelation(returnVectors[i], returnVectors[j]);
            matrix[i][j] = corr;
            matrix[j][i] = corr;
        }
    }
    return matrix;
};

export const pearsonCorrelation = (x, y) => {
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    const n = x.length;
    for (let i = 0; i < n; i++) {
        sumX += x[i];
        sumY += y[i];
        sumXY += x[i] * y[i];
        sumX2 += x[i] * x[i];
        sumY2 += y[i] * y[i];
    }
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    if (denominator === 0) return 0;
    return numerator / denominator;
};