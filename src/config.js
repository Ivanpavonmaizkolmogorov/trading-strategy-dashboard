export const ALL_METRICS = {
    name: { label: 'Portafolio', class: 'p-2 text-left align-bottom' },
    metricValue: { label: 'Métrica Optimizada', class: 'p-2 text-center' },
    profitFactor: { label: 'Profit Factor', class: 'p-2 text-center' },
    sortinoRatio: { label: 'Ratio Sortino', class: 'p-2 text-center' },
    upi: { label: 'UPI', class: 'p-2 text-center' },
    sharpeRatio: { label: 'Ratio Sharpe', class: 'p-2 text-center' },
    captureRatio: { label: 'Capture Ratio', class: 'p-2 text-center' },
    maxDrawdown: { label: 'Max Drawdown %', class: 'p-2 text-center' },
    maxDrawdownInDollars: { label: 'Max Drawdown $', class: 'p-2 text-center' },
    monthlyAvgProfit: { label: 'Profit / Mes', class: 'p-2 text-center' },
    profitMaxDD_Ratio: { label: 'Ret/DD', class: 'p-2 text-center' },
    monthlyProfitToDollarDD: { label: 'Profit/Mes / DD$', class: 'p-2 text-center' },
    maxConsecutiveLosingMonths: { label: 'Max Meses Pérdida', class: 'p-2 text-center' },
    winningPercentage: { label: 'Win %', class: 'p-2 text-center' },
    maxStagnationTrades: { label: 'Stagnation (Trades)', class: 'p-2 text-center' },
    totalTrades: { label: 'Num. Trades', class: 'p-2 text-center' },
    maxStagnationDays: { label: 'Stagnation (Días)', class: 'p-2 text-center' },
    sqn: { label: 'SQN', class: 'p-2 text-center' },
    ulcerIndexInDollars: { label: 'Ulcer Index $', class: 'p-2 text-center' },
};

export const SELECTION_COLORS = [
    'bg-sky-900/60',
    'bg-purple-900/60',
    'bg-emerald-900/60',
    'bg-pink-900/60',
    'bg-amber-900/60'
];

export const STRATEGY_COLORS = ['#38bdf8', '#a78bfa', '#f472b6', '#4ade80', '#fb923c', '#f87171', '#818cf8', '#67e8f9', '#d8b4fe', '#f9a8d4'];

export const CHART_OPTIONS = {
    maintainAspectRatio: false,
    responsive: true,
    plugins: {
        legend: { position: 'top', labels: { color: '#e5e7eb' } },
        zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } }
    },
    scales: {
        x: { type: 'timeseries', time: { unit: 'month' }, ticks: { color: '#9ca3af', autoSkip: true, maxTicksLimit: 20 }, grid: { color: 'rgba(75, 85, 99, 0.5)' } },
        y: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(75, 85, 99, 0.5)' } }
    }
};