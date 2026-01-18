
import pandas as pd
import sys
import os

# Add local directory to path
sys.path.append('/home/ivan/Desktop/Symbols/Porfolios/trading-strategy-dashboard')

from analysis_engine import process_strategy_data

def test_max_dd():
    # Mock Data: Standard scenario
    # Equity: 100000 -> 100100 -> 100050 -> 100250 -> 99950 -> 100450
    # DD$: 
    # 1. Peak 100100 -> 100050 = 50
    # 2. Peak 100250 -> 99950 = 300 (MaxDD)
    
    data = [
        {'entry_date': '2023-01-01', 'exit_date': '2023-01-02', 'pnl': 100.0},
        {'entry_date': '2023-01-03', 'exit_date': '2023-01-04', 'pnl': -50.0},
        {'entry_date': '2023-01-05', 'exit_date': '2023-01-06', 'pnl': 200.0},
        {'entry_date': '2023-01-07', 'exit_date': '2023-01-08', 'pnl': -300.0},
        {'entry_date': '2023-01-09', 'exit_date': '2023-01-10', 'pnl': 500.0},
    ]
    
    df = pd.DataFrame(data)
    df['entry_date'] = pd.to_datetime(df['entry_date'])
    df['exit_date'] = pd.to_datetime(df['exit_date'])
    
    # Mock Benchmark
    bench_data = [] # Empty benchmark
    bench_df = pd.DataFrame(bench_data)
    
    print("\n--- Running Analysis ---")
    results, _ = process_strategy_data(df, bench_df)
    
    if results:
        print(f"Max DD ($): {results.get('maxDrawdownInDollars')}")
        print(f"Total Profit: {results.get('totalProfit')}")
        print(f"Initial Capital should be 100000 (default)")
    else:
        print("Analysis returned None")

if __name__ == "__main__":
    test_max_dd()
