#!/bin/bash
echo "Starting MyFxbook Isolated Viewer..."
echo "Access at: http://localhost:8002"
cd myfx_playground || exit

# Try to use the project's virtual environment if it exists
if [ -d "../venv" ]; then
    ../venv/bin/python viewer.py
else
    # Fallback to system python
    python3 viewer.py
fi
