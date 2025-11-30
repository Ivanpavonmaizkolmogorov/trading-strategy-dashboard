/**
 * brokerConfig.js
 * Manages broker configurations including leverage and contract sizes.
 */

const STORAGE_KEY = 'tsd_broker_config';

const DEFAULT_CONFIG = {
    defaultLeverage: 30,
    symbols: {
        // Forex Majors
        'EURUSD': { leverage: 30, contractSize: 100000 },
        'GBPUSD': { leverage: 30, contractSize: 100000 },
        'USDJPY': { leverage: 30, contractSize: 100000 },
        'AUDUSD': { leverage: 30, contractSize: 100000 },
        'USDCAD': { leverage: 30, contractSize: 100000 },
        'USDCHF': { leverage: 30, contractSize: 100000 },
        'NZDUSD': { leverage: 30, contractSize: 100000 },

        // Metals
        'XAUUSD': { leverage: 20, contractSize: 100 }, // Gold (typically 100 oz)
        'Gold': { leverage: 20, contractSize: 100 },
        'XAGUSD': { leverage: 20, contractSize: 5000 }, // Silver

        // Indices (Examples, vary wildly by broker)
        'US30': { leverage: 20, contractSize: 1 },
        'DE30': { leverage: 20, contractSize: 1 },
        'DAX40': { leverage: 20, contractSize: 1 },
        'SPX500': { leverage: 20, contractSize: 1 },

        // Crypto
        'BTCUSD': { leverage: 2, contractSize: 1 },
        'ETHUSD': { leverage: 2, contractSize: 1 }
    }
};

let currentConfig = { ...DEFAULT_CONFIG };

/**
 * Loads configuration from localStorage.
 */
export const loadBrokerConfig = () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            // Merge with defaults to ensure new keys exist
            currentConfig = {
                ...DEFAULT_CONFIG,
                ...parsed,
                symbols: { ...DEFAULT_CONFIG.symbols, ...(parsed.symbols || {}) }
            };
        } catch (e) {
            console.error('Failed to parse broker config:', e);
            currentConfig = { ...DEFAULT_CONFIG };
        }
    } else {
        currentConfig = { ...DEFAULT_CONFIG };
    }
    return currentConfig;
};

/**
 * Saves configuration to localStorage.
 * @param {Object} config - The new configuration object.
 */
export const saveBrokerConfig = (config) => {
    currentConfig = config;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentConfig));
};

/**
 * Gets the configuration for a specific symbol.
 * Falls back to default leverage if symbol not found.
 * Default contract size is 100000 (Forex standard) if not found.
 * @param {string} symbol 
 */
export const getSymbolConfig = (symbol) => {
    // Normalize symbol (remove suffix/prefix if needed, but for now exact match or simple normalization)
    // Simple normalization: Uppercase
    const cleanSymbol = symbol ? symbol.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';

    // Try exact match first, then normalized
    let config = currentConfig.symbols[symbol] || currentConfig.symbols[cleanSymbol];

    if (!config) {
        // Heuristic for Forex pairs (6 chars) -> Contract Size 100,000
        // This is a rough guess, user should configure specific indices/metals
        const isForex = cleanSymbol.length === 6;

        return {
            leverage: currentConfig.defaultLeverage,
            contractSize: isForex ? 100000 : 1 // Default to 1 if unknown non-forex
        };
    }

    return config;
};

/**
 * Calculates the required margin for a trade.
 * @param {string} symbol 
 * @param {number} lots 
 * @param {number} openPrice 
 */
export const calculateMargin = (symbol, lots, openPrice) => {
    const config = getSymbolConfig(symbol);
    // Margin = (Lots * ContractSize * Price) / Leverage
    // Note: This assumes the account currency matches the base currency or conversion is handled.
    // For simplicity in this version, we assume the result is in the Account Currency (approx).
    // To be perfectly accurate, we'd need exchange rates (e.g. EURUSD trade on USD account -> Margin is in EUR, need EURUSD rate).
    // BUT: "Price" in the formula usually converts it to Quote Currency.
    // Standard Formula: Notional Value / Leverage.
    // Notional Value = Lots * Contract Size.
    // Value in Account Currency depends on pair.
    // Let's stick to the user's formula: "Valor de la posicion / apalancamiento".
    // Position Value = Lots * ContractSize * Price (This gives value in Quote Currency).
    // If Account is USD and pair is EURUSD, Price is 1.10. Value = 1 * 100,000 * 1.10 = $110,000. Margin = 110,000 / 30. Correct.
    // If Account is USD and pair is USDJPY, Price is 150. Value = 1 * 100,000 * 150 = 15,000,000 JPY.
    // We need to convert JPY back to USD.
    // This adds complexity. For now, we will assume the "Price" passed in is the conversion rate to Account Currency?
    // NO, the trade has an 'openPrice' which is the chart price.

    // Simplification for MVP: 
    // We will calculate the Notional Value in the QUOTE currency (Price * Lots * ContractSize).
    // Then we divide by Leverage.
    // The result is in Quote Currency.
    // To sum them up, we ideally need them in Account Currency.
    // If the user's account is USD, and we have USDJPY margin in JPY, we need to divide by USDJPY price.
    // If we have EURUSD margin in USD, it's already in USD.

    // Let's try to be smart:
    // If symbol ends with 'USD' (e.g. EURUSD, XAUUSD), the Quote is USD. Result is in USD.
    // If symbol starts with 'USD' (e.g. USDJPY), the Quote is JPY. Result is in JPY. To get USD, divide by Price.
    // If neither (e.g. EURGBP), Quote is GBP. Need GBPUSD rate.

    // Given the complexity and lack of live rates, we might need a simplification or ask the user.
    // However, the user said: "sabiendo tanto el precio, overlaping y apalancamiento, sabremos el margen usado".
    // He implies we have enough info.

    const notionalValue = lots * config.contractSize * openPrice;
    let margin = notionalValue / config.leverage;

    // Currency Conversion Attempt (assuming USD Account)
    const s = cleanSymbol(symbol);
    if (s.startsWith('USD')) {
        // e.g. USDJPY. Margin is in JPY. Convert to USD: Margin / Price
        margin = margin / openPrice;
        // Wait: (Lots * 100k * Price) / Lev / Price = (Lots * 100k) / Lev.
        // Yes, for USD base pairs, margin is calculated on the Base amount (USD).
        // So Margin = (Lots * ContractSize) / Leverage.
        margin = (lots * config.contractSize) / config.leverage;
    }
    // If it ends in USD (EURUSD), margin is in USD. Correct.
    // Cross pairs (EURGBP) -> Margin in GBP. We don't have GBPUSD rate easily unless we look at other trades?
    // For now, we'll assume 1:1 for cross pairs or leave as is, noting the limitation.

    return margin;
};

const cleanSymbol = (s) => s ? s.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';

// Initialize on load
loadBrokerConfig();
