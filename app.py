from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional, Union
import json
import asyncio, traceback, os
import pandas as pd
import numpy as np
import random

# Importar nuestro nuevo motor de análisis
from analysis_engine import process_strategy_data, get_combinations, add_to_databank_if_better, count_combinations

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
    metric_name: str # <-- Añadimos el nombre legible de la métrica
    search_threshold: int

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

                # --- LÓGICA DE NORMALIZACIÓN CORREGIDA: Se aplica por portafolio ---
                if p_def.is_risk_normalized and p_def.normalization_target_value and p_def.normalization_target_value > 0:
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
                result_obj = {
                    "metrics": metrics_payload, # The metrics are now directly in this property
                    "is_saved_portfolio": p_def.is_saved_portfolio,
                    "saved_index": p_def.saved_index,
                    "is_current_portfolio": p_def.is_current_portfolio,
                    "is_databank_portfolio": p_def.is_databank_portfolio,
                    "databank_index": p_def.databank_index,
                    "portfolio_id": p_def.portfolio_id
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
            use_monte_carlo = total_exhaustive_combinations > params.search_threshold

            total_iterations = 0
            iteration_counter = 0

            databank_portfolios = []

            if use_monte_carlo:
                yield f"data: {json.dumps({'status': 'info', 'message': f'Búsqueda Monte Carlo iniciada (Total > {params.search_threshold})'})}\n\n"
            else:
                total_iterations = total_exhaustive_combinations
                yield f"data: {json.dumps({'status': 'info', 'message': f'Búsqueda Exhaustiva iniciada ({total_iterations} combinaciones)'})}\n\n"

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
                            # Log rejection for larger portfolios to debug user issue
                            if len(combo) >= 5:
                                print(f"DEBUG: Rejected combo {combo} due to correlation {corr_val:.2f} > {params.correlation_threshold} between {i1} and {i2}", flush=True)
                            break
                    if not is_valid:
                        break
                
                if not is_valid:
                    continue

                if len(combo) >= 5:
                    print(f"DEBUG: Accepted combo {combo} (size {len(combo)})", flush=True)

                portfolio_trades = []
                for strat_index in combo:
                    # Simplemente añadimos todos los trades de las estrategias seleccionadas
                    portfolio_trades.extend(strategies_data[strat_index])
                
                portfolio_df = pd.DataFrame(portfolio_trades)
                analysis_result = process_strategy_data(portfolio_df, benchmark_data_df.copy(), broker_config=request.broker_config)

                if analysis_result:
                    metrics, _ = analysis_result
                    # yield f"data: {json.dumps({'status': 'info', 'message': f'DEBUG: Portfolio analyzed. Metrics keys: {list(metrics.keys())}'})}\n\n"
                    if metrics and params.metric_to_optimize_key in metrics:
                        portfolio_data = {
                            "metricValue": metrics[params.metric_to_optimize_key],
                            "metricName": params.metric_name, # <-- Enviamos el nombre de la métrica
                            "indices": list(combo),
                            "metrics": metrics,
                            "optimizationGoal": params.optimization_goal
                        }
                        
                        old_len = len(databank_portfolios)
                        databank_portfolios = add_to_databank_if_better(databank_portfolios, portfolio_data, params.max_size)
                        
                        if len(databank_portfolios) > old_len or any(p['indices'] == list(combo) for p in databank_portfolios):
                            yield f"data: {json.dumps(portfolio_data, cls=CustomJSONEncoder)}\n\n"

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
    """
    print("\n--- Endpoint /analysis/optimize-portfolio HIT ---")
    try:
        params = request.params
        strategies_data = [[trade.model_dump() for trade in strat if trade.pnl is not None] for strat in request.strategies_data]
        benchmark_data_df = pd.DataFrame(request.benchmark_data)
        
        portfolio_trades_data = [strategies_data[i] for i in request.portfolio_indices]
        num_strategies = len(portfolio_trades_data)

        def analyze_combination(weights: List[float]):
            """Función helper para analizar una combinación de pesos."""
            portfolio_trades = []
            for i, trades in enumerate(portfolio_trades_data):
                weight = weights[i]
                # --- CORRECCIÓN FINALÍSIMA Y DEFINITIVA ---
                # Si un trade en el CSV tiene un PnL vacío, trade['pnl'] será None.
                # `None * weight` lanza un TypeError, que causa el error 500 de serialización.
                # Nos aseguramos de que solo procesamos trades con un PnL válido.
                for trade in trades:
                    if trade.get('pnl') is not None:
                        new_trade = trade.copy()
                        new_trade['pnl'] *= weight
                        portfolio_trades.append(new_trade)
            
            if not portfolio_trades:
                return None, None
            
            # --- CORRECCIÓN DEFINITIVA: Convertir Timestamps a strings aquí ---
            # Al convertir los Timestamps a strings inmediatamente después de crear el DataFrame,
            # nos aseguramos de que cualquier operación posterior, incluida la gestión de errores,
            # trabaje con datos que ya son serializables por JSON. Esto previene el error
            # "Object of type Timestamp is not JSON serializable" si ocurre una excepción más adelante.
            trades_to_analyze_df = pd.DataFrame(portfolio_trades)

            # --- CORRECCIÓN FINALÍSIMA: Comprobar si el DF está vacío ANTES de manipularlo ---
            # Si un portafolio se compone de estrategias sin trades, el DF estará vacío.
            # Intentar acceder a df['entry_date'] lanzará un KeyError, causando el error 500.
            if trades_to_analyze_df.empty:
                return None, [] # Devolver explícitamente que no hay métricas ni trades.
            
            # --- CORRECCIÓN FINALÍSIMA Y ABSOLUTAMENTE DEFINITIVA ---
            # Eliminamos la conversión de fechas aquí. Dejamos que process_strategy_data sea el único responsable.
            # Esto evita el conflicto de formatos que causaba el error.


            # Aplicar escalado de riesgo si es necesario (ahora sobre un DF con fechas como strings)
            if request.is_risk_normalized and request.normalization_target_value and request.normalization_target_value > 0:
                pre_analysis_df = trades_to_analyze_df.copy() # Usar la copia ya convertida
                pre_analysis_result = process_strategy_data(pre_analysis_df, benchmark_data_df.copy(), broker_config=request.broker_config)
                if pre_analysis_result:
                    metric_key = 'maxDrawdownInDollars' if request.normalization_metric == 'max_dd' else 'ulcerIndexInDollars'
                    current_metric_value = pre_analysis_result[0].get(metric_key, 0)

                    if current_metric_value > 0:
                        scale_factor = request.normalization_target_value / current_metric_value
                        trades_to_analyze_df['pnl'] *= scale_factor

            final_df = trades_to_analyze_df
            analysis_result = process_strategy_data(final_df, benchmark_data_df.copy(), broker_config=request.broker_config)
            
            # --- CORRECCIÓN IRREFUTABLE ---
            # El análisis convierte las fechas a Timestamps. ANTES de devolver los trades,
            # los volvemos a convertir a strings en formato ISO, que es compatible con JSON.
            final_df['entry_date'] = final_df['entry_date'].dt.strftime('%Y-%m-%dT%H:%M:%S')
            final_df['exit_date'] = final_df['exit_date'].dt.strftime('%Y-%m-%dT%H:%M:%S')
            trades_as_dict = final_df.to_dict('records')
            
            # --- CORRECCIÓN FINAL Y DEFINITIVA ---
            # Desempaquetamos la tupla devuelta por process_strategy_data. Solo necesitamos las métricas.
            metrics = analysis_result[0] if analysis_result else None
            return metrics, trades_as_dict

        # 1. Analizar la versión con pesos iguales (base)
        equal_weights = [1.0 / num_strategies] * num_strategies
        base_metrics, base_trades = analyze_combination(equal_weights) # base_metrics ya incluye lorenzData, etc.
        
        print(f"--- [OPTIMIZE-LOG] 1. Análisis base completado. ¿Métricas obtenidas?: {bool(base_metrics)}")
        if base_metrics:
            print(f"--- [OPTIMIZE-LOG] 1.1. Métricas base: Ret/DD={base_metrics.get('profitMaxDD_Ratio', 'N/A')}, MaxDD$={base_metrics.get('maxDrawdownInDollars', 'N/A')}")

        if not base_metrics:
            raise HTTPException(status_code=400, detail="No se pudo analizar el portafolio base (pesos iguales).")

        original_target_metric_value = base_metrics.get(params.target_metric) # Usar .get() para evitar KeyError

        # Inicializar los mejores resultados
        metric_best_result = {'metric_val': -np.inf if params.target_goal == 'maximize' else np.inf, 'weights': equal_weights, 'metrics': base_metrics, 'trades': base_trades}
        balanced_best_result = {'avg_improvement': -np.inf, 'weights': equal_weights, 'metrics': base_metrics, 'trades': base_trades}

        # --- MEJORA: Analizar también la composición de pesos actual del portafolio ---
        # Si el portafolio ya tiene pesos, los usamos como punto de partida para "metric_best"
        # y "balanced_best", en lugar de los pesos iguales.
        # --- CORRECCIÓN DEFINITIVA: Eliminar la lógica errónea ---
        # Si num_simulations es 0, el bucle de abajo no se ejecuta y simplemente se devuelve el "baseAnalysis"
        # con pesos iguales, que es exactamente lo que el frontend necesita para el estado inicial.
        print(f"--- [OPTIMIZE-LOG] 2. Número de simulaciones a ejecutar: {params.num_simulations}")

        # 2. Bucle de simulación Monte Carlo
        for i in range(params.num_simulations): # Si num_simulations es 0, este bucle no se ejecuta.
            # Generar pesos aleatorios
            weights = np.random.random(num_strategies)
            weights /= np.sum(weights)
            
            # Validar peso mínimo
            if np.any(weights < params.min_weight):
                continue

            current_metrics, current_trades = analyze_combination(weights.tolist())
            if not current_metrics:
                continue

            # 3. Comprobar si es el mejor para la métrica objetivo
            current_metric_val = current_metrics[params.target_metric]
            if i % 1000 == 0: # Loguear de vez en cuando para no saturar
                print(f"--- [OPTIMIZE-LOG] 2.1. Simulación {i}: Métrica Objetivo '{params.target_metric}' = {current_metric_val:.2f}")

            is_metric_better = (params.target_goal == 'maximize' and current_metric_val > metric_best_result['metric_val']) or \
                               (params.target_goal == 'minimize' and current_metric_val < metric_best_result['metric_val'])
            
            if is_metric_better:
                metric_best_result = {'metric_val': current_metric_val, 'weights': weights.tolist(), 'metrics': current_metrics, 'trades': current_trades}

            # 4. Comprobar si es el mejor para el balance general
            # CORRECCIÓN: Asegurarse de que original_target_metric_value no sea None
            is_better_than_original_on_target = False
            if original_target_metric_value is not None:
                is_better_than_original_on_target = (params.target_goal == 'maximize' and current_metric_val >= original_target_metric_value) or \
                                                    (params.target_goal == 'minimize' and current_metric_val <= original_target_metric_value)

            if is_better_than_original_on_target:
                total_improvement = 0
                improvement_count = 0
                for metric_key in params.metrics_for_balance:
                    original_value = base_metrics.get(metric_key)
                    optimized_value = current_metrics.get(metric_key)
                    if original_value is not None and optimized_value is not None and np.isfinite(original_value) and np.isfinite(optimized_value) and original_value != 0:
                        is_minimizing = 'drawdown' in metric_key.lower() or 'loss' in metric_key.lower() or 'stagnation' in metric_key.lower()
                        improvement = ((original_value - optimized_value) / abs(original_value)) * 100 if is_minimizing else ((optimized_value - original_value) / abs(original_value)) * 100
                        total_improvement += improvement
                        improvement_count += 1
                
                avg_improvement = total_improvement / improvement_count if improvement_count > 0 else 0
                if avg_improvement > balanced_best_result['avg_improvement']:
                    balanced_best_result = {'avg_improvement': avg_improvement, 'weights': weights.tolist(), 'metrics': current_metrics, 'trades': current_trades}

        # 5. Preparar la respuesta final
        final_response = {
            "baseAnalysis": { "metrics": base_metrics, "trades": base_trades, "weights": equal_weights },
            "metricBestAnalysis": { "metrics": metric_best_result['metrics'], "trades": metric_best_result['trades'], "weights": metric_best_result['weights'] },
            "balancedBestAnalysis": { "metrics": balanced_best_result['metrics'], "trades": balanced_best_result['trades'], "weights": balanced_best_result['weights'] }
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
    Login and fetch full history for a specific account.
    """
    try:
        print(f"[Myfxbook Endpoint] Fetching history for account: {request.account_id}")
        client = MyfxbookClient()
        session = client.login(request.email, request.password)
        
        history = client.get_history(request.account_id)
        
        # Calculate basic metrics on the backend
        losses_data = client.calculate_consecutive_losses(history)
        dd_data = client.calculate_max_drawdown(history)
        
        # Fetch current account status (for Current DD)
        account_info = client.get_account_info(request.account_id)
        
        client.logout()
        
        return {
            "success": True,
            "accountId": request.account_id,
            "history": history,
            "count": len(history),
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

