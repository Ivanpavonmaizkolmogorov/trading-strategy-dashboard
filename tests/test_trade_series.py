import pytest
import pandas as pd
from datetime import datetime
from models.trade import Trade
from models.trade_series import TradeSeries

def test_trade_series_basic_metrics():
    # Construct a few trades
    trades_data = [
        {"ticket": 1, "pnl": 100, "exit_date": "2023-01-01 10:00:00"},
        {"ticket": 2, "pnl": 50,  "exit_date": "2023-01-02 10:00:00"},
        {"ticket": 3, "pnl": -20, "exit_date": "2023-01-03 10:00:00"},
        {"ticket": 4, "pnl": -30, "exit_date": "2023-01-04 10:00:00"},
        {"ticket": 5, "pnl": 200, "exit_date": "2023-01-05 10:00:00"},
    ]
    
    trades = [Trade(t) for t in trades_data]
    series = TradeSeries(trades)
    
    metrics = series.to_metrics_dict()
    
    assert metrics['totalTrades'] == 5
    assert metrics['winningTrades'] == 3
    assert metrics['losingTrades'] == 2
    assert metrics['totalProfit'] == 300
    assert metrics['grossProfit'] == 350
    assert metrics['grossLoss'] == -50
    assert metrics['profitFactor'] == 7.0
    assert metrics['winningPercentage'] == 60.0
    assert metrics['avgTrade'] == 60.0

def test_trade_series_drawdown():
    # Equity curve:
    # Day 1: +100 (Peak: 100)
    # Day 2: -50  (Eq: 50, DD: 50)
    # Day 3: -80  (Eq: -30, DD: 130)
    # Day 4: +200 (Eq: 170, Peak: 170)
    trades_data = [
        {"ticket": 1, "pnl": 100, "exit_date": "2023-01-01 10:00:00"},
        {"ticket": 2, "pnl": -50, "exit_date": "2023-01-02 10:00:00"},
        {"ticket": 3, "pnl": -80, "exit_date": "2023-01-03 10:00:00"},
        {"ticket": 4, "pnl": 200, "exit_date": "2023-01-04 10:00:00"},
    ]
    
    trades = [Trade(t) for t in trades_data]
    series = TradeSeries(trades)
    
    assert series.max_drawdown == 130
    assert series.max_consecutive_losses == 2

def test_trade_series_date_filter():
    trades_data = [
        {"ticket": 1, "pnl": 100, "exit_date": "2023-01-01 10:00:00"},
        {"ticket": 2, "pnl": 50,  "exit_date": "2023-01-10 10:00:00"},
        {"ticket": 3, "pnl": -20, "exit_date": "2023-01-20 10:00:00"},
    ]
    trades = [Trade(t) for t in trades_data]
    series = TradeSeries(trades)
    
    filtered_series = series.filter_by_date_range(datetime(2023, 1, 5), datetime(2023, 1, 15))
    metrics = filtered_series.to_metrics_dict()
    
    assert metrics['totalTrades'] == 1
    assert metrics['totalProfit'] == 50
