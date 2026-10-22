/**
 * admin_commands.js  —  Slash command registration for admin & pay
 *
 * ── ADMIN-ONLY COMMANDS (/ss:admin) ──────────────────────────
 *
 *   /ss:admin get    <player>          → Show player's balance
 *   /ss:admin set    <player> <amount> → Set balance exactly
 *   /ss:admin add    <player> <amount> → Add to balance
 *   /ss:admin remove <player> <amount> → Subtract from balance
 *
 * ── UNIVERSAL PAY COMMAND (/ss:pay) ──────────────────────────
 *
 *   /ss:pay <player> <amount>          → Pay another online player
 *   (disabled if Config.enablePayCommand = false, unless admin)
 *

 *
 * ── AMOUNT FORMAT ─────────────────────────────────────────────
 *   Supports §ak, m, b types && Do not enter numerical number
 *   e.g.  1k = 1,000  |  1.5m = 1,500,000  |  2b = 2,000,000,000
 *
 *   Plain integers (no suffix) are always rejected.
 */

import { world, system } from "@minecraft/server";
import { Money }         from "./money_system.js";
import { Admin }         from "./admin.js";
import { Config }        from "./config_store.js";

// ── Amount suffix multipliers ─────────────────────────────────
const MULTIPLIERS = { k: 1_000, m: 1_000_000, b: 1_000_000_000, t: 1_000_000_000_000 };

/**
 * Parse a suffixed price string into an integer coin amount.
 * Returns null if format is invalid or no suffix is present.
 */
function parseAmount(str) {
    if (!str) return null;
    const match = str.trim().toLowerCase().match(/^([\d.]+)([kmbt])$/);
    if (!match) return null;
    const num    = parseFloat(match[1]);
    const mult   = MULTIPLIERS[match[2]];
    if (isNaN(num) || num <= 0 || !mult) return null;
    const result = Math.floor(num * mult);
    if (!isFinite(result) || result <= 0) return null;
    return result;
}

// money_system stores cents internally; multiply coins × 100
function _toCents(coins) { return coins * 100; }
function _fmt(coins)     { return Money.format(_toCents(coins)); }

const AMOUNT_DESC = "Do not enter numerical number & Supports §lk, m, b types";

// ── Entry point ───────────────────────────────────────────────

export function registerAdminCommands(event) {
    const reg = event.customCommandRegistry;

    _tryRegEnum(reg, "ss:admin.action", ["get", "set", "add", "remove"]);

    // ─────────────────────────────────────────────────────────
    //  /ss:admin <action> <player> [amount]
    // ─────────────────────────────────────────────────────────
    _tryRegCmd(reg, {
        name: "ss:admin",
        description: `Admin balance control  |  /ss:admin <get|set|add|remove> <player> [amount]  |  ${AMOUNT_DESC}`,
        permissionLevel: 0,
        cheatsRequired: true,
        mandatoryParameters: [
            { name: "action", type: "Enum", enumName: "ss:admin.action" },
            { name: "player", type: "String" },
        ],
        optionalParameters: [
            { name: "amount", type: "String" },
        ],
    }, (ctx, ...rawArgs) => {
        const sender = _player(ctx);
        if (!sender) return;
        if (!Admin.requireAdmin(sender)) return;

        let action     = "";
        let targetName = "";
        let amountStr  = "";

        // --- SUPER ROBUST EXTRACTION ---
        const argsObj = rawArgs[0];
        if (rawArgs.length === 1 && typeof argsObj === "object" && argsObj !== null) {
            action     = _str(argsObj.action).toLowerCase();
            targetName = _str(argsObj.player);
            amountStr  = _str(argsObj.amount);

            // Fallback: search keys if main ones are empty
            if (!action || !targetName) {
                const vals = Object.values(argsObj).map(v => _str(v));
                if (!action && vals.some(v => ["get", "set", "add", "remove"].includes(v.toLowerCase()))) {
                    action = vals.find(v => ["get", "set", "add", "remove"].includes(v.toLowerCase())).toLowerCase();
                }
            }
        } else {
            action     = _str(rawArgs[0]).toLowerCase();
            targetName = _str(rawArgs[1]);
            amountStr  = _str(rawArgs[2]);
        }

        system.run(() => {
            const target = _findOnline(targetName);

            if (!targetName && action !== "get") return sender.sendMessage("§c[Admin] §fUsage: /ss:admin <action> <player> [amount]");

            switch (action) {

                case "get": {
                    if (target) {
                        sender.sendMessage(
                            `§6[Admin] §f${target.name}§7's balance: §a${Money.getFormatted(target)}`
                        );
                    } else {
                        if (!Money.knowsPlayer(targetName)) return sender.sendMessage(`§c[Admin] §fPlayer §e${targetName} §fhas never joined this world.`);
                        const raw = Money.getOffline(targetName);   // cents
                        sender.sendMessage(
                            `§6[Admin] §7(offline) §f${targetName}§7's balance: §a${Money.format(raw)}`
                        );
                    }
                    return;
                }

                case "set": {
                    const coins = parseAmount(amountStr);
                    if (coins === null) return _badAmount(sender, amountStr);
                    if (target) {
                        Money.set(target, _toCents(coins));
                        sender.sendMessage(`§6[Admin] §fSet §e${target.name}§f's balance to §a${_fmt(coins)}§f.`);
                        target.sendMessage(`§6[Admin] §fYour balance was set to §a${_fmt(coins)}§f by an admin.`);
                    } else {
                        if (!Money.setOffline(targetName, _toCents(coins))) return sender.sendMessage(`§c[Admin] §fPlayer §e${targetName} §fhas never joined this world.`);
                        sender.sendMessage(`§6[Admin] §7(offline) §fSet §e${targetName}§f's balance to §a${_fmt(coins)}§f.`);
                    }
                    return;
                }

                case "add": {
                    const coins = parseAmount(amountStr);
                    if (coins === null) return _badAmount(sender, amountStr);
                    if (target) {
                        Money.add(target, _toCents(coins));
                        sender.sendMessage(`§6[Admin] §fAdded §a${_fmt(coins)} §fto §e${target.name}§f's balance.`);
                        target.sendMessage(`§6[Admin] §a${_fmt(coins)} §fwas added to your balance by an admin.`);
                    } else {
                        const cur = Money.getOffline(targetName);   // cents
                        if (!Money.setOffline(targetName, cur + _toCents(coins))) return sender.sendMessage(`§c[Admin] §fPlayer §e${targetName} §fhas never joined this world.`);
                        sender.sendMessage(`§6[Admin] §7(offline) §fAdded §a${_fmt(coins)} §fto §e${targetName}§f's balance.`);
                    }
                    return;
                }

                case "remove": {
                    const coins = parseAmount(amountStr);
                    if (coins === null) return _badAmount(sender, amountStr);
                    if (target) {
                        const ok = Money.remove(target, _toCents(coins));
                        if (!ok) return sender.sendMessage(`§c[Admin] §f${target.name} does not have enough balance.`);
                        sender.sendMessage(`§6[Admin] §fRemoved §c${_fmt(coins)} §ffrom §e${target.name}§f's balance.`);
                        target.sendMessage(`§6[Admin] §c${_fmt(coins)} §fwas removed from your balance by an admin.`);
                    } else {
                        const cur = Money.getOffline(targetName);   // cents
                        if (!Money.knowsPlayer(targetName)) return sender.sendMessage(`§c[Admin] §fPlayer §e${targetName} §fhas never joined this world.`);
                        if (cur < _toCents(coins)) return sender.sendMessage(`§c[Admin] §7(offline) §f${targetName} does not have enough balance.`);
                        Money.setOffline(targetName, cur - _toCents(coins));
                        sender.sendMessage(`§6[Admin] §7(offline) §fRemoved §c${_fmt(coins)} §ffrom §e${targetName}§f's balance.`);
                    }
                    return;
                }
            }
        });
    });

    // ─────────────────────────────────────────────────────────
    //  /ss:pay <player> <amount>
    // ─────────────────────────────────────────────────────────
    _tryRegCmd(reg, {
        name: "ss:pay",
        description: `Pay another player  |  /ss:pay <player> <amount>  |  ${AMOUNT_DESC}`,
        permissionLevel: 0,
        cheatsRequired: false,
        mandatoryParameters: [
            { name: "player", type: "String" }, //we can add PlayerSelector Instead of string .
            { name: "amount", type: "String" },
        ],
    }, (ctx, ...rawArgs) => {
        const sender = _player(ctx);
        if (!sender) return;

        system.run(() => {
            if (!Config.get("enablePayCommand") && !Admin.isAdmin(sender)) {
                return sender.sendMessage(`§c[Pay] §fThe pay command is currently disabled.`);
            }

            let targetName = "";
            let amountStr  = "";

            if (rawArgs.length === 1 && typeof rawArgs[0] === "object" && rawArgs[0] !== null) {
                const argsObj = rawArgs[0];
                targetName = _str(argsObj.player);
                amountStr  = _str(argsObj.amount);
            } else {
                targetName = _str(rawArgs[0]);
                amountStr  = _str(rawArgs[1]);
            }

            if (targetName.toLowerCase() === sender.name.toLowerCase()) {
                return sender.sendMessage(`§c[Pay] §fYou cannot pay yourself.`);
            }

            const coins = parseAmount(amountStr);
            if (coins === null) return _badAmount(sender, amountStr);

            const target = _findOnline(targetName);
            if (!target) {
                return sender.sendMessage(
                    `§c[Pay] §fPlayer §e${targetName} §fis not online.\n§7Offline payments are not supported.`
                );
            }

            const ok = Money.transfer(sender, target, _toCents(coins));
            if (!ok) {
                return sender.sendMessage(
                    `§c[Pay] §fInsufficient balance.\n§7Your balance: §a${Money.getFormatted(sender)}`
                );
            }

            sender.sendMessage(`§a[Pay] §fYou paid §e${target.name} §a${_fmt(coins)}§f.`);
            target.sendMessage(`§a[Pay] §fYou received §a${_fmt(coins)} §ffrom §e${sender.name}§f.`);
        });
    });
}

// ── Utilities ─────────────────────────────────────────────────

function _str(arg) {
    if (typeof arg === "string") return arg.trim();
    return String(arg?.value ?? arg?.id ?? arg ?? "").trim();
}

function _player(ctx) {
    const p = ctx.initiator ?? ctx.sourceEntity ?? ctx.sender;
    return p?.typeId === "minecraft:player" ? p : null;
}

function _findOnline(name) {
    return [...world.getPlayers()].find(
        p => p.name.toLowerCase() === name.toLowerCase()
    ) ?? null;
}

function _badAmount(sender, raw) {
    sender.sendMessage([
        `§c[Admin] §fInvalid amount: §e${raw || "(empty)"}`,
        `§7Supports §ak, m, b types §7&& Do not enter numerical number`,
        `§8e.g.  §e1k §8| §e1.5m §8| §e2b §8| §e3t`,
    ].join("\n"));
}

function _tryRegCmd(reg, schema, handler) {
    try {
        reg.registerCommand(schema, handler);
        console.warn(`[AdminCmd] Registered: /${schema.name}`);
    } catch (err) {
        const msg = err?.message ?? String(err);
        if (!msg.includes("reload") && !msg.includes("already"))
            console.warn(`[AdminCmd] Failed: /${schema.name}: ${msg}`);
    }
}

function _tryRegEnum(reg, id, values) {
    try {
        reg.registerEnum(id, values);
    } catch (err) {
        const msg = err?.message ?? String(err);
        if (!msg.includes("reload") && !msg.includes("already"))
            console.warn(`[AdminCmd] Enum failed ${id}: ${msg}`);
    }
}