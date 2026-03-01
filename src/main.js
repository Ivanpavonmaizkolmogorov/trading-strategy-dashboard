import { initializeEventListeners } from './events.js?v=10';
import { populateViewSelector } from './modules/viewManager.js';
import { loadMagicNumbers, loadSavedPortfolios, loadQuarantineList } from './state.js';
import { displaySavedPortfoliosList } from './ui.js?v=6';
import { initBrokerUI } from './modules/brokerUI.js';

document.addEventListener('DOMContentLoaded', () => {
    // 0. Cargar estado persistente
    loadMagicNumbers();
    loadQuarantineList(); // Load Quarantine
    loadSavedPortfolios(); // Re-enabled to fix '0 portfolios' issue

    // 1. Poblar los selectores de vistas al inicio
    populateViewSelector('databank');
    populateViewSelector('saved');

    // 2. Conectar todos los eventos de la UI
    initializeEventListeners();
    initBrokerUI();

    // 3. Renderizar portafolios guardados
    displaySavedPortfoliosList();
});