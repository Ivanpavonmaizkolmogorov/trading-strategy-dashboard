from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import json
import asyncio, traceback, os
import pandas as pd
import numpy as np
import random

# Importar nuestro nuevo motor de análisis
from analysis_engine import process_strategy_data, get_combinations, add_to_databank_if_better, count_combinations

# --- Modelos de Datos (Pydantic) ---
class Trade(BaseModel):
    entry_date: Optional[Any] = None
    exit_date: Optional[Any] = None
    pnl: Optional[float] = None

    class Config:
        extra = 'allow'

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
    benchmark_data: List[Dict[str, Any]]
    params: DatabankParams

class PortfolioDefinition(BaseModel):
    indices: List[int]
    weights: Optional[List[float]] = None
    # Añadimos campos para identificar el portafolio en el frontend
    is_saved_portfolio: bool = False
    saved_index: Optional[int] = None
    portfolio_id: Optional[int] = None
    is_current_portfolio: bool = False
    is_databank_portfolio: bool = False
    databank_index: Optional[int] = None
    # --- CORRECCIÓN DEFINITIVA: Añadir los campos de normalización que faltaban ---
    is_risk_normalized: Optional[bool] = False
    normalization_metric: Optional[str] = None
    normalization_target_value: Optional[float] = None


class FullAnalysisRequest(BaseModel): # Contenido movido a PortfolioDefinition
    strategies_data: List[List[Trade]]
    benchmark_data: List[Dict[str, Any]]
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
    benchmark_data: List[Dict[str, Any]]
    params: OptimizationParams
    is_risk_normalized: bool = False
    normalization_metric: Optional[str] = None
    normalization_target_value: Optional[float] = None


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
        return super(CustomJSONEncoder, self).default(obj)

# --- Configuración de la App FastAPI ---
app = FastAPI()

origins = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
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
        strategies_data = [[trade.model_dump() for trade in strat if trade.pnl is not None] for strat in request.strategies_data]
        benchmark_data_df = pd.DataFrame(request.benchmark_data)
        print(f"Received {len(strategies_data)} strategies and benchmark with {len(benchmark_data_df)} rows.")

        # --- CORRECCIÓN ARQUITECTURAL CLAVE ---
        # 1. Pre-procesar todas las estrategias y guardar sus DataFrames de trades.
        processed_strategy_dfs = []
        for i, strat_trades in enumerate(strategies_data):
            print(f"  Processing strategy {i+1}/{len(strategies_data)}...")
            trades_df = pd.DataFrame(strat_trades) if strat_trades else pd.DataFrame()
            if trades_df.empty:
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
                weights = p_def.weights if p_def.weights else [1/len(p_def.indices)] * len(p_def.indices)
                
                for i, strat_idx in enumerate(p_def.indices):
                    if strat_idx < len(processed_strategy_dfs):
                        # --- CORRECCIÓN CLAVE ---
                        # Usar los DFs originales (sin escalar) para construir el portafolio.
                        weight = weights[i]
                        strat_df = processed_strategy_dfs[strat_idx].copy()
                        if not strat_df.empty:
                            strat_df['pnl'] *= weight
                            portfolio_trades.append(strat_df)

                portfolio_df = pd.concat(portfolio_trades, ignore_index=True) if portfolio_trades else pd.DataFrame()
                trades_to_analyze_df = portfolio_df.copy() # Empezamos con una copia

                print(f"  [BACKEND-LOG] 2.{p_idx}.a -> Normalización Recibida: is_risk_normalized={p_def.is_risk_normalized}, metric='{p_def.normalization_metric}', value={p_def.normalization_target_value}")

                # --- LÓGICA DE NORMALIZACIÓN CORREGIDA: Se aplica por portafolio ---
                if p_def.is_risk_normalized and p_def.normalization_target_value and p_def.normalization_target_value > 0:
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

            individual_analyses = []
            for i, strat_trades in enumerate(strategies_data):
                if not strat_trades: continue
                
                trades_df = pd.DataFrame(strat_trades)
                analysis_result = process_strategy_data(trades_df, benchmark_data_df.copy())
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
            total_exhaustive_combinations = count_combinations(num_strategies, min_combo_size, max_combo_size)
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
                if use_monte_carlo:
                    k = random.randint(min_combo_size, max_combo_size)
                    if k > len(indices): continue
                    combo = tuple(random.sample(indices, k))
                else:
                    # Para la búsqueda exhaustiva, necesitamos un generador
                    if 'combinations_generator' not in locals():
                        combinations_generator = get_combinations(indices, min_combo_size, max_combo_size)
                    try:
                        combo = next(combinations_generator)
                    except StopIteration:
                        # Búsqueda exhaustiva completada
                        break # Salir del bucle while

                is_valid = True
                for i1_idx, i1 in enumerate(combo):
                    for i2 in combo[i1_idx+1:]:
                        if correlation_matrix.iloc[i1, i2] > params.correlation_threshold:
                            is_valid = False
                            break
                    if not is_valid:
                        break
                
                if not is_valid:
                    continue

                portfolio_trades = []
                for strat_index in combo:
                    # Simplemente añadimos todos los trades de las estrategias seleccionadas
                    portfolio_trades.extend(strategies_data[strat_index])
                
                portfolio_df = pd.DataFrame(portfolio_trades)
                analysis_result = process_strategy_data(portfolio_df, benchmark_data_df.copy())

                if analysis_result:
                    metrics, _ = analysis_result
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
                for trade in trades:
                    new_trade = trade.copy()
                    new_trade['pnl'] *= weight
                    portfolio_trades.append(new_trade)
            
            if not portfolio_trades:
                return None, None

            # Aplicar escalado de riesgo si es necesario
            trades_to_analyze_df = pd.DataFrame(portfolio_trades)
            if request.is_risk_normalized and request.normalization_target_value and request.normalization_target_value > 0:
                pre_analysis_df = pd.DataFrame([t.copy() for t in portfolio_trades])
                pre_analysis_result = process_strategy_data(pre_analysis_df, benchmark_data_df.copy())
                if pre_analysis_result:
                    metric_key = 'maxDrawdownInDollars' if request.normalization_metric == 'max_dd' else 'ulcerIndexInDollars'
                    current_metric_value = pre_analysis_result[0].get(metric_key, 0)

                    if current_metric_value > 0:
                        scale_factor = request.normalization_target_value / current_metric_value
                        trades_to_analyze_df['pnl'] *= scale_factor

            final_df = trades_to_analyze_df
            analysis_result = process_strategy_data(final_df, benchmark_data_df.copy())
            
            return (analysis_result[0] if analysis_result else None), final_df.to_dict('records')

        # 1. Analizar la versión con pesos iguales (base)
        equal_weights = [1.0 / num_strategies] * num_strategies
        base_metrics, base_trades = analyze_combination(equal_weights) # base_metrics ya incluye lorenzData, etc.
        if not base_metrics:
            raise HTTPException(status_code=400, detail="No se pudo analizar el portafolio base (pesos iguales).")

        original_target_metric_value = base_metrics[params.target_metric]

        # Inicializar los mejores resultados
        metric_best_result = {'metric_val': -np.inf if params.target_goal == 'maximize' else np.inf, 'weights': equal_weights, 'metrics': base_metrics, 'trades': base_trades}
        balanced_best_result = {'avg_improvement': -np.inf, 'weights': equal_weights, 'metrics': base_metrics, 'trades': base_trades}

        # --- MEJORA: Analizar también la composición de pesos actual del portafolio ---
        # Si el portafolio ya tiene pesos, los usamos como punto de partida para "metric_best"
        # y "balanced_best", en lugar de los pesos iguales.
        if request.params.num_simulations == 0:
            # CORRECCIÓN: La lógica para encontrar el portafolio y sus pesos era incorrecta.
            # El frontend no envía los portafolios guardados en la petición de optimización,
            # por lo que no podemos buscarlos aquí. La lógica correcta es que si el portafolio
            # tiene pesos, el frontend los use para el análisis inicial.
            # El backend ahora simplemente analiza los pesos que se le dan.
            # La lógica anterior causaba un AttributeError porque `request.strategies_data` es una lista de listas de trades,
            # y sus elementos no tienen un atributo `.indices`.
            pass # Se elimina la lógica errónea. El frontend ya gestiona el estado inicial.

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
            is_metric_better = (params.target_goal == 'maximize' and current_metric_val > metric_best_result['metric_val']) or \
                               (params.target_goal == 'minimize' and current_metric_val < metric_best_result['metric_val'])
            
            if is_metric_better:
                metric_best_result = {'metric_val': current_metric_val, 'weights': weights.tolist(), 'metrics': current_metrics, 'trades': current_trades}

            # 4. Comprobar si es el mejor para el balance general
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
        
        print("--- Optimization complete. Sending response. ---")
        return json.loads(json.dumps(final_response, cls=CustomJSONEncoder))

    except Exception as e:
        print(f"!!!!!! ERROR in /analysis/optimize-portfolio: {e} !!!!!!")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
