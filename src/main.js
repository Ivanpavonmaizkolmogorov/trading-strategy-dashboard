import { initializeEventListeners } from './events.js';
import { populateViewSelector } from './modules/viewManager.js';
import { loadMagicNumbers } from './state.js';

document.addEventListener('DOMContentLoaded', () => {
    // 0. Cargar estado persistente
    loadMagicNumbers();

    // 1. Poblar los selectores de vistas al inicio
    populateViewSelector('databank');
    populateViewSelector('saved');

    // 2. Conectar todos los eventos de la UI
    initializeEventListeners();
});