/**
 * shop_config_ui.js  —  /ss:config shop
 *
 * ── FLOW ────────────────────────────────────────────────────
 *
 *  showShopConfigUI(player)
 *    └── 27-slot MAIN MENU
 *          ├── [Manage Categories]   → showCategoryList
 *          └── [Reset All To Default]→ confirm → wipe shop_data
 *
 *  showCategoryList(player, page, search)
 *    └── 27-slot CATEGORY LIST
 *          Each category = 1 button (icon from preset key)
 *          ├── tap category          → showCategoryMenu
 *          ├── slot 22 [+ New Cat]   → _promptCreateCategory
 *          └── slot 26 [Back]        → showShopConfigUI
 *
 *  showCategoryMenu(player, catKey)
 *    └── 27-slot CATEGORY MENU
 *          slot 10  [Browse / Edit Items]  → showCategoryItemBrowser
 *          slot 12  [Edit Category]        → _promptEditCategory
 *          slot 13  [Add Normal Item]      → _promptAddNormalItem
 *          slot 14  [Add Custom Item]      → _promptAddCustomItem (hand)
 *          slot 16  [Remove Category]      → confirm → delete
 *          slot 22  [Back]                 → showCategoryList
 *
 *  showCategoryItemBrowser(player, catKey, page, search)
 *    └── 54-slot ITEM BROWSER  (36 items / page, border top+bot)
 *          Item texture = actual typeId
 *          Custom items = §d[Custom] label
 *          slot 45 ◀   slot 47 Back   slot 49 Search
 *          slot 51 Clear   slot 53 ▶
 *          tap item → showItemMenu
 *
 *  showItemMenu(player, catKey, itemIndex, page, search)
 *    └── 27-slot ITEM ACTION MENU
 *          slot 11  [Edit Price]    → ModalForm
 *          slot 13  [Remove Item]   → confirm
 *          slot 15  [Replace Item]  → only for custom items (hand)
 *          slot 22  [Back]          → showCategoryItemBrowser
 *
 * ── STORAGE ─────────────────────────────────────────────────
 *  Regular items  → Config "shop_data" JSON (merged over ShopPreset)
 *  Custom items   → metadata in shop_data  +  ItemStack in StorageManager("SHOP")
 *
 *  Custom item entry shape:
 *    { price, item, isCustom: true, slotKey, displayName }
 *
 *  Category key format (from ShopPreset):
 *    "CategoryName|iconTypeId|slotIndex"
 */

/**
 * shop_config_ui.js  —  /ss:config shop
 * 
 * Rewritten to interface directly with Shop v2.7.0 API.
 */

import { system, ItemTypes }         from "@minecraft/server";
import { ModalFormData }  from "@minecraft/server-ui";
import ChestFormData      from "../Modules/forms.js";
import { forceShow }      from "../Modules/Function.js";
import { StorageManager } from "../StorageManager.js";
import Shop               from "../Modules/shop.js";
import { openHub }        from "./config_hub.js";

// ── Slot layout ───────────────────────────────────────────────
const BORDER_TOP  = [0,1,2,3,4,5,6,7,8];
const BORDER_BOT  = [45,46,47,48,49,50,51,52,53];
const ITEM_SLOTS  = (() => { const s = []; for (let i = 9; i <= 44; i++) s.push(i); return s; })();
const PER_PAGE    = 36;

const SLOT_PREV   = 45;
const SLOT_BACK   = 47;
const SLOT_SEARCH = 49;
const SLOT_CLEAR  = 51;
const SLOT_NEXT   = 53;

const TEX = {
    BORDER  : "minecraft:gray_stained_glass_pane",
    MANAGE  : "minecraft:chest",
    RESET   : "t/gui/newgui/trash",
    CLOSE   : "minecraft:barrier",
    BACK    : "minecraft:arrow",
    NEW_CAT : "minecraft:nether_star",
    EDIT    : "minecraft:writable_book",
    ADD_ITEM: "minecraft:emerald",
    ADD_CUST: "minecraft:enchanted_book",
    REMOVE  : "minecraft:barrier",
    SEARCH  : "minecraft:spyglass",
    RESTORE : "minecraft:totem_of_undying",
    CLEAR   : "minecraft:red_stained_glass_pane",
    NORMAL  : "minecraft:paper",
    CUSTOM  : "minecraft:enchanted_book",
};

// ── Main Menu ─────────────────────────────────────────────────

export async function showShopConfigUI(player) {
    const form = new ChestFormData("27", "§6§lConfig §8▸ §bShop");
    for (let i = 0; i < 27; i++) form.button(i, "§8", null, TEX.BORDER);

    form.button(10, "§b§lManage Categories",
        ["§7Create, edit, remove categories", "§7and manage their items"],
        TEX.MANAGE);

    form.button(12, "§a§lRestore Deleted Categories",
        ["§7Bring back deleted default categories", "§7(e.g. Enchanted Book) one by one", "§7or all at once. Your other edits stay."],
        TEX.RESTORE);

    form.button(14, "§6§lRemove ALL Categories",
        ["§7Empty the whole shop in one go", "§7You can restore defaults afterwards"],
        TEX.REMOVE);

    form.button(16, "§c§lReset All To Default",
        ["§7Wipe all in-game shop changes", "§7and restore preset values"],
        TEX.RESET);

    form.button(26, "§c§lBack", ["§7Return to the Config Hub"], TEX.BACK);

    const res = await forceShow(player, form);
    if (res.canceled) return;

    if (res.selection === 26) return openHub(player);
    if (res.selection === 10) return showCategoryList(player);
    if (res.selection === 12) return showRestoreMenu(player);
    if (res.selection === 14) return _confirmRemoveAll(player);
    if (res.selection === 16) return _confirmResetAll(player);

    // Fallback: clicked a border
    return system.run(() => showShopConfigUI(player));
}

// ── Category List (54-slot, paginated + search) ───────────────

export async function showCategoryList(player, page = 0, search = "") {
    const groups  = Shop.getGroups();
    const allCats = Object.keys(groups);

    const query    = search.toLowerCase().trim();
    const filtered = query
        ? allCats.filter(name => name.toLowerCase().includes(query))
        : allCats;

    const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    const safePage   = Math.min(page, totalPages - 1);
    const pageCats   = filtered.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);

    const title = query
        ? `§6§lShop Categories §8▸ §7"${query}" §8(${filtered.length})`
        : `§6§lShop Categories §8▸ §fPage §e${safePage + 1}§8/§e${totalPages}`;

    const form = new ChestFormData("54", title);
    
    // Border rows
    for (const s of BORDER_TOP) form.button(s, "§8", null, TEX.BORDER);
    for (const s of BORDER_BOT) form.button(s, "§8", null, TEX.BORDER);

    const slotMap = new Map();

    // Map categories to the 36 centre slots
    for (let i = 0; i < pageCats.length; i++) {
        const groupName = pageCats[i];
        const data      = groups[groupName];
        const count     = Shop.getItemsByCategory(groupName).length;
        const dispSlot  = ITEM_SLOTS[i];

        form.button(dispSlot,
            `§e§l${groupName}`,
            [`§7Tab slot: §f${data.index}`, `§7Items: §f${count}`, "", "§b> Click to manage"],
            data.icon ?? "minecraft:chest");
            
        slotMap.set(dispSlot, groupName);
    }

    // Fill empty item slots with blank glass
    for (let i = pageCats.length; i < PER_PAGE; i++) {
        form.button(ITEM_SLOTS[i], "§8", null, TEX.BORDER);
    }

    // Nav buttons (hide if not needed)
    form.button(SLOT_PREV, safePage > 0 ? `§b§l◀ Page ${safePage}` : "§8", null, safePage > 0 ? TEX.BACK : TEX.BORDER);
    form.button(SLOT_NEXT, safePage + 1 < totalPages ? `§b§lPage ${safePage + 2} ▶` : "§8", null, safePage + 1 < totalPages ? TEX.BACK : TEX.BORDER);
    
    form.button(47, "§c§lBack", ["§7Return to shop config"], TEX.BACK);
    form.button(48, "§a§l+ New Category", ["§7Create a new shop category"], TEX.NEW_CAT);
    form.button(50, query ? `§e§l🔍 "${query}"` : "§f§lSearch", null, TEX.SEARCH);
    form.button(51, query ? "§c§lClear Search" : "§8", null, query ? TEX.CLEAR : TEX.BORDER);

    const res = await forceShow(player, form);
    if (res.canceled) return system.run(() => showShopConfigUI(player));

    const sel = res.selection;
    
    // Bottom row routing
    if (sel === 47) return system.run(() => showShopConfigUI(player));
    if (sel === 48) return _promptCreateCategory(player);
    if (sel === 50) return _promptSearchCategory(player, safePage, query);
    if (sel === 51 && query) return system.run(() => showCategoryList(player, 0, ""));
    
    // Pagination routing
    if (sel === SLOT_PREV && safePage > 0) return system.run(() => showCategoryList(player, safePage - 1, query));
    if (sel === SLOT_NEXT && safePage + 1 < totalPages) return system.run(() => showCategoryList(player, safePage + 1, query));

    // Category click routing
    if (slotMap.has(sel)) return showCategoryMenu(player, slotMap.get(sel));
    // Fallback: clicked a border or empty slot
    return system.run(() => showCategoryList(player, safePage, query));
}

// ── Search Category Prompt ────────────────────────────────────

async function _promptSearchCategory(player, page, currentQuery) {
    const form = new ModalFormData()
        .title("§6Search Categories")
        .textField("Category name (partial match)", "e.g. Magic...", { defaultValue: currentQuery });

    const res = await forceShow(player, form);
    if (res.canceled) return system.run(() => showCategoryList(player, page, currentQuery));
    
    const query = (res.formValues[0] ?? "").trim();
    system.run(() => showCategoryList(player, 0, query));
}

// ── Category Menu ─────────────────────────────────────────────

async function showCategoryMenu(player, groupName) {
    const groups = Shop.getGroups();
    if (!groups[groupName]) return system.run(() => showCategoryList(player));
    
    const items = Shop.getItemsByCategory(groupName);

    const form = new ChestFormData("27", `§6§lCategory §8▸ §e${groupName}`);
    for (let i = 0; i < 27; i++) form.button(i, "§8", null, TEX.BORDER);

    form.button(10, "§b§lBrowse / Edit Items",
        [`§7${items.length} items in this category`, "§7Edit prices, remove items"],
        TEX.EDIT);

    form.button(12, "§e§lEdit Category",
        ["§7Rename, change icon", "§7or change tab slot"],
        TEX.MANAGE);

    form.button(13, "§a§lAdd Normal Item", ["§7Add by item type ID + price"], TEX.ADD_ITEM);
    form.button(14, "§d§lAdd Custom Item", ["§7Equip item in hand", "§7Stores full NBT"], TEX.ADD_CUST);
    form.button(16, "§c§lRemove Category", ["§7Delete this entire category", "§7and all its items"], TEX.REMOVE);
    form.button(22, "§c§lBack", ["§7Return to category list"], TEX.BACK);

    const res = await forceShow(player, form);
    if (res.canceled) return system.run(() => showCategoryList(player));

    const sel = res.selection;
    if (sel === 22) return system.run(() => showCategoryList(player));
    if (sel === 10) return showCategoryItemBrowser(player, groupName, 0, "");
    if (sel === 12) return _promptEditCategory(player, groupName);
    if (sel === 13) return _promptAddNormalItem(player, groupName);
    if (sel === 14) return _promptAddCustomItem(player, groupName);
    if (sel === 16) return _confirmRemoveCategory(player, groupName);

    // Fallback: clicked a border
    return system.run(() => showCategoryMenu(player, groupName));
}

// ── Item Browser (54-slot, paginated + search) ────────────────

async function showCategoryItemBrowser(player, groupName, page = 0, search = "") {
    const allItems = Shop.getItemsByCategory(groupName);

    const query    = search.toLowerCase().trim();
    const filtered = query
        ? allItems.filter(e => (e.typeId ?? "").toLowerCase().includes(query) ||
                               (e.displayname ?? "").toLowerCase().includes(query))
        : allItems;

    const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    const safePage   = Math.min(page, totalPages - 1);
    const pageItems  = filtered.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);

    const title = query
        ? `§6§l${groupName} §8▸ §7"${query}" §8(${filtered.length})`
        : `§6§l${groupName} §8▸ §fPage §e${safePage + 1}§8/§e${totalPages}`;

    const form = new ChestFormData("54", title);
    for (const s of BORDER_TOP) form.button(s, "§8", null, TEX.BORDER);
    for (const s of BORDER_BOT) form.button(s, "§8", null, TEX.BORDER);

    const slotMap = new Map(); // dispSlot -> item ID

    for (let i = 0; i < pageItems.length; i++) {
        const entry    = pageItems[i];
        const dispSlot = ITEM_SLOTS[i];

        const isCustom  = !!entry.isCustom;
        const shortName = entry.displayname ?? entry.typeId?.replace(/^.*:/, "") ?? "?";
        const label     = isCustom ? `§d§l[Custom] §r§f${shortName}` : `§f${shortName}`;

        form.button(dispSlot,
            label,
            [
                `§7Price: §e${entry.price}§7 coins`,
                isCustom ? "§dFull NBT stored" : "§7Normal item",
                "",
                "§b> Click to manage"
            ],
            entry.icon ?? entry.typeId ?? TEX.CUSTOM);

        slotMap.set(dispSlot, entry.id);
    }

    for (let i = pageItems.length; i < PER_PAGE; i++) form.button(ITEM_SLOTS[i], "§8", null, TEX.BORDER);

    // Nav
    form.button(SLOT_PREV, safePage > 0 ? `§b§l◀ Page ${safePage}` : "§8", null, safePage > 0 ? TEX.BACK : TEX.BORDER);
    form.button(SLOT_NEXT, safePage + 1 < totalPages ? `§b§lPage ${safePage + 2} ▶` : "§8", null, safePage + 1 < totalPages ? TEX.BACK : TEX.BORDER);
    
    form.button(SLOT_SEARCH, query ? `§e§l🔍 "${query}"` : "§f§lSearch", null, TEX.SEARCH);
    form.button(SLOT_BACK, "§c§lBack", ["§7Return to category menu"], TEX.BACK);
    form.button(SLOT_CLEAR, query ? "§c§lClear Search" : "§8", null, query ? TEX.CLEAR : TEX.BORDER);

    const res = await forceShow(player, form);
    if (res.canceled) return system.run(() => showCategoryMenu(player, groupName));

    const sel = res.selection;
    if (sel === SLOT_BACK)   return system.run(() => showCategoryMenu(player, groupName));
    if (sel === SLOT_SEARCH) return _promptSearch(player, groupName, safePage, query);
    if (sel === SLOT_CLEAR && query) return system.run(() => showCategoryItemBrowser(player, groupName, 0, ""));
    if (sel === SLOT_PREV && safePage > 0) return system.run(() => showCategoryItemBrowser(player, groupName, safePage - 1, query));
    if (sel === SLOT_NEXT && safePage + 1 < totalPages) return system.run(() => showCategoryItemBrowser(player, groupName, safePage + 1, query));

    if (slotMap.has(sel)) return showItemMenu(player, groupName, slotMap.get(sel), safePage, query);
    // Fallback: clicked a border or empty slot
    return system.run(() => showCategoryItemBrowser(player, groupName, safePage, query));
}

// ── Item Action Menu ──────────────────────────────────────────

async function showItemMenu(player, groupName, itemId, page, search) {
    const items = Shop.getItems();
    const entry = items[itemId];
    if (!entry) return system.run(() => showCategoryItemBrowser(player, groupName, page, search));

    const isCustom  = !!entry.isCustom;
    const shortName = entry.displayname ?? entry.typeId?.replace(/^.*:/, "") ?? "?";

    const previewLore = [`§7Price: §e${entry.price}§7 coins`];
    if (isCustom) {
        let customLore = entry.lore;
        if (!customLore && entry.slotKey) {
            try {
                const storedItem = StorageManager.retrieve("SHOP", entry.slotKey);
                if (storedItem) {
                    customLore = (storedItem.getLore?.() ?? []).filter(l => !l.startsWith("\uFEFF"));
                    entry.lore = customLore;
                }
            } catch (e) { }
        }
        if (Array.isArray(customLore) && customLore.length > 0) {
            previewLore.push(...customLore);
        } else {
            previewLore.push("§dFull NBT stored");
        }
    } else {
        previewLore.push(`§7ID: §f${entry.typeId}`);
    }

    const form = new ChestFormData("27", `§6§lItem §8▸ §f${shortName}`);
    for (let i = 0; i < 27; i++) form.button(i, "§8", null, TEX.BORDER);

    form.button(13,
        isCustom ? `§d§l[Custom] §r§f${shortName}` : `§f${shortName}`,
        previewLore,
        entry.icon ?? entry.typeId ?? TEX.CUSTOM);

    form.button(11, "§e§lEdit Price", ["§7Set a new price for this item"], TEX.EDIT);
    form.button(15, "§c§lRemove Item", ["§7Remove from this category"], TEX.REMOVE);

    if (isCustom) {
        form.button(9, "§b§lReplace Item", ["§7Equip new item in hand", "§7Replaces stored NBT"], TEX.ADD_CUST);
    }

    form.button(22, "§c§lBack", ["§7Return to item list"], TEX.BACK);

    const res = await forceShow(player, form);
    if (res.canceled) return system.run(() => showCategoryItemBrowser(player, groupName, page, search));

    const sel = res.selection;
    if (sel === 22) return system.run(() => showCategoryItemBrowser(player, groupName, page, search));
    if (sel === 11) return _promptEditPrice(player, groupName, itemId, page, search);
    if (sel === 15) return _confirmRemoveItem(player, groupName, itemId, page, search);
    if (sel === 9 && isCustom) return _promptReplaceCustomItem(player, groupName, itemId, page, search);

    // Fallback: clicked a border
    return system.run(() => showItemMenu(player, groupName, itemId, page, search));
}

// ── Search prompt ─────────────────────────────────────────────

async function _promptSearch(player, groupName, page, currentQuery) {
    const form = new ModalFormData()
        .title("§6Search Items")
        .textField("Item name or type ID (partial match)", "e.g. sword, oak_log...", { defaultValue: currentQuery });

    const res = await forceShow(player, form);
    if (res.canceled) return system.run(() => showCategoryItemBrowser(player, groupName, page, currentQuery));
    const query = (res.formValues[0] ?? "").trim();
    system.run(() => showCategoryItemBrowser(player, groupName, 0, query));
}

// ── Edit Price ────────────────────────────────────────────────

async function _promptEditPrice(player, groupName, itemId, page, search) {
    const items = Shop.getItems();
    const entry = items[itemId];
    if (!entry) return system.run(() => showCategoryItemBrowser(player, groupName, page, search));

    const form = new ModalFormData()
        .title("§6Edit Price")
        .textField(`New price | Current: §e${entry.price}`, String(entry.price), { defaultValue: String(entry.price) });

    const res = await forceShow(player, form);
    if (res.canceled) return system.run(() => showItemMenu(player, groupName, itemId, page, search));

    const num = parseFloat(res.formValues[0]);
    if (isNaN(num) || num < 0) {
        player.sendMessage("§c[Shop Config] §fInvalid price. Must be a number >= 0.");
        return system.run(() => showItemMenu(player, groupName, itemId, page, search));
    }

    Shop.editItem(itemId, { price: num }); // API CALL

    const shortName = entry.displayname ?? entry.typeId?.replace(/^.*:/, "") ?? "item";
    player.sendMessage(`§6[Shop Config] §f${shortName} price → §e${num} §fcoins.`);
    system.run(() => showCategoryItemBrowser(player, groupName, page, search));
}

// ── Remove Item ───────────────────────────────────────────────

async function _confirmRemoveItem(player, groupName, itemId, page, search) {
    const items = Shop.getItems();
    const entry = items[itemId];
    if (!entry) return system.run(() => showCategoryItemBrowser(player, groupName, page, search));

    const shortName = entry.displayname ?? entry.typeId?.replace(/^.*:/, "") ?? "item";

    const form = new ModalFormData()
        .title("§cRemove Item?")
        .toggle(`§7Remove §e${shortName} §7from this category?`, { defaultValue: false });

    const res = await forceShow(player, form);
    if (res.canceled || !res.formValues[0]) {
        player.sendMessage("§7[Shop Config] Cancelled.");
        return system.run(() => showItemMenu(player, groupName, itemId, page, search));
    }

    if (entry.isCustom && entry.slotKey) StorageManager.remove("SHOP", entry.slotKey);
    
    Shop.removeItem(itemId); // API CALL

    player.sendMessage(`§6[Shop Config] §f${shortName} removed.`);
    
    // Adjust page if emptied
    const newTotal = Math.ceil(Shop.getItemsByCategory(groupName).length / PER_PAGE);
    const safePage = Math.min(page, Math.max(0, newTotal - 1));
    system.run(() => showCategoryItemBrowser(player, groupName, safePage, search));
}

// ── Add Normal Item ───────────────────────────────────────────

async function _promptAddNormalItem(player, groupName) {
    const form = new ModalFormData()
        .title("§aAdd Normal Item")
        .textField("Item type ID", "e.g. minecraft:diamond_sword", { defaultValue: "minecraft:" })
        .textField("Price", "e.g. 500", { defaultValue: "100" });

    const res = await forceShow(player, form);
    if (res.canceled) return system.run(() => showCategoryMenu(player, groupName));

    let typeId = (res.formValues[0] ?? "").trim();
    const price  = parseFloat(res.formValues[1]);

    // Safety net: If they accidentally deleted "minecraft:" but typed an item name
    if (typeId !== "" && !typeId.includes(":")) {
        typeId = "minecraft:" + typeId;
    }

    if (typeId === "minecraft:" || typeId === "") {
        return system.run(() => { 
            player.sendMessage("§c[Shop Config] Item ID cannot be empty."); 
            showCategoryMenu(player, groupName); 
        });
    }

    if (isNaN(price) || price < 0) {
        return system.run(() => { 
            player.sendMessage("§c[Shop Config] Invalid price."); 
            showCategoryMenu(player, groupName); 
        });
    }

    // VALIDATION: Check if the item actually exists in the game engine
    if (!ItemTypes.get(typeId)) {
        return system.run(() => { 
            player.sendMessage(`§c[Shop Config] The item "§f${typeId}§c" does not exist! Check your spelling.`); 
            showCategoryMenu(player, groupName); 
        });
    }

    const short = typeId.replace(/^.*:/, "");
    
    // API CALL
    Shop.addItem({
        typeId:      typeId,
        displayname: short,
        icon:        typeId,
        price:       price,
        category:    groupName,
    });

    player.sendMessage(`§6[Shop Config] §f${short} added at §e${price} §fcoins.`);
    system.run(() => showCategoryMenu(player, groupName));
}
// ── Add Custom Item (from hand) ───────────────────────────────

async function _promptAddCustomItem(player, groupName) {
    const form = new ModalFormData()
        .title("§dAdd Custom Item")
        .textField("§7Equip the item in your MAIN HAND, then enter price", "Price", { defaultValue: "100" });

    const res = await forceShow(player, form);
    if (res.canceled) return system.run(() => showCategoryMenu(player, groupName));

    const price = parseFloat(res.formValues[0]);
    if (isNaN(price) || price < 0) return system.run(() => { player.sendMessage("§c[Shop Config] Invalid price."); showCategoryMenu(player, groupName); });

    let heldItem = null;
    try { heldItem = player.getComponent("minecraft:equippable").getEquipment("Mainhand"); } catch { }

    if (!heldItem) return system.run(() => { player.sendMessage("§c[Shop Config] No item in main hand."); showCategoryMenu(player, groupName); });

    const slotKey     = StorageManager.store("SHOP", heldItem);
    const displayName = heldItem.nameTag || heldItem.typeId.replace(/^.*:/, "").replace(/_/g, " ");
    const customLore  = (heldItem.getLore?.() ?? []).filter(l => !l.startsWith("\uFEFF"));

    // API CALL
    Shop.addItem({
        typeId:      heldItem.typeId,
        displayname: displayName,
        icon:        heldItem.typeId,
        price:       price,
        category:    groupName,
        isCustom:    true,
        slotKey:     slotKey,
        lore:        customLore
    });

    player.sendMessage(`§6[Shop Config] §d[Custom] §f${displayName} added at §e${price} §fcoins.`);
    system.run(() => showCategoryMenu(player, groupName));
}

// ── Replace Custom Item (from hand) ──────────────────────────

async function _promptReplaceCustomItem(player, groupName, itemId, page, search) {
    const form = new ModalFormData()
        .title("§bReplace Custom Item")
        .toggle("§7Equip the NEW item in your MAIN HAND, then confirm.", { defaultValue: false });

    const res = await forceShow(player, form);
    if (res.canceled || !res.formValues[0]) return system.run(() => showItemMenu(player, groupName, itemId, page, search));

    let heldItem = null;
    try { heldItem = player.getComponent("minecraft:equippable").getEquipment("Mainhand"); } catch { }

    if (!heldItem) return system.run(() => { player.sendMessage("§c[Shop Config] No item in main hand."); showItemMenu(player, groupName, itemId, page, search); });

    const items = Shop.getItems();
    const entry = items[itemId];
    if (!entry) return system.run(() => showCategoryItemBrowser(player, groupName, page, search));

    if (entry.slotKey) StorageManager.remove("SHOP", entry.slotKey);
    const newSlotKey  = StorageManager.store("SHOP", heldItem);
    const displayName = heldItem.nameTag || heldItem.typeId.replace(/^.*:/, "").replace(/_/g, " ");
    const customLore  = (heldItem.getLore?.() ?? []).filter(l => !l.startsWith("\uFEFF"));

    // API CALL
    Shop.editItem(itemId, {
        slotKey:     newSlotKey,
        typeId:      heldItem.typeId,
        displayname: displayName,
        icon:        heldItem.typeId,
        lore:        customLore
    });

    player.sendMessage(`§6[Shop Config] §fCustom item replaced with §d${displayName}§f.`);
    system.run(() => showCategoryItemBrowser(player, groupName, page, search));
}

// ── Create Category ───────────────────────────────────────────

async function _promptCreateCategory(player) {
    const freeSlots = Shop.getEmptyIndex();
    if (freeSlots.length === 0) {
        player.sendMessage("§c[Shop Config] §fAll 36 category tab slots (9–44) are currently full!");
        player.sendMessage("§e[Shop Config] §7Please delete or edit an existing category before adding a new one.");
        return system.run(() => showCategoryList(player));
    }

    const defaultSlot = String(freeSlots[0]);
    const form = new ModalFormData()
        .title("§aNew Category")
        .textField("Category name", "e.g. Magic")
        .textField("Icon type ID", "e.g. minecraft:diamond_sword")
        .textField(`Tab slot (9–44; 18+ = 54-slot shop) | Free: ${freeSlots.join(", ")}`, `Default: ${defaultSlot}`, { defaultValue: defaultSlot });

    const res = await forceShow(player, form);
    if (res.canceled) return system.run(() => showCategoryList(player));

    const name = (res.formValues[0] ?? "").trim();
    const icon = (res.formValues[1] ?? "").trim();
    const slotRaw = (res.formValues[2] ?? "").trim();
    const slot = slotRaw ? parseInt(slotRaw, 10) : freeSlots[0];

    if (!name) {
        player.sendMessage("§c[Shop Config] §fCategory name cannot be empty.");
        return system.run(() => showCategoryList(player));
    }

    if (!icon) {
        player.sendMessage("§c[Shop Config] §fIcon type ID cannot be empty (e.g. minecraft:diamond_sword).");
        return system.run(() => showCategoryList(player));
    }

    if (isNaN(slot) || slot < 9 || slot > 44) {
        player.sendMessage(`§c[Shop Config] §fInvalid tab slot "§e${slotRaw}§f". Must be a number between 9 and 44. (Available: ${freeSlots.join(", ")})`);
        return system.run(() => showCategoryList(player));
    }

    const groups = Shop.getGroups();
    const taken  = Object.values(groups).some(g => g.index === slot);
    
    if (taken) {
        player.sendMessage(`§c[Shop Config] §fTab slot §e${slot} §fis already in use. (Available: ${freeSlots.join(", ")})`);
        return system.run(() => showCategoryList(player));
    }

    // API CALL
    Shop.addGroup(name, { displayname: name, icon, index: slot });

    player.sendMessage(`§6[Shop Config] §fCategory §e${name} §fcreated at tab slot §e${slot}§f.`);
    system.run(() => showCategoryMenu(player, name));
}

// ── Edit Category (rename / icon / slot) ─────────────────────

async function _promptEditCategory(player, groupName) {
    const groups = Shop.getGroups();
    const data   = groups[groupName];
    if (!data) return system.run(() => showCategoryList(player));

    const freeSlots = Shop.getEmptyIndex();
    const availableSlots = [data.index, ...freeSlots].sort((a, b) => a - b);

    const form = new ModalFormData()
        .title(`§6Edit: §e${groupName}`)
        .textField("Category name", groupName, { defaultValue: groupName })
        .textField("Icon type ID",  data.icon, { defaultValue: data.icon })
        .textField(`Tab slot (9–44; 18+ = 54-slot shop) | Free: ${availableSlots.join(", ")}`, String(data.index), { defaultValue: String(data.index) });

    const res = await forceShow(player, form);
    if (res.canceled) return system.run(() => showCategoryMenu(player, groupName));

    const newName = (res.formValues[0] ?? "").trim() || groupName;
    const newIcon = (res.formValues[1] ?? "").trim() || data.icon;
    const slotRaw = (res.formValues[2] ?? "").trim();
    const newSlot = slotRaw ? parseInt(slotRaw, 10) : data.index;

    if (isNaN(newSlot) || newSlot < 9 || newSlot > 44) {
        player.sendMessage(`§c[Shop Config] §fInvalid tab slot. Must be a number between 9 and 44. (Available: ${availableSlots.join(", ")})`);
        return system.run(() => showCategoryMenu(player, groupName));
    }

    const slotTaken = Object.entries(Shop.getGroups()).some(([k, g]) => g.index === newSlot && k !== groupName);
    if (slotTaken) {
        player.sendMessage(`§c[Shop Config] §fTab slot §e${newSlot} §fis already in use.`);
        return system.run(() => showCategoryMenu(player, groupName));
    }

    // API CALLS
    Shop.removeGroup(groupName);
    Shop.addGroup(newName, { displayname: newName, icon: newIcon, index: newSlot });

    // If renamed, we must manually update the category tag on all its items
    if (newName !== groupName) {
        const items = Shop.getItemsByCategory(groupName); // Because index is maintained based on old properties
        for (const item of items) {
            Shop.editItem(item.id, { category: newName });
        }
    }

    player.sendMessage(`§6[Shop Config] §fCategory updated → §e${newName}§f.`);
    system.run(() => showCategoryMenu(player, newName));
}

// ── Remove Category ───────────────────────────────────────────

async function _confirmRemoveCategory(player, groupName) {
    const form = new ModalFormData()
        .title("§c§lRemove Category?")
        .toggle(`§7Delete §e${groupName} §7and ALL its items?\n§8(Default categories can be restored from Shop Config > Restore Deleted Categories)`, { defaultValue: false });

    const res = await forceShow(player, form);
    if (res.canceled || !res.formValues[0]) return system.run(() => showCategoryMenu(player, groupName));

    const items = Shop.getItemsByCategory(groupName);
    for (const item of items) {
        if (item.isCustom && item.slotKey) StorageManager.remove("SHOP", item.slotKey);
        Shop.removeItem(item.id); // API CALL
    }

    Shop.removeGroup(groupName); // API CALL

    player.sendMessage(`§6[Shop Config] §fCategory §e${groupName} §fremoved.`);
    system.run(() => showCategoryList(player));
}


// ── Reset All ─────────────────────────────────────────────────

async function _confirmResetAll(player) {
    const form = new ModalFormData()
        .title("§c§lReset All Shop Data?")
        .toggle("§7This wipes ALL in-game shop changes and restores preset defaults.", { defaultValue: false });

    const res = await forceShow(player, form);
    if (res.canceled || !res.formValues[0]) return system.run(() => showShopConfigUI(player));

    // Clear StorageManager slots before wiping
    const items = Shop.getItems();
    for (const entry of Object.values(items)) {
        if (entry.isCustom && entry.slotKey) StorageManager.remove("SHOP", entry.slotKey);
    }

    // Call Shop engine's official reset logic
    Shop.resetData();
    await Shop.init();

    player.sendMessage("§6[Shop Config] §aAll shop data reset to preset defaults.");
    system.run(() => showShopConfigUI(player));
}

// ── Restore Deleted Categories ────────────────────────────────

async function showRestoreMenu(player) {
    const missing = await Shop.getMissingPresetCategories();
    const form = new ChestFormData("54", "§6§lRestore §8▸ §aDeleted Categories");
    for (let i = 0; i < 54; i++) form.button(i, "§8", null, TEX.BORDER);

    const shown = missing.slice(0, 36);
    const slotMap = new Map();
    shown.forEach((m, i) => {
        const slot = ITEM_SLOTS[i];
        form.button(slot, `§e§l${m.name}`,
            [`§7Items: §f${m.count}`, "", "§a> Click to restore this category"],
            m.icon ?? "minecraft:chest");
        slotMap.set(slot, m.name);
    });

    if (missing.length === 0) {
        form.button(22, "§a§lNothing to restore",
            ["§7All default categories are already in the shop"], TEX.NORMAL);
    }

    form.button(47, "§c§lBack", ["§7Return to shop config"], TEX.BACK);
    if (missing.length > 0) {
        form.button(51, "§a§lRestore ALL (" + missing.length + ")",
            ["§7Restore every missing default category"], TEX.RESTORE);
    }

    const res = await forceShow(player, form);
    if (res.canceled) return system.run(() => showShopConfigUI(player));

    const sel = res.selection;
    if (sel === 47) return system.run(() => showShopConfigUI(player));

    if (sel === 51 && missing.length > 0) {
        const n = await Shop.restoreAllMissing();
        player.sendMessage(`§6[Shop Config] §aRestored §e${n} §acategor${n === 1 ? "y" : "ies"}.`);
        return system.run(() => showRestoreMenu(player));
    }
    if (slotMap.has(sel)) {
        const name = slotMap.get(sel);
        const n = await Shop.restorePresetCategory(name);
        player.sendMessage(n >= 0
            ? `§6[Shop Config] §aRestored §e${name} §a(${n} items).`
            : `§c[Shop Config] §fCould not restore §e${name} §f— no free tab slot (max 36 categories).`);
        return system.run(() => showRestoreMenu(player));
    }
    return system.run(() => showRestoreMenu(player));
}

// ── Remove ALL categories ─────────────────────────────────────

async function _confirmRemoveAll(player) {
    const form = new ModalFormData()
        .title("§c§lRemove ALL Categories?")
        .toggle("§7This deletes EVERY category and item, including custom items.\n§8You can bring the defaults back with Restore Deleted Categories or Reset All To Default.", { defaultValue: false });

    const res = await forceShow(player, form);
    if (res.canceled || !res.formValues[0]) return system.run(() => showShopConfigUI(player));

    Shop.removeAllCategories();
    player.sendMessage("§6[Shop Config] §fAll shop categories removed. §7Use §eRestore Deleted Categories §7to bring defaults back.");
    system.run(() => showShopConfigUI(player));
}
