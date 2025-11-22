import { dom } from './dom.js';
import { state } from './state.js';

/**
 * Muestra u oculta el overlay de carga global con un mensaje personalizado y barra de progreso opcional.
 * @param {boolean} isLoading - Si es true, muestra el overlay. Si es false, lo oculta.
 * @param {string} title - Título del overlay (ej: "Analizando...").
 * @param {string} message - Mensaje de detalle (ej: "Procesando 50 portafolios...").
 * @param {number|null} progress - Porcentaje de progreso (0-100) o null para ocultar barra.
 */
export const toggleLoading = (isLoading, title = 'Procesando...', message = 'Por favor espera', progress = null) => {
    const overlay = document.getElementById('loading-overlay');
    const titleEl = document.getElementById('loading-overlay-title');
    const messageEl = document.getElementById('loading-overlay-message');
    const progressContainer = document.getElementById('loading-progress-container');
    const progressBar = document.getElementById('loading-progress-bar');
    const progressText = document.getElementById('loading-progress-text');

    if (!overlay) return;

    if (isLoading) {
        if (titleEl) titleEl.textContent = title;
        if (messageEl) messageEl.textContent = message;

        // Gestión de la barra de progreso
        if (progress !== null && progressContainer && progressBar && progressText) {
            progressContainer.classList.remove('hidden');
            progressText.classList.remove('hidden');
            const pct = Math.min(100, Math.max(0, progress));
            progressBar.style.width = `${pct}%`;
            progressText.textContent = `${Math.round(pct)}%`;
        } else if (progressContainer && progressText) {
            progressContainer.classList.add('hidden');
            progressText.classList.add('hidden');
        }

        overlay.classList.remove('hidden');
        requestAnimationFrame(() => {
            overlay.classList.remove('opacity-0');
        });
    } else {
        overlay.classList.add('opacity-0');
        setTimeout(() => {
            overlay.classList.add('hidden');
            // Resetear progreso al cerrar
            if (progressBar) progressBar.style.width = '0%';
        }, 300);
    }

    // Mantener compatibilidad con botones antiguos si se pasan IDs (aunque ya no se recomienda)
    // Si se llama con la firma antigua: toggleLoading(true, 'btnId', 'textId', 'spinnerId')
    // los argumentos title y message serán IDs, lo cual no romperá nada crítico pero no funcionará como overlay.
    // Para esta refactorización, asumimos que actualizaremos las llamadas.
};

export const displayError = (message) => {
    dom.errorMessageDiv.textContent = `Error: ${message}`;
    dom.errorMessageDiv.classList.remove('hidden');
};

export const hideError = () => dom.errorMessageDiv.classList.add('hidden');

export const parseCsv = (file) => {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true, skipEmptyLines: true, dynamicTyping: true,
            transformHeader: h => {
                const header = h.trim().toLowerCase();
                const map = { 'open time': 'entry_date', 'close time': 'exit_date', 'profit/loss': 'pnl', 'time': 'date', 'fecha': 'date', 'gmt time': 'date', 'timestamp': 'date', 'datetime': 'date', 'close': 'price', 'precio': 'price', 'cierre': 'price', 'last': 'price', 'value': 'price', 'open price': 'price', 'close price': 'price' };
                return map[header] || header;
            },
            complete: (results) => {
                if (results.errors.length) return reject(new Error(`Error al parsear ${file.name}: ${results.errors[0].message}`));
                if (results.data.length === 0) return reject(new Error(`El archivo ${file.name} está vacío.`));
                const data = results.data.map(row => {
                    if (row.hasOwnProperty('entry_date') && !row.hasOwnProperty('date')) row.date = row.entry_date;
                    if (!row.hasOwnProperty('price')) {
                        if (row.hasOwnProperty('close price')) row.price = row['close price'];
                        else if (row.hasOwnProperty('open price')) row.price = row['open price'];
                    }
                    return row;
                });
                resolve(data);
            },
            error: (error) => reject(new Error(`No se pudo leer el archivo ${file.name}: ${error.message}`))
        });
    });
};

export const destroyChart = (canvasId) => {
    if (state.chartInstances[canvasId]) {
        state.chartInstances[canvasId].destroy();
        delete state.chartInstances[canvasId];
    }
};

export const destroyAllCharts = () => {
    Object.keys(state.chartInstances).forEach(destroyChart);
};

export const formatMetricForDisplay = (value, metricName) => {
    const isPercent = ['maxDrawdown', 'winningPercentage', 'upsideCapture', 'downsideCapture'].includes(metricName) || (metricName && metricName.toLowerCase().includes('%'));
    // MEJORA: Comprobación más robusta para valores nulos, indefinidos o no finitos.
    if (value === null || typeof value === 'undefined' || !isFinite(value)) return '∞';

    if (!isFinite(value)) return '∞';
    if (isPercent) return `${value.toFixed(2)}%`;
    if (value > 1000) return value.toFixed(0);
    return value.toFixed(2);
};