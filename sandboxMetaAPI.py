import asyncio
import os
import traceback
from datetime import datetime, timedelta, timezone
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
import uvicorn
from metaapi_cloud_sdk import MetaApi

# ==========================================
# CONFIGURACIÓN ORIGINAL PREDETERMINADA
# ==========================================
DEFAULT_TOKEN = "eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI0ZDAyZWIxNjkxN2EzY2UwYzYxNDZlMGYzNmQ3MmQwMSIsImFjY2Vzc1J1bGVzIjpbeyJpZCI6InRyYWRpbmctYWNjb3VudC1tYW5hZ2VtZW50LWFwaSIsIm1ldGhvZHMiOlsidHJhZGluZy1hY2NvdW50LW1hbmFnZW1lbnQtYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVzdC1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcnBjLWFwaSIsIm1ldGhvZHMiOlsibWV0YWFwaS1hcGk6d3M6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVhbC10aW1lLXN0cmVhbWluZy1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOndzOnB1YmxpYzoqOioiXSwicm9sZXMiOlsicmVhZGVyIiwid3JpdGVyIl0sInJlc291cmNlcyI6WyIqOiRVU0VSX0lEJDoqIl19XSwiaWdub3JlUmF0ZUxpbWl0cyI6ZmFsc2UsInRva2VuSWQiOiIyMDIxMDIxMyIsImltcGVyc29uYXRlZCI6ZmFsc2UsInJlYWxVc2VySWQiOiI0ZDAyZWIxNjkxN2EzY2UwYzYxNDZlMGYzNmQ3MmQwMSIsImlhdCI6MTc3MjQ2NDEwNH0.dUk5B_PmjVS4HARlwXnnsrymYVJAxygG-iTG8hucQY55Q76jIPeKkqJRfACbMKLOplBp2eyQqv060HIpuZmlyaeK-YxE232MaOigU-DZ2yOwGCnduIOPMVfABiT-rXFJSKqiFykONUZLsyxuYY_v0-djeHfamAWDzE_heu_q-gbzIfruCq69QVcBwiJNDV4HAG7nmiK4y_LkdaV0qDM-QL3hy9MLxs92FJcQbgxye7t-VfSeH4XQZdyvNKQyDm2o6HBvHJF-QXroSq4QuOL2xXP1GnPlCE8f23jbG5gCAh2ghlU-TXbjcpCNvofqqg5hiTYBClRwYTUvZN05t-z4rIH3IbaKpcr9Iry583CKondshsYY8PopNXtlTbe7-NfJ5BYhdo4xchRWEYzfv6EsKkM11nefI-Q5_rvFFgfNS54usqqp4QVZK5Ief5z1bbKRWWfILS3mL7o3_8-uLluf8azEZb8kyHHpUhbAeXA_9b-IhIQDaJBgstrYACRwqhnXZgt9w2V1cEpD5tUeP9wm5JwrPeHUXbEQiLq_eAnoz-6Z-VCOQo2jgSi-2rxfZBDRa_DqnStBdQmvaF7AESupVjwy7qUJ3QpOeNaym5VCzhFKfJs-SheCTnLF4g1In_yEzG7V5y2a87VaGpayuP3VTRzZValInqhDfugFC32K0y0"
DEFAULT_ACCOUNT = "bbb3ea8d-4161-4663-a307-f75f838276a1"

app = FastAPI(title="MetaApi HTML Sandbox")

class ConnectionRequest(BaseModel):
    token: str
    account_id: str

class CloseRequest(ConnectionRequest):
    position_id: str

class CloseAllRequest(ConnectionRequest):
    pass

class HistoryRequest(ConnectionRequest):
    time_from: str = None # ISO format, if None uses beginning of today
    time_to: str = None   # ISO format, if None uses now

async def get_connection(token: str, account_id: str):
    api = MetaApi(token=token)
    account = await api.metatrader_account_api.get_account(account_id)
    if account.state != 'DEPLOYED':
        await account.deploy()
        await account.wait_connected()
    
    connection = account.get_rpc_connection()
    await connection.connect()
    await connection.wait_synchronized()
    return connection

HTML_TEMPLATE = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MetaApi Trading Sandbox</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {{
            --bg-color: #0f172a;
            --surface-color: rgba(30, 41, 59, 0.7);
            --primary-color: #3b82f6;
            --primary-hover: #2563eb;
            --danger-color: #ef4444;
            --danger-hover: #dc2626;
            --warning-color: #f59e0b;
            --warning-hover: #d97706;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --border-color: rgba(255, 255, 255, 0.1);
        }}
        body {{
            font-family: 'Outfit', sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
            color: var(--text-main);
            margin: 0;
            padding: 2rem;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
        }}
        h1 {{
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            background: linear-gradient(to right, #60a5fa, #c084fc);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }}
        .subtitle {{
            color: var(--text-muted);
            margin-bottom: 2rem;
        }}
        .glass-panel {{
            background: var(--surface-color);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid var(--border-color);
            border-radius: 16px;
            padding: 2rem;
            width: 100%;
            max-width: 800px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            margin-bottom: 2rem;
        }}
        .form-group {{
            margin-bottom: 1.5rem;
        }}
        label {{
            display: block;
            margin-bottom: 0.5rem;
            font-size: 0.9rem;
            font-weight: 500;
            color: var(--text-muted);
        }}
        input[type="text"],
        input[type="password"] {{
            width: 100%;
            padding: 0.75rem 1rem;
            border-radius: 8px;
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid var(--border-color);
            color: var(--text-main);
            font-family: 'Outfit', sans-serif;
            box-sizing: border-box;
            transition: all 0.2s ease;
        }}
        input[type="text"]:focus,
        input[type="password"]:focus {{
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
        }}
        button {{
            background: var(--primary-color);
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 8px;
            font-weight: 600;
            font-family: 'Outfit', sans-serif;
            cursor: pointer;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            margin-right: 0.5rem;
        }}
        button:hover {{
            background: var(--primary-hover);
            transform: translateY(-1px);
        }}
        button:disabled {{
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }}
        .btn-danger {{
            background: var(--danger-color);
        }}
        .btn-danger:hover {{
            background: var(--danger-hover);
        }}
        .btn-warning {{
            background: var(--warning-color);
        }}
        .btn-warning:hover {{
            background: var(--warning-hover);
        }}
        .metrics-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.5rem;
            margin-top: 1.5rem;
            margin-bottom: 1.5rem;
        }}
        .metric-card {{
            background: rgba(15, 23, 42, 0.5);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 1.5rem;
            text-align: center;
        }}
        .metric-value {{
            font-size: 2rem;
            font-weight: 700;
            margin-top: 0.5rem;
        }}
        .up {{ color: #4ade80; }}
        .down {{ color: #ef4444; }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin-top: 1.5rem;
            table-layout: fixed;
        }}
        th, td {{
            text-align: left;
            padding: 1rem;
            border-bottom: 1px solid var(--border-color);
            word-wrap: break-word;
        }}
        th {{
            color: var(--text-muted);
            font-weight: 500;
            font-size: 0.9rem;
        }}
        .loader {{
            display: none;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 1s ease-in-out infinite;
        }}
        @keyframes spin {{
            to {{ transform: rotate(360deg); }}
        }}
        #logArea {{
            background: #0f172a;
            border-radius: 8px;
            padding: 1rem;
            font-family: monospace;
            font-size: 0.85rem;
            color: #10b981;
            height: 150px;
            overflow-y: auto;
            border: 1px solid var(--border-color);
        }}
        .tab-buttons {{
            display: flex;
            margin-bottom: 1rem;
            border-bottom: 1px solid var(--border-color);
        }}
        .tab-btn {{
            background: transparent;
            color: var(--text-muted);
            border-radius: 0;
            border-bottom: 2px solid transparent;
        }}
        .tab-btn.active {{
            color: var(--primary-color);
            border-bottom: 2px solid var(--primary-color);
        }}
        .tab-btn:hover {{
            background: rgba(255, 255, 255, 0.05);
            transform: none;
        }}
        .tab-content {{
            display: none;
        }}
        .tab-content.active {{
            display: block;
        }}
    </style>
</head>
<body>
    <h1>MetaApi Sandbox</h1>
    <div class="subtitle">IronRisk PoC Interactiva 🚀</div>
    <div class="glass-panel">
        <h2>1. Credenciales de la Cuenta</h2>
        <div class="form-group">
            <label>META_API_TOKEN</label>
            <input type="password" id="token" value="{{DEFAULT_TOKEN}}">
        </div>
        <div class="form-group">
            <label>ACCOUNT_ID</label>
            <input type="text" id="accountId" value="{{DEFAULT_ACCOUNT}}">
        </div>
        <button id="btnConnect" onclick="connectAndFetch()">
            <span class="btn-text">Conectar y Sincronizar</span>
            <div class="loader" id="loaderConnect"></div>
        </button>
    </div>

    <div class="glass-panel" id="resultsPanel" style="display: none;">
        <h2>2. Estado en Tiempo Real</h2>

        <div class="tab-buttons">
            <button class="tab-btn active" onclick="switchTab('tab-pos')">Posiciones (Flotante)</button>
            <button class="tab-btn" onclick="switchTab('tab-hist')">Histórico (Día de Hoy)</button>
        </div>

        <div id="tab-pos" class="tab-content active">
            <div class="metrics-grid">
                <div class="metric-card">
                    <div style="color: var(--text-muted); font-size: 0.9rem;">Balance</div>
                    <div class="metric-value" id="valBalance">0.00</div>
                </div>
                <div class="metric-card">
                    <div style="color: var(--text-muted); font-size: 0.9rem;">Equity</div>
                    <div class="metric-value" id="valEquity">0.00</div>
                </div>
                <div class="metric-card">
                    <div style="color: var(--text-muted); font-size: 0.9rem;">PnL Flotante</div>
                    <div class="metric-value" id="valPnl">0.00</div>
                </div>
            </div>

            <h3 style="display: flex; justify-content: space-between; align-items: center;">
                Posiciones Abiertas
                <button class="btn-danger" id="btnCloseAll" onclick="closeAllPositions()"
                    style="font-size: 0.8rem; padding: 0.5rem 1rem;">Cierre de Pánico (Cerrar Todas)</button>
            </h3>
            <table id="positionsTable">
                <thead>
                    <tr>
                        <th>ID / Ticket</th>
                        <th>Símbolo</th>
                        <th>Volumen</th>
                        <th>Beneficio</th>
                        <th>Acción</th>
                    </tr>
                </thead>
                <tbody id="positionsBody">
                </tbody>
            </table>
        </div>

        <div id="tab-hist" class="tab-content">
            <button class="btn-warning" id="btnHistory" onclick="fetchHistory()" style="margin-bottom: 1rem;">
                <span class="btn-text">Consultar Histórico Hoy</span>
                <div class="loader" id="loaderHistory"></div>
            </button>

            <div class="metrics-grid">
                <div class="metric-card">
                    <div style="color: var(--text-muted); font-size: 0.9rem;">PnL Cerrado (Hoy)</div>
                    <div class="metric-value" id="valHistPnl">0.00</div>
                </div>
                <div class="metric-card">
                    <div style="color: var(--text-muted); font-size: 0.9rem;">Total Órdenes Cerradas</div>
                    <div class="metric-value" id="valHistOrders">0</div>
                </div>
            </div>

            <h3 style="margin-top: 1rem;">Desglose por Magic Number</h3>
            <table id="magicTable">
                <thead>
                    <tr>
                        <th>Magic Number</th>
                        <th>Órdenes</th>
                        <th>Beneficio (PnL)</th>
                    </tr>
                </thead>
                <tbody id="magicBody">
                    <tr>
                        <td colspan="3" style="text-align: center; color: #94a3b8;">Sin datos. Consulta el histórico.
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>

    <div class="glass-panel">
        <h2>Registro del Consola</h2>
        <div id="logArea"> Esperando acción...</div>
    </div>

    <script>
        function log(msg) {{
            const logArea = document.getElementById('logArea');
            const time = new Date().toLocaleTimeString();
            logArea.innerHTML += `<div>[${{time}}] ${{msg}}</div>`;
            logArea.scrollTop = logArea.scrollHeight;
        }}

        function formatCurrency(num) {{
            return new Intl.NumberFormat('en-US', {{ style: 'currency', currency: 'USD' }}).format(num);
        }}

        function switchTab(tabId) {{
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

            document.getElementById(tabId).classList.add('active');
            event.target.classList.add('active');
        }}

        async function connectAndFetch() {{
            const btn = document.getElementById('btnConnect');
            const loader = document.getElementById('loaderConnect');
            const token = document.getElementById('token').value;
            const accountId = document.getElementById('accountId').value;

            if (!token || !accountId) {{
                log('<span style="color: #ef4444;">❌ Faltan credenciales.</span>');
                return;
            }}

            btn.disabled = true;
            loader.style.display = 'block';
            log(`Conectando a RPC de MetaApi para la cuenta ${{accountId}}...`);

            try {{
                const res = await fetch('/api/info', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ token: token, account_id: accountId }})
                }});

                const data = await res.json();

                if (!res.ok) throw new Error(data.detail || "Error desconocido");

                document.getElementById('resultsPanel').style.display = 'block';
                document.getElementById('valBalance').innerText = formatCurrency(data.balance);
                document.getElementById('valEquity').innerText = formatCurrency(data.equity);

                const pnlEl = document.getElementById('valPnl');
                pnlEl.innerText = formatCurrency(data.floating_pnl);
                pnlEl.className = 'metric-value ' + (data.floating_pnl >= 0 ? 'up' : 'down');

                renderPositions(data.positions);
                log('✅ Datos (Balance y Posiciones) sincronizados correctamente.');

            }} catch (e) {{
                log(`<span style="color: #ef4444;">❌ Error: ${{e.message}}</span>`);
            }} finally {{
                btn.disabled = false;
                loader.style.display = 'none';
            }}
        }}

        function renderPositions(positions) {{
            const tbody = document.getElementById('positionsBody');
            tbody.innerHTML = '';

            if (!positions || positions.length === 0) {{
                tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #94a3b8;">No hay posiciones abiertas.</td></tr>';
                return;
            }}

            positions.forEach(p => {{
                const tr = document.createElement('tr');
                const pnlClass = p.profit >= 0 ? 'up' : 'down';

                tr.innerHTML = `
                    <td>${{p.id}}</td>
                    <td><strong>${{p.symbol}}</strong></td>
                    <td>${{p.volume}}</td>
                    <td class="${{pnlClass}}">${{formatCurrency(p.profit)}}</td>
                    <td>
                        <button class="btn-danger" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" onclick="closePosition('${{p.id}}', this)">
                            Cerrar
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            }});
        }}

        async function closePosition(posId, btnElement) {{
            const token = document.getElementById('token').value;
            const accountId = document.getElementById('accountId').value;

            if (!confirm(`¿Estás seguro de que quieres cerrar la posición ${{posId}}?`)) return;

            const originalText = btnElement.innerText;
            btnElement.innerText = "...";
            btnElement.disabled = true;
            log(`Enviando orden de cierre para la posición ${{posId}}...`);

            try {{
                const res = await fetch('/api/close', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ token: token, account_id: accountId, position_id: posId }})
                }});

                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || "Fallo en cierre");

                log(`✅ Posición cerrada con éxito.`);
                connectAndFetch(); // Refresh
            }} catch (e) {{
                log(`<span style="color: #ef4444;">❌ Error cerrando: ${{e.message}}</span>`);
                btnElement.innerText = originalText;
                btnElement.disabled = false;
            }}
        }}

        async function closeAllPositions() {{
            const token = document.getElementById('token').value;
            const accountId = document.getElementById('accountId').value;
            const btnElement = document.getElementById('btnCloseAll');

            if (!confirm(`🔥 ALERTA DE PÁNICO: ¿Estás seguro de que quieres CERRAR TODAS las posiciones de golpe?`)) return;

            const originalText = btnElement.innerText;
            btnElement.innerText = "Cerrando...";
            btnElement.disabled = true;
            log(`🚨 Enviando orden de CIERRE DE PÁNICO para todas las posiciones...`);

            try {{
                const res = await fetch('/api/close_all', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ token: token, account_id: accountId }})
                }});

                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || "Fallo en cierre masivo");

                log(`✅ Cierre de pánico completado: ${{data.message}}`);
                connectAndFetch(); // Refresh
            }} catch (e) {{
                log(`<span style="color: #ef4444;">❌ Error en cierre masivo: ${{e.message}}</span>`);
                btnElement.innerText = originalText;
                btnElement.disabled = false;
            }}
        }}

        async function fetchHistory() {{
            const btn = document.getElementById('btnHistory');
            const loader = document.getElementById('loaderHistory');
            const token = document.getElementById('token').value;
            const accountId = document.getElementById('accountId').value;

            btn.disabled = true;
            loader.style.display = 'block';
            log(`Consultando el histórico de órdenes (PnL Diario) para la cuenta ${{accountId}}...`);

            try {{
                const res = await fetch('/api/history', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ token: token, account_id: accountId }})
                }});

                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || "Error obteniendo histórico");

                const pnlEl = document.getElementById('valHistPnl');
                pnlEl.innerText = formatCurrency(data.realized_pnl);
                pnlEl.className = 'metric-value ' + (data.realized_pnl >= 0 ? 'up' : 'down');

                document.getElementById('valHistOrders').innerText = data.total_orders;

                // Render Magic Numbers Table
                const tbody = document.getElementById('magicBody');
                tbody.innerHTML = '';

                if (Object.keys(data.magic_breakdown).length === 0) {{
                    tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #94a3b8;">No se encontraron órdenes registradas hoy.</td></tr>';
                }} else {{
                    for (const [magic, stats] of Object.entries(data.magic_breakdown)) {{
                        const tr = document.createElement('tr');
                        const pnlClass = stats.profit >= 0 ? 'up' : 'down';
                        tr.innerHTML = `
                            <td><strong>${{magic}}</strong></td>
                            <td>${{stats.orders}}</td>
                            <td class="${{pnlClass}}">${{formatCurrency(stats.profit)}}</td>
                        `;
                        tbody.appendChild(tr);
                    }}
                }}

                log(`✅ Histórico consultado correctamente. PnL Cerrado: ${{formatCurrency(data.realized_pnl)}}`);
            }} catch (e) {{
                log(`<span style="color: #ef4444;">❌ Error: ${{e.message}}</span>`);
            }} finally {{
                btn.disabled = false;
                loader.style.display = 'none';
            }}
        }}
    </script>
</body>
</html>"""

@app.get("/", response_class=HTMLResponse)
async def get_ui():
    html = HTML_TEMPLATE.replace("{DEFAULT_TOKEN}", DEFAULT_TOKEN).replace("{DEFAULT_ACCOUNT}", DEFAULT_ACCOUNT)
    return HTMLResponse(content=html, status_code=200)

@app.post("/api/info")
async def get_info(req: ConnectionRequest):
    connection = None
    try:
        connection = await get_connection(req.token, req.account_id)
        account_info = await connection.get_account_information()
        
        if isinstance(account_info, dict):
            balance = account_info.get('balance', 0)
            equity = account_info.get('equity', 0)
        else:
            balance = getattr(account_info, 'balance', 0)
            equity = getattr(account_info, 'equity', 0)
            
        floating_pnl = equity - balance
        positions = await connection.get_positions()
        
        parsed_positions = []
        for p in positions:
            if isinstance(p, dict):
                pid = str(p.get('id', p.get('ticket')))
                sym = p.get('symbol', 'UNKNOWN')
                vol = p.get('volume', 0)
                prof = p.get('profit', 0)
                parsed_positions.append({"id": pid, "symbol": sym, "volume": vol, "profit": prof})
            else:
                pid = str(getattr(p, 'id', getattr(p, 'ticket', None)))
                sym = getattr(p, 'symbol', 'UNKNOWN')
                vol = getattr(p, 'volume', 0)
                prof = getattr(p, 'profit', 0)
                parsed_positions.append({"id": pid, "symbol": sym, "volume": vol, "profit": prof})
                
        return {
            "balance": balance,
            "equity": equity,
            "floating_pnl": floating_pnl,
            "positions": parsed_positions
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if connection:
            await connection.close()

@app.post("/api/close")
async def close_pos(req: CloseRequest):
    connection = None
    try:
        connection = await get_connection(req.token, req.account_id)
        await connection.close_position(req.position_id)
        return {"success": True, "message": f"Position {req.position_id} successfully closed."}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if connection:
            await connection.close()

@app.post("/api/close_all")
async def close_all_pos(req: CloseAllRequest):
    connection = None
    try:
        connection = await get_connection(req.token, req.account_id)
        positions = await connection.get_positions()
        closed_count = 0
        errors = []
        
        for p in positions:
            pid = str(p.get('id', p.get('ticket')) if isinstance(p, dict) else getattr(p, 'id', getattr(p, 'ticket', None)))
            try:
                await connection.close_position(pid)
                closed_count += 1
            except Exception as trade_e:
                errors.append(f"Failed to close {pid}: {str(trade_e)}")
                
        return {
            "success": True, 
            "message": f"Closed {closed_count} positions. Errors: {', '.join(errors) if errors else 'None'}"
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if connection:
            await connection.close()

@app.post("/api/history")
async def get_history(req: HistoryRequest):
    connection = None
    try:
        now = datetime.now(timezone.utc)
        time_to = now if not req.time_to else datetime.fromisoformat(req.time_to.replace('Z', '+00:00'))
        time_from = now.replace(hour=0, minute=0, second=0, microsecond=0) if not req.time_from else datetime.fromisoformat(req.time_from.replace('Z', '+00:00'))
        
        connection = await get_connection(req.token, req.account_id)
        
        deals_raw = await connection.get_deals_by_time_range(time_from, time_to)
        
        deals = []
        if isinstance(deals_raw, dict):
            deals = deals_raw.get('deals', [])
        elif isinstance(deals_raw, list):
            deals = deals_raw
        elif hasattr(deals_raw, 'deals'):
            deals = deals_raw.deals
            
        parsed_orders = []
        realized_pnl = 0.0
        magic_stats = {}
        
        for d in deals:
            is_dict = isinstance(d, dict)
            oid = str(d.get('id', d.get('ticket', ''))) if is_dict else str(getattr(d, 'id', getattr(d, 'ticket', '')))
            sym = d.get('symbol', 'UNKNOWN') if is_dict else getattr(d, 'symbol', 'UNKNOWN')
            magic = int(d.get('magic', 0)) if is_dict else int(getattr(d, 'magic', 0))
            prof = float(d.get('profit', 0.0)) if is_dict else float(getattr(d, 'profit', 0.0))
            commission = float(d.get('commission', 0.0)) if is_dict else float(getattr(d, 'commission', 0.0))
            swap = float(d.get('swap', 0.0)) if is_dict else float(getattr(d, 'swap', 0.0))
            
            total_prof = prof + commission + swap
            realized_pnl += total_prof
            
            magic_key = str(magic)
            if magic_key not in magic_stats:
                magic_stats[magic_key] = {"orders": 0, "profit": 0.0}
            magic_stats[magic_key]["orders"] += 1
            magic_stats[magic_key]["profit"] += total_prof
            
            parsed_orders.append({"id": oid, "symbol": sym, "magic": magic, "profit": total_prof})
            
        return {
            "realized_pnl": realized_pnl,
            "total_orders": len(parsed_orders),
            "magic_breakdown": magic_stats,
            "orders": parsed_orders,
            "time_from": time_from.isoformat(),
            "time_to": time_to.isoformat()
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if connection:
            await connection.close()

if __name__ == "__main__":
    if os.name == 'nt':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    uvicorn.run("sandboxMetaAPI:app", host="127.0.0.1", port=8000, reload=True)
