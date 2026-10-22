/**
 * config_cmds.js  —  /ss:config
 *
 *   /ss:config            → Config Hub (the main "money" config screen)
 *   /ss:config money      → Economy settings directly
 *   /ss:config shop       → Shop config directly
 *   /ss:config sell       → Sell prices config directly
 *   /ss:config vip        → VIP & Security directly
 *   (admin tag required)
 *
 * The hub itself (and the cross-addon discovery) lives in economy/config_hub.js.
 */

import { initHub, registerConfigCommand } from "./economy/config_hub.js";
import { showShopConfigUI } from "./economy/shop_config_ui.js";
import { showSellConfigUI } from "./economy/sell_config_ui.js";
import { showVipConfig }    from "./economy/config_ui.js";

export function registerConfigCommands(event) {
    initHub({
        ns: "ss",
        addon: "Shop & Sell",
        panels: [
            { id: "shop", label: "Shop Settings", icon: "minecraft:chest",
              desc: ["§7Categories, items and prices", "§7of /ss:shop"], open: showShopConfigUI },
            { id: "sell", label: "Sell System", icon: "minecraft:hopper",
              desc: ["§7Sell prices of /ss:sell"], open: showSellConfigUI },
            { id: "vip", label: "VIP & Security", icon: "t/gui/newgui/mob_effects/resistance_effect",
              desc: ["§7Penalty tiers and the VIP switch"], open: (p) => showVipConfig(p) },
        ],
    });
    registerConfigCommand(event);
}
