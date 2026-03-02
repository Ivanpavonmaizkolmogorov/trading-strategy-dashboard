import { formatDDDate } from './drawdownAnalysis.js?v=3';
import { TradeSeries } from '../models/TradeSeries.js';

let ddModal = null;

/**
 * Inicializa y abre el Modal de Análisis de Drawdown.
 * 
 * @param {Object} item - Objeto Portfolio o Strategy.
 * @param {boolean} isRealityCheckLinked - Verdadero si el item tiene métricas reales asociadas a MyFxBook.
 */
export function openDrawdownModal(item, isRealityCheckLinked = false) {
    console.log(`[Drawdown UI] Opening Drawdown Analysis for: ${item.name}. Linked? ${isRealityCheckLinked}`);

    if (!ddModal) {
        ddModal = createDrawdownModal();
        document.body.appendChild(ddModal);
    }

    renderDrawdownContent(item, isRealityCheckLinked);
    ddModal.classList.remove('hidden');
}

/**
 * Cierra el Modal.
 */
function closeDrawdownModal() {
    if (ddModal) {
        ddModal.classList.add('hidden');
    }
}

/**
 * Crea la estructura DOM del Modal una sola vez.
 */
function createDrawdownModal() {
    const existing = document.getElementById('dd-analysis-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'dd-analysis-modal';
    // Modo pantalla casi completa (pantalla grande como Darwinex)
    modal.className = 'fixed inset-0 bg-[#1e2029]/95 backdrop-blur-md flex items-center justify-center z-[100] hidden p-6';

    modal.innerHTML = `
        <div class="bg-gray-900 border border-gray-700 rounded-2xl w-[95vw] max-w-7xl h-[85vh] flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.5)]">
            <!-- Header -->
            <div class="flex justify-between items-center p-6 border-b border-gray-800 shrink-0">
                <div>
                    <h2 class="text-3xl font-bold text-white flex items-center gap-3">
                        <span class="text-red-500">📉</span> Análisis de Drawdown
                    </h2>
                    <p class="text-gray-400 mt-1" id="dd-modal-subtitle">Analizando periodos de mayores pérdidas y días de recuperación</p>
                </div>
                <button id="close-dd-modal" class="text-gray-500 hover:text-white transition-colors text-4xl leading-none">&times;</button>
            </div>
            
            <!-- Content Area (Scrollable if needed, but mostly flex) -->
            <div class="flex-1 overflow-y-auto p-6" id="dd-modal-content">
                <!-- Se inyecta dinámicamente: Columnas Backtest / Real -->
            </div>
        </div>
    `;

    modal.querySelector('#close-dd-modal').onclick = closeDrawdownModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeDrawdownModal();
    };

    return modal;
}

/**
 * Renderiza los contenedores y los datos (Gráficas + Tablas).
 */
function renderDrawdownContent(item, hasRealityData) {
    const container = ddModal.querySelector('#dd-modal-content');
    const subtitle = ddModal.querySelector('#dd-modal-subtitle');

    subtitle.innerHTML = `Analizando <strong>${item.name}</strong>`;

    container.innerHTML = ''; // Limpiar

    const hasTwoColumns = Boolean(hasRealityData && item.realMetrics && item.realMetrics.allTrades);

    // Contenedor principal Grid (1 o 2 columnas)
    const gridDiv = document.createElement('div');
    gridDiv.className = `grid gap-8 h-full ${hasTwoColumns ? 'grid-cols-2' : 'grid-cols-1 max-w-4xl mx-auto'}`;
    container.appendChild(gridDiv);

    // ============================================
    // COLUMNA 1: BACKTEST
    // ============================================
    let backtestTrades = [];
    if (item.trades && Array.isArray(item.trades)) {
        backtestTrades = item.trades; // Si es una estrategia simple (SQ Result)
    } else if (item.aggregatedTrades) {
        backtestTrades = item.aggregatedTrades; // Si es un Portfolio
    } else if (item.realMetrics && item.realMetrics.allTrades && !item.originalTrades) {
        // Fallback weird
    }

    const btSeries = new TradeSeries(backtestTrades);
    const btData = btSeries.getDrawdownBreakdown(7);
    const colBacktest = createDrawdownColumn('Simulación Virtual (Backtest)', btData, 'text-blue-400', 'bg-blue-900/10');
    gridDiv.appendChild(colBacktest);

    // ============================================
    // COLUMNA 2: REALITY CHECK (Mundo Real)
    // ============================================
    if (hasTwoColumns) {
        // En Myfxbook la API trae todo crudo a veces, debemos asegurar que la estructura es parseable.
        // myfxbookUI.js guarda el listado combinado y normalizado en item.realMetrics.allTrades pero las fechas están en closeTime / openTime
        const realTrades = item.realMetrics.allTrades || [];
        // Mapear para asegurar pnl numérico si está en raw "profit + swap + commission"
        const cleanRealTrades = realTrades.map(t => {
            const p = parseFloat(t.profit) || 0;
            const c = parseFloat(t.commission) || 0;
            const s = parseFloat(t.swap) || 0;
            return {
                ...t,
                pnl: p + c + s,
                exitTime: t.closeTime || t.openTime
            };
        }).filter(t => !isNaN(t.pnl) && t.exitTime);

        const realSeries = new TradeSeries(cleanRealTrades);
        const realData = realSeries.getDrawdownBreakdown(7);
        const colReal = createDrawdownColumn('Mundo Real (Reality Check)', realData, 'text-emerald-400', 'bg-emerald-900/10');
        gridDiv.appendChild(colReal);
    }

    // Renderizar Gráficas (Requiere que estén adjuntas al DOM primero)
    // Usaremos un timeout pequeño para que Chart.js tome correctamente el ancho del canvas.
    setTimeout(() => {
        renderUnderwaterChart('canvas-bt', btData.underwaterCurve);
        if (hasTwoColumns) {
            renderUnderwaterChart('canvas-real', new TradeSeries(cleanRealTrades(item.realMetrics.allTrades)).getDrawdownBreakdown(7).underwaterCurve);
        }
    }, 50);
}

// Función auxiliar repetida que necesitamos mover arriba
function cleanRealTrades(rawTrades) {
    if (!rawTrades) return [];
    return rawTrades.map(t => {
        const p = parseFloat(t.profit) || 0;
        const c = parseFloat(t.commission) || 0;
        const s = parseFloat(t.swap) || 0;
        return {
            ...t,
            pnl: p + c + s,
            exitTime: t.closeTime || t.openTime
        };
    }).filter(t => !isNaN(t.pnl) && t.exitTime);
}

/**
 * Genera el HTML de una columna (Título, Gráfico, Tabla Darwinex).
 */
function createDrawdownColumn(title, ddData, titleColorClass, bgClass) {
    const col = document.createElement('div');
    col.className = `flex flex-col h-full rounded-xl border border-gray-800 p-6 ${bgClass}`;

    // TOP: Título y Stats "Under Water"
    const headerHtml = `
        <div class="flex justify-between items-start mb-6">
            <h3 class="text-xl font-bold uppercase tracking-wider ${titleColorClass}">${title}</h3>
            <div class="text-right flex space-x-4">
                <div class="bg-gray-800 rounded px-3 py-1 text-xs text-gray-400 border border-gray-700 cursor-help transition-colors hover:bg-gray-700" title="% del tiempo total que la curva ha estado por debajo de su último máximo histórico (buscando recuperarse).">
                    <div class="flex items-center space-x-1 justify-end">
                        <svg class="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        <span>Time Under Water</span>
                    </div>
                    <div class="text-lg font-bold text-white">${ddData.timeUnderWaterPercent.toFixed(1)}%</div>
                </div>
                ${ddData.currentStagnationDays > 0 ? `
                    <div class="bg-red-900/30 rounded px-3 py-1 text-xs text-red-300 border border-red-800 cursor-help transition-colors hover:bg-red-900/50" title="Días transcurridos desde el último máximo histórico (ATH) hasta la fecha. Representa la duración del Drawdown actual en el que está inmersa.">
                        <div class="flex items-center space-x-1 justify-end">
                            <svg class="w-3 h-3 text-red-400/80" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            <span>Stagnation Actual</span>
                        </div>
                        <div class="text-lg font-bold text-red-200">${ddData.currentStagnationDays} Días</div>
                    </div>
                ` : `
                    <div class="bg-emerald-900/30 rounded px-3 py-1 text-xs text-emerald-300 border border-emerald-800 cursor-help transition-colors hover:bg-emerald-900/50" title="La estrategia no se encuentra en Drawdown. Está actualmente en su máximo histórico de ganancias (ATH).">
                        <div class="flex items-center space-x-1 justify-end">
                            <svg class="w-3 h-3 text-emerald-400/80" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            <span>Stagnation Actual</span>
                        </div>
                        <div class="text-lg font-bold text-emerald-200">En Máximos (ATH)</div>
                    </div>
                `}
            </div>
        </div>
    `;

    // MIDDLE: Gráfica
    // Requerimos un wrapper relativo para Chart.js
    const idSufix = title.includes('Virtual') ? 'bt' : 'real';
    const chartHtml = `
        <div class="relative w-full h-48 mb-8 shrink-0">
            <canvas id="canvas-${idSufix}"></canvas>
        </div>
    `;

    // BOTTOM: Tabla (Top 7 DDs)
    let tableHtml = `
        <div class="flex-1 overflow-hidden flex flex-col">
            <table class="w-full text-sm text-left align-middle text-gray-300">
                <thead class="text-xs uppercase bg-gray-800/50 text-gray-400 sticky top-0 border-b border-gray-700">
                    <tr>
                        <th class="py-3 px-4 rounded-tl-lg font-medium">Rank</th>
                        <th class="py-3 px-4 font-medium text-right">Profundidad ($)</th>
                        <th class="py-3 px-4 font-medium text-right">Profundidad (%)</th>
                        <th class="py-3 px-4 font-medium text-center" title="Días hasta el Fondo / Días hasta Recuperación completa">Caída / Total (Días)</th>
                        <th class="py-3 px-4 font-medium text-center">Inicio</th>
                        <th class="py-3 px-4 font-medium text-center">Fondo</th>
                        <th class="py-3 px-4 rounded-tr-lg font-medium text-center">Recuperación</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-800">
    `;

    if (ddData.drawdowns.length === 0) {
        tableHtml += `
            <tr>
                <td colspan="7" class="py-8 text-center text-gray-500 italic">No hay Drawdowns registrados.</td>
            </tr>
        `;
    } else {
        ddData.drawdowns.forEach((dd, index) => {
            const isRank1 = index === 0;
            // Estilo por defecto (Rango 1 seleccionado al inicio)
            const rowClass = isRank1 ? 'bg-red-900/20 selected-dd-row' : 'hover:bg-gray-800/30';
            const ringClass = isRank1 ? 'border-red-500' : 'border-gray-600';
            const dotColor = dd.isRecovered ? 'bg-red-500' : 'bg-yellow-500 animate-pulse';

            // Obtener la fecha máxima del dataset para drawdowns "Abiertos"
            const lastDataPoint = ddData.underwaterCurve && ddData.underwaterCurve.length > 0 ? ddData.underwaterCurve[ddData.underwaterCurve.length - 1].date : new Date();

            // Format dates
            const startStr = formatDDDate(dd.startDate);
            const endStr = dd.isRecovered ? formatDDDate(dd.recoveryDate) : formatDDDate(new Date(lastDataPoint));

            tableHtml += `
                <tr id="dd-row-${idSufix}-${index}" 
                    class="transition-colors group cursor-pointer dd-row-${idSufix} ${rowClass}"
                    onclick="window.selectDrawdownPeriod('${idSufix}', '${startStr}', '${endStr}', ${index})"
                >
                    <td class="py-3 px-4">
                        <div class="flex items-center gap-3">
                            <div id="dd-ring-${idSufix}-${index}" class="w-4 h-4 rounded-full flex items-center justify-center border-2 dd-ring-${idSufix} ${ringClass} bg-gray-900 transition-colors">
                                <div class="w-2 h-2 rounded-full ${dotColor}"></div>
                            </div>
                            <span class="${isRank1 ? 'text-red-400 font-bold' : ''} dd-rank-text-${idSufix}">#${index + 1}</span>
                        </div>
                    </td>
                    <td class="py-3 px-4 text-right font-mono text-red-400 font-semibold">$${Math.abs(dd.depthMonetary).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td class="py-3 px-4 text-right font-mono text-red-300 opacity-70">${dd.depthPercent.toFixed(2)}%</td>
                    <td class="py-3 px-4 text-center font-bold text-white"><span class="text-red-400">${dd.daysToBottom || 0}</span> / <span class="text-gray-300">${dd.totalDays}</span></td>
                    <td class="py-3 px-4 text-center text-gray-400 font-mono text-xs">${startStr}</td>
                    <td class="py-3 px-4 text-center text-gray-400 font-mono text-xs">${formatDDDate(dd.bottomDate)}</td>
                    <td class="py-3 px-4 text-center">
                        ${dd.isRecovered
                    ? `<span class="text-gray-400 font-mono text-xs">${formatDDDate(dd.recoveryDate)}</span>`
                    : `<span class="bg-yellow-900/50 text-yellow-300 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wide">Abierto</span>`
                }
                    </td>
                </tr>
            `;
        });
    }

    tableHtml += `
                </tbody>
            </table>
        </div>
    `;

    // Script inyectado para gestionar la selección visual
    // Se ejecuta al vuelo cuando el modal se abre. Agregamos el primer periodo por defecto.
    const firstDD = ddData.drawdowns[0];
    if (firstDD) {
        // Obtener la fecha máxima del dataset para drawdowns "Abiertos"
        const lastDataPoint = ddData.underwaterCurve && ddData.underwaterCurve.length > 0 ? ddData.underwaterCurve[ddData.underwaterCurve.length - 1].date : new Date();

        const startStr = formatDDDate(firstDD.startDate);
        const endStr = firstDD.isRecovered ? formatDDDate(firstDD.recoveryDate) : formatDDDate(new Date(lastDataPoint));

        // Wait for next tick so Chart is rendered before updating
        setTimeout(() => {
            if (window.selectDrawdownPeriod) {
                window.selectDrawdownPeriod(idSufix, startStr, endStr, 0, true);
            }
        }, 50);
    }

    col.innerHTML = headerHtml + chartHtml + tableHtml;
    return col;
}


/**
 * Pinta la Gráfica de "Montañas rusas inversas" usando Chart.js
 */
function renderUnderwaterChart(canvasId, curveData) {
    if (!curveData || curveData.length === 0) return;

    const ctx = document.getElementById(canvasId).getContext('2d');

    // Preparar degradado rojo "Darwinex" (más oscuro abajo)
    const gradient = ctx.createLinearGradient(0, 0, 0, 150);
    gradient.addColorStop(0, 'rgba(239, 68, 68, 0.05)'); // Muy transparente en 0%
    gradient.addColorStop(1, 'rgba(239, 68, 68, 0.5)'); // Rojo sangre transparente abajo

    const dates = curveData.map(d => {
        try { return new Date(d.date).toISOString().split('T')[0]; }
        catch (e) { return ''; }
    });

    // Gráfica requiere dos series (aunque son idénticas en forma porque 10,000 fijo es lineal)
    const values = curveData.map(d => d.value);          // Porcentaje
    const monetaryValues = curveData.map(d => d.monetary); // Dinero ($)

    let chartStatus = Chart.getChart(canvasId);
    if (chartStatus != undefined) {
        chartStatus.destroy();
    }

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [
                {
                    label: 'Drawdown (%)',
                    data: values,
                    borderColor: '#ef4444', // Red-500
                    borderWidth: 1.5,
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.1,
                    pointRadius: 0,
                    pointHitRadius: 5,
                    yAxisID: 'y' // Eje derecho (%)
                },
                {
                    label: 'Drawdown ($)',
                    data: monetaryValues,
                    borderColor: 'transparent', // Ocultamos la línea secundaria porque se sobrepone exactamente a la primaria
                    borderWidth: 0,
                    backgroundColor: 'transparent',
                    fill: false,
                    pointRadius: 0,
                    pointHitRadius: 5,
                    yAxisID: 'y1' // Eje izquierdo ($)
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: { top: 10, bottom: 0, left: 10, right: 10 }
            },
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                legend: { display: false },
                annotation: {
                    annotations: {
                        drawdownHighlight: {
                            type: 'box',
                            xMin: dates[0], // Default values, will be overridden
                            xMax: dates[dates.length - 1],
                            backgroundColor: 'rgba(239, 68, 68, 0.15)', // Light red transparent
                            borderWidth: 0,
                            display: false, // Hidden until selected
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(17, 24, 39, 0.9)',
                    titleColor: '#9ca3af',
                    bodyColor: '#f87171',
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                if (context.datasetIndex === 0) {
                                    label += context.parsed.y.toFixed(2) + '%';
                                } else {
                                    label += '$' + context.parsed.y.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                }
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'month',
                        displayFormats: {
                            month: 'MMM yyyy'
                        }
                    },
                    display: true,
                    grid: { display: false, drawBorder: false },
                    ticks: { maxTicksLimit: 6, color: '#6b7280', font: { size: 10 } }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'right', // Porcentaje a la derecha
                    max: 0, // Máximo SIEMPRE es 0
                    grid: {
                        color: 'rgba(75, 85, 99, 0.2)',
                        zeroLineColor: '#6b7280',
                        drawBorder: false,
                        borderDash: [5, 5]
                    },
                    ticks: {
                        color: '#9ca3af',
                        font: { size: 10 },
                        callback: function (value) {
                            return value.toFixed(0) + '%';
                        }
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'left', // Dinero ($) a la izquierda
                    max: 0,
                    grid: {
                        drawOnChartArea: false, // No dibujar la cuadrícula para el segundo eje para no confundir
                    },
                    ticks: {
                        color: '#60a5fa', // Azul para distinguirlo
                        font: { size: 10 },
                        callback: function (value) {
                            return '$' + value.toLocaleString();
                        }
                    }
                }
            }
        }
    });
}

// Make accessible globally
window.openDrawdownModal = openDrawdownModal;

window.selectDrawdownPeriod = function (idSufix, startStr, endStr, index, isInitialLoad = false) {
    const canvasId = `canvas-${idSufix}`;

    // 1. Update Chart Annotation
    const chartInstance = Chart.getChart(canvasId);
    if (chartInstance && chartInstance.options.plugins.annotation) {
        const annotation = chartInstance.options.plugins.annotation.annotations.drawdownHighlight;
        if (annotation) {
            annotation.xMin = startStr;
            annotation.xMax = endStr;
            annotation.display = true; // Show highlight
            chartInstance.update('none'); // Update without full redraw animation for performance
        }
    }

    // 2. Update Table Styles
    // Limpiamos la selección activa de todas las filas
    document.querySelectorAll(`.dd-row-${idSufix}`).forEach(row => {
        row.classList.remove('bg-red-900/20', 'selected-dd-row');
        row.classList.add('hover:bg-gray-800/30');
    });

    document.querySelectorAll(`.dd-ring-${idSufix}`).forEach(ring => {
        ring.classList.remove('border-red-500');
        ring.classList.add('border-gray-600');
    });

    document.querySelectorAll(`.dd-rank-text-${idSufix}`).forEach(text => {
        text.classList.remove('text-red-400', 'font-bold');
    });

    // Añadimos selección a la fila clicada
    const targetRow = document.getElementById(`dd-row-${idSufix}-${index}`);
    if (targetRow) {
        targetRow.classList.remove('hover:bg-gray-800/30');
        targetRow.classList.add('bg-red-900/20', 'selected-dd-row');

        const targetRing = document.getElementById(`dd-ring-${idSufix}-${index}`);
        if (targetRing) {
            targetRing.classList.remove('border-gray-600');
            targetRing.classList.add('border-red-500');
        }

        const targetText = targetRow.querySelector(`.dd-rank-text-${idSufix}`);
        if (targetText) {
            targetText.classList.add('text-red-400', 'font-bold');
        }

        // Scroll into view if not visible, only if it was an explicit click
        if (!isInitialLoad) {
            targetRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
};
