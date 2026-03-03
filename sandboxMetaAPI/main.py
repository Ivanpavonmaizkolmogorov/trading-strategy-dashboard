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
DEFAULT_ACCOUNT = "7b379397-bcb3-4435-9d83-3efd53c2a0f9"

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

@app.get("/", response_class=HTMLResponse)
async def get_ui():
    dir_path = os.path.dirname(os.path.realpath(__file__))
    index_path = os.path.join(dir_path, "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        html_content = f.read()
    
    # Replace templates values dynamically
    html_content = html_content.replace("{DEFAULT_TOKEN}", DEFAULT_TOKEN)
    html_content = html_content.replace("{DEFAULT_ACCOUNT}", DEFAULT_ACCOUNT)
    return HTMLResponse(content=html_content, status_code=200)

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
        # Default to today from 00:00:00 UTC if no time provided
        now = datetime.now(timezone.utc)
        time_to = now if not req.time_to else datetime.fromisoformat(req.time_to.replace('Z', '+00:00'))
        time_from = now.replace(hour=0, minute=0, second=0, microsecond=0) if not req.time_from else datetime.fromisoformat(req.time_from.replace('Z', '+00:00'))
        
        connection = await get_connection(req.token, req.account_id)
        
        # To get realized PnL and Magic Numbers of closed positions, we need DEALS, not orders.
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
            
            # Not all history deals have magic numbers or profit (e.g., deposits/withdrawals)
            magic = int(d.get('magic', 0)) if is_dict else int(getattr(d, 'magic', 0))
            prof = float(d.get('profit', 0.0)) if is_dict else float(getattr(d, 'profit', 0.0))
            
            # Support PnL calculation from history deals including commission and swap
            commission = float(d.get('commission', 0.0)) if is_dict else float(getattr(d, 'commission', 0.0))
            swap = float(d.get('swap', 0.0)) if is_dict else float(getattr(d, 'swap', 0.0))
            
            total_prof = prof + commission + swap
            
            # Sum totals
            realized_pnl += total_prof
            
            # Group by magic number
            magic_key = str(magic)
            if magic_key not in magic_stats:
                magic_stats[magic_key] = {"orders": 0, "profit": 0.0}
            magic_stats[magic_key]["orders"] += 1
            magic_stats[magic_key]["profit"] += total_prof
            
            parsed_orders.append({
                "id": oid,
                "symbol": sym,
                "magic": magic,
                "profit": total_prof,
                "raw": str(d)  # Temporary raw print in the JSON payload
            })
            
        return {
            "realized_pnl": realized_pnl,
            "total_orders": len(parsed_orders),
            "magic_breakdown": magic_stats,
            "orders": parsed_orders,
            "time_from": time_from.isoformat(),
            "time_to": time_to.isoformat()
        }
    except Exception as e:
        import traceback
        with open("history_crash.log", "w") as f:
            f.write(traceback.format_exc())
            f.write(f"\nCrash: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if connection:
            await connection.close()

if __name__ == "__main__":
    if os.name == 'nt':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    uvicorn.run("main:app", host="127.0.0.1", port=8002, reload=True)
