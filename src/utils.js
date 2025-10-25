import { dom } from './dom.js';
import { state } from './state.js';

export const toggleLoading = (isLoading, buttonId, textId, spinnerId) => {
    const btn = document.getElementById(buttonId);
    const btnText = document.getElementById(textId);
    const btnSpinner = document.getElementById(spinnerId);
    if (btnText && btnSpinner && btn) {
        btnText.classList.toggle('hidden', isLoading);
        btnSpinner.classList.toggle('hidden', !isLoading);
        btn.disabled = isLoading;
    }
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