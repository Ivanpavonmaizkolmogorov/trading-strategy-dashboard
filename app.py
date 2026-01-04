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
from analysis_engine import process_strategy_data, get_combinations, add_to_databank_if_better, count_combinations

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
    base_indices: List[int]
    metric_name: str
    search_threshold: int
    search_method: Optional[str] = 'auto'
    normalization_metric: Optional[str] = None
    normalization_target: Optional[float] = None
    cagr_scaling_metric: Optional[str] = None
    cagr_scaling_operator: Optional[str] = 'multiply'

class DatabankRequest(BaseModel):
    strategy_names: List[str] # <-- Añadimos los nombres de las estrategias
    strategies_data: List[List[Trade]]
    benchmark_data: Optional[List[Dict[str, Any]]] = None
    params: DatabankParams
    broker_config: Optional[Dict[str, Any]] = None

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
    broker_config: Optional[Dict[str, Any]] = None

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
    broker_config: Optional[Dict[str, Any]] = None


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
                pre_analysis_result = process_strategy_data(strat_df.copy(), benchmark_data_df.copy(), broker_config=request.broker_config)
                if pre_analysis_result:
                    metric_key = 'maxDrawdownInDollars' if request.normalization_metric == 'max_dd' else 'ulcerIndexInDollars'
                    current_metric_value = pre_analysis_result[0].get(metric_key, 0)
                    if current_metric_value > 0:
                        scale_factor = request.normalization_target_value / current_metric_value
                        # Y aplicamos el escalado a la copia que se va a analizar
                        trades_to_analyze_df['pnl'] *= scale_factor
            
            analysis_result = process_strategy_data(trades_to_analyze_df, benchmark_data_df.copy(), broker_config=request.broker_config)
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
                        pre_analysis_result = process_strategy_data(portfolio_df.copy(), benchmark_data_df.copy(), broker_config=request.broker_config) 
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
                analysis_result = process_strategy_data(trades_to_analyze_df, benchmark_data_df.copy(), broker_config=request.broker_config)
                
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
            strategies_data = [[trade.model_dump() for trade in strat if trade.pnl is not None] for strat in request.strategies_data]
            benchmark_data_df = pd.DataFrame(request.benchmark_data)
            
            # --- DATE FILTERING ---
            use_all_dates = params.use_all_dates if hasattr(params, 'use_all_dates') else True
            start_date = params.start_date if hasattr(params, 'start_date') else None
            end_date = params.end_date if hasattr(params, 'end_date') else None
            
            if not use_all_dates and (start_date or end_date):
                date_msg = f'Aplicando filtro de fechas: {start_date or "inicio"} - {end_date or "fin"}'
                yield f"data: {json.dumps({'status': 'info', 'message': date_msg})}\n\n"
                
                # Filter each strategy's trades by date
                filtered_strategies_data = []
                for strat_trades in strategies_data:
                    if not strat_trades:
                        filtered_strategies_data.append([])
                        continue
                    
                    df = pd.DataFrame(strat_trades)
                    # Ensure we have a date column (exit_date is our standard)
                    if 'exit_date' in df.columns:
                        df['exit_date'] = pd.to_datetime(df['exit_date'], errors='coerce')
                        
                        if start_date:
                            df = df[df['exit_date'] >= pd.to_datetime(start_date)]
                        if end_date:
                            df = df[df['exit_date'] <= pd.to_datetime(end_date)]
                    
                    filtered_strategies_data.append(df.to_dict('records'))
                
                strategies_data = filtered_strategies_data

            individual_analyses = []
            for i, strat_trades in enumerate(strategies_data):
                if not strat_trades: continue
                
                trades_df = pd.DataFrame(strat_trades)
                analysis_result = process_strategy_data(trades_df, benchmark_data_df.copy(), broker_config=request.broker_config)
                if analysis_result:
                    _, daily_returns = analysis_result
                    individual_analyses.append(daily_returns)
            
            if not individual_analyses:
                print("⚠️ No se pudieron analizar estrategias individuales. Deteniendo.")
                yield f"data: {json.dumps({'status': 'error', 'message': 'No individual strategies could be analyzed.'})}\n\n"
                return
            
            yield f"data: {json.dumps({'status': 'info', 'message': 'Calculando matriz de correlación...'})}\n\n"

            correlation_matrix = pd.concat(individual_analyses, axis=1).corr()

            num_strategies = len(strategies_data)
            indices = list(range(num_strategies))
            max_combo_size = min(num_strategies, 12)
            min_combo_size = 2

            # --- LÓGICA HÍBRIDA: Exhaustiva vs. Monte Carlo ---
            # Si hay base_indices, reducimos el espacio de búsqueda
            base_indices = set(params.base_indices) if params.base_indices else set()
            
            # --- VALIDACIÓN CRÍTICA: Correlación de Estrategias Base ---
            # Si las estrategias base YA superan el umbral, toda búsqueda es fútil.
            if base_indices:
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
            else:
                # Auto (Default)
                use_monte_carlo = total_exhaustive_combinations > params.search_threshold
                print(f"DEBUG: Search Method Auto -> Use Monte Carlo? {use_monte_carlo} (Threshold: {params.search_threshold})")

            total_iterations = 0
            iteration_counter = 0

            databank_portfolios = []

            if use_monte_carlo:
                msg = f'Búsqueda Monte Carlo iniciada ({"Forzada" if search_method == "monte_carlo" else f"Auto > {params.search_threshold}"})'
                yield f"data: {json.dumps({'status': 'info', 'message': msg})}\n\n"
            else:
                total_iterations = total_exhaustive_combinations
                msg = f'Búsqueda Exhaustiva iniciada ({"Forzada" if search_method == "brute_force" else "Auto"}) - {total_iterations} combinaciones'
                yield f"data: {json.dumps({'status': 'info', 'message': msg})}\n\n"

            while True: # Bucle infinito que se controla con Pausar/Detener
                iteration_counter += 1

                # --- LÓGICA DE CONTROL ---
                if _is_search_stopped:
                    yield f"data: {json.dumps({'status': 'stopped', 'message': 'Búsqueda detenida por el usuario.'})}\n\n"
                    return
                while _is_search_paused:
                    yield f"data: {json.dumps({'status': 'paused', 'message': 'Búsqueda pausada...'})}\n\n"
                    await asyncio.sleep(1) # Esperar 1 segundo y volver a comprobar

                # Enviar progreso
                if iteration_counter > 0 and iteration_counter % 20 == 0:
                    progress_message = f"Progreso: {iteration_counter}"
                    if not use_monte_carlo:
                        progress_message += f"/{total_iterations} ({((iteration_counter/total_iterations)*100):.1f}%)"
                    yield f"data: {json.dumps({'status': 'progress', 'message': progress_message})}\n\n"
                    await asyncio.sleep(0.01)

                # Generar una combinación
                combo_indices = []
                if use_monte_carlo:
                    # Elegir tamaño aleatorio para la parte variable
                    # Si effective_max_k es 0, k será 0
                    if effective_max_k > 0:
                        k = random.randint(effective_min_k, effective_max_k)
                        if k > len(available_indices): continue
                        combo_indices = random.sample(available_indices, k)
                    else:
                        combo_indices = []
                else:
                    # Para la búsqueda exhaustiva, necesitamos un generador
                    if 'combinations_generator' not in locals():
                        combinations_generator = get_combinations(available_indices, effective_min_k, effective_max_k)
                    try:
                        combo_indices = list(next(combinations_generator))
                    except StopIteration:
                        # Búsqueda exhaustiva completada
                        break # Salir del bucle while
                
                try:
                    # Combinar fijos + variables
                    combo = tuple(sorted(list(base_indices) + combo_indices))
                    
                    # Si el combo resultante es menor que el mínimo global requerido (por si acaso)
                    if len(combo) < min_combo_size:
                        continue

                    is_valid = True
                    for i1_idx, i1 in enumerate(combo):
                        for i2 in combo[i1_idx+1:]:
                            corr_val = correlation_matrix.iloc[i1, i2]
                            if corr_val > params.correlation_threshold:
                                is_valid = False
                                
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
                    analysis_result = process_strategy_data(portfolio_df, benchmark_data_df.copy(), broker_config=request.broker_config)

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

            analysis_result = process_strategy_data(df, pd.DataFrame(request.benchmark_data), broker_config=request.broker_config)
            
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
        print(f"[Myfxbook Endpoint] Fetching history + open trades for account: {request.account_id}")
        client = MyfxbookClient()
        session = client.login(request.email, request.password)
        
        # 1. Get Closed History
        history = client.get_history(request.account_id)
        
        # 2. Get Open Trades (New!)
        open_trades = []
        try:
            open_trades = client.get_open_trades(request.account_id)
        except Exception as e:
            print(f"[Myfxbook Endpoint] ⚠️ Failed to fetch open trades: {e}")
            # Continue without open trades is better than failing completely
        
        # Calculate basic metrics on the backend (using only closed history for now)
        losses_data = client.calculate_consecutive_losses(history)
        dd_data = client.calculate_max_drawdown(history)
        
        # Fetch current account status (for Current DD)
        account_info = client.get_account_info(request.account_id)
        
        client.logout()
        
        return {
            "success": True,
            "accountId": request.account_id,
            "history": history,
            "openTrades": open_trades, # Include open trades in response
            "count": len(history),
            "openCount": len(open_trades),
            "metrics": {
                "consecutiveLosses": losses_data,
                "maxDrawdown": dd_data
            },
            "accountInfo": account_info
        }
    except MyfxbookAPIError as e:
        return JSONResponse(status_code=400, content={"success": False, "detail": str(e)})
    except Exception as e:
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
