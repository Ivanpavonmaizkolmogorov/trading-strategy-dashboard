#!/bin/bash
echo "Starting the Trading Strategy Dashboard..."

# --- LÓGICA DE DETECCIÓN DE NAVEGADOR A PRUEBA DE FALLOS ---
function open_url_in_browser() {
    local url_to_open=$1
    # Busca navegadores comunes en orden de prioridad
    for browser in google-chrome-stable google-chrome brave-browser firefox chromium-browser chromium; do
        if command -v "$browser" &> /dev/null; then
            "$browser" "$url_to_open" &
            return 0
        fi
    done

    # Como último recurso, usa los comandos genéricos del sistema
    command -v xdg-open &> /dev/null && xdg-open "$url_to_open" & return 0
    command -v open &> /dev/null && open "$url_to_open" & return 0

    echo "No se pudo encontrar un navegador para abrir la URL. Por favor, abre manualmente: $url_to_open"
    return 1
}

# --- LÓGICA DE ARRANQUE INTELIGENTE ---
BASE_PORT=8001
PORT=$BASE_PORT
LOG_FILE="server.log"

# Buscar un puerto libre
while lsof -i :$PORT > /dev/null; do
    echo "El puerto $PORT está en uso. Probando el siguiente..."
    PORT=$((PORT + 1))
done

echo "Puerto libre encontrado: $PORT"
URL="http://localhost:$PORT"

# Activar entorno virtual si existe
if [ -f "venv/bin/activate" ]; then
    echo "Activando entorno virtual..."
    source venv/bin/activate
else
    echo "Entorno virtual 'venv' no encontrado. Usando Python del sistema."
fi

echo "Lanzando el servidor backend en $URL"
echo "Los logs del servidor se guardarán en: $LOG_FILE"

# Ejecutar uvicorn en segundo plano y redirigir su salida a un archivo de log
uvicorn app:app --host 0.0.0.0 --port $PORT > "$LOG_FILE" 2>&1 &

# Guardar el ID del proceso de uvicorn para poder detenerlo después
UVICORN_PID=$!

# Función para limpiar al salir
cleanup() {
    echo -e "\nDeteniendo el servidor (PID: $UVICORN_PID)..."
    kill $UVICORN_PID
    echo "Servidor detenido."
    exit
}

# Capturar la señal de salida (Ctrl+C) para limpiar
trap cleanup INT

# --- COMPROBACIÓN DE ARRANQUE DEL SERVIDOR ---
echo "Esperando a que el servidor inicie... (PID: $UVICORN_PID)"
for i in {1..10}; do
    # Usamos curl para comprobar si el servidor está respondiendo
    if curl -s --head http://localhost:$PORT > /dev/null; then
        echo "¡Servidor iniciado con éxito!"
        open_url_in_browser "$URL"
        
        echo ""
        echo "El servidor se está ejecutando en segundo plano."
        echo "Para detenerlo, presiona Ctrl+C en esta terminal."

        # Esperar a que el proceso de uvicorn termine
        wait $UVICORN_PID
        exit 0
    fi
    sleep 1
done

# Si el bucle termina, el servidor no se inició
echo "-----------------------------------------------------"
echo "❌ ERROR: El servidor no pudo iniciarse en 10 segundos."
echo "Por favor, revisa el archivo '$LOG_FILE' para ver los detalles del error."
echo "-----------------------------------------------------"
# Detener el proceso fallido si aún existe
kill $UVICORN_PID 2>/dev/null
exit 1
