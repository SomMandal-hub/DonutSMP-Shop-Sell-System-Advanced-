# Shop & Sell System (BP + RP)

Chest-UI **shop** and **sell** system for Minecraft Bedrock, with a built-in scoreboard economy.

## Commands (namespace `ss`)
| Command | Who | Purpose |
|---|---|---|
| `/ss:shop` | everyone | Open the shop |
| `/ss:sell` | everyone | Open the sell chest, drop items, tap the barrier to sell |
| `/ss:pay <player> <amount>` | everyone | Pay a player (`1k`, `2.5m`, `1b`) |
| `/ss:admin <get\|set\|add\|remove> <player> [amount]` | admin | Manage balances |
| `/ss:config` | admin | Config Hub: Economy, Shop, Sell, VIP (+ panels of any other installed addon). Optional jump: `/ss:config shop` |
| `/ss:reload_shop` | admin | Reload the shop preset |

Admin = players with the `admin` tag: `/tag <name> add admin`.

## Customising
Edit `scripts/Preset/`: `shop_preset.js`, `sell_prices.js`, `enchant_preset.js`, `config.js`.

## Install
1. Put both packs on your world (BP + RP). 2. Enable **Beta APIs**. 3. Give yourself the `admin` tag.

## Shared wallet
Balances live on the world scoreboard (`money_hi`, `money_lo`, `money_reg`, `money_cfg`), so this addon works alone **or together with the Order Market addon** in the same world with one shared wallet, currency and leaderboard.

## Notes
- Do not run this next to your old full pack: it has its own wallet and also defines `chest:temp_chest` / `qidb:storage`.
- Includes QIDB by Carchi77 (see `scripts/Modules/QIDB.js`).
