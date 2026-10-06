import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Set_Mode index → mode-name resolution (bin-crawler `attrib_names.bin`).
 *
 * A `Set_Mode` AttribMod's `magnitude` is an opaque index into the game's global
 * mode registry (the `ppchMode` sub-array of `attrib_names.bin`). The exporter
 * (`bin_crawler/parser/_attrib_names.py` + `export_powers.py`) resolves it to a
 * `mode_name` on the template, e.g. magnitude 46 → "Domination_Active".
 *
 * Guards the committed HC `exported_powers/` data. Mode indices are per-server;
 * only HC is resolved so far (Rebirth/Thunderspy ship no `attrib_names.bin`).
 *
 * NOTE (2026-07-07): the committed HC data now POST-DATES the attrib-118 fix
 * (adopted by the 2026-07-07 export-staleness re-export). The exporter used to
 * gate resolution on magnitude >= 2 because index 118 collapsed three engine
 * attribs (kXPDebtProtection / kSetMode / kSetCostume) onto `Set_Mode`, making a
 * mag==1 Set_Mode ambiguous. That truncation is fixed at the parser source
 * (resolve_attrib reads the byte-granular sub-index), so the mag==1 impostors are
 * now relabeled (Empathy Resurrect's mag==1 → `XPDebtProtection`, no Set_Mode).
 * See HOMECOMING_PARSER.md "attrib-118 misdecode".
 */
type Template = { attribs?: string[]; magnitude?: number; mode_name?: string };

function loadPower(rel: string): unknown {
  const p = fileURLToPath(new URL(`../../exported_powers/${rel}`, import.meta.url));
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Collect every Set_Mode template's [magnitude, mode_name] across a power's effect tree. */
function setModes(node: unknown): Array<[number, string | undefined]> {
  const out: Array<[number, string | undefined]> = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      n.forEach(walk);
    } else if (n && typeof n === 'object') {
      const obj = n as { templates?: Template[]; [k: string]: unknown };
      for (const t of obj.templates ?? []) {
        if ((t.attribs ?? []).includes('Set_Mode')) out.push([t.magnitude ?? -1, t.mode_name]);
      }
      for (const k of ['effects', 'child_effects', 'redirects', 'activation_effects']) {
        const v = obj[k];
        if (Array.isArray(v)) v.forEach(walk);
      }
    }
  };
  walk(node);
  return out;
}

/** Resolved mode names on a power, keyed by magnitude index. */
function modeByMag(rel: string): Record<number, string> {
  const m: Record<number, string> = {};
  for (const [mag, name] of setModes(loadPower(rel))) if (name) m[mag] = name;
  return m;
}

// Issue 28 Page 4 (live 2026-10-06) inserted one mode into the registry, so every index
// past the Granite ones below moved up by one; the names they resolve to did not change.
describe('Set_Mode magnitude → mode-name resolution (HC)', () => {
  it('Domination resolves both its modes (Domination + Domination_Active)', () => {
    const m = modeByMag('inherent/inherent/domination.json');
    expect(m[46]).toBe('Domination');
    expect(m[47]).toBe('Domination_Active');
  });

  it('Bio Armor adaptations resolve to their stance modes', () => {
    expect(modeByMag('brute_defense/bio_organic_armor/offensive_adaptation.json')[156]).toBe(
      'OffensiveAdaptation',
    );
    expect(modeByMag('brute_defense/bio_organic_armor/defensive_adaptation.json')[155]).toBe(
      'DefensiveAdaptation',
    );
    // Efficient Adaptation genuinely sets RestedAdaptation — there is no
    // "EfficientAdaptation" mode (verified against the .powers oracle).
    expect(modeByMag('brute_defense/bio_organic_armor/efficient_adaptation.json')[154]).toBe(
      'RestedAdaptation',
    );
  });

  it('Dual Pistols ammo swaps resolve to their ammo modes', () => {
    expect(modeByMag('blaster_ranged/dual_pistols/cryo_ammunition.json')[91]).toBe('IceAmmo');
    expect(modeByMag('blaster_ranged/dual_pistols/incendiary_ammunition.json')[92]).toBe('FireAmmo');
    expect(modeByMag('blaster_ranged/dual_pistols/chemical_ammunition.json')[93]).toBe('ToxicAmmo');
  });

  it('Granite Armor resolves its form mode and the toggle-suppression modes', () => {
    const m = modeByMag('brute_defense/stone_armor/granite_armor.json');
    expect(m[6]).toBe('Granite_Mode');
    expect(m[35]).toBe('Suppress_FlyToggles');
    expect(m[36]).toBe('Suppress_RunToggles');
    expect(m[37]).toBe('Suppress_JumpToggles');
  });

  it('mag==1 Set_Mode impostors are relabeled by the attrib-118 fix (post-regen)', () => {
    // Empathy Resurrect's old exported Set_Mode mag=1 was a misdecoded
    // kXPDebtProtection. Post attrib-118 fix (2026-07-07 re-export) the template
    // is attribs: ['XPDebtProtection'] with NO Set_Mode — so no mag==1 Set_Mode
    // survives here at all.
    const modes = setModes(loadPower('controller_buff/empathy/resurrect.json'));
    const magOne = modes.filter(([mag]) => mag === 1);
    expect(magOne.length).toBe(0);
  });
});

/**
 * Power-level mode gates: `modes_required` / `modes_disallowed` /
 * `modes_suspended`. These are the .def's ModesRequired/ModesDisallowed/
 * ModesSuspended u4-arrays — mode indices into the SAME registry the Set_Mode
 * magnitudes index — resolved to names at export (export_powers.py). A power
 * with `modes_required: ["Domination"]` only fires while the caster is in the
 * Domination mode; `modes_disallowed` blocks it; `modes_suspended` auto-detoggles
 * it. Unlike Set_Mode magnitudes these are dedicated arrays with no attrib-118
 * collision, so ALL indices (including mode 1) are resolved — no mag>=2 gate.
 */
type PowerGates = {
  modes_required?: string[];
  modes_disallowed?: string[];
  modes_suspended?: string[];
};

function gates(rel: string): PowerGates {
  return loadPower(rel) as PowerGates;
}

describe('Power-level mode gates → mode-name resolution (HC)', () => {
  it('Domination inherent is gated to the Domination mode', () => {
    expect(gates('inherent/inherent/domination.json').modes_required).toEqual(['Domination']);
  });

  it('Dual Pistols ammo swap requires the default LethalAmmo mode', () => {
    // You can only swap ammo from the default (Lethal) stance; the swap powers
    // redirect based on current ammo. Also carries the generic Disable_All gate.
    const g = gates('blaster_ranged/dual_pistols/chemical_ammunition.json');
    expect(g.modes_required).toEqual(['LethalAmmo']);
    expect(g.modes_disallowed).toContain('Disable_All');
  });

  it('Titan Weapons Follow_Through requires FastMode (Momentum)', () => {
    expect(gates('brute_melee/titan_weapons/follow_through.json').modes_required).toEqual([
      'FastMode',
    ]);
  });

  it('Stone Armor toggles are suspended in Granite form', () => {
    // Rock Armor (and the other Stone toggles) auto-detoggle under Granite_Mode.
    expect(gates('brute_defense/stone_armor/rock_armor.json').modes_suspended).toEqual([
      'Granite_Mode',
    ]);
  });

  it("Domination's meter sub-powers are suspended while Domination is active", () => {
    expect(gates('inherent/inherent/domination_boost.json').modes_suspended).toEqual([
      'Domination_Active',
    ]);
  });

  it('the generic Disable_All system gate is emitted faithfully on attacks', () => {
    // Disable_All is the engine's "can't act while mezzed" system mode — real
    // data, present on nearly every attack. Emitted, not filtered.
    expect(gates('brute_melee/titan_weapons/follow_through.json').modes_disallowed).toContain(
      'Disable_All',
    );
  });
});
