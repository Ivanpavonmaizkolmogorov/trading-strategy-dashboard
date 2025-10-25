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

## 🚀 Cómo Usarlo

1.  **Visita la página:** [Accede a la herramienta aquí](https://ivanpavonmaizkolmogorov.github.io/trading-strategy-dashboard/)
2.  **Sube tus Estrategias:** Haz clic en el área "Subir Estrategias" y selecciona uno o más archivos CSV con tus trades.
3.  **Sube tu Activo:** Haz clic en "Subir Activo" y selecciona un CSV con el historial de precios del benchmark.
4.  **Analiza:** Presiona el botón "Analizar" para ver las métricas individuales y las pestañas de análisis detallado.
5.  **Crea Portafolios:** Selecciona varias estrategias en la tabla de resumen para ver su rendimiento combinado.
6.  **Explora el DataBank:** Usa la función "Buscar en DataBank" para descubrir portafolios óptimos automáticamente.

## 🛠️ Tecnologías Utilizadas

*   **HTML5** y **CSS3** con **Tailwind CSS** para la interfaz.
*   **JavaScript (ESM)** para toda la lógica de la aplicación.
*   **Chart.js** para la visualización de datos.
*   **PapaParse** para el parseo de archivos CSV en el navegador.
