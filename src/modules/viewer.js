import { dom } from '../dom.js';
import { state } from '../state.js';
import { destroyChart } from '../utils.js';
import { CHART_OPTIONS, STRATEGY_COLORS, ALL_METRICS } from '../config.js';

/**
 * Renderiza el gráfico del viewer principal según el tab activo.
 */
export const renderViewerForActiveTab = () => {
    const activeTab = document.querySelector('.tab-btn.active');
    if (!activeTab) return;

    const targetId = activeTab.dataset.target;
    console.log('[Viewer] Renderizando para tab:', targetId);

    if (targetId === 'databank-content') {
        renderDatabankViewer();
    } else if (targetId === 'saved-portfolios-content') {
        renderSavedPortfoliosViewer();
    } else if (targetId === 'strategies-content') {
        renderStrategiesViewer();
    } else if (targetId === 'optimization-content') {
        renderOptimizationViewer();
    }
};

/**
 * Renderiza los top 2 portafolios del DataBank en el viewer.
 */
const renderDatabankViewer = () => {
    const canvasId = 'portfolioEquityChart';
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;

    // Obtener top 2 portafolios del DataBank
    const topPortfolios = state.databankPortfolios.slice(0, 2);

    if (topPortfolios.length === 0) {
        console.log('[Viewer] No hay portafolios en el DataBank');
        return;
    }

    const datasets = [];

    // No benchmark needed

    // Agregar cada portafolio del DataBank
    topPortfolios.forEach((portfolio, index) => {
        // Buscar el análisis correspondiente
        const portfolioAnalysis = window.analysisResults?.find(r =>
            r.indices && portfolio.indices &&
            r.indices.length === portfolio.indices.length &&
            r.indices.every((idx, i) => idx === portfolio.indices[i])
        );

        if (portfolioAnalysis?.analysis?.chartData?.equityCurve) {
            const color = index === 0 ? '#10b981' : '#3b82f6'; // Verde para #1, Azul para #2
            datasets.push({
                label: `#${index + 1}: ${portfolio.name || 'DataBank Portfolio'}`,
                data: portfolioAnalysis.analysis.chartData.equityCurve,
                borderColor: color,
                backgroundColor: `${color}1a`,
                borderWidth: 3,
                pointRadius: 0,
                tension: 0.1,
                fill: false
            });
        }
    });

    if (datasets.length === 0) {
        console.log('[Viewer] No hay datos de gráficos para mostrar');
        return;
    }

    state.chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            ...CHART_OPTIONS,
            plugins: {
                ...CHART_OPTIONS.plugins,
                title: {
                    display: true,
                    text: 'Top Portafolios del DataBank',
                    color: '#e5e7eb',
                    font: { size: 16, weight: 'bold' }
                }
            }
        }
    });
};

/**
 * Renderiza los portafolios guardados en el viewer.
 */
const renderSavedPortfoliosViewer = () => {
    console.log('[Viewer] renderSavedPortfoliosViewer called - DISABLED for clean slate');
    return; // PERFORMANCE OVERHAUL: Disabled auto-rendering

    const canvasId = 'portfolioEquityChart';
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;

    const savedPortfolioAnalyses = window.analysisResults?.filter(r => r.isSavedPortfolio && !r.isTemporaryOriginal) || [];

    if (savedPortfolioAnalyses.length === 0) {
        console.log('[Viewer] No hay portafolios guardados');
        return;
    }

    const datasets = [];

    // No benchmark needed

    // Agregar cada portafolio guardado
    savedPortfolioAnalyses.forEach((result, index) => {
        if (result.analysis?.chartData?.equityCurve) {
            const color = STRATEGY_COLORS[index % STRATEGY_COLORS.length];
            datasets.push({
                label: result.name,
                data: result.analysis.chartData.equityCurve,
                borderColor: color,
                backgroundColor: `${color}1a`,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.1,
                fill: false
            });
        }
    });

    state.chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            ...CHART_OPTIONS,
            plugins: {
                ...CHART_OPTIONS.plugins,
                title: {
                    display: true,
                    text: 'Portafolios Guardados',
                    color: '#e5e7eb',
                    font: { size: 16, weight: 'bold' }
                }
            }
        }
    });
};

/**
 * Renderiza todas las estrategias individuales en el viewer.
 */
const renderStrategiesViewer = () => {
    console.log('[Viewer] renderStrategiesViewer called - DISABLED for clean slate');
    return; // PERFORMANCE OVERHAUL: Disabled auto-rendering

    const canvasId = 'portfolioEquityChart';
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;

    const strategies = window.analysisResults?.filter(r => !r.isPortfolio && !r.isSavedPortfolio) || [];

    if (strategies.length === 0) {
        console.log('[Viewer] No hay estrategias individuales');
        return;
    }

    const datasets = [];

    // No benchmark needed

    // Agregar cada estrategia
    strategies.forEach((result, index) => {
        if (result.analysis?.chartData?.equityCurve) {
            const color = STRATEGY_COLORS[index % STRATEGY_COLORS.length];
            datasets.push({
                label: result.name,
                data: result.analysis.chartData.equityCurve,
                borderColor: color,
                backgroundColor: `${color}1a`,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.1,
                fill: false
            });
        }
    });

    state.chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            ...CHART_OPTIONS,
            plugins: {
                ...CHART_OPTIONS.plugins,
                title: {
                    display: true,
                    text: 'Estrategias Individuales',
                    color: '#e5e7eb',
                    font: { size: 16, weight: 'bold' }
                }
            }
        }
    });
};

/**
 * Renderiza la comparación de optimización en el viewer (3 curvas).
 */
const renderOptimizationViewer = () => {
    console.log('[Viewer] Renderizando optimization viewer...');
    const canvasId = 'portfolioEquityChart';
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) {
        console.error('[Viewer] Canvas not found');
        return;
    }

    // Get optimization results from state
    const optimizationResults = state.currentOptimizationData?.lastResults;

    if (!optimizationResults) {
        console.log('[Viewer] No optimization results available yet');
        // Show placeholder message
        ctx.font = '16px sans-serif';
        ctx.fillStyle = '#9ca3af';
        ctx.textAlign = 'center';
        ctx.fillText('Run an optimization to see portfolio comparison', ctx.canvas.width / 2, ctx.canvas.height / 2);
        return;
    }

    const { baseAnalysis, metricBestAnalysis, balancedBestAnalysis, targetMetric } = optimizationResults;

    console.log('[Viewer] Optimization results found:', {
        hasBase: !!baseAnalysis,
        hasMetric: !!metricBestAnalysis,
        hasBalanced: !!balancedBestAnalysis,
        targetMetric
    });

    const datasets = [];

    // No benchmark needed

    // Add Original portfolio (Gray)
    if (baseAnalysis?.metrics?.chartData?.equityCurve) {
        datasets.push({
            label: '📊 Original',
            data: baseAnalysis.metrics.chartData.equityCurve,
            borderColor: '#9ca3af', // Gray
            backgroundColor: '#9ca3af1a',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.1,
            fill: false
        });
    }

    // Add Optimized by Metric (Purple - destacado)
    if (metricBestAnalysis?.metrics?.chartData?.equityCurve) {
        const metricLabel = targetMetric ? ALL_METRICS[targetMetric]?.label || targetMetric : 'Metric';
        datasets.push({
            label: `🎯 Optimized (${metricLabel})`,
            data: metricBestAnalysis.metrics.chartData.equityCurve,
            borderColor: '#a855f7', // Purple
            backgroundColor: '#a855f71a',
            borderWidth: 3, // Más grueso
            pointRadius: 0,
            tension: 0.1,
            fill: false
        });
    }

    // Add Balanced optimization (Blue)
    if (balancedBestAnalysis?.metrics?.chartData?.equityCurve) {
        datasets.push({
            label: '⚖️ Balanced',
            data: balancedBestAnalysis.metrics.chartData.equityCurve,
            borderColor: '#3b82f6', // Blue
            backgroundColor: '#3b82f61a',
            borderWidth: 3, // Más grueso
            pointRadius: 0,
            tension: 0.1,
            fill: false
        });
    }

    if (datasets.length === 0) {
        console.log('[Viewer] No equity curves to display');
        return;
    }

    console.log('[Viewer] Creating chart with', datasets.length, 'datasets');

    state.chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            ...CHART_OPTIONS,
            plugins: {
                ...CHART_OPTIONS.plugins,
                title: {
                    display: true,
                    text: 'Portfolio Optimization Comparison',
                    color: '#e5e7eb',
                    font: { size: 16, weight: 'bold' }
                },
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#e5e7eb',
                        font: { size: 12 },
                        usePointStyle: true,
                        padding: 15
                    }
                }
            }
        }
    });

    console.log('[Viewer] ✅ Optimization chart rendered');
};
