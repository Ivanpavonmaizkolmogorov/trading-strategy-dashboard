import { state, saveQuarantineList } from '../state.js';
import { dom } from '../dom.js';
import { showToast } from './notifications.js';

/**
 * Inicializa la pestaña de Cuarentena.
 */
export const initQuarantineTab = () => {
    renderQuarantineList();

    const addBtn = document.getElementById('add-to-quarantine-btn');
    if (addBtn) {
        addBtn.addEventListener('click', openQuarantineManagerModal);
    }

    // Folder sync button
    const syncBtn = document.getElementById('sync-quarantine-folder-btn');
    if (syncBtn) {
        syncBtn.addEventListener('click', syncWithLiveFolder);
    }

    // Re-sync button
    const resyncBtn = document.getElementById('resync-quarantine-btn');
    if (resyncBtn) {
        resyncBtn.addEventListener('click', () => resyncWithLiveFolder());
    }
};

// --- QUARANTINE REASON HELPERS ---

const getQuarantineReason = (name) => {
    const q = state.quarantineData.get(name);
    if (!q) return null;
    if (q.manual && q.auto) return 'both';
    if (q.manual) return 'manual';
    if (q.auto) return 'auto';
    return null;
};

const getReasonBadge = (reason) => {
    switch (reason) {
        case 'manual':
            return '<span class="inline-block text-[10px] px-1.5 py-0.5 rounded bg-amber-600/30 text-amber-300 border border-amber-700/50 font-bold">🟠 Manual</span>';
        case 'auto':
            return '<span class="inline-block text-[10px] px-1.5 py-0.5 rounded bg-red-600/30 text-red-300 border border-red-700/50 font-bold">🔴 Degradación</span>';
        case 'both':
            return '<span class="inline-block text-[10px] px-1.5 py-0.5 rounded bg-purple-600/30 text-purple-300 border border-purple-700/50 font-bold">🟣 Manual + Degradación</span>';
        default:
            return '';
    }
};

// Export for use by strategiesTable.js
export { getQuarantineReason, getReasonBadge };

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
    // Build sorted list from quarantineData
    const entries = [];
    for (const [name, q] of state.quarantineData) {
        if (q.manual || q.auto) {
            entries.push({ name, ...q });
        }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    // Update Badges
    const count = entries.length;
    if (badge) badge.textContent = count;

    if (tabBadge) {
        tabBadge.textContent = count;
        if (count > 0) {
            tabBadge.classList.remove('hidden');
        } else {
            tabBadge.classList.add('hidden');
        }
    }

    // Update resync button visibility
    const resyncBtn = document.getElementById('resync-quarantine-btn');
    if (resyncBtn) {
        if (state.liveFolderPath) {
            resyncBtn.classList.remove('hidden');
            resyncBtn.title = `Re-sincronizar con: ${state.liveFolderPath}`;
        } else {
            resyncBtn.classList.add('hidden');
        }
    }

    // Show folder path
    const folderLabel = document.getElementById('quarantine-folder-label');
    if (folderLabel) {
        if (state.liveFolderPath) {
            folderLabel.textContent = `📂 ${state.liveFolderPath}`;
            folderLabel.classList.remove('hidden');
        } else {
            folderLabel.classList.add('hidden');
        }
    }

    // Show Empty State if needed
    if (entries.length === 0) {
        listContainer.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    listContainer.classList.remove('hidden');
    emptyState.classList.add('hidden');

    // Summary counters
    const manualCount = entries.filter(e => e.manual && !e.auto).length;
    const autoCount = entries.filter(e => e.auto && !e.manual).length;
    const bothCount = entries.filter(e => e.manual && e.auto).length;

    // Summary bar
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'mb-3 flex gap-3 text-xs text-gray-400';
    summaryDiv.innerHTML = `
        <span>Total: <strong class="text-white">${count}</strong></span>
        ${manualCount > 0 ? `<span class="text-amber-400">🟠 Manual: ${manualCount}</span>` : ''}
        ${autoCount > 0 ? `<span class="text-red-400">🔴 Degradación: ${autoCount}</span>` : ''}
        ${bothCount > 0 ? `<span class="text-purple-400">🟣 Ambas: ${bothCount}</span>` : ''}
    `;
    listContainer.appendChild(summaryDiv);

    // Create Cards
    entries.forEach(({ name, manual, auto }) => {
        const reason = (manual && auto) ? 'both' : manual ? 'manual' : 'auto';
        const borderColor = reason === 'both' ? 'border-purple-900/30 hover:border-purple-700' :
                           reason === 'auto' ? 'border-red-900/30 hover:border-red-700' :
                           'border-amber-900/30 hover:border-amber-700';

        const card = document.createElement('div');
        card.className = `bg-gray-800 border ${borderColor} rounded p-3 flex flex-col gap-2 group hover:bg-gray-800/80 transition-colors relative`;

        card.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="text-sm font-mono text-gray-300 truncate flex-1" title="${name}">${name}</span>
                <div class="flex items-center gap-2">
                    ${getReasonBadge(reason)}
                    <button class="text-red-500 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity p-1" onclick="window.removeStrategyFromQuarantine('${name.replace(/'/g, "\\'")}')" title="Rehabilitar Estrategia">
                        ❌
                    </button>
                </div>
            </div>
        `;
        listContainer.appendChild(card);
    });
};

/**
 * Helper global para eliminar desde el botón de la tarjeta.
 */
window.removeStrategyFromQuarantine = (name) => {
    if (state.quarantineData.has(name)) {
        state.quarantineData.delete(name);
        saveQuarantineList();
        renderQuarantineList();
        showToast(`✅ Estrategia "${name}" rehabilitada.`, 'success');
    }
};

/**
 * Helper global para añadir a cuarentena MANUAL desde cualquier botón de la UI.
 */
window.addStrategyToQuarantine = (name) => {
    if (!name) return;

    const existing = state.quarantineData.get(name);
    if (existing && existing.manual) {
        showToast(`⚠️ La estrategia "${name}" ya está en cuarentena manual.`, 'info');
        return;
    }

    if (!confirm(`¿Estás seguro de enviar "${name}" a CUARENTENA MANUAL?\n\nEsta estrategia será excluida de todos los cálculos y búsquedas futuras.`)) {
        return;
    }

    const q = existing || { manual: false, auto: false };
    q.manual = true;
    state.quarantineData.set(name, q);
    saveQuarantineList();
    renderQuarantineList();
    showToast(`☣️ Estrategia "${name}" enviada a cuarentena manual.`, 'success');
};

/**
 * Abre un modal simple para seleccionar estrategias a añadir a la cuarentena MANUAL.
 */
const openQuarantineManagerModal = () => {
    let modal = document.getElementById('quarantine-manager-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'quarantine-manager-modal';
    modal.className = 'fixed inset-0 z-[80] flex items-center justify-center bg-gray-900/90 backdrop-blur-sm';

    const allStrategies = state.loadedStrategyFiles.map(f => f.name).sort();

    modal.innerHTML = `
        <div class="bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col border border-gray-700">
            <div class="p-6 border-b border-gray-700 flex justify-between items-center bg-red-900/20">
                <h3 class="text-xl font-bold text-red-100 flex items-center gap-2">
                    <span>☣️</span> Gestión de Cuarentena Manual
                </h3>
                <button id="close-quarantine-modal" class="text-gray-400 hover:text-white text-2xl">&times;</button>
            </div>
            
            <div class="p-4 bg-gray-800/50 border-b border-gray-700">
                 <input type="text" id="quarantine-search" placeholder="🔍 Filtrar estrategias..." 
                        class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none">
            </div>

            <div class="flex-1 overflow-y-auto p-2" id="quarantine-checklist-container">
                <div class="space-y-1" id="quarantine-checklist">
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

    const checklistContainer = modal.querySelector('#quarantine-checklist');

    const renderChecklist = (filterText = '') => {
        checklistContainer.innerHTML = '';
        allStrategies.forEach(name => {
            if (filterText && !name.toLowerCase().includes(filterText.toLowerCase())) return;

            const q = state.quarantineData.get(name);
            const isManualBanned = q && q.manual;
            const isAutoBanned = q && q.auto;
            const reason = getQuarantineReason(name);

            const item = document.createElement('label');
            item.className = `flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${isManualBanned ? 'bg-amber-900/20 border border-amber-900/30' : isAutoBanned ? 'bg-red-900/10 border border-red-900/20' : 'hover:bg-gray-700 border border-transparent'}`;
            item.innerHTML = `
                <input type="checkbox" value="${name}" class="w-4 h-4 text-amber-600 rounded bg-gray-700 border-gray-600 focus:ring-amber-500" ${isManualBanned ? 'checked' : ''}>
                <span class="text-sm flex-1 ${isManualBanned ? 'text-amber-300 font-medium' : 'text-gray-300'}">${name}</span>
                ${reason ? getReasonBadge(reason) : ''}
            `;
            checklistContainer.appendChild(item);
        });
    };

    renderChecklist();

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
            const existing = state.quarantineData.get(name) || { manual: false, auto: false };

            if (cb.checked) {
                if (!existing.manual) {
                    state.quarantineData.set(name, { ...existing, manual: true });
                    addedCount++;
                }
            } else {
                if (existing.manual) {
                    existing.manual = false;
                    if (!existing.auto) {
                        state.quarantineData.delete(name);
                    } else {
                        state.quarantineData.set(name, existing);
                    }
                    removedCount++;
                }
            }
        });

        saveQuarantineList();
        renderQuarantineList();

        let msg = 'Actualización completada.';
        if (addedCount > 0) msg += ` +${addedCount} vetadas.`;
        if (removedCount > 0) msg += ` -${removedCount} rehabilitadas.`;

        showToast(msg, 'success');
        closeModal();
    };

    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
};

// --- FOLDER SYNC FEATURE ---

/**
 * Opens a directory picker and syncs quarantine auto-flag based on which
 * strategy files exist in the selected "live" folder.
 */
const syncWithLiveFolder = async () => {
    try {
        // Use the File System Access API to pick a directory
        const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
        
        // Read all CSV filenames from the folder
        const liveFileNames = new Set();
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.csv')) {
                liveFileNames.add(entry.name);
            }
        }

        console.log(`[Quarantine] Folder sync: Found ${liveFileNames.size} CSV files in "${dirHandle.name}"`);

        // Save folder name (we can't persist the handle, but we save the name for display)
        state.liveFolderPath = dirHandle.name;

        // Perform the sync
        const result = performFolderSync(liveFileNames);

        saveQuarantineList();
        renderQuarantineList();

        showToast(`📂 Sync: +${result.quarantined} cuarentenadas, -${result.recovered} recuperadas (${liveFileNames.size} CSVs en carpeta)`, 'success');

    } catch (err) {
        if (err.name === 'AbortError') return; // User cancelled
        console.error('[Quarantine] Folder sync error:', err);
        showToast(`Error al sincronizar carpeta: ${err.message}`, 'error');
    }
};

/**
 * Re-syncs using showDirectoryPicker again (the handle can't be persisted).
 */
const resyncWithLiveFolder = async () => {
    // We need to ask the user to re-select the folder since handles aren't persistent
    showToast('Selecciona la carpeta "viva" para re-sincronizar...', 'info');
    await syncWithLiveFolder();
};

/**
 * Core sync logic: compare loaded strategies against a set of live file names.
 */
const performFolderSync = (liveFileNames) => {
    let quarantined = 0;
    let recovered = 0;

    state.loadedStrategyFiles.forEach(file => {
        const name = file.name;
        const isInLiveFolder = liveFileNames.has(name);
        const existing = state.quarantineData.get(name) || { manual: false, auto: false };

        if (!isInLiveFolder) {
            // Not in live folder → auto-quarantine
            if (!existing.auto) {
                state.quarantineData.set(name, { ...existing, auto: true });
                quarantined++;
            }
        } else {
            // In live folder → remove auto-quarantine (but keep manual if set)
            if (existing.auto) {
                existing.auto = false;
                if (!existing.manual) {
                    state.quarantineData.delete(name);
                } else {
                    state.quarantineData.set(name, existing);
                }
                recovered++;
            }
        }
    });

    console.log(`[Quarantine] Folder sync result: ${quarantined} quarantined, ${recovered} recovered`);
    return { quarantined, recovered };
};
