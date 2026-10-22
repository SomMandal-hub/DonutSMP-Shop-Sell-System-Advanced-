/*
optimized and fully production-ready for a high-traffic Bedrock server.
*/

import { world, system, ItemStack, ItemTypes, EnchantmentTypes, CommandPermissionLevel } from "@minecraft/server"
import { Money } from "../economy/money_system.js"
import { DB } from "./database.js"
import { metricNumbers } from "./Function.js"
import ChestFormData from "./forms.js"
import { VipPenalty } from "./vip_penalty.js"
import { StorageManager } from "../StorageManager.js"

// ─────────────────────────────────────────────────────────────
//  SHOP.JS  v2.7.0  [OPTIMIZED]
//
//  Storage: world dynamic properties (chunked, ~9.6 MB cap)
//  Economy: scoreboard via money_system.js
//  Books:   auto-reloaded every boot from enchanted_books.js
//
//  ── v2.7.0 Optimization: In-Memory Cache ──────────────────
//
//  BEFORE (v2.6.1):
//    Every single Shop operation did a full disk round-trip:
//      _loadItems()  → concat 300 chunks → JSON.parse  (READ)
//      mutate object
//      _saveItems()  → JSON.stringify → split chunks   (WRITE)
//    Opening the shop UI triggered 2–4 of these per render.
//    Result: 100–500ms stall per UI interaction.
//
//  AFTER (v2.7.0):
//    _itemsCache  and  _groupsCache  are loaded ONCE at boot.
//    All reads  → hit the in-memory cache (near-zero cost).
//    All writes → mutate cache first, then flush to disk once.
//    Result: UI renders in microseconds. Disk writes only on
//    actual data changes (addItem, removeItem, editItem, etc.)
//
//  Chunk system (unchanged):
//  ─────────────────────────
//  World dynamic properties cap at 32 767 chars per key.
//  Items JSON is split across numbered chunk keys:
//    shop:items:chunk:0,  shop:items:chunk:1,  …
//  shop:items:meta stores the total chunk count.
//  300 chunks × 32 000 ≈ 9.6 MB — enough for any preset.
// ─────────────────────────────────────────────────────────────

// ── Storage keys ──────────────────────────────────────────────
const KEY_GROUPS = "shop:groups"
const KEY_VERSION = "shop:version"
const KEY_ITEMS_META = "shop:items:meta"
const CHUNK_PREFIX = "shop:items:chunk:"
const CHUNK_SIZE = 32000
const SHOP_VERSION = "2.7.0"
const KEY_BOOKS_OFF = "shop:books_removed"   // true = admin deleted the Enchanted Book category on purpose
const BOOK_CAT = "Enchanted Book"

// ── Config ────────────────────────────────────────────────────
const CONFIG = {
  startingSlot: 9,
  maxGroup: 44,   // slots 9-17 = 27-slot menu; 18-44 switch the menu to 54 slots automatically
  currency: "$",
}

// ─────────────────────────────────────────────────────────────
//  In-Memory Cache
//  Populated once at boot by Shop.init() → stays warm forever.
//  All public API reads go through the cache, never disk.
//  All public API writes mutate the cache then flush to disk.
// ─────────────────────────────────────────────────────────────

let _itemsCache = null   // { [id]: itemEntry }  — null = not loaded yet
let _groupsCache = null   // { [name]: groupData } — null = not loaded yet

// Debounce flags — prevents 50 rapid addItem() calls from triggering 50 flushes.
// The first dirty call schedules a system.run(); subsequent calls in the same
// tick just set the flag and return immediately. The single queued callback
// does the one real JSON.stringify + chunk write.
let _itemsFlushPending = false
let _groupsFlushPending = false

// ── Category index: Map<category, id[]> ───────────────────────
// Maintained in sync with _itemsCache so getItemsByCategory()
// is O(k) (k = items in category) instead of O(n) full scan.
const _categoryIndex = new Map()

function _indexAdd(id, category) {
  if (!category) return
  if (!_categoryIndex.has(category)) _categoryIndex.set(category, [])
  _categoryIndex.get(category).push(id)
}

function _indexRemove(id, category) {
  if (!category || !_categoryIndex.has(category)) return
  const arr = _categoryIndex.get(category)
  const pos = arr.indexOf(id)
  if (pos !== -1) arr.splice(pos, 1)
}

function _rebuildCategoryIndex(items) {
  _categoryIndex.clear()
  for (const [id, entry] of Object.entries(items)) {
    _indexAdd(id, entry.category)
  }
}

// ─────────────────────────────────────────────────────────────
//  Disk I/O — only called at boot and on mutations
// ─────────────────────────────────────────────────────────────

function _saveItems(items) {
  const json = JSON.stringify(items)
  // Pre-allocate to the exact chunk count — avoids V8 array growth/reallocation
  const chunkCount = Math.ceil(json.length / CHUNK_SIZE) || 1
  const chunks = new Array(chunkCount)
  for (let i = 0; i < chunkCount; i++) {
    chunks[i] = json.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
  }
  for (let i = 0; i < chunks.length; i++) {
    world.setDynamicProperty(CHUNK_PREFIX + i, chunks[i])
  }
  // Wipe leftover chunks from a previous longer save
  const prev = world.getDynamicProperty(KEY_ITEMS_META) ?? 0
  for (let i = chunks.length; i < prev; i++) {
    try { world.setDynamicProperty(CHUNK_PREFIX + i, undefined) } catch { }
  }
  world.setDynamicProperty(KEY_ITEMS_META, chunks.length)
}

function _loadItemsFromDisk() {
  const count = world.getDynamicProperty(KEY_ITEMS_META) ?? 0
  if (count === 0) return {}
  // Array join is faster than repeated string concatenation for large chunk counts.
  // Each += forces the engine to allocate a new string; join does one allocation.
  const parts = new Array(count)
  for (let i = 0; i < count; i++) {
    parts[i] = world.getDynamicProperty(CHUNK_PREFIX + i) ?? ""
  }
  try { return JSON.parse(parts.join("")) } catch { return {} }
}

function _clearItemsFromDisk() {
  const count = world.getDynamicProperty(KEY_ITEMS_META) ?? 0
  for (let i = 0; i < count; i++) {
    try { world.setDynamicProperty(CHUNK_PREFIX + i, undefined) } catch { }
  }
  world.setDynamicProperty(KEY_ITEMS_META, 0)
}

function _loadGroupsFromDisk() {
  const raw = world.getDynamicProperty(KEY_GROUPS)
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

function _saveGroups(groups) {
  world.setDynamicProperty(KEY_GROUPS, JSON.stringify(groups))
}

// ─────────────────────────────────────────────────────────────
//  Cache accessors — internal use only
// ─────────────────────────────────────────────────────────────

/** Returns live items cache. Lazy-loads from disk if called before init(). */
function _items() {
  if (_itemsCache === null) {
    _itemsCache = _loadItemsFromDisk()
    _rebuildCategoryIndex(_itemsCache)
  }
  return _itemsCache
}

/** Returns live groups cache. Lazy-loads from disk if called before init(). */
function _groups() {
  if (_groupsCache === null) {
    _groupsCache = _loadGroupsFromDisk()
  }
  return _groupsCache
}

/**
 * Flush _itemsCache to disk — debounced to one write per tick.
 * 50 rapid addItem() / editItem() calls in a single tick schedule
 * exactly ONE system.run() callback; the rest just return early.
 */
function _flushItems() {
  if (_itemsFlushPending) return
  _itemsFlushPending = true
  system.run(() => {
    _itemsFlushPending = false
    _saveItems(_itemsCache)
  })
}

/**
 * Flush _groupsCache to disk — debounced to one write per tick.
 */
function _flushGroups() {
  if (_groupsFlushPending) return
  _groupsFlushPending = true
  system.run(() => {
    _groupsFlushPending = false
    _saveGroups(_groupsCache)
  })
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

let _uid = 0
function uid() { return `si_${system.currentTick}_${++_uid}` }

const _niceIdCache = new Map()
function _niceId(typeId) {
  if (_niceIdCache.has(typeId)) return _niceIdCache.get(typeId)
  const result = typeId.replace(/^minecraft:/, "").replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
  _niceIdCache.set(typeId, result)
  return result
}

// Pre-computed once — CONFIG.startingSlot and CONFIG.maxGroup are constants
// so there is no reason to rebuild this array on every call.
const _AVAILABLE_SLOTS = Object.freeze(
  Array.from({ length: CONFIG.maxGroup - CONFIG.startingSlot + 1 }, (_, i) => CONFIG.startingSlot + i)
)
function _availableSlots() { return _AVAILABLE_SLOTS }

// ─────────────────────────────────────────────────────────────
//  Enchantment helpers
// ─────────────────────────────────────────────────────────────

function resolveEnchantType(name) {
  // Avoid try/catch inside a loop — thrown exceptions are expensive in V8/QuickJS.
  // EnchantmentTypes.get() returns undefined for unknown IDs; we just guard on that.
  const candidates = [name, `minecraft:${name}`, name.toLowerCase(), `minecraft:${name.toLowerCase()}`]
  for (const c of candidates) {
    const t = EnchantmentTypes.get(c)
    if (t) return t
  }
  return null
}

function applyEnchantments(item, enchantments) {
  if (!Array.isArray(enchantments) || enchantments.length === 0) return item
  const comp = item.getComponent("minecraft:enchantable")
  if (!comp) return item
  for (const { name, level = 1 } of enchantments) {
    const type = resolveEnchantType(name)
    if (!type) { console.warn(`[Shop] Unknown enchantment: ${name}`); continue }
    try { comp.addEnchantment({ type, level }) } catch (e) {
      console.warn(`[Shop] Could not apply ${name} Lv${level}: ${e.message}`)
    }
  }
  return item
}

function buildItemStack(entry) {
  if (entry.isCustom && entry.slotKey) {
    try {
      const stored = StorageManager.retrieve("SHOP", entry.slotKey)
      if (stored) return stored.clone()
    } catch (e) {
      console.warn(`[Shop] Failed to retrieve custom item ${entry.slotKey}:`, e)
    }
  }
  if (!ItemTypes.get(entry.typeId)) return null
  const item = new ItemStack(entry.typeId)
  if (entry.enchantments) applyEnchantments(item, entry.enchantments)
  return item
}

/**
 * Returns true when the item can stack to more than 1.
 * Used by the confirm UI to decide whether to show quantity buttons.
 */
function _isStackable(typeId) {
  try {
    const tmp = new ItemStack(typeId)
    return tmp.maxAmount > 1
  } catch {
    return false
  }
}

// ─────────────────────────────────────────────────────────────
//  Shop API
// ─────────────────────────────────────────────────────────────

const Shop = {}
Shop.config = CONFIG
Shop.maxGroup = CONFIG.maxGroup

// ── Groups ────────────────────────────────────────────────────

Shop.getGroups = () => {
  // Reads from cache — no disk I/O
  const raw = _groups()
  const slots = _availableSlots()
  const sorted = Object.keys(raw).sort((a, b) => {
    const ai = raw[a].index, bi = raw[b].index
    if (ai == null && bi == null) return 0
    if (ai == null) return 1
    if (bi == null) return -1
    return ai - bi
  })
  const used = new Set()
  const result = {}
  for (const name of sorted) {
    const data = raw[name]
    if (data.index == null || data.index < CONFIG.startingSlot || data.index > CONFIG.maxGroup) {
      data.index = slots.find(s => !used.has(s)) ?? CONFIG.startingSlot
    }
    used.add(data.index)
    result[name] = data
  }
  return result
}

Shop.addGroup = (name, data) => {
  if (name === BOOK_CAT) _setBooksOff(false)
  if (!data.index || data.index < CONFIG.startingSlot || data.index > CONFIG.maxGroup) {
    data.index = Shop.getEmptyIndex()[0] ?? CONFIG.startingSlot
  }
  _groups()[name] = data          // mutate cache
  _flushGroups()                  // single disk write
}

Shop.setGroup = (name, data) => { _groups()[name] = data; _flushGroups() }
Shop.hasGroup = (name) => name in _groups()
Shop.removeGroup = (name) => {
  delete _groups()[name]
  if (name === BOOK_CAT) _setBooksOff(true)   // stop the boot loader from silently bringing it back
  _flushGroups()
}

Shop.getEmptyIndex = () => {
  const used = new Set(Object.values(_groups()).map(g => g.index).filter(Boolean))
  return _availableSlots().filter(s => !used.has(s))
}

// ── Items ─────────────────────────────────────────────────────

Shop.addItem = (entry) => {
  const id = uid()
  _items()[id] = entry            // mutate cache
  _indexAdd(id, entry.category)  // update category index
  _flushItems()                   // single disk write
  return id
}

Shop.removeItem = (id) => {
  const entry = _items()[id]
  if (entry) _indexRemove(id, entry.category)  // update index before delete
  delete _items()[id]
  _flushItems()
}

Shop.editItem = (id, patch) => {
  const items = _items()
  if (!items[id]) return
  const oldCategory = items[id].category
  Object.assign(items[id], patch)
  // If category changed, fix the index
  if (patch.category && patch.category !== oldCategory) {
    _indexRemove(id, oldCategory)
    _indexAdd(id, patch.category)
  }
  _flushItems()
}

/** Returns the raw items object from cache — no disk I/O. */
Shop.getItems = () => _items()

/**
 * Returns items for a category using the O(k) category index.
 * Before: O(n) full scan of all items every call.
 * After:  O(k) where k = items in that category only.
 */
Shop.getItemsByCategory = (category) => {
  const ids = _categoryIndex.get(category) ?? []
  const items = _items()
  return ids
    .filter(id => items[id])
    .map(id => ({ id, ...items[id] }))
}

Shop.getSize = () => Object.keys(_items()).length

Shop.resetData = () => {
  // Wipe cache first, then disk
  _itemsCache = {}
  _groupsCache = {}
  _categoryIndex.clear()
  _clearItemsFromDisk()
  try { world.setDynamicProperty(KEY_GROUPS, undefined) } catch { }
  try { world.setDynamicProperty(KEY_VERSION, undefined) } catch { }
  _setBooksOff(false)
}

function _setBooksOff(v) {
  try { world.setDynamicProperty(KEY_BOOKS_OFF, v ? true : undefined) } catch { }
}
function _booksOff() { return world.getDynamicProperty(KEY_BOOKS_OFF) === true }

/** Remove EVERY category and item. Presets are not reloaded on reboot afterwards. */
Shop.removeAllCategories = () => {
  for (const entry of Object.values(_items())) {
    if (entry.isCustom && entry.slotKey) { try { StorageManager.remove("SHOP", entry.slotKey) } catch { } }
  }
  _itemsCache = {}
  _groupsCache = {}
  _categoryIndex.clear()
  _clearItemsFromDisk()
  _saveGroups(_groupsCache)
  _setBooksOff(true)
  world.setDynamicProperty(KEY_VERSION, SHOP_VERSION)   // keep "initialised" so presets don't auto-reload
}

/** Preferred slot if valid + free, otherwise the first free slot. */
function _pickIndex(preferred, groups, ignoreName) {
  const used = new Set(Object.entries(groups).filter(([n]) => n !== ignoreName).map(([, g]) => g.index))
  if (Number.isInteger(preferred) && preferred >= CONFIG.startingSlot && preferred <= CONFIG.maxGroup && !used.has(preferred)) return preferred
  return _availableSlots().find(s => !used.has(s)) ?? null
}

function _presetGroupList(ShopPreset) {
  return Object.keys(ShopPreset).map(key => {
    const [name, icon, idx] = key.split("|")
    return { key, name, icon, index: parseInt(idx) }
  })
}

/** Preset categories that are not currently in the shop (deleted, or newly added to shop_preset.js). */
Shop.getMissingPresetCategories = async () => {
  const { ShopPreset } = await import("../Preset/shop_preset.js")
  const { ENCHANTED_BOOKS } = await import("../Modules/enchanted_books.js")
  const have = _groups()
  return _presetGroupList(ShopPreset)
    .filter(g => !(g.name in have))
    .map(g => ({
      name: g.name, icon: g.icon, index: g.index,
      count: g.name === BOOK_CAT ? ENCHANTED_BOOKS.length
        : ShopPreset[g.key].filter(e => ItemTypes.get(e.item)).length,
    }))
}

/** Restore ONE preset category without touching anything else. Returns item count, or -1 on failure. */
Shop.restorePresetCategory = async (name) => {
  if (name === BOOK_CAT) {
    _setBooksOff(false)
    await _loadBookPreset()
    return Shop.getItemsByCategory(BOOK_CAT).length
  }
  const { ShopPreset } = await import("../Preset/shop_preset.js")
  const g = _presetGroupList(ShopPreset).find(x => x.name === name)
  if (!g) return -1
  const groups = _groups()
  const index = _pickIndex(g.index, groups, name)
  if (index === null) return -1                       // all 36 slots used
  // drop orphan items that still carry this category name
  for (const id of [...(_categoryIndex.get(name) ?? [])]) delete _items()[id]
  _categoryIndex.delete(name)
  groups[name] = { displayname: name, icon: g.icon, index }
  let n = 0
  for (const entry of ShopPreset[g.key]) {
    if (!ItemTypes.get(entry.item)) continue
    const id = uid()
    _items()[id] = {
      typeId: entry.item, displayname: entry.displayname ?? _niceId(entry.item),
      icon: entry.icon ?? entry.item, price: entry.price, category: name,
      enchantments: entry.enchantments ?? null,
    }
    _indexAdd(id, name); n++
  }
  _flushItems(); _flushGroups()
  return n
}

Shop.restoreAllMissing = async () => {
  let restored = 0
  for (const m of await Shop.getMissingPresetCategories()) {
    if (await Shop.restorePresetCategory(m.name) >= 0) restored++
  }
  return restored
}

// ── Preset loading ────────────────────────────────────────────
// Both loaders build entirely in memory, then do ONE disk write each.
// They also update the cache directly so no reload is needed after.

async function _loadNormalPreset() {
  const { ShopPreset } = await import("../Preset/shop_preset.js")
  const items = {}
  const groups = {}

  for (const groupKey of Object.keys(ShopPreset)) {
    const [name, icon, indexStr] = groupKey.split("|")
    if (name === "Enchanted Book") continue

    const index = parseInt(indexStr)
    groups[name] = {
      displayname: name,
      icon,
      index: isNaN(index) ? undefined : index,
    }

    for (const entry of ShopPreset[groupKey]) {
      if (!ItemTypes.get(entry.item)) continue
      const id = uid()
      items[id] = {
        typeId: entry.item,
        displayname: entry.displayname ?? _niceId(entry.item),
        icon: entry.icon ?? entry.item,
        price: entry.price,
        category: name,
        enchantments: entry.enchantments ?? null,
      }
    }
  }

  // Update cache + index, then single disk write each
  _itemsCache = items
  _groupsCache = groups
  _rebuildCategoryIndex(_itemsCache)
  _saveItems(_itemsCache)
  _saveGroups(_groupsCache)
}

async function _loadBookPreset() {
  const { ShopPreset } = await import("../Preset/shop_preset.js")
  const { ENCHANTED_BOOKS } = await import("../Modules/enchanted_books.js")

  const bookGroupKey = Object.keys(ShopPreset).find(k => k.startsWith("Enchanted Book|"))
  const [, bookIcon = "minecraft:enchanted_book", bookIndexStr = "16"] = bookGroupKey?.split("|") ?? []
  const bookIndex = parseInt(bookIndexStr)

  // Work entirely in cache — no disk reads
  const items = _items()
  const groups = _groups()

  // Wipe old book entries from cache and index
  const idsToRemove = _categoryIndex.get(BOOK_CAT) ? [..._categoryIndex.get(BOOK_CAT)] : []
  for (const id of idsToRemove) delete items[id]
  _categoryIndex.delete(BOOK_CAT)

  groups[BOOK_CAT] = {
    displayname: BOOK_CAT,
    icon: bookIcon,
    index: _pickIndex(groups[BOOK_CAT]?.index ?? bookIndex, groups, BOOK_CAT) ?? undefined,
  }

  const presetEntries = bookGroupKey ? ShopPreset[bookGroupKey] : []
  const presetPriceMap = new Map(presetEntries.map(e => [e.displayname?.toLowerCase(), e.price]))

  for (const book of ENCHANTED_BOOKS) {
    const enchantId = book.enchantId
    const enchantName = book.name.replace(/\s+[IVX]+$/, "").trim()
    const levelMatch = book.name.match(/([IVX]+)$/)
    const level = levelMatch ? (["I", "II", "III", "IV", "V"].indexOf(levelMatch[1]) + 1) : 1
    const basePrice = presetPriceMap.get(book.name.toLowerCase())
      ?? presetPriceMap.get(enchantName.toLowerCase())
      ?? 100
    const price = basePrice * (level > 1 ? level : 1)
    const id = uid()
    items[id] = {
      typeId: book.id,
      displayname: book.name,
      icon: book.texture ?? book.id,
      price,
      category: BOOK_CAT,
      enchantments: [{ name: enchantId, level }],
    }
    _indexAdd(id, BOOK_CAT)  // maintain index
  }

  // One disk write each
  _flushItems()
  _flushGroups()
  console.log(`[Shop] ✅ Loaded ${ENCHANTED_BOOKS.length} enchanted book entries`)
}

Shop.init = async () => {
  const stored = world.getDynamicProperty(KEY_VERSION)
  const firstRun = stored !== SHOP_VERSION

  if (firstRun) {
    console.log("[Shop] First run or version change — loading full preset...")
    Shop.resetData()
    await _loadNormalPreset()
    world.setDynamicProperty(KEY_VERSION, SHOP_VERSION)
    console.log(`[Shop] ✅ Normal preset loaded (v${SHOP_VERSION})`)
  } else {
    // Warm the cache from disk on existing data (one load, never again)
    console.log("[Shop] ✅ Existing shop data found — warming cache from disk...")
    _itemsCache = _loadItemsFromDisk()
    _groupsCache = _loadGroupsFromDisk()
    _rebuildCategoryIndex(_itemsCache)
    console.log(`[Shop] ✅ Cache warmed: ${Object.keys(_itemsCache).length} items, ${Object.keys(_groupsCache).length} groups`)
  }

  if (_booksOff()) {
    console.log("[Shop] Enchanted Book category was removed by an admin — not reloading it.")
  } else {
    console.log("[Shop] Reloading enchanted books...")
    await _loadBookPreset()
  }
  console.log("[Shop] ✅ Shop ready")
}

// ── Purchase ──────────────────────────────────────────────────

/**
 * Returns true if the supplied container has at least one empty slot (0–35).
 * Accepts a pre-fetched container so the caller doesn't cross the C++ bridge
 * a second time via getComponent().
 */
function _hasInventorySpace(container) {
  if (!container) return false
  for (let i = 0; i < 36; i++) {
    if (!container.getItem(i)) return true
  }
  return false
}

Shop.purchase = (player, itemId) => {
  // Cache read — no disk I/O
  const items = _items()
  const entry = items[itemId]
  if (!entry) return { success: false, reason: "Item not found." }

  // Apply VIP penalty to buy price (4× for penalized players, exempt for FORVIP category)
  const priceCents = VipPenalty.applyBuyCents(player, entry.price, entry.category)

  if (!Money.has(player, priceCents)) {
    return {
      success: false,
      reason: `§cNot enough money. §7Need §a${Money.format(priceCents)} §7— you have §e${Money.getFormatted(player)}§7.`,
    }
  }

  const item = buildItemStack(entry)
  if (!item) return { success: false, reason: "Invalid item." }

  // Fetch container ONCE — reused for both the space check and addItem().
  const container = player.getComponent("minecraft:inventory")?.container

  if (!_hasInventorySpace(container)) {
    return {
      success: false, inventoryFull: true,
      reason: "§cYour inventory is full! Make space before buying."
    }
  }

  Money.remove(player, priceCents)

  if (container) container.addItem(item)
  else player.dimension.spawnItem(item, player.location)

  return { success: true, priceCents }
}

/**
 * Buy `qty` copies of an item in a single money transaction.
 * Distributes items across multiple stacks if needed (respects maxAmount).
 */
Shop.purchaseMultiple = (player, itemId, qty = 1) => {
  const items = _items()
  const entry = items[itemId]
  if (!entry) return { success: false, reason: "Item not found." }

  const safeQty = Math.max(1, qty)
  const unitPrice = VipPenalty.applyBuyCents(player, entry.price, entry.category)
  const priceCents = unitPrice * safeQty

  if (!Money.has(player, priceCents)) {
    return {
      success: false,
      reason: `§cNot enough money. §7Need §a${Money.format(priceCents)} §7— you have §e${Money.getFormatted(player)}§7.`,
    }
  }

  const container = player.getComponent("minecraft:inventory")?.container
  if (!_hasInventorySpace(container)) {
    return { success: false, inventoryFull: true, reason: "§cYour inventory is full! Make space before buying." }
  }

  // Probe a single stack to get maxAmount
  const probe = buildItemStack(entry)
  if (!probe) return { success: false, reason: "Invalid item." }
  const maxStack = probe.maxAmount || 1

  Money.remove(player, priceCents)

  // Distribute across stacks (e.g. qty=100 → two stacks of 64 + one of 36 would exceed cap;
  // qty is already capped at 64 by the UI so usually one stack is enough)
  let remaining = safeQty
  while (remaining > 0) {
    const portion = Math.min(remaining, maxStack)
    const stack = buildItemStack(entry)
    if (!stack) break
    stack.amount = portion
    if (container) container.addItem(stack)
    else player.dimension.spawnItem(stack, player.location)
    remaining -= portion
  }

  return { success: true, priceCents }
}

// ─────────────────────────────────────────────────────────────
//  UI
//
//  Screen 1 — Category Select  (27 slots, 3 rows)
//  ───────────────────────────────────────────────
//  Slot  4        → Shop title / balance (centre row 0)
//  Slots 9–17     → category buttons (row 1, preset indices)
//  Slot 22        → balance info (centre row 2)
//  Everything else → gray glass
//
//  Screen 2 — Category Viewing  (54 slots, paginated)
//  ────────────────────────────────────────────────────
//  Row 0  (slots  0– 8)  header — gray glass except:
//    slot 4 = category icon (centre)
//  Rows 1–4 (slots  9–44)  item grid — 36 items per page
//  Row 5  (slots 45–53)  nav row — gray glass except:
//    slot 46 = ← Previous
//    slot 49 = ↩ Back
//    slot 52 = → Next
// ─────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 36  // rows 1–4 = slots 9–44

// ── Screen 1: Category Select (27 slots) ─────────────────────

Shop.openUI = async (player) => {
  // Cache read — instant
  const groups = Shop.getGroups()
  const names = Object.keys(groups)

  if (names.length === 0) {
    player.sendMessage("§c[Shop] No categories found.")
    return
  }

  const bal = Money.getFormatted(player)

  // Auto-upgrade: more than 9 categories (or any tab slot past 17) -> 54-slot menu.
  const big = names.length > 9 || names.some(n => groups[n].index > 17)
  const size = big ? 54 : 27
  const form = new ChestFormData(String(size), `§6§lShop`)

  // Fill every slot with gray glass
  //for (let i = 0; i < size; i++) form.button(i, "", [], "g/gray")

  // Slot 4 — shop title (centre of row 0)
  form.button(4, "§lShop", ["§7Pick a category below"], "minecraft:gold_ingot")

  // Slots 9–17 — category buttons (row 1)
  for (const [name, data] of Object.entries(groups)) {
    // getItemsByCategory now uses O(k) index — no full scan
    const count = Shop.getItemsByCategory(name).length
    form.button(data.index, `§e§l${name}`, [`§7${count} items`, "§8Click to browse"], data.icon ?? "minecraft:chest")
  }

  // Balance info: centre of the last row (22 for 27 slots, 49 for 54)
  form.button(big ? 49 : 22, "§7Balance", [`§a${bal}`], "minecraft:emerald")

  const resp = await new Promise(resolve => {
    system.runTimeout(() => form.show(player).then(resolve), 2)
  })
  if (resp.canceled) return

  const clicked = resp.selection
  const clickedGroup = names.find(n => groups[n].index === clicked)
  if (clickedGroup) return _openCategory(player, clickedGroup, 0)
  return Shop.openUI(player)
}

// ── Screen 2: Category Viewing (54 slots, paginated) ─────────

async function _openCategory(player, category, page) {
  // All reads from cache — no disk I/O during UI rendering
  const groups = Shop.getGroups()
  const groupData = groups[category]
  const allItems = Shop.getItemsByCategory(category)  // O(k) index lookup
  const totalPages = Math.max(1, Math.ceil(allItems.length / ITEMS_PER_PAGE))
  const safePage = Math.max(0, Math.min(page, totalPages - 1))
  const pageItems = allItems.slice(safePage * ITEMS_PER_PAGE, (safePage + 1) * ITEMS_PER_PAGE)
  const bal = Money.getFormatted(player)
  const hasPrev = safePage > 0
  const hasNext = safePage < totalPages - 1

  const form = new ChestFormData("54", `§6§l${category}`)

  // ── Row 0: header (slots 0–8) ─────────────────────────────
  //for (let i = 0; i < 9; i++) form.button(i, "", [], "g/gray")
  form.button(4,
    `§e§l${category}`,
    [`§7Page §f${safePage + 1}§7/§f${totalPages}`, `§7Balance: §a${bal}`],
    groupData?.icon ?? "minecraft:chest"
  )

  // ── Rows 1–4: items (slots 9–44) ──────────────────────────
  //for (let i = 9; i <= 44; i++) form.button(i, "", [], "g/gray")
  const invFull = !_hasInventorySpace(player.getComponent("minecraft:inventory")?.container)
  pageItems.forEach((entry, i) => {
    const displayPrice = VipPenalty.applyBuyCents(player, entry.price, entry.category)
    const lore = []

    let customLore = entry.lore
    if (!customLore && entry.isCustom && entry.slotKey) {
      try {
        const storedItem = StorageManager.retrieve("SHOP", entry.slotKey)
        if (storedItem) {
          customLore = (storedItem.getLore?.() ?? []).filter(l => !l.startsWith("\uFEFF"))
          entry.lore = customLore
        }
      } catch (e) {
        console.warn(`[Shop] Failed to load lore for ${entry.displayname}:`, e)
      }
    }

    if (Array.isArray(customLore) && customLore.length > 0) {
      lore.push(...customLore)
      lore.push("§r")
    }

    lore.push(`§a${Money.format(displayPrice)}`)
    lore.push(invFull ? "§c⚠ Your Inventory is Currently Full" : "§8Click to buy")

    form.button(
      9 + i,
      `§f${entry.displayname}`,
      lore,
      entry.icon ?? entry.typeId,
      "", 0, !!entry.enchantments
    )
  })

  // ── Row 5: navigation (slots 45–53) ───────────────────────
  //for (let i = 45; i <= 53; i++) form.button(i, "", [], "g/gray")

  form.button(46,
    hasPrev ? "§e§l← Previous" : "§8← Previous",
    [hasPrev ? `§7Page ${safePage}/${totalPages}` : "§8No previous page"],
    hasPrev ? 'textures/items/arrow' : "minecraft:air"
  )
  form.button(49, "§c§lBack", ["§7Return to categories"], "minecraft:barrier")
  form.button(52,
    hasNext ? "§e§l→ Next" : "§8→ Next",
    [hasNext ? `§7Page ${safePage + 2}/${totalPages}` : "§8No next page"],
    hasNext ? 'textures/items/arrow' : "minecraft:air"
  )

  const resp = await new Promise(resolve => {
    system.runTimeout(() => form.show(player).then(resolve), 2)
  })
  if (resp.canceled) return

  const clicked = resp.selection

  if (clicked === 46 && hasPrev) return _openCategory(player, category, safePage - 1)
  if (clicked === 52 && hasNext) return _openCategory(player, category, safePage + 1)
  if (clicked === 49) return Shop.openUI(player)

  // Item grid (slots 9–44) → open quantity-confirm UI
  if (clicked >= 9 && clicked <= 44) {
    const entry = pageItems[clicked - 9]
    if (!entry) return _openCategory(player, category, safePage)
    return _openConfirm(player, entry, safePage, category)
  }

  // Filler / header click → stay
  return _openCategory(player, category, safePage)
}

// ── Screen 3: Quantity Confirm (27 slots) ─────────────────────
//
//  27-slot layout (3 rows × 9 cols):
//
//  Row 0  (slots  0– 8)  all gray glass
//  Row 1  (slots  9–17):
//    9  = gray   10 = -64 (red)  11 = -10 (red)  12 = -1 (red)
//    13 = item   14 = +1 (lime)  15 = +10 (lime)  16 = +64 (lime)
//    17 = gray
//    (for non-stackable items slots 10-12 and 14-16 are gray glass)
//  Row 2  (slots 18–26):
//    18-20 gray  21 = ✗ Cancel  22 gray  23 = ✓ Confirm  24-26 gray
// ─────────────────────────────────────────────────────────────

async function _openConfirm(player, entry, page, category, qty = 1) {
  const stackable = _isStackable(entry.typeId)
  const MAX_QTY = 64
  const safeQty = stackable ? Math.max(1, Math.min(qty, MAX_QTY)) : 1

  const unitPrice = VipPenalty.applyBuyCents(player, entry.price, entry.category)
  const totalPrice = unitPrice * safeQty
  const canAfford = Money.has(player, totalPrice)
  const bal = Money.getFormatted(player)

  const form = new ChestFormData("27", `§6§lConfirm Purchase`)

  // Fill everything with gray glass first
  //for (let i = 0; i < 27; i++) form.button(i, "", [], "g/gray")

  // ── Slot 13 — Item display ─────────────────────────────────
  const lore = []
  if (Array.isArray(entry.lore) && entry.lore.length > 0) {
    lore.push(...entry.lore, "§r")
  }
  if (stackable) lore.push(`§7Quantity: §f${safeQty}`)
  lore.push(`§7Total:    §a${Money.format(totalPrice)}`)
  lore.push(`§7Balance:  §e${bal}`)
  lore.push(canAfford ? "§8Press §aConfirm §8to buy" : "§cNot enough money!")

  form.button(
    13,
    `§f${entry.displayname}`,
    lore,
    entry.icon ?? entry.typeId,
    stackable ? safeQty : "",   // show qty count badge for stackable items
    0,
    !!entry.enchantments
  )

  if (stackable) {
    // ── Decrease buttons (slots 10, 11, 12) ──────────────────
    form.button(10, "§c§l-64", ["§7Decrease quantity by §c64"], "minecraft:red_stained_glass_pane")
    form.button(11, "§c§l-10", ["§7Decrease quantity by §c10"], "minecraft:red_stained_glass_pane")
    form.button(12, "§c§l-1", ["§7Decrease quantity by §c1"], "minecraft:red_stained_glass_pane")
    // ── Increase buttons (slots 14, 15, 16) ──────────────────
    form.button(14, "§a§l+1", ["§7Increase quantity by §a1"], "minecraft:lime_stained_glass_pane")
    form.button(15, "§a§l+10", ["§7Increase quantity by §a10"], "minecraft:lime_stained_glass_pane")
    form.button(16, "§a§l+64", ["§7Increase quantity by §a64"], "minecraft:lime_stained_glass_pane")
  }

  // ── Cancel (21) & Confirm (23) ────────────────────────────
  form.button(21, "§c§l✗ Cancel",
    ["§7Return to shop without buying"],
    "minecraft:red_concrete"
  )
  form.button(23,
    canAfford ? "§a§l✓ Confirm" : "§8§l✗ Confirm",
    [canAfford
      ? `§7Buy §f${safeQty}x ${entry.displayname}§7 for §a${Money.format(totalPrice)}`
      : `§cNeed §a${Money.format(totalPrice)}§c — you have §e${bal}`
    ],
    canAfford ? "minecraft:lime_concrete" : "minecraft:air"
  )

  const resp = await new Promise(resolve => {
    system.runTimeout(() => form.show(player).then(resolve), 2)
  })
  if (resp.canceled) return _openCategory(player, category, page)

  const clicked = resp.selection

  // Cancel
  if (clicked === 21) return _openCategory(player, category, page)

  // Quantity adjust (stackable only)
  if (stackable) {
    if (clicked === 10) return _openConfirm(player, entry, page, category, Math.max(1, safeQty - 64))
    if (clicked === 11) return _openConfirm(player, entry, page, category, Math.max(1, safeQty - 10))
    if (clicked === 12) return _openConfirm(player, entry, page, category, Math.max(1, safeQty - 1))
    if (clicked === 14) return _openConfirm(player, entry, page, category, Math.min(MAX_QTY, safeQty + 1))
    if (clicked === 15) return _openConfirm(player, entry, page, category, Math.min(MAX_QTY, safeQty + 10))
    if (clicked === 16) return _openConfirm(player, entry, page, category, Math.min(MAX_QTY, safeQty + 64))
  }

  // Confirm purchase
  if (clicked === 23) {
    if (!canAfford) {
      player.sendMessage(`§c[Shop] Not enough money to buy ${safeQty}x ${entry.displayname}.`)
      player.playSound("mob.villager.no")
      return   // auto close
    }
    const result = Shop.purchaseMultiple(player, entry.id, safeQty)
    if (result.inventoryFull) {
      player.sendMessage(`§c[Shop] ${result.reason}`)
      player.playSound("mob.villager.no")
      return   // auto close
    }
    player.sendMessage(result.success
      ? `§a[Shop] Bought §f${safeQty}x ${entry.displayname} §afor §e${Money.format(result.priceCents)}§a.`
      : `§c[Shop] ${result.reason}`
    )
    // Ting-ting sound on success
    if (result.success) player.playSound("random.orb")
    // Stay on confirm UI after a successful purchase — resets qty to 1
    return _openConfirm(player, entry, page, category, 1)
  }

  // Any other click (gray filler) → stay on confirm
  return _openConfirm(player, entry, page, category, safeQty)
}

// ─────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────

system.runTimeout(async () => {
  try { await Shop.init() }
  catch (e) { console.error("[Shop] ❌ Init failed:", e) }
}, 60)

export function registerShopCommand(event) {
  // ── 1. Register /ss:shop ───────────────────────────────────
  try {
    event.customCommandRegistry.registerCommand(
      {
        name: "ss:shop",
        description: "Open the shop",
        permissionLevel: 0,
        cheatsRequired: false
      },
      (context) => {
        const player = context.initiator ?? context.sourceEntity ?? context.sender
        if (!player || player.typeId !== "minecraft:player") return
        system.run(() => Shop.openUI(player))
      }
    )
    console.warn("[Shop] Command registered: /ss:shop")
  } catch (err) {
    if (err.message?.includes("reload")) {
      console.warn("[Shop] /ss:shop already registered (reload skipped)")
    } else {
      console.warn(`[Shop] Failed to register /ss:shop: ${err}`)
    }
  }

  // ── 2. Register /ss:reload_shop ────────────────────────────
  try {
    event.customCommandRegistry.registerCommand(
      {
        name: "ss:reload_shop",
        description: "Reload shop preset (admin only)",
        permissionLevel: 0,
        cheatsRequired: true
      },
      (context) => {
        const player = context.initiator ?? context.sourceEntity ?? context.sender
        if (!player || player.typeId !== "minecraft:player") return

        if (!player.hasTag("admin")) {
          player.sendMessage("§c[Shop] ❌ You don't have permission. (Admin tag required)")
          return
        }

        player.sendMessage("§e[Shop] 🔄 Reloading shop presets...")
        system.run(async () => {
          try {
            // Wipe cache + disk, then reload everything fresh
            Shop.resetData()
            console.log("[Shop] ✅ Cleared old data")

            await _loadNormalPreset()
            world.setDynamicProperty(KEY_VERSION, SHOP_VERSION)

            await _loadBookPreset()

            const count = Shop.getSize()
            console.log(`[Shop] ✅ Loaded ${count} items from fresh preset`)
            player.sendMessage(`§a[Shop] ✅ Shop reloaded! §7${count} items loaded`)
            console.log(`[Shop] 🔄 Reloaded by admin: ${player.name}`)
          } catch (e) {
            player.sendMessage("§c[Shop] ❌ Reload failed!")
            console.error("[Shop] ❌ Reload failed:", e.message)
          }
        })
      }
    )
    console.warn("[Shop] Command registered: /ss:reload_shop")
  } catch (err) {
    if (err.message?.includes("reload")) {
      console.warn("[Shop] /ss:reload_shop already registered (reload skipped)")
    } else {
      console.warn(`[Shop] Failed to register /ss:reload_shop: ${err}`)
    }
  }
}

system.afterEvents.scriptEventReceive.subscribe(async ({ id, sourceEntity }) => {
  if (!sourceEntity || sourceEntity.typeId !== "minecraft:player") return
  const player = sourceEntity

  if (id === "shop:hardReset") {
    player.sendMessage("§e[Shop] Resetting...")
    Shop.resetData()
    await Shop.init()
    player.sendMessage("§a[Shop] Reset complete.")
  }
  if (id === "shop:reloadBooks") {
    player.sendMessage("§e[Shop] Reloading enchanted books...")
    await _loadBookPreset()
    player.sendMessage("§a[Shop] Enchanted books reloaded.")
  }
  if (id === "shop:balance") {
    player.sendMessage(`§a[Shop] Balance: §f${Money.getFormatted(player)}`)
  }
})

export default Shop
