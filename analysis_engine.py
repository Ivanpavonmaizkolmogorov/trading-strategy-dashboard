import pandas as pd
import numpy as np
from itertools import combinations

def calculate_max_margin(trades_df: pd.DataFrame, broker_config: dict = None) -> float:
    """
    Calcula el margen máximo utilizado considerando solapamientos.
    """
    if trades_df.empty or not broker_config:
        return 0.0

    default_leverage = broker_config.get('defaultLeverage', 30)
    symbols_config = broker_config.get('symbols', {})

    events = []
    
    # Iterar sobre los trades para crear eventos
    for _, trade in trades_df.iterrows():
        try:
            symbol = str(trade.get('symbol', '')).upper().replace('/', '').replace('-', '')
            # Limpieza básica del símbolo para matching
            
            # Obtener configuración del broker para el símbolo
            config = {}
            if broker_config and 'symbols' in broker_config:
                # Intento 1: Coincidencia exacta
                config = broker_config['symbols'].get(symbol, {})
                
                # Intento 2: Búsqueda difusa (si la clave está contenida en el símbolo)
                if not config:
                    for key, val in broker_config['symbols'].items():
                        if key in symbol:
                            config = val
                            break
            
            default_leverage = broker_config.get('defaultLeverage', 30) if broker_config else 30
            
            # Usar configuración o valores por defecto
            leverage = config.get('leverage', default_leverage)
            contract_size = config.get('contractSize', 100000)

            # Calcular margen inicial
            # Margin = (Lots * ContractSize * OpenPrice) / Leverage
            lots = float(trade.get('size', 0)) # 'size' usually holds lots
            
            # 'price' is usually exit price in some contexts, but here it seems mapped to 'price' (close) or 'open_price'.
            # We need OPEN PRICE.
            # In 'process_strategy_data', we are working with the raw DF.
            # utils.js maps 'open price' -> 'open_price'.
            # So we should look for 'open_price'. If not, fallback to 'price' (which might be close price, but close enough for estimation if open missing).
            price = 0.0
            if 'open_price' in trade and pd.notna(trade['open_price']):
                price = float(trade['open_price'])
            elif 'price' in trade and pd.notna(trade['price']):
                price = float(trade['price'])
            
            if price == 0: continue

            margin = (lots * contract_size * price) / leverage
            
            # Simplificación moneda cuenta (USD)
            if symbol.startswith('USD'):
                 margin = (lots * contract_size) / leverage
            
            # Eventos
            events.append({
                'time': trade['entry_date'], 
                'type': 'OPEN', 
                'amount': margin,
                'symbol': symbol,
                'lots': lots,
                'price': price,
                'leverage': leverage,
                'contract_size': contract_size
            })
            events.append({
                'time': trade['exit_date'], 
                'type': 'CLOSE', 
                'amount': margin,
                'symbol': symbol,
                'lots': lots
            })
            
        except (ValueError, TypeError):
            continue

    # Ordenar eventos
    events.sort(key=lambda x: (x['time'], 0 if x['type'] == 'OPEN' else 1))

    current_margin = 0.0
    max_margin = 0.0
    
    # Diccionario para rastrear precios recientes de pares de conversión
    latest_prices = {}
    open_trades_margin = {} # {symbol: [amount_usd_1, amount_usd_2]}

    # Log de eventos para debug
    debug_log = []
    debug_log.append(f"Calculation Start. Trades: {len(trades_df)}. Config: {list(broker_config.keys()) if broker_config else 'None'}")

    for event in events:
        # Actualizar precio conocido si es un evento OPEN
        if event['type'] == 'OPEN':
            # Simplificación: Asumimos que el símbolo contiene el par (ej. USDJPY)
            # Guardamos el precio para usarlo en conversiones
            latest_prices[event['symbol']] = event['price']
            
            # Lógica de Conversión a USD
            margin_usd = event['amount']
            conversion_rate = 1.0
            conversion_pair = "USD"
            quote_currency = event.get('quote_currency', 'USD')
            
            symbol = event['symbol']
            
            # 1. Pares que terminan en USD (ej. EURUSD, XAUUSD) -> Ya están en USD
            if symbol.endswith('USD') or 'USD_' in symbol: # 'USD_' por si hay sufijos
                pass
            
            # 2. Pares que empiezan con USD (ej. USDJPY, USDCAD) -> Margen en Moneda Cotizada (JPY, CAD)
            # Necesitamos dividir por el precio del par (ej. USDJPY)
            elif symbol.startswith('USD'):
                # El margen calculado previamente para pares USDxxx era (Lots * CS) / Lev
                # Esto asume que el margen se pide en la moneda base (USD).
                # VERIFICACIÓN:
                # Si tengo 1 lote de USDJPY. Valor nocional = 100,000 USD.
                # Margen requerido = 100,000 / 30 = 3,333.33 USD.
                # MI CÓDIGO ANTERIOR YA HACÍA ESTO:
                # if symbol.startswith('USD'): margin = (lots * contract_size) / leverage
                # Por lo tanto, para pares USDxxx, el margen YA ESTÁ EN USD.
                pass
                
            # 3. Pares Cruzados o que terminan en otra moneda (ej. GBPJPY, EURGBP)
            # El margen base suele ser en la moneda BASE del par.
            # Ej. GBPJPY -> Margen en GBP.
            # Necesitamos convertir GBP a USD.
            else:
                # Identificar moneda base (asumiendo 3 letras estándar al inicio)
                base_currency = symbol[:3]
                
                # Caso especial: GBPJPY -> Base GBP. Necesitamos GBPUSD.
                if base_currency == 'GBP':
                    # Buscar precio de GBPUSD
                    # Intentamos buscar claves que contengan GBPUSD
                    rate = 0.0
                    for k, v in latest_prices.items():
                        if 'GBPUSD' in k:
                            rate = v
                            break
                    
                    if rate > 0:
                        margin_usd = event['amount'] * rate
                        conversion_rate = rate
                        conversion_pair = "GBPUSD"
                    else:
                        # Fallback si no tenemos precio reciente (usar estático aprox o dejar igual y loguear warning)
                        # Asumimos 1.5 como fallback conservador o dejamos igual
                        # El usuario prefiere conversión.
                        margin_usd = event['amount'] * 1.3 # Aprox histórico
                        conversion_rate = 1.3
                        conversion_pair = "Fallback(1.3)"

                # Caso especial: EURJPY -> Base EUR. Necesitamos EURUSD.
                elif base_currency == 'EUR':
                     # Buscar precio de EURUSD
                    rate = 0.0
                    for k, v in latest_prices.items():
                        if 'EURUSD' in k:
                            rate = v
                            break
                    
                    if rate > 0:
                        margin_usd = event['amount'] * rate
                        conversion_rate = rate
                        conversion_pair = "EURUSD"
                    else:
                        margin_usd = event['amount'] * 1.1 # Aprox histórico
                        conversion_rate = 1.1
                        conversion_pair = "Fallback(1.1)"
                
                # Caso 4: Otros (AUD, CAD, CHF, NZD)
                # Intento genérico: Buscar QuoteUSD o USDQuote
                else:
                    # Try to find QuoteUSD (e.g., AUDUSD)
                    rate = 0.0
                    target_pair_key = f"{quote_currency}USD"
                    for k, v in latest_prices.items():
                        if target_pair_key in k:
                            rate = v
                            break
                    
                    if rate > 0:
                        margin_usd = event['amount'] * rate
                        conversion_rate = rate
                        conversion_pair = f"{target_pair_key} (Mult)"
                    else:
                        # Try to find USDQuote (e.g., USDCAD) - this would mean dividing
                        target_pair_key = f"USD{quote_currency}"
                        for k, v in latest_prices.items():
                            if target_pair_key in k:
                                rate = v
                                break
                        if rate > 0:
                            margin_usd = event['amount'] / rate
                            conversion_rate = rate
                            conversion_pair = f"{target_pair_key} (Div)"
                        else:
                            # Final fallback
                            margin_usd = event['amount'] * 1.0 # Assume 1:1 if no rate found
                            conversion_rate = 1.0
                            conversion_pair = f"Fallback(1.0) for {quote_currency}"


            # Guardar margen convertido para liberarlo después
            if symbol not in open_trades_margin:
                open_trades_margin[symbol] = []
            open_trades_margin[symbol].append(margin_usd)
            
            current_margin += margin_usd
            if current_margin > max_margin:
                max_margin = current_margin
            
            log_msg = (f"[{event['time']}] OPEN {event['symbol']} {event['lots']:.2f} lots @ {event['price']:.5f} "
                       f"(Lev: {event['leverage']}, CS: {event['contract_size']}) -> "
                       f"Margin: {event['amount']:.2f} {quote_currency} ({conversion_pair}: {conversion_rate:.4f}) -> USD: {margin_usd:.2f} | "
                       f"Total: {current_margin:.2f} (Max: {max_margin:.2f})")
            debug_log.append(log_msg)
            
        else: # CLOSE
            # Recuperar el margen USD que se reservó
            amount_usd = 0.0
            if symbol in open_trades_margin and open_trades_margin[symbol]:
                amount_usd = open_trades_margin[symbol].pop(0) # FIFO
            else:
                # Fallback si algo falla en el orden (no debería)
                amount_usd = event['amount'] 
            
            current_margin -= amount_usd
            if current_margin < 0: current_margin = 0
            
            log_msg = (f"[{event['time']}] CLOSE {event['symbol']} {event['lots']:.2f} lots -> "
                       f"Released: {amount_usd:.2f} | Total: {current_margin:.2f}")
            debug_log.append(log_msg)

    return max_margin, debug_log

    return max_margin, debug_log

def calculate_beta_moments(data: pd.Series) -> float:
    """
    Calculates the Beta (Rate) parameter of a Gamma distribution using Method of Moments.
    Beta = Mean / Variance
    """
    if len(data) < 2: return 0.0
    mean = data.mean()
    var = data.var()
    if var == 0 or mean == 0: return 0.0
    return mean / var

def calculate_gamma_flow_score(trades_df: pd.DataFrame) -> float:
    """
    Calculates the Gamma Flow Score (GFS).
    GFS = (Beta_TP / Beta_SL) * (AvgWin / |AvgLoss|)
    """
    if trades_df.empty: return 0.0

    # 1. Identify TP and SL trades
    # Robust logic similar to frontend 'getCat'
    # Use 'close type' or 'exit_reason' if available, fallback to 'comment'
    
    # Ensure columns exist and fill NaN
    comments = trades_df['comment'].fillna('').astype(str).str.lower() if 'comment' in trades_df.columns else pd.Series([''] * len(trades_df))
    reasons = pd.Series([''] * len(trades_df))
    
    if 'close type' in trades_df.columns:
        reasons = trades_df['close type'].fillna('').astype(str).str.lower()
    elif 'exit_reason' in trades_df.columns:
        reasons = trades_df['exit_reason'].fillna('').astype(str).str.lower()

    # Vectorized logic for categorization
    # TP: reason has 'tp', 'take', 'pt' OR comment has 'tp', 'take profit'
    is_tp = (reasons.str.contains('tp|take|pt', regex=True)) | (comments.str.contains('tp|take profit', regex=True))
    
    # SL: reason has 'sl', 'stop' AND NOT 'trailing' OR comment has 'sl', 'stop loss' AND NOT 'trailing'
    # Important: Check Exclusions!
    # Wait, frontend logic prioritized Trailing.
    # If it is Trailing, it is NOT TP and NOT SL (for this score specifically).
    # GFS spec specifically mentions TP vs SL. Trailing stops might be considered 'Quality' exits, 
    # but strictly speaking, Beta_SL usually refers to 'Bad' stops.
    # User's definition: "Gamma of times between Take Profits" vs "Gamma of times between Stop Losses".
    # I will stick to strict TP and SL.
    
    is_trailing = (reasons.str.contains('trailing', regex=True)) | (comments.str.contains('trailing', regex=True))
    is_sl = ((reasons.str.contains('sl|stop', regex=True)) | (comments.str.contains('sl|stop loss', regex=True))) & (~is_trailing)

    tp_trades = trades_df[is_tp].sort_values('exit_date')
    sl_trades = trades_df[is_sl].sort_values('exit_date')

    # 2. Calculate Betas (Rate of arrivals)
    # We need Inter-Arrival Times in DAYS
    # "Time between TPs": ExitTime[i] - ExitTime[i-1]
    
    # Helper for inter-event times in days
    def get_inter_times(df):
        if len(df) < 2: return pd.Series(dtype=float)
        # diff() of exit_date gives Timedelta
        diffs = df['exit_date'].diff().dropna()
        # Convert to days (float)
        return diffs.dt.total_seconds() / (24 * 3600)

    beta_tp = calculate_beta_moments(get_inter_times(tp_trades))
    beta_sl = calculate_beta_moments(get_inter_times(sl_trades))

    # 3. Calculate Payoff
    # Avg Win $ / Avg Loss $ (abs)
    # Note: Using ALL winning/losing trades for Payoff, or just TP/SL?
    # Spec says "Avg Win $ of winning trades" and "Avg Loss $ of losing trades".
    # This usually implies all winners/losers, not just those hit by TP/SL.
    # But usually TP trades are winners and SL trades are losers.
    # I will use ALL trades for robustness of Expected Value.
    
    avg_win = trades_df[trades_df['pnl'] > 0]['pnl'].mean()
    avg_loss = abs(trades_df[trades_df['pnl'] < 0]['pnl'].mean())

    if pd.isna(avg_win): avg_win = 0.0
    if pd.isna(avg_loss) or avg_loss == 0: avg_loss = 1.0 # Avoid division by zero, though GFS=Inf is valid conceptually

    payoff = avg_win / avg_loss

    # 4. GFS Formula
    # Avoid div by zero for beta_sl
    # If beta_sl is 0 (no SLs or only 1 SL), GFS should be very high (Zen).
    # Let's cap beta_sl at a small epsilon if 0.
    
    effective_beta_sl = beta_sl if beta_sl > 0 else 0.001
    
    gfs = (beta_tp / effective_beta_sl) * payoff

    # Return components for debug
    return gfs, beta_tp, beta_sl

def process_strategy_data(trades_df: pd.DataFrame, benchmark_df: pd.DataFrame, broker_config: dict = None):
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
    # print(f"--- [DEBUG ENGINE] Processing strategy. Rows: {len(trades_df)}")
    # if not trades_df.empty:
    #     print(f"--- [DEBUG ENGINE] Sample Entry Date (Raw): {trades_df['entry_date'].iloc[0]}")
    #     print(f"--- [DEBUG ENGINE] Sample PnL (Raw): {trades_df['pnl'].iloc[0]} (Type: {type(trades_df['pnl'].iloc[0])})")

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
    # print(f"--- [DEBUG ENGINE] Valid Entry Dates after parsing: {valid_dates}/{len(trades_df)}")
    
    # DEBUG: Check PnL validity
    valid_pnl = trades_df['pnl'].notna().sum()
    # print(f"--- [DEBUG ENGINE] Valid PnL after parsing: {valid_pnl}/{len(trades_df)}")

    before_drop = len(trades_df)
    trades_df = trades_df.dropna(subset=['entry_date', 'exit_date', 'pnl'])
    after_drop = len(trades_df)
    
    # print(f"--- [DEBUG ENGINE] Rows before drop: {before_drop}, After drop: {after_drop}")
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

    # 3. Calcular Sharpe Ratio (TRADE - Ahora secundario)
    sharpe_ratio_trade = 0
    if trade_returns.std() > 0:
        # (Retorno medio por trade / Desviación estándar de los retornos por trade) * sqrt(Trades por año)
        sharpe_ratio_trade = (trade_returns.mean() / trade_returns.std()) * annualization_factor

    # 3b. Calcular Sharpe Ratio (TIME/DAILY - Ahora el principal)
    sharpe_ratio_time = 0
    daily_returns_series = equity_curve['equity'].pct_change().fillna(0)
    if daily_returns_series.std() > 0:
        # Asumiendo 252 días de trading al año
        sharpe_ratio_time = (daily_returns_series.mean() / daily_returns_series.std()) * np.sqrt(252)

    # 3c. Calcular Sharpe Ratio (MONTHLY - Para comparación con SQX)
    sharpe_ratio_monthly = 0
    monthly_returns_series = equity_curve['equity'].resample('M').last().pct_change().fillna(0)
    if monthly_returns_series.std() > 0:
        # Asumiendo 12 meses al año
        sharpe_ratio_monthly = (monthly_returns_series.mean() / monthly_returns_series.std()) * np.sqrt(12)

    # 3d. Calcular Sharpe Simple (CAGR / Volatilidad Anualizada)
    # Hipótesis: SQX usa esta fórmula simple.
    sharpe_simple = 0
    # Nota: cagr ya se calcula más abajo, pero lo necesitamos aquí.
    # Vamos a mover el cálculo de CAGR antes de Sharpe o recalcularlo temporalmente.
    # Mejor movemos el bloque de UPI/CAGR antes de Sharpe.
    # O simplemente calculamos CAGR aquí de nuevo para no romper la estructura.
    
    # Cálculo temporal de CAGR para Sharpe Simple
    temp_cagr = 0
    if initial_capital > 0 and equity_curve['equity'].iloc[-1] > 0 and duration_years > 0:
        final_eq = equity_curve['equity'].iloc[-1]
        if duration_years < 1.0:
            temp_cagr = ((final_eq / initial_capital) - 1) / duration_years
        else:
            temp_cagr = ((final_eq / initial_capital)**(1/duration_years)) - 1
    
    annualized_volatility = daily_returns_series.std() * np.sqrt(252)
    if annualized_volatility > 0:
        sharpe_simple = temp_cagr / annualized_volatility

    # 3e. Calcular Sharpe Anual (Basado en retornos anuales)
    # Hipótesis 2: SQX usa el promedio de retornos anuales / std anual.
    sharpe_annual = 0
    # Usamos 'YE' (Year End) si pandas es muy nuevo, o 'Y' si es viejo. El warning decía usar 'ME' para meses.
    # Probaremos 'YE' para evitar warnings futuros, o 'Y' con fallback.
    try:
        annual_returns = equity_curve['equity'].resample('YE').last().pct_change().fillna(0)
    except ValueError:
        annual_returns = equity_curve['equity'].resample('Y').last().pct_change().fillna(0)
        
    if annual_returns.std() > 0:
        sharpe_annual = annual_returns.mean() / annual_returns.std()

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

    # --- CÁLCULO DE PÉRDIDAS CONSECUTIVAS (Para Health Monitoring) ---
    # Necesario para comparar con cuentas live de Myfxbook
    # print(f"--- [DEBUG ENGINE] Calculating consecutive losses from {total_trades} trades")
    
    max_consecutive_losses = 0
    current_consecutive_losses = 0
    max_consecutive_wins = 0
    current_consecutive_wins = 0
    current_streak_is_loss = False  # Track if currently in a losing streak
    
    # Ordenar trades cronológicamente por exit_date
    for idx, trade in trades_df_sorted.iterrows():
        pnl = trade['pnl']
        
        if pnl < 0:  # Losing trade
            current_consecutive_losses += 1
            current_consecutive_wins = 0  # Reset wins
            current_streak_is_loss = True
            
            if current_consecutive_losses > max_consecutive_losses:
                max_consecutive_losses = current_consecutive_losses
                # print(f"--- [DEBUG ENGINE] New max consecutive losses: {max_consecutive_losses} (at date: {trade['exit_date']})")
        
        else:  # Winning trade (pnl >= 0, breakeven counts as win)
            current_consecutive_wins += 1
            current_consecutive_losses = 0  # Reset losses
            current_streak_is_loss = False
            
            if current_consecutive_wins > max_consecutive_wins:
                max_consecutive_wins = current_consecutive_wins
    
    # Current streak (for live monitoring)
    current_streak_count = current_consecutive_losses if current_streak_is_loss else current_consecutive_wins
    current_streak_type = "loss" if current_streak_is_loss else "win"
    
    # print(f"--- [DEBUG ENGINE] Max Consecutive Losses (Historic): {max_consecutive_losses}")
    # print(f"--- [DEBUG ENGINE] Max Consecutive Wins (Historic): {max_consecutive_wins}")
    # print(f"--- [DEBUG ENGINE] Current Streak: {current_streak_count} {current_streak_type}s")

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
    max_stagnation_start = None
    max_stagnation_end = None
    
    if not equity_curve.empty:
        last_peak_date = equity_curve.index[0]
        for current_date, current_equity in equity_curve['equity'].items():
            if current_equity >= equity_curve['equity'].loc[last_peak_date]:
                last_peak_date = current_date
            
            stagnation_days = (current_date - last_peak_date).days
            if stagnation_days > max_stagnation_days:
                max_stagnation_days = stagnation_days
                max_stagnation_start = last_peak_date
                max_stagnation_end = current_date

    # --- CÁLCULO DE SQN (SYSTEM QUALITY NUMBER) ---
    # CORRECCIÓN: Usar % de retorno por trade en lugar de PnL en dólares para evitar distorsión por interés compuesto
    # CORRECCIÓN 2: Limitar N a 100 (Estándar Van Tharp / SQX) para no inflar el SQN con muchos trades.
    # CORRECCIÓN 3: Usar desviación estándar poblacional (ddof=0) en lugar de muestral (ddof=1) para coincidir con SQX
    avg_trade_ret = trade_returns.mean()
    std_trade_ret = trade_returns.std(ddof=0)  # Desviación poblacional
    sqn = 0
    if std_trade_ret > 0 and total_trades > 0:
        n_capped = min(total_trades, 100)
        sqn = (avg_trade_ret / std_trade_ret) * np.sqrt(n_capped)

    # Calculate Max Margin Required
    max_margin_required = calculate_max_margin(trades_df, broker_config)

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
    # CORRECCIÓN: Normalizar respecto al capital inicial, no al primer valor de la serie (que puede incluir PnL del primer día).
    # Esto asegura que 100 = Capital Inicial, y el frontend pueda desnormalizar correctamente.
    equity_chart_data = [{'x': idx.strftime('%Y-%m-%d'), 'y': (val / initial_capital) * 100} for idx, val in equity_curve['equity'].items()]

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
    
    # Calculate GFS
    gfs, beta_tp, beta_sl = calculate_gamma_flow_score(trades_df)

    metrics_dict = {
        "profitFactor": profit_factor,
        "sortinoRatio": sortino_ratio,
        "maxDrawdown": max_drawdown,
        "maxDrawdown": max_drawdown,
        "maxMarginRequired": max_margin_required[0] if isinstance(max_margin_required, tuple) else max_margin_required,
        "maxMarginLog": max_margin_required[1] if isinstance(max_margin_required, tuple) else [],
        "monthlyAvgProfit": monthly_avg_profit,
        "monthlyAvgProfit": monthly_avg_profit,
        "maxConsecutiveLosingMonths": max_consecutive_losing_months,
        "ulcerIndexInDollars": ulcer_index_dollars, 
        "upi": upi,
        "sharpeRatio": sharpe_simple,
        "sharpeRatioDaily": sharpe_ratio_time,
        "sharpeRatioTrade": sharpe_ratio_trade,
        "sharpeRatioMonthly": sharpe_ratio_monthly,
        "sharpeRatioAnnual": sharpe_annual,
        "annualizedVolatility": annualized_volatility,
        "captureRatio": capture_ratio,
        "maxDrawdownInDollars": max_drawdown_dollars,
        "profitMaxDD_Ratio": profit_max_dd_ratio,
        "monthlyProfitToDollarDD": monthly_profit_to_dollar_dd,
        "winningPercentage": win_pct,
        "maxStagnationTrades": max_stagnation_trades,
        "totalTrades": total_trades,
        "maxStagnationDays": max_stagnation_days,
        "maxStagnationStart": max_stagnation_start,
        "maxStagnationEnd": max_stagnation_end,
        "sqn": sqn,
        "totalProfit": total_profit,
        "cagr": cagr,
        # GFS Metrics
        "gammaFlowScore": gfs,
        "betaTP": beta_tp,
        "betaSL": beta_sl,
        # Health Monitoring Metrics (for Myfxbook comparison)
        "maxConsecutiveLosses": max_consecutive_losses,
        "maxConsecutiveWins": max_consecutive_wins,
        "currentStreakCount": current_streak_count,
        "currentStreakType": current_streak_type,
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
    # print("\n--- [METRICS SURGERY] Calculated Metrics for Strategy/Portfolio ---")
    # # Filter out heavy data for logging
    # debug_metrics = {k: v for k, v in metrics_dict.items() if k not in ['chartData', 'lorenzData']}
    # import json # Ensure json is available here if not at top level, though it is imported in app.py. 
    #             # analysis_engine.py imports: pandas, numpy, itertools. Need json.
    # try:
    #     import json
    #     # print(json.dumps(debug_metrics, indent=2, default=str))
    # except Exception as e:
    #     print(f"Error logging metrics: {e}")
    #     # print(debug_metrics)
    # print("-------------------------------------------------------------------\n")

    # print(f"DEBUG: process_strategy_data returning metrics. Keys: {list(metrics_dict.keys())}")
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
