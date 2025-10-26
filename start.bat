@echo off
title Trading Strategy Dashboard

echo Starting the Trading Strategy Dashboard...

REM Comprobar si existe un entorno virtual y activarlo
IF EXIST venv\Scripts\activate.bat (
    echo Activating virtual environment...
    call venv\Scripts\activate.bat
) ELSE (
    echo Virtual environment 'venv' not found. Running with system Python.
    echo It is recommended to install dependencies in a virtual environment.
)

echo Launching the backend server on http://localhost:8001
REM Usamos 'start' para no bloquear esta consola
start "Trading Dashboard Server" uvicorn app:app --host 0.0.0.0 --port 8001

echo Waiting for the server to start...
timeout /t 3 /nobreak > nul

echo Opening the application in your default browser...
start http://localhost:8001

echo.
echo The server is running. You can close this window to stop the application.