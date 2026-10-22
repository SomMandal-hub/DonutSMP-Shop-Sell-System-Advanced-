/**
 * admin.js  —  Admin check via Minecraft "admin" tag
 *
 * A player is an admin if they have the "admin" tag.
 *   Grant  : /tag <player> add admin
 *   Revoke : /tag <player> remove admin
 *
 * Usage:
 *   import { Admin } from "./admin.js";
 *
 *   Admin.isAdmin(player)       // boolean
 *   Admin.requireAdmin(player)  // sends error msg if not admin, returns bool
 *   Admin.list()                // Player[] — all online admins
 */

import { world } from "@minecraft/server";

const ADMIN_TAG = "admin";

function isAdmin(player) {
    try {
        return player?.hasTag(ADMIN_TAG) ?? false;
    } catch {
        return false;
    }
}

function requireAdmin(player) {
    if (isAdmin(player)) return true;
    player.sendMessage(
        `§c[Admin] §fYou do not have permission to use this command.\n` +
        `§7Requires the §e"admin" §7tag.`
    );
    return false;
}

function list() {
    return world.getPlayers({ tags: [ADMIN_TAG] });
}

export const Admin = { isAdmin, requireAdmin, list };