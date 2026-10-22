/**
 * config_store.js  —  Internal config runtime
 *
 * Imports plain defaults from config.js (unobfuscated, owner-editable).
 * Handles in-memory cache, DB persistence, get/set/toggle/reset.
 *
 * All internal files import Config from HERE, not from config.js:
 *   import { Config } from "./config_store.js";
 *
 * Priority (highest → lowest):
 *   1. In-game changes made via /ss:config_money  (stored in DB)
 *   2. Values set in config.js by the server owner (file defaults)
 */

import { DB }              from "../Modules/database.js";
import { CONFIG_DEFAULTS } from "../Preset/config.js";
import { SHARED_KEYS, sharedGet, sharedSet, sharedReset } from "./shared_config.js";

const CONFIG_DB_KEY = "server_config";

// ── Dynamic Key Registry ──────────────────────────────────────
// Easily whitelist new dynamic configurations here.
// define whether you expect a "number", "string", or "object", and
// the database will automatically authorize and type-check the incoming data.
// Use 'exact' for single keys, or 'prefix' for dynamic generated keys.
const DYNAMIC_SCHEMA = [
    { prefix: "sell_price:", expectedType: "number" },
    { exact: "shop_data",    expectedType: "object" },
    
    // Future examples:
    // { exact: "auction_house_data", expectedType: "object" },
    // { prefix: "land_claim:",       expectedType: "object" }
];

function getDynamicSchema(key) {
    for (const schema of DYNAMIC_SCHEMA) {
        if (schema.exact && key === schema.exact) return schema;
        if (schema.prefix && key.startsWith(schema.prefix)) return schema;
    }
    return null; // Not a registered dynamic key
}


let _cache = null;
let _dirty = false;

function _load() {
    if (_cache) return _cache;
    const stored = DB.getGlobal(CONFIG_DB_KEY, {});
    // In-game overrides win over file defaults
    _cache = { ...CONFIG_DEFAULTS, ...stored };
    return _cache;
}

function _flush() {
    if (!_dirty) return;
    DB.setGlobal(CONFIG_DB_KEY, _cache);
    _dirty = false;
}

function get(key) {
    // Economy settings live on the world scoreboard so every addon sees the same values.
    if (SHARED_KEYS.has(key)) return sharedGet(key) ?? CONFIG_DEFAULTS[key];
    return _load()[key] ?? CONFIG_DEFAULTS[key];
}

function set(key, value) {
    const dynamicSchema = getDynamicSchema(key);
    const isDynamic = !!dynamicSchema;

    // Reject if it's not a dynamic key AND not in the hardcoded defaults
    if (!isDynamic && !(key in CONFIG_DEFAULTS)) {
        console.warn(`[Config] Unknown key: ${key}`);
        return false;
    }

    if (isDynamic) {
        // Auto-validate based on the schema registry
        const expType = dynamicSchema.expectedType;
        if (expType === "object" && (typeof value !== "object" || value === null)) {
            console.warn(`[Config] Type mismatch for "${key}": expected object`);
            return false;
        } else if (expType !== "object" && typeof value !== expType) {
            console.warn(`[Config] Type mismatch for "${key}": expected ${expType}`);
            return false;
        }
    } else {
        // Standard config defaults validation
        const def = CONFIG_DEFAULTS[key];
        if (Array.isArray(def)) {
            if (!Array.isArray(value)) {
                console.warn(`[Config] Type mismatch for "${key}": expected Array`);
                return false;
            }
        } else if (typeof value !== typeof def) {
            console.warn(`[Config] Type mismatch for "${key}": expected ${typeof def}`);
            return false;
        }
    }

    if (SHARED_KEYS.has(key)) return sharedSet(key, value);

    _load()[key] = value;
    _dirty = true;
    _flush();
    return true;
}
function toggle(key) {
    const cur = get(key);
    if (typeof cur !== "boolean") return cur;
    set(key, !cur);
    return !cur;
}

function reset(key) {
    if (SHARED_KEYS.has(key)) { sharedReset(key); return; }
    const isDynamic = !!getDynamicSchema(key);
    
    // Ignore invalid keys
    if (!isDynamic && !(key in CONFIG_DEFAULTS)) return;

    if (isDynamic) {
        // Wipe dynamic overrides entirely
        delete _load()[key];
    } else {
        // Restore standard static configs to file defaults
        _load()[key] = CONFIG_DEFAULTS[key];
    }
    
    _dirty = true;
    _flush();
}

function resetAll() {
    // Wipe in-game overrides from DB entirely.
    // Next _load() will fall back to file defaults for everything.
    for (const k of SHARED_KEYS) sharedReset(k);
    DB.deleteGlobal(CONFIG_DB_KEY);
    _cache = { ...CONFIG_DEFAULTS };
    _dirty = false;
}

function getAll() {
    const all = { ..._load() };
    for (const k of SHARED_KEYS) all[k] = get(k);
    return all;
}

export const Config = { get, set, toggle, reset, resetAll, getAll };