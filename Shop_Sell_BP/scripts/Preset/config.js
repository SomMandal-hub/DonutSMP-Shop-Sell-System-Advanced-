/**
 * =============================================================
 *  config.js  —  SERVER OWNER CONFIGURATION
 *  ⚠️  This file is intentionally NOT obfuscated.
 *      Edit the values below to configure your server
 *      Do NOT rename or move this file.
 * =============================================================
 *
 *.                         🫂 Usages=>> 
 *        ⚠️ If You Don't Know How To Edit Read Below 👇 
 * Or You Can Use /config_money -> To Edit Values From Inside Of Minecraft 👍
 *
 *
 *  keepOfflineNames   {boolean}
 *      false (default) — Players are removed from the scoreboard
 *                        when they disconnect. Prevents the Bedrock
 *                        "commands" display-name bug. Recommended.
 *      true            — Offline players stay on the scoreboard.
 *                        May show "commands" on fresh world load.
 *
 *  showLeaderboard    {boolean}
 *      true  (default) — Show the Top Rich List sidebar.
 *      false           — Hide it completely.
 *
 *  lbRefreshTicks     {number}   range: 20 – 1200
 *      How often the leaderboard rebuilds, in ticks.
 *      20 ticks = 1 second.   Default: 200  (10 seconds)
 *
 *  lbTopCount         {number}   range: 1 – 10
 *      How many players appear on the Top Rich List.
 *      Default: 5
 *
 *  currencySymbol     {string}
 *      "$"   (default) — The prefix currency symbol displayed in menus.
 *
 *  showDecimals       {boolean}
 *      false (default) — Hide decimals for whole numbers.
 *      true            — Show .00 cents in formatting.
 *
 *  leaderboardTitle   {string}
 *      "§6§l─── Top Rich List ───" (default) — Title displayed above the sidebar LB.
 *
 *  maxBalance         {number}
 *      9999900000000 (default) — Maximum allowed player balance in cents ($999.99B).
 *
 *  startupBalance     {number}
 *      0 (default) — Starting money coins for new players on first join.
 *
 *  enablePayCommand   {boolean}
 *      true  (default) — All players can use /ss:pay.
 *      false           — /ss:pay is disabled (admins are unaffected).
 *
 * =============================================================
 */

export const CONFIG_DEFAULTS = {

    // ── Money / Economy ───────────────────────────────────────
    currencySymbol:     "$",
    showDecimals:       false,
    leaderboardTitle:   "§6§l--Top Rich List--",
    maxBalance:         99_999_000_000_00,
    startupBalance:     0,
    keepOfflineNames:   false,
    showLeaderboard:    true,
    lbRefreshTicks:     200,
    lbTopCount:         5,
    enablePayCommand:   true,

    // ── VIP Penalty ───────────────────────────────────────────
    enableVipPenalty: true,

    penaltyProfiles: [
        ["hacker",  { sell: 10, buy: 5 }],  // 1st: harshest
        ["sus",     { sell: 6,  buy: 3 }],  // 2nd: medium
        ["vip",     { sell: 4,  buy: 1 }],  // 3rd: default vip
    ],

    penaltyExemptCategories: ["ADMIN"],     // "FORVIP" and "FREE" are always exempt
};