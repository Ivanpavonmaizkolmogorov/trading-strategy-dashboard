import { dom } from '../dom.js';
import { state } from '../state.js';
import { ALL_METRICS } from '../config.js';
import { updateDatabankDisplay } from '../modules/databank.js';
import { displaySavedPortfoliosList } from '../ui.js';

let viewManagerElements;
let draggedItem = null;

function getViewManagerElements() {
    if (!viewManagerElements) {
        viewManagerElements = {
            modal: document.getElementById('view-manager-modal'),
            backdrop: document.getElementById('view-manager-backdrop'),
            content: document.getElementById('view-manager-content'),
            closeBtn: document.getElementById('close-view-manager-btn'),
            visibleList: document.getElementById('visible-columns-list'),
            hiddenList: document.getElementById('hidden-columns-list'),
            viewNameInput: document.getElementById('view-name-input'),
            saveBtn: document.getElementById('save-view-btn'),
            deleteBtn: document.getElementById('delete-view-btn'),
            applyBtn: document.getElementById('apply-view-btn'),
        };
    }
    return viewManagerElements;
}

export const populateViewSelector = (viewSetKey) => {
    const selector = viewSetKey === 'databank' ? dom.viewSelector : dom.savedViewSelector;
    selector.innerHTML = '';
    for (const key in state.tableViews[viewSetKey]) {
        const view = state.tableViews[viewSetKey][key];
        const option = document.createElement('option');
        option.value = key;
        option.textContent = view.name;
        if (key === state.activeViews[viewSetKey]) {
            option.selected = true;
        }
        selector.appendChild(option);
    }
};

export const openViewManager = (viewSetKey) => {
    const elements = getViewManagerElements();
    state.currentEditingViewSet = viewSetKey;
    elements.visibleList.innerHTML = '';
    elements.hiddenList.innerHTML = '';

    const currentView = state.tableViews[state.currentEditingViewSet][state.activeViews[state.currentEditingViewSet]];
    const visibleKeys = new Set(currentView.columns);

    currentView.columns.forEach(key => {
        const colInfo = ALL_METRICS[key];
        if (colInfo) {
            elements.visibleList.innerHTML += `<li class="p-2 bg-gray-700 rounded view-column-item" draggable="true" data-key="${key}">${colInfo.label.replace(/<div.*>(.*)<\/div>/, '$1')}</li>`;
        }
    });

    Object.keys(ALL_METRICS).forEach(key => {
        if (!visibleKeys.has(key) && key !== 'metricValue') {
            const colInfo = ALL_METRICS[key];
            elements.hiddenList.innerHTML += `<li class="p-2 bg-gray-700 rounded view-column-item" draggable="true" data-key="${key}">${colInfo.label.replace(/<div.*>(.*)<\/div>/, '$1' )}</li>`;
        }
    });

    elements.modal.classList.remove('hidden');
    elements.modal.classList.add('flex');
    setTimeout(() => {
        elements.backdrop.classList.remove('opacity-0');
        elements.content.classList.remove('scale-95', 'opacity-0');
    }, 10);
};

export const closeViewManager = () => {
    const elements = getViewManagerElements();
    elements.backdrop.classList.add('opacity-0');
    elements.content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        elements.modal.classList.add('hidden');
        elements.modal.classList.remove('flex');
    }, 300);
};

export const applyView = () => {
    const elements = getViewManagerElements();
    const visibleColumns = Array.from(elements.visibleList.querySelectorAll('li')).map(li => li.dataset.key);
    state.tableViews[state.currentEditingViewSet][state.activeViews[state.currentEditingViewSet]].columns = visibleColumns;
    if (state.currentEditingViewSet === 'databank') {
        updateDatabankDisplay();
    } else {
        displaySavedPortfoliosList();
    }
    closeViewManager();
};

export const saveView = () => {
    const elements = getViewManagerElements();
    const newViewName = elements.viewNameInput.value.trim();
    if (!newViewName) {
        alert('Por favor, introduce un nombre para la nueva vista.');
        return;
    }
    const newViewKey = newViewName.toLowerCase().replace(/\s+/g, '-');
    if (state.tableViews[state.currentEditingViewSet][newViewKey]) {
        if (!confirm(`Ya existe una vista llamada "${newViewName}". ¿Deseas sobrescribirla?`)) {
            return;
        }
    }
    const visibleColumns = Array.from(elements.visibleList.querySelectorAll('li')).map(li => li.dataset.key);
    state.tableViews[state.currentEditingViewSet][newViewKey] = { name: newViewName, columns: visibleColumns };
    state.activeViews[state.currentEditingViewSet] = newViewKey;
    populateViewSelector(state.currentEditingViewSet);
    applyView();
    elements.viewNameInput.value = '';
};

export const deleteView = () => {
    const activeViewKey = state.activeViews[state.currentEditingViewSet];
    if (activeViewKey === 'default') {
        alert('No se puede eliminar la vista por defecto.');
        return;
    }
    if (confirm(`¿Estás seguro de que quieres eliminar la vista "${state.tableViews[state.currentEditingViewSet][activeViewKey].name}"?`)) {
        delete state.tableViews[state.currentEditingViewSet][activeViewKey];
        state.activeViews[state.currentEditingViewSet] = 'default';
        populateViewSelector(state.currentEditingViewSet);
        applyView();
    }
};