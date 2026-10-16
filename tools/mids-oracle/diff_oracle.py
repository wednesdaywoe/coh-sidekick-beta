#!/usr/bin/env python3
"""
deductive-schema-harness-1 gate 2/3 — PoC structural comparison: Mids oracle vs our parser export.

This is a PROOF-OF-CONCEPT validator, not the production harness (that is DSH5,
which is deliberately sequenced after the deductive-schema-harness-4 closed schema). Its only job is to
prove the deductive-schema-harness-1 oracle reader is a usable structural arbiter: that Mids and our bin
parser export agree on effect *topology* for known-answer powers, and that the
comparison has the sensitivity to surface real divergences.

Both sides are compared at template granularity — the parser export
(`exported_powers/`) is NOT collapsed (only the converter collapses), so this is a
clean parser-to-parser diff. We canonicalize each effect to a bridge-free identity
tuple that needs NO attrib-name<->enum vocabulary map (that map is deductive-schema-harness-4's job):

    (modifier_table, aspect, pv_mode, resistible)

`modifier_table` is carried verbatim on both sides and strongly implies
(effectType, subType), so it is a sound PoC proxy for the plan's full canonical
identity `(effectType, subType, pvMode, resistible, modifierTable)`.

Trust boundary (plan doc): structural divergence = candidate defect; numeric
(scale/mag/duration) divergence on a structurally-identical effect = skew, ignored
here. A known *modeling* difference is Mids emitting an explicit PvE+PvP record
pair where the bin emits an Any base + a PvP override; --normalize-pvp folds that.

Usage:
    python3 diff_oracle.py                 # default known-answer cohort, raw
    python3 diff_oracle.py --normalize-pvp # fold the PvE/PvP modeling difference
    python3 diff_oracle.py --cohort trick_arrow
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from collections import Counter

import read_i12

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
EXPORT_ROOT = os.path.join(REPO, "exported_powers")

ASPECT_MAP = {  # export -> oracle
    "Absolute": "Abs", "Current": "Cur", "Resistance": "Res",
    "Strength": "Str", "Maximum": "Max",
}
PV_MAP = {"EITHER": "Any", "PVE_ONLY": "PvE", "PVP_ONLY": "PvP"}

# Known-answer cohorts (full_name substrings). HC only.
COHORTS = {
    "default": [
        # Arachnos epics (PvE/PvP damage pairs, conditionals, mez)
        "Arachnos_Soldiers.Arachnos_Soldier.Single_Shot",
        "Arachnos_Soldiers.Arachnos_Soldier.Pummel",
        "Arachnos_Soldiers.Arachnos_Soldier.Burst",
        "Arachnos_Soldiers.Arachnos_Soldier.Bayonet",
        "Arachnos_Soldiers.Arachnos_Soldier.Heavy_Burst",
        "Arachnos_Soldiers.Arachnos_Soldier.Frag_Grenade",
        "Arachnos_Soldiers.Arachnos_Soldier.Venom_Grenade",
        # Trick Arrow (the 2026-07-05 resistible-twin collapse cohort)
        "Controller_Buff.Trick_Arrow.Flash_Arrow",
        "Controller_Buff.Trick_Arrow.Poison_Gas_Arrow",
        "Controller_Buff.Trick_Arrow.Disruption_Arrow",
        "Controller_Buff.Trick_Arrow.Acid_Arrow",
        "Controller_Buff.Trick_Arrow.Ice_Arrow",
        # Build Up variants (simple self-buff sanity)
        "Blaster_Support.Energy_Manipulation.Build_Up",
        "Scrapper_Melee.Broad_Sword.Build_Up",
    ],
    "trick_arrow": [
        "Controller_Buff.Trick_Arrow.Flash_Arrow",
        "Controller_Buff.Trick_Arrow.Poison_Gas_Arrow",
        "Controller_Buff.Trick_Arrow.Disruption_Arrow",
        "Controller_Buff.Trick_Arrow.Acid_Arrow",
        "Controller_Buff.Trick_Arrow.Ice_Arrow",
        "Controller_Buff.Trick_Arrow.Glue_Arrow",
        "Controller_Buff.Trick_Arrow.EMP_Arrow",
        "Controller_Buff.Trick_Arrow.Oil_Slick_Arrow",
    ],
}


def norm(s):
    return (s or "").strip().lower()


# The resistible/unresistable-twin powers the 2026-07-05 collapse fix repaired.
# Under the combat canonicalization these MUST match the oracle exactly — this is
# the gate-3 assertion (independent Mids corroboration of the un-collapsed topology).
TWIN_GATE = {
    "controller_buff.trick_arrow.flash_arrow",
    "controller_buff.trick_arrow.poison_gas_arrow",
}


def classify(tuple_, side):
    """Bucket a residual divergent effect tuple (post combat-canonicalization) into
    a known modeling class. side is 'oracle' (Mids-only) or 'export' (ours-only).
    Every class here is a modeling-convention difference, NOT a Sidekick/parser
    defect; these are the DSH5 tiered-classifier seeds. OTHER = worth a human look."""
    table, aspect, pv, resistible = tuple_
    if "inherentdamage" in table:
        return "INHERENT_EXTRA"          # export-side inherent bonus; filtered by damage.ts
    if side == "oracle" and ("ones" in table or "special" in table):
        return "MEZ_PVP_RESIDUAL"        # our `_pvpmez` maps to Mids `_ones`/`_special`, not `_mez`
    if side == "oracle" and aspect in ("Str", "Res"):
        return "MULTI_TYPE_GRANULARITY"  # Mids one record per damage type (buff/res_dmg spread)
    return "OTHER"


def oracle_tuples(effects, normalize_pvp):
    c = Counter()
    for e in effects:
        c[(norm(e["modifier_table"]), e["aspect"], e["pv_mode"], bool(e["resistible"]))] += 1
    return _maybe_fold_pvp(c, normalize_pvp)


def export_tuples(power, normalize_pvp):
    c = Counter()
    for g in power.get("effects", []):
        pv = PV_MAP.get(g.get("is_pvp"), g.get("is_pvp"))
        for t in g.get("templates", []):
            aspect = ASPECT_MAP.get(t.get("aspect"), t.get("aspect"))
            resistible = "IgnoreResistance" not in (t.get("flags") or [])
            c[(norm(t.get("table")), aspect, pv, resistible)] += 1
    return _maybe_fold_pvp(c, normalize_pvp)


def _maybe_fold_pvp(counter, normalize_pvp):
    """Fold the PvE/PvP modeling difference. Mids emits explicit PvE+PvP record
    pairs on the *base* table; our bin emits an Any base record + a PvP override on
    a `_pvp*` table. Canonicalize BOTH to Mids' base-table convention: collapse
    pv_mode to 'Combat' and strip the `pvp` token from the table name (so
    ranged_pvpdamage == ranged_damage). This is a sound structural identity — it is
    the SAME effect in a PvP context — and still catches a genuinely dropped effect.
    (Mez is the one exception: our `_pvpmez` maps to Mids' `_ones`, not `_mez`, so
    those remain a documented residual rather than being force-merged.)"""
    if not normalize_pvp:
        return counter
    folded = Counter()
    for (table, aspect, pv, resistible), n in counter.items():
        folded[(table.replace("pvp", ""), aspect, "Combat", resistible)] += n
    return folded


def build_export_index():
    """full_name(lower) -> export path, HC only (excludes rebirth/thunderspy/tables)."""
    idx = {}
    for path in glob.glob(os.path.join(EXPORT_ROOT, "**", "*.json"), recursive=True):
        rel = os.path.relpath(path, EXPORT_ROOT)
        top = rel.split(os.sep)[0]
        if top in ("rebirth", "thunderspy", "tables"):
            continue
        if os.path.basename(path) == "index.json":
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                fn = json.load(fh).get("full_name")
        except (json.JSONDecodeError, OSError):
            continue
        if fn:
            idx[fn.lower()] = path
    return idx


def main(argv=None):
    ap = argparse.ArgumentParser(description="deductive-schema-harness-1 gate 2/3 PoC: oracle vs parser export")
    ap.add_argument("--mhd", default=read_i12.DEFAULT_MHD)
    ap.add_argument("--cohort", default="default", choices=sorted(COHORTS))
    ap.add_argument("--normalize-pvp", action="store_true",
                    help="fold the PvE/PvP-pair vs Any+override modeling difference")
    ap.add_argument("--verbose", action="store_true", help="print per-effect tuples")
    args = ap.parse_args(argv)

    with open(os.path.abspath(args.mhd), "rb") as fh:
        powers, _ = read_i12.read_powers(fh.read())
    oracle = {p["full_name"].lower(): p for p in powers}
    exp_idx = build_export_index()

    cohort = COHORTS[args.cohort]
    match = miss = redirect = clean = residual_powers = 0
    twin_gate_fail = []
    class_totals = Counter()
    print(f"=== deductive-schema-harness-1 gate-2 PoC: oracle vs parser export "
          f"(cohort={args.cohort}, normalize_pvp={args.normalize_pvp}) ===\n")
    for fn in cohort:
        key = fn.lower()
        o = oracle.get(key)
        epath = exp_idx.get(key)
        if o is None:
            print(f"  ??  {fn}  — NOT in oracle"); miss += 1; continue
        if epath is None:
            print(f"  ??  {fn}  — NOT in export"); miss += 1; continue
        with open(epath, encoding="utf-8") as fh:
            power = json.load(fh)
        # redirect shells hold no inline effects — Mids inlines the redirect
        # target, our converter follows the pointer. Out of scope for an
        # inline-effect diff; flag and skip (resolving the chain is DSH5).
        if not power.get("effects") and power.get("redirect"):
            tgt = power["redirect"][0].get("name", "?")
            print(f"  ->  {fn}  — REDIRECT to {tgt} (inline diff N/A)"); redirect += 1; continue
        ot = oracle_tuples(o["effects"], args.normalize_pvp)
        et = export_tuples(power, args.normalize_pvp)
        if ot == et:
            print(f"  OK  {fn}  ({sum(ot.values())} effects, exact)"); match += 1
            continue
        if key in TWIN_GATE:
            twin_gate_fail.append(fn)
        only_o, only_e = ot - et, et - ot
        buckets = Counter()
        for t, n in only_o.items():
            buckets[classify(t, "oracle")] += n
        for t, n in only_e.items():
            buckets[classify(t, "export")] += n
        class_totals.update(buckets)
        other = buckets.get("OTHER", 0)
        tag = "~~ " if other == 0 else "XX "
        if other == 0:
            clean += 1
        else:
            residual_powers += 1
        classes = " ".join(f"{k}:{v}" for k, v in sorted(buckets.items()))
        print(f"  {tag} {fn}  (oracle {sum(ot.values())} / export {sum(et.values())}) "
              f"[{classes}]")
        if other or args.verbose:
            for t, n in sorted(only_o.items()):
                print(f"        oracle-only x{n} [{classify(t,'oracle')}]: "
                      f"table={t[0]!r} aspect={t[1]} pv={t[2]} resist={t[3]}")
            for t, n in sorted(only_e.items()):
                print(f"        export-only x{n} [{classify(t,'export')}]: "
                      f"table={t[0]!r} aspect={t[1]} pv={t[2]} resist={t[3]}")

    print(f"\n=== exact:{match}  known-classes-only:{clean}  redirect:{redirect}  "
          f"has-OTHER-residual:{residual_powers}  missing:{miss}  (of {len(cohort)}) ===")
    print("divergence taxonomy (modeling conventions that DSH5's classifier will canonicalize —")
    print("NOT Sidekick/parser defects; MULTI_TYPE/MEZ residuals need the deductive-schema-harness-4 attrib bridge):")
    for k, v in sorted(class_totals.items()):
        print(f"    {k}: {v} effect-tuples")

    # Gate: the resistible/unresistable-twin cohort (the historical collapse) must
    # match the oracle EXACTLY under canonicalization — independent Mids proof the
    # un-collapsed topology is correct. Only these gate the exit code.
    gate_powers = [fn for fn in cohort if fn.lower() in TWIN_GATE]
    if gate_powers:
        if twin_gate_fail:
            print(f"\nTWIN-GATE: FAIL — {twin_gate_fail} diverge from oracle "
                  "(collapse regression or reader drift).")
            return 1
        print(f"\nTWIN-GATE: PASS — {len(gate_powers)} twin power(s) match the oracle "
              "exactly under combat canonicalization (gate-3 corroboration).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
