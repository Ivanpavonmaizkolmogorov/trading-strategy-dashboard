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
    throw new Error('calculateDrawdownBreakdown is deprecated. Use TradeSeries.getDrawdownBreakdown() instead.');
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
