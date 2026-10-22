import { world, system } from "@minecraft/server";
import { Config } from "./config_store.js";

// ─────────────────────────────────────────────────────────────
//  MONEY_SYSTEM.JS  ·  SHARED-WALLET Economy + K/M/B Formatting
//
//  This exact file ships inside every addon of the family (Shop & Sell,
//  Orders, ...). Addons cannot read each other's variables or dynamic
//  properties, but they all see the world scoreboard, so the wallet lives
//  there. Install one addon or several: they all use the same balances.
//
//  Scoreboard objectives (all shared):
//    money_hi / money_lo  authoritative balance in CENTS, split in two
//                         32-bit scores:  cents = hi * 1e9 + lo
//                         (supports balances far beyond the 2.1B limit of
//                         a single score). Participant = player.id.
//    money_reg            player registry, participant "<id>:<name>".
//                         Gives name <-> id lookup for offline players
//                         and the leaderboard.
//    money                display mirror (capped at 2^31-1), online only.
//    money_lb             sidebar "Top Rich List".
//    money_cfg            shared economy settings (see shared_config.js).
//
//  NOTHING is cached in memory: every operation reads and writes the
//  scoreboard directly, so two addons can never overwrite each other.
// ─────────────────────────────────────────────────────────────

const OBJ_HI         = "money_hi";
const OBJ_LO         = "money_lo";
const OBJ_REG        = "money_reg";
const OBJECTIVE_ID   = "money";
const LEADERBOARD_ID = "money_lb";
const SPLIT          = 1_000_000_000;
const SCOREBOARD_CAP = 2_147_483_647;
const HARD_MAX       = 9_007_199_254_740_000;   // stay inside JS safe-integer range

const MEDALS = ["§6\u2460", "§6\u2461", "§6\u2462", "§7\u2463", "§7\u2464"];

// ── Objective helpers (refs cached only after a successful lookup) ──

const _objs = {};
function _o(id, title) {
    if (_objs[id]) return _objs[id];
    const o = world.scoreboard.getObjective(id) ?? world.scoreboard.addObjective(id, title);
    _objs[id] = o;
    return o;
}
const _hi  = () => _o(OBJ_HI,  "Money (hi)");
const _lo  = () => _o(OBJ_LO,  "Money (lo)");
const _reg = () => _o(OBJ_REG, "Money Players");

function _getLbTitle() {
    let title = Config.get("leaderboardTitle") ?? "§6§l--Top Rich List--";
    if (title === "§6Top Rich List" || 
        title === "§6§l─── Top Rich List ───" || 
        title === "§6§l────── Top Rich List ──────") {
        title = "§6§l--Top Rich List--";
        try { Config.set("leaderboardTitle", title); } catch {}
    }
    return title;
}


// ── Money formatter ───────────────────────────────────────────

function _formatCents(cents) {
    const dollars = cents / 100;
    const symbol  = Config.get("currencySymbol") ?? "$";
    const showDec = Config.get("showDecimals") ?? false;

    if (dollars >= 999_990_000_000) return `${symbol}1T+`;   // cap label, per spec
    if (dollars >= 1_000_000_000)   return `${symbol}${parseFloat((dollars / 1_000_000_000).toFixed(2))}B`;
    if (dollars >= 1_000_000)       return `${symbol}${parseFloat((dollars / 1_000_000).toFixed(2))}M`;
    if (dollars >= 1_000)           return `${symbol}${parseFloat((dollars / 1_000).toFixed(2))}K`;

    const parts = showDec ? dollars.toFixed(2).split(".") : [Math.floor(dollars).toString()];
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${symbol}${parts.join(".")}`;
}


// ── Wallet core ───────────────────────────────────────────────

// getScore() THROWS ("Failed to resolve identity") for a participant the
// scoreboard has never seen, instead of returning undefined. Treat that as "no score".
function _read(obj, id) {
    try { return obj.getScore(id); } catch { return undefined; }
}

function _idOf(player) { return typeof player === "string" ? player : player.id; }

function _getScore(player) {
    const id = _idOf(player);
    const hi = _read(_hi(), id) ?? 0;
    const lo = _read(_lo(), id) ?? 0;
    return hi * SPLIT + lo;
}

function _setScore(player, amount) {
    const id      = _idOf(player);
    const maxBal  = Math.min(Config.get("maxBalance") ?? HARD_MAX, HARD_MAX);
    const cents   = Math.max(0, Math.min(maxBal, Math.floor(Number.isFinite(amount) ? amount : 0)));
    const hi      = Math.floor(cents / SPLIT);
    _hi().setScore(id, hi);
    _lo().setScore(id, cents - hi * SPLIT);

    // Display mirror — online players only, purely cosmetic.
    if (typeof player !== "string") {
        try { _o(OBJECTIVE_ID, "Money").setScore(player, Math.min(cents, SCOREBOARD_CAP)); } catch {}
    }
}

// ── Player registry (shared phonebook) ────────────────────────

function _registryEntries() {
    const out = [];
    for (const idn of _reg().getParticipants()) {
        const n = idn.displayName;
        const i = n.indexOf(":");
        if (i < 1) continue;
        out.push({ id: n.slice(0, i), name: n.slice(i + 1), identity: idn });
    }
    return out;
}

function _registerPlayer(player, entries = _registryEntries()) {
    const reg = _reg();
    let found = false;
    for (const e of entries) {
        if (e.id !== player.id) continue;
        if (e.name === player.name) found = true;
        else { try { reg.removeParticipant(e.identity); } catch {} }
    }
    if (!found) reg.setScore(`${player.id}:${player.name}`, 1);
}

function _idByName(name) {
    const entries = _registryEntries();
    const exact = entries.find(e => e.name === name);
    if (exact) return exact.id;
    const lower = String(name).toLowerCase();
    return entries.find(e => e.name.toLowerCase() === lower)?.id ?? null;
}

// ── New-player welcome balance (granted once per WORLD, not per addon) ──

function _onFirstSpawn(player) {
    try {
        const isNew = _read(_hi(), player.id) === undefined;
        _registerPlayer(player);
        if (!isNew) {
            // Make sure the mirror exists for returning players.
            _setScore(player, _getScore(player));
            return;
        }
        const startup = Config.get("startupBalance") ?? 0;
        _setScore(player, Math.max(0, startup) * 100);
        if (startup > 0) {
            player.sendMessage(`§6[Economy] §aWelcome! You've received a starting balance of §e${_formatCents(startup * 100)}§a.`);
        }
    } catch (e) {
        console.warn("[Money] Failed to initialise player:", e);
    }
}

// ─────────────────────────────────────────────────────────────
//  Leaderboard engine  (idempotent — safe if several addons run it)
// ─────────────────────────────────────────────────────────────

function _getAllRanked() {
    const keepOffline = Config.get("keepOfflineNames");
    const online      = new Map(world.getPlayers().map(p => [p.id, p]));
    const entries     = _registryEntries();
    for (const p of online.values()) {
        if (!entries.some(e => e.id === p.id && e.name === p.name)) {
            _registerPlayer(p, entries);
            entries.push({ id: p.id, name: p.name });
        }
    }
    return entries
        .filter(e => keepOffline || online.has(e.id))
        .map(e => ({ name: e.name, score: _getScore(e.id) }))
        .sort((a, b) => b.score - a.score);
}

/** keepOfflineNames toggled — the ranking is rebuilt from the shared scoreboard. */
export function purgeOfflineFromCache()  { _rebuildLeaderboard(); }
export function restoreOfflineToCache()  { _rebuildLeaderboard(); }

function _rebuildLeaderboard() {
    try {
        const dim = world.getDimension("overworld");
        if (!Config.get("showLeaderboard")) {
            try { dim.runCommand(`scoreboard objectives setdisplay sidebar`); } catch {}
            return;
        }

        const topCount = Config.get("lbTopCount") ?? 5;
        const title    = _getLbTitle();

        // Recreate the objective only when its title changed; otherwise
        // update rows in place so several addons never make it flicker.
        let lb = world.scoreboard.getObjective(LEADERBOARD_ID);
        if (lb && lb.displayName !== title) {
            try { world.scoreboard.removeObjective(LEADERBOARD_ID); } catch {}
            lb = undefined;
        }
        lb = lb ?? world.scoreboard.addObjective(LEADERBOARD_ID, title);

        const desired = new Map();
        const top = _getAllRanked().slice(0, topCount);
        for (let i = 0; i < top.length; i++) {
            const e         = top[i];
            const medal     = MEDALS[i] ?? `§7#${i + 1}`;
            const shortName = e.name.length > 13 ? e.name.substring(0, 13) : e.name;
            desired.set(`${medal} §f${shortName} §a${_formatCents(e.score)}`, topCount - i);
        }

        for (const idn of lb.getParticipants()) {
            if (!desired.has(idn.displayName)) { try { lb.removeParticipant(idn); } catch {} }
        }
        for (const [label, order] of desired) lb.setScore(label, order);

        try { dim.runCommand(`scoreboard objectives setdisplay sidebar ${LEADERBOARD_ID} descending`); } catch {}
    } catch (e) {
        console.warn("[Money] Leaderboard update failed:", e);
    }
}

// ─────────────────────────────────────────────────────────────
//  Player events
// ─────────────────────────────────────────────────────────────

const _leavingPlayers = new Map(); // playerId → playerName

world.beforeEvents.playerLeave.subscribe(({ player }) => {
    if (!Config.get("keepOfflineNames")) _leavingPlayers.set(player.id, player.name);
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    // Drop the cosmetic "money" mirror row of the leaving player (the real
    // balance in money_hi / money_lo stays — it is shared and permanent).
    const name = _leavingPlayers.get(playerId);
    _leavingPlayers.delete(playerId);
    if (name) {
        try { world.getDimension("overworld").runCommand(`scoreboard players reset "${name}" ${OBJECTIVE_ID}`); } catch {}
    }
    system.runTimeout(() => { _rebuildLeaderboard(); }, 1);
});

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (!initialSpawn) return;
    _onFirstSpawn(player);
    system.runTimeout(() => { _rebuildLeaderboard(); }, 1);
});

// ─────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────

let _lbIntervalId = null;

export function restartLeaderboardInterval() {
    if (_lbIntervalId !== null) {
        system.clearRun(_lbIntervalId);
        _lbIntervalId = null;
    }
    const ticks = Math.max(20, Config.get("lbRefreshTicks") ?? 200);
    _lbIntervalId = system.runInterval(() => { _rebuildLeaderboard(); }, ticks);
}

system.run(() => {
    try {
        _hi(); _lo(); _reg(); _o(OBJECTIVE_ID, "Money");
        // Players already online when the addon is (re)loaded
        for (const p of world.getPlayers()) _onFirstSpawn(p);
    } catch (e) { console.warn("[Money] Bootstrap failed:", e); }
    restartLeaderboardInterval();
    system.runTimeout(() => { _rebuildLeaderboard(); }, 40);
});

// ─────────────────────────────────────────────────────────────
//  Offline player API  (balances are in cents)
// ─────────────────────────────────────────────────────────────

function getOffline(playerName) {
    try {
        const online = world.getPlayers().find(p => p.name === playerName);
        if (online) return _getScore(online);
        const id = _idByName(playerName);
        return id === null ? 0 : _getScore(id);
    } catch { return 0; }
}

/** @returns {boolean} false when the player has never joined this world. */
function setOffline(playerName, cents) {
    try {
        const online = world.getPlayers().find(p => p.name === playerName);
        if (online) { _setScore(online, cents); return true; }
        const id = _idByName(playerName);
        if (id === null) return false;
        _setScore(id, cents);
        return true;
    } catch { return false; }
}

function knowsPlayer(playerName) {
    try { return world.getPlayers().some(p => p.name === playerName) || _idByName(playerName) !== null; }
    catch { return false; }
}

// ── Public API ────────────────────────────────────────────────

function get(player)           { return _getScore(player); }
function getFormatted(player)  { return _formatCents(_getScore(player)); }
function add(player, cents)    { _setScore(player, _getScore(player) + Math.floor(cents)); }
function set(player, cents)    { _setScore(player, cents); }
function has(player, cents)    { return _getScore(player) >= Math.floor(cents); }
function format(cents)         { return _formatCents(cents); }
function refreshLeaderboard()  { _rebuildLeaderboard(); }

function remove(player, cents) {
    const cur = _getScore(player);
    if (cur < Math.floor(cents)) return false;
    _setScore(player, cur - Math.floor(cents));
    return true;
}

function transfer(from, to, cents) {
    if (!remove(from, cents)) return false;
    add(to, cents);
    return true;
}

export const Money = {
    get, getFormatted, add, remove, set, transfer,
    has, format, refreshLeaderboard, getOffline, setOffline, knowsPlayer,
};
