/**
 * Extract AT Modifier Tables from the class export
 *
 * Reads one JSON file per character class and emits the dataset's
 * `at-tables.ts`: the `named_tables` a scaled effect resolves against, for the
 * player archetypes (`AT_TABLES`) and, separately, for the pet classes
 * (`PET_TABLES`) — a summon is a second character and resolves against its OWN
 * class row.
 *
 * A class file carries more than tables, and the rest is emitted alongside
 * rather than discarded: each archetype's RechargeTime `ClampStrength` interval
 * (`rechargeBounds`), and each pet class's own character stats (`attribs` —
 * hit points and the caps the summon lives against).
 *
 * Both rosters are derived from the export, never hand-listed; see
 * `_player-classes.cjs` for which signal names each one.
 */

const fs = require('fs');
const path = require('path');
const { parseDatasetArg, datasetPath } = require('./_dataset-paths.cjs');

const datasetId = parseDatasetArg();

// Source: per-AT JSON files produced by `tools/bin-crawler/bin_crawler/
// export_classes.py`. HC ships at the legacy flat layout
// (`exported_powers/tables/`); other datasets are namespaced
// (`exported_powers/<id>/tables/`).
const RAW_DATA_BASE = path.join(__dirname, '..', 'exported_powers');
const RAW_DATA_PATH = (datasetId === 'homecoming' && !fs.existsSync(path.join(RAW_DATA_BASE, datasetId, 'tables')))
  ? path.join(RAW_DATA_BASE, 'tables')
  : path.join(RAW_DATA_BASE, datasetId, 'tables');

// at-tables.ts has migrated into `src/data/datasets/<id>/` — write there
// directly so we don't clobber the runtime facade at `src/data/at-tables.ts`.
const OUTPUT_PATH = datasetPath(datasetId, 'at-tables.ts');

// The pet entities live beside the tables, one directory up: HC's flat layout
// puts them at `exported_powers/entities/`, the namespaced ones at
// `exported_powers/<id>/entities/`.
const ENTITIES_PATH = path.join(RAW_DATA_PATH, '..', 'entities');

const { derivePlayerArchetypes, derivePetClasses } = require('./_player-classes.cjs');

const PLAYER_ARCHETYPES = derivePlayerArchetypes(RAW_DATA_PATH);
const PET_CLASSES = derivePetClasses(ENTITIES_PATH, RAW_DATA_PATH);

/**
 * The pet class's own character stats — the numbers that make a summon a second
 * character rather than an effect. `hit_points`, `hp_cap` and `absorb_cap` are
 * per-level arrays (index = level − 1); the caps and clamps are scalars.
 * Returns null when the export doesn't carry the block, so a consumer can show
 * nothing rather than invent a hit point total.
 */
function petAttribs(data, petClass) {
  const a = data.attribs;
  if (!a || typeof a !== 'object') {
    console.warn(`  ${petClass}: no attribs block — pet stats will be unavailable`);
    return null;
  }
  const levelArray = (key) => {
    const v = a[key];
    if (!Array.isArray(v) || v.length === 0) return undefined;
    if (!v.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined;
    return v;
  };
  const scalar = (key) => (typeof a[key] === 'number' && Number.isFinite(a[key]) ? a[key] : undefined);
  const movement = (key) => {
    const m = a[key];
    if (!m || typeof m !== 'object') return undefined;
    const out = {};
    for (const axis of ['run_speed', 'fly_speed', 'jump_speed', 'jump_height']) {
      const v = m[axis];
      if (typeof v === 'number' && Number.isFinite(v)) out[axis] = v;
      else if (Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isFinite(n))) out[axis] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };

  const hitPoints = levelArray('hit_points');
  if (!hitPoints) {
    console.warn(`  ${petClass}: no usable hit_points array — pet stats will be unavailable`);
    return null;
  }
  return {
    hitPoints,
    hpCap: levelArray('hp_cap'),
    absorbCap: levelArray('absorb_cap'),
    resistanceCap: scalar('resistance_cap'),
    damageCap: scalar('damage_cap'),
    baseThreat: scalar('base_threat'),
    rechargeFloor: scalar('recharge_floor'),
    rechargeCap: scalar('recharge_cap'),
    enduranceFloor: scalar('endurance_floor'),
    enduranceCap: scalar('endurance_cap'),
    movementBase: movement('movement_base'),
    movementCap: movement('movement_cap'),
  };
}

/**
 * The class's RechargeTime `ClampStrength` interval — the floor and cap the
 * server bounds NET recharge strength to, exported per class in `attribs`
 * (`{floor: 0.25, cap: 5}` on every player class: −75% debuff floor, +400% cap).
 *
 * Unlike most clamps this one is REACHABLE — a perma build stacking Hasten, set
 * bonuses and Ageless lives against it — so the perma tracker needs it both to
 * stop selling recharge past the ceiling and to decide whether a power's cycle
 * can ever fit inside its own window.
 *
 * Returns null when the export doesn't carry the pair, so a consumer can stand
 * aside rather than invent a ceiling. That is the failure mode a hardcoded 5
 * used to hide: it was ALSO wrong about what the number meant, reading the ×5.0
 * net strength as a +500% bonus.
 */
function rechargeBounds(data, at) {
  const attribs = data.attribs;
  if (!attribs || typeof attribs !== 'object') return null;
  const floor = attribs.recharge_floor;
  const cap = attribs.recharge_cap;
  if (typeof floor !== 'number' || typeof cap !== 'number'
      || !Number.isFinite(floor) || !Number.isFinite(cap) || cap <= 0) {
    console.warn(`  ${at}: no usable recharge clamp bounds in attribs — perma reachability will stand aside`);
    return null;
  }
  return { floor, cap };
}

// Principled filter: include every binary named table exposed on player AT/pet
// class exports. This avoids hand-maintained allowlists that silently miss real
// tables until a power references one in a fatal slot.
function normalizeNamedTableEntry(tableName, tableValues) {
  if (typeof tableName !== 'string' || tableName.length === 0) return null;
  if (!Array.isArray(tableValues) || tableValues.length === 0) return null;
  if (!tableValues.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return {
    key: tableName.toLowerCase(),
    values: tableValues,
  };
}

function extractTables() {
  const allTables = {};

  for (const at of PLAYER_ARCHETYPES) {
    const filePath = path.join(RAW_DATA_PATH, `${at}.json`);

    if (!fs.existsSync(filePath)) {
      console.warn(`Warning: ${at}.json not found`);
      continue;
    }

    console.log(`Processing ${at}...`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    const atKey = at.replace(/_/g, '-'); // arachnos_soldier -> arachnos-soldier
    allTables[atKey] = {
      primaryCategory: data.primary_category,
      secondaryCategory: data.secondary_category,
      rechargeBounds: rechargeBounds(data, at),
      tables: {}
    };

    if (data.named_tables && typeof data.named_tables === 'object') {
      for (const [tableName, tableValues] of Object.entries(data.named_tables)) {
        const normalized = normalizeNamedTableEntry(tableName, tableValues);
        if (!normalized) continue;
        allTables[atKey].tables[normalized.key] = normalized.values;
      }
    }
  }

  return allTables;
}

function extractPetTables() {
  const petTables = {};

  // Every entry has a table file: `derivePetClasses` refuses to return a class
  // whose file is absent, so there is no missing-file case to skip here.
  for (const petClass of PET_CLASSES) {
    const filePath = path.join(RAW_DATA_PATH, `${petClass}.json`);

    console.log(`Processing pet class ${petClass}...`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    petTables[petClass] = {
      villainRank: typeof data.villain_rank === 'number' ? data.villain_rank : undefined,
      attribs: petAttribs(data, petClass),
      tables: {},
    };

    if (data.named_tables && typeof data.named_tables === 'object') {
      for (const [tableName, tableValues] of Object.entries(data.named_tables)) {
        const normalized = normalizeNamedTableEntry(tableName, tableValues);
        if (!normalized) continue;
        petTables[petClass].tables[normalized.key] = normalized.values;
      }
    }

    // A class an entity NAMES but that carries no usable table resolves nothing
    // for that pet, so dropping it here would hand the consumer a silent miss
    // instead of a gap it can see (data-gaps-105).
    if (Object.keys(petTables[petClass].tables).length === 0) {
      throw new Error(
        `extract-at-tables: pet class '${petClass}' is named by a pet entity but its class file `
          + 'carries no usable named tables — every scaled effect on that pet would resolve '
          + 'against nothing.',
      );
    }
  }

  return petTables;
}

function generateTypeScript(tables, petTables) {
  const lines = [];

  lines.push(`/**`);
  lines.push(` * Archetype Modifier Tables`);
  lines.push(` * Auto-generated from Homecoming raw data`);
  lines.push(` * `);
  lines.push(` * Each table is an array of 54 values for levels 1-54`);
  lines.push(` * Usage: tableValue = AT_TABLES[archetype].tables[tableName][level - 1]`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`export interface ATTableData {`);
  lines.push(`  primaryCategory: string;`);
  lines.push(`  secondaryCategory: string;`);
  lines.push(`  /** RechargeTime ClampStrength interval — the bounds on NET recharge`);
  lines.push(`   *  strength (floor 0.25 = the −75% debuff floor, cap 5 = +400%). Absent`);
  lines.push(`   *  when the export didn't carry it; consumers stand aside rather than`);
  lines.push(`   *  invent a ceiling. */`);
  lines.push(`  rechargeBounds?: { floor: number; cap: number };`);
  lines.push(`  tables: Record<string, number[]>;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`/** A pet class's own character stats — see PetTableData. */`);
  lines.push(`export interface PetClassAttribs {`);
  lines.push(`  /** Base max HP per level (index = level − 1). */`);
  lines.push(`  hitPoints: number[];`);
  lines.push(`  hpCap?: number[];`);
  lines.push(`  absorbCap?: number[];`);
  lines.push(`  /** Damage-resistance ceiling as a fraction (0.9 = 90%). */`);
  lines.push(`  resistanceCap?: number;`);
  lines.push(`  /** Damage strength ceiling as a multiplier (4 = +300%). */`);
  lines.push(`  damageCap?: number;`);
  lines.push(`  baseThreat?: number;`);
  lines.push(`  rechargeFloor?: number;`);
  lines.push(`  rechargeCap?: number;`);
  lines.push(`  enduranceFloor?: number;`);
  lines.push(`  enduranceCap?: number;`);
  lines.push(`  movementBase?: PetMovementAttrib;`);
  lines.push(`  movementCap?: PetMovementAttrib;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`/** Scalar for a base, per-level array for a cap. */`);
  lines.push(`export interface PetMovementAttrib {`);
  lines.push(`  run_speed?: number | number[];`);
  lines.push(`  fly_speed?: number | number[];`);
  lines.push(`  jump_speed?: number | number[];`);
  lines.push(`  jump_height?: number | number[];`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export interface PetTableData {`);
  lines.push(`  tables: Record<string, number[]>;`);
  lines.push(`  /** The class's villain-rank enum. Player classes are 0; the classes the`);
  lines.push(`   *  game treats as summons are 10 — including \`henchman_boss\`, so this does`);
  lines.push(`   *  NOT separate a henchman minion from a henchman boss. */`);
  lines.push(`  villainRank?: number;`);
  lines.push(`  /** The class's own character stats — hit points and the caps a summon`);
  lines.push(`   *  lives against. A summon is a second character, so these resolve`);
  lines.push(`   *  against the PET's class row, never the caster's archetype.`);
  lines.push(`   *  Absent when the export didn't carry an attribs block. */`);
  lines.push(`  attribs?: PetClassAttribs;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export const AT_TABLES: Record<string, ATTableData> = {`);

  for (const [atKey, atData] of Object.entries(tables)) {
    lines.push(`  '${atKey}': {`);
    lines.push(`    primaryCategory: '${atData.primaryCategory}',`);
    lines.push(`    secondaryCategory: '${atData.secondaryCategory}',`);
    if (atData.rechargeBounds) {
      const { floor, cap } = atData.rechargeBounds;
      lines.push(`    rechargeBounds: { floor: ${floor}, cap: ${cap} },`);
    }
    lines.push(`    tables: {`);

    for (const [tableName, values] of Object.entries(atData.tables)) {
      // Format the array compactly but with reasonable line length
      const formattedValues = formatArray(values);
      lines.push(`      '${tableName}': ${formattedValues},`);
    }

    lines.push(`    },`);
    lines.push(`  },`);
  }

  lines.push(`};`);
  lines.push(``);

  // Add helper function
  lines.push(`/**`);
  lines.push(` * Get a table value for a specific archetype and level`);
  lines.push(` */`);
  lines.push(`export function getTableValue(`);
  lines.push(`  archetype: string,`);
  lines.push(`  tableName: string,`);
  lines.push(`  level: number`);
  lines.push(`): number | undefined {`);
  lines.push(`  const at = AT_TABLES[archetype];`);
  lines.push(`  if (!at) return undefined;`);
  lines.push(`  `);
  lines.push(`  const key = tableName.toLowerCase();`);
  lines.push(`  let table = at.tables[key];`);
  lines.push(`  `);
  lines.push(`  // Power data uses suffixed names (e.g., "Ranged_HealSelf") that map to`);
  lines.push(`  // base table names (e.g., "ranged_heal"). Strip common suffixes to match.`);
  lines.push(`  if (!table) {`);
  lines.push(`    const stripped = key.replace(/self$|other$|target$/, '');`);
  lines.push(`    table = at.tables[stripped];`);
  lines.push(`  }`);
  lines.push(`  `);
  lines.push(`  // Alias temp/incarnate damage tables to base damage tables`);
  lines.push(`  if (!table) {`);
  lines.push(`    const aliased = key`);
  lines.push(`      .replace('_tempdamage', '_damage')`);
  lines.push(`      .replace('_incarnateprocdamage', '_damage');`);
  lines.push(`    if (aliased !== key) table = at.tables[aliased];`);
  lines.push(`  }`);
  lines.push(`  `);
  lines.push(`  // Alias the game's "_Dam" damage-table spelling to the extracted`);
  lines.push(`  // "_dmg" key. Powers reference e.g. "Ranged_Debuff_Dam" but the AT`);
  lines.push(`  // tables are keyed "ranged_debuff_dmg"; without this the lookup misses`);
  lines.push(`  // and the display falls back to a generic half-rate (damage debuffs`);
  lines.push(`  // rendered at half — e.g. Ice Arrow -10% instead of -20%).`);
  lines.push(`  if (!table) {`);
  lines.push(`    const aliased = key.replace(/_dam$/, '_dmg');`);
  lines.push(`    if (aliased !== key) table = at.tables[aliased];`);
  lines.push(`  }`);
  lines.push(`  `);
  lines.push(`  if (!table) return undefined;`);
  lines.push(`  `);
  lines.push(`  // Level 1 = index 0; clamp to table length (HC has 105 values,`);
  lines.push(`  // Rebirth has 50 — different versions cap at different levels).`);
  lines.push(`  const index = Math.max(0, Math.min(table.length - 1, level - 1));`);
  lines.push(`  return table[index];`);
  lines.push(`}`);
  lines.push(``);

  // Add calculation helper
  lines.push(`/**`);
  lines.push(` * Calculate the final effect value from scale and table`);
  lines.push(` * Example: scale 2.5 with ranged_debuff_tohit at level 50 = 2.5 * -0.125 = -31.25%`);
  lines.push(` */`);
  lines.push(`export function calculateEffectValue(`);
  lines.push(`  archetype: string,`);
  lines.push(`  tableName: string,`);
  lines.push(`  scale: number,`);
  lines.push(`  level: number = 50`);
  lines.push(`): number | undefined {`);
  lines.push(`  const tableValue = getTableValue(archetype, tableName, level);`);
  lines.push(`  if (tableValue === undefined) return undefined;`);
  lines.push(`  return scale * tableValue;`);
  lines.push(`}`);
  lines.push(``);

  // Add incarnate damage helper
  lines.push(`/**`);
  lines.push(` * Calculate incarnate power damage from scale and table`);
  lines.push(` */`);
  lines.push(`export function calculateIncarnateDamage(`);
  lines.push(`  scale: number,`);
  lines.push(`  tableName: string,`);
  lines.push(`  archetype: string,`);
  lines.push(`  level: number = 50`);
  lines.push(`): number | null {`);
  lines.push(`  if (!scale || scale === 0) return 0;`);
  lines.push(`  const tableValue = getTableValue(archetype, tableName.toLowerCase().replace(/-/g, '_'), level);`);
  lines.push(`  if (tableValue === undefined) return null;`);
  lines.push(`  return Math.abs(scale * tableValue);`);
  lines.push(`}`);
  lines.push(``);

  // Generate PET_TABLES
  if (petTables && Object.keys(petTables).length > 0) {
    lines.push(`// ============================================`);
    lines.push(`// PET CLASS TABLES`);
    lines.push(`// ============================================`);
    lines.push(``);
    lines.push(`export const PET_TABLES: Record<string, PetTableData> = {`);

    for (const [petClass, petData] of Object.entries(petTables)) {
      lines.push(`  '${petClass}': {`);
      if (typeof petData.villainRank === 'number') {
        lines.push(`    villainRank: ${petData.villainRank},`);
      }
      if (petData.attribs) {
        lines.push(`    attribs: {`);
        for (const [key, value] of Object.entries(petData.attribs)) {
          if (value === undefined) continue;
          if (Array.isArray(value)) {
            lines.push(`      ${key}: ${formatArray(value)},`);
          } else if (typeof value === 'object') {
            const axes = Object.entries(value)
              .map(([axis, v]) => `${axis}: ${Array.isArray(v) ? formatArray(v) : v}`)
              .join(', ');
            lines.push(`      ${key}: { ${axes} },`);
          } else {
            lines.push(`      ${key}: ${value},`);
          }
        }
        lines.push(`    },`);
      }
      lines.push(`    tables: {`);

      for (const [tableName, values] of Object.entries(petData.tables)) {
        const formattedValues = formatArray(values);
        lines.push(`      '${tableName}': ${formattedValues},`);
      }

      lines.push(`    },`);
      lines.push(`  },`);
    }

    lines.push(`};`);
    lines.push(``);

    // Add pet table helper
    lines.push(`/**`);
    lines.push(` * Get a table value for a specific pet class and level`);
    lines.push(` */`);
    lines.push(`export function getPetTableValue(`);
    lines.push(`  petClass: string,`);
    lines.push(`  tableName: string,`);
    lines.push(`  level: number`);
    lines.push(`): number | undefined {`);
    lines.push(`  const pet = PET_TABLES[petClass];`);
    lines.push(`  if (!pet) return undefined;`);
    lines.push(`  `);
    lines.push(`  const key = tableName.toLowerCase();`);
    lines.push(`  let table = pet.tables[key];`);
    lines.push(`  `);
    lines.push(`  // Strip common suffixes like getTableValue does`);
    lines.push(`  if (!table) {`);
    lines.push(`    const stripped = key.replace(/self$|other$|target$/, '');`);
    lines.push(`    table = pet.tables[stripped];`);
    lines.push(`  }`);
    lines.push(`  `);
    lines.push(`  if (!table) return undefined;`);
    lines.push(`  `);
    lines.push(`  const index = Math.max(0, Math.min(table.length - 1, level - 1));`);
    lines.push(`  return table[index];`);
    lines.push(`}`);
    lines.push(``);
  }

  return lines.join('\n');
}

function formatArray(arr) {
  // For large arrays, put multiple values per line
  const valuesPerLine = 10;
  const lines = ['['];

  for (let i = 0; i < arr.length; i += valuesPerLine) {
    const chunk = arr.slice(i, i + valuesPerLine);
    const formatted = chunk.map(v => typeof v === 'number' ? v.toString() : JSON.stringify(v)).join(', ');
    if (i + valuesPerLine < arr.length) {
      lines.push(`        ${formatted},`);
    } else {
      lines.push(`        ${formatted}`);
    }
  }

  lines.push(`      ]`);
  return lines.join('\n');
}

// Run extraction
console.log('Extracting AT modifier tables...\n');
const tables = extractTables();

console.log('\nExtracting pet class tables...\n');
const petTables = extractPetTables();

console.log('\nGenerating TypeScript file...');
const tsContent = generateTypeScript(tables, petTables);

fs.writeFileSync(OUTPUT_PATH, tsContent);
console.log(`\nWrote ${OUTPUT_PATH}`);

// Print summary
console.log('\nPlayer Archetypes:');
for (const [at, data] of Object.entries(tables)) {
  const tableCount = Object.keys(data.tables).length;
  console.log(`  ${at}: ${tableCount} tables`);
}

console.log('\nPet Classes:');
for (const [petClass, data] of Object.entries(petTables)) {
  const tableCount = Object.keys(data.tables).length;
  console.log(`  ${petClass}: ${tableCount} tables`);
}
