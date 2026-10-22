/**
 * config_hub.js  —  Shared CONFIG HUB  (same file in Auction / Shop & Sell / Order)
 *
 *   /ah:config      /ss:config      /od:config
 *       └── all open the same main screen (the "money" config UI):
 *
 *           ┌ Economy Settings   (shared wallet settings — every addon has it)
 *           ├ this addon's own panels      (registered with initHub)
 *           └ panels of the OTHER installed addons (found automatically)
 *
 * HOW THE ADDONS TALK TO EACH OTHER
 *   Addons cannot import each other's code, so they use script events:
 *     hub:ping  { from, player }              "who is installed?"
 *     hub:pong  { to, ns, addon, panels }     every other addon answers
 *     hub:open  { ns, id, player }            "open your panel <id> for <player>"
 *   Install one addon, two, or all three — the hub shows whatever is present.
 *
 * ADDING A PANEL  (in the addon's index.js)
 *   initHub({ ns: "xx", addon: "My Addon", panels: [
 *       { id: "main", label: "My Settings", icon: "minecraft:chest",
 *         desc: ["§7What it does"], open: (player) => showMySettings(player) },
 *   ]});
 *   …and give that panel's screen a Back button that calls openHub(player).
 *
 * COMMAND
 *   /<ns>:config [section]      no section → the hub.   section = money | <panel id>
 */

import { world, system, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { ModalFormData, FormCancelationReason } from "@minecraft/server-ui";
import ChestFormData       from "../Modules/forms.js";
import { Admin }           from "./admin.js";
import { Config }          from "./config_store.js";
import { CONFIG_DEFAULTS } from "../Preset/config.js";
import {
    restartLeaderboardInterval, purgeOfflineFromCache,
    restoreOfflineToCache, Money,
} from "./money_system.js";

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
    INFO:    "minecraft:paper",
};

// ─────────────────────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────────────────────

let CFG = { ns: "", addon: "", panels: [] };
const collectors = new Map();          // playerName -> Map<key, remotePanel>
const DISCOVERY_TICKS = 5;

// ─────────────────────────────────────────────────────────────
//  Setup  (call once from index.js inside the startup event)
// ─────────────────────────────────────────────────────────────

export function initHub({ ns, addon, panels = [] }) {
    CFG = { ns, addon, panels };
    // afterEvents are not available during early execution -> subscribe next tick.
    system.run(() => {
        try {
            system.afterEvents.scriptEventReceive.subscribe(_onScriptEvent, { namespaces: ["hub"] });
        } catch (e) {
            console.warn(`[ConfigHub] Could not listen for script events: ${e?.message ?? e}`);
        }
    });
}

function _send(id, payload) {
    const msg = JSON.stringify(payload);
    try {
        if (typeof system.sendScriptEvent === "function") return system.sendScriptEvent(id, msg);
    } catch {}
    try { world.getDimension("overworld").runCommand(`scriptevent ${id} ${msg}`); }
    catch (e) { console.warn(`[ConfigHub] scriptevent failed: ${e?.message ?? e}`); }
}

function _onScriptEvent(ev) {
    let data;
    try { data = JSON.parse(ev.message); } catch { return; }
    if (!data) return;

    // Someone opened their hub and wants to know who is installed.
    if (ev.id === "hub:ping") {
        if (data.from === CFG.ns) return;
        _send("hub:pong", {
            to: data.player, ns: CFG.ns, addon: CFG.addon,
            panels: CFG.panels.map(p => ({ id: p.id, label: p.label, icon: p.icon, desc: p.desc ?? [] })),
        });
        return;
    }

    // Answer to our ping.
    if (ev.id === "hub:pong") {
        const found = collectors.get(data.to);
        if (!found || data.ns === CFG.ns) return;
        found.addons.add(data.addon);          // listed even if it has no panels
        for (const p of data.panels ?? []) {
            found.panels.set(`${data.ns}/${p.id}`, { ...p, ns: data.ns, addon: data.addon });
        }
        return;
    }

    // Another addon's hub asked us to open one of OUR panels.
    if (ev.id === "hub:open") {
        if (data.ns !== CFG.ns) return;
        const player = world.getPlayers().find(p => p.name === data.player);
        const panel  = CFG.panels.find(p => p.id === data.id);
        if (!player || !panel) return;
        if (!Admin.requireAdmin(player)) return;
        system.run(() => panel.open(player));
    }
}

// ─────────────────────────────────────────────────────────────
//  Command:  /<ns>:config [section]
// ─────────────────────────────────────────────────────────────

export function registerConfigCommand(event) {
    const reg      = event.customCommandRegistry;
    const ns       = CFG.ns;
    const sections = ["money", ...CFG.panels.map(p => p.id)];
    const enumName = `${ns}:config.section`;

    try { reg.registerEnum(enumName, sections); }
    catch (err) { _ignoreReload(err, `enum ${enumName}`); }

    try {
        reg.registerCommand({
            name: `${ns}:config`,
            description: `Open the Config Hub  |  /${ns}:config  [${sections.join("|")}]`,
            permissionLevel: CommandPermissionLevel.Any,     // admin tag checked below
            cheatsRequired: false,
            optionalParameters: [
                { name: "section", type: CustomCommandParamType.Enum, enumName },
            ],
        }, (ctx, ...rawArgs) => {
            const p = ctx.initiator ?? ctx.sourceEntity ?? ctx.sender;
            if (p?.typeId !== "minecraft:player") return;
            if (!Admin.requireAdmin(p)) return;

            const a0 = rawArgs[0];
            const section = String(
                (a0 && typeof a0 === "object") ? (a0.section?.value ?? a0.section ?? "") : (a0 ?? "")
            ).toLowerCase().trim();

            system.run(() => {
                if (!section || section === "hub") return openHub(p);
                if (section === "money")           return showEconomyConfig(p);
                const panel = CFG.panels.find(x => x.id === section);
                if (panel) return panel.open(p);
                p.sendMessage(`§c[Config] §fUnknown section §e${section}§f. §7Valid: §f${sections.join("§7, §f")}`);
            });
        });
        console.warn(`[ConfigHub] Registered: /${ns}:config`);
    } catch (err) { _ignoreReload(err, `/${ns}:config`); }
}

function _ignoreReload(err, what) {
    const msg = err?.message ?? String(err);
    if (!msg.includes("reload") && !msg.includes("already"))
        console.warn(`[ConfigHub] Failed ${what}: ${msg}`);
}

// ─────────────────────────────────────────────────────────────
//  MAIN SCREEN (hub)
// ─────────────────────────────────────────────────────────────

/** Open the hub: first ask the other addons what they offer, then draw. */
export function openHub(player) {
    const found = { panels: new Map(), addons: new Set() };
    collectors.set(player.name, found);
    _send("hub:ping", { from: CFG.ns, player: player.name });
    system.runTimeout(() => {
        collectors.delete(player.name);
        showHub(player, [...found.panels.values()], [...found.addons]);
    }, DISCOVERY_TICKS);
}

async function showHub(player, remote, remoteAddons = []) {
    const entries = [
        { kind: "economy" },
        ...CFG.panels.map(p => ({ kind: "local", panel: p })),
        ...remote.sort((a, b) => (a.ns + a.id).localeCompare(b.ns + b.id)).map(p => ({ kind: "remote", panel: p })),
    ];

    const big   = entries.length > 7;
    const size  = big ? "54" : "27";
    const close = big ? 53 : 26;
    const slots = big
        ? [10,11,12,13,14,15,16, 19,20,21,22,23,24,25, 28,29,30,31,32,33,34, 37,38,39,40,41,42,43]
        : [10,11,12,13,14,15,16];

    const form = new ChestFormData(size, "§6§lServer Config §8— Hub");
    for (let i = 0; i < Number(size); i++) form.button(i, "§8", null, TEX.BORDER);

    const slotMap = new Map();
    entries.slice(0, slots.length).forEach((e, i) => {
        const slot = slots[i];
        slotMap.set(slot, e);
        if (e.kind === "economy") {
            form.button(slot, "§e§lEconomy Settings",
                ["§7Currency, leaderboard, start balance", "§8Shared by every addon", "", "§b> Click to open"], TEX.ECONOMY);
        } else {
            const p = e.panel;
            const lore = [...(p.desc ?? [])];
            if (e.kind === "remote") lore.push("", `§8From: ${e.panel.addon}`);
            lore.push("", "§b> Click to open");
            form.button(slot, `§b§l${p.label}`, lore, p.icon ?? TEX.BOOK);
        }
    });

    const addons = [CFG.addon, ...remoteAddons];
    form.button(big ? 49 : 22, "§f§lInstalled Addons", addons.map(a => `§7- §f${a}`), TEX.INFO);
    form.button(close, "§c§lClose", ["§7Exit configuration"], TEX.CLOSE);

    const res = await forceShow(player, form);
    if (res.canceled) return;

    const sel = res.selection;
    if (sel === close) return;

    const e = slotMap.get(sel);
    if (!e) return system.run(() => showHub(player, remote, remoteAddons));   // border click

    if (e.kind === "economy") return showEconomyConfig(player);
    if (e.kind === "local")   return e.panel.open(player);
    _send("hub:open", { ns: e.panel.ns, id: e.panel.id, player: player.name });
}

// ─────────────────────────────────────────────────────────────
//  ECONOMY PANEL
// ─────────────────────────────────────────────────────────────

const ECONOMY_SETTINGS = () => [
    { key: "keepOfflineNames", slot: 10, type: "toggle", label: "Offline Names",     desc: ["Show offline players on LB"] },
    { key: "showLeaderboard",  slot: 11, type: "toggle", label: "Show Leaderboard",  desc: ["Toggle sidebar visibility"] },
    { key: "showDecimals",     slot: 12, type: "toggle", label: "Show Decimals",     desc: ["Show .00 in formatting"] },
    { key: "enablePayCommand", slot: 13, type: "toggle", label: "Pay Command",       desc: [`Allow players to use /${CFG.ns}:pay`] },
    { key: "currencySymbol",   slot: 14, type: "string", label: "Currency Symbol",   desc: [] },
    { key: "leaderboardTitle", slot: 15, type: "string", label: "LB Title",          desc: [] },
    { key: "startupBalance",   slot: 16, type: "number", label: "Startup Balance",   desc: [], min: 0, max: 1000000 },
    { key: "lbRefreshTicks",   slot: 21, type: "number", label: "LB Refresh rate",   desc: ["Ticks (20 = 1 second)"], min: 20, max: 1200 },
    { key: "lbTopCount",       slot: 23, type: "number", label: "LB Top Count",      desc: ["Players shown on the sidebar"], min: 1, max: 10 },
];

export async function showEconomyConfig(player) {
    const settings = ECONOMY_SETTINGS();
    const form = new ChestFormData("27", "§6§lConfig §8> §eEconomy");
    for (let i = 0; i < 27; i++) form.button(i, "§8", null, TEX.BORDER);

    _renderSettings(form, settings);
    form.button(18, "§c§lBack", ["§7Return to the hub"], TEX.BACK);
    form.button(26, "§4§lReset Category", ["§7Revert these settings to defaults"], TEX.RESET);

    const res = await forceShow(player, form);
    if (res.canceled) return;

    if (res.selection === 18) return openHub(player);
    if (res.selection === 26) {
        await _confirmReset(player, settings);
        return showEconomyConfig(player);
    }
    await _handleInteraction(player, res.selection, settings, showEconomyConfig);
}

function _renderSettings(form, settings) {
    for (const s of settings) {
        const val = Config.get(s.key);
        if (s.type === "toggle") {
            const flag = val ? "§a§lON  §r§f" : "§c§lOFF §r§f";
            form.button(s.slot, `${flag}${s.label}`, s.desc, val ? TEX.ON : TEX.OFF);
        } else if (s.type === "number") {
            form.button(s.slot, `§e§l${s.label}`, [...s.desc, `§7Current: §a${val}`], TEX.BOOK);
        } else {
            form.button(s.slot, `§b§l${s.label}`, [...s.desc, `§7Current: §r${val}`], TEX.STRING);
        }
    }
}

function _refreshWallet() {
    restartLeaderboardInterval();
    Money.refreshLeaderboard();
}

async function _handleInteraction(player, slot, settings, reopen) {
    const s = settings.find(x => x.slot === slot);
    if (!s) return system.run(() => reopen(player));          // border click

    if (s.type === "toggle") {
        const v = Config.toggle(s.key);
        player.sendMessage(`§6[Config] §f${s.label} → ${v ? "§aON" : "§cOFF"}`);
        if (s.key === "keepOfflineNames") { v ? restoreOfflineToCache() : purgeOfflineFromCache(); restartLeaderboardInterval(); }
        else if (s.key === "showLeaderboard") _refreshWallet();
    } else {
        await new Promise(r => system.runTimeout(r, 1));
        if (s.type === "number") await _promptNumber(player, s);
        else                     await _promptString(player, s);
    }
    system.run(() => reopen(player));
}

async function _confirmReset(player, settings) {
    const res = await forceShow(player, new ModalFormData()
        .title("§c§lReset Category?")
        .toggle("§7I understand this reverts these settings to defaults.", { defaultValue: false }));
    if (res.canceled || !res.formValues[0]) return player.sendMessage("§7[Config] Reset cancelled.");

    for (const s of settings) Config.reset(s.key);
    _refreshWallet();
    player.sendMessage("§6[Config] §aEconomy settings reset to defaults.");
}

async function _promptNumber(player, def) {
    const cur = Config.get(def.key);
    const res = await forceShow(player, new ModalFormData()
        .title(`§6Edit: ${def.label}`)
        .textField(`Value (${def.min}–${def.max}) | Default: ${CONFIG_DEFAULTS[def.key]}`, String(cur), { defaultValue: String(cur) }));
    if (res.canceled) return;

    const num = parseInt(res.formValues[0], 10);
    if (isNaN(num) || num < def.min || num > def.max)
        return player.sendMessage(`§c[Config] §fInvalid value. Must be between ${def.min} and ${def.max}.`);

    Config.set(def.key, num);
    player.sendMessage(`§6[Config] §f${def.label} set to §a${num}§f.`);
    if (def.key === "lbRefreshTicks") restartLeaderboardInterval();
    if (def.key === "lbRefreshTicks" || def.key === "lbTopCount") Money.refreshLeaderboard();
}

async function _promptString(player, def) {
    const cur = Config.get(def.key);
    const res = await forceShow(player, new ModalFormData()
        .title(`§6Edit: ${def.label}`)
        .textField(`Enter new text | Default: ${CONFIG_DEFAULTS[def.key]}`, String(cur), { defaultValue: String(cur) }));
    if (res.canceled) return;

    const val = (res.formValues[0] ?? "").trim();
    if (!val) return;
    Config.set(def.key, val);
    player.sendMessage(`§6[Config] §f${def.label} updated.`);
    if (def.key === "leaderboardTitle") Money.refreshLeaderboard();
}

// ─────────────────────────────────────────────────────────────
//  Retry while chat is still open (Bedrock cancels forms with UserBusy)
// ─────────────────────────────────────────────────────────────

async function forceShow(player, form, timeout = 600) {
    const start = system.currentTick;
    while (system.currentTick - start < timeout) {
        const res = await form.show(player);
        if (res.cancelationReason !== FormCancelationReason.UserBusy) return res;
    }
    return { canceled: true };
}
