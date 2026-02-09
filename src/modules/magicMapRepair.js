
import { state } from '../state.js';

export function sanitizeMagicMap() {
    console.log('[MagicMapRepair] 🧹 Starting Sanitization of Magic Mappings...');

    if (!state.magicNumberMap) return;

    const strategies = state.loadedStrategyFiles || [];
    const strategyNames = new Set(strategies.map(s => {
        if (!s.name) return null;
        // Strip common extensions to match "Magic Number" format
        return s.name.replace(/\.(csv|sqx|json)$/i, '').trim();
    }).filter(Boolean));
    const strategyIds = new Set(strategies.map(s => s.strategyId || s.name).filter(Boolean));

    // Also include lowercased versions for robust checking
    const strategyNamesLower = new Set(Array.from(strategyNames).map(n => n.toLowerCase()));

    let totalRemoved = 0;

    Object.keys(state.magicNumberMap).forEach(key => {
        const magics = state.magicNumberMap[key];
        if (!Array.isArray(magics)) return;

        const originalLength = magics.length;

        // Filter out magics that are actually OTHER strategy names/IDs
        const cleanMagics = magics.filter(magic => {
            const magicStr = String(magic).trim();
            const magicLower = magicStr.toLowerCase();

            // Allow if magic matches the Key itself (self-reference is harmless/expected)
            if (magicStr === key || magicLower === key.toLowerCase()) return true;

            // Check if this "magic number" (stripped of extension) is actually another strategy's Name
            // e.g. Magic = "StrategyB.csv", Set has "StrategyB". 
            // We must strip from Magic to match.
            const magicBase = magicLower.replace(/\.(csv|sqx|json)$/i, '').trim();
            const keyBase = key.toLowerCase().replace(/\.(csv|sqx|json)$/i, '').trim();

            // CRITICAL: specific check for stripped key matching stripped magic
            // If the magic matches the key (ignoring extension), it IS the correct mapping. Keep it.
            if (magicBase === keyBase) return true;

            if (strategyNamesLower.has(magicBase)) {
                // It is a strategy name. Is it *this* strategy's name?
                // We don't know exactly which strategy 'key' refers to (could be ID or Name),
                // but if we assume 'key' is the specific strategy we want...

                // Heuristic: If 'key' is also a strategy Name, and key != magic, then magic is ANOTHER strategy.
                // If 'magic' is a Strategy Name, it's very likely NOT a valid magic number unless the user named their magic number matching another strategy (unlikely).

                // console.warn(`[MagicMapRepair] ⚠️ Suspicious Magic found in '${key}': '${magicStr}' (Matches a Strategy Name)`);
                return false;
            }

            // Check if magic matches a known Strategy ID (STRAT_...)
            if (magicStr.startsWith('STRAT_') && strategyIds.has(magicStr)) {
                // console.warn(`[MagicMapRepair] ⚠️ Suspicious Magic found in '${key}': '${magicStr}' (Matches a Strategy ID)`);
                return false;
            }

            return true;
        });

        if (cleanMagics.length < originalLength) {
            const removedCount = originalLength - cleanMagics.length;
            console.log(`[MagicMapRepair] ✂️ Cleaned '${key}': Removed ${removedCount} items (Cross-Contamination).`);
            totalRemoved += removedCount;
            // Update the map
            state.magicNumberMap[key] = cleanMagics;
        }
    });

    if (totalRemoved > 0) {
        console.log(`[MagicMapRepair] ✅ Sanitization Complete. Removed ${totalRemoved} invalid mappings.`);
    } else {
        console.log('[MagicMapRepair] ✅ Map is clean.');
    }
}
