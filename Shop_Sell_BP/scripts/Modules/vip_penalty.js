// ─────────────────────────────────────────────────────────────
//  VIP_PENALTY.JS  ·  Anti-Cheat Price Modifier
//
//  Constants are now driven by config.js / config_store.js.
//  Admins can edit penaltyProfiles and penaltyExemptCategories
//  in config.js (unobfuscated) or live via /ss:config_money.
//
//  EXPORTED SHAPE IS IDENTICAL TO THE ORIGINAL:
//    VipPenalty.applySell(player, cents)
//    VipPenalty.applyBuy(player, price, category)
//    VipPenalty.applyBuyCents(player, price, category)
//    VipPenalty.PENALTY_TAG        ← still "vip"
//    VipPenalty.EXEMPT_CATEGORY    ← still "FORVIP"
//  No dependant file needs any changes.
// ─────────────────────────────────────────────────────────────

import { Config } from "../economy/config_store.js";

// ── Hard-coded baseline exports (dependant files rely on these) ──
// These are NOT moved to config because they are part of the public
// API contract. Changing them would require updating every importer.
export const PENALTY_TAG     = "vip";
export const EXEMPT_CATEGORY = "FORVIP";

// Always-exempt categories (never configurable — guaranteed safe)
const ALWAYS_EXEMPT = [EXEMPT_CATEGORY, "FREE"];

// ── Tick Micro-Cache ──────────────────────────────────────────
// player.hasTag() is a C++ bridge call. Rendering a full shop page
// calls _getPenaltyProfile() once per item — up to 108 bridge
// crossings per tick for data that cannot change mid-render.
// Cache stores each player's resolved profile for the current tick
// only, cleared via a zero-delay Promise (microtask queue).

const _UNPENALISED = Symbol("unpenalised");

/** @type {Map<string, {sell:number,buy:number} | typeof _UNPENALISED>} */
const _profileCache = new Map();

function _scheduleCacheClear(playerId) {
    Promise.resolve().then(() => _profileCache.delete(playerId));
}

// ── Internal helpers ──────────────────────────────────────────

/**
 * Reads penaltyProfiles from config at call time.
 * Config.get() returns the in-memory cached value (O(1)) so this
 * is cheap even though it's called once per tick per player.
 * @returns {Array<[string, {sell:number, buy:number}]>}
 */
function _getProfiles() {
    return Config.get("penaltyProfiles");
}

/**
 * Builds the full exempt set: always-exempt + config extras.
 * Normalised to uppercase for case-insensitive matching.
 * Called once per applyBuy() — result is not separately cached
 * because Config.get() is already O(1) in-memory.
 * @returns {string[]}
 */
function _getExemptUppercase() {
    const extras = Config.get("penaltyExemptCategories") ?? [];
    return [...ALWAYS_EXEMPT, ...extras].map(c => c.toUpperCase());
}

/**
 * Returns the penalty profile for the player, or null if unpenalised.
 * Results are cached for the current tick.
 *
 * @param {import("@minecraft/server").Player} player
 * @returns {{sell: number, buy: number} | null}
 */
function _getPenaltyProfile(player) {
    try {
        const id     = player.id;
        const cached = _profileCache.get(id);

        if (cached !== undefined) {
            return cached === _UNPENALISED ? null : cached;
        }

        // Feature gate — if the whole system is off, treat everyone
        // as unpenalised without touching hasTag() at all.
        if (!Config.get("enableVipPenalty")) {
            _profileCache.set(id, _UNPENALISED);
            _scheduleCacheClear(id);
            return null;
        }

        let resolved = null;
        for (const [tag, profile] of _getProfiles()) {
            if (player.hasTag(tag)) {
                resolved = profile;
                break;
            }
        }

        _profileCache.set(id, resolved ?? _UNPENALISED);
        _scheduleCacheClear(id);
        return resolved;

    } catch {
        return null;
    }
}

// ── Public API ────────────────────────────────────────────────

/**
 * Applies the sell penalty to a raw cent amount.
 * @param {import("@minecraft/server").Player} player
 * @param {number} cents
 * @returns {number}
 */
function applySell(player, cents) {
    if (!Number.isFinite(cents)) return 0;
    const profile = _getPenaltyProfile(player);
    if (!profile) return cents;
    return Math.max(0, Math.floor(cents / profile.sell));
}

/**
 * Applies the buy penalty to a dollar price.
 * @param {import("@minecraft/server").Player} player
 * @param {number} price
 * @param {string} category
 * @returns {number}
 */
function applyBuy(player, price, category) {
    const profile = _getPenaltyProfile(player);
    if (!profile) return price;

    const normalised = (typeof category === "string") ? category.toUpperCase() : "";
    if (normalised && _getExemptUppercase().includes(normalised)) return price;

    return price * profile.buy;
}

/**
 * Converts dollar price to cents and applies buy penalty in one step.
 * @param {import("@minecraft/server").Player} player
 * @param {number} price
 * @param {string} category
 * @returns {number}
 */
function applyBuyCents(player, price, category) {
    return Math.round(applyBuy(player, price, category) * 100);
}

// ── Exported shape — IDENTICAL to original ────────────────────
export const VipPenalty = {
    applySell,
    applyBuy,
    applyBuyCents,
    PENALTY_TAG,
    EXEMPT_CATEGORY,
};