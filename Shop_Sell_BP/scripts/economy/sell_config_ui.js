/**
 * sell_config_ui.js  —  /ss:config sell
 *
 * Flow:
 *   /ss:config sell
 *     └── Main Menu (27-slot)
 *           ├── [Edit Prices]       → paginated item browser (54-slot, 36/page)
 *           │     ├── Search button → ModalForm text input → filtered view
 *           │     ├── ◀ / ▶ page nav
 *           │     ├── tap item      → ModalForm "Enter new price"
 *           │     └── [Back]
 *           └── [Reset To Default]  → confirm → restore all SellPreset prices
 *
 * Storage priority (highest → lowest):
 *   1. In-game overrides saved via Config (DynamicProperty)
 *   2. SellPreset file defaults
 *
 * Key format in Config:  "sell_price:<item_id>"
 *   e.g. Config.get("sell_price:minecraft:oak_log")
 */

import { system }        from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import ChestFormData     from "../Modules/forms.js";
import { forceShow }     from "../Modules/Function.js";
import { Config }        from "./config_store.js";
import { SellPreset }    from "../Preset/sell_prices.js";
import { openHub }       from "./config_hub.js";

// ── Slot layout constants ─────────────────────────────────────
const ROWS_54       = 54;
const BORDER_TOP    = [0,1,2,3,4,5,6,7,8];
const BORDER_BOT    = [45,46,47,48,49,50,51,52,53];
const ITEM_SLOTS    = (() => { const s = []; for (let i = 9; i <= 44; i++) s.push(i); return s; })(); // 36 slots
const PER_PAGE      = ITEM_SLOTS.length; // 36

const SLOT_PREV     = 45;
const SLOT_NEXT     = 53;
const SLOT_SEARCH   = 49;
const SLOT_BACK     = 47;
const SLOT_CLEAR    = 51;

const TEX = {
    BORDER : "minecraft:gray_stained_glass_pane",
    EDIT   : "minecraft:writable_book",
    RESET  : "t/gui/newgui/trash",
    CLOSE  : "minecraft:barrier",
    BACK   : "minecraft:arrow",
    SEARCH : "minecraft:spyglass",
    PREV   : "minecraft:arrow",          // facing left via label
    NEXT   : "minecraft:arrow",
    CLEAR  : "minecraft:red_stained_glass_pane",
    BLANK  : "minecraft:gray_stained_glass_pane",
};

// ── Config key helpers ────────────────────────────────────────

function _priceKey(itemId) {
    return `sell_price:${itemId}`;
}

function _getPrice(itemId) {
    const key     = _priceKey(itemId);
    const stored  = Config.get(key);
    if (stored !== undefined && stored !== null) return stored;
    // Fall back to SellPreset default
    const entry = SellPreset.find(e => e.item === itemId);
    return entry ? entry.price : 0;
}

function _setPrice(itemId, price) {
    return Config.set(_priceKey(itemId), price);
}

function _resetPrice(itemId) {
    Config.reset(_priceKey(itemId));
}

// ── Main Menu (27-slot) ───────────────────────────────────────

export async function showSellConfigUI(player) {
    const form = new ChestFormData("27", "§6§lConfig §8▸ §aSell Prices");

    for (let i = 0; i < 27; i++) form.button(i, "§8", null, TEX.BORDER);

    form.button(11, "§e§lEdit Prices",
        ["§7Browse and change", "§7individual item sell prices"],
        TEX.EDIT);

    form.button(15, "§c§lReset To Default",
        ["§7Restore ALL sell prices", "§7to their preset values"],
        TEX.RESET);

    form.button(26, "§c§lBack", ["§7Return to the Config Hub"], TEX.BACK);

    const res = await forceShow(player, form);
    if (res.canceled) return;

    if (res.selection === 26) return openHub(player);
    if (res.selection === 11) return showSellItemBrowser(player, 0, "");
    if (res.selection === 15) return _confirmResetAll(player);
    // Fallback: clicked a border
    return system.run(() => showSellConfigUI(player));
}

// ── Item Browser (54-slot, paginated + search) ────────────────

export async function showSellItemBrowser(player, page = 0, search = "") {
    // Filter SellPreset by search query
    const query   = search.toLowerCase().trim();
    const filtered = query
        ? SellPreset.filter(e => e.item.toLowerCase().includes(query))
        : SellPreset;

    const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    const safePage   = Math.min(page, totalPages - 1);
    const pageItems  = filtered.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);

    const title = query
        ? `§6§lSell Prices §8▸ §7"${query}" §8(${filtered.length})`
        : `§6§lSell Prices §8▸ §fPage §e${safePage + 1}§8/§e${totalPages}`;

    const form = new ChestFormData(String(ROWS_54), title);

    // Border rows
    for (const s of BORDER_TOP) form.button(s, "§8", null, TEX.BORDER);
    for (const s of BORDER_BOT) form.button(s, "§8", null, TEX.BORDER);

    // Item buttons
    const slotMap = new Map(); // slot → SellPreset entry
    for (let i = 0; i < pageItems.length; i++) {
        const entry   = pageItems[i];
        const slot    = ITEM_SLOTS[i];
        const price   = _getPrice(entry.item);
        const isEdited = Config.get(_priceKey(entry.item)) !== null &&
                         Config.get(_priceKey(entry.item)) !== undefined;

        // Short item name for display  (e.g. "oak_log" from "minecraft:oak_log")
        const shortName = entry.item.includes(":") ? entry.item.split(":")[1] : entry.item;
        const label     = isEdited
            ? `§a${shortName}`        // green = has override
            : `§f${shortName}`;       // white = using default

        form.button(slot,
            label,
            [
                `§7Price: §e${price}§7 coins`,
                isEdited ? "§a✎ Custom value" : "§7Default value",
                "",
                "§b> Click to edit"
            ],
            entry.item   // actual item texture
        );
        slotMap.set(slot, entry);
    }

    // Fill empty item slots with blank glass
    for (let i = pageItems.length; i < PER_PAGE; i++) {
        form.button(ITEM_SLOTS[i], "§8", null, TEX.BLANK);
    }

    // Nav buttons
    if (safePage > 0) {
        form.button(SLOT_PREV, `§b§l◀ Page ${safePage}`, [`§7Go to page ${safePage}`], TEX.PREV);
    } else {
        form.button(SLOT_PREV, "§8", null, TEX.BORDER);
    }

    if (safePage + 1 < totalPages) {
        form.button(SLOT_NEXT, `§b§lPage ${safePage + 2} ▶`, [`§7Go to page ${safePage + 2}`], TEX.NEXT);
    } else {
        form.button(SLOT_NEXT, "§8", null, TEX.BORDER);
    }

    form.button(SLOT_SEARCH, query ? `§e§l🔍 "${query}"` : "§f§lSearch",
        [query ? "§7Click to change/clear search" : "§7Filter items by name"],
        TEX.SEARCH);

    form.button(SLOT_BACK, "§c§lBack",
        ["§7Return to sell config menu"],
        TEX.BACK);

    if (query) {
        form.button(SLOT_CLEAR, "§c§lClear Search",
            ["§7Show all items"],
            TEX.CLEAR);
    } else {
        form.button(SLOT_CLEAR, "§8", null, TEX.BORDER);
    }

    const res = await forceShow(player, form);
    if (res.canceled) return;

    const sel = res.selection;

    // Back
    if (sel === SLOT_BACK) {
        return system.run(() => showSellConfigUI(player));
    }

    // Search
    if (sel === SLOT_SEARCH) {
        return _promptSearch(player, safePage, query);
    }

    // Clear search
    if (sel === SLOT_CLEAR && query) {
        return system.run(() => showSellItemBrowser(player, 0, ""));
    }

    // Pagination
    if (sel === SLOT_PREV && safePage > 0) {
        return system.run(() => showSellItemBrowser(player, safePage - 1, query));
    }
    if (sel === SLOT_NEXT && safePage + 1 < totalPages) {
        return system.run(() => showSellItemBrowser(player, safePage + 1, query));
    }

    // Item clicked
    if (slotMap.has(sel)) {
        const entry = slotMap.get(sel);
        await _promptPriceEdit(player, entry, safePage, query);
        return;
    }
    // Fallback: clicked a border or empty slot
    return system.run(() => showSellItemBrowser(player, safePage, query));
}

// ── Search prompt ─────────────────────────────────────────────

async function _promptSearch(player, page, currentQuery) {
    const form = new ModalFormData()
        .title("§6Search Items")
        .textField(
            "Item name (partial match, e.g. 'log', 'stone')",
            "Type to filter...",
            { defaultValue: currentQuery }
        );

    const res = await forceShow(player, form);
    if (res.canceled) return system.run(() => showSellItemBrowser(player, page, currentQuery));

    const query = (res.formValues[0] ?? "").trim();
    system.run(() => showSellItemBrowser(player, 0, query));
}

// ── Price edit prompt ─────────────────────────────────────────

async function _promptPriceEdit(player, entry, page, query) {
    const current  = _getPrice(entry.item);
    const defPrice = SellPreset.find(e => e.item === entry.item)?.price ?? 0;
    const shortName = entry.item.includes(":") ? entry.item.split(":")[1] : entry.item;

    const form = new ModalFormData()
        .title(`§6Edit: §f${shortName}`)
        .textField(
            `New price (Default: §e${defPrice}§r)`,
            String(current),
            { defaultValue: String(current) }
        );

    const res = await forceShow(player, form);
    if (res.canceled) {
        return system.run(() => showSellItemBrowser(player, page, query));
    }

    const raw = (res.formValues[0] ?? "").trim();
    const num  = parseFloat(raw);

    if (isNaN(num) || num < 0) {
        player.sendMessage(`§c[Config] §fInvalid price. Must be a number >= 0.`);
        return system.run(() => showSellItemBrowser(player, page, query));
    }

    _setPrice(entry.item, num);
    player.sendMessage(
        `§6[Config] §f${shortName} price set to §e${num} §fcoins.`
    );

    system.run(() => showSellItemBrowser(player, page, query));
}

// ── Reset all confirm ─────────────────────────────────────────

async function _confirmResetAll(player) {
    const form = new ModalFormData()
        .title("§c§lReset All Sell Prices?")
        .toggle(
            "§7I understand this will revert ALL sell prices to their preset defaults.",
            { defaultValue: false }
        );

    const res = await forceShow(player, form);
    if (res.canceled || !res.formValues[0]) {
        player.sendMessage("§7[Config] Reset cancelled.");
        return system.run(() => showSellConfigUI(player));
    }

    // Wipe all sell_price: keys
    for (const entry of SellPreset) {
        _resetPrice(entry.item);
    }

    player.sendMessage(
        `§6[Config] §aAll sell prices reset to defaults. §7(${SellPreset.length} items)`
    );
    system.run(() => showSellConfigUI(player));
}
