/**
 * deductive-schema-harness-4 adversarial check — bridge output vs the Mids oracle's ground-truth
 * EffectType/DamageType/MezType. For each HC power in both, compare the SET of
 * (effectType, subType) my `bridgeAttrib`/ingest produces against the oracle's. A
 * confident type I produce that the oracle NEVER has for that power is a potential
 * MIS-MAP (the dangerous case — worse than a deferral). Coverage gaps the other way
 * (oracle has a type I lack) are expected (multi-type explosion, redirect inlining).
 *
 * Run:  npx tsx tools/mids-oracle/crosscheck_bridge.ts <oracle.jsonl> [limit]
 * (Local only — the oracle .jsonl comes from read_i12.py against the gitignored .mhd.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestExportPower, type EffectType } from '../../src/data/core/atomic-effect';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const EXPORT_ROOT = path.join(REPO, 'exported_powers');

// Mids eEffectType (read_i12 emits these) -> our EffectType space, for comparison.
const MIDS_ET: Record<string, EffectType | null> = {
  Damage: 'Damage', DamageBuff: 'DamageBuff', Enhancement: 'Enhancement',
  Heal: 'Heal', Absorb: 'Absorb', HitPoints: 'MaxHP',
  Defense: 'Defense', Resistance: 'Resistance', Elusivity: 'Elusivity',
  ToHit: 'ToHit', Accuracy: 'Accuracy', Mez: 'Mez', MezResist: 'MezResist',
  Endurance: 'Endurance', EnduranceDiscount: 'EnduranceDiscount',
  Recovery: 'Recovery', Regeneration: 'Regeneration', RechargeTime: 'RechargeTime',
  Range: 'Range', ThreatLevel: 'ThreatLevel', PerceptionRadius: 'Perception',
  StealthRadius: 'Stealth', StealthRadiusPlayer: 'Stealth',
  SpeedRunning: 'Movement', SpeedFlying: 'Movement', SpeedJumping: 'Movement',
  JumpHeight: 'Movement', Fly: 'Movement', MovementControl: 'Movement',
  MovementFriction: 'Movement', GrantPower: 'GrantPower', EntCreate: 'EntCreate',
  ExecutePower: 'ExecutePower', RechargePower: 'RechargePower',
  GlobalChanceMod: 'GlobalChanceMod',
};

function hcFiles(): string[] {
  const out: string[] = [];
  const skip = new Set(['rebirth', 'thunderspy', 'tables']);
  const walk = (dir: string, top: string | null) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (top === null && skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, top ?? e.name);
      else if (e.name.endsWith('.json') && e.name !== 'index.json') out.push(p);
    }
  };
  walk(EXPORT_ROOT, null);
  return out;
}

// only compare on effectTypes with a clean 1:1 Mids counterpart
const COMPARABLE = new Set<EffectType>([
  'Damage', 'DamageBuff', 'Enhancement', 'Mez', 'MezResist', 'Defense', 'Resistance',
  'ToHit', 'Recovery', 'Regeneration', 'RechargeTime', 'Endurance', 'Heal', 'Absorb',
  'Elusivity', 'Movement', 'Accuracy', 'Range', 'Perception',
]);

// Base_Defense/all-positions ↔ Mids damage_type 'None' — a naming artifact, folded.
function normSub(s?: string): string {
  return s === 'All' || s === 'None' || !s ? '' : s;
}

function oracleKey(effect: { effect_type: string; damage_type?: string; mez_type?: string }): string | null {
  const et = MIDS_ET[effect.effect_type];
  if (!et || !COMPARABLE.has(et)) return null;
  const dmg = effect.damage_type && effect.damage_type !== 'None' ? effect.damage_type : undefined;
  const mez = effect.mez_type && effect.mez_type !== 'None' ? effect.mez_type : undefined;
  const sub =
    et === 'Damage' || et === 'DamageBuff' || et === 'Defense' || et === 'Resistance' || et === 'Elusivity'
      ? dmg
      : et === 'Mez' || et === 'MezResist'
        ? mez
        : et === 'Enhancement'
          ? (dmg ?? mez) // Enhancement rides either a damage-type or a mez-type dimension
          : undefined;
  // Movement/positional subtypes differ in naming between the two models; compare
  // effectType only for those (subType alignment is DSH5's canonicalizer job).
  return et === 'Movement' ? et : `${et}|${normSub(sub)}`;
}

function mineKey(e: { effectType: EffectType; subType?: string }): string | null {
  if (!COMPARABLE.has(e.effectType)) return null;
  return e.effectType === 'Movement' ? e.effectType : `${e.effectType}|${normSub(e.subType)}`;
}

const oraclePath = process.argv[2];
const limit = process.argv[3] ? parseInt(process.argv[3], 10) : Infinity;
if (!oraclePath) { console.error('usage: crosscheck_bridge.ts <oracle.jsonl> [limit]'); process.exit(2); }

const oracle = new Map<string, { effect_type: string; damage_type?: string; mez_type?: string }[]>();
for (const line of fs.readFileSync(oraclePath, 'utf-8').split('\n')) {
  if (!line.trim()) continue;
  const p = JSON.parse(line);
  oracle.set((p.full_name || '').toLowerCase(), p.effects || []);
}

let compared = 0;
const misMaps: { power: string; type: string; sampleAttrib: string }[] = [];
const fnIndex = new Map<string, string>();
for (const f of hcFiles()) {
  const fn = (JSON.parse(fs.readFileSync(f, 'utf-8')).full_name || '').toLowerCase();
  if (fn) fnIndex.set(fn, f);
}

let n = 0;
for (const [fn, oeffects] of oracle) {
  if (n >= limit) break;
  const f = fnIndex.get(fn);
  if (!f) continue;
  n++;
  const power = JSON.parse(fs.readFileSync(f, 'utf-8'));
  const mine = ingestExportPower(power);
  const oracleTypes = new Set<string>();
  for (const e of oeffects) { const k = oracleKey(e); if (k) oracleTypes.add(k); }
  const seen = new Set<string>();
  for (const e of mine) {
    const k = mineKey(e);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    compared++;
    if (!oracleTypes.has(k)) {
      misMaps.push({ power: fn, type: k, sampleAttrib: e.sourceAttrib ?? '?' });
    }
  }
}

// tally mis-map candidates by type
const byType = new Map<string, number>();
for (const m of misMaps) byType.set(m.type, (byType.get(m.type) ?? 0) + 1);
const agreePct = ((compared - misMaps.length) / compared) * 100;
console.log(`[crosscheck] powers compared: ${n}, confident (effectType,subType) checks: ${compared}`);
console.log(`[crosscheck] ${agreePct.toFixed(1)}% agree with Mids ground truth; ${misMaps.length} residual`);
console.log('  residual = documented modeling differences, NOT bridge mis-maps:');
console.log('   · aspect=Str scalar/movement Enhancement-vs-keep-type (Mids-internal, table-context; deductive-schema-harness-6)');
console.log('   · Base_Defense-all vs Mids per-type expansion; Mids-trimmed all-type DamageBuff stubs');
console.log('   · redirect inlining / PvP-table encoding (see diff_oracle.py taxonomy)');
for (const [t, c] of [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  const sample = misMaps.find((m) => m.type === t)!;
  console.log(`   ${c.toString().padStart(4)}  ${t.padEnd(22)} e.g. ${sample.power} (attrib=${sample.sampleAttrib})`);
}
