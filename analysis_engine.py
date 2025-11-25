import pandas as pd
import numpy as np
from itertools import combinations

def process_strategy_data(trades_df: pd.DataFrame, benchmark_df: pd.DataFrame):
    """
    Procesa un DataFrame de trades y calcula todas las métricas de rendimiento.
    Esta es la versión en Python de la función 'processStrategyData' de analysis.js.
    """
    if trades_df.empty:
        return {}, pd.Series() # Devolver estructura vacía en lugar de None

    # Asegurarse de que las fechas son datetime objects y están en el índice
    # --- CORRECCIÓN: Convertir AMBAS columnas de fecha a datetime, pero solo si no lo son ya ---
    # El backend a veces recibe fechas como strings y otras como Timestamps. Esta línea unifica el tipo.
    
    # DEBUG LOGS
    print(f"--- [DEBUG ENGINE] Processing strategy. Rows: {len(trades_df)}")
    if not trades_df.empty:
        print(f"--- [DEBUG ENGINE] Sample Entry Date (Raw): {trades_df['entry_date'].iloc[0]}")
        print(f"--- [DEBUG ENGINE] Sample PnL (Raw): {trades_df['pnl'].iloc[0]} (Type: {type(trades_df['pnl'].iloc[0])})")

    # 1. Ensure PnL is numeric (handle commas for European format)
    if trades_df['pnl'].dtype == object:
        trades_df['pnl'] = trades_df['pnl'].astype(str).str.replace(',', '.', regex=False)
    trades_df['pnl'] = pd.to_numeric(trades_df['pnl'], errors='coerce')

    # 2. Robust Date Parsing
    for col in ['entry_date', 'exit_date']:
        # Try standard format first
        try:
            trades_df[col] = pd.to_datetime(trades_df[col], format='%Y.%m.%d %H:%M:%S', errors='raise')
        except (ValueError, TypeError):
            # Try auto-inference with dayfirst=False (default)
            try:
                trades_df[col] = pd.to_datetime(trades_df[col], errors='raise')
            except (ValueError, TypeError):
                # Try with dayfirst=True (common in EU)
                trades_df[col] = pd.to_datetime(trades_df[col], dayfirst=True, errors='coerce')

    # Check how many valid dates we have
    valid_dates = trades_df['entry_date'].notna().sum()
    print(f"--- [DEBUG ENGINE] Valid Entry Dates after parsing: {valid_dates}/{len(trades_df)}")
    
    # DEBUG: Check PnL validity
    valid_pnl = trades_df['pnl'].notna().sum()
    print(f"--- [DEBUG ENGINE] Valid PnL after parsing: {valid_pnl}/{len(trades_df)}")

    before_drop = len(trades_df)
    trades_df = trades_df.dropna(subset=['entry_date', 'exit_date', 'pnl'])
    after_drop = len(trades_df)
    
    print(f"--- [DEBUG ENGINE] Rows before drop: {before_drop}, After drop: {after_drop}")
    if after_drop == 0 and before_drop > 0:
        print("--- [DEBUG ENGINE] ⚠️ ALL ROWS DROPPED! Checking why...")
        temp_df = trades_df_original.copy() if 'trades_df_original' in locals() else trades_df # We don't have original here easily, but let's check what failed
        # Re-check logic
        pass # Just a marker
    
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
        return {}, pd.Series() # Devolver estructura vacía en lugar de None
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
    
    avg_portfolio_up = 0
    avg_benchmark_up = 0
    avg_portfolio_down = 0
    avg_benchmark_down = 0
    combined_returns = pd.DataFrame() # Initialize empty for scatter plot safety

    if not benchmark_df.empty:
        # --- CORRECCIÓN FINALÍSIMA Y ABSOLUTAMENTE DEFINITIVA ---
        # El error ocurría porque modificábamos el benchmark_df original. Si luego había un error,
        # FastAPI intentaba serializar este DF modificado con un DatetimeIndex, causando el fallo.
        # Al trabajar siempre con una copia, el DF original nunca se contamina.
        benchmark_df_copy = benchmark_df.copy()
        # --- CORRECCIÓN FINALÍSIMA Y ABSOLUTAMENTE DEFINITIVA ---
        # El formato de fecha no estándar también debe aplicarse aquí. Este era el error que faltaba.
        date_format = '%Y.%m.%d %H:%M:%S'
        # Check if 'date' column exists before accessing
        if 'date' in benchmark_df_copy.columns and 'price' in benchmark_df_copy.columns:
            benchmark_df_copy['date'] = pd.to_datetime(benchmark_df_copy['date'], format=date_format, errors='coerce')
            benchmark_df_processed = benchmark_df_copy.dropna(subset=['date', 'price']).set_index('date') # Ahora set_index funciona
            benchmark_returns = benchmark_df_processed['price'].pct_change().fillna(0)
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
    benchmark_chart_data = []
    if not benchmark_df.empty and 'date' in benchmark_df.columns and 'price' in benchmark_df.columns:
        benchmark_on_portfolio_dates = benchmark_df.set_index('date').reindex(equity_curve.index) if 'date' in benchmark_df.columns else pd.DataFrame()
        # Note: logic above is simplified, real reindexing needs proper datetime index on benchmark_df.
        # Since we processed it in the capture ratio block, we should reuse that if possible, 
        # but for safety let's just skip if empty or complex.
        pass 
        # For now, simply skip benchmark curve if we don't have a clean way to reindex without re-parsing.
        # The previous block parsed it into 'benchmark_df_processed' but it was local scope.
        # Let's just leave benchmark_chart_data empty as we removed benchmark functionality.

    # 3. Datos de dispersión de rendimientos
    scatter_data = []
    if not combined_returns.empty:
        scatter_data = [{'x': row.benchmark * 100, 'y': row.portfolio * 100} for row in combined_returns.itertuples()]

    # 4. Etiquetas para los gráficos (eje X)
    chart_labels = [idx.strftime('%Y-%m-%d') for idx in equity_curve.index]

    # Validate totalProfit before including
    # Ensure it's a finite number, not NaN or Inf
    if not np.isfinite(total_profit):
        total_profit = 0.0  # Default to 0 if invalid
    
    metrics_dict = {
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
        "totalProfit": total_profit, # <-- Added missing metric
        # Datos para gráficos
        "lorenzData": lorenz_data,
        "chartData": {
            "labels": chart_labels,
            "equityCurve": equity_chart_data,
            "benchmarkCurve": benchmark_chart_data,
            "scatterData": scatter_data
        }
    }

    # --- CORRECCIÓN IRREFUTABLE Y DEFINITIVA ---
    # El error de serialización ocurre porque algunas métricas (como las fechas de inicio/fin
    # de un drawdown) son objetos Timestamp. Antes de devolver el diccionario,
    # recorremos todas las métricas y convertimos explícitamente cualquier Timestamp a
    # una cadena de texto en formato ISO. Esto "limpia" la salida y garantiza que sea
    # 100% compatible con JSON, eliminando el error de raíz.
    for key, value in metrics_dict.items():
        if isinstance(value, pd.Timestamp):
            metrics_dict[key] = value.isoformat()

    # --- DEBUG LOG FOR USER (SURGERY) ---
    print("\n--- [METRICS SURGERY] Calculated Metrics for Strategy/Portfolio ---")
    # Filter out heavy data for logging
    debug_metrics = {k: v for k, v in metrics_dict.items() if k not in ['chartData', 'lorenzData']}
    import json # Ensure json is available here if not at top level, though it is imported in app.py. 
                # analysis_engine.py imports: pandas, numpy, itertools. Need json.
    try:
        import json
        print(json.dumps(debug_metrics, indent=2, default=str))
    except Exception as e:
        print(f"Error logging metrics: {e}")
        print(debug_metrics)
    print("-------------------------------------------------------------------\n")

    return metrics_dict, daily_returns


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
