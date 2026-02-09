
import logging
import sys

# Configure logging to write to a file
logging.basicConfig(
    filename='debug_date_verification.log',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

def test_log():
    print("--- STANDARD PRINT TEST ---")
    logging.info("--- LOGGING MODULE TEST ---")
    sys.stdout.write("--- SYS.STDOUT TEST ---\n")
    sys.stderr.write("--- SYS.STDERR TEST ---\n")

if __name__ == "__main__":
    test_log()
