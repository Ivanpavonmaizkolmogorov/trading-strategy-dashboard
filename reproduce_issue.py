import pandas as pd
import io
import json

# Mirroring tradesToCSV output from frontend
headers = "Ticket,Symbol,Type,Open Time,Open Price,Size,Close Time,Close Price,Profit,Balance,Duration,Commission,Swap,Comment,MagicNumber"
# Sample row INSIDE the range (2025.08.12 - 2026.01.25)
row1 = "1,EURUSD,Buy,2025.09.01 11:00:00,1.4320,0.1,2025.09.01 16:00:00,1.4350,261.95,10261.95,0,0,0,,12345"

csv_content = f"{headers}\n{row1}"

print(f"--- Generated CSV Content ---\n{csv_content}\n-----------------------------")

# Imitating app.py logic
try:
    df = pd.read_csv(io.StringIO(csv_content))
    print("\n[STEP 1] read_csv Columns:", list(df.columns))
    print("[STEP 1] Head:\n", df.head())
    
    col_map = {
        'Profit': 'pnl',
        'Close Time': 'exit_date',
        'Open Time': 'entry_date',
        'Size': 'size',
        'Symbol': 'symbol',
        'Type': 'type',
        'Comment': 'comment',
        'Open Price': 'open_price',
        'MagicNumber': 'magic_number'
    }
    
    rename_dict = {k: v for k, v in col_map.items() if k in df.columns}
    print("\n[STEP 2] Rename Dict:", rename_dict)
    
    df = df.rename(columns=rename_dict)
    print("[STEP 3] Renamed Columns:", list(df.columns))
    
    if 'exit_date' in df.columns:
        print("\n[STEP 4] 'exit_date' found. Parsing...")
        raw_val = df['exit_date'].iloc[0]
        print(f"Raw Value: '{raw_val}' Type: {type(raw_val)}")
        
        try:
             # CORRECCIÓN DE FECHAS: Priorizar el formato exacto del frontend (YYYY.MM.DD HH:MM:SS)
             df['exit_date'] = pd.to_datetime(df['exit_date'], format='%Y.%m.%d %H:%M:%S', errors='raise')
             print("[STEP 5] Parsed successfully with %Y.%m.%d %H:%M:%S")
        except Exception as e:
             print(f"[STEP 5] Failed primary parse: {e}")
             
             # Fallbacks...
    else:
        print("\n[ERROR] 'exit_date' NOT FOUND after rename!")

    print("\n[FINAL] Result DataFrame:")
    print(df)
    
    # Check filtering
    start_date = "2025-08-12"
    end_date = "2026-01-25"
    print(f"\n[FILTER] Applying filter {start_date} to {end_date}")
    
    mask = (df['exit_date'] >= pd.to_datetime(start_date)) & (df['exit_date'] <= pd.to_datetime(end_date))
    filtered_df = df[mask]
    print(f"[FILTER] Result count: {len(filtered_df)}")
    
except Exception as e:
    print(f"\n[FATAL] Script Crash: {e}")
