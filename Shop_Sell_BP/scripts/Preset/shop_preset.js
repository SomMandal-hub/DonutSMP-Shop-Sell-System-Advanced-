// scripts/Preset/shop_preset.js
//
// Format of each key:  "CategoryName|iconTypeId|slotIndex"
//   • slotIndex : 9–17  (which tab slot in the 54-slot UI)
//
// For the "Enchanted Book" category the items listed here act as
// BASE PRICE references only.  The actual book entries are generated
// automatically from enchanted_books.js on every world boot.
// You can either:
//   (a) list one entry per enchant name with the LEVEL-1 price — the
//       system multiplies it by the actual level automatically, or
//   (b) omit entries entirely and let the fallback (100 × level) apply.

export const ShopPreset = {

  // ── Slot 9  ─  Spawners ───────────────────────────────────
  "Spawners|minecraft:mob_spawner|9": [
    // Contents managed separately (spawner give commands)
  ],

  // ── Slot 11 ─  End ────────────────────────────────────────
  "End|minecraft:end_stone|11": [
    { price: 2500,  item: "minecraft:ender_chest"        },
    { price: 75,    item: "minecraft:ender_pearl"        },
    { price: 8,     item: "minecraft:end_stone"          },
    { price: 1000,  item: "minecraft:dragon_breath"      },
    { price: 100,   item: "minecraft:end_rod"            },
    { price: 25,    item: "minecraft:chorus_fruit"       },
    { price: 15,    item: "minecraft:popped_chorus_fruit"},
    { price: 350,   item: "minecraft:shulker_shell"      },
    { price: 800,   item: "minecraft:undyed_shulker_box" },
  ],

  // ── Slot 12 ─  Nether ─────────────────────────────────────
  "Nether|minecraft:netherrack|12": [
    { price: 150,   item: "minecraft:blaze_rod"          },
    { price: 25,    item: "minecraft:nether_wart"        },
    { price: 15,    item: "minecraft:glowstone_dust"     },
    { price: 25,    item: "minecraft:magma_cream"        },
    { price: 350,   item: "minecraft:ghast_tear"         },
    { price: 15,    item: "minecraft:quartz"             },
    { price: 50,    item: "minecraft:soul_sand"          },
    { price: 35,    item: "minecraft:magma"              },
    { price: 150,   item: "minecraft:crying_obsidian"    },
  ],

  // ── Slot 13 ─  Gear ───────────────────────────────────────
  "Gear|minecraft:totem_of_undying|13": [
    { price: 100,   item: "minecraft:obsidian"           },
    { price: 350,   item: "minecraft:end_crystal"        },
    { price: 1000,  item: "minecraft:respawn_anchor"     },
    { price: 100,   item: "minecraft:glowstone"          },
    { price: 1250,  item: "minecraft:totem_of_undying"   },
    { price: 75,    item: "minecraft:ender_pearl"        },
    { price: 250,   item: "minecraft:golden_apple"       },
    { price: 100,   item: "minecraft:experience_bottle"  },
  ],

  // ── Slot 14 ─  Food ───────────────────────────────────────
  "Food|minecraft:cooked_beef|14": [
    { price: 75,    item: "minecraft:potato"             },
    { price: 50,    item: "minecraft:sweet_berries"      },
    { price: 10,    item: "minecraft:melon_slice"        },
    { price: 65,    item: "minecraft:carrot"             },
    { price: 25,    item: "minecraft:apple"              },
    { price: 30,    item: "minecraft:cooked_chicken"     },
    { price: 35,    item: "minecraft:cooked_beef"        },
    { price: 50,    item: "minecraft:golden_carrot"      },
    { price: 250,   item: "minecraft:golden_apple"       },
  ],

  // ── Slot 16  ─  Enchanted Book category ──────────────────

  "Enchanted Book|minecraft:enchanted_book|16": [
    // ── Sword ─────────────────────────────────────────────
    { displayname: "Sharpness",              price: 500,    item: "minecraft:enchanted_book" },
    { displayname: "Smite",                  price: 250,    item: "minecraft:enchanted_book" },
    { displayname: "Bane of Arthropods",     price: 200,    item: "minecraft:enchanted_book" },
    { displayname: "Knockback",              price: 420,    item: "minecraft:enchanted_book" },
    { displayname: "Fire Aspect",            price: 480,    item: "minecraft:enchanted_book" },
    { displayname: "Looting",               price: 600,    item: "minecraft:enchanted_book" },
   // { displayname: "Sweeping Edge",          price: 200,    item: "minecraft:enchanted_book" },
    // ── Tools ─────────────────────────────────────────────
    { displayname: "Efficiency",             price: 700,    item: "minecraft:enchanted_book" },
    { displayname: "Silk Touch",             price: 1500,    item: "minecraft:enchanted_book" },
    { displayname: "Fortune",               price: 800,    item: "minecraft:enchanted_book" },
    // ── Bow ───────────────────────────────────────────────
    { displayname: "Power",                  price: 600,    item: "minecraft:enchanted_book" },
    { displayname: "Punch",                  price: 750,    item: "minecraft:enchanted_book" },
    { displayname: "Flame",                  price: 1000,    item: "minecraft:enchanted_book" },
    { displayname: "Infinity",               price: 1000,   item: "minecraft:enchanted_book" },
    // ── Crossbow ──────────────────────────────────────────
    { displayname: "Multishot",              price: 600,    item: "minecraft:enchanted_book" },
    { displayname: "Quick Charge",           price: 600,    item: "minecraft:enchanted_book" },
    { displayname: "Piercing",              price: 550,    item: "minecraft:enchanted_book" },
    // ── Trident ───────────────────────────────────────────
    { displayname: "Loyalty",               price: 600,    item: "minecraft:enchanted_book" },
    { displayname: "Impaling",              price: 600,    item: "minecraft:enchanted_book" },
    { displayname: "Riptide",               price: 800,    item: "minecraft:enchanted_book" },
    { displayname: "Channeling",             price: 1500,    item: "minecraft:enchanted_book" },
    // ── Armour ────────────────────────────────────────────
    { displayname: "Protection",             price: 750,    item: "minecraft:enchanted_book" },
    { displayname: "Fire Protection",        price: 380,    item: "minecraft:enchanted_book" },
    { displayname: "Blast Protection",       price: 280,    item: "minecraft:enchanted_book" },
    { displayname: "Projectile Protection",  price: 280,    item: "minecraft:enchanted_book" },
    { displayname: "Feather Falling",        price: 550,    item: "minecraft:enchanted_book" },
    { displayname: "Thorns",                price: 750,    item: "minecraft:enchanted_book" },
    { displayname: "Respiration",            price: 450,    item: "minecraft:enchanted_book" },
    { displayname: "Aqua Affinity",          price: 800,    item: "minecraft:enchanted_book" },
    { displayname: "Depth Strider",          price: 600,    item: "minecraft:enchanted_book" },
    { displayname: "Frost Walker",           price: 550,    item: "minecraft:enchanted_book" },
    { displayname: "Soul Speed",             price: 600,    item: "minecraft:enchanted_book" },
    { displayname: "Swift Sneak",            price: 800,    item: "minecraft:enchanted_book" },
    // ── Mace (1.21) ───────────────────────────────────────
    { displayname: "Wind Burst",             price: 6000,    item: "minecraft:enchanted_book" },
    { displayname: "Breach",                price: 3500,    item: "minecraft:enchanted_book" },
    { displayname: "Density",               price: 4500,    item: "minecraft:enchanted_book" },
    // ── Universal ─────────────────────────────────────────
    { displayname: "Mending",               price: 3500,   item: "minecraft:enchanted_book" },
    { displayname: "Unbreaking",             price: 1500,   item: "minecraft:enchanted_book" },
    { displayname: "Curse of Vanishing",     price: 2000,     item: "minecraft:enchanted_book" },
    { displayname: "Curse of Binding",       price: 100,     item: "minecraft:enchanted_book" },
    // ── Fishing rod ───────────────────────────────────────
    { displayname: "Luck of the Sea",        price: 450,    item: "minecraft:enchanted_book" },
    { displayname: "Lure",                   price: 400,    item: "minecraft:enchanted_book" },
  ],

}
