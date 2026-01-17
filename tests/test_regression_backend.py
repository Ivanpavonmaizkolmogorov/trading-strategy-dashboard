import unittest
import os
import re

class TestRegressions(unittest.TestCase):
    
    def test_scraper_multilingual_support(self):
        """
        Verify that scraper.py includes Spanish keywords in column mapping.
        Prevent regression of the '0 profit' bug caused by English-only matching.
        """
        scraper_path = os.path.join(os.getcwd(), 'myfx_playground', 'scraper.py')
        with open(scraper_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # Check for Profit keywords
        self.assertIn("'Beneficio neto'", content, "scraper.py missing Spanish 'Beneficio neto' keyword for Profit")
        self.assertIn("'Ganancia'", content, "scraper.py missing Spanish 'Ganancia' keyword for Profit")
        
        # Check for Close Date keywords
        self.assertIn("'Fecha de cierre'", content, "scraper.py missing Spanish 'Fecha de cierre' keyword for Close Date")

    def test_ui_deposit_filter(self):
        """
        Verify that myfxbookUI.js filters 'Depósito' and 'Retiro'.
        Prevent regression of 'Total Profit' including deposits.
        """
        ui_path = os.path.join(os.getcwd(), 'src', 'modules', 'myfxbookUI.js')
        with open(ui_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # Regex to find the filter condition
        # Looking for: trade.action === 'Depósito'
        deposito_check = re.search(r"trade\.action\s*===\s*['\"]Depósito['\"]", content)
        retiro_check = re.search(r"trade\.action\s*===\s*['\"]Retiro['\"]", content)
        
        self.assertTrue(deposito_check, "myfxbookUI.js missing filter for 'Depósito'")
        self.assertTrue(retiro_check, "myfxbookUI.js missing filter for 'Retiro'")

    def test_magic_mapper_crash_fix(self):
        """
        Verify that magicMapper.js has the null check fix.
        Prevent regression of 'Cannot read properties of undefined' crash.
        """
        mapper_path = os.path.join(os.getcwd(), 'src', 'modules', 'magicMapper.js')
        with open(mapper_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # Look for the fix: (s || '').toLowerCase()
        fix_pattern = r"\(s\s*\|\|\s*['\"]\s*['\"]\)\.toLowerCase"
        self.assertTrue(re.search(fix_pattern, content), "magicMapper.js missing null check fix in normalize function")

if __name__ == '__main__':
    unittest.main()
