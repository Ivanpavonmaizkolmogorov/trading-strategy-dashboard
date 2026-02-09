import { dom } from '../dom.js';
import { state, saveSavedPortfolios } from '../state.js';
import { renderViewerForActiveTab } from './viewer.js';
import { renderStrategiesTable, displaySavedPortfoliosList } from '../ui.js';
import { initStrategiesTable } from './strategiesTable.js';
import { initQuarantineTab } from './quarantine.js';
import { renderLiveMonitor } from './liveMonitor.js';
import { openMagicMapper } from './magicMapper.js';
import { processTradeHistory, recalculateStrategyBreakdown } from './myfxbookUI.js';
import { exportTableToCSV } from '../utils.js';
import { selectedSavedPortfolios, clearSelectedSavedPortfolios } from './savedPortfoliosTable.js';
import { showToast } from './notifications.js';

/**
 * Inicializa la lógica del layout: Sidebar, Tabs y Resizer.
 */
export const initializeLayout = () => {
    initSidebar();
    initBottomPanelTabs();
    initPanelResizer();
    initQuarantineTab(); // Init Quarantine (Setup listeners)
};

const initSidebar = () => {
    // Config Button -> Open Modal
    if (dom.navConfig) {
        dom.navConfig.addEventListener('click', () => {
            dom.configModal.classList.remove('hidden');
            dom.configModal.classList.add('flex');
        });
    }

    // Close Config Modal
    const closeModal = () => {
        dom.configModal.classList.add('hidden');
        dom.configModal.classList.remove('flex');
    };

    if (dom.closeConfigBtn) dom.closeConfigBtn.addEventListener('click', closeModal);
    if (dom.configModalBackdrop) dom.configModalBackdrop.addEventListener('click', closeModal);

    // Analysis Button -> Return to Main Dashboard
    if (dom.navAnalysis) {
        dom.navAnalysis.addEventListener('click', () => {
            switchView('dashboard');
        });
    }

    // Monitor Button -> Show Live Monitor
    if (dom.navMonitor) {
        dom.navMonitor.addEventListener('click', () => {
            switchView('monitor');
            initLiveMonitor();
        });
    }
};

const switchView = (viewName) => {
    if (viewName === 'dashboard') {
        // Hide Monitor & Engines
        if (dom.liveMonitorView) dom.liveMonitorView.classList.add('hidden');
        document.getElementById('engines-view')?.classList.add('hidden');

        // Show Sidebar Highlight
        if (dom.navMonitor) dom.navMonitor.classList.remove('active', 'text-white', 'bg-gray-700');
        if (dom.navMonitor) dom.navMonitor.classList.add('text-gray-400');

        if (dom.navAnalysis) dom.navAnalysis.classList.add('active', 'text-white', 'bg-gray-700');
        if (dom.navAnalysis) dom.navAnalysis.classList.remove('text-gray-400');

    } else if (viewName === 'monitor') {
        // Show Monitor, Hide Engines
        if (dom.liveMonitorView) dom.liveMonitorView.classList.remove('hidden');
        document.getElementById('engines-view')?.classList.add('hidden');

        // Sidebar Highlight
        if (dom.navAnalysis) dom.navAnalysis.classList.remove('active', 'text-white', 'bg-gray-700');
        if (dom.navAnalysis) dom.navAnalysis.classList.add('text-gray-400');

        if (dom.navMonitor) dom.navMonitor.classList.add('active', 'text-white', 'bg-gray-700');
        if (dom.navMonitor) dom.navMonitor.classList.remove('text-gray-400');
    }
};

// --- Live Monitor Logic (Inline) ---
let isMonitorInitialized = false;

const initLiveMonitor = () => {
    if (isMonitorInitialized) return;

    console.log("[Layout] Initializing Live Monitor (Toggle View)...");

    if (dom.liveMonitorContent) {
        // Create Toggle Layout (Stacked, one hidden)
        dom.liveMonitorContent.innerHTML = `
            <div class="relative w-full h-full">
                <!-- Sandbox Iframe (Miner) -->
                <div id="monitor-iframe-container" class="absolute inset-0 w-full h-full bg-black z-10 transition-all duration-300">
                    <!-- Iframe injected here -->
                    <div class="absolute inset-0 flex items-center justify-center text-gray-500 text-xs pointer-events-none">
                        Loading Sandbox...
                    </div>
                </div>
                
                <!-- Dashboard (Cards) -->
                <div id="monitor-dashboard-container" class="absolute inset-0 w-full h-full overflow-y-auto bg-gray-900 custom-scrollbar p-6 hidden z-20">
                    <!-- Dashboard Cards injected here -->
                     <div class="flex flex-col items-center justify-center h-full text-gray-500">
                        <span class="animate-pulse">Waiting for data...</span>
                    </div>
                </div>
            </div>
        `;

        const iframeContainer = document.getElementById('monitor-iframe-container');

        // Inject Iframe
        const iframe = document.createElement('iframe');
        iframe.src = `http://${window.location.hostname}:8002`; // Use dynamic hostname
        iframe.style.width = "100%";
        iframe.style.height = "100%";
        iframe.style.border = "none";
        iframe.setAttribute('allow', 'clipboard-read; clipboard-write');

        // Clear placeholder and append iframe
        iframeContainer.innerHTML = '';
        iframeContainer.appendChild(iframe);

        // Pre-Render Dashboard
        renderLiveMonitor('monitor-dashboard-container');
    }

    // --- TOGGLE LOGIC ---
    const btnSandbox = document.getElementById('monitor-view-sandbox-btn');
    const btnDashboard = document.getElementById('monitor-view-dashboard-btn');
    const containerSandbox = document.getElementById('monitor-iframe-container');
    const containerDashboard = document.getElementById('monitor-dashboard-container');
    const btnGlobalMapper = document.getElementById('global-mapper-btn');

    if (btnSandbox && btnDashboard && containerSandbox && containerDashboard) {
        // Define toggle function
        const setActive = (mode) => {
            if (mode === 'sandbox') {
                containerSandbox.classList.remove('hidden');
                containerDashboard.classList.add('hidden');

                btnSandbox.classList.add('bg-blue-600', 'text-white', 'shadow-sm');
                btnSandbox.classList.remove('text-gray-400', 'hover:bg-gray-800');

                btnDashboard.classList.remove('bg-blue-600', 'text-white', 'shadow-sm');
                btnDashboard.classList.add('text-gray-400', 'hover:bg-gray-800');
            } else {
                containerSandbox.classList.add('hidden');
                containerDashboard.classList.remove('hidden');

                btnDashboard.classList.add('bg-blue-600', 'text-white', 'shadow-sm');
                btnDashboard.classList.remove('text-gray-400', 'hover:bg-gray-800');

                btnSandbox.classList.remove('bg-blue-600', 'text-white', 'shadow-sm');
                btnSandbox.classList.add('text-gray-400', 'hover:bg-gray-800');

                // Refresh dashboard when switching to it
                renderLiveMonitor('monitor-dashboard-container');
            }
        };

        // Attach listeners
        btnSandbox.onclick = () => setActive('sandbox');
        btnDashboard.onclick = () => setActive('dashboard');

        console.log("[Layout] Toggle listeners attached.");
    }

    // Attach Listener to Global Mapper Button
    if (btnGlobalMapper) {
        btnGlobalMapper.addEventListener('click', () => {
            console.log("[Layout] Opening Global Magic Mapper...");
            openMagicMapper(null); // Null implies Global Mode
        });
    }

    // Wire up Refresh Global button if needed
    if (dom.monitorRefreshBtn) {
        dom.monitorRefreshBtn.addEventListener('click', () => {
            // Reload Iframe
            const iframe = document.querySelector('#monitor-iframe-container iframe');
            if (iframe) iframe.src = iframe.src;

            // Refresh Dashboard logic?
            renderLiveMonitor('monitor-dashboard-container');
        });
    }

    // --- DATA BRIDGE ---
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'MYFX_DATA_UPDATE') {
            console.log("[Layout] 🌉 Bridge received data from Monitor:", event.data.payload);

            const payload = event.data.payload;

            // Process payload to generate standardized stats
            const result = processTradeHistory(payload.history, payload.openTrades);

            // 1. UPDATE DEEP SCAN DATA (Multi-Account Storage)
            // Key by accountId: same account = OVERWRITE, different account = COEXIST
            const accId = String(payload.accountInfo?.accountId || 'unknown');
            const accName = payload.accountInfo?.name || payload.accountInfo?.broker || 'Unknown Account';

            // Tag each trade with source account metadata
            const taggedTradesById = {};
            Object.entries(result.tradesById).forEach(([key, trades]) => {
                taggedTradesById[key] = trades.map(t => ({
                    ...t,
                    _sourceAccount: {
                        id: accId,
                        name: accName,
                        broker: payload.accountInfo?.broker
                    }
                }));
            });

            // Initialize deepScanData if needed
            if (!state.deepScanData) state.deepScanData = {};

            // Store/Overwrite data for this specific account
            state.deepScanData[accId] = {
                accountInfo: payload.accountInfo,
                processedStats: result.magicStats,
                tradesById: taggedTradesById,
                sourceName: `Deep Scan: ${accName}`,
                lastUpdated: new Date().toISOString()
            };

            console.log(`[Layout] 📊 Deep Scan Data stored for Account ${accId} (${accName}). Total accounts: ${Object.keys(state.deepScanData).length}`);

            // Keep sandboxData as alias for backwards compatibility (points to last scanned account)
            state.sandboxData = {
                accountInfo: payload.accountInfo,
                processedStats: result.magicStats,
                tradesById: taggedTradesById,
                sourceName: `Sandbox (${accName})`
            };

            // 2. SEARCH & UPDATE MATCHING PORTFOLIO
            // 2. SEARCH & UPDATE MATCHING PORTFOLIO (STRATEGY-BASED)
            let matched = false;

            // Iterate all portfolios to find ones that contain the strategies found in this update
            state.savedPortfolios.forEach(portfolio => {
                let strategiesFoundCount = 0;

                // Content Match: Check if portfolio's strategies are present in the result
                if (state.magicNumberMap) {
                    const portfolioStrategyIds = new Set(portfolio.strategyIds || []);
                    const resultKeys = new Set(Object.keys(result.magicStats));

                    for (const [stratId, mappedKeys] of Object.entries(state.magicNumberMap)) {
                        if (portfolioStrategyIds.has(stratId)) {
                            // This strategy belongs to this portfolio.
                            // Check if any of its mapped keys are in the incoming result
                            if (mappedKeys.some(k => resultKeys.has(k))) {
                                strategiesFoundCount++;
                            }
                        }
                    }
                }

                // Also check strict ID match as a fallback/accelerator
                const accId = payload.accountInfo?.accountId;
                const isIdMatch = accId && String(portfolio.linkedAccountId) === String(accId);

                if (isIdMatch || strategiesFoundCount > 0) {
                    console.log(`[Layout] Updating Portfolio: ${portfolio.name} (ID Match: ${isIdMatch}, Strategies Found: ${strategiesFoundCount})`);

                    portfolio.realMetrics = {
                        ...(portfolio.realMetrics || {}),
                        magicStats: result.magicStats,
                        _tradesById: result.tradesById,
                        maxConsecutiveLosses: result.metrics.maxConsecutiveLosses
                    };

                    // Auto-link ID if we matched by content but ID was missing/different
                    if (!isIdMatch && accId) {
                        console.log(`[Layout] Auto-linking Portfolio ${portfolio.name} to Account ID: ${accId}`);
                        portfolio.linkedAccountId = accId;
                    }

                    // Recalculate Breakdown to update strategies status
                    recalculateStrategyBreakdown(portfolio);
                    portfolio.lastSyncDate = new Date().toISOString();
                    matched = true;
                }
            });

            if (!matched) {
                console.warn('[Layout] NO MATCHING PORTFOLIO FOUND (No mapped strategies overlap).');
            }

            // 3. Notify User
            if (payload.history && payload.history.length > 0) {
                const msg = matched
                    ? `Synced ${result.allTrades.length} trades to PORTFOLIO`
                    : `Received ${result.allTrades.length} trades (Unlinked)`;
                // showToast(msg, 'success');
            }

            // Dispatch event for other modules (e.g. Magic Mapper)
            window.dispatchEvent(new CustomEvent('sandbox-data-updated'));
        }
    });

    isMonitorInitialized = true;
};




const initBottomPanelTabs = () => {
    if (!dom.panelTabs) return;

    // --- References to Control Groups ---
    const databankControls = document.getElementById('databank-controls');
    const savedPortfoliosControls = document.getElementById('saved-portfolios-controls');
    const strategiesControls = document.getElementById('strategies-controls');

    // --- Helper to Toggle Controls ---
    const updateControlsVisibility = (targetId) => {
        // Hide all first
        if (databankControls) databankControls.classList.add('hidden');
        if (savedPortfoliosControls) savedPortfoliosControls.classList.add('hidden');
        if (strategiesControls) strategiesControls.classList.add('hidden');

        // Show specific
        if (targetId === 'databank-content' && databankControls) {
            databankControls.classList.remove('hidden');
            if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.classList.remove('hidden');
        } else if (targetId === 'saved-portfolios-content' && savedPortfoliosControls) {
            savedPortfoliosControls.classList.remove('hidden');
            // Hide search button unless base portfolio is selected
            if (dom.findDatabankPortfoliosBtn) {
                if (state.searchBasePortfolioIndex !== null) {
                    dom.findDatabankPortfoliosBtn.classList.remove('hidden');
                } else {
                    dom.findDatabankPortfoliosBtn.classList.add('hidden');
                }
            }
        } else if (targetId === 'strategies-content' && strategiesControls) {
            strategiesControls.classList.remove('hidden');
            // strategies tab likely doesn't need search button
            if (dom.findDatabankPortfoliosBtn) dom.findDatabankPortfoliosBtn.classList.add('hidden');
        } // Quarantine has its own internal controls, no global toolbar needed
    };

    // --- Initialize Export Buttons (One-time setup) ---
    const exportDatabankBtn = document.getElementById('export-databank-btn');
    if (exportDatabankBtn) {
        console.log('[Layout] Export Databank Button found. Attaching listener.');
        exportDatabankBtn.addEventListener('click', () => {
            console.log('[Layout] Export Databank Button Clicked!');
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            exportTableToCSV('databank-table-body', `databank_export_${timestamp}.csv`);
        });
    } else {
        console.warn('[Layout] Export Databank Button NOT found during init!');
    }

    const deleteSelectedBtn = document.getElementById('delete-selected-portfolios-btn');
    if (deleteSelectedBtn) {
        console.log('[Layout] Delete Selected Portfolios Button found. Attaching listener.');
        deleteSelectedBtn.addEventListener('click', () => {
            const count = selectedSavedPortfolios.size;
            if (count === 0) return;

            if (confirm(`¿Estás seguro de que quieres eliminar ${count} portafolios seleccionados? Esto no se puede deshacer.`)) {
                const indicesToDelete = new Set(selectedSavedPortfolios);
                // Filter out the deleted ones
                state.savedPortfolios = state.savedPortfolios.filter((_, index) => !indicesToDelete.has(index));

                saveSavedPortfolios();
                clearSelectedSavedPortfolios();
                displaySavedPortfoliosList();
                showToast(`${count} portafolios eliminados correctamente.`, 'success');
            }
        });
    } else {
        console.warn('[Layout] Delete Selected Portfolios Button NOT found during init!');
    }

    const exportSavedBtn = document.getElementById('export-saved-portfolios-btn');
    if (exportSavedBtn) {
        console.log('[Layout] Export Saved Portfolios Button found. Attaching listener.');
        exportSavedBtn.addEventListener('click', () => {
            console.log('[Layout] Export Saved Portfolios Button Clicked!');
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            exportTableToCSV('saved-portfolios-body', `saved_portfolios_${timestamp}.csv`);
        });
    } else {
        console.warn('[Layout] Export Saved Portfolios Button NOT found during init!');
    }

    const exportStrategiesBtn = document.getElementById('export-strategies-btn');
    if (exportStrategiesBtn) {
        console.log('[Layout] Export Strategies Button found. Attaching listener.');
        exportStrategiesBtn.addEventListener('click', () => {
            console.log('[Layout] Export Strategies Button Clicked!');
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            exportTableToCSV('strategies-table-body', `strategies_export_${timestamp}.csv`);
        });
    } else {
        console.warn('[Layout] Export Strategies Button NOT found during init!');
    }

    const correlationSelectedBtn = document.getElementById('correlation-selected-portfolios-btn');
    if (correlationSelectedBtn) {
        correlationSelectedBtn.addEventListener('click', async () => {
            const { calculatePortfolioCorrelationMatrix, showPortfolioCorrelationModal } = await import('./portfolioCorrelation.js');
            const { getSelectedSavedPortfolios } = await import('./savedPortfoliosTable.js'); // Updated import source

            // Get full portfolio objects from indices
            const selectedIndices = getSelectedSavedPortfolios();
            const portfolios = selectedIndices.map(idx => state.savedPortfolios[idx]).filter(p => p);

            if (portfolios.length < 2) {
                showToast('Selecciona al menos 2 portafolios para correlacionar', 'warning');
                return;
            }

            const data = calculatePortfolioCorrelationMatrix(portfolios);
            if (data) {
                showPortfolioCorrelationModal(data);
            } else {
                showToast('No se pudo calcular la correlación (faltan datos de equidad)', 'error');
            }
        });
    }

    const searchSelectedBtn = document.getElementById('search-selected-portfolios-btn');
    if (searchSelectedBtn) {
        searchSelectedBtn.addEventListener('click', async () => {
            const { openSearchConfigModal } = await import('./searchConfig.js');
            const { getSelectedSavedPortfolios } = await import('./savedPortfoliosTable.js');

            // Get full portfolio objects from indices
            const selectedIndices = getSelectedSavedPortfolios();
            // We pass the INDICES of the SAVED PORTFOLIOS to the wizard
            openSearchConfigModal(selectedIndices);
        });
    }

    // 0. Sync Initial State
    const activeContent = document.querySelector('.tab-content.active');
    if (activeContent) {
        if (activeContent.id === 'databank-content') state.activeTab = 'databank';
        else if (activeContent.id === 'saved-portfolios-content') state.activeTab = 'saved-portfolios';
        else if (activeContent.id === 'strategies-content') state.activeTab = 'strategies';
        console.log(`[Layout] Initial active tab synced to: ${state.activeTab}`);
    }

    dom.panelTabs.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // 1. Remove active class from all tabs
            dom.panelTabs.forEach(b => b.classList.remove('active', 'text-white', 'bg-gray-700'));
            dom.panelTabs.forEach(b => b.classList.add('text-gray-300')); // Reset color

            // 2. Add active class to clicked tab
            const targetBtn = e.currentTarget; // Use currentTarget to get the button, not the span inside
            targetBtn.classList.add('active', 'text-white', 'bg-gray-700');
            targetBtn.classList.remove('text-gray-300');

            // 3. Hide all content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active', 'flex');
                content.classList.add('hidden');
            });

            // 4. Show target content
            const targetId = targetBtn.dataset.target;
            const targetContent = document.getElementById(targetId);

            // 4.5 Update Controls Visibility
            updateControlsVisibility(targetId);

            if (targetContent) {
                targetContent.classList.remove('hidden');
                targetContent.classList.add('active', 'flex');

                // Update State
                if (targetId === 'strategies-content') state.activeTab = 'strategies';
                else if (targetId === 'saved-portfolios-content') state.activeTab = 'saved-portfolios';
                else if (targetId === 'databank-content') state.activeTab = 'databank';
                else if (targetId === 'quarantine-content') state.activeTab = 'quarantine'; // NEW
                console.log(`[Layout] Active Tab changed to: ${state.activeTab}`);

                // Render specific content if needed
                if (targetId === 'strategies-content') {
                    initStrategiesTable(); // Ensure controls are injected and config loaded
                    renderStrategiesTable();
                } else if (targetId === 'saved-portfolios-content') {
                    displaySavedPortfoliosList();
                }
            }

            // 5. Update viewer chart based on active tab
            setTimeout(() => renderViewerForActiveTab(), 100); // Small delay to ensure DOM is ready
        });
    });
};

const initPanelResizer = () => {
    const resizer = dom.panelResizer;
    const sourcePanel = dom.sourcePanel;
    const viewerContainer = dom.viewerContainer;

    if (!resizer || !sourcePanel || !viewerContainer) return;

    let isResizing = false;
    let lastDownY = 0;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        lastDownY = e.clientY;
        resizer.classList.add('resizing');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none'; // Prevent text selection
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const containerHeight = document.querySelector('main').clientHeight;
        const offsetTop = document.querySelector('main').getBoundingClientRect().top;

        // Calculate new height for source panel (Total Height - Mouse Y relative to container)
        // Mouse Y relative to viewport - Container Offset = Mouse Y inside container
        const mouseYInContainer = e.clientY - offsetTop;

        // We want the bottom panel height. 
        // Bottom Panel Height = Container Height - Mouse Y
        let newHeight = containerHeight - mouseYInContainer;

        // Limits
        if (newHeight < 100) newHeight = 100; // Min height
        if (newHeight > containerHeight - 100) newHeight = containerHeight - 100; // Max height

        sourcePanel.style.height = `${newHeight}px`;
        updateResetButtonState(newHeight); // [NEW] Update button state
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });

    // --- Resize Control Buttons ---
    const maxChartBtn = document.getElementById('resize-max-chart');
    const resetBtn = document.getElementById('resize-reset');
    const resetToolbarBtn = document.getElementById('resize-reset-toolbar'); // [NEW] Duplicate button
    const maxBottomBtn = document.getElementById('resize-max-bottom');

    // [NEW] Helper to toggle Red/Pulse on Reset Button when hidden
    const updateResetButtonState = (heightPx) => {
        if (!resetToolbarBtn) return;
        // Parse if string "300px"
        let h = parseInt(heightPx);
        if (isNaN(h)) h = sourcePanel.clientHeight;

        if (h < 60) { // Threshold for "minimized" (usually 44px or 4px)
            resetToolbarBtn.classList.remove('bg-gray-700', 'hover:bg-gray-600');
            resetToolbarBtn.classList.add('bg-red-600', 'hover:bg-red-500', 'text-white', 'animate-pulse');
        } else {
            resetToolbarBtn.classList.remove('bg-red-600', 'hover:bg-red-500', 'text-white', 'animate-pulse');
            resetToolbarBtn.classList.add('bg-gray-700', 'hover:bg-gray-600');
        }
    };

    // Helper to trigger window resize for Chart.js update
    const triggerResize = () => {
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 50); // Small delay to allow transition
    };

    if (maxChartBtn) {
        maxChartBtn.addEventListener('mousedown', (e) => e.stopPropagation()); // Prevent drag start
        maxChartBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Maximize Bottom Panel (User Requested Swap)
            const containerHeight = document.querySelector('main').clientHeight;
            // Leave 44px (raised 4 more points as requested)
            const newH = containerHeight - 44;
            sourcePanel.style.height = `${newH}px`;
            updateResetButtonState(newH);

            triggerResize();
        });
    }

    // Logic to reset view (shared)
    const handleResetView = (e) => {
        e.stopPropagation();
        // Reset to default (approx 40% or 320px)
        sourcePanel.style.height = '320px';
        updateResetButtonState(320);
        triggerResize();
    };

    if (resetBtn) {
        resetBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        resetBtn.addEventListener('click', handleResetView);
    }

    // [NEW] Toolbar Button Listener
    if (resetToolbarBtn) {
        resetToolbarBtn.addEventListener('click', handleResetView);
    }

    if (maxBottomBtn) {
        maxBottomBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        maxBottomBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.stopPropagation();
            // Maximize Chart / Minimize Bottom Panel (User Requested Swap)
            // Leave 4px visible (a couple points higher than 0)
            sourcePanel.style.height = '4px';
            updateResetButtonState(4);

            triggerResize();
        });
    }

    // Init Floating Scrollbar
    initializeFloatingScrollbar();

    // Init State
    updateResetButtonState(sourcePanel.clientHeight);
};

/**
 * Initializes the Global Floating Scrollbar logic.
 * Syncs the fixed bottom scrollbar with the currently active table container.
 */
function initializeFloatingScrollbar() {
    const floatingScrollbar = document.getElementById('global-floating-scrollbar');
    const floatingContent = document.getElementById('global-floating-content');
    if (!floatingScrollbar || !floatingContent) return;

    let activeSyncContainer = null;
    let isSyncing = false;

    // 1. Function to find the active scrollable container
    const findActiveContainer = () => {
        // Look for the visible tab content
        const visibleTab = document.querySelector('.tab-content:not(.hidden)');
        if (!visibleTab) return null;

        // Find the scrollable div inside (our table wrappers have overflow-x-scroll)
        // We know they have class 'custom-scrollbar'
        const container = visibleTab.querySelector('.overflow-x-scroll');
        return container;
    };

    // 2. Update Layout based on active container
    const updateScrollbarState = () => {
        const container = findActiveContainer();
        activeSyncContainer = container;

        if (container && container.scrollWidth > container.clientWidth) {
            // Content overflows -> Show scrollbar
            floatingScrollbar.classList.remove('hidden');
            floatingContent.style.width = `${container.scrollWidth}px`;
            floatingScrollbar.scrollLeft = container.scrollLeft;
        } else {
            // No overflow or no container -> Hide
            // floatingScrollbar.classList.add('hidden'); // Optional: hide if not needed
            // User requested "Flexible always visible", implies if table is present.
            // But if table fits, scrollbar is useless.
            // Let's keep it hidden if no overflow, OR show disabled?
            // User said "siempre visible". Let's show it but it might be empty.
            // Actually, if scrollWidth <= clientWidth, scrollbar track is empty.
            if (container) {
                floatingScrollbar.classList.remove('hidden');
                floatingContent.style.width = `${container.scrollWidth}px`;
            } else {
                floatingScrollbar.classList.add('hidden');
            }
        }
    };

    // 3. Sync Logic
    floatingScrollbar.addEventListener('scroll', () => {
        if (!activeSyncContainer || isSyncing) return;
        isSyncing = true;
        activeSyncContainer.scrollLeft = floatingScrollbar.scrollLeft;
        requestAnimationFrame(() => isSyncing = false);
    });

    // We need to attach listeners to the containers themselves
    // Since containers might change or be hidden, we use a MutationObserver or global delegation?
    // Delegation doesn't work for 'scroll' (doesn't bubble).
    // We'll attach to known containers on init and whenever tabs change.

    // A. Attach to all potential containers now
    const potentialContainers = document.querySelectorAll('.overflow-x-scroll');
    potentialContainers.forEach(el => {
        el.addEventListener('scroll', () => {
            if (el !== activeSyncContainer || isSyncing) return;
            isSyncing = true;
            floatingScrollbar.scrollLeft = el.scrollLeft;
            requestAnimationFrame(() => isSyncing = false);
        });
    });

    // B. Observer for Tab Switching / content resizing
    const observer = new MutationObserver(() => {
        updateScrollbarState();
    });

    // Oberve the Tab Area (parent of tab-contents)
    const sourcePanel = document.getElementById('source-panel');
    if (sourcePanel) {
        observer.observe(sourcePanel, { attributes: true, subtree: true, attributeFilter: ['class', 'style'] });
    }

    // Also listen to window resize
    window.addEventListener('resize', updateScrollbarState);

    // Check periodically (failsafe for dynamic content load)
    setInterval(updateScrollbarState, 500);

    // Initial check
    updateScrollbarState();
}
