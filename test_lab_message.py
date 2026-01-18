
# Mock objects
class MockRequest:
    strategy_names = [f"Strat{i}" for i in range(100)]

class MockParams:
    objective = 'lab'
    base_indices = [0, 1, 2, 3, 4]
    search_threshold = 1000

request = MockRequest()
params = MockParams()
iteration_counter = 20
total_iterations = 1000
use_monte_carlo = True
stats_checked = 100
stats_rejected_corr = 10
stats_rejected_sat_corr = 5
base_indices = params.base_indices

# --- LOGIC FROM APP.PY ---

# Initialize Lab Mode tracker variable
current_base_subset = [] 
# Simulate it being populated in a previous step (or seemingly not?)
# Scenario A: It is empty (first pass)
# Scenario B: It has values

scenarios = [
    ("Empty Subset", []),
    ("Populated Subset", [0, 2])
]

for name, subset in scenarios:
    current_base_subset = subset
    print(f"\n--- Scenario: {name} ---")
    
    # ... inside loop ...
    
    # Build detailed stats message
    stats_msg = f" | Total: {stats_checked} | Correlación: -{stats_rejected_corr} | SatCorr: -{stats_rejected_sat_corr}"
    
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

    print(f"Generated Message: {progress_message}")
