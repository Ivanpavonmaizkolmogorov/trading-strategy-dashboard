
import pandas as pd
from io import StringIO
import datetime

def test_date_parsing():
    # Simulate CSV data from frontend with YYYY.MM.DD
    csv_data = """Ticket,Symbol,Type,Open Time,Open Price,Size,Close Time,Close Price,Profit,Balance,Duration,Commission,Swap,Comment,MagicNumber
100,EURUSD,Buy,2023.10.05 10:00:00,1.0500,0.1,2023.10.05 14:30:00,1.0550,50.00,10050.00,0,0,0,,12345
101,EURUSD,Sell,2023.01.02 10:00:00,1.0500,0.1,2023.01.02 14:30:00,1.0450,50.00,10100.00,0,0,0,,12345
    """
    
    print("--- Simulating Frontend CSV Data (YYYY.MM.DD) ---")
    df = pd.read_csv(StringIO(csv_data))
    
    col_map = {
        'Profit': 'pnl',
        'Close Time': 'exit_date',
        'Open Time': 'entry_date'
    }
    
    rename_dict = {k: v for k, v in col_map.items() if k in df.columns}
    df = df.rename(columns=rename_dict)
    
    print("\nOriginal 'exit_date' values:")
    print(df['exit_date'].head())
    
    # 1. Simulate app.py filtering logic (THE SUSPECT)
    print("\n--- Applying app.py logic (dayfirst=True) ---")
    try:
        # This is exactly what app.py does
        df['exit_date_parsed'] = pd.to_datetime(df['exit_date'], dayfirst=True, errors='coerce')
        parsed_dates = df['exit_date_parsed']
    except:
        df['exit_date_parsed'] = pd.to_datetime(df['exit_date'], errors='coerce')
        parsed_dates = df['exit_date_parsed']
        
    print("Parsed 'exit_date' (app.py):")
    print(df[['exit_date', 'exit_date_parsed']])
    
    # Check for NaT
    if df['exit_date_parsed'].isna().any():
        print("\n⚠️ WARNING: Some dates failed to parse with app.py logic!")
    else:
        print("\n✅ All dates parsed successfully by app.py logic.")
        
    # Check correctness
    # 2023.10.05 -> Oct 5th.
    first_date = df['exit_date_parsed'].iloc[0]
    expected_first = pd.Timestamp("2023-10-05 14:30:00")
    if first_date != expected_first:
        print(f"❌ CRITICAL: Date Mismatch! Expected {expected_first}, Got {first_date}")
    else:
        print(f"✅ Date Match: {first_date}")
        
    # 2. Simulate analysis_engine.py logic receiving timestamps
    # Simulate df -> dict -> new df (which preserves Timestamps usually)
    records = df.to_dict('records')
    # Filter only relevant columns for engine simulation
    engine_df = pd.DataFrame(records)
    
    # Engine logic:
    # 2. Robust Date Parsing
    # for col in ['entry_date', 'exit_date']:
    #     try:
    #         trades_df[col] = pd.to_datetime(trades_df[col], format='%Y.%m.%d %H:%M:%S', errors='raise')
    
    print("\n--- Applying analysis_engine.py logic on timestamps ---")
    try:
        # Note: input is now likely Timestamp if app.py parsed it
        # BUT wait, analysis_engine.py does strict format='%Y.%m.%d %H:%M:%S'
        engine_df['date_engine'] = pd.to_datetime(engine_df['exit_date_parsed'], format='%Y.%m.%d %H:%M:%S', errors='raise')
        print("Engine parsed successfully.")
    except Exception as e:
        print(f"❌ Engine parsing failed: {e}")
        # Analysis engine has fallback:
        try:
             engine_df['date_engine'] = pd.to_datetime(engine_df['exit_date_parsed'], errors='raise')
             print("✅ Engine parsing fallback succeeded.")
        except Exception as e2:
             print(f"❌ Engine parsing fallback failed too: {e2}")

if __name__ == "__main__":
    test_date_parsing()
