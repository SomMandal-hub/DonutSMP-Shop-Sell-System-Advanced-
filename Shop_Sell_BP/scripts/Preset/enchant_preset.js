// ─────────────────────────────────────────────────────────────
//  ENCHANT_PRESET.JS
//
//  Enchantment bonus prices added ON TOP of the base item price.
//
//  Tier Formula (per level multiplier):
//    COMMON     – Small utility enchants       → $1  per level
//    UNCOMMON   – Solid combat/survival enchants → $3  per level
//    RARE       – High-impact enchants          → $8  per level
//    LEGENDARY  – Max-tier / top enchants       → $20 per level
//
//  Each enchant entry:
//    [lvl1, lvl2, lvl3, lvl4, lvl5]  (in dollars)
//  If the enchant has fewer max levels, just define up to that level.
//  Missing higher levels fall back to the last defined value.
//
//  Usage in sell_system.js:
//    import { EnchantPreset } from "../Preset/enchant_preset.js";
//
//  Structure:
//    EnchantPreset = Map<enchantmentTypeId, number[]>
//    enchantmentTypeId = e.g. "sharpness", "protection", "mending"
// ─────────────────────────────────────────────────────────────

// ── Tier base values ($ per level) ───────────────────────────
const T = {
    COMMON:    (lvls) => Array.from({ length: lvls }, (_, i) =>  1 * (i + 1)),
    UNCOMMON:  (lvls) => Array.from({ length: lvls }, (_, i) =>  3 * (i + 1)),
    RARE:      (lvls) => Array.from({ length: lvls }, (_, i) =>  8 * (i + 1)),
    LEGENDARY: (lvls) => Array.from({ length: lvls }, (_, i) => 20 * (i + 1)),
};

// ─────────────────────────────────────────────────────────────
//  ENCHANTMENT DEFINITIONS
//  Key  = Minecraft enchantment ID (no "minecraft:" prefix)
//  Value= price array [lvl1, lvl2, ...] in dollars
// ─────────────────────────────────────────────────────────────

export const EnchantPreset = new Map([

    // ══════════════════════════════════════════════════════════
    //  ⚔️  SWORD & AXE ENCHANTMENTS
    // ══════════════════════════════════════════════════════════

    // sharpness I–V         RARE     → $8, $16, $24, $32, $40
    ["sharpness",               T.RARE(5)],

    // smite I–V             UNCOMMON → $3, $6, $9, $12, $15
    ["smite",                   T.UNCOMMON(5)],

    // bane_of_arthropods I–V UNCOMMON → $3, $6, $9, $12, $15
    ["bane_of_arthropods",      T.UNCOMMON(5)],

    // knockback I–II        COMMON   → $1, $2
    ["knockback",               T.COMMON(2)],

    // fire_aspect I–II      UNCOMMON → $3, $6
    ["fire_aspect",             T.UNCOMMON(2)],

    // looting I–III         RARE     → $8, $16, $24
    ["looting",                 T.RARE(3)],

    // sweeping_edge I–III   UNCOMMON → $3, $6, $9
    //["sweeping",                T.UNCOMMON(3)],

    // ══════════════════════════════════════════════════════════
    //  🛡️  ARMOR ENCHANTMENTS
    // ══════════════════════════════════════════════════════════

    // protection I–IV       RARE     → $8, $16, $24, $32
    ["protection",              T.RARE(4)],

    // fire_protection I–IV  UNCOMMON → $3, $6, $9, $12
    ["fire_protection",         T.UNCOMMON(4)],

    // blast_protection I–IV UNCOMMON → $3, $6, $9, $12
    ["blast_protection",        T.UNCOMMON(4)],

    // projectile_protection I–IV UNCOMMON → $3, $6, $9, $12
    ["projectile_protection",   T.UNCOMMON(4)],

    // feather_falling I–IV  RARE     → $8, $16, $24, $32
    ["feather_falling",         T.RARE(4)],

    // respiration I–III     UNCOMMON → $3, $6, $9
    ["respiration",             T.UNCOMMON(3)],

    // aqua_affinity I       COMMON   → $1
    ["aqua_affinity",           T.COMMON(1)],

    // thorns I–III          RARE     → $8, $16, $24
    ["thorns",                  T.RARE(3)],

    // depth_strider I–III   UNCOMMON → $3, $6, $9
    ["depth_strider",           T.UNCOMMON(3)],

    // frost_walker I–II     UNCOMMON → $3, $6
    ["frost_walker",            T.UNCOMMON(2)],

    // soul_speed I–III      RARE     → $8, $16, $24
    ["soul_speed",              T.RARE(3)],

    // swift_sneak I–III     RARE     → $8, $16, $24
    ["swift_sneak",             T.RARE(3)],

    // ══════════════════════════════════════════════════════════
    //  ⛏️  TOOL ENCHANTMENTS (Pickaxe / Shovel / Hoe / Shears)
    // ══════════════════════════════════════════════════════════

    // efficiency I–V        UNCOMMON → $3, $6, $9, $12, $15
    ["efficiency",              T.UNCOMMON(5)],

    // silk_touch I          LEGENDARY→ $20
    ["silk_touch",              T.LEGENDARY(1)],

    // fortune I–III         LEGENDARY→ $20, $40, $60
    ["fortune",                 T.LEGENDARY(3)],

    // unbreaking I–III      UNCOMMON → $3, $6, $9
    ["unbreaking",              T.UNCOMMON(3)],

    // ══════════════════════════════════════════════════════════
    //  🏹  BOW & CROSSBOW ENCHANTMENTS
    // ══════════════════════════════════════════════════════════

    // power I–V             RARE     → $8, $16, $24, $32, $40
    ["power",                   T.RARE(5)],

    // punch I–II            COMMON   → $1, $2
    ["punch",                   T.COMMON(2)],

    // flame I               UNCOMMON → $3
    ["flame",                   T.UNCOMMON(1)],

    // infinity I            LEGENDARY→ $20
    ["infinity",                T.LEGENDARY(1)],

    // multishot I           RARE     → $8
    ["multishot",               T.RARE(1)],

    // quick_charge I–III    UNCOMMON → $3, $6, $9
    ["quick_charge",            T.UNCOMMON(3)],

    // piercing I–IV         UNCOMMON → $3, $6, $9, $12
    ["piercing",                T.UNCOMMON(4)],

    // ══════════════════════════════════════════════════════════
    //  ✨  UNIVERSAL / SPECIAL ENCHANTMENTS
    // ══════════════════════════════════════════════════════════

    // mending I             LEGENDARY→ $20
    ["mending",                 T.LEGENDARY(1)],

    // curse_of_vanishing I  COMMON   → $1  (low value — it's a curse)
    ["vanishing_curse",         T.COMMON(1)],

    // curse_of_binding I    COMMON   → $1  (low value — it's a curse)
    ["binding_curse",           T.COMMON(1)],

    // ══════════════════════════════════════════════════════════
    //  🎣  FISHING ROD ENCHANTMENTS
    // ══════════════════════════════════════════════════════════

    // luck_of_the_sea I–III RARE     → $8, $16, $24
    ["luck_of_the_sea",         T.RARE(3)],

    // lure I–III            UNCOMMON → $3, $6, $9
    ["lure",                    T.UNCOMMON(3)],

    // ══════════════════════════════════════════════════════════
    //  🗡️  TRIDENT ENCHANTMENTS
    // ══════════════════════════════════════════════════════════

    // loyalty I–III         UNCOMMON → $3, $6, $9
    ["loyalty",                 T.UNCOMMON(3)],

    // impaling I–V          RARE     → $8, $16, $24, $32, $40
    ["impaling",                T.RARE(5)],

    // riptide I–III         RARE     → $8, $16, $24
    ["riptide",                 T.RARE(3)],

    // channeling I          LEGENDARY→ $20
    ["channeling",              T.LEGENDARY(1)],

]);

// ─────────────────────────────────────────────────────────────
//  HELPER — getEnchantBonus(item)
//
//  Pass any ItemStack. Returns the total enchantment bonus in
//  CENTS (to match money_system.js) and a breakdown array for
//  the receipt.
//
//  breakdown entry:
//    { enchantId, level, bonusCents }
// ─────────────────────────────────────────────────────────────

export function getEnchantBonus(item) {
    let bonusCents = 0;
    const breakdown = [];

    try {
        // Regular enchanted items  → "minecraft:enchantable"
        // Enchanted books          → "minecraft:enchanted_book"
        // Try both — whichever returns a component wins.
        const enchComp =
            item.getComponent("minecraft:enchantable") ??
            item.getComponent("minecraft:enchanted_book");

        if (!enchComp) return { bonusCents, breakdown };

        const enchants = enchComp.getEnchantments();
        for (const ench of enchants) {
            // ench.type.id → e.g. "minecraft:sharpness"
            // Strip "minecraft:" prefix to match our preset keys
            const rawId    = ench.type?.id ?? "";
            const enchId   = rawId.replace("minecraft:", "");
            const level    = ench.level ?? 1;

            const priceArr = EnchantPreset.get(enchId);
            if (!priceArr) continue; // enchant not in preset — skip

            // Clamp level to highest defined index
            const idx      = Math.min(level, priceArr.length) - 1;
            const bonusUSD = priceArr[idx] ?? priceArr[priceArr.length - 1];
            const cents    = Math.round(bonusUSD * 100);

            bonusCents += cents;
            breakdown.push({ enchantId: enchId, level, bonusCents: cents });
        }
    } catch {}

    return { bonusCents, breakdown };
}
