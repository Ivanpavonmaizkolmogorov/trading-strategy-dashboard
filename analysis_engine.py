import pandas as pd
import numpy as np
from itertools import combinations

def process_strategy_data(trades_df: pd.DataFrame, benchmark_df: pd.DataFrame):
    """
    Procesa un DataFrame de trades y calcula todas las métricas de rendimiento.
    Esta es la versión en Python de la función 'processStrategyData' de analysis.js.
    """
    if trades_df.empty or benchmark_df.empty:
        return None

    # Asegurarse de que las fechas son datetime objects y están en el índice
    trades_df['exit_date'] = pd.to_datetime(trades_df['exit_date'], errors='coerce')
    trades_df = trades_df.dropna(subset=['exit_date', 'pnl'])
    
    benchmark_df['date'] = pd.to_datetime(benchmark_df['date'], errors='coerce')
    benchmark_df = benchmark_df.dropna(subset=['date', 'price']).set_index('date')

    # Calcular PnL diario
    daily_pnl = trades_df.groupby(trades_df['exit_date'].dt.date)['pnl'].sum()
    daily_pnl.index = pd.to_datetime(daily_pnl.index)

    # Crear curva de equity
    equity_curve = pd.DataFrame(index=benchmark_df.index)
    equity_curve['pnl'] = daily_pnl
    equity_curve['pnl'] = equity_curve['pnl'].fillna(0)
    equity_curve['equity'] = 10000 + equity_curve['pnl'].cumsum()

    # Métricas de Drawdown
    rolling_max = equity_curve['equity'].cummax()
    drawdown = (equity_curve['equity'] - rolling_max) / rolling_max
    max_drawdown = abs(drawdown.min()) * 100
    max_drawdown_dollars = (rolling_max - equity_curve['equity']).max()

    # Métricas de Retorno
    total_profit = equity_curve['equity'].iloc[-1] - equity_curve['equity'].iloc[0]
    duration_days = (equity_curve.index[-1] - equity_curve.index[0]).days
    duration_months = duration_days / 30.44
    monthly_avg_profit = total_profit / duration_months if duration_months > 0 else 0

    # Ret/DD
    profit_max_dd_ratio = total_profit / max_drawdown_dollars if max_drawdown_dollars > 0 else None
    monthly_profit_to_dollar_dd = (monthly_avg_profit / max_drawdown_dollars) * 100 if max_drawdown_dollars > 0 else None

    # Métricas basadas en retornos diarios
    daily_returns = equity_curve['equity'].pct_change().fillna(0)
    
    # Unir retornos del benchmark
    benchmark_returns = benchmark_df['price'].pct_change().fillna(0)
    combined_returns = pd.DataFrame({'portfolio': daily_returns, 'benchmark': benchmark_returns}).dropna()

    # Capture Ratios
    positive_bench_days = combined_returns[combined_returns['benchmark'] > 0]
    negative_bench_days = combined_returns[combined_returns['benchmark'] < 0]
    
    avg_portfolio_up = positive_bench_days['portfolio'].mean()
    avg_benchmark_up = positive_bench_days['benchmark'].mean()
    avg_portfolio_down = negative_bench_days['portfolio'].mean()
    avg_benchmark_down = negative_bench_days['benchmark'].mean()

    # Sharpe Ratio
    sharpe_ratio = 0
    if daily_returns.std() > 0:
        sharpe_ratio = (daily_returns.mean() / daily_returns.std()) * np.sqrt(252)

    # Sortino Ratio
    negative_returns = daily_returns[daily_returns < 0]
    downside_deviation = np.sqrt((negative_returns**2).mean())
    sortino_ratio = None
    if downside_deviation > 0:
        sortino_ratio = (daily_returns.mean() / downside_deviation) * np.sqrt(252)

    # Métricas de Trades
    total_trades = len(trades_df)
    winning_trades = trades_df[trades_df['pnl'] > 0]
    losing_trades = trades_df[trades_df['pnl'] < 0]
    
    win_pct = (len(winning_trades) / total_trades) * 100 if total_trades > 0 else 0
    profit_factor = abs(winning_trades['pnl'].sum() / losing_trades['pnl'].sum()) if losing_trades['pnl'].sum() != 0 else None

    # Meses consecutivos de pérdidas
    monthly_pnl = equity_curve['pnl'].resample('M').sum()
    consecutive_losing_months = 0
    max_consecutive_losing_months = 0
    for pnl in monthly_pnl:
        if pnl < 0:
            consecutive_losing_months += 1
        else:
            max_consecutive_losing_months = max(max_consecutive_losing_months, consecutive_losing_months)
            consecutive_losing_months = 0
    max_consecutive_losing_months = max(max_consecutive_losing_months, consecutive_losing_months)

    # UPI (Ulcer Performance Index)
    duration_years = duration_days / 365.25
    cagr = 0
    if equity_curve['equity'].iloc[0] > 0 and equity_curve['equity'].iloc[-1] > 0 and duration_years > 0:
        cagr = ((equity_curve['equity'].iloc[-1] / equity_curve['equity'].iloc[0])**(1/duration_years) - 1) * 100
    
    ulcer_index = np.sqrt((drawdown**2).mean()) * 100
    upi = cagr / ulcer_index if ulcer_index > 0 else None
    
    # Cálculo final de Capture Ratio
    upside_capture = (avg_portfolio_up / avg_benchmark_up) * 100 if avg_benchmark_up != 0 else 0
    downside_capture = (avg_portfolio_down / avg_benchmark_down) * 100 if avg_benchmark_down != 0 else 0
    capture_ratio = upside_capture / downside_capture if downside_capture > 0 else None

    # Devolver un diccionario con todas las métricas que espera el frontend
    return {
        "profitFactor": profit_factor,
        "sortinoRatio": sortino_ratio,
        "maxDrawdown": max_drawdown,
        "monthlyAvgProfit": monthly_avg_profit,
        "maxConsecutiveLosingMonths": max_consecutive_losing_months,
        "upi": upi,
        "sharpeRatio": sharpe_ratio,
        "captureRatio": capture_ratio,
        "maxDrawdownInDollars": max_drawdown_dollars,
        "profitMaxDD_Ratio": profit_max_dd_ratio,
        "monthlyProfitToDollarDD": monthly_profit_to_dollar_dd,
        "winningPercentage": win_pct,
        "maxStagnationTrades": 0, # Placeholder
        "totalTrades": total_trades,
        "maxStagnationDays": 0, # Placeholder
        "sqn": 0, # Placeholder
    }, daily_returns


def get_combinations(arr, min_size, max_size):
    """Generador para todas las combinaciones de un array."""
    for k in range(min_size, max_size + 1):
        for combo in combinations(arr, k):
            yield combo

def count_combinations(n, min_size, max_size):
    """Calcula el número total de combinaciones sin generarlas."""
    from math import comb
    total = 0
    # Asegurarse de que max_size no sea mayor que n
    actual_max_size = min(n, max_size)
    for k in range(min_size, actual_max_size + 1):
        try:
            total += comb(n, k)
        except ValueError:
            # Esto puede ocurrir si k > n, aunque ya lo prevenimos
            continue
    return total


def add_to_databank_if_better(databank_portfolios, portfolio_data, max_size):
    """
    Añade un portafolio al databank si es mejor que los existentes,
    manteniendo la lista ordenada y con un tamaño máximo.
    """
    metric_value = portfolio_data['metricValue']
    goal = portfolio_data['optimizationGoal']

    # Si el databank no está lleno, simplemente añade y ordena
    if len(databank_portfolios) < max_size:
        databank_portfolios.append(portfolio_data)
    else:
        # Si está lleno, compara con el peor de la lista
        worst_portfolio = databank_portfolios[-1]
        is_new_better = (goal == 'maximize' and metric_value > worst_portfolio['metricValue']) or \
                        (goal == 'minimize' and metric_value < worst_portfolio['metricValue'])
        
        if is_new_better:
            # Reemplaza el peor y reordena
            databank_portfolios[-1] = portfolio_data
    
    # Ordenar la lista
    databank_portfolios.sort(
        key=lambda p: p['metricValue'],
        reverse=(goal == 'maximize')
    )
    return databank_portfolios