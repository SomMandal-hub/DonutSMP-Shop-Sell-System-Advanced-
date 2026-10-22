// index.js -- Shop & Sell System: main entry point
//
// Commands (namespace "ss"):
//   /ss:shop            open the shop
//   /ss:sell            open the sell chest
//   /ss:config [money|shop|sell|vip]   Config Hub (admin tag)
//   /ss:admin <get|set|add|remove> <player> [amount]
//   /ss:pay <player> <amount>
//   /ss:reload_shop     reload the shop preset (admin)

import { system } from "@minecraft/server";
import { registerSellCommand }   from "./Modules/sell_system.js";
import { registerShopCommand }   from "./Modules/shop.js";
import { registerAdminCommands } from "./economy/admin_commands.js";
import { registerConfigCommands } from "./config_cmds.js";

system.beforeEvents.startup.subscribe((event) => {
    registerSellCommand(event);
    registerShopCommand(event);
    registerAdminCommands(event);
    registerConfigCommands(event);
});
