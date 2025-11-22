/**
 * Módulo para gestionar notificaciones tipo "Toast".
 */

// Contenedor de notificaciones (se creará dinámicamente si no existe)
let toastContainer = null;

const getToastContainer = () => {
    if (!toastContainer) {
        toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.className = 'fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none';
            document.body.appendChild(toastContainer);
        }
    }
    return toastContainer;
};

/**
 * Muestra una notificación toast.
 * @param {string} message - El mensaje a mostrar.
 * @param {string} type - El tipo de notificación ('success', 'error', 'info', 'warning').
 * @param {number} duration - Duración en ms (default: 3000).
 */
export const showToast = (message, type = 'info', duration = 3000) => {
    const container = getToastContainer();

    const toast = document.createElement('div');
    toast.className = `pointer-events-auto flex items-center w-full max-w-xs p-4 rounded-lg shadow-lg text-white transform transition-all duration-300 translate-x-full opacity-0`;

    // Colores e iconos según el tipo
    let bgClass = 'bg-gray-800';
    let icon = '';

    switch (type) {
        case 'success':
            bgClass = 'bg-green-600';
            icon = '<svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
            break;
        case 'error':
            bgClass = 'bg-red-600';
            icon = '<svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>';
            break;
        case 'warning':
            bgClass = 'bg-amber-500';
            icon = '<svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>';
            break;
        default: // info
            bgClass = 'bg-sky-600';
            icon = '<svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
    }

    toast.classList.add(bgClass);
    toast.innerHTML = `${icon}<div class="text-sm font-semibold">${message}</div>`;

    container.appendChild(toast);

    // Animación de entrada
    requestAnimationFrame(() => {
        toast.classList.remove('translate-x-full', 'opacity-0');
    });

    // Auto-dismiss
    setTimeout(() => {
        toast.classList.add('translate-x-full', 'opacity-0');
        setTimeout(() => {
            if (toast.parentElement) {
                toast.parentElement.removeChild(toast);
            }
        }, 300); // Esperar a que termine la transición CSS
    }, duration);
};
