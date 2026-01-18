
import json
import numpy as np
import pandas as pd

class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (np.integer, np.int64)):
            return int(obj)
        if isinstance(obj, (np.floating, np.float64)):
            if not np.isfinite(obj):
                return None
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super(CustomJSONEncoder, self).default(obj)

data = {
    "numpy_nan": np.nan,
    "python_nan": float('nan'),
    "numpy_inf": np.inf,
    "python_inf": float('inf')
}

try:
    print(f"JSON Output: {json.dumps(data, cls=CustomJSONEncoder)}")
except Exception as e:
    print(f"Error: {e}")
