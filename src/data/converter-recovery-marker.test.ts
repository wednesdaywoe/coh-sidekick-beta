import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

// The converter is a CJS build script; pull `extractEffects` out of it directly
// so we can exercise the template→effects mapping without a full regen.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { extractEffects } = require('../../scripts/convert-powerset.cjs');

/**
 * Regression for the @Redlynne report: Rebirth's Stealth (and Tough, Weave,
 * Combat Jumping, Stone Armor, the Kheldian shields, …) carry a no-op
 * Recovery/Regen marker — an `Expression` template the game never fires. Our
 * parser can't yet extract its `magnitude_expression`, so without a guard the
 * converter falls back to scale×table and emits a phantom "+100% Recovery (2s)".
 *
 * The discriminator is the effect group's own `Chance`: the source rolls
 * `fRand < fChance` with fRand drawn from [0,1), so a zero never fires. Genuine
 * scaling Expression buffs — Gamma Boost's HP-scaled recovery/regen, Earthen
 * Embrace, the pseudopet HP heals — carry a chance of 1 and MUST pass through.
 *
 * The guard used to ask the TEMPLATE's `tick_chance` instead, which reached the
 * same markers by accident: Parse6 has no effect group, so the parser lifted the
 * AttribMod's single `Chance` into a synthetic group chance and left the
 * consumed zero on the template — then clamped the group's copy to 1.0. The
 * guard was reading the artifact of that clamp, which is why it fired on Rebirth
 * alone and on no Homecoming template at all. Un-clamped (RB5-b1), both fields
 * select exactly the same corpus templates, and this asks the one that means it.
 *
 * `_groupChance` is the converter-internal field `templatesToAtoms` reads onto
 * each atom's `baseProbability`; the parser tags it from the enclosing group.
 */
describe('converter: chance-0 Expression resource markers are phantoms', () => {
  const recoveryTemplate = (over: Record<string, unknown>) => ({
    attribs: ['Recovery'],
    aspect: 'Current',
    target: 'Self',
    table: 'Melee_Ones',
    scale: 1,
    magnitude: 1,
    // The standing case, stated rather than omitted. `mapApplicationType` throws on a
    // template that names none, because absence encodes `OnTick` on the ATOM and a silent
    // export would give that absence a second cause (data-gaps-177). A hand-built subject has to
    // state what every real template states, or it exercises a path the converter never takes.
    application_type: 'OnTick',
    ...over,
  });

  const recoveryKeys = (tmpl: Record<string, unknown>) =>
    Object.keys(extractEffects([tmpl], 'Test')).filter((k) => /recovery/i.test(k));

  it('drops a chance-0 Expression recovery marker (Stealth phantom)', () => {
    const phantom = recoveryTemplate({
      type: 'Expression',
      _groupChance: 0,
      tick_chance: 0,
      flags: ['IgnoreStrength', 'IgnoreResistance'],
    });
    expect(recoveryKeys(phantom)).toEqual([]);
  });

  it('keeps a chance-1 Expression recovery buff (Gamma Boost scaling recovery)', () => {
    const real = recoveryTemplate({
      type: 'Expression',
      _groupChance: 1,
      tick_chance: 1,
      flags: ['IgnoreResistance'],
    });
    expect(recoveryKeys(real)).toContain('recoveryBuff');
  });

  it('keeps a Magnitude recovery buff (Stamina / Quick Recovery)', () => {
    const stamina = recoveryTemplate({
      type: 'Magnitude',
      _groupChance: 1,
      tick_chance: 1,
      scale: 0.25,
      flags: ['IgnoreResistance'],
    });
    expect(recoveryKeys(stamina)).toContain('recoveryBuff');
  });

  it('drops a chance-0 Expression regen marker too', () => {
    const phantomRegen = {
      ...recoveryTemplate({ type: 'Expression', _groupChance: 0, tick_chance: 0 }),
      attribs: ['Regeneration'],
    };
    const regenKeys = Object.keys(extractEffects([phantomRegen], 'Test')).filter((k) =>
      /regen/i.test(k)
    );
    expect(regenKeys).toEqual([]);
  });

  it('a per-tick roll of zero is not a group that never fires', () => {
    // The two fields are distinct on Homecoming's schema (`Chance` on the group,
    // `TickChance` on the AttribMod), and only the group's answers "does this
    // effect exist for this application". A template that ticks at 0 inside a
    // group that always applies is a real resource buff — reading the old field
    // here would drop it.
    const perTickZero = recoveryTemplate({
      type: 'Expression',
      _groupChance: 1,
      tick_chance: 0,
      flags: ['IgnoreResistance'],
    });
    expect(recoveryKeys(perTickZero)).toContain('recoveryBuff');
  });
});
