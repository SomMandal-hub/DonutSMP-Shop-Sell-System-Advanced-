import { world } from "@minecraft/server";

// ─────────────────────────────────────────────────────────────
//  DATABASE.JS  [OPTIMIZED]  ·  World Dynamic Property Store
//
//  A lightweight key-value database backed by world dynamic
//  properties. Values are serialised to JSON so you can store
//  strings, numbers, booleans, arrays, and plain objects.
//
//  Two namespaces:
//    • "db:global:<key>"  – world-wide data (leaderboards, shop
//                           stock, server settings, etc.)
//    • "db:player:<id>:<key>" – per-player data (stats, history,
//                               preferences, etc.)
//
//  Usage (import anywhere):
//    import { DB } from "./database.js";
//
//    DB.setGlobal("shopVersion", 2);
//    DB.getGlobal("shopVersion");           // → 2
//
//    DB.setPlayer(player, "totalSold", 500);
//    DB.getPlayer(player, "totalSold");     // → 500
//
//  ── v2 Optimization: In-Memory Key Index ─────────────────────
//
//  BEFORE:
//    getAllPlayer() and wipePlayer() called:
//      world.getDynamicPropertyIds()  — scans EVERY property
//      on the entire world, then filtered by prefix.
//    Cost: O(N) where N = total world properties (grows over time).
//    Called once per sell, once per wipe, potentially many times.
//
//  AFTER:
//    _playerIndex: Map<playerId, Set<shortKey>>
//      Tracks which keys each player has WITHOUT scanning the world.
//    On first access for a player, we do ONE scan of world properties
//    to build their index entry (cold start, paid once).
//    Every subsequent getAllPlayer / wipePlayer is O(k) where
//    k = number of keys that player has — never O(N) again.
//
//    Mutations (setPlayer / deletePlayer) keep the index in sync.
//    The index lives in memory only; no extra disk storage.
// ─────────────────────────────────────────────────────────────

const PREFIX_GLOBAL = "db:global:";
const PREFIX_PLAYER = "db:player:";

// ─────────────────────────────────────────────────────────────
//  In-memory player key index
//  Map<playerId, Set<shortKey>>
//  Populated lazily (first access per player).
//  Stays warm for the session — no repeated world scans.
// ─────────────────────────────────────────────────────────────

const _playerIndex = new Map();

/**
 * Returns (and lazily builds) the Set<shortKey> for a player.
 * The first call for a given player scans world properties ONCE
 * to seed the index. Every call after that is instant.
 */
function _getPlayerIndex(id) {
    if (_playerIndex.has(id)) return _playerIndex.get(id);

    // Cold start: scan world properties once for this player only
    const prefix = PREFIX_PLAYER + id + ":";
    const keys   = new Set();
    try {
        world.getDynamicPropertyIds().forEach((propId) => {
            if (propId.startsWith(prefix)) {
                keys.add(propId.slice(prefix.length));
            }
        });
    } catch {}

    _playerIndex.set(id, keys);
    return keys;
}

// ── Internal helpers ──────────────────────────────────────────

function _serialize(value) {
    return JSON.stringify(value);
}

function _deserialize(raw) {
    if (raw === undefined || raw === null) return undefined;
    try { return JSON.parse(raw); } catch { return raw; }
}

// ── Global (world-wide) helpers ───────────────────────────────
// Globals are infrequent and small — no index needed.

function setGlobal(key, value) {
    world.setDynamicProperty(PREFIX_GLOBAL + key, _serialize(value));
}

function getGlobal(key, fallback = undefined) {
    const raw = world.getDynamicProperty(PREFIX_GLOBAL + key);
    const val = _deserialize(raw);
    return val !== undefined ? val : fallback;
}

function deleteGlobal(key) {
    world.setDynamicProperty(PREFIX_GLOBAL + key, undefined);
}

function hasGlobal(key) {
    return world.getDynamicProperty(PREFIX_GLOBAL + key) !== undefined;
}

// ── Per-player helpers ────────────────────────────────────────

function _playerKey(player, key) {
    const id = typeof player === "string" ? player : player.id;
    return PREFIX_PLAYER + id + ":" + key;
}

function _playerId(player) {
    return typeof player === "string" ? player : player.id;
}

function setPlayer(player, key, value) {
    const id  = _playerId(player);
    world.setDynamicProperty(_playerKey(player, key), _serialize(value));
    // Keep index in sync — O(1)
    _getPlayerIndex(id).add(key);
}

function getPlayer(player, key, fallback = undefined) {
    const raw = world.getDynamicProperty(_playerKey(player, key));
    const val = _deserialize(raw);
    return val !== undefined ? val : fallback;
}

function deletePlayer(player, key) {
    const id = _playerId(player);
    world.setDynamicProperty(_playerKey(player, key), undefined);
    // Keep index in sync — O(1)
    _getPlayerIndex(id).delete(key);
}

function hasPlayer(player, key) {
    return world.getDynamicProperty(_playerKey(player, key)) !== undefined;
}

/**
 * Returns all key-value pairs stored for this player.
 *
 * BEFORE: O(N) — scanned every world dynamic property.
 * AFTER:  O(k) — iterates only this player's indexed keys.
 */
function getAllPlayer(player) {
    const id     = _playerId(player);
    const prefix = PREFIX_PLAYER + id + ":";
    const result = {};
    for (const shortKey of _getPlayerIndex(id)) {
        result[shortKey] = _deserialize(world.getDynamicProperty(prefix + shortKey));
    }
    return result;
}

/**
 * Wipes every property stored for this player.
 * Call on permanent ban, reset, etc.
 *
 * BEFORE: O(N) — scanned every world dynamic property.
 * AFTER:  O(k) — iterates only this player's indexed keys.
 */
function wipePlayer(player) {
    const id     = _playerId(player);
    const prefix = PREFIX_PLAYER + id + ":";
    const index  = _getPlayerIndex(id);
    for (const shortKey of index) {
        world.setDynamicProperty(prefix + shortKey, undefined);
    }
    index.clear();  // index is now empty — player has no keys
}

/**
 * Call this when a player leaves to free their index entry from memory.
 * Optional — the index is harmless if left in RAM, but calling this
 * keeps memory lean on servers with high player turnover.
 * The index will be rebuilt lazily if the player rejoins.
 *
 * Example (in your playerLeave handler):
 *   world.afterEvents.playerLeave.subscribe(({ playerId }) => {
 *       DB.evictPlayer(playerId);
 *   });
 */
function evictPlayer(playerOrId) {
    _playerIndex.delete(_playerId(playerOrId));
}

// ── Exported API ──────────────────────────────────────────────

export const DB = {
    // Global
    setGlobal,
    getGlobal,
    deleteGlobal,
    hasGlobal,

    // Per-player
    setPlayer,
    getPlayer,
    deletePlayer,
    hasPlayer,
    getAllPlayer,
    wipePlayer,
    evictPlayer,   // NEW — call on playerLeave to free memory
};
