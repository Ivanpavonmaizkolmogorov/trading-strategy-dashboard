import logging
import asyncio
from playwright.async_api import async_playwright
import os
from datetime import datetime

logging.basicConfig(level=logging.INFO)

# Force print to flush to ensure logs are visible immediately
def log(msg):
    timestamp = datetime.now().strftime("%H:%M:%S")
    formatted = f"[{timestamp}] {msg}"
    print(formatted, flush=True)
    try:
        with open("debug_scraper.txt", "a") as f:
            f.write(formatted + "\n")
    except: pass

class MyfxbookScraper:
    def __init__(self, email, password):
        self.email = email
        self.password = password
        self.base_url = "https://www.myfxbook.com"
        # Persistent context directory
        self.user_data_dir = os.path.join(os.getcwd(), "myfx_auth")

    async def scrape_history(self, account_id):
        trades = []
        log("="*60)
        log("🔧 SCRAPING SESSION STARTED")
        log(f"📧 Account ID: {account_id}")
        log(f"📁 User data dir: {self.user_data_dir}")
        log("="*60)
        
        async with async_playwright() as p:
            log("🌐 Playwright initialized. Launching browser...")
            
            browser = await p.chromium.launch_persistent_context(
                user_data_dir=self.user_data_dir,
                headless=False, 
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                viewport={'width': 1280, 'height': 800},
                args=["--start-maximized"] # Maximize window for better user visibility
            )
            
            page = browser.pages[0] if browser.pages else await browser.new_page()
            
            try:
                target_url = f"{self.base_url}/portfolio/results/{account_id}"
                log(f"🔗 Target URL: {target_url}")
                
                # Navigate to the target page first
                try:
                    log("⏳ Navigating to target URL...")
                    await page.goto(target_url, timeout=60000)
                    log(f"📍 Current URL after navigation: {page.url}")
                    await page.wait_for_load_state("domcontentloaded")
                    log("✅ DOM content loaded")
                except Exception as e:
                    log(f"⚠️ Navigation error (ignoring): {e}")

                # CHECK FOR LOGIN STATUS
                # We are logged in ONLY if we see specific elements
                is_logged_in = False
                try:
                     # Check for cookie consent and click it if exists
                    if await page.is_visible(".cky-btn-accept"):
                        log("🍪 Cookie consent found. Accepting...")
                        await page.click(".cky-btn-accept")
                        await asyncio.sleep(1)

                    # Check for User Menu (visible icon/name) rather than hidden logout link
                    if await page.is_visible("#userIcon") or await page.is_visible("#displayName"):
                         is_logged_in = True
                    # Check if we are on the correct portfolio page with a history table
                    elif await page.is_visible("#tradingHistoryTable"):
                         is_logged_in = True
                except:
                    pass

                if not is_logged_in:
                    log("⚠️ Session not active or Page Error. Initiating MANUAL LOGIN sequence...")
                    log(f"📍 Current URL: {page.url}")
                    
                    # If on an error page, go to login explicitly
                    if "error" in page.url or ("login" not in page.url and "portfolio" not in page.url):
                         log(f"🔴 Detected error or unexpected URL: {page.url}")

                    log("🛑 PAUSED: Waiting for you to log in manually...")
                    log("ACTION REQUIRED: Please log in using the browser window.")
                    
                    # WAIT LOOP (5 Minutes)
                    login_success = False
                    for i in range(300):
                        try:
                            if page.is_closed():
                                log("❌ Browser window closed by user or crashed.")
                                return {"success": False, "error": "Browser window closed."}

                            # Handle cookies - use force=True to avoid hanging if obscured
                            if await page.is_visible(".cky-btn-accept"):
                                try:
                                    await page.click(".cky-btn-accept", force=True, timeout=1000)
                                except: pass

                            # Robust login check: User Icon OR Profile Name OR History Table
                            if await page.is_visible("#userIcon") or await page.is_visible("#displayName"):
                                log("✅ Login Detected (User Icon/Name)!")
                                login_success = True
                                break
                            
                            if await page.is_visible("#tradingHistoryTable"):
                                log("✅ Login Detected (History Table Visible)!")
                                login_success = True
                                break
                            
                            if "portfolio/results" in page.url and (await page.is_visible("#main-menu") or await page.is_visible("a[href*='/logout']")):
                                log("✅ Login Detected (Portfolio URL + Menu)!")
                                login_success = True
                                break
                        except Exception as e:
                            pass
                        
                        if i % 10 == 0:
                            log(f"Waiting for login... ({i}/300s)")
                        
                        await asyncio.sleep(1)
                    
                    if not login_success:
                        log("❌ Manual login timeout. Aborting. Dumping HTML for debug.")
                        try:
                            with open("debug_timeout_source.html", "w") as f:
                                f.write(await page.content())
                        except: pass
                        return {"success": False, "error": "User did not log in within 5 minutes."}

                    # After login, ensure we are on the right page
                    if str(account_id) not in page.url:
                        log(f"Navigating to account {account_id}...")
                        await page.goto(target_url, timeout=60000)
                else:
                    log("✅ Already logged in. Proceeding...")



                # 4. History Tab Interaction
                log("="*40)
                log("📑 STEP: Looking for History tab...")
                log(f"📍 Current URL: {page.url}")
                
                # Try multiple selectors
                selectors_tried = [
                    "a[href='#historyCont']",
                    "a:has-text('History')",
                    "a:has-text('Historial')",
                    "#historyCont"
                ]
                history_tab = None
                for sel in selectors_tried:
                    log(f"   Trying selector: {sel}")
                    history_tab = await page.query_selector(sel)
                    if history_tab:
                        log(f"   ✅ Found with selector: {sel}")
                        break
                
                if history_tab:
                    log("✅ History tab button found.")
                    parent_class = await history_tab.evaluate("el => el.parentElement.className")
                    log(f"   Parent class: {parent_class}")
                    if "active" not in parent_class:
                        log("🖱️ Clicking History tab...")
                        await history_tab.click()
                        await asyncio.sleep(5)
                        log(f"📍 URL after click: {page.url}")
                    else:
                        log("History tab is already active.")
                else:
                    log("❌ History tab button NOT found with any selector!")
                    # Dump available links for debug
                    all_links = await page.evaluate("() => Array.from(document.querySelectorAll('a')).slice(0,20).map(a => ({href: a.href, text: a.innerText.substring(0,50)}))")
                    log(f"   Available links (first 20): {all_links}")

                # 5. Scrape Loop
                log("="*40)
                log("📊 STEP: Starting scrape loop...")
                page_num = 1
                previous_page_trades = []
                while True:
                    if page_num > 50:
                        log("🛑 Reached safety limit of 50 pages. Breaking.")
                        break

                    log(f"\n📄 SCRAPING PAGE {page_num}...")
                    log(f"   📍 Current URL: {page.url}")
                    
                    # Check if table exists
                    log("   ⏳ Waiting for #tradingHistoryTable...")
                    try:
                        await page.wait_for_selector("#tradingHistoryTable", timeout=20000)
                        log("   ✅ Table found!")
                    except Exception as e:
                        log(f"   ❌ History table timed out on page {page_num}: {e}")
                        # Check what's on the page
                        try:
                            page_title = await page.title()
                            log(f"   Page title: {page_title}")
                            visible_tables = await page.evaluate("() => Array.from(document.querySelectorAll('table')).map(t => ({id: t.id, class: t.className}))")
                            log(f"   Visible tables: {visible_tables}")
                            with open(f"debug_table_timeout_{page_num}.html", "w") as f:
                                f.write(await page.content())
                            log("   Dumped HTML to debug_table_timeout.html")
                        except: pass
                        break

                    # Scrape logic
                    # Scrape logic - Header Aware Version
                    page_trades = await page.evaluate("""() => {
                        const table = document.querySelector('#tradingHistoryTable');
                        if (!table) return [];
                        
                        // Map headers - CASE INSENSITIVE MATCHING
                        const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.innerText.trim());
                        const getIdx = (patterns) => headers.findIndex(h => patterns.some(p => h.toLowerCase().includes(p.toLowerCase())));
                        
                        const idx = {
                            openDate: getIdx(['Open Date', 'Open Time', 'Fecha de apertura']),
                            closeDate: getIdx(['Close Date', 'Close Time', 'Fecha de cierre', 'Close date']),
                            symbol: getIdx(['Symbol', 'Símbolo']),
                            action: getIdx(['Action', 'Type', 'Acción', 'Tipo']),
                            lots: getIdx(['Lots', 'Amount', 'Size', 'Volume', 'Lotes', 'Volumen']),
                            priceOpen: getIdx(['Open Price', 'Precio de apertura']),
                            priceClose: getIdx(['Close Price', 'Precio de cierre']),
                            pips: getIdx(['Pips']),
                            profit: getIdx(['Net Profit', 'Profit', 'Beneficio neto', 'Ganancia']), // 'Net Profit' first for specificity
                            comment: -1 // Comments handling is special
                        };
                        
                        // Fallback logic if headers fail (Standard Layout anchoring)
                        if (idx.action === -1) {
                            // Assume standard layout relative to action
                            // Finding Action by content scanning first row? Too complex for eval.
                            // Defaulting to Standard English Myfxbook indices if completely broken:
                            idx.openDate = 0;
                            idx.action = 2; // ? Varies.
                            // Better validation:
                        }

                        const rows = table.querySelectorAll('tbody tr');
                        const data = [];
                        
                        rows.forEach(row => {
                            if (row.style.display === 'none') return;
                            const cells = row.querySelectorAll('td');
                            if (cells.length < 5) return;
                            
                            const getCell = (i) => (i >= 0 && i < cells.length) ? cells[i].innerText.trim() : '';

                            // Robust extraction
                            let action = getCell(idx.action);
                            // Fallback: search for Buy/Sell in cells if Index is wrong
                            if (!['Buy', 'Sell', 'Deposit', 'Withdrawal'].some(k => action.includes(k))) {
                                // Scan row for Action
                                for (let i = 0; i < cells.length; i++) {
                                     const txt = cells[i].innerText.trim();
                                     if (['Buy', 'Sell', 'Deposit', 'Withdrawal'].some(k => txt === k)) {
                                         idx.action = i;
                                         action = txt;
                                         // Update relative implications?
                                         if (idx.symbol === -1) idx.symbol = i - 1;
                                         if (idx.openDate === -1) idx.openDate = i - 3; // Usually
                                         if (idx.lots === -1) idx.lots = i + 1;
                                         break;
                                     }
                                }
                            }

                            // Data Extraction
                            const openDate = getCell(idx.openDate);
                            const closeDate = getCell(idx.closeDate);
                            const symbol = getCell(idx.symbol);
                            const lots = getCell(idx.lots);
                            const openPrice = getCell(idx.priceOpen);
                            const closePrice = getCell(idx.priceClose);
                            const pips = getCell(idx.pips);
                            const profit = getCell(idx.profit);
                            
                            // Comment extraction (Button often contains full text)
                            const btn = row.querySelector('button[data-modal-comment]');
                            const fullComment = btn ? btn.getAttribute('data-modal-comment') : (row.querySelector('.comment')?.innerText || '');

                            // Final Verification for important fields
                            // If lots is empty, try class .lots
                            let finalLots = lots;
                            if (!finalLots) {
                                const el = row.querySelector('.lots');
                                if (el) finalLots = el.innerText.trim();
                            }

                            data.push({
                                openTime: openDate,
                                closeTime: closeDate,
                                symbol: symbol,
                                action: action,
                                lots: finalLots,
                                openPrice: openPrice,
                                closePrice: closePrice,
                                pips: pips,
                                profit: profit,
                                comment: fullComment
                            });
                        });
                        return {
                            data: data,
                            headers: headers,
                            indices: idx
                        };
                    }""")
                    
                    # Unpack result
                    # Check if result is list (legacy) or dict (new)
                    if isinstance(page_trades, list):
                        # Should not happen with new code, but safety
                        pass
                    else:
                        debug_headers = page_trades.get('headers', [])
                        debug_indices = page_trades.get('indices', {})
                        page_trades = page_trades.get('data', [])
                        
                        if page_num == 1:
                            log(f"DEBUG TABLE HEADERS: {debug_headers}")
                            log(f"DEBUG COL INDICES: {debug_indices}")

                    if not page_trades:
                        log(f"   ❌ No trades found on page {page_num}. Breaking.")
                        # Dump table HTML for debug
                        try:
                            table_html = await page.evaluate("() => document.querySelector('#tradingHistoryTable')?.outerHTML?.substring(0, 2000) || 'TABLE NOT FOUND'")
                            log(f"   Table preview: {table_html[:500]}...")
                        except: pass
                        break

                    # DUPLICATE PAGE DETECTION
                    if page_trades == previous_page_trades:
                        log(f"   🔁 Page {page_num} is identical to previous page. Reached end of history.")
                        break
                    
                    previous_page_trades = page_trades

                    trades.extend(page_trades)
                    log(f"   ✅ Found {len(page_trades)} trades on page {page_num}. Total so far: {len(trades)}")
                    
                    # Show sample trade for debug
                    if page_trades and page_num == 1:
                        log(f"   📝 Sample trade: {page_trades[0]}")
                    # Pagination logic
                    next_text_selectors = ["li.next a", "a:has-text('Next')", "a:has-text('»')"]
                    next_btn = None
                    for sel in next_text_selectors:
                        try:
                            next_btn = await page.query_selector(sel)
                            if next_btn: break
                        except: pass
                    
                    if next_btn:
                        # check if disabled
                        try:
                            is_disabled = await next_btn.evaluate("el => el.parentElement.classList.contains('disabled')")
                            if not is_disabled:
                                log(f"Clicking NEXT button for page {page_num + 1}...")
                                # Use force=True to bypass "element not visible" or "obscured by sticky header"
                                await next_btn.click(force=True, timeout=5000)
                                await asyncio.sleep(5) # Wait for AJAX load
                                page_num += 1
                            else:
                                log("Next button is disabled. Reached last page.")
                                break
                        except Exception as e:
                            log(f"Error clicking next button: {e}")
                            break
                    else:
                        log("No 'Next' button found. Reached last page.")
                        break
                
                log("="*60)
                log(f"🏁 SCRAPING COMPLETE! Total trades: {len(trades)}")
                log("="*60)
                return {"success": True, "history": trades}

            except Exception as e:
                import traceback
                log(f"❌ SCRAPING ERROR: {e}")
                log(f"   Traceback: {traceback.format_exc()}")
                return {"success": False, "error": str(e)}
            finally:
                log("🔒 Closing browser...")
                if browser: await browser.close()
                log("✅ Browser closed.")

