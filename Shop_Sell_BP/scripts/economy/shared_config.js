// ─────────────────────────────────────────────────────────────
//  SHARED_CONFIG.JS  ·  Economy settings shared between addons
//
//  World dynamic properties are private to each addon, but the world
//  scoreboard is visible to every addon. Settings that must be identical
//  in every addon that uses the shared wallet (currency symbol, leaderboard
//  options, max balance ...) are therefore stored on the scoreboard objective
//  "money_cfg": one fake-player participant per setting, named
//        <key>=<JSON value>
//  Any addon that has this file reads and writes the same values.
//
//  Reads are cached for CACHE_TICKS, so a change made through one addon
//  reaches the others within ~5 seconds.
// ─────────────────────────────────────────────────────────────

import { world, system } from "@minecraft/server";

const OBJ_ID      = "money_cfg";
const CACHE_TICKS = 100;

export const SHARED_KEYS = new Set([
    "currencySymbol", "showDecimals", "leaderboardTitle", "maxBalance",
    "startupBalance", "keepOfflineNames", "showLeaderboard",
    "lbRefreshTicks", "lbTopCount", "enablePayCommand",
]);

let _cache     = null;
let _cacheTick = -Infinity;

function _obj() {
    return world.scoreboard.getObjective(OBJ_ID)
        ?? world.scoreboard.addObjective(OBJ_ID, "Economy Config");
}

function _readAll() {
    if (_cache && system.currentTick - _cacheTick < CACHE_TICKS) return _cache;
    const out = {};
    for (const idn of _obj().getParticipants()) {
        const name = idn.displayName;
        const i    = name.indexOf("=");
        if (i < 1) continue;
        try { out[name.slice(0, i)] = JSON.parse(name.slice(i + 1)); } catch {}
    }
    _cache     = out;
    _cacheTick = system.currentTick;
    return out;
}

/** Returns the shared value, or undefined if unset / world not ready yet. */
export function sharedGet(key) {
    try { return _readAll()[key]; } catch { return undefined; }
}

export function sharedSet(key, value) {
    try {
        const obj = _obj();
        for (const idn of obj.getParticipants()) {
            if (idn.displayName.startsWith(key + "=")) obj.removeParticipant(idn);
        }
        obj.setScore(`${key}=${JSON.stringify(value)}`, 1);
        if (_cache) _cache[key] = value;
        return true;
    } catch (e) {
        console.warn(`[SharedConfig] Could not save "${key}":`, e);
        return false;
    }
}

export function sharedReset(key) {
    try {
        const obj = _obj();
        for (const idn of obj.getParticipants()) {
            if (idn.displayName.startsWith(key + "=")) obj.removeParticipant(idn);
        }
        if (_cache) delete _cache[key];
    } catch {}
}
