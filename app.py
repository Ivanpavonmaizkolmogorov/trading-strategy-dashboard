from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel
from typing import List, Dict, Any, Optional, Union
import json
import asyncio, traceback, os
import pandas as pd
import numpy as np
import random

# Importar nuestro nuevo motor de análisis
from analysis_engine import process_strategy_data, get_combinations, add_to_databank_if_better, count_combinations, calculate_metrics_for_period

# --- Utils ---
def sanitize_floats(obj):
    if isinstance(obj, float):
        if not np.isfinite(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: sanitize_floats(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_floats(v) for v in obj]
    if isinstance(obj, tuple):
        return tuple(sanitize_floats(v) for v in obj)
    return obj

def calculate_portfolio_correlation(indices_a, indices_b, correlation_matrix):
    """Calculates correlation between two portfolios assuming equal weights."""
    try:
        if not indices_a or not indices_b: return 0.0
        # Ensure list of ints
        idx_a = [int(i) for i in indices_a]
        idx_b = [int(i) for i in indices_b]
        
        # Variances
        var_a = np.sum(correlation_matrix.iloc[idx_a, idx_a].values)
        var_b = np.sum(correlation_matrix.iloc[idx_b, idx_b].values)
        
        # Covariance
        cov_ab = np.sum(correlation_matrix.iloc[idx_a, idx_b].values)
        
        denom = np.sqrt(var_a) * np.sqrt(var_b)
        if denom == 0: return 0.0
        return float(cov_ab / denom)
    except Exception as e:
        print(f"Error calc correlation: {e}")
        return 0.0



# --- Modelos de Datos (Pydantic) ---
class Trade(BaseModel):
    # --- CORRECCIÓN FINALÍSIMA Y DEFINITIVA ---
    # El problema raíz era que Pydantic intentaba convertir las fechas (strings) a objetos datetime
    # al recibir la petición. Si luego ocurría CUALQUIER error, FastAPI intentaba serializar
    # el request original (ahora con Timestamps) y fallaba. Al definir las fechas como 'str',
    # Pydantic no las toca, eliminando el problema de raíz.
    entry_date: Optional[str] = None
    exit_date: Optional[str] = None
    pnl: Optional[Union[float, str]] = None # Allow string for "1,20"

    class Config:
        extra = 'allow'
        # --- CORRECCIÓN FINALÍSIMA Y ABSOLUTAMENTE DEFINITIVA (v2) ---
        # Sobrescribimos la función de parseo JSON para Pydantic para que use la estándar,
        # lo que deshabilita la conversión automática de strings de fecha a objetos datetime.
        json_loads = json.loads

class DatabankParams(BaseModel):
    metric_to_optimize_key: str
    optimization_goal: str
    correlation_threshold: float
    max_size: int
    min_size: Optional[int] = 1  # Added: minimum portfolio size
    base_indices: List[int]
    reference_indices: Optional[List[int]] = []
    reference_portfolios: Optional[List[List[int]]] = [] # New: Multi-Satellite support
    satellite_correlation_threshold: Optional[float] = 0.90
    allowed_indices: Optional[List[int]] = []
    objective: Optional[str] = 'search' # 'search', 'satellite', 'lab'

    metric_name: str
    search_threshold: int
    search_method: Optional[str] = 'auto'
    normalization_metric: Optional[str] = None
    normalization_target: Optional[float] = None
    cagr_scaling_metric: Optional[str] = None
    cagr_scaling_operator: Optional[str] = 'multiply'
    re_shuffle_interval: Optional[int] = 5000
    use_all_dates: Optional[bool] = True  # Added for date filtering
    start_date: Optional[str] = None      # Added for date filtering
    end_date: Optional[str] = None        # Added for date filtering
    creation_filter: Optional[Dict[str, Any]] = None # Added: creation filter pass-through


class DatabankRequest(BaseModel):
    strategy_names: List[str] # <-- Añadimos los nombres de las estrategias
    strategies_data: List[Union[List[Trade], str]]
    benchmark_data: Optional[List[Dict[str, Any]]] = None
    params: DatabankParams

class PortfolioDefinition(BaseModel):
    indices: List[int]
    weights: Optional[List[float]] = None
    # Añadimos campos para identificar el portafolio en el frontend
    is_saved_portfolio: bool = False
    saved_index: Optional[int] = None
    portfolio_id: Optional[Union[int, str]] = None
    is_current_portfolio: bool = False
    is_databank_portfolio: bool = False
    databank_index: Optional[int] = None
    # --- CORRECCIÓN DEFINITIVA: Añadir los campos de normalización que faltaban ---
    is_risk_normalized: Optional[bool] = False
    normalization_metric: Optional[str] = None
    normalization_target_value: Optional[float] = None
    # --- NUEVO: Configuración de riesgo manual por estrategia ---
    risk_per_strategy: Optional[List[float]] = None


class FullAnalysisRequest(BaseModel): # Contenido movido a PortfolioDefinition
    strategies_data: List[List[Trade]]
    benchmark_data: Optional[List[Dict[str, Any]]] = None
    is_risk_normalized: Optional[bool] = False
    normalization_metric: Optional[str] = None
    normalization_target_value: Optional[float] = None
    portfolios_to_analyze: Optional[List[PortfolioDefinition]] = None

class OptimizationParams(BaseModel):
    num_simulations: int
    target_metric: str
    target_goal: str
    min_weight: float
    metrics_for_balance: List[str]

class OptimizationRequest(BaseModel):
    portfolio_indices: List[int]
    strategies_data: List[List[Trade]]
    benchmark_data: Optional[List[Dict[str, Any]]] = None
    params: OptimizationParams
    is_risk_normalized: bool = False
    normalization_metric: Optional[str] = None
    normalization_target_value: Optional[float] = None


class CorrelationRequest(BaseModel):
    portfolio_indices: List[int] # Indices of strategies to analyze
    strategies_data: List[List[Trade]]
    start_date: Optional[str] = None # Optional date filter
    end_date: Optional[str] = None


# --- Codificador JSON Personalizado y Robusto ---
class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (np.integer, np.int64)):
            return int(obj)
        if isinstance(obj, (np.floating, np.float64)):
            # Si es NaN o Inf, lo convertimos a None (null en JSON)
            if not np.isfinite(obj):
                return None
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, tuple):
            return list(obj)
        # --- CORRECCIÓN: Añadir manejo para objetos Timestamp de pandas ---
        if isinstance(obj, pd.Timestamp):
            return obj.isoformat() # Convertir a string en formato ISO 8601
        return super(CustomJSONEncoder, self).default(obj)

# --- Configuración de la App FastAPI ---
app = FastAPI()

origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- SERVIR EL FRONTEND ---
# Montamos los directorios 'src' y 'assets' para que FastAPI los sirva.
app.mount("/src", StaticFiles(directory="src"), name="src")
if os.path.isdir("assets"):
    app.mount("/assets", StaticFiles(directory="assets"), name="assets")

# Ruta principal que sirve el index.html
@app.get("/")
async def read_index():
    # Asegurarse de que el archivo index.html exista en la raíz del proyecto.
    return FileResponse('index.html')

# --- Endpoints de la API ---
@app.get("/")
def read_root():
    return {"message": "¡Hola! El backend de Python está funcionando."}

@app.post("/analysis/full")
async def get_full_analysis(request: FullAnalysisRequest):
    """
    Recibe estrategias y definiciones de portafolios, y devuelve todos los análisis.
    """
    print("\n--- Endpoint /analysis/full HIT ---")
    try:
        # Helper para limpiar números
        def clean_number(val):
            if val is None: return None
            if isinstance(val, (int, float)): return val
            if isinstance(val, str):
                val = val.strip()
                if not val: return None
                try:
                    # Manejo de formatos: 1.234,56 (EU) vs 1,234.56 (US)
                    if '.' in val and ',' in val:
                        if val.rfind(',') > val.rfind('.'): # Último separador es coma (EU)
                            val = val.replace('.', '').replace(',', '.')
                        else: # Último separador es punto (US)
                            val = val.replace(',', '')
                    elif ',' in val:
                        # Asumimos coma como decimal si no hay puntos
                        val = val.replace(',', '.')
                    return float(val)
                except ValueError:
                    return None
            return None

        # Procesar manualmente para convertir strings
        strategies_data = []
        for strat in request.strategies_data:
            strat_trades = []
            for trade in strat:
                t_dict = trade.model_dump()
                
                # Limpiar PnL
                t_dict['pnl'] = clean_number(t_dict.get('pnl'))
                
                if t_dict.get('pnl') is not None:
                    strat_trades.append(t_dict)
            strategies_data.append(strat_trades)

        benchmark_data_df = pd.DataFrame(request.benchmark_data)
        print(f"Received {len(strategies_data)} strategies and benchmark with {len(benchmark_data_df)} rows.")

        # --- CORRECCIÓN ARQUITECTURAL CLAVE ---
        # 1. Pre-procesar todas las estrategias y guardar sus DataFrames de trades.
        processed_strategy_dfs = []
        for i, strat_trades in enumerate(strategies_data):
            print(f"  Processing strategy {i+1}/{len(strategies_data)}...")
            trades_df = pd.DataFrame(strat_trades) if strat_trades else pd.DataFrame()
            if trades_df.empty:
                # --- CORRECCIÓN DE DEPURACIÓN ---
                # Si un DF está vacío, no podemos procesarlo. Lo añadimos como placeholder
                # para no romper los índices.
                print(f"  -> Strategy {i+1} has no trades. Skipping.")
                processed_strategy_dfs.append(pd.DataFrame()) # Añadir DF vacío como placeholder
                continue
            
            processed_strategy_dfs.append(trades_df) # Guardar el DF procesado SIN escalar

        # 2. Analizar las estrategias individuales (con posible escalado global)
        # --- CORRECCIÓN CLAVE: Separar los resultados de estrategias y portafolios ---
        strategy_analysis_results = []
        for i, strat_df in enumerate(processed_strategy_dfs):
            trades_to_analyze_df = strat_df.copy()
            # Aplicar normalización global SOLO a las estrategias individuales
            if request.is_risk_normalized and request.normalization_target_value and request.normalization_target_value > 0 and not trades_to_analyze_df.empty:
                # Usamos strat_df (original) para el pre-análisis
                pre_analysis_result = process_strategy_data(strat_df.copy(), benchmark_data_df.copy())
                if pre_analysis_result:
                    metric_key = 'maxDrawdownInDollars' if request.normalization_metric == 'max_dd' else 'ulcerIndexInDollars'
                    current_metric_value = pre_analysis_result[0].get(metric_key, 0)
                    if current_metric_value > 0:
                        scale_factor = request.normalization_target_value / current_metric_value
                        # Y aplicamos el escalado a la copia que se va a analizar
                        trades_to_analyze_df['pnl'] *= scale_factor
            
            analysis_result = process_strategy_data(trades_to_analyze_df, benchmark_data_df.copy())
            strategy_analysis_results.append(analysis_result[0] if analysis_result and analysis_result[0] else None)
            print(f"  -> Strategy {i+1} analysis complete.")
        
        # --- NUEVO: Analizar los portafolios solicitados ---
        portfolio_analysis_results = []
        if request.portfolios_to_analyze:
            print(f"--- Analyzing {len(request.portfolios_to_analyze)} requested portfolios ---")
            for p_idx, p_def in enumerate(request.portfolios_to_analyze):
                print(f"\n[BACKEND-LOG] 2.{p_idx} Procesando portafolio (saved_index: {p_def.saved_index}, is_current: {p_def.is_current_portfolio}, is_databank: {p_def.is_databank_portfolio})")
                portfolio_trades = []
                # CORRECCIÓN CRÍTICA: NO aplicar pesos cuando se combinan estrategias completas.
                # Los pesos solo se usan en la optimización de pesos (endpoint diferente).
                # Al combinar estrategias, simplemente concatenamos todos los trades tal como están.
                # Esto permite que los valores absolutos (Net Profit, Max DD $, etc.) sean correctos.
                
                for i, strat_idx in enumerate(p_def.indices):
                    if strat_idx < len(processed_strategy_dfs):
                        strat_df_original = processed_strategy_dfs[strat_idx]
                        if not strat_df_original.empty:
                            strat_df_copy = strat_df_original[strat_df_original['pnl'].notna()].copy()
                            
                            # --- LÓGICA DE RIESGO MANUAL ---
                            # Si se proporciona configuración de riesgo, escalamos los trades.
                            if p_def.risk_per_strategy and i < len(p_def.risk_per_strategy):
                                risk_val = p_def.risk_per_strategy[i]
                                if risk_val is not None and risk_val > 0:
                                    scale_factor = risk_val / 100.0
                                    strat_df_copy['pnl'] *= scale_factor
                                    if 'size' in strat_df_copy.columns:
                                        strat_df_copy['size'] *= scale_factor
                            
                            # --- APLICAR PESOS SI EXISTEN ---
                            # Si el portafolio tiene pesos definidos (ej. optimización o edición manual),
                            # debemos escalar tanto el PnL como el tamaño (lots) para que el margen sea correcto.
                            if p_def.weights and i < len(p_def.weights):
                                weight = p_def.weights[i]
                                if weight is not None:
                                    strat_df_copy['pnl'] *= weight
                                    if 'size' in strat_df_copy.columns:
                                        strat_df_copy['size'] *= weight

                            portfolio_trades.append(strat_df_copy)

                portfolio_df = pd.concat(portfolio_trades, ignore_index=True) if portfolio_trades else pd.DataFrame()
                trades_to_analyze_df = portfolio_df.copy() # Empezamos con una copia

                print(f"  [BACKEND-LOG] 2.{p_idx}.a -> Normalización Recibida: is_risk_normalized={p_def.is_risk_normalized}, metric='{p_def.normalization_metric}', value={p_def.normalization_target_value}")

                # Initialize risk_per_strategy variable for this portfolio
                risk_per_strategy = None
                is_risk_normalized_for_portfolio = False

                # --- LÓGICA DE NORMALIZACIÓN CORREGIDA: Se aplica por portafolio ---
                if p_def.is_risk_normalized and p_def.normalization_target_value and p_def.normalization_target_value > 0:
                    is_risk_normalized_for_portfolio = True
                    print(f"  [BACKEND-LOG] 2.{p_idx}.b -> ✅ ENTRANDO en bloque de normalización.")
                    # --- CORRECCIÓN FINALÍSIMA: Usar 'portfolio_df' (los trades combinados originales) para el pre-análisis ---
                    if not portfolio_df.empty:
                        pre_analysis_result = process_strategy_data(portfolio_df.copy(), benchmark_data_df.copy()) 
                        if pre_analysis_result:
                            # Determinar qué métrica usar para la normalización desde los resultados del pre-análisis
                            metric_key = 'maxDrawdownInDollars' if p_def.normalization_metric == 'max_dd' else 'ulcerIndexInDollars'
                            current_metric_value = pre_analysis_result[0].get(metric_key, 0)

                            print(f"    [BACKEND-LOG] Métrica: '{metric_key}', Valor Actual: {current_metric_value:.2f}, Valor Objetivo: {p_def.normalization_target_value:.2f}")
                            if current_metric_value > 0:
                                scale_factor = p_def.normalization_target_value / current_metric_value
                                print(f"    [BACKEND-LOG] -> 🔥 Aplicando Factor de Escala: {scale_factor:.4f}")
                                # --- CORRECCIÓN CRÍTICA Y DEFINITIVA ---
                                # Forzamos una copia profunda para evitar el SettingWithCopyWarning y asegurar la modificación.
                                # En lugar de 'in-place' ( *= ), asignamos el resultado a la columna.
                                # Esto es más robusto contra los problemas de 'SettingWithCopyWarning' de pandas.
                                trades_to_analyze_df['pnl'] = trades_to_analyze_df['pnl'] * scale_factor
                                
                                # Calculate implied risk per strategy
                                # Standard Risk = $100. New Risk = $100 * Factor.
                                # We assume all strategies contributed equally or were scaled equally.
                                # The risk viewer expects an array of risk values per strategy.
                                # Since we apply global scaling to the combined dataframe, effectively each strategy's risk is scaled by scale_factor.
                                # But we need to know the 'base' risk. Usually 100 per strategy.
                                # If the portfolio had 'weights', that should have been handled before? 
                                # In this flow (Full Analysis), we usually just Sum PnL.
                                # If 'weights' were passed, they were applied in line 285. 
                                # If line 285 applied weight, then the risk is 100 * weight.
                                # Then we scale by scale_factor.
                                # However, constructing the exact array here might be tricky if we don't track per-strategy scaling.
                                # Approximation: Normalized Risk = 100 * scale_factor (assuming equal weight base)
                                new_risk = 100.0 * scale_factor
                                # Generate array equal to number of strategies
                                num_strategies_in_portfolio = len(p_def.indices)
                                risk_per_strategy = [new_risk] * num_strategies_in_portfolio
                            else:
                                print(f"    [BACKEND-LOG] -> ⚠️ Saltando normalización (valor actual de la métrica es 0).")
                else:
                    print(f"  [BACKEND-LOG] 2.{p_idx}.b -> ❌ SALTANDO bloque de normalización (condiciones no cumplidas).")
                
                # CORRECCIÓN CRÍTICA: Usar los trades que han sido potencialmente escalados ('trades_to_analyze')
                # en lugar de los originales ('portfolio_trades') para el análisis final.
                analysis_result = process_strategy_data(trades_to_analyze_df, benchmark_data_df.copy())
                
                # CORRECCIÓN: Devolver los trades escalados para que el frontend pueda generar los gráficos correctamente.
                # CORRECCIÓN FINAL: Si analysis_result es None, devolver un diccionario vacío para 'metrics'
                # en lugar de None. Esto evita que el frontend filtre el resultado por completo.
                metrics_payload = analysis_result[0] if analysis_result and analysis_result[0] else {}
                
                # --- CORRECCIÓN FINAL Y DEFINITIVA ---
                # Construir el objeto de respuesta explícitamente para asegurar que todos los campos se incluyen.
                # Y manejar el caso donde portfolio_id puede no existir (para el portafolio actual o del databank).
                
                print(f"[DEBUG-BACKEND] Portfolio {p_idx} - is_normalized: {is_risk_normalized_for_portfolio}, risk_per_strat: {risk_per_strategy}")
                
                result_obj = {
                    "metrics": metrics_payload, # The metrics are now directly in this property
                    "is_saved_portfolio": p_def.is_saved_portfolio,
                    "saved_index": p_def.saved_index,
                    "is_current_portfolio": p_def.is_current_portfolio,
                    "is_databank_portfolio": p_def.is_databank_portfolio,
                    "databank_index": p_def.databank_index,
                    "portfolio_id": p_def.portfolio_id,
                    "riskPerStrategy": risk_per_strategy if is_risk_normalized_for_portfolio else None
                }

                print(f"  [BACKEND-LOG] 2.{p_idx}.c -> Análisis finalizado. ¿Métricas encontradas?: {bool(metrics_payload)}. Enviando de vuelta.")

                portfolio_analysis_results.append(result_obj)
        
        # --- CORRECCIÓN FINAL: Combinar los resultados de forma explícita y correcta ---
        final_results = strategy_analysis_results + portfolio_analysis_results
        
        print(f"\n[BACKEND-LOG] 3. ANÁLISIS COMPLETO. Enviando {len(final_results)} objetos de resultados al frontend.")
        return json.loads(json.dumps(final_results, cls=CustomJSONEncoder))
    except Exception as e:
        print(f"!!!!!! ERROR in /analysis/full: {e} !!!!!!")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# --- NUEVOS ENDPOINTS para Pausar/Detener ---
@app.post("/databank/pause")
async def pause_search():
    global _is_search_paused
    _is_search_paused = not _is_search_paused
    print(f"Backend search paused: {_is_search_paused}")
    return {"status": "paused" if _is_search_paused else "resumed", "is_paused": _is_search_paused}

@app.post("/databank/stop")
async def stop_search():
    global _is_search_stopped
    _is_search_stopped = True
    print("Backend search stopped.")
    return {"status": "stopped", "is_stopped": _is_search_stopped}

from fastapi.responses import StreamingResponse

@app.post("/databank/find-portfolios-stream")
async def find_portfolios_stream_endpoint(request: DatabankRequest):
    # Resetear las banderas al inicio de una nueva búsqueda
    global _is_search_paused, _is_search_stopped
    _is_search_paused = False
    _is_search_stopped = False

    async def event_generator():
        print("✅ Petición de streaming recibida. Iniciando cálculos...")
        params = request.params
        yield f"data: {json.dumps({'status': 'info', 'message': 'Analizando estrategias individuales...'})}\n\n"

        try:
            strategies_data = []
            import io
            
            for strat in request.strategies_data:
                if isinstance(strat, str):
                    # CRITICAL DEBUG: Log received string details
                    if len(strategies_data) < 3:
                        str_len = len(strat)
                        preview = strat[:100] if strat else "EMPTY"
                        print(f"[DEBUG RX] Strat {len(strategies_data)}: Len={str_len}, Preview='{preview}'")

                    if not strat.strip():
                        print(f"[DEBUG RX] Strat {len(strategies_data)} is WHITESPACE/EMPTY")
                        strategies_data.append([])
                        continue
                        
                    # Parse CSV string
                    try:
                        # Assuming SQ format: Ticket,Symbol,Type,Open Time,Open Price,Size,Close Time,Close Price,Profit,Balance,...
                        # Map to internal keys: pnl, entry_date, exit_date, etc.
                        df = pd.read_csv(io.StringIO(strat))
                        
                        # Flexible Column Mapping
                        col_map = {
                            'Profit': 'pnl',
                            'Close Time': 'exit_date',
                            'Open Time': 'entry_date',
                            'Size': 'size',
                            'Symbol': 'symbol',
                            'Type': 'type',
                            'Comment': 'comment',
                            'Open Price': 'open_price',
                            'MagicNumber': 'magic_number'
                        }
                        
                        # Renaming cols that exist
                        rename_dict = {k: v for k, v in col_map.items() if k in df.columns}
                        df = df.rename(columns=rename_dict)
                        
                        # Convert to records
                        strategies_data.append(df.to_dict('records'))
                        
                    except Exception as e:
                        print(f"Error parsing CSV strategy data: {e}")
                        strategies_data.append([])
                else:
                    # Existing logic for list of objects
                    strategies_data.append([trade.model_dump() for trade in strat if trade.pnl is not None])

            benchmark_data_df = pd.DataFrame(request.benchmark_data)
            
            # --- DATE FILTERING ---
            use_all_dates = params.use_all_dates if hasattr(params, 'use_all_dates') else True
            
            # Extract start/end dates, prioritizing creation_filter if present
            start_date = params.start_date
            end_date = params.end_date
            
            if not start_date and params.creation_filter:
                start_date = params.creation_filter.get('start')
            if not end_date and params.creation_filter:
                end_date = params.creation_filter.get('end')
            
            # --- DEBUG LOGGING SETUP (UNCONDITIONAL) ---
            import logging
            debug_logger = logging.getLogger("date_debug")
            if not debug_logger.handlers:
                fh = logging.FileHandler("server_date_debug.log")
                fh.setLevel(logging.INFO)
                debug_logger.addHandler(fh)
                debug_logger.setLevel(logging.INFO)
            
            debug_logger.info("--- [DEBUG NEW REQUEST] ---")
            debug_logger.info(f"Params: use_all_dates={use_all_dates}, start_date={start_date}, end_date={end_date}")
            if params.creation_filter:
                 debug_logger.info(f"Creation Filter: {params.creation_filter}")
            if strategies_data and len(strategies_data) > 0:
                sample_strat = strategies_data[0]
                debug_logger.info(f"Sample Strategy 0 Type: {type(sample_strat)}")
                if isinstance(sample_strat, list) and len(sample_strat) > 0:
                    debug_logger.info(f"Sample Trade 0: {sample_strat[0]}")
                    # Try to log raw dates from first trade
                    t0 = sample_strat[0]
                    if isinstance(t0, dict):
                         debug_logger.info(f"Entry: {t0.get('entry_date')} (Type: {type(t0.get('entry_date'))})")
                         debug_logger.info(f"Exit: {t0.get('exit_date')} (Type: {type(t0.get('exit_date'))})")
            # -------------------------------------------
            
            if not use_all_dates and (start_date or end_date):
                date_msg = f'Aplicando filtro de fechas: {start_date or "inicio"} - {end_date or "fin"}'
                yield f"data: {json.dumps({'status': 'info', 'message': date_msg})}\n\n"
                
                # Filter each strategy's trades by date
                filtered_strategies_data = []
                for strat_trades in strategies_data:
                    if not strat_trades:
                        if len(filtered_strategies_data) < 3:
                            debug_logger.info(f"[EMPTY STRAT] Strategy {len(filtered_strategies_data)} has NO trades!")
                            print(f"[EMPTY STRAT] Strategy {len(filtered_strategies_data)} is EMPTY (no trades)")
                        filtered_strategies_data.append([])
                        continue
                    
                    df = pd.DataFrame(strat_trades)
                    
                    # CRITICAL DEBUG: Log columns for first 3 strategies (UNCONDITIONAL)
                    if len(filtered_strategies_data) < 3:
                        debug_logger.info(f"--- [STRAT {len(filtered_strategies_data)} COLUMNS] ---")
                        debug_logger.info(f"Columns: {list(df.columns)}")
                        debug_logger.info(f"Has exit_date? {'exit_date' in df.columns}")
                        print(f"[DEBUG COLS] Strat {len(filtered_strategies_data)}: cols={list(df.columns)[:5]}... exit_date?={'exit_date' in df.columns}")
                    
                    # Ensure we have a date column (exit_date is our standard)
                    if 'exit_date' in df.columns:
                        # LOG RAW DATA BEFORE PARSING (first 3 strategies)
                        if len(filtered_strategies_data) < 3:
                            raw_sample = df['exit_date'].iloc[0] if len(df) > 0 else 'EMPTY'
                            debug_logger.info(f"--- [RAW BEFORE PARSE] Strat {len(filtered_strategies_data)} ---")
                            debug_logger.info(f"Raw type: {type(raw_sample)}, Value: {raw_sample}")
                            print(f"[DEBUG RAW] Strat {len(filtered_strategies_data)}: type={type(raw_sample)}, val={raw_sample}")
                        
                        parse_method = 'unknown'
                        try:
                            # CORRECCIÓN DE FECHAS: Priorizar el formato exacto del frontend (YYYY.MM.DD HH:MM:SS)
                            df['exit_date'] = pd.to_datetime(df['exit_date'], format='%Y.%m.%d %H:%M:%S', errors='raise')
                            parse_method = 'YYYY.MM.DD HH:MM:SS'
                        except (ValueError, TypeError) as e1:
                            try:
                                df['exit_date'] = pd.to_datetime(df['exit_date'], format='%Y.%m.%d', errors='raise')
                                parse_method = 'YYYY.MM.DD'
                            except (ValueError, TypeError) as e2:
                                try:
                                    df['exit_date'] = pd.to_datetime(df['exit_date'], dayfirst=True, errors='coerce')
                                    parse_method = 'dayfirst=True'
                                except:
                                    df['exit_date'] = pd.to_datetime(df['exit_date'], errors='coerce')
                                    parse_method = 'coerce'
                        
                        if len(filtered_strategies_data) < 3:
                            debug_logger.info(f"Parse method used: {parse_method}")
                            print(f"[DEBUG PARSE] Strat {len(filtered_strategies_data)}: method={parse_method}")
                        
                        # DEBUG: Print sample date range of the strategy BEFORE filter (UNCONDITIONAL for first 3)
                        if len(filtered_strategies_data) < 3:
                            min_d = df['exit_date'].min()
                            max_d = df['exit_date'].max()
                            nat_count = df['exit_date'].isna().sum()
                            debug_logger.info(f"--- [DEBUG FILTER STRAT {len(filtered_strategies_data)}] ---")
                            debug_logger.info(f"Parsed Range: {min_d} to {max_d} | NaT count: {nat_count}/{len(df)}")
                            debug_logger.info(f"Head parsed: {df['exit_date'].head(3).tolist()}")
                            debug_logger.info(f"Filter window: {start_date} to {end_date}")
                            print(f"[DEBUG-FILTER] Strat {len(filtered_strategies_data)}: Parsed Range {min_d} to {max_d}, NaT: {nat_count}")

                        if start_date:
                            df = df[df['exit_date'] >= pd.to_datetime(start_date)]
                        if end_date:
                            df = df[df['exit_date'] <= pd.to_datetime(end_date)]
                    
                    count_after = len(df)
                    if count_after == 0:
                        print(f"[DEBUG-FILTER] Strat {len(filtered_strategies_data)} became EMPTY after filtering. Original: {len(strat_trades)}")
                    
                    filtered_strategies_data.append(df.to_dict('records'))
                
                strategies_data = filtered_strategies_data
                
                # Check if ALL are empty
                valid_strats = sum(1 for s in strategies_data if len(s) > 0)
                print(f"[DEBUG-FILTER] Total Valid Strategies after Filter: {valid_strats}/{len(strategies_data)}")
                if valid_strats < 2:
                     yield f"data: {json.dumps({'status': 'info', 'message': f'⚠️ Filtro demasiado estricto: Solo {valid_strats} estrategias tienen datos en este rango.'})}\n\n"

            individual_analyses = []
            print(f"[DEBUG] Starting individual analysis of {len(strategies_data)} strategies...", flush=True)
            for i, strat_trades in enumerate(strategies_data):
                if i % 5 == 0: print(f"[DEBUG] Analyzing Strat {i}/{len(strategies_data)}", flush=True)
                # Default to empty series if anything fails, preserving index alignment
                daily_returns = pd.Series(dtype=float)

                if strat_trades:
                    trades_df = pd.DataFrame(strat_trades)
                    analysis_result = process_strategy_data(trades_df, benchmark_data_df.copy())
                    if analysis_result:
                        _, daily_returns = analysis_result
                
                individual_analyses.append(daily_returns)
            
            # Check if we have at least one valid analysis to proceed with meaningful correlation
            # (Though even with all empties, code should ideally not crash, just return 0s)
            valid_analyses = [s for s in individual_analyses if not s.empty]
            if not valid_analyses:
                print("⚠️ No se pudieron analizar estrategias individuales (o todas vacías).")
                # We do not return here, we let it proceed, but correlation will be trivial.
                # yield f"data: {json.dumps({'status': 'warning', 'message': 'Individual analysis failed for all.'})}\n\n"
            
            yield f"data: {json.dumps({'status': 'info', 'message': 'Calculando matriz de correlación...'})}\n\n"
            
            print(f"[DEBUG] Concatenating {len(individual_analyses)} series and computing correlation...", flush=True)
            correlation_matrix = pd.concat(individual_analyses, axis=1).corr()
            print(f"[DEBUG] Correlation Matrix Computed. Shape: {correlation_matrix.shape}", flush=True)

            num_strategies = len(strategies_data)
            indices = list(range(num_strategies))
            
            # FIX: Respect user provided max_size
            if params.max_size and params.max_size > 0:
                max_combo_size = min(num_strategies, params.max_size)
            else:
                max_combo_size = min(num_strategies, 12)
                
            min_combo_size = params.min_size if params.min_size and params.min_size > 0 else 2

            # --- LÓGICA HÍBRIDA: Exhaustiva vs. Monte Carlo ---
            # Si hay base_indices, reducimos el espacio de búsqueda
            base_indices = set(params.base_indices) if params.base_indices else set()
            
            # --- VALIDACIÓN CRÍTICA: Correlación de Estrategias Base ---
            # Si las estrategias base YA superan el umbral, toda búsqueda es fútil (SOLO si estamos obligados a usarlas todas).
            # En Modo Lab (Flexible Base) Y HÍBRIDO, esto no es un error crítico, pues solo usaremos subconjuntos.
            if base_indices and params.objective != 'lab' and params.objective != 'hybrid':
                print(f"[DEBUG] Checking Base Correlation (Strict Mode - Not Lab/Hybrid)...", flush=True)
                base_list = list(base_indices)
                for i1_idx, i1 in enumerate(base_list):
                    for i2 in base_list[i1_idx+1:]:
                        # Usar iloc para acceder por índice numérico posicional
                        corr_val = correlation_matrix.iloc[i1, i2]
                        if corr_val > params.correlation_threshold:
                            name1 = request.strategy_names[i1] if hasattr(request, 'strategy_names') and i1 < len(request.strategy_names) else f"#{i1}"
                            name2 = request.strategy_names[i2] if hasattr(request, 'strategy_names') and i2 < len(request.strategy_names) else f"#{i2}"
                            
                            err_msg = f"⛔ ERROR CRÍTICO: Las estrategias base seleccionadas ('{name1}' y '{name2}') tienen una correlación interna de {corr_val:.2f}, que supera su límite de {params.correlation_threshold}. Imposible generar portafolios."
                            yield f"data: {json.dumps({'status': 'error', 'message': err_msg})}\n\n"
                            # Importante: Detener la ejecución aquí
                            yield f"data: {json.dumps({'status': 'stopped', 'message': 'Búsqueda abortada por conflicto en parámetros.'})}\n\n"
                            return

            if params.allowed_indices and len(params.allowed_indices) > 0:
                 # Lab Mode / Subset Search: Restrict available pool to allowed_indices
                 allowed_set = set(params.allowed_indices)
                 available_indices = [i for i in indices if i not in base_indices and i in allowed_set]
            else:
                 available_indices = [i for i in indices if i not in base_indices]
            
            # Ajustar tamaños de combinación
            # El tamaño total del portafolio será len(base_indices) + k_random
            # Por tanto, k_random debe ser al menos max(0, min_combo_size - len(base_indices))
            # Y como máximo max_combo_size - len(base_indices)
            
            effective_min_k = max(0, min_combo_size - len(base_indices))
            effective_max_k = max(0, max_combo_size - len(base_indices))
            
            # Si effective_max_k es 0, significa que solo podemos formar el portafolio base (si cumple min_combo_size)
            
            # Log search parameters
            print(f"DEBUG: Search Params - Available Indices: {len(available_indices)}, Min K: {effective_min_k}, Max K: {effective_max_k}", flush=True)
            print(f"DEBUG: Base Indices: {base_indices}", flush=True)

            if not available_indices and effective_max_k > 0:
                 # Caso borde: No hay más estrategias para añadir, pero se pide añadir más
                 effective_max_k = 0

            total_exhaustive_combinations = count_combinations(len(available_indices), effective_min_k, effective_max_k)
            
            # --- Search Method Selection ---
            search_method = getattr(params, 'search_method', 'auto')
            
            if search_method == 'brute_force':
                use_monte_carlo = False
                print(f"DEBUG: Search Method FORCED to Brute Force (Exhaustive).")
            elif search_method == 'monte_carlo':
                use_monte_carlo = True
                print(f"DEBUG: Search Method FORCED to Monte Carlo.")
            elif params.objective == 'lab' or params.objective == 'hybrid':
                # FIX: Lab and Hybrid mode logic (flexible base subsets) requires Monte Carlo generation
                # Hybrid needs it to prune the base portfolio if it's too large/correlated.
                use_monte_carlo = True
                print(f"DEBUG: Search Method FORCED to Monte Carlo (Lab/Hybrid Mode Requirement).")
            else:
                # Auto (Default)
                use_monte_carlo = total_exhaustive_combinations > params.search_threshold
                print(f"DEBUG: Search Method Auto -> Use Monte Carlo? {use_monte_carlo} (Threshold: {params.search_threshold})")

            total_iterations = 0
            iteration_counter = 0

            databank_portfolios = []

            # --- DIAGNOSTICS COUNTERS ---
            stats_checked = 0
            stats_rejected_corr = 0
            stats_rejected_sat_corr = 0
            stats_rejected_size = 0
            stats_errors = 0

            # --- PRE-CALCULATE BASE SCORE (Hoisted for both Monte Carlo & Exhaustive) ---
            print(f"DEBUG: Params Objective: '{params.objective}' | Base Indices: {params.base_indices} | Metric Key: {params.metric_to_optimize_key}", flush=True)
            
            # Helper to calculate metrics for a given combo (reusing scope variables)
            def calculate_portfolio_metrics_helper(combo_indices):
                try:
                    print(f"[DEBUG Helper] Combo: {len(combo_indices)} strategies", flush=True) 
                    p_trades = []
                    for s_idx in combo_indices:
                        if s_idx < len(strategies_data):
                            p_trades.extend(strategies_data[s_idx])
                    
                    if not p_trades:
                        return {}

                    p_df = pd.DataFrame(p_trades)
                    print(f"[DEBUG Helper] DF Rows: {len(p_df)}. Processing...", flush=True)
                    
                    # Note: benchmark_data_df and request.broker_config are captured from closure
                    an_res = process_strategy_data(p_df, benchmark_data_df.copy())
                    print(f"[DEBUG Helper] Done.", flush=True)
                    return an_res[0] if an_res else {}
                except Exception as ex:
                    print(f"Error in helper: {ex}")
                    return {}

            if params.objective == 'lab' or params.objective == 'boost':
                 try:
                     # FIX: Use local helper with captured scope
                     
                     # CASE A: Multi-Lab (Reference Portfolios Present) -> Target is MINIMUM of selected
                     if params.objective == 'lab' and params.reference_portfolios:
                         ref_scores = []
                         for ref_idx_list in params.reference_portfolios:
                             if not ref_idx_list: continue
                             m = calculate_portfolio_metrics_helper(ref_idx_list)
                             val = m.get(params.metric_to_optimize_key, 0.0)
                             ref_scores.append(val)
                         
                         if ref_scores:
                             base_score = min(ref_scores)
                             print(f"DEBUG: Multi-Lab Mode. Reference Scores: {ref_scores} -> Target (Min): {base_score:.4f}", flush=True)
                         elif params.base_indices:
                             # Fallback if ref portfolios are empty for some reason
                             m = calculate_portfolio_metrics_helper(params.base_indices)
                             base_score = m.get(params.metric_to_optimize_key, 0.0)
                             print(f"DEBUG: Multi-Lab Fallback. Target: {base_score:.4f}", flush=True)
                     
                     # CASE B: Single Lab / Boost -> Target is Metric of Base Indices
                     elif params.base_indices:
                         base_metrics = calculate_portfolio_metrics_helper(params.base_indices)
                         base_score = base_metrics.get(params.metric_to_optimize_key, 0.0) if params.metric_to_optimize_key in base_metrics else 0.0
                         print(f"DEBUG: Base Portfolio Score ({params.metric_to_optimize_key}): {base_score}", flush=True)
                         
                 except Exception as e:
                     print(f"Error calc base metrics: {e}", flush=True)
                     base_score = -999999.0

            if use_monte_carlo:
                msg = f'Búsqueda Monte Carlo iniciada ({"Forzada" if search_method == "monte_carlo" else f"Auto > {params.search_threshold}"})'
                if params.objective == 'lab' and 'base_score' in locals():
                     msg += f" | 🧪 LAB: Superar Base {params.metric_to_optimize_key} > {base_score:.4f}"
                     
                yield f"data: {json.dumps({'status': 'info', 'message': msg})}\n\n"
            else:
                total_iterations = total_exhaustive_combinations
                msg = f'Búsqueda Exhaustiva iniciada ({"Forzada" if search_method == "brute_force" else "Auto"}) - {total_iterations} combinaciones'
                if params.objective == 'lab' and 'base_score' in locals():
                     msg += f" | 🧪 LAB: Superar Base {params.metric_to_optimize_key} > {base_score:.4f}"
                yield f"data: {json.dumps({'status': 'info', 'message': msg})}\n\n"

            # Initialize Lab Mode tracker variable
            current_base_subset = []
            shuffle_interval = params.re_shuffle_interval if params.re_shuffle_interval and params.re_shuffle_interval > 0 else 5000

            print(f"[DEBUG] Entering Main Search Loop...", flush=True)
            while True: # Bucle infinito que se controla con Pausar/Detener
                iteration_counter += 1
                if iteration_counter % 1 == 0:
                     print(f"[DEBUG] Loop Alive: {iteration_counter}", flush=True)

                # --- LÓGICA DE CONTROL ---
                if iteration_counter % 100 == 0:
                    print(f"[DEBUG] Loop Iteration {iteration_counter}", flush=True)

                if _is_search_stopped:
                    yield f"data: {json.dumps({'status': 'stopped', 'message': 'Búsqueda detenida por el usuario.'})}\n\n"
                    return
                while _is_search_paused:
                    yield f"data: {json.dumps({'status': 'paused', 'message': 'Búsqueda pausada...'})}\n\n"
                    await asyncio.sleep(1) # Esperar 1 segundo y volver a comprobar

                # DEBUG: Heartbeat to confirm loop is alive
                # if iteration_counter % 100 == 0:
                #     print(f"[DEBUG] Loop Alive: {iteration_counter}", flush=True)

                # Enviar progreso
                # FIX: Send update on first iteration so user sees "Fixed Strategies" / Context immediately
                if iteration_counter > 0 and (iteration_counter % 20 == 0 or iteration_counter == 1):
                    # Build detailed stats message
                    stats_msg = f" | Total: {stats_checked} | Guardados: {len(databank_portfolios)} | Correlación: -{stats_rejected_corr} | SatCorr: -{stats_rejected_sat_corr}"
                    
                    progress_message = f"Progreso: {iteration_counter}"
                    if not use_monte_carlo:
                        progress_message += f"/{total_iterations} ({((iteration_counter/total_iterations)*100):.1f}%)"
                    
                    # Append diagnostics
                    progress_message += stats_msg
                    
                    if params.objective == 'lab':
                         # If current_base_subset is empty (first iteration), show all base indices as default
                         subset_to_show = current_base_subset if current_base_subset else list(base_indices)
                         
                         fixed_names = []
                         for idx in subset_to_show:
                             name = request.strategy_names[idx] if hasattr(request, 'strategy_names') and idx < len(request.strategy_names) else f"#{idx+1}"
                             fixed_names.append(name)
                         
                         progress_message += f" | 🧪 Fijas: [{', '.join(fixed_names)}]"
                         if 'base_score' in locals():
                             progress_message += f" | 🎯 Superar {params.metric_to_optimize_key} > {base_score:.4f}"

                    yield f"data: {json.dumps({'status': 'progress', 'message': progress_message})}\n\n"
                    await asyncio.sleep(0.01)

                # --- LIVE SCANNING FEEDBACK ---
                if iteration_counter % 7 == 0: # Update frequently for "fast" feel
                     # We can't show the exact current combo because it's generated below, but we can show the previous one or generate a sample
                     # Better: Show the one we are ABOUT to check? Or just the last one checked.
                     pass 

                # Generar una combinación
                combo_indices = []
                if use_monte_carlo:
                    if (params.objective == 'lab' or params.objective == 'hybrid') and base_indices:
                        # --- FLEXIBLE BASE LOGIC (Smart Pruning) ---
                        # Only reshuffle the base subset every 'shuffle_interval' iterations
                        if iteration_counter == 1 or iteration_counter % shuffle_interval == 0 or not current_base_subset:
                             # 1. Randomly select a SUBSET of the base indices
                             base_list = list(base_indices)
                             # FIX: Ensure we don't pick more base strategies than the global max_size allows
                             limit_k = len(base_list)
                             if max_combo_size and max_combo_size > 0:
                                 limit_k = min(limit_k, max_combo_size)
                             
                             k_base = random.randint(1, limit_k) 
                             raw_subset = random.sample(base_list, k_base)
                             
                             # 2. SMART PRUNING: Ensure the base subset itself is valid
                             # If the base strategies are already correlated > threshold, the loop will reject everything.
                             # We must remove conflicting strategies upfront.
                             valid_subset = list(raw_subset)
                             
                             try:
                                 # Simple iterative pruning
                                 # We need to re-check correlations every removal or do it in one pass.
                                 # N^2 check is fine for small k_base (usually < 20)
                                 has_conflict = True
                                 loop_safety = 0
                                 while has_conflict and len(valid_subset) > 1 and loop_safety < 100:
                                     has_conflict = False
                                     loop_safety += 1
                                     
                                     # Find first conflict
                                     conflict_pair = None
                                     for i in range(len(valid_subset)):
                                         for j in range(i + 1, len(valid_subset)):
                                             s1, s2 = valid_subset[i], valid_subset[j]
                                                 
                                             # Safety check for indices
                                             if s1 >= len(correlation_matrix) or s2 >= len(correlation_matrix):
                                                 continue

                                             # Lookup correlation (handle NaNs just in case)
                                             c_val = correlation_matrix.iloc[s1, s2]
                                             if pd.isna(c_val): c_val = 0.0
                                             
                                             if c_val > params.correlation_threshold:
                                                 conflict_pair = (i, j) # Indices in valid_subset
                                                 break
                                         if conflict_pair: break
                                     
                                     if conflict_pair:
                                         has_conflict = True
                                         # Remove random one of the pair to avoid bias? Or just the second.
                                         # User suggested random. Let's do random.
                                         idx_to_remove = conflict_pair[1] if random.random() > 0.5 else conflict_pair[0]
                                         removed_strat = valid_subset.pop(idx_to_remove)
                                 
                                 if loop_safety >= 100:
                                     print(f"[WARNING] Pruning loop safety limit reached.", flush=True)

                             except Exception as e:
                                 print(f"[ERROR] Smart Pruning Failed: {e}", flush=True)
                                 # Fallback: Just pick one random strategy if pruning crashes
                                 if raw_subset:
                                     valid_subset = [random.choice(raw_subset)]

                             current_base_subset = valid_subset
                        
                        # 3. Fill the rest with candidates from available_indices
                        target_size = random.randint(min_combo_size, max_combo_size)
                        needed = max(0, target_size - len(current_base_subset))
                        
                        # Prevent duplicates: Filter out strategies already in the base subset
                        # This is CRITICAL for Hybrid mode where self-correlation (1.0) leads to rejection.
                        mining_pool = [x for x in available_indices if x not in current_base_subset]

                        if len(mining_pool) >= needed:
                             combo_candidates = random.sample(mining_pool, needed)
                             combo_indices = tuple(combo_candidates)
                             combo = tuple(sorted(current_base_subset + list(combo_indices)))
                        else:
                             # Not enough unique strategies to fill target size
                             # Just use what we have (Base + All Remaining Unique)
                             combo_indices = tuple(mining_pool)
                             combo = tuple(sorted(current_base_subset + list(combo_indices)))
                    else:
                        # Standard Monte Carlo
                        # Randomly select k extra strategies
                        # Si effective_max_k es 0, k será 0
                        if effective_max_k > 0:
                            # FIX for Boost/Small Pools: Adjust max_k to what is actually available
                            # Prevent duplicates globally for Boost/Satellite too
                            mining_pool = [x for x in available_indices if x not in base_indices]
                            
                            pool_size = len(mining_pool)
                            actual_max_k = min(effective_max_k, pool_size)
                            
                            if actual_max_k >= effective_min_k:
                                k = random.randint(effective_min_k, actual_max_k)
                                combo_indices = random.sample(mining_pool, k)
                            else:
                                continue
                        else:
                            combo_indices = []

                        
                        # Standard Construction
                        combo = tuple(sorted(list(base_indices) + list(combo_indices)))

                        # FIX: In Boost mode (Improve/Repair), we want VARIATIONS (Base + k). 
                        # If k=0, we just return the base, which we already have. 
                        # We skip it to keep searching for additions.
                        if params.objective == 'boost' and combo == tuple(sorted(base_indices)):
                             continue
                else:
                    # Para la búsqueda exhaustiva, necesitamos un generador
                    if 'combinations_generator' not in locals():
                        combinations_generator = get_combinations(available_indices, effective_min_k, effective_max_k)
                    try:
                        combo_indices = list(next(combinations_generator))
                    except StopIteration:
                        # Búsqueda exhaustiva completada
                        break # Salir del bucle while
                    
                    # Build combo from base_indices + combo_indices (same as Monte Carlo)
                    combo = tuple(sorted(list(base_indices) + list(combo_indices)))
                    
                    # Skip if combo equals base (in boost mode)
                    if params.objective == 'boost' and combo == tuple(sorted(base_indices)):
                        continue

                
                try:
                    # Constructed in logic above
                    
                    # --- LIVE SCANNING FEEDBACK removed to avoid overwriting progress ---
                    # The useful info is now in the progress message
                    pass
                    
                    # Si el combo resultante es menor que el mínimo global requerido (por si acaso)
                    if len(combo) < min_combo_size:
                        stats_rejected_size += 1
                        continue

                    is_valid = True
                    # FIX: Skip internal correlation check for Laboratory mode (as per user request)
                    # User wants to filter ONLY by KPI improvement in Lab mode.
                    if params.objective != 'lab':
                        for i1_idx, i1 in enumerate(combo):
                            for i2 in combo[i1_idx+1:]:
                                corr_val = correlation_matrix.iloc[i1, i2]
                                if corr_val > params.correlation_threshold:
                                    is_valid = False
                                    stats_rejected_corr += 1
                                    
                                    # Si es el portafolio completo (todas las estrategias), avisar al usuario explícitamente
                                    if len(combo) == num_strategies:
                                        name1 = request.strategy_names[i1] if hasattr(request, 'strategy_names') and i1 < len(request.strategy_names) else f"#{i1+1}"
                                        name2 = request.strategy_names[i2] if hasattr(request, 'strategy_names') and i2 < len(request.strategy_names) else f"#{i2+1}"
                                        warning_msg = f"⚠️ Portafolio completo descartado: Alta correlación ({corr_val:.2f}) entre '{name1}' y '{name2}'."
                                        yield f"data: {json.dumps({'status': 'info', 'message': warning_msg})}\n\n"

                                    # Log rejection for larger portfolios to debug user issue
                                    # if len(combo) >= 5:
                                    #     print(f"DEBUG: Rejected combo {combo} due to correlation {corr_val:.2f} > {params.correlation_threshold} between {i1} and {i2}", flush=True)
                                    break
                            if not is_valid:
                                break
                    
                    if not is_valid:
                        continue

                    # if len(combo) >= 5:
                    #     print(f"DEBUG: Accepted combo {combo} (size {len(combo)})", flush=True)

                    portfolio_trades = []
                    for strat_index in combo:
                        # Simplemente añadimos todos los trades de las estrategias seleccionadas
                        portfolio_trades.extend(strategies_data[strat_index])
                    
                    portfolio_df = pd.DataFrame(portfolio_trades)
                    analysis_result = process_strategy_data(portfolio_df, benchmark_data_df.copy())

                    stats_checked += 1

                    if analysis_result:
                        metrics, _ = analysis_result
                        risk_per_strategy = None # Default: None (implicitly $100 or user stored)

                        # --- NORMALIZATION LOGIC (Portfolio Level) ---
                        if params.normalization_metric and params.normalization_target:
                            # 1. Determine current value of target metric
                            metric_key_map = {
                                'max_dd': 'maxDrawdownInDollars',
                                'ulcer_index': 'ulcerIndexInDollars'
                            }
                            target_key = metric_key_map.get(params.normalization_metric)
                            current_val = metrics.get(target_key, 0)

                            if current_val > 0:
                                # 2. Calculate Scaling Factor
                                # Factor = Target / Current
                                scaling_factor = params.normalization_target / current_val
                                
                                # 3. Apply Scaling to All Dollar Metrics in 'metrics'
                                # We need to scale PnL, Drawdown $, etc.
                                # Ratios (Sharpe, Profit Factor) remain largely same (linear scaling).
                                # Percentages (Max DD %) might change if capital is fixed, but here we usually assume variable capital or just scale nominals.
                                # For simplicity and speed, we scale known dollar keys.
                                dollar_keys = ['totalProfit', 'maxDrawdownInDollars', 'avgTrade', 'avgWin', 'avgLoss', 'grossProfit', 'grossLoss', 'ulcerIndexInDollars', 'monthlyAvgProfit']
                                for k in dollar_keys:
                                    if k in metrics:
                                        metrics[k] *= scaling_factor

                                # 4. Set implied risk per strategy
                                # Standard Risk = $100. New Risk = $100 * Factor.
                                new_risk = 100.0 * scaling_factor
                                risk_per_strategy = [new_risk] * len(combo) # Uniform scaling for all strategies in portfolio

                        # DEBUG LOG
                        print(f"[DEBUG] Metric: {params.metric_to_optimize_key} | Val: {metrics.get(params.metric_to_optimize_key)} | NormTarget: {params.normalization_target} | Scale: {scaling_factor if 'scaling_factor' in locals() else 'N/A'}")

                        if metrics and params.metric_to_optimize_key in metrics:
                            # --- Calc Correlation vs Reference (Single or Multi) ---
                            max_corr = -1.0
                            
                            # 1. Multi-Satellite Check (Only for Satellite/Search objective, NOT Lab)
                            if params.reference_portfolios and params.objective != 'lab':
                                correlations = []
                                for ref_indices in params.reference_portfolios:
                                    # Skip empty refs
                                    if not ref_indices: continue
                                    
                                    c = calculate_portfolio_correlation(combo, ref_indices, correlation_matrix)
                                    correlations.append(c)
                                
                                # Use the MAX correlation for filtering (must be uncorrelated to ALL, so max < limit)
                                max_corr = max(correlations) if correlations else 0.0
                                metrics['correlationWithBase'] = max_corr # Store max for display
                                metrics['multiRefCorrelations'] = correlations # Store details for tooltip
                                # print(f"[DEBUG] Multi-Satellite Correlations: {correlations} | Max: {max_corr}", flush=True)

                            # 2. Single Satellite Check (Fallback)
                            elif params.reference_indices:
                                try:
                                    corr_val = calculate_portfolio_correlation(combo, params.reference_indices, correlation_matrix)
                                    metrics['correlationWithBase'] = corr_val
                                    max_corr = corr_val
                                except Exception as e:
                                    pass

                            # --- SATELLITE FILTER ---
                            if params.objective != 'boost' and params.objective != 'lab' and \
                               params.satellite_correlation_threshold is not None and \
                               max_corr > -1.0 and \
                               max_corr > params.satellite_correlation_threshold:
                                stats_rejected_sat_corr += 1
                                continue

                            # --- LAB FILTER: BEAT THE BASE ---
                            # Logic: If 'base_score' exists, new combo must strict improve it.
                            # In Multi-Lab, base_score is the MIN of the selected portfolios.
                            if (params.objective == 'lab' or params.objective == 'boost' or params.objective == 'hybrid') and 'base_score' in locals():
                                 current_score = metrics.get(params.metric_to_optimize_key, 0.0)
                                 
                                 # Logic for Maximizing metrics
                                 if current_score <= base_score:
                                      # Reject if not improving (Strictly Greater structure for 'Mining')
                                      # print(f"DEBUG: Rejected {current_score} <= {base_score}", flush=True)
                                      continue
                                 # else:
                                 #      print(f"DEBUG: ACCEPTED {current_score} > {base_score}", flush=True)

                            metric_val = metrics[params.metric_to_optimize_key]

                            # --- CUSTOM OPTIMIZATION (CAGR x/÷ KPI) ---
                            if params.cagr_scaling_metric:
                                cagr_val = metrics.get('cagr', 0)
                                scaling_kpi_val = metrics.get(params.cagr_scaling_metric, 0)
                                operator = params.cagr_scaling_operator or 'multiply'
                                
                                # Check if metrics exist and are valid numbers
                                if np.isfinite(cagr_val) and np.isfinite(scaling_kpi_val):
                                     if operator == 'multiply':
                                         metric_val = cagr_val * scaling_kpi_val
                                         op_symbol = "×"
                                     elif operator == 'divide':
                                         if abs(scaling_kpi_val) > 1e-9: # Avoid division by zero
                                             metric_val = cagr_val / scaling_kpi_val
                                             op_symbol = "÷"
                                         else:
                                             metric_val = -999999999 # Penalize division by zero
                                     else:
                                         metric_val = cagr_val * scaling_kpi_val # Default to multiply
                                         op_symbol = "×"

                                     # Update metadata for display
                                     params.metric_name = f"CAGR {op_symbol} {params.cagr_scaling_metric}"
                                     # Store explicitly in metrics for debugging/display if needed
                                     metrics['cagr_custom_score'] = metric_val
                                else:
                                     metric_val = -999999999 # Penalize invalid combinations
                            
                            # Filter out invalid metrics (NaN, Infinity)
                            if not np.isfinite(metric_val):
                                # print(f"[DEBUG] Skipped invalid metric val: {metric_val}")
                                continue

                            portfolio_data = {
                                "metricValue": metric_val,
                                "metricName": params.metric_name,
                                "indices": list(combo),
                                "metrics": metrics,
                                "optimizationGoal": params.optimization_goal,
                                "riskPerStrategy": risk_per_strategy # Send to frontend
                            }
                            
                            old_len = len(databank_portfolios)
                            databank_portfolios = add_to_databank_if_better(databank_portfolios, portfolio_data, params.max_size)
                            
                            len_diff = len(databank_portfolios) - old_len
                            is_update = any(p['indices'] == list(combo) for p in databank_portfolios)

                            if len_diff > 0:
                                print(f"[DEBUG] + Added Portfolio. Metric ({params.metric_to_optimize_key}): {metric_val:.2f}")
                            elif is_update:
                                print(f"[DEBUG] * Updated Portfolio. Metric: {metric_val:.2f}")
                            # else:
                            #     print(f"[DEBUG] . Rejected. Metric: {metric_val:.2f}")

                            if len_diff > 0 or is_update:
                                # Sanitize data before sending to avoid JSON NaN errors
                                # Sanitize data before sending to avoid JSON NaN errors
                                safe_portfolio_data = sanitize_floats(portfolio_data)
                                yield f"data: {json.dumps(safe_portfolio_data, cls=CustomJSONEncoder)}\n\n"
                                # Yield control to event loop to ensure message sends
                                await asyncio.sleep(0.01)
                            
                except Exception as loop_e:
                    print(f"⚠️ Error processing combo {combo}: {loop_e}")
                    traceback.print_exc()
                    continue

                # Yield control explicitly every few iterations to prevent blocking
                if iteration_counter % 100 == 0:
                    await asyncio.sleep(0)

            yield f"data: {json.dumps({'status': 'completed'})}\n\n"

        except Exception as e:
            print(f"❌ ERROR CATASTRÓFICO EN EL BACKEND: {e}")
            traceback.print_exc()
            yield f"data: {json.dumps({'status': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.post("/analysis/optimize-portfolio")
async def optimize_portfolio_weights(request: OptimizationRequest):
    """
    Realiza una búsqueda Monte Carlo para encontrar los pesos óptimos para un único portafolio.
    OPTIMIZED: Use Vectorized Numpy operations for speed.
    """
    print("\n--- Endpoint /analysis/optimize-portfolio HIT (Vectorized) ---")
    try:
        params = request.params
        # 1. Pre-process strategies data (Convert to Daily PnL Matrix)
        # We need to align all strategies by date to sum their PnL correctly.
        
        print("--- [OPTIMIZE-LOG] 0. Pre-processing data into Daily PnL Matrix...")
        
        # Filter strategies based on requested indices
        selected_strategies_data = [request.strategies_data[i] for i in request.portfolio_indices]
        num_strategies = len(selected_strategies_data)
        
        daily_pnl_series_list = []
        
        for strat_idx, strat_trades in enumerate(selected_strategies_data):
            trades_list = [trade.model_dump() for trade in strat_trades if trade.pnl is not None]
            if not trades_list:
                daily_pnl_series_list.append(pd.Series(dtype=float))
                continue
                
            df = pd.DataFrame(trades_list)
            # Ensure PnL is numeric
            if df['pnl'].dtype == object:
                df['pnl'] = df['pnl'].astype(str).str.replace(',', '.', regex=False)
            df['pnl'] = pd.to_numeric(df['pnl'], errors='coerce')
            
            # Parse Dates for grouping
            # Priority: exit_date
            for col in ['exit_date', 'entry_date']:
                 try:
                     df[col] = pd.to_datetime(df[col], errors='coerce')
                 except: pass

            df = df.dropna(subset=['exit_date', 'pnl'])
            
            # Group by Date and Sum PnL
            daily_pnl = df.groupby(df['exit_date'].dt.date)['pnl'].sum()
            daily_pnl.name = f"strat_{strat_idx}"
            daily_pnl_series_list.append(daily_pnl)

        # Create the Matrix (Index=Date, Columns=Strategies)
        # fillna(0) because if a strategy has no trades on a day, its PnL is 0.
        if not daily_pnl_series_list:
             raise HTTPException(status_code=400, detail="No strategies to optimize.")

        pnl_matrix_df = pd.concat(daily_pnl_series_list, axis=1).fillna(0.0)
        pnl_matrix = pnl_matrix_df.values # Numpy Array (Days, Strategies)
        
        # Debug info
        print(f"--- [OPTIMIZE-LOG] 0.1 Matrix Shape: {pnl_matrix.shape} (Days x Strategies)")
        days_count = pnl_matrix.shape[0]

        # --- Helper for Full Analysis (Classic) ---
        # We still need this to generate the DETAILED report for the generated report (Base, Best, Balanced)
        # But we won't run it inside the loop.
        def analyze_combination_full(weights_list: List[float]):
            portfolio_trades = []
            for i, strat_trades in enumerate(selected_strategies_data):
                weight = weights_list[i]
                trades = [t.model_dump() for t in strat_trades if t.pnl is not None]
                for trade in trades:
                     new_trade = trade.copy()
                     # Clean pnl
                     val = new_trade.get('pnl')
                     if isinstance(val, str):
                         val = val.replace(',', '.')
                     if val is not None:
                         new_trade['pnl'] = float(val) * weight
                         portfolio_trades.append(new_trade)

            if not portfolio_trades:
                return None, None
            
            df = pd.DataFrame(portfolio_trades)
            # Date conversion for final export
            for col in ['entry_date', 'exit_date']:
                 df[col] = pd.to_datetime(df[col], errors='coerce')

            analysis_result = process_strategy_data(df, pd.DataFrame(request.benchmark_data))
            
            # Stringify dates for JSON
            df['entry_date'] = df['entry_date'].dt.strftime('%Y-%m-%dT%H:%M:%S')
            df['exit_date'] = df['exit_date'].dt.strftime('%Y-%m-%dT%H:%M:%S')
            
            metrics = analysis_result[0] if analysis_result else {}
            return metrics, df.to_dict('records')

        # 1. Base Analysis (Equal Weights)
        print("--- [OPTIMIZE-LOG] 1. Running Base Analysis (Equal Weights)...")
        equal_weights = [1.0 / num_strategies] * num_strategies
        base_metrics, base_trades = analyze_combination_full(equal_weights)
        
        if not base_metrics:
            raise HTTPException(status_code=400, detail="Base portfolio has no metrics.")

        original_target_metric_value = base_metrics.get(params.target_metric)
        
        # 2. Vectorized Simulation
        num_sims = params.num_simulations
        if num_sims > 0 and days_count > 0:
            print(f"--- [OPTIMIZE-LOG] 2. Running {num_sims} simulations (Vectorized)...")
            
            # A. Generate Random Weights (Sims x Strategies)
            weights_matrix = np.random.random((num_sims, num_strategies))
            # Normalize rows to sum to 1
            row_sums = weights_matrix.sum(axis=1)[:, np.newaxis]
            weights_matrix = weights_matrix / row_sums
            
            # Apply min_weight filter if needed? 
            # Vectorized filter is tricky, simpler to just generate, filter, regenerate, OR accept small bias.
            # For speed, let's just zero out small weights and re-normalize?
            # Or just ignore min_weight for the random cloud because re-normalizing changes others.
            # Let's stick to simple random for now.
            
            # B. Calculate Portfolio Daily PnL for ALL simulations at once
            # Matrix Mult: (Days x Strategies) @ (Strategies x Sims) -> (Days x Sims)
            # Transpose weights to (Strategies x Sims)
            port_daily_pnl_matrix = pnl_matrix @ weights_matrix.T # Result: (Days, Sims)
            
            # C. Calculate Metrics Vectorized
            # We need: Return (Sum), MaxDD, Sharpe/Sortino components
            
            # Total Profit
            total_profit_vec = port_daily_pnl_matrix.sum(axis=0)
            
            # Equity Curves (Cumulative Sum)
            # Assume initial capital doesn't affect ratio-based optimization goals (Sharpe/Sortino), 
            # but for Drawdown % it does. We use a fixed large capital to avoid bankruptcy in simulation.
            initial_cap = 10000.0
            equity_curves = initial_cap + port_daily_pnl_matrix.cumsum(axis=0)
            
            # Max Drawdown %
            # Rolling Max
            running_max = np.maximum.accumulate(equity_curves, axis=0)
            drawdowns = (running_max - equity_curves) / running_max
            max_dd_vec = drawdowns.max(axis=0) * 100 # In %
            
            # Metrics for Goal
            target_metric_vec = np.zeros(num_sims)
            
            # Helper for specific metrics
            if params.target_metric == 'totalProfit':
                target_metric_vec = total_profit_vec
            elif params.target_metric == 'maxDrawdown':
                target_metric_vec = max_dd_vec # Minimize this
            elif params.target_metric == 'returnDD': # Profit / MaxDD
                # Avoid div by zero
                safe_dd = max_dd_vec.copy()
                safe_dd[safe_dd == 0] = 1.0 # arbitrary
                target_metric_vec = total_profit_vec / safe_dd
            elif params.target_metric in ['sharpeRatio', 'sharpeRatioDaily']:
                # Mean(Daily_Ret) / Std(Daily_Ret) * sqrt(252)
                # Daily Returns %
                # Using simple returns: PnL / Start_Equity_Of_Day is hard vectorized without loop
                # Approx: PnL / Fixed_Capital (Simple Sharpe) OR Log Returns
                # Let's use PnL / Mean_Equity or just PnL stats if capital is constant?
                # Best Vectorized Approx: pct_change() on columns.
                # Since numpy doesn't have pct_change, we do: (E[t] - E[t-1]) / E[t-1]
                # Shifted array:
                e_t = equity_curves
                e_t_minus_1 = np.vstack([np.full((1, num_sims), initial_cap), equity_curves[:-1, :]])
                daily_rets = (e_t - e_t_minus_1) / e_t_minus_1
                
                means = daily_rets.mean(axis=0)
                stds = daily_rets.std(axis=0)
                stds[stds == 0] = 1.0 # Avoid nan
                target_metric_vec = (means / stds) * np.sqrt(252)
                
            elif params.target_metric == 'sortinoRatio':
                # Mean / DownsideDev * sqrt(252)
                # Recalculate daily rets
                e_t = equity_curves
                e_t_minus_1 = np.vstack([np.full((1, num_sims), initial_cap), equity_curves[:-1, :]])
                daily_rets = (e_t - e_t_minus_1) / e_t_minus_1
                
                means = daily_rets.mean(axis=0)
                
                # Downside Dev: Std of negative returns only
                # Mask positive returns
                neg_rets = np.where(daily_rets < 0, daily_rets, 0)
                # Std of these (sum of squares / N)
                downside_sq = (neg_rets**2).mean(axis=0)
                downside_dev = np.sqrt(downside_sq)
                downside_dev[downside_dev == 0] = 1.0
                
                target_metric_vec = (means / downside_dev) * np.sqrt(252)

            # D. Find Best Index
            best_sim_idx = -1
            if params.target_goal == 'maximize':
                best_sim_idx = np.argmax(target_metric_vec)
            else: # minimize
                best_sim_idx = np.argmin(target_metric_vec)
            
            best_weights = weights_matrix[best_sim_idx].tolist()
            best_metric_val = target_metric_vec[best_sim_idx]
            
            print(f"--- [OPTIMIZE-LOG] 2.1 Optimization Done. Best Metric ({params.target_metric}): {best_metric_val}")
            
            # E. Find Balanced Best (Simplified Vectorized)
            # Calculating 'Balanced' is complex vectorized because it supports multiple arbitrary metrics.
            # We will skip the 'Balanced' search in vectorized mode for speed, or assume the 'Metric Best' is good enough.
            # Alternatively, we iterate only the top N results.
            # For now, let's use the SAME best result for balanced to save time, or do a simplified check.
            balanced_weights = best_weights 
            
            # 3. Final Full Analysis for the WINNER only
            print("--- [OPTIMIZE-LOG] 3. Running Final Analysis for Best Result...")
            metric_best_metrics, metric_best_trades = analyze_combination_full(best_weights)
            
            metric_best_result = {
                'metrics': metric_best_metrics,
                'trades': metric_best_trades,
                'weights': best_weights
            }
            
            balanced_best_result = metric_best_result # Duplicate for now
            
        else:
             # Fallback if no simulations
             metric_best_result = {'metrics': base_metrics, 'trades': base_trades, 'weights': equal_weights}
             balanced_best_result = metric_best_result

        # 5. Prepare Response
        final_response = {
            "baseAnalysis": { "metrics": base_metrics, "trades": base_trades, "weights": equal_weights },
            "metricBestAnalysis": metric_best_result,
            "balancedBestAnalysis": balanced_best_result
        }
        
        # --- CORRECCIÓN FINAL: Asegurar que la serialización se aplique siempre ---
        # Usar json.dumps con el codificador personalizado garantiza que todos los tipos de datos
        # (incluidos Timestamps, numpy ints/floats) se conviertan correctamente antes de enviar.
        # json.loads lo convierte de nuevo en un diccionario/lista de Python que FastAPI puede manejar.
        print("--- [OPTIMIZE-LOG] 3. Optimización finalizada. Preparando respuesta final.")
        response_payload = json.loads(json.dumps(final_response, cls=CustomJSONEncoder))
        print("--- [OPTIMIZE-LOG] 4. Respuesta enviada al frontend.")
        return response_payload

    except Exception as e:
        # --- LOG MEJORADO ---
        print(f"!!!!!! 🔥🔥🔥 ERROR CATASTRÓFICO en /analysis/optimize-portfolio: {type(e).__name__}: {e} 🔥🔥🔥 !!!!!!")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# ===== MYFXBOOK HEALTH MONITORING =====

from myfxbook_client import MyfxbookClient, MyfxbookAPIError

class MyfxbookLoginRequest(BaseModel):
    email: str
    password: str
    account_id: int  # Myfxbook account ID to fetch

class MyfxbookCredentials(BaseModel):
    email: str
    password: str

@app.post("/myfxbook/get-accounts")
async def myfxbook_get_accounts(request: MyfxbookCredentials):
    """
    Login and fetch all accounts for the user.
    """
    try:
        print(f"[Myfxbook Endpoint] Fetching accounts for: {request.email}")
        client = MyfxbookClient()
        session = client.login(request.email, request.password)
        
        accounts = client.get_my_accounts()
        client.logout()
        
        return {
            "success": True,
            "accounts": accounts,
            "count": len(accounts)
        }
    except MyfxbookAPIError as e:
        return JSONResponse(status_code=400, content={"success": False, "detail": str(e)})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"success": False, "detail": str(e)})


class MyfxbookHistoryRequest(BaseModel):
    email: str
    password: str
    account_id: int

@app.post("/myfxbook/get-history")
async def myfxbook_get_history(request: MyfxbookHistoryRequest):
    """
    Login and fetch full history (closed) AND open trades for a specific account.
    """
    try:
        print(f"\n{'='*60}")
        print(f"[Myfxbook SYNC] Starting sync for account: {request.account_id}")
        print(f"[Myfxbook SYNC] Email: {request.email}")
        print(f"{'='*60}")
        
        print(f"[Myfxbook SYNC] Step 1: Creating client...")
        client = MyfxbookClient()
        
        print(f"[Myfxbook SYNC] Step 2: Logging in...")
        session = client.login(request.email, request.password)
        print(f"[Myfxbook SYNC] Step 2: ✅ Login successful. Session: {session[:15]}...")
        
        # 1. Get Closed History
        print(f"[Myfxbook SYNC] Step 3: Fetching closed history...")
        history = client.get_history(request.account_id)
        print(f"[Myfxbook SYNC] Step 3: ✅ Got {len(history)} closed trades")
        
        # 2. Get Open Trades (New!)
        print(f"[Myfxbook SYNC] Step 4: Fetching open trades...")
        open_trades = []
        try:
            open_trades = client.get_open_trades(request.account_id)
            print(f"[Myfxbook SYNC] Step 4: ✅ Got {len(open_trades)} open trades")
        except Exception as e:
            print(f"[Myfxbook SYNC] Step 4: ⚠️ Failed to fetch open trades: {e}")
        
        # Calculate basic metrics
        print(f"[Myfxbook SYNC] Step 5: Calculating metrics...")
        losses_data = client.calculate_consecutive_losses(history)
        dd_data = client.calculate_max_drawdown(history)
        print(f"[Myfxbook SYNC] Step 5: ✅ Max losses: {losses_data.get('maxConsecutiveLosses', 'N/A')}")
        
        # Fetch current account status
        print(f"[Myfxbook SYNC] Step 6: Fetching account info...")
        account_info = client.get_account_info(request.account_id)
        print(f"[Myfxbook SYNC] Step 6: ✅ Account info retrieved")
        
        print(f"[Myfxbook SYNC] Step 7: Logging out...")
        client.logout()
        print(f"[Myfxbook SYNC] Step 7: ✅ Logout successful")
        
        print(f"[Myfxbook SYNC] ✅ SYNC COMPLETE - {len(history)} closed, {len(open_trades)} open")
        print(f"{'='*60}\n")
        
        return {
            "success": True,
            "accountId": request.account_id,
            "history": history,
            "openTrades": open_trades,
            "count": len(history),
            "openCount": len(open_trades),
            "metrics": {
                "consecutiveLosses": losses_data,
                "maxDrawdown": dd_data
            },
            "accountInfo": account_info
        }
    except MyfxbookAPIError as e:
        print(f"[Myfxbook SYNC] ❌ API ERROR: {e}")
        return JSONResponse(status_code=400, content={"success": False, "detail": str(e)})
    except Exception as e:
        print(f"[Myfxbook SYNC] ❌ EXCEPTION: {type(e).__name__}: {e}")
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"success": False, "detail": str(e)})



@app.post("/myfxbook/test-sync")
async def myfxbook_test_sync(request: MyfxbookLoginRequest):
    """
    Test endpoint for Myfxbook API integration.
    
    This endpoint:
    1. Logs in to Myfxbook
    2. Fetches account history (last 50 trades)
    3. Calculates consecutive losses
    4. Returns comparison data
    
    NOTE: This is a test endpoint. Production version will use stored sessions.
    """
    logs = []
    
    try:
        logs.append(f"[Myfxbook Endpoint] Testing sync for account: {request.account_id}")
        print(f"[Myfxbook Endpoint] Testing sync for account: {request.account_id}")
        
        # 1. Create client and login
        logs.append("[Step 1/4] Creating client and logging in...")
        client = MyfxbookClient()
        session = client.login(request.email, request.password)
        logs.append(f"[Step 1/4] ✅ Login successful. Session: {session[:12]}...")
        
        # 1.5 Debug: Get all accounts to verify session and IDs
        logs.append("[Step 1.5/4] 🔍 Fetching ALL accounts to verify session...")
        try:
            accounts = client.get_my_accounts()
            logs.append(f"[Step 1.5/4] ✅ Session is VALID. Found {len(accounts)} accounts:")
            for acc in accounts:
                logs.append(f"   - Name: {acc.get('name')} | ID: {acc.get('id')} | Account: {acc.get('accountId')}")
        except Exception as e:
            logs.append(f"[Step 1.5/4] ❌ Failed to fetch accounts: {str(e)}")
            # Don't stop here, try get_history anyway to see if it's the same error
        
        # 2. Get account history (last 50 trades)
        logs.append(f"[Step 2/4] Fetching history for account {request.account_id}...")
        history = client.get_history(request.account_id)
        logs.append(f"[Step 2/4] ✅ Retrieved {len(history)} trades")
        
        # 3. Calculate consecutive losses
        logs.append("[Step 3/4] Calculating consecutive losses...")
        losses_data = client.calculate_consecutive_losses(history)
        logs.append(f"[Step 3/4] ✅ Max consecutive losses: {losses_data['maxConsecutiveLosses']}")
        
        # 4. Logout (clean session)
        logs.append("[Step 4/4] Logging out...")
        client.logout()
        logs.append("[Step 4/4] ✅ Logout successful")
        
        # 5. Prepare response
        response = {
            "success": True,
            "accountId": request.account_id,
            "tradesCount": len(history),
            "consecutiveLosses": losses_data,
            "message": f"Retrieved {len(history)} trades. Max consecutive losses: {losses_data['maxConsecutiveLosses']}",
            "debug_logs": "\n".join(logs)
        }
        
        print(f"[Myfxbook Endpoint] Sync successful: {response['message']}")
        return response
        
    except MyfxbookAPIError as e:
        error_msg = str(e)
        logs.append(f"❌ API Error: {error_msg}")
        print(f"[Myfxbook Endpoint] ❌ API Error: {error_msg}")
        
        # Return detailed error for frontend debugging
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "error_type": "MyfxbookAPIError",
                "detail": error_msg,
                "debug_info": {
                    "email": request.email,
                    "account_id": request.account_id,
                    "error_class": type(e).__name__
                },
                "debug_logs": "\n".join(logs)
            }
        )
    except Exception as e:
        error_msg = str(e)
        error_type = type(e).__name__
        logs.append(f"❌ Unexpected error ({error_type}): {error_msg}")
        print(f"[Myfxbook Endpoint] ❌ Unexpected error ({error_type}): {error_msg}")
        traceback.print_exc()
        
        # Return detailed error for frontend debugging
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error_type": error_type,
                "detail": error_msg,
                "debug_info": {
                    "email": request.email,
                    "account_id": request.account_id,
                    "traceback": traceback.format_exc()
                },
                "debug_logs": "\n".join(logs)
            }
        )


@app.post("/analysis/correlation-matrix")
async def get_correlation_matrix(request: CorrelationRequest):
    """
    Calculates the Pearson correlation matrix for the given strategies.
    Based on Daily PnL.
    """
    print("\n--- Endpoint /analysis/correlation-matrix HIT ---")
    try:
        # 1. Pre-process strategies data
        selected_strategies_data = [request.strategies_data[i] for i in request.portfolio_indices]
        if len(selected_strategies_data) < 2:
             return JSONResponse(content={"matrix": [[1.0]], "labels": ["Strategy 1"], "indices": request.portfolio_indices}, encoder=CustomJSONEncoder)

        daily_pnl_series_list = []
        
        for i, strat_idx in enumerate(request.portfolio_indices):
            strat_trades = request.strategies_data[strat_idx]
            
            trades_list = [trade.model_dump() for trade in strat_trades if trade.pnl is not None]
            if not trades_list:
                daily_pnl_series_list.append(pd.Series(dtype=float))
                continue
                
            df = pd.DataFrame(trades_list)
            # Ensure PnL is numeric
            if df['pnl'].dtype == object:
                df['pnl'] = df['pnl'].astype(str).str.replace(',', '.', regex=False)
            df['pnl'] = pd.to_numeric(df['pnl'], errors='coerce')
            
            # Parse Dates
            for col in ['exit_date', 'entry_date']:
                 try:
                    df[col] = pd.to_datetime(df[col], format='%Y.%m.%d %H:%M:%S', errors='coerce')
                    # Fallback for different formats if needed
                    mask = df[col].isna()
                    if mask.any():
                        df.loc[mask, col] = pd.to_datetime(df.loc[mask, col], errors='coerce')
                 except Exception:
                    pass
            
            # Group by day
            date_col = 'exit_date' if 'exit_date' in df.columns else 'entry_date'
            if date_col not in df.columns:
                 daily_pnl_series_list.append(pd.Series(dtype=float))
                 continue
                 
            daily_pnl = df.groupby(df[date_col].dt.date)['pnl'].sum()
            daily_pnl_series_list.append(daily_pnl)

        # 2. Setup DataFrame
        df_matrix = pd.DataFrame(daily_pnl_series_list).T.fillna(0).sort_index()
        
        # 3. Calculate Correlation
        correlation_matrix = df_matrix.corr(method='pearson').fillna(0)
        
        # 4. Prepare Response
        # Convert to list of lists
        matrix_data = correlation_matrix.values.tolist()
        
        # Sanitization: Handle NaN/Inf
        matrix_data = [[(x if not np.isnan(x) else 0.0) for x in row] for row in matrix_data]

        response_content = {
            "matrix": matrix_data,
            "indices": request.portfolio_indices
        }
        
        # Use CustomJSONEncoder to handle any remaining numpy types or weird floats
        return Response(content=json.dumps(response_content, cls=CustomJSONEncoder), media_type="application/json")

    except Exception as e:
        print(f"❌ Error in /analysis/correlation-matrix: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# --- Search History / Engines ---

class SearchHistoryRequest(BaseModel):
    name: str
    timestamp: str
    config: Dict[str, Any]
    base_strategies: List[str] # List of strategy NAMES
    objective: str

HISTORY_FILE = "search_engines.json"

@app.get("/history/list")
async def list_search_history():
    """Returns the list of saved search engines."""
    if not os.path.exists(HISTORY_FILE):
        return []
    try:
        with open(HISTORY_FILE, "r") as f:
            data = json.load(f)
            # Sort by timestamp desc
            data.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
            return data
    except Exception as e:
        print(f"Error reading history file: {e}")
        return []

@app.post("/history/save")
async def save_search_history(req: SearchHistoryRequest):
    """Saves a search configuration to history."""
    try:
        data = []
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE, "r") as f:
                try:
                    data = json.load(f)
                except json.JSONDecodeError:
                    data = []
        
        # Add new entry
        entry = req.dict()
        data.append(entry)
        
        # Limit history size? Let's keep it unlimited for now or cap at 50
        if len(data) > 50:
             data = data[-50:]

        with open(HISTORY_FILE, "w") as f:
            json.dump(data, f, indent=4)
            
        return {"status": "ok", "count": len(data)}
    except Exception as e:
        print(f"Error saving search history: {e}")
        raise HTTPException(status_code=500, detail=str(e))
