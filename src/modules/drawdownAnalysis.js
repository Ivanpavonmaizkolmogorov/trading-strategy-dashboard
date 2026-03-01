/**
 * Funciones de cálculo puro para el análisis de Drawdown (Monetario y Porcentual).
 * Construye curvas Underwater y encuentra los Top peores episodios de caídas.
 */

/**
 * Calcula el desglose de Drawdowns de una lista cronológica de trades.
 * 
 * @param {Array} trades - Array de objetos trade (deben tener .pnl y .exitTime/.closeTime)
 * @param {number} topN - Número de peores drawdowns a devolver (por defecto 7)
 * @returns {Object} - Objeto con los Top DDs, Stagnation actual, y curvas de estado
 */
export function calculateDrawdownBreakdown(trades, topN = 7) {
    if (!trades || trades.length === 0) {
        return {
            drawdowns: [],
            currentStagnationDays: 0,
            timeUnderWaterPercent: 0,
            underwaterCurve: []
        };
    }

    // Asegurarse de que los trades están ordenados cronológicamente
    // Usamos exitTime o closeTime. Si no hay, intentamos extraer fecha
    const sortedTrades = [...trades].sort((a, b) => {
        const tA = new Date(a.exitTime || a.closeTime || a.fecha).getTime();
        const tB = new Date(b.exitTime || b.closeTime || b.fecha).getTime();
        return tA - tB;
    });

    // Asumimos un capital inicial base de 10,000$ (igual que en sqAnalysis_v2.js) 
    // Esto previene divisiones por cero si la estrategia comienza perdiendo y asegura 
    // que los porcentajes no exploten a -Infinity%
    const INITIAL_CAPITAL = 10000;
    let currentBalance = INITIAL_CAPITAL;
    let highWaterMark = INITIAL_CAPITAL;

    // Para identificar períodos de DD
    let inDrawdown = false;
    let currentDDStart = null;
    let currentDDBottomValue = 0;
    let currentDDBottomDate = null;
    let currentDDDepthPercent = 0;

    const allDrawdowns = [];
    const underwaterCurve = [];

    // Rastrear el porcentaje de tiempo global en Drawdown
    let totalDaysInHistory = 0;
    let daysInDrawdown = 0;

    const startTimeStamp = new Date(sortedTrades[0].exitTime || sortedTrades[0].closeTime || sortedTrades[0].fecha).getTime();
    const endTimeStamp = new Date(sortedTrades[sortedTrades.length - 1].exitTime || sortedTrades[sortedTrades.length - 1].closeTime || sortedTrades[sortedTrades.length - 1].fecha).getTime();

    if (!isNaN(startTimeStamp) && !isNaN(endTimeStamp)) {
        totalDaysInHistory = (endTimeStamp - startTimeStamp) / (1000 * 60 * 60 * 24);
    }

    // Iteramos por la curva
    for (let i = 0; i < sortedTrades.length; i++) {
        const trade = sortedTrades[i];
        const dateStr = trade.exitTime || trade.closeTime || trade.fecha;
        const tradeDate = new Date(dateStr);
        // Si el trade no tiene métrica de ganancia, usar .pnl o .profit
        const profit = parseFloat(trade.pnl !== undefined ? trade.pnl : (trade.profit || 0));

        // Sumar comisiones y swaps si están separados, el motor SQ suele enviarlos agregados en pnl
        currentBalance += profit;

        // ¿Hemos marcado un nuevo máximo histórico?
        if (currentBalance >= highWaterMark) {

            // Si veníamos de un Drawdown, significa que hoy nos hemos recuperado
            if (inDrawdown) {
                const daysToRecover = (tradeDate.getTime() - currentDDStart.getTime()) / (1000 * 60 * 60 * 24);
                const daysToBottom = (currentDDBottomDate.getTime() - currentDDStart.getTime()) / (1000 * 60 * 60 * 24);

                // Solo guardamos el DD si realmente hubo una caída (ignorar estancamientos de 0$)
                if (currentDDBottomValue < 0) {
                    allDrawdowns.push({
                        depthMonetary: currentDDBottomValue,
                        depthPercent: currentDDDepthPercent,
                        startDate: new Date(currentDDStart),
                        bottomDate: new Date(currentDDBottomDate),
                        recoveryDate: new Date(tradeDate),
                        totalDays: Math.max(1, Math.round(daysToRecover)), // Mínimo 1 día
                        daysToBottom: Math.max(0, Math.round(daysToBottom)),
                        isRecovered: true
                    });
                }

                inDrawdown = false;
            }

            highWaterMark = currentBalance;
            underwaterCurve.push({ date: dateStr, value: 0, monetary: 0 }); // 0% de DD

        } else {
            // Estamos por debajo del máximo histórico. Estamos en Drawdown.
            const currentDrawdownValue = currentBalance - highWaterMark; // Negativo ($)
            const currentDrawdownPercent = (currentDrawdownValue / INITIAL_CAPITAL) * 100; // Negativo (%) BASE FIJA 10k

            // ¿Es este el primer trade que nos pone en DD desde el último máximo?
            if (!inDrawdown) {
                inDrawdown = true;
                currentDDStart = tradeDate;
                currentDDBottomValue = currentDrawdownValue;
                currentDDBottomDate = tradeDate;
                currentDDDepthPercent = currentDrawdownPercent;
            } else {
                // Ya estábamos en DD. ¿Hemos tocado un nuevo fondo para este episodio?
                if (currentDrawdownValue < currentDDBottomValue) {
                    currentDDBottomValue = currentDrawdownValue;
                    currentDDBottomDate = tradeDate;
                    currentDDDepthPercent = currentDrawdownPercent;
                }
            }

            underwaterCurve.push({ date: dateStr, value: currentDrawdownPercent, monetary: currentDrawdownValue });
        }
    }

    // Si al terminar la curva seguimos en Drawdown (Aún no nos hemos recuperado)
    let currentStagnationDays = 0;
    if (inDrawdown) {
        const lastTradeDate = new Date(sortedTrades[sortedTrades.length - 1].exitTime || sortedTrades[sortedTrades.length - 1].closeTime || sortedTrades[sortedTrades.length - 1].fecha);
        currentStagnationDays = Math.max(0, Math.round((lastTradeDate.getTime() - currentDDStart.getTime()) / (1000 * 60 * 60 * 24)));
        const daysToBottom = Math.max(0, Math.round((currentDDBottomDate.getTime() - currentDDStart.getTime()) / (1000 * 60 * 60 * 24)));

        if (currentDDBottomValue < 0) {
            allDrawdowns.push({
                depthMonetary: currentDDBottomValue,
                depthPercent: currentDDDepthPercent,
                startDate: new Date(currentDDStart),
                bottomDate: new Date(currentDDBottomDate),
                recoveryDate: null, // Aún abierto
                totalDays: currentStagnationDays,
                daysToBottom: daysToBottom,
                isRecovered: false
            });
        }
    }

    // Calcular "Time Under Water" (% del tiempo total histórico)
    const timeUnderWaterPercent = totalDaysInHistory > 0 ?
        (allDrawdowns.reduce((sum, dd) => sum + dd.totalDays, 0) / totalDaysInHistory) * 100
        : 0;

    // Ordenar los drawdowns por profundidad absoluta ($) y tomar los peores Top N
    const topDrawdowns = allDrawdowns
        .sort((a, b) => a.depthMonetary - b.depthMonetary) // De más negativo a menos
        .slice(0, topN);

    return {
        drawdowns: topDrawdowns,
        currentStagnationDays,
        timeUnderWaterPercent: Math.min(100, Math.max(0, timeUnderWaterPercent)), // Clamp 0-100
        underwaterCurve
    };
}

/**
 * Helper para formatear fechas a YYYY-MM-DD
 */
export function formatDDDate(dateObj) {
    if (!dateObj) return 'Activo';
    try {
        return dateObj.toISOString().split('T')[0];
    } catch (e) {
        return '-';
    }
}
