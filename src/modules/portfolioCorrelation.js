
/**
 * @file src/modules/portfolioCorrelation.js
 * @description Handles calculation and visualization of correlation between entire portfolios
 * based on their Equity Curves (Daily Returns).
 */

import { state } from '../state.js';

/**
 * Calculates the Pearson correlation matrix for the selected portfolios.
 * Uses the 'equityCurve' from their analysis data.
 * 
 * @param {Array<Object>} portfolios - List of portfolio objects from state.savedPortfolios
 * @returns {Object} { matrix: Array<Array<number>>, names: Array<string> } or null if error
 */
export const calculatePortfolioCorrelationMatrix = (portfolios) => {
    if (!portfolios || portfolios.length < 2) return null;

    // 1. Extract Daily Returns for each portfolio
    const seriesData = portfolios.map(p => {
        // Find Equity Curve
        const curve = p.metrics?.chartData?.equityCurve || p.analysis?.chartData?.equityCurve;

        if (!curve || curve.length < 2) {
            console.warn(`[Correlation] Portfolio "${p.name}" has no valid equity curve.`);
            return null;
        }

        // Convert to [{date: timestamp, val: number}] map for easy lookup
        const dateMap = new Map();

        // Calculate daily returns: (Today - Yesterday) / Yesterday  OR just PnL Delta?
        // Pearson acts on variables. Usually we correlate Daily Returns % or Daily PnL.
        // Let's use Daily PnL Delta to be safe against base changes, or Ln(Returns).
        // Simple approach: Daily % Return.

        for (let i = 1; i < curve.length; i++) {
            const prev = curve[i - 1].y;
            const curr = curve[i].y;
            const date = curve[i].x; // Timestamp

            // Avoid division by zero
            if (prev === 0) continue;

            const ret = (curr - prev) / prev;
            dateMap.set(date, ret);
        }

        return {
            name: p.name,
            data: dateMap
        };
    }).filter(s => s !== null);

    if (seriesData.length < 2) return null;

    // 2. Find Common Date Intersection (to ensure valid comparison)
    // We get all unique dates from all series, but we only use dates present in ALL comparisons?
    // Pairwise correlation handles missing data differently. 
    // Best Approach: Union of all dates, fill missing with 0.0 (no return).

    const allDates = new Set();
    seriesData.forEach(s => {
        for (const date of s.data.keys()) {
            allDates.add(date);
        }
    });

    const sortedDates = Array.from(allDates).sort((a, b) => a - b);

    // 3. Construct Vectors
    const vectors = seriesData.map(s => {
        return sortedDates.map(date => s.data.get(date) || 0);
    });

    // 4. Calculate Correlation Matrix (Pearson)
    const matrix = [];
    const n = vectors.length;

    for (let i = 0; i < n; i++) {
        const row = [];
        for (let j = 0; j < n; j++) {
            if (i === j) {
                row.push(1.0);
            } else if (j < i) {
                // Symmetric
                row.push(matrix[j][i]);
            } else {
                row.push(calculatePearson(vectors[i], vectors[j]));
            }
        }
        matrix.push(row);
    }

    return {
        matrix,
        names: seriesData.map(s => s.name)
    };
};

/**
 * Standard Pearson Correlation Coefficient
 */
function calculatePearson(x, y) {
    const n = x.length;
    if (n !== y.length || n === 0) return 0;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

    for (let i = 0; i < n; i++) {
        sumX += x[i];
        sumY += y[i];
        sumXY += x[i] * y[i];
        sumX2 += x[i] * x[i];
        sumY2 += y[i] * y[i];
    }

    const numerator = (n * sumXY) - (sumX * sumY);
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    if (denominator === 0) return 0;
    return numerator / denominator;
}

/**
 * Displays the Correlation Modal
 */
export const showPortfolioCorrelationModal = (correlationData) => {
    ensureModalExists();

    const { matrix, names } = correlationData;
    const container = document.getElementById('portfolio-correlation-content');

    // Render Heatmap
    let html = '<table class="w-full text-xs text-center border-collapse table-auto">';

    // Header
    html += '<thead><tr><th class="p-1"></th>';
    names.forEach(name => html += `<th class="p-2 text-gray-400 font-normal rotate-45 h-32 align-bottom whitespace-nowrap min-w-[80px] max-w-[150px] overflow-hidden text-ellipsis text-[10px]" title="${name}">${name}</th>`);
    html += '</tr></thead><tbody>';

    matrix.forEach((row, i) => {
        html += `<tr><td class="p-2 text-gray-400 font-normal text-right whitespace-nowrap text-[10px] max-w-[150px] overflow-hidden text-ellipsis" title="${names[i]}">${names[i]}</td>`;
        row.forEach((val, j) => {
            let colorClass = 'text-gray-500';
            let bgStyle = '';

            if (i === j) {
                colorClass = 'text-gray-600';
            } else {
                const absVal = Math.abs(val);
                if (val > 0.7) colorClass = 'text-red-400 font-bold';
                else if (val > 0.4) colorClass = 'text-yellow-400';
                else colorClass = 'text-green-400';

                // Opacity based on strength
                const opacity = Math.max(0.05, absVal * 0.4);
                // Red for positive, Blue for negative
                const color = val >= 0 ? '255,0,0' : '0,100,255';
                bgStyle = `background-color: rgba(${color}, ${opacity})`;
            }

            html += `<td class="p-2 border border-gray-700/50 ${colorClass}" style="${bgStyle}">${val.toFixed(2)}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    const modal = document.getElementById('portfolio-correlation-modal');
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('.transform').classList.remove('scale-95');
    }, 10);
};

const ensureModalExists = () => {
    if (document.getElementById('portfolio-correlation-modal')) return;

    const html = `
    <div id="portfolio-correlation-modal" class="fixed inset-0 bg-gray-900/80 backdrop-blur-sm z-[60] hidden flex items-center justify-center opacity-0 transition-opacity duration-300">
        <div class="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-11/12 max-w-5xl max-h-[90vh] flex flex-col transform scale-95 transition-transform duration-300">
            <!-- Header -->
            <div class="flex justify-between items-center p-6 border-b border-gray-700 bg-gray-800/50 rounded-t-xl">
                <div>
                    <h2 class="text-xl font-bold text-white flex items-center gap-2">
                        <span class="text-indigo-400">📊</span> Correlación de Portafolios
                    </h2>
                    <p class="text-gray-400 text-sm mt-1">Matriz de correlación basada en retornos diarios (% Change).</p>
                </div>
                <button id="close-portfolio-correlation-modal" class="text-gray-400 hover:text-white transition-colors">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>

            <!-- Content -->
            <div class="flex-1 overflow-auto custom-scrollbar p-6 bg-gray-900/30">
                <div id="portfolio-correlation-content" class="bg-gray-800 rounded-lg p-4 border border-gray-700/50 min-w-min">
                    <!-- Table injected here -->
                </div>
            </div>
            
            <!-- Footer -->
            <div class="p-4 border-t border-gray-700 bg-gray-800/50 rounded-b-xl flex justify-end">
                <button id="btn-close-portfolio-corr" class="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                    Cerrar
                </button>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', html);

    // Event Listeners
    const modal = document.getElementById('portfolio-correlation-modal');
    const close = () => {
        modal.classList.add('opacity-0');
        modal.querySelector('.transform').classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
    };

    document.getElementById('close-portfolio-correlation-modal').addEventListener('click', close);
    document.getElementById('btn-close-portfolio-corr').addEventListener('click', close);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });
};
