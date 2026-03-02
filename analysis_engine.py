import pandas as pd
import numpy as np
from itertools import combinations
from models.trade import Trade
from models.trade_series import TradeSeries

def process_strategy_data(trades_df: pd.DataFrame, benchmark_df: pd.DataFrame = None):
    """
    Procesa un DataFrame de trades y calcula todas las métricas de rendimiento
    utilizando la nueva estructura OOP (TradeSeries).
    """
    if trades_df is None or trades_df.empty:
        return {}, pd.Series(dtype=float)

    # Convert DataFrame rows to list of dicts for the Trade model
    # Handle NaN values explicitly
    trades_dict_list = trades_df.replace({np.nan: None}).to_dict('records')
    
    # Instantiate OOP model
    series = TradeSeries(trades_dict_list)
    
    # Calculate all metrics
    metrics_dict = series.to_metrics_dict()
    
    # Calculate daily returns for capture ratio or other uses
    # Build daily equity curve to calculate daily percentage returns exactly as before
    daily_pnl = series._calculate_core_metrics()['dailyPnL']
    if not daily_pnl:
        daily_returns = pd.Series(dtype=float)
    else:
        # Sort dates
        dates = sorted(daily_pnl.keys())
        full_date_range = pd.date_range(start=dates[0], end=dates[-1], freq='D')
        
        daily_pnl_series = pd.Series(daily_pnl)
        daily_pnl_series.index = pd.to_datetime(daily_pnl_series.index)
        
        equity_curve = pd.DataFrame(index=full_date_range)
        equity_curve['pnl'] = daily_pnl_series.reindex(full_date_range, fill_value=0.0)
        equity_curve['equity'] = 10000.0 + equity_curve['pnl'].cumsum()
        
        daily_returns = equity_curve['equity'].pct_change().fillna(0)

    return metrics_dict, daily_returns

def calculate_metrics_for_period(trades_df: pd.DataFrame, period_config: dict = None, benchmark_df: pd.DataFrame = None):
    """
    Wrapper function that calculates metrics for a specific time period.
    """
    if trades_df.empty:
        return {
            'periodKey': 'full',
            'dateRange': {'start': None, 'end': None},
            'tradeCount': 0,
            'metrics': {},
            'monthlyReturns': []
        }
    
    # Convert DataFrame rows to list of dicts
    trades_dict_list = trades_df.replace({np.nan: None}).to_dict('records')
    series = TradeSeries(trades_dict_list)

    if period_config and (period_config.get('start') or period_config.get('end')):
        start_date = period_config.get('start')
        end_date = period_config.get('end')
        filtered_series = series.filter_by_date_range(start_date, end_date)
        period_key = f"{start_date}_{end_date}"
    else:
        filtered_series = series
        period_key = 'full'
        start_date = series.trades[0].exit_time.strftime('%Y-%m-%d') if series.trades and series.trades[0].exit_time else None
        end_date = series.trades[-1].exit_time.strftime('%Y-%m-%d') if series.trades and series.trades[-1].exit_time else None
        period_config = {'start': start_date, 'end': end_date}
    
    trade_count = filtered_series.total_trades
    
    if trade_count == 0:
        return {
            'periodKey': period_key,
            'dateRange': period_config,
            'tradeCount': 0,
            'metrics': {},
            'monthlyReturns': []
        }
    
    metrics = filtered_series.to_metrics_dict()
    
    # Generate daily returns exactly as process_strategy_data does
    daily_pnl = filtered_series._calculate_core_metrics()['dailyPnL']
    monthly_returns = []
    
    if daily_pnl:
        dates = sorted(daily_pnl.keys())
        full_date_range = pd.date_range(start=dates[0], end=dates[-1], freq='D')
        
        daily_pnl_series = pd.Series(daily_pnl)
        daily_pnl_series.index = pd.to_datetime(daily_pnl_series.index)
        
        equity_curve = pd.DataFrame(index=full_date_range)
        equity_curve['pnl'] = daily_pnl_series.reindex(full_date_range, fill_value=0.0)
        daily_returns = equity_curve['pnl'].cumsum() + 10000.0
        pct_returns = daily_returns.pct_change().fillna(0)
        
        try:
            monthly_pnl_pct = pct_returns.resample('M').apply(lambda x: (x + 1).prod() - 1)
            monthly_returns = [{'month': idx.strftime('%Y-%m'), 'return': val} for idx, val in monthly_pnl_pct.items()]
        except Exception:
            pass
    
    return {
        'periodKey': period_key,
        'dateRange': period_config,
        'tradeCount': trade_count,
        'metrics': metrics,
        'monthlyReturns': monthly_returns
    }

def get_combinations(arr, min_size, max_size):
    """Generador para todas las combinaciones de un array."""
    for k in range(min_size, max_size + 1):
        for combo in combinations(arr, k):
            yield combo

def count_combinations(n, min_size, max_size):
    """Calcula el número total de combinaciones sin generarlas."""
    from math import comb
    total = 0
    actual_max_size = min(n, max_size)
    for k in range(min_size, actual_max_size + 1):
        try:
            total += comb(n, k)
        except ValueError:
            continue
    return total

def add_to_databank_if_better(databank_portfolios, portfolio_data, max_size):
    """
    Añade un portafolio al databank si es mejor que los existentes,
    manteniendo la lista ordenada y con un tamaño máximo.
    """
    metric_value = portfolio_data['metricValue']
    goal = portfolio_data['optimizationGoal']

    if len(databank_portfolios) < max_size:
        databank_portfolios.append(portfolio_data)
    else:
        worst_portfolio = databank_portfolios[-1]
        is_new_better = (goal == 'maximize' and metric_value > worst_portfolio['metricValue']) or \
                        (goal == 'minimize' and metric_value < worst_portfolio['metricValue'])
        
        if is_new_better:
            databank_portfolios[-1] = portfolio_data
    
    databank_portfolios.sort(
        key=lambda p: p['metricValue'],
        reverse=(goal == 'maximize')
    )
    return databank_portfolios
