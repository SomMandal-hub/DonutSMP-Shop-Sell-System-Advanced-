import { system, world, ItemStack, CommandPermissionLevel } from "@minecraft/server";
import { Money } from "../economy/money_system.js";
import { SellPreset } from "../Preset/sell_prices.js";
import { getEnchantBonus } from "../Preset/enchant_preset.js";
import { VipPenalty } from "./vip_penalty.js";
import { Config } from "../economy/config_store.js";

// ─────────────────────────────────────────────────────────────
//  SELL_SYSTEM.JS  [OPTIMIZED v2]
//
//  Flow:
//  1. Player runs /ss:sell → a temp chest entity spawns on them.
//  2. Player opens the entity chest and places items inside.
//  3. Slot 53 holds a barrier named "§cSELL?" that acts as the
//     close / sell button.
//  4. Slot 52 holds a written_book "⚠ Warning" tooltip —
//     protected so it cannot be taken out.
//  5. Player taps the barrier → it moves to their inventory.
//  6. Every tick: we detect the missing/moved barrier, scan the
//     entity inventory, calculate the total sell value using
//     SellPreset, pay the player via Money, and clean up.
//
//  ── Optimizations ────────────────────────────────────────────
//
//  1. TICK THROTTLE  (biggest win)
//     Full inventory scan / barrier check runs every SCAN_INTERVAL
//     ticks (5). Entity teleport still runs every tick (smooth
//     follow) but gated behind a position-change check.
//
//  2. POSITION-DELTA TELEPORT GUARD  [NEW]
//     Before: entity.teleport() called every tick unconditionally.
//     After:  last position cached; teleport only called when the
//             player has actually moved. Eliminates 20 redundant
//             C++ bridge crossings per second per idle seller.
//
//  3. ACTIVE-ONLY MANAGER TICK  [NEW]
//     Before: tick() iterated ALL online players every tick and
//             called this.get(player), which silently created a
//             new InfiniteChest for every player — leaking objects.
//     After:  only players in activeChests (those with a live
//             chest session) are iterated. Zero-cost for everyone
//             else.
//
//  4. SWEEP SET CLEANUP ON SESSION END  [NEW]
//     Before: activeSweepPlayers only cleared on playerLeave, so
//             players who opened and closed the menu were scanned
//             forever for the rest of their session.
//     After:  cleanup() removes the player from activeSweepPlayers.
//             Players re-enter the set only when they open /ss:sell
//             again.
//
//  5. ACTION BAR FIRES ONCE PER SCAN CYCLE  [NEW]
//     Before: setActionBar fired on every non-scan tick (line 327)
//             AND again on every scan tick that didn't close (line
//             384) — effectively 20×/sec. Two separate call sites.
//     After:  a single call site at the bottom of the non-closing
//             scan branch. Fires exactly once per SCAN_INTERVAL
//             ticks (4×/sec).
//
//  6. HARDCODED PLAYER INVENTORY SIZE  [NEW]
//     Before: container.size ?? 36 — property lookup hits the
//             Bedrock engine every sweep.
//     After:  literal 36. Player inventory is always 36 slots;
//             no runtime lookup needed.
//
//  7. DIMENSION-AWARE CHEST SWEEP  [NEW]
//     Before: sweepPlayerTempChests() always searched all 3
//             dimensions, even when called from spawnEntity().
//     After:  searches the player's current dimension first, then
//             falls back to all dims only when needed (stale entity
//             recovery path).
//
//  8. CACHED UI ITEMSTACKS  (warning book + barrier)
//     new ItemStack() + setLore() built once at module load.
//     Reused forever on every placement.
//
//  9. DIRECT INVENTORY API instead of runCommand("clear")
//     Direct slot loop with container.setItem(i, undefined)
//     — no command parser overhead.
//
//  Dependencies:
//    • money_system.js   – scoreboard economy ($)
//    • sell_prices.js    – SellPreset base item price list
//    • enchant_preset.js – EnchantPreset enchantment bonus prices
//    • vip_penalty.js    – VipPenalty sell/buy price modifier
// ─────────────────────────────────────────────────────────────

const SIGNAL_ITEM = "minecraft:barrier";
const SIGNAL_NAME = "§cSELL?";
const ENTITY_SIGNAL_SLOT = 53;

const WARNING_ITEM = "minecraft:written_book";
const WARNING_NAME = "§e⚠ Warning";
const WARNING_SLOT = 52;

const ENTITY_TYPE = "chest:temp_chest";
const AUTO_CLOSE_TICKS = 800; // 40 seconds

// ── Tick throttle ─────────────────────────────────────────────
// Full inventory scan / barrier check runs every SCAN_INTERVAL ticks.
// Entity teleport (smooth follow) runs every tick, gated by position delta.
const SCAN_INTERVAL = 5;  // saves ~80% of scan overhead vs every-tick

// ── Player inventory size constant ────────────────────────────
// Player inventory is always 36 slots. Using a literal avoids a
// Bedrock engine property lookup on every anti-cheat sweep call.
const PLAYER_INV_SIZE = 36;

// ─────────────────────────────────────────────────────────────
//  Cached UI ItemStacks — built ONCE after world load
//  Reused on every placement instead of re-creating every tick.
// ─────────────────────────────────────────────────────────────

let CACHED_SIGNAL;
let CACHED_WARNING_BOOK;

system.run(() => {
    // Initialize Signal
    CACHED_SIGNAL = new ItemStack(SIGNAL_ITEM, 1);
    CACHED_SIGNAL.nameTag = SIGNAL_NAME;
    const lore = CACHED_SIGNAL.getLore();
    lore.push("§eTap / Double-Click to sell all items above!");
    CACHED_SIGNAL.setLore(lore);

    // Initialize Warning Book
    CACHED_WARNING_BOOK = new ItemStack(WARNING_ITEM, 1);
    CACHED_WARNING_BOOK.nameTag = WARNING_NAME;
    const warnLore = CACHED_WARNING_BOOK.getLore();
    warnLore.push("§cDo NOT place Shulker Boxes");
    warnLore.push("§cthat contain items inside!");
    warnLore.push("§7Only the Shulker Box itself");
    warnLore.push("§7will be priced, not its contents.");
    CACHED_WARNING_BOOK.setLore(warnLore);
});

// Build a fast lookup map from the SellPreset array:  typeId → cents
const PRICE_MAP = new Map();
for (const entry of SellPreset) {
    PRICE_MAP.set(entry.item, Math.round(entry.price * 100));
}

// Enchanted books have no base material value — their worth comes entirely
// from their enchantments. Register them with a $0 base so they pass the
// PRICE_MAP check and reach getEnchantBonus() instead of being skipped.
if (!PRICE_MAP.has("minecraft:enchanted_book")) {
    PRICE_MAP.set("minecraft:enchanted_book", 0);
}

// Live price lookup. In-game edits (/ss:config sell) are stored in Config as
// "sell_price:<typeId>" and must win over the preset file. PRICE_MAP above is
// only a startup snapshot of the preset, so it is consulted as the fallback.
function _getBaseCents(typeId) {
    const override = Config.get("sell_price:" + typeId);
    if (typeof override === "number" && Number.isFinite(override) && override >= 0) {
        return Math.round(override * 100);
    }
    return PRICE_MAP.get(typeId);
}

// Tracks players currently in an active sell session (chest is open).
// FIX #4: cleanup() now removes from this set, so idle players are not
// scanned after closing the menu.
const activeSweepPlayers = new Set();

// ─────────────────────────────────────────────────────────────
//  Sell calculation
// ─────────────────────────────────────────────────────────────

/**
 * Scans a container (0–51), tallies sell value, clears sold items.
 * Slots 52 and 53 are reserved for UI items and are never sold.
 * Enchantment bonuses are added on top of the base price via EnchantPreset.
 * Returns { totalCents, breakdown[] }
 */
function calculateAndClearSell(container, { clear = true } = {}) {
    let totalCents = 0;
    const breakdown = [];
    const slots = [];

    for (let i = 0; i < WARNING_SLOT; i++) {
        const item = container.getItem(i);
        if (!item) continue;

        const baseCents = _getBaseCents(item.typeId);
        if (baseCents === undefined) continue;

        const { bonusCents: enchantCents, breakdown: enchants } = getEnchantBonus(item);
        const perUnitCents = baseCents + enchantCents;
        const lineCents = perUnitCents * item.amount;

        totalCents += lineCents;
        breakdown.push({
            typeId: item.typeId,
            amount: item.amount,
            baseCents,
            enchantCents,
            lineCents,
            enchants,
        });

        slots.push(i);
        if (clear) container.setItem(i, undefined);
    }

    return { totalCents, breakdown, slots };
}

/** Clears the given slots (call only AFTER the player has been paid). */
function _clearSlots(container, slots) {
    for (const i of slots) { try { container.setItem(i, undefined); } catch { } }
}

/**
 * Payment failed: hand every item in the sell chest back to the player so
 * nothing is ever lost. Whatever does not fit is dropped at their feet.
 */
function _returnItems(player, container) {
    const inv = player.getComponent("minecraft:inventory")?.container;
    for (let i = 0; i < WARNING_SLOT; i++) {
        const item = container.getItem(i);
        if (!item) continue;
        try {
            const left = inv?.addItem(item);
            if (left) player.dimension.spawnItem(left, player.location);
            else if (!inv) player.dimension.spawnItem(item, player.location);
            container.setItem(i, undefined);
        } catch { }
    }
}

/**
 * Sends a clean sell receipt to the player.
 * penaltyRatio: 1.0 for normal players, 0.25 for VIP-penalized players.
 */
function sendReceipt(player, breakdown, totalCents, penaltyRatio) {
    if (breakdown.length === 0) {
        player.sendMessage("§e[Sell] §7No sellable items found in the chest.");
        return;
    }

    player.sendMessage("§6§l──── Sell Receipt ────");
    for (const line of breakdown) {
        const name = line.typeId.replace("minecraft:", "").replace(/_/g, " ");

        const scaledBase = Math.floor(line.baseCents * penaltyRatio);
        const scaledEnchant = Math.floor(line.enchantCents * penaltyRatio);
        const scaledLine = Math.floor(line.lineCents * penaltyRatio);
        const scaledPerUnit = scaledBase + scaledEnchant;

        player.sendMessage(
            `§7  ${line.amount}x §f${name} §8@ §a${Money.format(scaledPerUnit)} §8= §a${Money.format(scaledLine)}`
        );
        player.sendMessage(`§8     └ Base: §7${Money.format(scaledBase)}`);

        if (line.enchants.length > 0) {
            for (const ench of line.enchants) {
                const enchName = ench.enchantId.replace(/_/g, " ");
                const lvlStr = ["I", "II", "III", "IV", "V"][ench.level - 1] ?? `${ench.level}`;
                const scaledBonus = Math.floor(ench.bonusCents * penaltyRatio);
                player.sendMessage(
                    `§8     └ §b${enchName} ${lvlStr}: §a+${Money.format(scaledBonus)}`
                );
            }
        }
    }

    player.sendMessage(`§6§l Total: §a§l${Money.format(totalCents)}`);
    player.sendMessage(`§6§l───────────────────`);
    player.sendMessage(`§a[Sell] New balance: §f${Money.getFormatted(player)}`);
}

// ─────────────────────────────────────────────────────────────
//  Direct inventory sweep — replaces runCommand("clear ...")
//  Loops slots directly instead of going through the command
//  parser. Faster and avoids async command scheduling.
// ─────────────────────────────────────────────────────────────

/**
 * Removes all items matching typeId + optional nameTag from a container.
 * @param {object}  container  - Bedrock inventory container
 * @param {string}  typeId     - Item type to remove
 * @param {string}  nameTag    - Optional nameTag filter
 * @param {number}  slotCount  - Number of slots to scan (pass literal — avoids engine lookup)
 * Returns true if at least one item was removed.
 *
 * FIX #6: slotCount is now a required parameter (callers pass the literal).
 * Eliminates the container.size engine property lookup on every call.
 */
function _sweepContainerFor(container, typeId, nameTag, slotCount) {
    if (!container) return false;
    let found = false;
    for (let i = 0; i < slotCount; i++) {
        const item = container.getItem(i);
        if (item?.typeId === typeId && (!nameTag || item.nameTag === nameTag)) {
            container.setItem(i, undefined);
            found = true;
        }
    }
    return found;
}

// ─────────────────────────────────────────────────────────────
//  InfiniteChest (per-player sell chest session)
// ─────────────────────────────────────────────────────────────

class InfiniteChest {
    constructor(player) {
        this.player = player;
        this.tempEntity = undefined;
        this.isOpen = false;
        // Internal tick counter for scan throttle
        this._scanTick = 0;
        // FIX #2: cache last known position to skip redundant teleports
        this._lastX = null;
        this._lastY = null;
        this._lastZ = null;
        this.recoverEntity();
    }

    get tempInv() {
        return this.tempEntity?.getComponent("minecraft:inventory")?.container;
    }

    recoverEntity() {
        let entityId;
        this.player.getDynamicPropertyIds().forEach((el) => {
            if (el.startsWith("temp_chest:")) entityId = el.replace("temp_chest:", "");
        });
        if (entityId) {
            try { this.tempEntity = world.getEntity(entityId); } catch { }
        }
    }

    toggleUI() {
        if (this.tempEntity && this.tempEntity.isValid) {
            this.cleanup(true);
            this.player.sendMessage("§a[Sell] Closed.");
        } else {
            this.spawnEntity();
            this.player.sendMessage("§a[Sell] Place items then tap §cSELL? §ato sell. Auto-closes in 40s.");
        }
    }

    spawnEntity() {
        try { chestManager.sweepPlayerTempChests(this.player, this.tempEntity?.id); } catch { }

        const loc = this.player.location;
        const entity = this.player.dimension.spawnEntity(ENTITY_TYPE, {
            x: loc.x, y: loc.y, z: loc.z
        });

        entity.addTag("player:" + this.player.id);

        const tameable = entity.getComponent("minecraft:tameable");
        if (tameable) tameable.tame(this.player);

        const key = "temp_chest:" + entity.id;
        this.player.setDynamicProperty(key, key);
        entity.nameTag = "§c§h§e§s§t§l§cSell | Place Items!";
        this.tempEntity = entity;
        this.isOpen = true;

        // Seed position cache so first tick doesn't unconditionally teleport
        this._lastX = loc.x;
        this._lastY = loc.y;
        this._lastZ = loc.z;

        this.prepareInventory();
    }

    prepareInventory() {
        if (!this.tempEntity?.isValid) return;
        const inv = this.tempInv;
        if (!inv) return;

        for (let i = 0; i < ENTITY_SIGNAL_SLOT; i++) {
            try { inv.setItem(i, undefined); } catch { }
        }

        // Use cached ItemStacks — no allocation on hot path
        try { inv.setItem(ENTITY_SIGNAL_SLOT, CACHED_SIGNAL); } catch (e) {
            this.player.sendMessage("§c[Sell] Signal plant failed: " + e);
        }
        try { inv.setItem(WARNING_SLOT, CACHED_WARNING_BOOK); } catch (e) {
            this.player.sendMessage("§c[Sell] Warning plant failed: " + e);
        }

        if (!this.tempEntity.hasTag("prepared")) this.tempEntity.addTag("prepared");
    }

    // ── Called every tick ────────────────────────────────────

    tick() {
        if (!this.tempEntity || !this.tempEntity.isValid) {
            if (this.tempEntity) this.cleanup(true);
            return;
        }

        // FIX #2: Only teleport when the player has actually moved.
        // Comparing three numbers is near-zero cost vs crossing the C++ bridge.
        const loc = this.player.location;
        if (loc.x !== this._lastX || loc.y !== this._lastY || loc.z !== this._lastZ) {
            this.tempEntity.teleport(
                { x: loc.x, y: loc.y, z: loc.z },
                { dimension: this.player.dimension }
            );
            this._lastX = loc.x;
            this._lastY = loc.y;
            this._lastZ = loc.z;
        }

        // If the chest session is not open, nothing else to do.
        if (!this.isOpen) return;

        // ── Throttled scan — runs every SCAN_INTERVAL ticks ──
        this._scanTick++;
        if (this._scanTick < SCAN_INTERVAL) return;
        this._scanTick = 0;

        // ── Full scan ─────────────────────────────────────────
        try {
            const playerInv = this.player.getComponent("minecraft:inventory")?.container;
            const entityInv = this.tempInv;
            let triggerClose = false;

            // 1. Check if barrier is missing from slot 53
            if (entityInv) {
                const slotItem = entityInv.getItem(ENTITY_SIGNAL_SLOT);
                if (!slotItem || slotItem.typeId !== SIGNAL_ITEM || slotItem.nameTag !== SIGNAL_NAME) {
                    triggerClose = true;
                }
            }

            // 2. Remove barrier from player inventory (direct API — no runCommand)
            //    FIX #6: pass PLAYER_INV_SIZE literal — no engine property lookup
            //    SERVER FIX: always sweep, even if triggerClose is already true,
            //    because the item may arrive after the entity slot check.
            if (playerInv) {
                if (_sweepContainerFor(playerInv, SIGNAL_ITEM, SIGNAL_NAME, PLAYER_INV_SIZE)) {
                    triggerClose = true;
                }
            }

            // 3. Restore warning book if taken out of slot 52 (use cached ItemStack)
            if (entityInv) {
                const warnSlotItem = entityInv.getItem(WARNING_SLOT);
                if (!warnSlotItem || warnSlotItem.typeId !== WARNING_ITEM || warnSlotItem.nameTag !== WARNING_NAME) {
                    try { entityInv.setItem(WARNING_SLOT, CACHED_WARNING_BOOK); } catch { }
                }
            }

            // 4. Remove warning book from player inventory (direct API)
            //    FIX #6: pass PLAYER_INV_SIZE literal
            if (playerInv) {
                _sweepContainerFor(playerInv, WARNING_ITEM, WARNING_NAME, PLAYER_INV_SIZE);
            }

            // 5. Sell logic on close
            if (triggerClose && entityInv) {
                // Calculate WITHOUT clearing; items are only removed once payment succeeded.
                const { totalCents, breakdown, slots } = calculateAndClearSell(entityInv, { clear: false });

                if (totalCents > 0) {
                    try {
                        const finalCents = VipPenalty.applySell(this.player, totalCents);
                        const penaltyRatio = finalCents / totalCents;
                        Money.add(this.player, finalCents);
                        _clearSlots(entityInv, slots);
                        sendReceipt(this.player, breakdown, finalCents, penaltyRatio);
                    } catch (e) {
                        console.error("[Sell] Payment failed:", e);
                        _returnItems(this.player, entityInv);
                        this.player.sendMessage("§c[Sell] Payment failed — your items were returned. Tell an admin.");
                    }
                } else {
                    this.player.sendMessage("§e[Sell] §7No sellable items — nothing paid.");
                }

                // Anything that was not sold (unsellable items) goes back to the player.
                try { _returnItems(this.player, entityInv); } catch { }

                this.cleanup(true);
                return;
            }
        } catch (e) { console.warn("[Sell] scan error:", e); }

        // FIX #5: Single action bar call site — fires once per scan cycle (every
        // SCAN_INTERVAL ticks) instead of on every non-scan tick + every scan tick.
        // Before: fired 16×/sec (4 out of 5 ticks via early-return path, plus the
        //         post-scan path). Now fires 4×/sec. Players cannot notice the diff.
        this.player.onScreenDisplay.setActionBar("§eRight Click to open — place items, then tap §cSELL?");
    }

    cleanup(force) {
        this.isOpen = false;
        this._scanTick = 0;
        this._lastX = null;
        this._lastY = null;
        this._lastZ = null;

        // ── Cursor Dump Delay (multi-wave, server-safe) ──
        // On dedicated servers the UI close + cursor dump is async and can
        // arrive much later than on LAN/local worlds. We sweep at 3, 10, 20,
        // and 40 ticks to catch the item regardless of server latency.
        const playerRef = this.player;
        for (const delay of [3, 10, 20, 40]) {
            system.runTimeout(() => {
                try {
                    const inv = playerRef.getComponent("minecraft:inventory")?.container;
                    if (inv) {
                        _sweepContainerFor(inv, SIGNAL_ITEM, SIGNAL_NAME, PLAYER_INV_SIZE);
                        _sweepContainerFor(inv, WARNING_ITEM, WARNING_NAME, PLAYER_INV_SIZE);
                    }
                } catch { }
            }, delay);
        }

        // FIX #4: Remove from sweep set on session end, not just on player leave.
        // Players who open and close the menu no longer accumulate in the set.
        activeSweepPlayers.delete(this.player.id);

        // FIX #3 (manager-level): Remove from activeChests so the manager's tick
        // loop stops iterating this player after the session ends.
        chestManager?.activeChests?.delete(this.player.id);

        if (force || this.tempEntity) {
            let entity;
            this.player.getDynamicPropertyIds().forEach((el) => {
                if (el.startsWith("temp_chest:")) {
                    const entityId = el.replace("temp_chest:", "");
                    this.player.setDynamicProperty(el, undefined);
                    try { entity = world.getEntity(entityId); } catch { }
                }
            });

            try { entity?.remove(); } catch { }
            try { this.tempEntity?.remove(); } catch { }
            this.tempEntity = undefined;

            if (force) {
                try { chestManager.sweepPlayerTempChests(this.player); } catch { }
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────
//  InfiniteChestManager
// ─────────────────────────────────────────────────────────────

class InfiniteChestManager {
    constructor() {
        this.instances = new Map();
        this.playerTickDelays = new Map();
        // FIX #3: track only players with an active session.
        // tick() iterates this set instead of world.getAllPlayers().
        // Prevents silent InfiniteChest object creation for every online
        // player on every tick, and eliminates zero-value ticks entirely.
        this.activeChests = new Set();
    }

    get(player) {
        if (!this.instances.has(player.id)) {
            this.instances.set(player.id, new InfiniteChest(player));
        }
        return this.instances.get(player.id);
    }

    toggle(player) {
        this.get(player).toggleUI();
    }

    /**
     * FIX #7: Dimension-aware sweep — search the player's current dimension
     * first (the common case when a new session is opened). Only fall back to
     * all three dimensions when doing a recovery sweep (keepEntityId is null),
     * which is the stale-entity cleanup path.
     */
    sweepPlayerTempChests(player, keepEntityId) {
        try {
            for (const id of player.getDynamicPropertyIds()) {
                if (!id.startsWith("temp_chest:")) continue;
                if (keepEntityId && id === ("temp_chest:" + keepEntityId)) continue;
                player.setDynamicProperty(id, undefined);
            }

            // Always search the player's current dimension.
            const currentDimId = player.dimension.id.replace("minecraft:", "");
            const dimsToSearch = [currentDimId];
            if (!keepEntityId) {
                for (const d of ["overworld", "nether", "the_end"]) {
                    if (d !== currentDimId) dimsToSearch.push(d);
                }
            }

            for (const dimId of dimsToSearch) {
                let entities = [];
                try { entities = world.getDimension(dimId).getEntities({ type: ENTITY_TYPE }) || []; } catch { }
                for (const e of entities) {
                    try {
                        const tags = e.getTags();
                        const hasOwnerTag = tags?.some(t => t.startsWith("player:"));
                        const isOwnedByPlayer = tags?.some(t => t === ("player:" + player.id) || t.includes(player.id));
                        if (!hasOwnerTag || (isOwnedByPlayer && !(keepEntityId && e.id === keepEntityId))) {
                            try { e.remove(); } catch { }
                            try { player.setDynamicProperty("temp_chest:" + e.id, undefined); } catch { }
                        }
                    } catch { }
                }
            }
        } catch { }
    }

    globalHardWipe() {
        try {
            for (const dimId of ["overworld", "nether", "the_end"]) {
                try {
                    world.getDimension(dimId)
                        .getEntities({ type: ENTITY_TYPE })
                        .forEach(e => { try { e.remove(); } catch { } });
                } catch { }
            }
            for (const player of world.getAllPlayers()) {
                try {
                    player.getDynamicPropertyIds().forEach(id => {
                        if (id.startsWith("temp_chest:")) player.setDynamicProperty(id, undefined);
                    });
                } catch { }
            }
        } catch { }
    }

    /**
     * FIX #3: Iterate only activeChests instead of world.getAllPlayers().
     * Before: O(allPlayers) per tick, creates InfiniteChest for every player.
     * After:  O(activeSessions) per tick — zero cost for players not selling.
     */
    tick() {
        const currentTick = system.currentTick;
        for (const playerId of this.activeChests) {
            const delay = this.playerTickDelays.get(playerId);
            if (delay && currentTick < delay) continue;

            const instance = this.instances.get(playerId);
            if (instance) {
                instance.tick();
            } else {
                // Instance was removed externally — clean up stale ID
                this.activeChests.delete(playerId);
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────

let chestManager = new InfiniteChestManager();

system.runTimeout(() => { chestManager.globalHardWipe(); }, 20);

// ── /ss:sell command ─────────────────────────────────────────

export function registerSellCommand(event) {
    try {
        event.customCommandRegistry.registerCommand(
            {
                name: "ss:sell",
                description: "Open the sell chest",
                permissionLevel: CommandPermissionLevel.Any,
                cheatsRequired: false,
            },
            (context) => {
                const sender = context.initiator ?? context.sourceEntity ?? context.sender;
                if (!sender || sender.typeId !== "minecraft:player") return;

                system.run(() => {
                    chestManager.toggle(sender);

                    // FIX #1 + #4: Only add to activeSweepPlayers when a session is
                    // actually opening. cleanup() removes from the set, so players
                    // who close and re-open are correctly re-added here rather than
                    // accumulating permanently.
                    const chestInstance = chestManager.get(sender);
                    if (chestInstance.isOpen) {
                        activeSweepPlayers.add(sender.id);
                        // FIX #3: register in the active tick set
                        chestManager.activeChests.add(sender.id);
                    }

                    const sessionEntityId = chestInstance.tempEntity?.id;

                    if (sessionEntityId) {
                        system.runTimeout(() => {
                            const current = chestManager.get(sender);
                            if (current && current.isOpen && current.tempEntity?.id === sessionEntityId) {
                                const entityInv = current.tempInv;
                                if (entityInv) {
                                    const { totalCents, breakdown, slots } = calculateAndClearSell(entityInv, { clear: false });
                                    if (totalCents > 0) {
                                        try {
                                            const finalCents = VipPenalty.applySell(sender, totalCents);
                                            const penaltyRatio = finalCents / totalCents;
                                            Money.add(sender, finalCents);
                                            _clearSlots(entityInv, slots);
                                            sendReceipt(sender, breakdown, finalCents, penaltyRatio);
                                            sender.sendMessage("§c[Sell] Time expired — items auto-sold!");
                                        } catch (e) {
                                            console.error("[Sell] Payment failed:", e);
                                            _returnItems(sender, entityInv);
                                            sender.sendMessage("§c[Sell] Payment failed — your items were returned. Tell an admin.");
                                        }
                                    } else {
                                        sender.sendMessage("§c[Sell] Time expired! Menu auto-closed.");
                                    }
                                } else {
                                    sender.sendMessage("§c[Sell] Time expired! Menu auto-closed.");
                                }
                                current.cleanup(true);
                            }
                        }, AUTO_CLOSE_TICKS);
                    }
                });
            }
        );
        console.warn("[Sell] Command registered: /ss:sell");
    } catch (err) {
        if (err.message?.includes("reload")) {
            console.warn("[Sell] Command already registered (reload skipped)");
        } else {
            console.warn(`[Sell] Failed to register command: ${err}`);
        }
    }
}

// ── Tick loop — runs every tick, but scan logic is throttled ──
// The outer interval stays at 1 so entity teleport is smooth.
// The heavy scan inside tick() is gated by _scanTick counter.
// FIX #3: tick() now only iterates activeChests, not all players.
system.runInterval(() => { chestManager.tick(); }, 1);

// ── Player spawn recovery ─────────────────────────────────────

world.afterEvents.playerSpawn.subscribe((data) => {
    if (data.initialSpawn) {
        const player = data.player;
        player.getTags().forEach((el) => {
            if (el.startsWith("entityid:page")) {
                player.setDynamicProperty(el, el);
                player.removeTag(el);
            }
        });
        chestManager.playerTickDelays.set(player.id, system.currentTick + 5);
    }
});

// ── Player leave cleanup ──────────────────────────────────────

world.afterEvents.playerLeave.subscribe((event) => {
    activeSweepPlayers.delete(event.playerId);
    // FIX #3: also remove from activeChests on leave
    chestManager.activeChests.delete(event.playerId);
});

// ── Anti-cheat sweep (every 5s) — direct inventory API ───────
// FIX #1: activeSweepPlayers is now correctly pruned by cleanup(),
// so this set only contains players with genuinely open sessions.
// FIX #6: pass PLAYER_INV_SIZE literal to avoid engine property lookup.

system.runInterval(() => {
    if (activeSweepPlayers.size > 0) {
        for (const player of world.getAllPlayers()) {
            if (!activeSweepPlayers.has(player.id)) continue;
            try {
                const inv = player.getComponent("minecraft:inventory")?.container;
                if (inv) {
                    _sweepContainerFor(inv, SIGNAL_ITEM, SIGNAL_NAME, PLAYER_INV_SIZE);
                    _sweepContainerFor(inv, WARNING_ITEM, WARNING_NAME, PLAYER_INV_SIZE);
                }
            } catch { }
        }
    }

    // Kill dropped signal/warning items in the world
    if (activeSweepPlayers.size > 0 || true) {  // always run — servers can drop items on close
        for (const dim of ["overworld", "nether", "the_end"]) {
            try {
                world.getDimension(dim).runCommand(`kill @e[type=item,name="${SIGNAL_NAME}"]`);
            } catch { }
            try {
                world.getDimension(dim).runCommand(`kill @e[type=item,name="${WARNING_NAME}"]`);
            } catch { }
        }
    }
}, 20);  // 1 s — fast enough to catch server-delayed cursor dumps
