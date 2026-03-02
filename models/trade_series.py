import math
import numpy as np
import pandas as pd
from typing import List, Dict, Any
from .trade import Trade

class TradeSeries:
    def __init__(self, trades: List[Trade], overrides: dict = None):
        if overrides is None:
            overrides = {}
            
        self.trades = []
        for t in trades:
            if isinstance(t, Trade):
                self.trades.append(t)
            else:
                self.trades.append(Trade(t, overrides))

        # Sort chronologically by exit timestamp for accurate equity curve and drawdowns
        self.trades.sort(key=lambda t: t.exit_timestamp)

        # Cache object to avoid recalculating KPIs if not needed
        self._cache = {}

    def update_overrides(self, overrides: dict):
        for t in self.trades:
            t.apply_overrides(overrides)
        self._cache = {}

    # --- Core Aggregations & Caching Engine ---

    def _calculate_core_metrics(self) -> dict:
        if 'coreMetrics' in self._cache:
            return self._cache['coreMetrics']

        total_profit = 0.0
        gross_profit = 0.0
        gross_loss = 0.0
        wins = 0
        losses = 0

        max_dd = 0.0
        peak_equity = 0.0
        current_equity = 0.0

        cur_consec_losses = 0
        max_consec_losses = 0
        cur_consec_wins = 0
        max_consec_wins = 0

        max_stagnation_days = 0.0
        peak_time = None

        # Stagnation in Trades
        trades_since_peak = 0
        max_stagnation_trades = 0
        peak_equity_for_stag_trades = 0.0

        trade_equity_curve = [0.0]  # Relative to 0 start
        daily_pnl = {}

        if self.trades and self.trades[0].exit_timestamp:
            peak_time = self.trades[0].exit_timestamp

        for t in self.trades:
            pnl = t.pnl
            total_profit += pnl
            current_equity += pnl
            trade_equity_curve.append(current_equity)

            # Daily PnL for Sharpe/Sortino
            if t.exit_time:
                day_key = t.exit_time.strftime('%Y-%m-%d')
                daily_pnl[day_key] = daily_pnl.get(day_key, 0.0) + pnl

            # Drawdown
            if current_equity > peak_equity:
                peak_equity = current_equity
            
            dd = peak_equity - current_equity
            if dd > max_dd:
                max_dd = dd

            # Update Peak Time for Stagnation
            if current_equity >= peak_equity and t.exit_timestamp:
                peak_time = t.exit_timestamp

            # Stagnation Days computation
            if peak_time and t.exit_timestamp:
                current_stagnation = (t.exit_timestamp - peak_time) / (1000 * 60 * 60 * 24)
                if current_stagnation > max_stagnation_days:
                    max_stagnation_days = current_stagnation
                    
            # Stagnation Trades
            if current_equity > peak_equity_for_stag_trades:
                if trades_since_peak > max_stagnation_trades:
                    max_stagnation_trades = trades_since_peak
                trades_since_peak = 0
                peak_equity_for_stag_trades = current_equity
            else:
                trades_since_peak += 1

            # Wins/Losses Streaks and Gross
            if pnl >= 0:
                wins += 1
                gross_profit += pnl
                cur_consec_wins += 1
                cur_consec_losses = 0
                if cur_consec_wins > max_consec_wins:
                    max_consec_wins = cur_consec_wins
            else:
                losses += 1
                gross_loss += pnl
                cur_consec_losses += 1
                cur_consec_wins = 0
                if cur_consec_losses > max_consec_losses:
                    max_consec_losses = cur_consec_losses

        # Final stagnation trades check
        if trades_since_peak > max_stagnation_trades:
            max_stagnation_trades = trades_since_peak

        total_trades = len(self.trades)
        win_rate = (wins / total_trades) * 100 if total_trades > 0 else 0.0
        profit_factor = (gross_profit / abs(gross_loss)) if abs(gross_loss) > 0 else (999.0 if gross_profit > 0 else 0.0)
        return_dd_ratio = (total_profit / max_dd) if max_dd > 0 else (999.0 if total_profit > 0 else 0.0)

        self._cache['coreMetrics'] = {
            'totalProfit': total_profit,
            'grossProfit': gross_profit,
            'grossLoss': gross_loss,
            'wins': wins,
            'losses': losses,
            'totalTrades': total_trades,
            'maxDD': max_dd,
            'winRate': win_rate,
            'profitFactor': profit_factor,
            'returnDDRatio': return_dd_ratio,
            'maxConsecLosses': max_consec_losses,
            'maxConsecWins': max_consec_wins,
            'maxStagnationDays': math.floor(max_stagnation_days),
            'maxStagnationTrades': max_stagnation_trades,
            'tradeEquityCurve': trade_equity_curve,
            'dailyPnL': daily_pnl
        }

        return self._cache['coreMetrics']

    def _calculate_advanced_metrics(self) -> dict:
        if 'advancedMetrics' in self._cache:
            return self._cache['advancedMetrics']
            
        core = self._calculate_core_metrics()

        initial_capital = 10000.0
        cagr_pct = 0.0
        upi = 0.0
        sharpe_ratio = 0.0
        sharpe_ratio_trade = 0.0
        sortino_ratio = 0.0
        sqn = 0.0
        gamma_flow_score = 0.0
        max_drawdown_pct = 0.0

        if not self.trades:
            self._cache['advancedMetrics'] = {
                'cagrPct': cagr_pct, 'upi': upi, 'sharpeRatio': sharpe_ratio, 
                'sharpeRatioTrade': sharpe_ratio_trade, 'sortinoRatio': sortino_ratio, 
                'sqn': sqn, 'gammaFlowScore': gamma_flow_score, 'maxDrawdownPct': max_drawdown_pct
            }
            return self._cache['advancedMetrics']

        first_date_ts = self.trades[0].exit_timestamp
        last_date_ts = self.trades[-1].exit_timestamp
        duration_days = (last_date_ts - first_date_ts) / (1000 * 60 * 60 * 24)
        duration_years = duration_days / 365.25
        final_equity = initial_capital + core['totalProfit']

        # 1. CAGR
        if duration_years > 0 and final_equity > 0:
            if duration_years < 1.0:
                cagr_pct = (((final_equity / initial_capital) - 1) / duration_years) * 100
            else:
                cagr_pct = (math.pow(final_equity / initial_capital, 1 / duration_years) - 1) * 100

        # 2. Ulcer Index & UPI
        squared_dd_sum = 0.0
        peak_eq_base = initial_capital
        abs_trade_curve = [initial_capital + v for v in core['tradeEquityCurve']]

        for eq in abs_trade_curve:
            if eq > peak_eq_base:
                peak_eq_base = eq
            dd_pct = ((eq / peak_eq_base) - 1) * 100 if peak_eq_base > 0 else 0.0
            squared_dd_sum += (dd_pct * dd_pct)

        ulcer_index = math.sqrt(squared_dd_sum / len(abs_trade_curve)) if abs_trade_curve else 0.0
        upi = (cagr_pct / ulcer_index) if ulcer_index > 0 else (999.0 if cagr_pct > 0 else 0.0)

        # 2b. Max Drawdown % (from equity curve)
        peak_eq_for_pct = initial_capital
        for eq in abs_trade_curve:
            if eq > peak_eq_for_pct:
                peak_eq_for_pct = eq
            dd_pct = ((peak_eq_for_pct - eq) / peak_eq_for_pct) * 100 if peak_eq_for_pct > 0 else 0.0
            if dd_pct > max_drawdown_pct:
                max_drawdown_pct = dd_pct

        # 3. Sharpe & Sortino (Daily Basis)
        daily_values = list(core['dailyPnL'].values())
        if len(daily_values) > 1:
            n_days = len(daily_values)
            mean_daily = sum(daily_values) / n_days
            variance_daily = sum(math.pow(val - mean_daily, 2) for val in daily_values) / (n_days - 1)
            std_dev_daily = math.sqrt(variance_daily)

            downside_variance = sum(math.pow(min(0, val), 2) for val in daily_values) / n_days
            downside_dev = math.sqrt(downside_variance)

            sqrt_252 = math.sqrt(252)
            if std_dev_daily > 0:
                sharpe_ratio = (mean_daily / std_dev_daily) * sqrt_252
            if downside_dev > 0:
                sortino_ratio = (mean_daily / downside_dev) * sqrt_252

        # 3b. Sharpe Ratio (Trade Basis) - annualized
        avg_trade = core['totalProfit'] / core['totalTrades'] if core['totalTrades'] > 0 else 0.0
        if core['totalTrades'] > 1:
            trade_returns = []
            # abs_trade_curve has length trades.length + 1
            for i in range(len(self.trades)):
                eq_before = abs_trade_curve[i]
                if eq_before > 0:
                    trade_returns.append(self.trades[i].pnl / eq_before)
            
            if len(trade_returns) > 1:
                mean_ret = sum(trade_returns) / len(trade_returns)
                std_ret = math.sqrt(sum(math.pow(v - mean_ret, 2) for v in trade_returns) / (len(trade_returns) - 1))
                trades_per_year = core['totalTrades'] / duration_years if duration_years > 0 else 0.0
                ann_factor = math.sqrt(trades_per_year)
                if std_ret > 0:
                    sharpe_ratio_trade = (mean_ret / std_ret) * ann_factor

        # 4. SQN (Trade Basis)
        if core['totalTrades'] > 0:
            variance_trade = sum(math.pow(t.pnl - avg_trade, 2) for t in self.trades) / core['totalTrades']
            std_dev_trade = math.sqrt(variance_trade)
            if std_dev_trade > 0:
                sqn = (avg_trade / std_dev_trade) * math.sqrt(min(core['totalTrades'], 100))

        # 5. Gamma Flow Score (GFS)
        gamma_flow_score = self._calculate_gamma_flow_score()

        self._cache['advancedMetrics'] = {
            'cagrPct': cagr_pct,
            'upi': upi,
            'sharpeRatio': sharpe_ratio,
            'sharpeRatioTrade': sharpe_ratio_trade,
            'sortinoRatio': sortino_ratio,
            'sqn': sqn,
            'gammaFlowScore': gamma_flow_score,
            'maxDrawdownPct': max_drawdown_pct
        }
        return self._cache['advancedMetrics']

    def _calculate_gamma_flow_score(self) -> float:
        if len(self.trades) < 2:
            return 0.0

        tp_trades = []
        sl_trades = []
        
        # We need a regex-like check, simple string contains works for most
        for t in self.trades:
            reason = (t.exit_reason or '').lower()
            is_trailing = 'trailing' in reason
            is_tp = 'tp' in reason or 'take' in reason or 'pt' in reason
            is_sl = ('sl' in reason or 'stop' in reason) and not is_trailing
            
            if is_tp:
                tp_trades.append(t)
            elif is_sl:
                sl_trades.append(t)

        def calc_beta(trades_list):
            if len(trades_list) < 2:
                return 0.0
            
            # Already sorted chronologically initially
            sorted_trades = sorted(trades_list, key=lambda x: x.exit_timestamp)
            inter_times = []
            for i in range(1, len(sorted_trades)):
                diff_days = (sorted_trades[i].exit_timestamp - sorted_trades[i-1].exit_timestamp) / (1000 * 60 * 60 * 24)
                inter_times.append(diff_days)
            
            if not inter_times:
                return 0.0
                
            mean = sum(inter_times) / len(inter_times)
            variance = sum(math.pow(v - mean, 2) for v in inter_times) / len(inter_times)
            if variance == 0 or mean == 0:
                return 0.0
            return mean / variance
            
        beta_tp = calc_beta(tp_trades)
        beta_sl = calc_beta(sl_trades)

        winners = [t for t in self.trades if t.pnl > 0]
        losers = [t for t in self.trades if t.pnl < 0]
        
        avg_win = sum(t.pnl for t in winners) / len(winners) if winners else 0.0
        avg_loss_abs = abs(sum(t.pnl for t in losers) / len(losers)) if losers else 1.0
        payoff = avg_win / avg_loss_abs if avg_loss_abs > 0 else 0.0

        effective_beta_sl = beta_sl if beta_sl > 0 else 0.001
        return (beta_tp / effective_beta_sl) * payoff

    # --- GETTERS ---

    @property
    def total_trades(self): return len(self.trades)

    @property
    def total_profit(self): return self._calculate_core_metrics()['totalProfit']

    @property
    def max_drawdown(self): return self._calculate_core_metrics()['maxDD']

    @property
    def max_drawdown_pct(self): return self._calculate_advanced_metrics()['maxDrawdownPct']

    @property
    def win_rate(self): return self._calculate_core_metrics()['winRate']

    @property
    def profit_factor(self): return self._calculate_core_metrics()['profitFactor']

    @property
    def return_dd(self): return self._calculate_core_metrics()['returnDDRatio']

    @property
    def max_consecutive_losses(self): return self._calculate_core_metrics()['maxConsecLosses']

    @property
    def max_stagnation_days(self): return self._calculate_core_metrics()['maxStagnationDays']

    @property
    def max_stagnation_trades(self): return self._calculate_core_metrics()['maxStagnationTrades']

    @property
    def avg_trade(self):
        c = self._calculate_core_metrics()
        return c['totalProfit'] / c['totalTrades'] if c['totalTrades'] > 0 else 0.0

    @property
    def upi(self): return self._calculate_advanced_metrics()['upi']

    @property
    def cagr(self): return self._calculate_advanced_metrics()['cagrPct']

    @property
    def sharpe_ratio(self): return self._calculate_advanced_metrics()['sharpeRatio']

    @property
    def sharpe_ratio_trade(self): return self._calculate_advanced_metrics()['sharpeRatioTrade']

    @property
    def sortino_ratio(self): return self._calculate_advanced_metrics()['sortinoRatio']

    @property
    def sqn(self): return self._calculate_advanced_metrics()['sqn']

    @property
    def gamma_flow_score(self): return self._calculate_advanced_metrics()['gammaFlowScore']

    # --- UTILITIES ---

    def filter_by_date_range(self, start_date=None, end_date=None):
        if not start_date and not end_date:
            return self

        start = pd.to_datetime(start_date).timestamp() * 1000 if start_date else 0
        end = pd.to_datetime(end_date).timestamp() * 1000 if end_date else 8640000000000000

        filtered = [t for t in self.trades if start <= t.exit_timestamp <= end]
        return TradeSeries(filtered)

    def get_equity_curve_format(self):
        data = []
        current_eq = 0.0
        for t in self.trades:
            current_eq += t.pnl
            if t.exit_time:
                # Same format as frontend, but date strings for JSON
                date_str = t.exit_time.strftime('%Y-%m-%d')
                data.append({'x': date_str, 'y': current_eq})
        return data

    def get_scatter_data_format(self):
        data = []
        for t in self.trades:
            if t.exit_time:
                # Same format as analysis_engine.py scatter data usually expected,
                # actually analysis_engine.py did benchmark vs portfolio here before, we return an empty array or simple format
                # But since backend scatter data used to rely on benchmark, let's keep it simple or empty for now
                data.append({'x': t.pnl, 'y': t.pnl})
        return data

    def get_lorenz_data_format(self):
        sorted_trades = sorted(self.trades, key=lambda t: t.pnl)
        data = [{'x': 0.0, 'y': 0.0}]
        cumulative_pnl = 0.0
        total_pnl = self.total_profit if self.total_profit > 0 else 1.0

        for i, t in enumerate(sorted_trades):
            if t.pnl > 0:  # Only for winning trades in original python script
                cumulative_pnl += t.pnl
                data.append({
                    'x': ((i + 1) / len(sorted_trades)) * 100,
                    'y': (cumulative_pnl / total_pnl) * 100
                })
        return data

    def to_metrics_dict(self):
        c = self._calculate_core_metrics()
        a = self._calculate_advanced_metrics()

        # Build chart data
        equity_chart_data = self.get_equity_curve_format()
        chart_labels = [row['x'] for row in equity_chart_data]
        
        # Normalization to 100 like the old python script did
        initial_capital = 10000.0
        for row in equity_chart_data:
            row['y'] = ((row['y'] + initial_capital) / initial_capital) * 100

        lorenz_data = self.get_lorenz_data_format()

        metrics_dict = {
            "profitFactor": c['profitFactor'],
            "sortinoRatio": a['sortinoRatio'],
            "maxDrawdown": a['maxDrawdownPct'], # JS expects % here or $? JS was using maxDrawdown (which is maxDD in $) but previously python used %
            "maxDrawdownInDollars": c['maxDD'],
            "maxMarginRequired": 0,
            "maxMarginLog": [],
            "monthlyAvgProfit": c['totalProfit'] / (len(c['dailyPnL']) / 30.4) if c['dailyPnL'] else 0,
            "ulcerIndexInDollars": 0, # not used in JS anymore
            "upi": a['upi'],
            "sharpeRatio": a['sharpeRatio'],
            "sharpeRatioDaily": a['sharpeRatio'],
            "sharpeRatioTrade": a['sharpeRatioTrade'],
            "sharpeRatioAnnual": a['sharpeRatio'],
            "sharpeRatioMonthly": a['sharpeRatio'],
            "captureRatio": None,
            "profitMaxDD_Ratio": c['returnDDRatio'],
            "monthlyProfitToDollarDD": 0,
            "winningPercentage": c['winRate'],
            "maxStagnationTrades": c['maxStagnationTrades'],
            "totalTrades": c['totalTrades'],
            "maxStagnationDays": c['maxStagnationDays'],
            "sqn": a['sqn'],
            "totalProfit": c['totalProfit'],
            "cagr": a['cagrPct'],
            "gammaFlowScore": a['gammaFlowScore'],
            "betaTP": 0,
            "betaSL": 0,
            "maxConsecutiveLosses": c['maxConsecLosses'],
            "maxConsecutiveWins": c['maxConsecWins'],
            "winningTrades": c['wins'],
            "losingTrades": c['losses'],
            "grossProfit": c['grossProfit'],
            "grossLoss": c['grossLoss'],
            "avgTrade": self.avg_trade,
            "lorenzData": lorenz_data,
            "chartData": {
                "labels": chart_labels,
                "equityCurve": equity_chart_data,
                "benchmarkCurve": [],
                "scatterData": []
            }
        }
        
        # Convert any Timestamp inside to ISO string
        for key, value in metrics_dict.items():
            if isinstance(value, pd.Timestamp):
                metrics_dict[key] = value.isoformat()
                
        return metrics_dict
    
    @classmethod
    def merge(cls, series_list):
        all_trades = []
        for s in series_list:
            if s and s.trades:
                all_trades.extend(s.trades)
        return cls(all_trades)
