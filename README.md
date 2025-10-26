# Dashboard Comparativo de Estrategias de Trading

Esta es una herramienta web interactiva para el análisis y comparación de múltiples estrategias de trading. Permite a los usuarios subir sus propios historiales de trades en formato CSV, compararlos contra un activo de referencia (benchmark) y encontrar las mejores combinaciones de portafolios.

## ✨ Características Principales

*   **Carga Múltiple:** Sube y analiza varias estrategias de trading simultáneamente.
*   **Análisis contra Benchmark:** Compara el rendimiento de tus estrategias contra un activo de referencia (ej. SPY, BTCUSD).
*   **Métricas Detalladas:** Calcula más de 20 métricas de rendimiento clave, incluyendo Profit Factor, Sharpe Ratio, Sortino, UPI, Max Drawdown, y más.
*   **DataBank de Portafolios:** Busca automáticamente combinaciones de estrategias (portafolios) que optimicen una métrica seleccionada, filtrando por correlación.
*   **Optimización de Pesos:** Realiza simulaciones de Monte Carlo para encontrar los pesos óptimos dentro de un portafolio guardado.
*   **Visualización Interactiva:** Gráficos de equity, dispersión de rendimientos, y curvas de Lorenz para un análisis visual profundo.
*   **Gestión de Vistas:** Personaliza las columnas visibles en las tablas de DataBank y Portafolios Guardados.
*   **Importar/Exportar:** Guarda y carga todo tu espacio de trabajo, incluyendo archivos, portafolios y configuraciones.

## 🚀 Ejecución Simplificada (Recomendado)

1.  **Instala las dependencias** (solo la primera vez):
    ```bash
    pip install -r requirements.txt
    ```
2.  **Ejecuta el lanzador:**
    *   **Windows**: Haz doble clic en el archivo `start.bat`.
    *   **Mac/Linux**:
        *   **Desde la terminal (fiable):** Abre una terminal, asegúrate de que el script tiene permisos de ejecución (`chmod +x start.sh`) y lánzalo con `./start.sh`.
        *   **Con doble clic (Kubuntu, Gnome, etc.):**
            1.  Haz clic derecho sobre `start.sh` y ve a `Propiedades`.
            2.  En la pestaña `Permisos`, marca la casilla **"Es ejecutable"**.
            3.  Ahora, al hacer doble clic, el script se ejecutará. Si el sistema te pregunta, elige "Ejecutar".

3.  La aplicación se abrirá automáticamente en tu navegador en `http://localhost:8001`.

## 🛠️ Cómo Usar la Aplicación

Una vez que la aplicación esté en marcha:

1.  **Sube tus Estrategias:** Haz clic en "Subir Estrategias" y selecciona uno o más archivos CSV.
2.  **Sube tu Activo:** Haz clic en "Subir Activo" y selecciona un CSV con el historial de precios del benchmark.
3.  **Analiza:** Presiona "Analizar" para ver las métricas individuales.
4.  **Explora el DataBank:** Usa "Buscar en DataBank" para descubrir portafolios óptimos.

## 🛠️ Tecnologías Utilizadas

*   **HTML5** y **CSS3** con **Tailwind CSS** para la interfaz.
*   **JavaScript (ESM)** para toda la lógica de la aplicación.
*   **Chart.js** para la visualización de datos.
*   **PapaParse** para el parseo de archivos CSV en el navegador.
