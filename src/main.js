import { initializeEventListeners } from './events.js';
import { populateViewSelector } from './modules/viewManager.js';
import { loadMagicNumbers, loadSavedPortfolios } from './state.js';
import { displaySavedPortfoliosList } from './ui.js';
import { initBrokerUI } from './modules/brokerUI.js';

document.addEventListener('DOMContentLoaded', () => {
    // 0. Cargar estado persistente
    loadMagicNumbers();
    // loadSavedPortfolios(); // Disabled by user request for clean slate on reload

    // 1. Poblar los selectores de vistas al inicio
    populateViewSelector('databank');
    populateViewSelector('saved');

    // 2. Conectar todos los eventos de la UI
    initializeEventListeners();
    initBrokerUI();

    // 3. Renderizar portafolios guardados
    displaySavedPortfoliosList();
});