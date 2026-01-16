import { initializeEventListeners } from './events.js';
import { populateViewSelector } from './modules/viewManager.js';
import { loadMagicNumbers, loadSavedPortfolios, loadQuarantineList } from './state.js';
import { displaySavedPortfoliosList } from './ui.js?v=2';
import { initBrokerUI } from './modules/brokerUI.js';

document.addEventListener('DOMContentLoaded', () => {
    // 0. Cargar estado persistente
    loadMagicNumbers();
    loadQuarantineList(); // Load Quarantine
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