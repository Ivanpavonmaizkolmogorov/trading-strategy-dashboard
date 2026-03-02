import math
from datetime import datetime
import pandas as pd

class Trade:
    def __init__(self, data: dict, overrides: dict = None):
        self.original_data = data
        if overrides is None:
            overrides = {}

        # 1. Time parsing (store as timestamps for fast filtering)
        exit_str = data.get('exit_date') or data.get('exitTime') or data.get('closeTime') or data.get('closeDate') or data.get('entry_date')
        self.exit_time = self._parse_date(exit_str)
        self.exit_timestamp = int(self.exit_time.timestamp() * 1000) if self.exit_time else 0

        open_str = data.get('entry_date') or data.get('entryTime') or data.get('openTime') or data.get('openDate')
        self.open_time = self._parse_date(open_str)
        self.open_timestamp = int(self.open_time.timestamp() * 1000) if self.open_time else 0

        # 2. Base financials
        # Try to use 'pnl' directly if provided, otherwise compute baseNetPnL
        def safe_float(val):
            if val is None: return 0.0
            if isinstance(val, str):
                val = val.replace(',', '.')
                try: return float(val)
                except ValueError: return 0.0
            try:
                return float(val)
            except (ValueError, TypeError):
                return 0.0

        self.profit = safe_float(data.get('profit', data.get('pnl', 0)))
        self.commission = safe_float(data.get('commission', 0))
        self.swap = safe_float(data.get('swap', 0))
        self.base_net_pnl = self.profit + self.commission + self.swap

        # In backend, prefer 'pnl' key if it already encapsulates the final value
        # from the frontend payload, but fallback to base_net_pnl
        if 'pnl' in data and not math.isnan(safe_float(data['pnl'])):
            self.base_net_pnl = safe_float(data['pnl'])

        self.pnl = self.base_net_pnl
        self.is_neutralized = False

        self.exit_reason = str(data.get('exitReason') or data.get('close type') or data.get('exit_reason') or data.get('comment') or '')
        self.magic_number = data.get('magic') or data.get('magicNumber')

        # 3. Applying Manual Overrides from State (if passed)
        self.apply_overrides(overrides)

    def _parse_date(self, date_val):
        """Robust date parsing mirroring JS new Date() but using pandas for flexibility."""
        if not date_val:
            return None
        if isinstance(date_val, datetime):
            return date_val
        if isinstance(date_val, pd.Timestamp):
            return date_val.to_pydatetime()
        
        date_str = str(date_val)
        if '.' in date_str:
            date_str = date_str.replace('.', '-')
            
        try:
            return pd.to_datetime(date_str).to_pydatetime()
        except Exception:
            try:
                # Try dayfirst as fallback
                return pd.to_datetime(date_str, dayfirst=True).to_pydatetime()
            except Exception:
                return None

    def apply_overrides(self, overrides: dict):
        if not overrides:
            return

        override_key1 = str(self.original_data.get('id') or self.original_data.get('ticket') or '')
        strategy_id = self.original_data.get('strategyId')
        override_key2 = f"{strategy_id}::{self.exit_timestamp}" if strategy_id else None

        override = overrides.get(override_key1) or (overrides.get(override_key2) if override_key2 else None)
        
        self.is_neutralized = override.get('neutralized', False) if override else False

        if override:
            if override.get('realPnL') is not None:
                self.pnl = float(override['realPnL'])
            elif override.get('btPnL') is not None:
                self.pnl = float(override['btPnL'])
            else:
                self.pnl = self.base_net_pnl
        else:
            self.pnl = self.base_net_pnl

        if self.is_neutralized:
            self.pnl = 0.0
