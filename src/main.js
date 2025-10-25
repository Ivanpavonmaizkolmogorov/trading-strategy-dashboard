import { initializeEventListeners } from './events.js';
import { populateViewSelector } from './modules/viewManager.js';

document.addEventListener('DOMContentLoaded', () => {
    // 1. Poblar los selectores de vistas al inicio
    populateViewSelector('databank');
    populateViewSelector('saved');

    // 2. Conectar todos los eventos de la UI
    initializeEventListeners();
});