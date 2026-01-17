import { state, saveQuarantineList } from '../state.js';
import { dom } from '../dom.js';
import { showToast } from './notifications.js';

/**
 * Inicializa la pestaña de Cuarentena.
 */
export const initQuarantineTab = () => {
    // 1. Renderizar lista al inicio (por defecto vacía hasta que se cargue estado)
    renderQuarantineList();

    // 2. Event Listener para el botón "Añadir / Gestionar"
    const addBtn = document.getElementById('add-to-quarantine-btn');
    if (addBtn) {
        addBtn.addEventListener('click', openQuarantineManagerModal);
    }
};

/**
 * Renderiza las tarjetas de estrategias en cuarentena.
 */
export const renderQuarantineList = () => {
    const listContainer = document.getElementById('quarantine-list');
    const emptyState = document.getElementById('quarantine-empty-state');
    const badge = document.getElementById('quarantine-count-badge');
    const tabBadge = document.getElementById('quarantine-tab-count');

    if (!listContainer || !emptyState) return;

    listContainer.innerHTML = '';
    const bannedNames = Array.from(state.quarantinedStrategyNames).sort();

    // Update Badges
    const count = bannedNames.length;
    if (badge) badge.textContent = count;

    if (tabBadge) {
        tabBadge.textContent = count;
        if (count > 0) {
            tabBadge.classList.remove('hidden');
        } else {
            tabBadge.classList.add('hidden');
        }
    }

    // Show Empty State if needed
    if (bannedNames.length === 0) {
        listContainer.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    listContainer.classList.remove('hidden');
    emptyState.classList.add('hidden');

    // Create Cards
    bannedNames.forEach(name => {
        const card = document.createElement('div');
        card.className = "bg-gray-800 border border-red-900/30 rounded p-3 flex flex-col gap-2 group hover:border-red-700 hover:bg-red-900/10 transition-colors relative";

        card.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="text-sm font-mono text-gray-300 truncate" title="${name}">${name}</span>
                <button class="text-red-500 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity p-1" onclick="window.removeStrategyFromQuarantine('${name}')" title="Rehabilitar Estrategia">
                    ❌
                </button>
            </div>
            <div class="text-[10px] text-gray-500 uppercase tracking-wider">Vetada permanentemente</div>
        `;
        listContainer.appendChild(card);
    });
};

/**
 * Helper global para eliminar desde el botón de la tarjeta.
 */
window.removeStrategyFromQuarantine = (name) => {
    if (state.quarantinedStrategyNames.has(name)) {
        state.quarantinedStrategyNames.delete(name);
        saveQuarantineList();
        renderQuarantineList();
        showToast(`✅ Estrategia "${name}" rehabilitada.`, 'success');
    }
};

/**
 * Helper global para añadir a cuarentena desde cualquier botón de la UI.
 */
window.addStrategyToQuarantine = (name) => {
    if (!name) return;
    if (state.quarantinedStrategyNames.has(name)) {
        showToast(`⚠️ La estrategia "${name}" ya está en cuarentena.`, 'info');
        return;
    }

    // Confirmación simple (opcional, pero recomendada para acciones destructivas/impactantes)
    if (!confirm(`¿Estás seguro de enviar "${name}" a CUARENTENA?\n\nEsta estrategia será excluida de todos los cálculos y búsquedas futuras.`)) {
        return;
    }

    state.quarantinedStrategyNames.add(name);
    saveQuarantineList();
    renderQuarantineList();
    showToast(`☣️ Estrategia "${name}" enviada a cuarentena.`, 'success');
};

/**
 * Abre un modal simple para seleccionar estrategias a añadir a la cuarentena.
 * Reutiliza el estilo del Purge Modal o crea uno dinámico.
 */
const openQuarantineManagerModal = () => {
    // Check if modal already exists
    let modal = document.getElementById('quarantine-manager-modal');
    if (modal) modal.remove();

    // Create Modal HTML
    modal = document.createElement('div');
    modal.id = 'quarantine-manager-modal';
    modal.className = 'fixed inset-0 z-[80] flex items-center justify-center bg-gray-900/90 backdrop-blur-sm';

    // Filter available strategies (NOT in quarantine)
    const allStrategies = state.loadedStrategyFiles.map(f => f.name).sort();
    // We show ALL strategies, checking those that are already banned.
    // User can Check to BAN, Uncheck to UNBAN.

    modal.innerHTML = `
        <div class="bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col border border-gray-700">
            <div class="p-6 border-b border-gray-700 flex justify-between items-center bg-red-900/20">
                <h3 class="text-xl font-bold text-red-100 flex items-center gap-2">
                    <span>☣️</span> Gestión de Cuarentena
                </h3>
                <button id="close-quarantine-modal" class="text-gray-400 hover:text-white text-2xl">&times;</button>
            </div>
            
            <div class="p-4 bg-gray-800/50 border-b border-gray-700">
                 <input type="text" id="quarantine-search" placeholder="🔍 Filtrar estrategias..." 
                        class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none">
            </div>

            <div class="flex-1 overflow-y-auto p-2" id="quarantine-checklist-container">
                <div class="space-y-1" id="quarantine-checklist">
                    <!-- Items injected below -->
                </div>
            </div>

            <div class="p-4 border-t border-gray-700 flex justify-end gap-3 bg-gray-800">
                <button id="cancel-quarantine-btn" class="px-4 py-2 rounded text-gray-300 hover:text-white hover:bg-gray-700">Cancelar</button>
                <button id="save-quarantine-btn" class="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white font-bold shadow-lg shadow-red-900/20">
                    💾 Guardar Cambios
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Populate List
    const checklistContainer = modal.querySelector('#quarantine-checklist');

    const renderChecklist = (filterText = '') => {
        checklistContainer.innerHTML = '';
        allStrategies.forEach(name => {
            if (filterText && !name.toLowerCase().includes(filterText.toLowerCase())) return;

            const isBanned = state.quarantinedStrategyNames.has(name);

            const item = document.createElement('label');
            item.className = `flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${isBanned ? 'bg-red-900/20 border border-red-900/30' : 'hover:bg-gray-700 border border-transparent'}`;
            item.innerHTML = `
                <input type="checkbox" value="${name}" class="w-4 h-4 text-red-600 rounded bg-gray-700 border-gray-600 focus:ring-red-500" ${isBanned ? 'checked' : ''}>
                <span class="text-sm ${isBanned ? 'text-red-300 font-medium' : 'text-gray-300'}">${name}</span>
            `;
            checklistContainer.appendChild(item);
        });
    };

    renderChecklist();

    // Event Listeners
    const closeBtn = modal.querySelector('#close-quarantine-modal');
    const cancelBtn = modal.querySelector('#cancel-quarantine-btn');
    const saveBtn = modal.querySelector('#save-quarantine-btn');
    const searchInput = modal.querySelector('#quarantine-search');

    const closeModal = () => modal.remove();

    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;

    searchInput.addEventListener('input', (e) => renderChecklist(e.target.value));

    saveBtn.onclick = () => {
        const checkboxes = checklistContainer.querySelectorAll('input[type="checkbox"]');
        let addedCount = 0;
        let removedCount = 0;

        checkboxes.forEach(cb => {
            const name = cb.value;
            if (cb.checked) {
                if (!state.quarantinedStrategyNames.has(name)) {
                    state.quarantinedStrategyNames.add(name);
                    addedCount++;
                }
            } else {
                if (state.quarantinedStrategyNames.has(name)) {
                    state.quarantinedStrategyNames.delete(name);
                    removedCount++;
                }
            }
        });

        saveQuarantineList();
        renderQuarantineList(); // Update UI behind modal

        let msg = 'Actualización completada.';
        if (addedCount > 0) msg += ` +${addedCount} vetadas.`;
        if (removedCount > 0) msg += ` -${removedCount} rehabilitadas.`;

        showToast(msg, 'success');
        closeModal();
    };

    // Close on backdrop click
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
};
