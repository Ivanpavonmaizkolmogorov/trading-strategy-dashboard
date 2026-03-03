import asyncio
import os
import traceback
from datetime import datetime, timezone
from metaapi_cloud_sdk import MetaApi

token = "eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI0ZDAyZWIxNjkxN2EzY2UwYzYxNDZlMGYzNmQ3MmQwMSIsImFjY2Vzc1J1bGVzIjpbeyJpZCI6InRyYWRpbmctYWNjb3VudC1tYW5hZ2VtZW50LWFwaSIsIm1ldGhvZHMiOlsidHJhZGluZy1hY2NvdW50LW1hbmFnZW1lbnQtYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVzdC1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcnBjLWFwaSIsIm1ldGhvZHMiOlsibWV0YWFwaS1hcGk6d3M6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVhbC10aW1lLXN0cmVhbWluZy1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOndzOnB1YmxpYzoqOioiXSwicm9sZXMiOlsicmVhZGVyIiwid3JpdGVyIl0sInJlc291cmNlcyI6WyIqOiRVU0VSX0lEJDoqIl19XSwiaWdub3JlUmF0ZUxpbWl0cyI6ZmFsc2UsInRva2VuSWQiOiIyMDIxMDIxMyIsImltcGVyc29uYXRlZCI6ZmFsc2UsInJlYWxVc2VySWQiOiI0ZDAyZWIxNjkxN2EzY2UwYzYxNDZlMGYzNmQ3MmQwMSIsImlhdCI6MTc3MjQ2NDEwNH0.dUk5B_PmjVS4HARlwXnnsrymYVJAxygG-iTG8hucQY55Q76jIPeKkqJRfACbMKLOplBp2eyQqv060HIpuZmlyaeK-YxE232MaOigU-DZ2yOwGCnduIOPMVfABiT-rXFJSKqiFykONUZLsyxuYY_v0-djeHfamAWDzE_heu_q-gbzIfruCq69QVcBwiJNDV4HAG7nmiK4y_LkdaV0qDM-QL3hy9MLxs92FJcQbgxye7t-VfSeH4XQZdyvNKQyDm2o6HBvHJF-QXroSq4QuOL2xXP1GnPlCE8f23jbG5gCAh2ghlU-TXbjcpCNvofqqg5hiTYBClRwYTUvZN05t-z4rIH3IbaKpcr9Iry583CKondshsYY8PopNXtlTbe7-NfJ5BYhdo4xchRWEYzfv6EsKkM11nefI-Q5_rvFFgfNS54usqqp4QVZK5Ief5z1bbKRWWfILS3mL7o3_8-uLluf8azEZb8kyHHpUhbAeXA_9b-IhIQDaJBgstrYACRwqhnXZgt9w2V1cEpD5tUeP9wm5JwrPeHUXbEQiLq_eAnoz-6Z-VCOQo2jgSi-2rxfZBDRa_DqnStBdQmvaF7AESupVjwy7qUJ3QpOeNaym5VCzhFKfJs-SheCTnLF4g1In_yEzG7V5y2a87VaGpayuP3VTRzZValInqhDfugFC32K0y0"
account_id = "bbb3ea8d-4161-4663-a307-f75f838276a1"

async def test_metaapi():
    api = MetaApi(token=token)
    account = await api.metatrader_account_api.get_account(account_id)
    if account.state != 'DEPLOYED': return
    
    connection = account.get_rpc_connection()
    await connection.connect()
    await connection.wait_synchronized()
    
    now = datetime.now(timezone.utc)
    time_from = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    # 1. Traer ORDERS
    orders = await connection.get_history_orders_by_time_range(time_from, now)
    
    # 2. Traer DEALS (Las operaciones reales cerradas y calculadas en MT5)
    deals = await connection.get_deals_by_time_range(time_from, now)
    
    orders_list = list(orders.values()) if isinstance(orders, dict) else orders
    import json
    with open('debug_output.json', 'w') as f:
        json.dump({
            "orders": orders if isinstance(orders, dict) else [getattr(o, '__dict__', str(o)) for o in orders],
            "deals": deals if isinstance(deals, dict) else [getattr(d, '__dict__', str(d)) for d in deals]
        }, f, indent=2, default=str)
    
    await connection.close()

if __name__ == "__main__":
    if os.name == 'nt':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(test_metaapi())
