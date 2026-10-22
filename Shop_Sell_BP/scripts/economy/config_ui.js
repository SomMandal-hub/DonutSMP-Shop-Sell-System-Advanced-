/**
 * config_ui.js  —  In-game chest UI config editor
 *
 * VIP & Security panel. Reached from the Config Hub (/ss:config -> "VIP & Security").
 */

import { system, world } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import ChestFormData     from "../Modules/forms.js";
import { forceShow }     from "../Modules/Function.js";
import { Config }        from "./config_store.js";
import { CONFIG_DEFAULTS } from "../Preset/config.js";
import { restartLeaderboardInterval, purgeOfflineFromCache, restoreOfflineToCache, Money } from "./money_system.js";
import { openHub } from "./config_hub.js";
import Shop from "../Modules/shop.js";

const TEX = {
    ON:      "minecraft:lime_stained_glass_pane",
    OFF:     "minecraft:red_stained_glass_pane",
    BORDER:  "minecraft:gray_stained_glass_pane",
    BOOK:    "minecraft:writable_book",
    STRING:  "minecraft:name_tag",
    RESET:   "t/gui/newgui/trash",
    CLOSE:   "minecraft:barrier",
    BACK:    "minecraft:arrow",
    ECONOMY: "minecraft:gold_ingot",
    SHOP:    "minecraft:chest",
    SELL:    "minecraft:hopper",
    VIP:     "t/gui/newgui/mob_effects/resistance_effect",
    SHIELD:  "minecraft:shield"
};

/**
 * The main screen now lives in config_hub.js (Economy + every addon's panels).
 * showConfigUI is kept as an alias so older callers still work.
 */
export function showConfigUI(player) { return openHub(player); }

/**
 * VIP & SECURITY CATEGORY
 */
export async function showVipConfig(player, page = 0) {
    const form = new ChestFormData("54", `§6§lConfig §8> §dVIP (Page ${page + 1})`);
    for (let i = 0; i < 54; i++) form.button(i, "§8", null, TEX.BORDER);

    const allProfiles = Config.get("penaltyProfiles") || [];
    const settings = [
        { key: "enableVipPenalty", slot: 49, type: "toggle", label: "VIP Penalty System", desc: ["Master toggle for penalties"] },
        { key: "penaltyExemptCategories", slot: 50, type: "list", label: "Exempt Categories", desc: ["Categories exempt from penalty"] },
    ];

    _renderSettings(form, settings);

    // Pagination Logic
    const perPage = 36; // slots 9 to 44
    const totalPages = Math.ceil(allProfiles.length / perPage) || 1;
    const startIdx = page * perPage;
    const pageProfiles = allProfiles.slice(startIdx, startIdx + perPage);

    // Render Profiles
    const profileMap = new Map();
    let slot = 9;
    for (const [tag, data] of pageProfiles) {
        form.button(slot, `§e§lTag: ${tag}`, [
            `§7Sell Divisor: §a${data.sell}x`,
            `§7Buy Multiplier: §c${data.buy}x`,
            "",
            "§b> Click to Edit"
        ], TEX.BOOK);
        profileMap.set(slot, tag);
        slot++;
    }

    // Navigation Buttons
    const prevSlot = 45;
    const nextSlot = 53;
    const addSlot = 46;
    const backSlot = 48;

    if (page > 0) {
        form.button(prevSlot, "§b§l« Previous Page", [`§7Go to page ${page}`], "minecraft:arrow");
    }
    if (page + 1 < totalPages) {
        form.button(nextSlot, "§b§lNext Page »", [`§7Go to page ${page + 2}`], "minecraft:arrow");
    }

    form.button(addSlot, "§a§l+ Add New Profile", ["§7Create a new penalty tier"], "minecraft:nether_star");
    form.button(backSlot, "§c§lBack", ["§7Return to the Config Hub"], TEX.BACK);
    form.button(51, "§4§lReset Category", ["§7Revert all VIP settings & profiles", "§7to factory defaults"], TEX.RESET);

    const res = await form.show(player);
    if (res.canceled) return;

    if (res.selection === backSlot) return openHub(player);
    if (res.selection === addSlot) return _promptPenaltyAdd(player, page);
    if (res.selection === prevSlot && page > 0) return showVipConfig(player, page - 1);
    if (res.selection === nextSlot && page + 1 < totalPages) return showVipConfig(player, page + 1);
    
    if (res.selection === 51) {
        if (await _confirmCategoryReset(player, settings, true)) return showVipConfig(player, 0);
        return showVipConfig(player, page);
    }

    if (profileMap.has(res.selection)) {
        return _promptPenaltyEdit(player, profileMap.get(res.selection), page);
    }

    await _handleInteraction(player, res.selection, settings, (p) => showVipConfig(p, page));
}

// ─────────────────────────────────────────────────────────────
//  Internal Helpers
// ─────────────────────────────────────────────────────────────

function _renderSettings(form, settings) {
    for (const s of settings) {
        const val = Config.get(s.key);
        if (s.type === "toggle") {
            const tex = val ? TEX.ON : TEX.OFF;
            const flag = val ? "§a§lON  §r§f" : "§c§lOFF §r§f";
            form.button(s.slot, `${flag}${s.label}`, s.desc, tex);
        } else if (s.type === "number") {
            form.button(s.slot, `§e§l${s.label}`, [...(s.desc || []), `§7Current: §a${val}`], TEX.BOOK);
        } else if (s.type === "string") {
            form.button(s.slot, `§b§l${s.label}`, [...(s.desc || []), `§7Current: §a${val}`], TEX.STRING);
        } else if (s.type === "list") {
            const list = Array.isArray(val) ? val : [];
            const display = list.length > 0
                ? (list.length <= 2 ? list.join(", ") : `${list.slice(0, 2).join(", ")} +${list.length - 2} more`)
                : "None";
            form.button(s.slot, `§6§l${s.label}`, [
                ...(s.desc || []),
                `§7Current: §e${display}`,
                "§8(FORVIP & FREE always exempt)",
                "",
                "§b> Click to Edit"
            ], s.icon || TEX.SHIELD || "minecraft:shield");
        }
    }
}

async function _handleInteraction(player, slot, settings, reopenFn) {
    const s = settings.find(x => x.slot === slot);
    if (!s) return;

    if (s.type === "toggle") {
        const newVal = Config.toggle(s.key);
        player.sendMessage(`§6[Config] §f${s.label} → ${newVal ? "§aON" : "§cOFF"}`);
        
        // Side effects
        if (s.key === "keepOfflineNames") {
            if (newVal) restoreOfflineToCache();
            else purgeOfflineFromCache();
            restartLeaderboardInterval();
        } else if (s.key === "showLeaderboard") {
            restartLeaderboardInterval();
            Money.refreshLeaderboard();
        }
        
        system.run(() => reopenFn(player));
    } else {
        await new Promise(resolve => system.runTimeout(resolve, 1));
        if (s.type === "number") await _promptNumeric(player, s);
        else if (s.type === "string") await _promptString(player, s);
        else if (s.type === "list") await _promptList(player, s);
        system.run(() => reopenFn(player));
    }
}

async function _confirmCategoryReset(player, settings, includeProfiles = false) {
    const form = new ModalFormData()
        .title("§c§lReset Category?")
        .toggle("§7I understand this reverts these settings to defaults.", { defaultValue: false });

    const res = await forceShow(player, form);
    if (res.canceled || !res.formValues[0]) {
        player.sendMessage(`§7[Config] Reset cancelled.`);
        return false;
    }

    for (const s of settings) Config.reset(s.key);
    if (includeProfiles) {
        Config.reset("penaltyProfiles");
        Config.reset("penaltyExemptCategories");
    }

    player.sendMessage(`§6[Config] §aCategory settings reset to defaults.`);
    
    // Check if any reset keys require side effects
    if (settings.some(s => s.key === "lbRefreshTicks")) restartLeaderboardInterval();
    if (settings.some(s => ["lbRefreshTicks", "lbTopCount", "leaderboardTitle", "showLeaderboard"].includes(s.key))) {
        Money.refreshLeaderboard();
    }

    return true;
}

async function _promptNumeric(player, def) {
    const current = Config.get(def.key);
    const form = new ModalFormData()
        .title(`§6Edit: ${def.label}`)
        .textField(
            `Value (${def.min}–${def.max}) | Default: ${CONFIG_DEFAULTS[def.key]}`,
            String(current),
            { defaultValue: String(current) }
        );

    const res = await forceShow(player, form);
    if (res.canceled) return;

    let num = def.step ? parseFloat(res.formValues[0]) : parseInt(res.formValues[0], 10);
    if (isNaN(num) || num < def.min || num > def.max) {
        player.sendMessage(`§c[Config] §fInvalid value. Must be between ${def.min} and ${def.max}.`);
        return;
    }
    Config.set(def.key, num);
    player.sendMessage(`§6[Config] §f${def.label} set to §a${num}§f.`);

    if (def.key === "lbRefreshTicks") restartLeaderboardInterval();
    if (def.key === "lbRefreshTicks" || def.key === "lbTopCount" || def.key === "leaderboardTitle") Money.refreshLeaderboard();
}

async function _promptString(player, def) {
    const current = Config.get(def.key);
    const form = new ModalFormData()
        .title(`§6Edit: ${def.label}`)
        .textField(
            `Enter new text | Default: ${CONFIG_DEFAULTS[def.key]}`,
            String(current),
            { defaultValue: String(current) }
        );

    const res = await forceShow(player, form);
    if (res.canceled || !res.formValues[0]) return;

    const val = res.formValues[0].trim();
    if (val.length === 0) return;

    Config.set(def.key, val);
    player.sendMessage(`§6[Config] §f${def.label} updated.`);

    if (def.key === "leaderboardTitle") Money.refreshLeaderboard();
}

async function _promptList(player, def) {
    const current = Config.get(def.key) || [];
    const defaultVal = (CONFIG_DEFAULTS[def.key] || []).join(", ");

    let shopCatsHint = "";
    try {
        const groups = Shop.getGroups();
        const catNames = Object.keys(groups);
        if (catNames.length > 0) {
            shopCatsHint = `\n\nExisting Shop Categories:\n${catNames.join(", ")}`;
        }
    } catch {}

    const form = new ModalFormData()
        .title(`§6Edit: ${def.label}`)
        .textField(
            `Enter exempt categories separated by commas.\nDefault: ${defaultVal || "None"}\n(Note: "FORVIP" & "FREE" are built-in & always exempt)${shopCatsHint}`,
            "e.g. ADMIN, POTIONS",
            { defaultValue: current.join(", ") }
        );

    const res = await forceShow(player, form);
    if (res.canceled) return;

    const raw = (res.formValues[0] ?? "").trim();
    const list = raw
        .split(",")
        .map(x => x.trim().toUpperCase())
        .filter(x => x.length > 0);

    const unique = [...new Set(list)];
    Config.set(def.key, unique);
    player.sendMessage(`§6[Config] §f${def.label} updated: §e${unique.length ? unique.join(", ") : "None"}`);
}

async function _promptPenaltyEdit(player, tag, page = 0) {
    const profiles = Config.get("penaltyProfiles");
    const index = profiles.findIndex(p => p[0] === tag);
    if (index === -1) return;

    const [_, data] = profiles[index];
    const form = new ModalFormData()
        .title(`§6Edit Profile: ${tag}`)
        .textField(`Sell Divisor (current: ${data.sell})`, "Number >= 1", { defaultValue: String(data.sell) })
        .textField(`Buy Multiplier (current: ${data.buy})`, "Number >= 1", { defaultValue: String(data.buy) })
        .toggle("§c§lDELETE PROFILE?", { defaultValue: false });

    const res = await forceShow(player, form);
    if (res.canceled) return system.run(() => showVipConfig(player, page));

    const [sellStr, buyStr, shouldDelete] = res.formValues;

    if (shouldDelete) {
        profiles.splice(index, 1);
        Config.set("penaltyProfiles", profiles);
        player.sendMessage(`§6[Config] §fProfile §e${tag} §cremoved§f.`);
    } else {
        const sell = parseFloat(sellStr);
        const buy = parseFloat(buyStr);
        if (isNaN(sell) || isNaN(buy) || sell < 1 || buy < 1) {
            player.sendMessage("§c[Config] §fInvalid numbers. Must be >= 1.");
        } else {
            profiles[index][1] = { sell, buy };
            Config.set("penaltyProfiles", profiles);
            player.sendMessage(`§6[Config] §fProfile §e${tag} §aupdated§f.`);
        }
    }
    system.run(() => showVipConfig(player, page));
}

async function _promptPenaltyAdd(player, page = 0) {
    const form = new ModalFormData()
        .title("§6Add New Penalty Profile")
        .textField("Tag Name (e.g. hacker)", "Unique tag")
        .textField("Sell Divisor", "e.g. 4", { defaultValue: "4" })
        .textField("Buy Multiplier", "e.g. 1", { defaultValue: "1" });

    const res = await forceShow(player, form);
    if (res.canceled) return system.run(() => showVipConfig(player, page));

    const [tag, sellStr, buyStr] = res.formValues;
    const sell = parseFloat(sellStr);
    const buy = parseFloat(buyStr);

    if (!tag || isNaN(sell) || isNaN(buy) || sell < 1 || buy < 1) {
        player.sendMessage("§c[Config] §fInvalid inputs. Tag required, numbers must be >= 1.");
    } else {
        const profiles = Config.get("penaltyProfiles");
        if (profiles.some(p => p[0] === tag)) {
            player.sendMessage(`§c[Config] §fTag "§e${tag}§f" already exists.`);
        } else {
            profiles.push([tag, { sell, buy }]);
            Config.set("penaltyProfiles", profiles);
            player.sendMessage(`§6[Config] §fProfile §e${tag} §aadded§f.`);
        }
    }
    system.run(() => showVipConfig(player, page));
}

