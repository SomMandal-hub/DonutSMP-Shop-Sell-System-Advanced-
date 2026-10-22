/**
 * StorageManager.js  —  Universal ItemStack / NBT storage proxy
 *
 * Every system that needs to persist ItemStacks (full NBT) goes
 * through here. No system imports QIDB directly.
 *
 * ── HOTEL MODEL ─────────────────────────────────────────────
 *  • Slot pool is infinite and grows automatically.
 *  • When a system stores an item it gets the next free slot.
 *  • When a system deletes an item that slot goes to free_slots.
 *  • free_slots are reused first before the counter grows.
 *  • Slots are shared across ALL systems — AH freed slot 4,
 *    Shop can reuse slot 4 next. The value stored at a slot
 *    carries the system prefix so ownership is never ambiguous.
 *
 * ── CONCURRENCY / BATCH ─────────────────────────────────────
 *  • nextSlot() is synchronous and in-memory — 10 000 callers
 *    at t=0 each get a unique slot number immediately.
 *  • Actual QIDB writes are queued and drained in order.
 *  • No two operations ever race for the same slot.
 *
 * ── REGISTERED SYSTEMS ──────────────────────────────────────
 *  Each system has:
 *    prefix      — prepended to every QIDB key (must be unique,
 *                  alphanumeric + underscore only)
 *    persistent  — false = AH style (deleted after use)
 *                  true  = Shop style (lives until explicitly removed)
 *
 * ── PUBLIC API ───────────────────────────────────────────────
 *  StorageManager.store(system, itemStack)  → slotKey (string)
 *  StorageManager.retrieve(system, slotKey) → ItemStack | null
 *  StorageManager.remove(system, slotKey)
 *  StorageManager.exists(system, slotKey)   → boolean
 *  StorageManager.listKeys(system)          → slotKey[]
 *
 * ── ADDING A NEW SYSTEM (future) ────────────────────────────
 *  1. Add one entry to SYSTEMS below with a unique prefix.
 *  2. Call StorageManager.store / retrieve / remove from your
 *     system's code.  That is ALL.  No QIDB imports, no entity
 *     setup, no slot management — StorageManager handles it.
 *
 * Example:
 *   MAIL: { prefix: "mail", persistent: true }
 *
 * Then in your mail system:
 *   const key = StorageManager.store("MAIL", itemStack)
 *   const item = StorageManager.retrieve("MAIL", key)
 *   StorageManager.remove("MAIL", key)
 */

import { world }  from "@minecraft/server"
import { QIDB }   from "./Modules/QIDB.js"

// ── System Registry ───────────────────────────────────────────
//
//  prefix     — unique short string, [A-Za-z0-9_] only,
//               becomes part of the QIDB key so keep it short.
//  persistent — true  = item stays until explicitly removed
//               false = caller is responsible for cleanup
//
const SYSTEMS = {
    SHOP:      { prefix: "shop", persistent: true  },
    // ── Add future systems here ───────────────────────────────
    // MAIL:   { prefix: "mail",   persistent: true  },
    // ORDERS: { prefix: "orders", persistent: true  },
    // STASH:  { prefix: "stash",  persistent: true  },
}

// ── Internal DynamicProperty keys ────────────────────────────
const DP_COUNTER    = "storage:counter"     // int  — ever-growing slot counter
const DP_FREE_SLOTS = "storage:free_slots"  // JSON string[] — recycled slots

// ── Single shared QIDB instance ──────────────────────────────
//   cacheSize 200 — keeps 200 most-recent items in RAM
//   saveRate  1   — safe default (1 key/tick drain)
const _db = new QIDB("ss", 200, 1)

// ── Slot pool — fully in-memory, persisted via DynamicProperty ─

function _getCounter() {
    return world.getDynamicProperty(DP_COUNTER) ?? 0
}

function _setCounter(n) {
    world.setDynamicProperty(DP_COUNTER, n)
}

function _getFreeSlots() {
    try {
        const raw = world.getDynamicProperty(DP_FREE_SLOTS)
        return raw ? JSON.parse(raw) : []
    } catch { return [] }
}

function _setFreeSlots(arr) {
    world.setDynamicProperty(DP_FREE_SLOTS, JSON.stringify(arr))
}

/**
 * Returns the next available slot number.
 * Synchronous and in-memory — safe under extreme concurrency.
 * Recycles freed slots before growing the counter.
 * @returns {number}
 */
function _nextSlot() {
    const free = _getFreeSlots()
    if (free.length > 0) {
        const slot = free.shift()
        _setFreeSlots(free)
        return slot
    }
    const n = _getCounter() + 1
    _setCounter(n)
    return n
}

/**
 * Marks a slot as free for future reuse.
 * @param {number} slot
 */
function _freeSlot(slot) {
    const free = _getFreeSlots()
    if (!free.includes(slot)) {
        free.push(slot)
        _setFreeSlots(free)
    }
}

// ── System validation ─────────────────────────────────────────

function _sys(systemName) {
    const sys = SYSTEMS[systemName]
    if (!sys) throw new Error(`[StorageManager] Unknown system: "${systemName}". Register it in SYSTEMS first.`)
    return sys
}

/**
 * Builds the full QIDB key from a system prefix and slot number.
 * Format: "<prefix>_<slot>"   e.g. "ah_42", "shop_7"
 * @param {string} prefix
 * @param {number} slot
 * @returns {string}
 */
function _buildKey(prefix, slot) {
    return `${prefix}_${slot}`
}

/**
 * Parses the slot number back out of a full QIDB key.
 * @param {string} prefix
 * @param {string} qidbKey
 * @returns {number}
 */
function _parseSlot(prefix, qidbKey) {
    return parseInt(qidbKey.replace(`${prefix}_`, ""), 10)
}

// ── Public API ────────────────────────────────────────────────

/**
 * Store an ItemStack and get back the slot key to save in your DB.
 *
 * @param {string}    systemName  — registered system name e.g. "AH", "SHOP"
 * @param {ItemStack} itemStack   — the item to persist (full NBT preserved)
 * @returns {string}  slotKey    — save this in your metadata / DB entry
 *
 * @example
 *   const key = StorageManager.store("AH", item)
 *   // key = "ah_42"  — save this string in your AuctionDB entry
 */
export function store(systemName, itemStack) {
    const sys  = _sys(systemName)
    const slot = _nextSlot()
    const key  = _buildKey(sys.prefix, slot)
    _db.set(key, itemStack)
    return key
}

/**
 * Retrieve an ItemStack by its slot key.
 *
 * @param {string} systemName
 * @param {string} slotKey    — the key returned by store()
 * @returns {ItemStack | null}
 *
 * @example
 *   const item = StorageManager.retrieve("AH", entry.slotKey)
 */
export function retrieve(systemName, slotKey) {
    const sys = _sys(systemName)
    // Guard: key must belong to this system
    if (!slotKey.startsWith(sys.prefix + "_")) {
        console.warn(`[StorageManager] retrieve: key "${slotKey}" does not belong to system "${systemName}"`)
        return null
    }
    try {
        return _db.get(slotKey) ?? null
    } catch {
        return null
    }
}

/**
 * Remove an ItemStack and recycle its slot.
 *
 * @param {string} systemName
 * @param {string} slotKey
 *
 * @example
 *   StorageManager.remove("AH", entry.slotKey)
 */
export function remove(systemName, slotKey) {
    const sys = _sys(systemName)
    if (!slotKey.startsWith(sys.prefix + "_")) {
        console.warn(`[StorageManager] remove: key "${slotKey}" does not belong to system "${systemName}"`)
        return
    }
    try {
        _db.delete(slotKey)
    } catch { /* already gone */ }
    const slot = _parseSlot(sys.prefix, slotKey)
    if (!isNaN(slot)) _freeSlot(slot)
}

/**
 * Check if a slot key exists in storage.
 *
 * @param {string} systemName
 * @param {string} slotKey
 * @returns {boolean}
 */
export function exists(systemName, slotKey) {
    const sys = _sys(systemName)
    if (!slotKey.startsWith(sys.prefix + "_")) return false
    try {
        return _db.has(slotKey)
    } catch {
        return false
    }
}

/**
 * List all slot keys that belong to a specific system.
 * Useful for auditing or bulk operations.
 *
 * @param {string} systemName
 * @returns {string[]}
 *
 * @example
 *   StorageManager.listKeys("SHOP")
 *   // ["shop_1", "shop_3", "shop_7", ...]
 */
export function listKeys(systemName) {
    const sys = _sys(systemName)
    return _db.keys().filter(k => k.startsWith(sys.prefix + "_"))
}

export const StorageManager = { store, retrieve, remove, exists, listKeys }

// ── Dev / debug helper ────────────────────────────────────────
//
//  Call this from console or a debug command to see pool state:
//    import { debugStoragePool } from "./StorageManager.js"
//    debugStoragePool()
//
export function debugStoragePool() {
    console.warn(`[StorageManager] counter=${_getCounter()} free_slots=${JSON.stringify(_getFreeSlots())}`)
    for (const [name, sys] of Object.entries(SYSTEMS)) {
        const keys = _db.keys().filter(k => k.startsWith(sys.prefix + "_"))
        console.warn(`  ${name} (${sys.prefix}): ${keys.length} active keys`)
    }
}
