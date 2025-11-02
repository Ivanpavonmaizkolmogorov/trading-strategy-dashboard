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
    # --- CORRECCIÓN: Convertir AMBAS columnas de fecha a datetime ---
    trades_df['entry_date'] = pd.to_datetime(trades_df['entry_date'], errors='coerce')
    trades_df['exit_date'] = pd.to_datetime(trades_df['exit_date'], errors='coerce')
    trades_df = trades_df.dropna(subset=['entry_date', 'exit_date', 'pnl'])
    
    # --- CORRECCIÓN: Volvemos a un capital inicial fijo, como debe ser. ---
    initial_capital = 10000

    # --- REESTRUCTURACIÓN TOTAL: LA CURVA POR OPERACIÓN ES LA FUENTE DE VERDAD ---
    # 1. Construir la curva de equity por operación. Esta será la base para TODAS las métricas de rendimiento y riesgo.
    #    Se ordena por fecha de salida para asegurar el orden cronológico correcto.
    trades_df_sorted = trades_df.sort_values(by='exit_date')
    equity_curve_by_trade_list = [initial_capital]
    current_equity_by_trade = initial_capital
    for pnl in trades_df_sorted['pnl']:
        current_equity_by_trade += pnl
        equity_curve_by_trade_list.append(current_equity_by_trade)
    
    equity_curve_by_trade = pd.Series(equity_curve_by_trade_list)

    # 2. Calcular TODAS las métricas de drawdown desde la curva por operación.
    rolling_max_by_trade = equity_curve_by_trade.cummax()
    drawdowns_in_dollars_by_trade = rolling_max_by_trade - equity_curve_by_trade
    drawdowns_in_pct_by_trade = drawdowns_in_dollars_by_trade / rolling_max_by_trade

    max_drawdown = abs(drawdowns_in_pct_by_trade.max()) * 100
    max_drawdown_dollars = drawdowns_in_dollars_by_trade.max()


    # 3. Construir la curva de equity DIARIA a partir de los trades para métricas temporales (Sharpe, Sortino, etc.)
    daily_pnl = trades_df_sorted.groupby(trades_df_sorted['exit_date'].dt.date)['pnl'].sum()
    if daily_pnl.empty:
        return None # No hay trades para analizar
    daily_pnl.index = pd.to_datetime(daily_pnl.index)
    full_date_range = pd.date_range(start=daily_pnl.index.min(), end=daily_pnl.index.max(), freq='D')
    
    equity_curve = pd.DataFrame(index=full_date_range)
    equity_curve['pnl'] = daily_pnl.reindex(full_date_range, fill_value=0.0)
    equity_curve['equity'] = initial_capital + equity_curve['pnl'].cumsum()

    # --- CÁLCULO DE MÉTRICAS UNIFICADO ---

    # Métricas de Retorno (calculadas directamente desde los trades o la curva por operación)
    total_profit = trades_df['pnl'].sum()
    first_trade_date = trades_df_sorted['entry_date'].iloc[0]
    last_trade_date = trades_df_sorted['exit_date'].iloc[-1]
    duration_days = (last_trade_date - first_trade_date).days if pd.notna(first_trade_date) and pd.notna(last_trade_date) else 0

    duration_months = duration_days / 30.44
    monthly_avg_profit = total_profit / duration_months if duration_months > 0 else 0

    # Ret/DD
    profit_max_dd_ratio = total_profit / max_drawdown_dollars if max_drawdown_dollars > 0 else None
    monthly_profit_to_dollar_dd = (monthly_avg_profit / max_drawdown_dollars) * 100 if max_drawdown_dollars > 0 else None

    # --- CORRECCIÓN: Definir total_trades ANTES de su primer uso ---
    total_trades = len(trades_df)

    # --- MÉTRICAS DE RATIO (SHARPE, SORTINO) BASADAS EN RETORNOS POR OPERACIÓN ---
    # 1. Calcular los retornos porcentuales para cada operación.
    # El retorno de una operación es su PnL dividido por el capital justo antes de esa operación.
    equity_before_each_trade = equity_curve_by_trade.iloc[:-1]
    trade_returns = trades_df_sorted['pnl'].values / equity_before_each_trade.values
    trade_returns = pd.Series(trade_returns) # Convertir a Series de pandas para usar sus métodos

    # 2. Calcular el factor de anualización basado en la frecuencia de trades.
    duration_years = duration_days / 365.25
    trades_per_year = total_trades / duration_years if duration_years > 0 else 0
    annualization_factor = np.sqrt(trades_per_year) if trades_per_year > 0 else 1

    # 3. Calcular Sharpe Ratio
    sharpe_ratio = 0
    if trade_returns.std() > 0:
        # (Retorno medio por trade / Desviación estándar de los retornos por trade) * sqrt(Trades por año)
        sharpe_ratio = (trade_returns.mean() / trade_returns.std()) * annualization_factor

    # 4. Calcular Sortino Ratio
    mean_trade_return = trade_returns.mean()
    negative_returns = trade_returns[trade_returns < 0]
    if len(negative_returns) == 0:
        sortino_ratio = 999.0 if mean_trade_return > 0 else 0.0
    else:
        downside_deviation = np.sqrt((negative_returns**2).sum() / len(trade_returns))
        if downside_deviation == 0:
            sortino_ratio = 999.0 if mean_trade_return > 0 else 0.0
        else:
            sortino_ratio = (mean_trade_return / downside_deviation) * annualization_factor

    # Métricas de Trades
    winning_trades = trades_df[trades_df['pnl'] > 0]
    losing_trades = trades_df[trades_df['pnl'] < 0]
    
    win_pct = (len(winning_trades) / total_trades) * 100 if total_trades > 0 else 0
    profit_factor = abs(winning_trades['pnl'].sum() / losing_trades['pnl'].sum()) if losing_trades['pnl'].sum() != 0 else None

    # Métricas de Capture Ratio (siguen necesitando una base diaria para compararse con el benchmark)
    daily_returns = equity_curve['equity'].pct_change().fillna(0)
    benchmark_df['date'] = pd.to_datetime(benchmark_df['date'], errors='coerce')
    benchmark_df = benchmark_df.dropna(subset=['date', 'price']).set_index('date')
    benchmark_returns = benchmark_df['price'].pct_change().fillna(0)
    combined_returns = pd.DataFrame({'portfolio': daily_returns, 'benchmark': benchmark_returns}).dropna()

    positive_bench_days = combined_returns[combined_returns['benchmark'] > 0]
    negative_bench_days = combined_returns[combined_returns['benchmark'] < 0]
    
    avg_portfolio_up = positive_bench_days['portfolio'].mean()
    avg_benchmark_up = positive_bench_days['benchmark'].mean()
    avg_portfolio_down = negative_bench_days['portfolio'].mean()
    avg_benchmark_down = negative_bench_days['benchmark'].mean()

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

    # --- CÁLCULO DE STAGNATION (ESTANCAMIENTO) ---
    # Ahora se calcula desde la curva diaria, que es la definición estándar de "Stagnation in Days".
    max_stagnation_days = 0
    if not equity_curve.empty:
        last_peak_date = equity_curve.index[0]
        for current_date, current_equity in equity_curve['equity'].items():
            if current_equity >= equity_curve['equity'].loc[last_peak_date]:
                last_peak_date = current_date
            stagnation_days = (current_date - last_peak_date).days
            max_stagnation_days = max(max_stagnation_days, stagnation_days)

    # --- CÁLCULO DE SQN (SYSTEM QUALITY NUMBER) ---
    avg_pnl = trades_df['pnl'].mean()
    std_pnl = trades_df['pnl'].std()
    sqn = 0
    if std_pnl > 0 and total_trades > 0:
        sqn = (avg_pnl / std_pnl) * np.sqrt(total_trades)

    # --- CÁLCULO DE UPI (ULCER PERFORMANCE INDEX) - USA LA CURVA POR OPERACIÓN ---

    # PASO 2: Calcular CAGR (Tasa de Crecimiento Anual Compuesta) en porcentaje.
    duration_years = duration_days / 365.25
    cagr = 0
    final_equity = equity_curve_by_trade.iloc[-1]
    if initial_capital > 0 and final_equity > 0 and duration_years > 0:
        if duration_years < 1.0:
            # Extrapolación lineal para periodos menores a un año.
            total_return = (final_equity / initial_capital) - 1
            cagr = (total_return / duration_years) * 100.0
        else:
            # Fórmula estándar de CAGR.
            cagr = (((final_equity / initial_capital)**(1/duration_years)) - 1) * 100

    # PASO 3: Calcular Ulcer Index en PORCENTAJE.
    n = len(equity_curve_by_trade_list)
    peak_equity = initial_capital
    squared_drawdown_sum = 0
    for current_point in equity_curve_by_trade_list:
        peak_equity = max(peak_equity, current_point)
        drawdown_pct = ((current_point / peak_equity) - 1) * 100.0 if peak_equity > 0 else 0
        squared_drawdown_sum += drawdown_pct**2
    
    ulcer_index_pct = np.sqrt(squared_drawdown_sum / n) if n > 0 else 0

    # PASO 4: Calcular UPI final.
    upi = cagr / ulcer_index_pct if ulcer_index_pct > 0 else (999 if cagr > 0 else 0)

    # --- CÁLCULO DE ULCER INDEX EN DÓLARES ---
    # Ahora se calcula desde la curva por operación para consistencia.
    ulcer_index_dollars = np.sqrt((drawdowns_in_dollars_by_trade**2).sum() / n) if n > 0 else 0

    # --- CÁLCULO DE STAGNATION EN TRADES ---
    max_stagnation_trades = 0
    trades_since_peak = 0
    peak_equity_by_trade = equity_curve_by_trade.iloc[0]
    for equity_point in equity_curve_by_trade_list[1:]:
        trades_since_peak += 1
        if equity_point > peak_equity_by_trade:
            max_stagnation_trades = max(max_stagnation_trades, trades_since_peak)
            peak_equity_by_trade = equity_point
            trades_since_peak = 0
    max_stagnation_trades = max(max_stagnation_trades, trades_since_peak)
    
    # Cálculo final de Capture Ratio
    upside_capture = (avg_portfolio_up / avg_benchmark_up) * 100 if avg_benchmark_up != 0 else 0
    downside_capture = (avg_portfolio_down / avg_benchmark_down) * 100 if avg_benchmark_down != 0 else 0
    capture_ratio = upside_capture / downside_capture if downside_capture > 0 else None

    # --- CÁLCULO DE CURVA DE LORENZ ---
    positive_pnl_trades = trades_df[trades_df['pnl'] > 0].sort_values(by='pnl')
    total_profit_from_winners = positive_pnl_trades['pnl'].sum()
    lorenz_data = [{'x': 0, 'y': 0}]
    if total_profit_from_winners > 0:
        cumulative_profit = 0
        num_winning_trades = len(positive_pnl_trades)
        for i, row in enumerate(positive_pnl_trades.itertuples()):
            cumulative_profit += row.pnl
            lorenz_data.append({
                'x': (i + 1) / num_winning_trades * 100,
                'y': (cumulative_profit / total_profit_from_winners) * 100
            })

    # --- PREPARAR DATOS PARA GRÁFICOS DEL FRONTEND ---
    # 1. Curva de Equity (normalizada a 100)
    first_equity_value = equity_curve['equity'].iloc[0]
    equity_chart_data = [{'x': idx.strftime('%Y-%m-%d'), 'y': (val / first_equity_value) * 100} for idx, val in equity_curve['equity'].items()]

    # 2. Curva de Benchmark (normalizada a 100 y alineada con las fechas del portafolio)
    benchmark_on_portfolio_dates = benchmark_df.reindex(equity_curve.index)
    first_valid_benchmark_price = benchmark_on_portfolio_dates['price'].bfill().iloc[0]
    benchmark_chart_data = []
    if pd.notna(first_valid_benchmark_price) and first_valid_benchmark_price > 0:
        benchmark_chart_data = [{'x': idx.strftime('%Y-%m-%d'), 'y': (val / first_valid_benchmark_price) * 100} for idx, val in benchmark_on_portfolio_dates['price'].items() if pd.notna(val)]

    # 3. Datos de dispersión de rendimientos
    scatter_data = [{'x': row.benchmark * 100, 'y': row.portfolio * 100} for row in combined_returns.itertuples()]

    # 4. Etiquetas para los gráficos (eje X)
    chart_labels = [idx.strftime('%Y-%m-%d') for idx in equity_curve.index]


    # Devolver un diccionario con todas las métricas que espera el frontend
    return {
        "profitFactor": profit_factor,
        "sortinoRatio": sortino_ratio,
        "maxDrawdown": max_drawdown,
        "monthlyAvgProfit": monthly_avg_profit,
        "maxConsecutiveLosingMonths": max_consecutive_losing_months,
        "ulcerIndexInDollars": ulcer_index_dollars, # <-- NUEVO KPI
        "upi": upi,
        "sharpeRatio": sharpe_ratio,
        "captureRatio": capture_ratio,
        "maxDrawdownInDollars": max_drawdown_dollars,
        "profitMaxDD_Ratio": profit_max_dd_ratio,
        "monthlyProfitToDollarDD": monthly_profit_to_dollar_dd,
        "winningPercentage": win_pct,
        "maxStagnationTrades": max_stagnation_trades,
        "totalTrades": total_trades,
        "maxStagnationDays": max_stagnation_days,
        "sqn": sqn,
        # Datos para gráficos
        "lorenzData": lorenz_data,
        "chartData": {
            "labels": chart_labels,
            "equityCurve": equity_chart_data,
            "benchmarkCurve": benchmark_chart_data,
            "scatterData": scatter_data
        }
    }, daily_returns # Se sigue devolviendo para la matriz de correlación


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
