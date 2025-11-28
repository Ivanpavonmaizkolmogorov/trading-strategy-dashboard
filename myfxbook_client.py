"""
Myfxbook API Client
Handles authentication and data retrieval from Myfxbook accounts.
API Documentation: https://www.myfxbook.com/api
"""

import requests
from typing import Dict, List, Optional
import time
from urllib.parse import unquote


class MyfxbookAPIError(Exception):
    """Custom exception for Myfxbook API errors"""
    pass

class MyfxbookClient:
    """Client for interacting with Myfxbook API"""
    
    BASE_URL = "https://www.myfxbook.com/api"
    
    def __init__(self):
        self.session_token: Optional[str] = None
        self.session_expiry: Optional[float] = None
        self.http_session = requests.Session()

    
    def login(self, email: str, password: str) -> str:
        """
        Login to Myfxbook and obtain a session token.
        
        Session tokens:
        - Are IP-bound
        - Expire after 1 month
        - Can be revoked early with logout()
        
        Args:
            email: Myfxbook account email
            password: Myfxbook account password
            
        Returns:
            Session token string
            
        Raises:
            MyfxbookAPIError: If login fails
        """
        print(f"[Myfxbook] Attempting login for: {email}")
        
        url = f"{self.BASE_URL}/login.json"
        params = {
            "email": email,
            "password": password
        }
        
        try:
            print(f"[Myfxbook] 🔄 Making login request to: {url}")
            print(f"[Myfxbook] 📧 Email: {email}")
            print(f"[Myfxbook] 🔑 Password length: {len(password)} chars")
            
            response = self.http_session.get(url, params=params, timeout=10)
            
            print(f"[Myfxbook] 📡 Response status: {response.status_code}")
            print(f"[Myfxbook] 📡 Response headers: {dict(response.headers)}")
            
            response.raise_for_status()
            
            data = response.json()
            print(f"[Myfxbook] 📦 Full response data: {data}")
            
            if data.get("error", True):
                error_msg = data.get("message", "Unknown error")
                print(f"[Myfxbook] ❌ API returned error flag. Message: {error_msg}")
                raise MyfxbookAPIError(f"Login failed: {error_msg}")
            
            self.session_token = unquote(data.get("session"))

            
            if not self.session_token:
                print(f"[Myfxbook] ❌ No session token in response!")
                raise MyfxbookAPIError("Login failed: No session token received")
            
            # Session expires in 1 month (30 days)
            self.session_expiry = time.time() + (30 * 24 * 60 * 60)
            
            print(f"[Myfxbook] ✅ Login successful. Session: {self.session_token[:12]}...")
            return self.session_token
            
        except requests.RequestException as e:
            print(f"[Myfxbook] ❌ Network error during login: {str(e)}")
            raise MyfxbookAPIError(f"Network error during login: {str(e)}")
    
    def logout(self) -> bool:
        """
        Logout and revoke the current session token.
        
        Returns:
            True if logout successful
        """
        if not self.session_token:
            print("[Myfxbook] No active session to logout")
            return True
        
        print(f"[Myfxbook] Logging out session: {self.session_token[:8]}...")
        
        url = f"{self.BASE_URL}/logout.json"
        params = {"session": self.session_token}
        
        try:
            response = self.http_session.get(url, params=params, timeout=10)
            data = response.json()
            
            self.session_token = None
            self.session_expiry = None
            
            print("[Myfxbook] Logout successful")
            return True
            
        except Exception as e:
            print(f"[Myfxbook] Logout error (ignoring): {e}")
            return False
    
    def get_my_accounts(self) -> List[Dict]:
        """
        Get all accounts associated with the logged-in user.
        
        Returns:
            List of account dictionaries with basic info
            
        Raises:
            MyfxbookAPIError: If not logged in or request fails
        """
        if not self.session_token:
            raise MyfxbookAPIError("Not logged in. Call login() first.")
        
        print("[Myfxbook] Fetching user accounts...")
        
        url = f"{self.BASE_URL}/get-my-accounts.json"
        params = {"session": self.session_token}
        
        try:
            response = self.http_session.get(url, params=params, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            
            if data.get("error", False):
                error_msg = data.get("message", "Unknown error")
                raise MyfxbookAPIError(f"Failed to get accounts: {error_msg}")
            
            accounts = data.get("accounts", [])
            print(f"[Myfxbook] Found {len(accounts)} accounts")
            
            return accounts
            
        except requests.RequestException as e:
            raise MyfxbookAPIError(f"Network error: {str(e)}")
    
    def get_history(self, account_id: int) -> List[Dict]:
        """
        Get the last 50 closed trades for an account.
        
        NOTE: Myfxbook API only returns last 50 transactions.
        
        Args:
            account_id: Myfxbook account ID
            
        Returns:
            List of trade dictionaries
            
        Raises:
            MyfxbookAPIError: If not logged in or request fails
        """
        if not self.session_token:
            raise MyfxbookAPIError("Not logged in. Call login() first.")
        
        print(f"[Myfxbook] Fetching history for account: {account_id}")
        
        url = f"{self.BASE_URL}/get-history.json"
        params = {
            "session": self.session_token,
            "id": account_id
        }
        
        try:
            print(f"[Myfxbook] 🔄 Fetching history from: {url}")
            print(f"[Myfxbook] 📋 Account ID: {account_id}")
            print(f"[Myfxbook] 🎫 Session token: {self.session_token[:12] if self.session_token else 'NONE'}...")
            
            response = self.http_session.get(url, params=params, timeout=10)
            
            print(f"[Myfxbook] 📡 Response status: {response.status_code}")
            
            response.raise_for_status()
            
            data = response.json()
            print(f"[Myfxbook] 📦 Full response data: {data}")
            
            if data.get("error", False):
                error_msg = data.get("message", "Unknown error")
                print(f"[Myfxbook] ❌ API returned error: {error_msg}")
                raise MyfxbookAPIError(f"Failed to get history: {error_msg}")
            
            history = data.get("history", [])
            print(f"[Myfxbook] ✅ Retrieved {len(history)} trades")
            
            return history
            
        except requests.RequestException as e:
            print(f"[Myfxbook] ❌ Network error: {str(e)}")
            raise MyfxbookAPIError(f"Network error: {str(e)}")
    
    def calculate_consecutive_losses(self, trades: List[Dict]) -> Dict:
        """
        Calculate consecutive losses from trade history.
        
        Args:
            trades: List of trade dictionaries from get_history()
            
        Returns:
            Dictionary with:
            - maxConsecutiveLosses: Historic maximum
            - currentConsecutiveLosses: Current streak (if last trade was loss)
            - isInLosingStreak: Boolean
        """
        print(f"[Myfxbook] Calculating consecutive losses from {len(trades)} trades")
        
        if not trades:
            return {
                "maxConsecutiveLosses": 0,
                "currentConsecutiveLosses": 0,
                "isInLosingStreak": False
            }
        
        # Sort by close date (oldest first)
        sorted_trades = sorted(trades, key=lambda x: x.get("closeDate", ""))
        
        max_consecutive = 0
        current_consecutive = 0
        last_was_loss = False
        
        for trade in sorted_trades:
            profit = float(trade.get("profit", 0))
            
            if profit < 0:  # Loss
                current_consecutive += 1
                max_consecutive = max(max_consecutive, current_consecutive)
                last_was_loss = True
            else:  # Win or breakeven
                current_consecutive = 0
                last_was_loss = False
        
        result = {
            "maxConsecutiveLosses": max_consecutive,
            "currentConsecutiveLosses": current_consecutive if last_was_loss else 0,
            "isInLosingStreak": last_was_loss
        }
        
        print(f"[Myfxbook] Max consecutive losses: {max_consecutive}")
        print(f"[Myfxbook] Current streak: {current_consecutive if last_was_loss else 0}")
        
        return result

    def calculate_max_drawdown(self, trades: List[Dict]) -> Dict:
        """
        Calculate Max Drawdown in Dollars from trade history.
        
        Args:
            trades: List of trade dictionaries
            
        Returns:
            Dictionary with:
            - maxDrawdownDollars: Maximum peak-to-valley drop in currency
        """
        print(f"[Myfxbook] Calculating Max Drawdown from {len(trades)} trades")
        
        if not trades:
            return {"maxDrawdownDollars": 0.0}
            
        # Sort by close date
        sorted_trades = sorted(trades, key=lambda x: x.get("closeDate", ""))
        
        equity = 0.0
        max_equity = 0.0
        max_dd_dollars = 0.0
        
        for trade in sorted_trades:
            # Profit includes swap and commission for accurate equity
            profit = float(trade.get("profit", 0)) + float(trade.get("swap", 0)) + float(trade.get("commission", 0))
            equity += profit
            
            if equity > max_equity:
                max_equity = equity
            
            drawdown = max_equity - equity
            if drawdown > max_dd_dollars:
                max_dd_dollars = drawdown
                
        print(f"[Myfxbook] Max Drawdown ($): {max_dd_dollars}")
        
        return {
            "maxDrawdownDollars": max_dd_dollars
        }
