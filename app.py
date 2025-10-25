from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import json
import asyncio
import pandas as pd
import numpy as np

# Importar nuestro nuevo motor de análisis
from analysis_engine import process_strategy_data, get_combinations, add_to_databank_if_better

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

class DatabankRequest(BaseModel):
    strategy_names: List[str] # <-- Añadimos los nombres de las estrategias
    strategies_data: List[List[Trade]]
    benchmark_data: List[Dict[str, Any]]
    params: DatabankParams

# --- Codificador JSON Personalizado y Robusto ---
class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (np.integer, np.int64)):
            return int(obj)
        if isinstance(obj, (np.floating, np.float64)):
            # Si es NaN o Inf, lo convertimos a None (null en JSON)
            if np.isnan(obj) or np.isinf(obj):
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

# --- Endpoints de la API ---
@app.get("/")
def read_root():
    return {"message": "¡Hola! El backend de Python está funcionando."}

from fastapi.responses import StreamingResponse

@app.post("/databank/find-portfolios-stream")
async def find_portfolios_stream_endpoint(request: DatabankRequest):
    
    async def event_generator():
        print("✅ Petición de streaming recibida. Iniciando cálculos...")
        params = request.params
        try:
            strategies_data = [[trade.model_dump() for trade in strat if trade.pnl is not None] for strat in request.strategies_data]
            benchmark_data_df = pd.DataFrame(request.benchmark_data)

            individual_analyses = []
            for strat_trades in strategies_data:
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

            correlation_matrix = pd.concat(individual_analyses, axis=1).corr()

            num_strategies = len(strategies_data)
            indices = list(range(num_strategies))
            max_combo_size = min(num_strategies, 12)
            combinations_generator = get_combinations(indices, 2, max_combo_size)

            databank_portfolios = []
            
            for i, combo in enumerate(combinations_generator):
                if i % 1000 == 0:
                    await asyncio.sleep(0.01)

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
                equal_weight = 1 / len(combo)
                for strat_index in combo:
                    for trade in strategies_data[strat_index]:
                        new_trade = trade.copy()
                        new_trade['pnl'] *= equal_weight
                        portfolio_trades.append(new_trade)
                
                portfolio_df = pd.DataFrame(portfolio_trades)
                analysis_result = process_strategy_data(portfolio_df, benchmark_data_df.copy())

                if analysis_result:
                    metrics, _ = analysis_result
                    if metrics and params.metric_to_optimize_key in metrics:
                        portfolio_data = {
                            "metricValue": metrics[params.metric_to_optimize_key],
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
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'status': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
