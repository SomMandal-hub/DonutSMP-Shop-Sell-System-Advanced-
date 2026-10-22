/**
 * enchanted_books.js
 *
 * enchantId = exact Bedrock scripting API ID (EnchantmentTypes.get(enchantId)).
 * Only multi-word or non-obvious names need it — single-word enchants
 * (sharpness, smite, looting …) resolve automatically from the display name.
 *
 * Bedrock API IDs verified against @minecraft/server EnchantmentTypes:
 *   https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/enchantmenttypes
 */

export const ENCHANTED_BOOKS = [
    // ── Sword ────────────────────────────────────────────────
    { name: 'Sharpness',             maxLevel: 5                                        },
    { name: 'Smite',                 maxLevel: 5                                        },
    { name: 'Bane of Arthropods',    maxLevel: 5,  enchantId: 'bane_of_arthropods'     },
    { name: 'Knockback',             maxLevel: 2                                        },
    { name: 'Fire Aspect',           maxLevel: 2,  enchantId: 'fire_aspect'            },
    { name: 'Looting',               maxLevel: 3                                        },
   // { name: 'Sweeping Edge',         maxLevel: 3,  enchantId: 'sweeping'               },
    // ── Tools ────────────────────────────────────────────────
    { name: 'Efficiency',            maxLevel: 5                                        },
    { name: 'Silk Touch',            maxLevel: 1,  enchantId: 'silk_touch'             },
    { name: 'Fortune',               maxLevel: 3                                        },
    // ── Bow ──────────────────────────────────────────────────
    { name: 'Power',                 maxLevel: 5                                        },
    { name: 'Punch',                 maxLevel: 2                                        },
    { name: 'Flame',                 maxLevel: 1                                        },
    { name: 'Infinity',              maxLevel: 1                                        },
    // ── Crossbow ─────────────────────────────────────────────
    { name: 'Multishot',             maxLevel: 1                                        },
    { name: 'Quick Charge',          maxLevel: 3,  enchantId: 'quick_charge'           },
    { name: 'Piercing',              maxLevel: 4                                        },
    // ── Trident ──────────────────────────────────────────────
    { name: 'Loyalty',               maxLevel: 3                                        },
    { name: 'Impaling',              maxLevel: 5                                        },
    { name: 'Riptide',               maxLevel: 3                                        },
    { name: 'Channeling',            maxLevel: 1                                        },
    // ── Armour ───────────────────────────────────────────────
    { name: 'Protection',            maxLevel: 4                                        },
    { name: 'Fire Protection',       maxLevel: 4,  enchantId: 'fire_protection'        },
    { name: 'Blast Protection',      maxLevel: 4,  enchantId: 'blast_protection'       },
    { name: 'Projectile Protection', maxLevel: 4,  enchantId: 'projectile_protection'  },
    { name: 'Feather Falling',       maxLevel: 4,  enchantId: 'feather_falling'        },
    { name: 'Thorns',                maxLevel: 3                                        },
    { name: 'Respiration',           maxLevel: 3                                        },
    { name: 'Aqua Affinity',         maxLevel: 1,  enchantId: 'aqua_affinity'          },
    { name: 'Depth Strider',         maxLevel: 3,  enchantId: 'depth_strider'          },
    { name: 'Frost Walker',          maxLevel: 2,  enchantId: 'frost_walker'           },
    { name: 'Soul Speed',            maxLevel: 3,  enchantId: 'soul_speed'             },
    { name: 'Swift Sneak',           maxLevel: 3,  enchantId: 'swift_sneak'            },
    // ── Mace (1.21) ──────────────────────────────────────────
    { name: 'Wind Burst',            maxLevel: 3,  enchantId: 'wind_burst'             },
    { name: 'Breach',                maxLevel: 4                                        },
    { name: 'Density',               maxLevel: 5                                        },
    // ── Universal ────────────────────────────────────────────
    { name: 'Mending',               maxLevel: 1                                        },
    { name: 'Unbreaking',            maxLevel: 3                                        },
    { name: 'Curse of Vanishing',    maxLevel: 1,  enchantId: 'vanishing_curse'        },
    { name: 'Curse of Binding',      maxLevel: 1,  enchantId: 'binding_curse'          },
    // ── Fishing rod ──────────────────────────────────────────
    { name: 'Luck of the Sea',       maxLevel: 3,  enchantId: 'luck_of_the_sea'        },
    { name: 'Lure',                  maxLevel: 3                                        },
].flatMap(({ name, maxLevel, enchantId }) =>
    Array.from({ length: maxLevel }, (_, i) => {
        const level      = i + 1
        const romanLevel = ['I','II','III','IV','V'][i] ?? String(level)
        const id         = 'minecraft:enchanted_book'
        const displayName = maxLevel === 1 ? name : `${name} ${romanLevel}`

        return {
            id,
            name:      displayName,
            texture:   id,
            path:      id,
            enchanted: true,
            level: level,
            // enchantId is the exact EnchantmentTypes key; falls back to
            // lower-cased display name in resolveEnchantType() if absent.
            enchantId: enchantId ?? name.toLowerCase(),
            desc: [`§7Enchantment Level: §e${romanLevel}`, `§7Type: §b${name}`],
        }
    })
)
