import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bridgeAttrib,
  ingestExportPower,
  identityKey,
  structuralKey,
  parseDuration,
  mapAttribType,
  type AtomicEffect,
} from './core/atomic-effect';

/**
 * deductive-schema-harness-4 — validate the closed atomic effect schema + identity key against the
 * COMMITTED parser export (`exported_powers/`, the converter input). This proves the
 * schema fits real data, the identity keys distinguish the collapse-prone sibling
 * sets, and every attrib the HC export uses has a bridge rule (so a renamed/new
 * attrib after an HC patch fails here instead of silently mis-slotting). It does NOT
 * exercise the converter — that is deductive-schema-harness-6.
 *
 * See streams/DEDUCTIVE_SCHEMA_HARNESS.md.
 */

const ALL_DATASET_IDS = ['homecoming', 'rebirth', 'thunderspy', 'brainstorm'] as const;

const EXPORT_ROOT = fileURLToPath(new URL('../../exported_powers', import.meta.url));

function hcFiles(): string[] {
  const out: string[] = [];
  // Every dataset that nests under the Homecoming export root, derived rather than typed:
  // this walk is Homecoming's alone, and a hand list silently adopts the next dataset's
  // tree as HC's the day it lands (data-gaps-289).
  const skipTop = new Set<string>([
    ...ALL_DATASET_IDS.filter((id) => id !== 'homecoming'),
    'tables',
  ]);
  const walk = (dir: string, top: string | null) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (top === null && skipTop.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, top ?? e.name);
      else if (e.name.endsWith('.json') && e.name !== 'index.json') out.push(p);
    }
  };
  walk(EXPORT_ROOT, null);
  return out;
}

function loadByFullName(substr: string): { path: string; power: { full_name?: string; effects?: unknown[] } } {
  for (const f of hcFiles()) {
    const power = JSON.parse(fs.readFileSync(f, 'utf-8'));
    if ((power.full_name || '').toLowerCase().endsWith(substr.toLowerCase())) return { path: f, power };
  }
  throw new Error(`no HC export power ending in ${substr}`);
}

describe('deductive-schema-harness-4 atomic-effect schema — export present', () => {
  it('the committed exported_powers/ input exists', () => {
    expect(fs.existsSync(EXPORT_ROOT)).toBe(true);
  });
});

describe('bridgeAttrib — vocabulary rules', () => {
  it('maps damage, mez, scalar, movement, and by-type-with-context', () => {
    expect(bridgeAttrib('Lethal_Dmg')).toEqual({ effectType: 'Damage', subType: 'Lethal' });
    expect(bridgeAttrib('Negative_Energy_Dmg')).toEqual({ effectType: 'Damage', subType: 'Negative' });
    expect(bridgeAttrib('Stunned')).toEqual({ effectType: 'Mez', subType: 'Stunned' });
    expect(bridgeAttrib('RechargeTime')).toEqual({ effectType: 'RechargeTime' });
    expect(bridgeAttrib('RunningSpeed')).toEqual({ effectType: 'Movement', subType: 'Run' });
    // by-type: effectType comes from aspect/table, not the name
    expect(bridgeAttrib('Smashing', 'Current', 'Melee_Defense')).toEqual({ effectType: 'Defense', subType: 'Smashing' });
    expect(bridgeAttrib('Smashing', 'Resistance', 'Res_Smashing')).toEqual({ effectType: 'Resistance', subType: 'Smashing' });
  });

  it('maps the Thunderspy mez/movement vocab respellings (data-gaps-75 step 2)', () => {
    // Thunderspy drops the canonical participle / `Movement` prefix on four attribs
    // where HC/Rebirth spell them fully. Same present-but-respelled class as the
    // SpeedRunning→Run movement vocab already mapped. Each is confirmed by its table:
    //   Stun→Stunned (Melee_Stun), Immobilize→Immobilized (Ranged_Immobilize),
    //   Friction→MovementFriction (Melee_Friction, == HC's table), Control→MovementControl.
    // aspect drives the mez face exactly as for the canonical spelling.
    expect(bridgeAttrib('Stun', 'Strength', 'Melee_Stun')).toEqual({ effectType: 'Enhancement', subType: 'Stunned' });
    expect(bridgeAttrib('Stun', 'Duration', 'Ranged_Stun')).toEqual({ effectType: 'Mez', subType: 'Stunned' });
    expect(bridgeAttrib('Immobilize', 'Current', 'Ranged_Immobilize')).toEqual({ effectType: 'Mez', subType: 'Immobilized' });
    expect(bridgeAttrib('Friction', 'Current', 'Melee_Friction')).toEqual({ effectType: 'Movement', subType: 'Friction' });
    expect(bridgeAttrib('Control', 'Current', 'Melee_Control')).toEqual({ effectType: 'Movement', subType: 'Control' });
  });

  it('maps the Thunderspy Heal/HealSelf +MaxHP respelling (ATOM-TSPY step 2)', () => {
    // tspy spells HC's `HitPoints`@Maximum (+MaxHP) as bare `Heal`/`HealSelf` on the same
    // `*_HealSelf`/`*_Heal` tables (Dull Pain, Earth's Embrace, True Grit…). ONLY the Maximum
    // face is a consumed total — it bridges to MaxHP exactly as `HitPoints`@Maximum does. The
    // applied-heal (Absolute) and heal-strength (Strength) faces stay Unmapped, matching HC,
    // where they ride the separate `Heal_Dmg` attrib and feed no MaxHP total.
    expect(bridgeAttrib('HealSelf', 'Maximum', 'Melee_HealSelf')).toEqual({ effectType: 'MaxHP' });
    expect(bridgeAttrib('Heal', 'Maximum', 'Ranged_Heal')).toEqual({ effectType: 'MaxHP' });
    expect(bridgeAttrib('HealSelf', 'Absolute', 'Melee_HealSelf').effectType).toBe('Unmapped');
    expect(bridgeAttrib('Heal', 'Strength', 'Melee_Boosts_33').effectType).toBe('Unmapped');
    // canonical HC spelling is unchanged
    expect(bridgeAttrib('HitPoints', 'Maximum', 'Melee_HealSelf')).toEqual({ effectType: 'MaxHP' });
  });

  it('Heal_Dmg with aspect=Resistance is healing-received, not -resistance', () => {
    expect(bridgeAttrib('Heal_Dmg', 'Absolute', 'Ranged_Heal')).toEqual({ effectType: 'Heal' });
    expect(bridgeAttrib('Heal_Dmg', 'Resistance', 'Ranged_Ones')).toEqual({ effectType: 'HealResistance' });
  });

  it('aspect=Strength is a buff, not the applied effect (verified vs Mids oracle)', () => {
    // <type>_Dmg + Str ⇒ DamageBuff (Build Up), not Damage
    expect(bridgeAttrib('Smashing_Dmg', 'Strength', 'Melee_Buff_Dmg')).toEqual({ effectType: 'DamageBuff', subType: 'Smashing' });
    expect(bridgeAttrib('Smashing_Dmg', 'Absolute', 'Melee_Damage')).toEqual({ effectType: 'Damage', subType: 'Smashing' });
    // mez + Str ⇒ Enhancement (Power Boost); mez + Res ⇒ MezResist; else ⇒ Mez
    expect(bridgeAttrib('Held', 'Strength', 'Melee_Stun')).toEqual({ effectType: 'Enhancement', subType: 'Held' });
    expect(bridgeAttrib('Held', 'Resistance', 'Ranged_Ones')).toEqual({ effectType: 'MezResist', subType: 'Held' });
    expect(bridgeAttrib('Held', 'Duration', 'Ranged_Hold')).toEqual({ effectType: 'Mez', subType: 'Held' });
    // bare by-type + Str (not on def/res table) ⇒ Enhancement (Power Boost secondary)
    expect(bridgeAttrib('Smashing', 'Strength', 'Melee_Stun')).toEqual({ effectType: 'Enhancement', subType: 'Smashing' });
  });

  it('bare by-type @ aspect=Current is Defense, even on a generic (_Ones) table', () => {
    // The damage/resistance face is written `<type>_Dmg`; a bare position/type attrib is
    // the *defense* characteristic. Incarnate flat buffs (Support/Barrier Core) and
    // positional NPC buffs use `Melee_Ones`/`Ranged_Ones`, not a `*Def*` table — the
    // bridge must still classify them as Defense so DSH5/deductive-schema-harness-6 can see defense drops.
    expect(bridgeAttrib('Smashing', 'Current', 'Melee_Ones')).toEqual({ effectType: 'Defense', subType: 'Smashing' });
    expect(bridgeAttrib('Melee', 'Current', 'Melee_Ones')).toEqual({ effectType: 'Defense', subType: 'Melee' });
    expect(bridgeAttrib('Area', 'Current', 'Ranged_Ones')).toEqual({ effectType: 'Defense', subType: 'AoE' });
    expect(bridgeAttrib('Base_Defense', 'Current', 'Melee_Ones')).toEqual({ effectType: 'Defense', subType: 'All' });
    // resistance still rides `_Dmg`@Res (never bare@Current), so the twin does not collapse
    expect(bridgeAttrib('Smashing_Dmg', 'Resistance', 'Melee_Ones')).toEqual({ effectType: 'Resistance', subType: 'Smashing' });
  });

  it('parseDuration reads the "N seconds" export string', () => {
    expect(parseDuration('5 seconds')).toBe(5);
    expect(parseDuration('0 seconds')).toBe(0);
    expect(parseDuration(12.5)).toBe(12.5);
    expect(parseDuration('')).toBe(0);
  });
});

describe('ingest — no silent drops, sign preserved', () => {
  it('emits exactly one record per (template × attrib)', () => {
    const { power } = loadByFullName('Arachnos_Soldier.Single_Shot');
    const expected = (power.effects as { templates?: { attribs?: string[] }[] }[])
      .flatMap((g) => g.templates ?? [])
      .reduce((n, t) => n + (t.attribs?.length ?? 0), 0);
    expect(ingestExportPower(power as never).length).toBe(expected);
  });

  it('preserves the sign of a debuff scale (no Math.abs at ingest)', () => {
    // scan a chunk of HC for any negative-scale template and confirm it survives
    let sawNegative = false;
    for (const f of hcFiles().slice(0, 400)) {
      const power = JSON.parse(fs.readFileSync(f, 'utf-8'));
      for (const e of ingestExportPower(power)) {
        if (e.scale < 0) { sawNegative = true; break; }
      }
      if (sawNegative) break;
    }
    expect(sawNegative).toBe(true);
  });
});

describe('identity keys — distinguish the collapse-prone siblings', () => {
  it('Single Shot: the PvE and PvP Lethal damage do not collapse into one key', () => {
    const { power } = loadByFullName('Arachnos_Soldier.Single_Shot');
    const dmg = ingestExportPower(power as never).filter(
      (e) => e.effectType === 'Damage' && e.subType === 'Lethal',
    );
    // Two Lethal damage records — the base and the PvP variant. In our export the
    // PvP variant is a distinct `_pvpdamage` table at pv=Any (not pvMode=PvP), so the
    // distinguishing axis is modifierTable; either way they must NOT share a key.
    expect(dmg.length).toBeGreaterThanOrEqual(2);
    expect(new Set(dmg.map(structuralKey)).size).toBeGreaterThanOrEqual(2);
  });

  it('Flash Arrow: the resistible AND unresistable ToHit twin both survive as distinct keys', () => {
    const { power } = loadByFullName('Trick_Arrow.Flash_Arrow');
    const tohit = ingestExportPower(power as never).filter((e) => e.effectType === 'ToHit');
    expect(tohit.some((e) => e.resistible)).toBe(true);
    expect(tohit.some((e) => !e.resistible)).toBe(true);
    // the twin must NOT collapse: resistible vs unresistable ⇒ different identity keys
    const resKey = tohit.find((e) => e.resistible)!;
    const unresKey = tohit.find((e) => !e.resistible)!;
    expect(identityKey(resKey)).not.toBe(identityKey(unresKey));
    expect(structuralKey(resKey)).not.toBe(structuralKey(unresKey));
  });

  it('identityKey is deterministic and value-sensitive; structuralKey is scale-agnostic', () => {
    const base: AtomicEffect = {
      effectType: 'ToHit', pvMode: 'Any', resistible: true, toWho: 'Target',
      attribType: 'Magnitude', aspect: 'Cur', modifierTable: 'Ranged_Debuff_ToHit',
      scale: -0.1, magnitude: 1, duration: 6, stacking: 'No', baseProbability: 1,
    };
    expect(identityKey(base)).toBe(identityKey({ ...base }));
    // scale is part of the identity key (distinguishes duration/twin variants)
    expect(identityKey(base)).not.toBe(identityKey({ ...base, scale: -0.2 }));
    // but NOT part of the structural key (scale is skew-distrusted for the oracle diff)
    expect(structuralKey(base)).toBe(structuralKey({ ...base, scale: -0.2 }));
  });
});

describe('coverage — every HC attrib has a bridge rule (post-patch regression guard)', () => {
  it('no HC export attrib falls through to "no bridge rule"; reports coverage', () => {
    const distinctAttribs = new Set<string>();
    const effectTypeCounts: Record<string, number> = {};
    let totalRecords = 0;
    let unmapped = 0;
    const files = hcFiles();
    for (const f of files) {
      const power = JSON.parse(fs.readFileSync(f, 'utf-8'));
      for (const g of power.effects ?? []) {
        for (const t of g.templates ?? []) {
          for (const a of t.attribs ?? []) distinctAttribs.add(a);
        }
      }
      for (const e of ingestExportPower(power)) {
        totalRecords++;
        effectTypeCounts[e.effectType] = (effectTypeCounts[e.effectType] ?? 0) + 1;
        if (e.effectType === 'Unmapped') unmapped++;
      }
    }

    // COMPLETENESS: every distinct attrib string is recognized by SOME rule — i.e.
    // never "no bridge rule". (Deferred by-type/parser-unknown reasons are allowed;
    // an unrecognized attrib name is not.) This is the HC-patch tripwire.
    const noRule: string[] = [];
    for (const a of distinctAttribs) {
      const r = bridgeAttrib(a); // no table context — enough to prove the name is known
      if (r.effectType === 'Unmapped' && (r.reason ?? '').startsWith('no bridge rule')) {
        noRule.push(a);
      }
    }
    expect(noRule).toEqual([]);

    const mappedPct = ((totalRecords - unmapped) / totalRecords) * 100;
    // eslint-disable-next-line no-console
    console.log(
      `[deductive-schema-harness-4] HC: ${files.length} powers, ${totalRecords} atomic records, ` +
      `${distinctAttribs.size} distinct attribs, ${mappedPct.toFixed(1)}% mapped ` +
      `(${unmapped} Unmapped = by-type-on-mez/notify + parser-unknown, deferred to deductive-schema-harness-6). ` +
      `effectTypes: ${Object.entries(effectTypeCounts).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}:${v}`).join(' ')}`,
    );
    // the confidently-mappable core should dominate
    expect(mappedPct).toBeGreaterThan(80);
  });
});

/**
 * data-gaps-50 — `mapAttribType` maps all four of the parser's `ATTRIB_MOD_TYPE`
 * values and throws on an unrecognized spelling. It used to fold `Constant` onto
 * `Magnitude` (`return 'Magnitude'; // Magnitude, Constant, undefined`) — the
 * data-gaps-66 shape, a soft default turning a parse fact into plausible data. This
 * grades the fix directly: a regression to the fall-through fails the `Constant`
 * assertion, and a new/unlisted type value fails the throw (Rule 1: show the
 * fault rather than laundering it). Absence stays folded to `Magnitude`, matching
 * the parser default the def compiler authors (Detention Field's mez row reads
 * `Magnitude`).
 */
describe('mapAttribType — four-member vocabulary, throw on unknown (data-gaps-50)', () => {
  it('maps each of the four parser ATTRIB_MOD_TYPE values', () => {
    expect(mapAttribType('Duration')).toBe('Duration');
    expect(mapAttribType('Magnitude')).toBe('Magnitude');
    expect(mapAttribType('Constant')).toBe('Constant');
    expect(mapAttribType('Expression')).toBe('Expression');
  });

  it('keeps Constant off Magnitude — the data-gaps-50 fold is retired', () => {
    expect(mapAttribType('Constant')).not.toBe('Magnitude');
  });

  it('throws on a present-but-unrecognized spelling (the data-gaps-66 soft-default guard)', () => {
    expect(() => mapAttribType('Gibberish')).toThrow();
  });

  it('folds an absent type to Magnitude, matching the parser default', () => {
    expect(mapAttribType(undefined)).toBe('Magnitude');
    expect(mapAttribType('')).toBe('Magnitude');
  });
});
