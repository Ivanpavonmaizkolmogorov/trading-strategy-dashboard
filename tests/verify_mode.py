

# Validating Mode Logic (Pure Python)


def calculate_mode(curve):
    """
    Calculates the mode of non-zero integer values in a curve.
    Replicates the JS logic: 
     - Filter out <= 0
     - Round to integer
     - Find most frequent
    """
    # Filter out <= 0
    valid_values = [round(x) for x in curve if x > 0]
    
    if not valid_values:
        return 0
        
    # Python's statistics.mode raises error if multiple modes, scipy.stats.mode returns smallest
    # The JS logic: counts[key] > maxCount => mode = key. 
    # This implies if there's a tie, the FIRST one encountered wins? 
    # No, iteration order in object keys is not guaranteed in older JS, 
    # but in modern JS simple integer keys are sorted? 
    # Wait, the JS loop iterates the ARRAY, updating the count. 
    # So if there is a tie, the ONE ENCOUNTERED FIRST that sets the NEW maxCount wins?
    # No, "if (counts[key] > maxCount)". 
    # If counts[key] == maxCount, it does NOT update using the new key.
    # So the FIRST key to reach that count wins (until surpassed).
    # Since we iterate values, the order matters.
    
    counts = {}
    max_count = 0
    mode = 0
    
    for val in valid_values:
        key = val
        counts[key] = counts.get(key, 0) + 1
        
        if counts[key] > max_count:
            max_count = counts[key]
            mode = key
            
    return mode, counts

def verify_data():
    # 1. Simulate a scenario with a clear Mode
    # "Stagnation Trades": many 1s, some 2s, few 10s.
    print("--- Test Case 1: Clear Mode ---")
    simulated_stagnation_trades = [
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1,  # 10 ones
        2, 2, 2, 2, 2,                 # 5 twos
        5, 8, 12, 1, 1                 # clutter
    ]
    mode, counts = calculate_mode(simulated_stagnation_trades)
    print(f"Data: {simulated_stagnation_trades}")
    print(f"Calculated Mode: {mode}")
    print(f"Counts: {counts}")
    assert mode == 1, f"Expected Mode 1, got {mode}"
    print("PASS")
    
    # 2. Simulate User Scenario (Drawdown)
    # User sees [100] often. This implies many drawdowns are rounding to 100.
    # Or maybe it's floating point? JS rounds 100.2 -> 100, 99.8 -> 100.
    print("\n--- Test Case 2: Rounding Mode ---")
    drawdowns = [
        99.6, 100.1, 100.4, 99.9, # 4 values rounding to 100
        50.5, 50.1,               # 2 values rounding to 51/50
        20.0, 20.0, 20.0          # 3 values of 20
    ]
    mode, counts = calculate_mode(drawdowns)
    print(f"Data: {drawdowns}")
    print(f"Rounded Data: {[round(x) for x in drawdowns]}")
    print(f"Calculated Mode: {mode}")
    print(f"Counts: {counts}")
    assert mode == 100, f"Expected Mode 100, got {mode}"
    print("PASS")

    # 3. Simulate The suspicious [1] for trades
    # If MaxStagTrades is 29, but Mode is 1. This is actually VERY common for profitable strategies.
    # It means most of the time it recovers in 1 trade.
    print("\n--- Test Case 3: Recovery Mode ---")
    # Strategy wins 80% time. 
    # Seq: W, W, W, L, W, W, L, L, W
    # Stag Trades (Trades since peak):
    # W (New Peak) -> 0
    # W (New Peak) -> 0
    # W (New Peak) -> 0
    # L -> 1 trade in stagnation
    # W (Recovery?) -> If new peak, 0. If not, 2.
    # Let's say: Peak=100. L(-10)=>90. Stag=1. W(+5)=>95. Stag=2. W(+10)=>105. Peak!
    # Curve: 0, 0, 0, 1, 2, 0...
    # Non-zero curve: 1, 2.
    # If we have many single losses recovered immediately:
    # L, W(Peak), L, W(Peak), L, W(Peak).
    # Curve Non-Zero: 1, 1, 1.
    # Mode = 1.
    # This explains why [1] is common for stagnation trades.
    
    stagnation_curve_sim = [1, 1, 1, 1, 1, 2, 3, 1, 1, 10, 15, 1, 1]
    mode, counts = calculate_mode(stagnation_curve_sim)
    print(f"Calculated Mode: {mode}")
    assert mode == 1, "Expected Mode 1"
    print("PASS: Mode [1] is mathematically natural for good strategies (quick recovery).")

if __name__ == "__main__":
    verify_data()
