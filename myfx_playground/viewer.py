from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates # Unused but kept to avoid shifting lines too much if not needed, but better remove it.
# Actually, I will just remove it cleanly.
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel
import traceback
import sys
import os

# Import local copy of client
from myfxbook_client import MyfxbookClient, MyfxbookAPIError
from scraper import MyfxbookScraper

app = FastAPI()

# CORS
origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Servir archivos estáticos (JS, CSS si los hubiera)
app.mount("/static", StaticFiles(directory="templates"), name="static")

# Models within this file to be self-contained
class MyfxbookCredentials(BaseModel):
    email: str
    password: str

class MyfxbookHistoryRequest(BaseModel):
    email: str
    password: str
    account_id: int

@app.get("/")
async def read_root():
    # Return the static HTML file purely
    return FileResponse("templates/index.html")

@app.post("/api/login")
async def login(creds: MyfxbookCredentials):
    try:
        print(f"[Viewer] Logging in for: {creds.email}")
        client = MyfxbookClient()
        session = client.login(creds.email, creds.password)
        accounts = client.get_my_accounts()
        client.logout()
        return {"success": True, "accounts": accounts, "count": len(accounts)}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"success": False, "detail": str(e)})

@app.post("/api/get-history")
async def get_history(req: MyfxbookHistoryRequest):
    try:
        print(f"[Viewer] Fetching history for account: {req.account_id}")
        client = MyfxbookClient()
        session = client.login(req.email, req.password)
        
        # Get everything raw
        history = client.get_history(req.account_id)
        open_trades = []
        try:
            open_trades = client.get_open_trades(req.account_id)
        except Exception as e:
            print(f"Warning: Failed to fetch open trades: {e}")

        # Account info for current balance/equity
        account_info = client.get_account_info(req.account_id)
        print(f"[Viewer] 📊 Account Info Data: {account_info}") # DEBUG: Inspect keys like 'trades', 'profit'
        
        print(f"[Viewer] Returning result -> History: {len(history)} trades, Open: {len(open_trades)} trades")
        
        client.logout()
        
        return {
            "success": True, 
            "history": history, 
            "openTrades": open_trades,
            "accountInfo": account_info
        }
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"success": False, "detail": str(e)})
        return JSONResponse(status_code=400, content={"success": False, "detail": str(e)})

@app.post("/api/scrape-history")
async def scrape_history(req: MyfxbookHistoryRequest):
    try:
        print(f"[Viewer] 🚀 Starting deep scan for account: {req.account_id}")
        scraper = MyfxbookScraper(req.email, req.password)
        
        # Scrape history (this might take a while, ideally should be a background task or streaming, 
        # but for this local tool, blocking is okay-ish or we can rely on long timeout)
        result = await scraper.scrape_history(req.account_id)
        
        if not result.get("success"):
            raise Exception(result.get("error", "Unknown scraping error"))
            
        history = result.get("history", [])
        print(f"[Viewer] 🏁 Deep scan complete. Found {len(history)} trades.")
        
        return {"success": True, "history": history}
    
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"success": False, "detail": str(e)})
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
