/**
 * BuildImageModal — export the current build as a shareable PNG. Presets
 * (Compact / Standard / Full) seed a set of fine-tuning toggles; a live preview
 * of the off-screen BuildImageCard updates as options change; Download and Copy
 * rasterize the full-size card via html-to-image.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Modal, ModalBody, ModalFooter } from './Modal';
import { Button } from '@/components/ui';
import { useBuildStore, useUIStore, useAuthStore } from '@/stores';
import { useCalculatedStats, useCharacterCalculation, useActiveSetBonuses } from '@/hooks';
import { getBaselineHealth } from '@/utils/calculations/stats';
import { computeAllStats } from '@/utils/detailed-totals';
import { getDefenseSoftcap } from '@/data/purple-patch';
import { publicProviderName } from '@/utils/author-identity';
import { renderNodeToPng, downloadBlob, copyPngToClipboard, slugifyFilename } from '@/utils/export-image';
import { BuildImageCard, CARD_WIDTH } from '@/components/export-image/BuildImageCard';
import {
  ALL_STAT_SECTIONS,
  applyPreset,
  createDefaultOptions,
  type ExportImageOptions,
  type ExportPreset,
} from '@/components/export-image/exportOptions';

interface BuildImageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESETS: { id: ExportPreset; label: string; hint: string }[] = [
  { id: 'compact', label: 'Compact', hint: 'Powers + slots only.' },
  { id: 'standard', label: 'Standard', hint: 'Powers + key totals.' },
  { id: 'full', label: 'Full', hint: 'All totals + set bonuses.' },
];

type Busy = 'idle' | 'download' | 'copy' | 'copied' | 'error';

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-gray-600 bg-gray-700 text-[var(--color-primary)] focus:ring-[var(--color-ring)] focus:ring-offset-gray-900"
      />
      {label}
    </label>
  );
}

export function BuildImageModal({ isOpen, onClose }: BuildImageModalProps) {
  const build = useBuildStore((s) => s.build);
  const user = useAuthStore((s) => s.user);
  const colorTheme = useUIStore((s) => s.colorTheme);
  const colorMode = useUIStore((s) => s.colorMode);
  const rechargeMidsStyle = useUIStore((s) => s.rechargeMidsStyle);
  // Same softcap the dashboard and the totals sheet read — a poster that disagreed with the
  // planner it was exported from would be the worst place to disagree.
  const targetLevelOffset = useUIStore((s) => s.targetLevelOffset);
  const contentMode = useUIStore((s) => s.contentMode);
  const defenseSoftcap = getDefenseSoftcap(targetLevelOffset, contentMode);
  const showToast = useUIStore((s) => s.showToast);

  const stats = useCalculatedStats();
  const calcResult = useCharacterCalculation();
  const setBonuses = useActiveSetBonuses();

  const [options, setOptions] = useState<ExportImageOptions>(() => createDefaultOptions());
  const [busy, setBusy] = useState<Busy>('idle');
  const [cardHeight, setCardHeight] = useState(0);
  const [previewW, setPreviewW] = useState(760);
  const captureRef = useRef<HTMLDivElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);

  // Seed a sensible author default (signed-in name) the first time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setBusy('idle');
      setOptions((prev) =>
        prev.authorName ? prev : { ...prev, authorName: publicProviderName(user?.user_metadata) },
      );
    }
  }, [isOpen, user]);

  const allStats = useMemo(() => {
    const h = getBaselineHealth(build.archetype?.id ?? undefined, build.level);
    return computeAllStats(
      stats,
      calcResult.globalBonuses,
      calcResult.breakdown,
      h.baseHealth,
      h.maxHealth,
      build.archetype?.id ?? undefined,
      rechargeMidsStyle,
      defenseSoftcap,
    );
  }, [stats, calcResult, build.archetype?.id, build.level, rechargeMidsStyle, defenseSoftcap]);

  // Track the off-screen card's true height so the preview box can size to the
  // scaled card (transform: scale doesn't shrink the layout box, so without this
  // the preview reserves the full unscaled height → a tall, empty column).
  useLayoutEffect(() => {
    const node = captureRef.current;
    if (!node || !isOpen) return;
    const measure = () => setCardHeight(node.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [isOpen]);

  // Fit the preview to the available column width (the modal is wide, so the
  // preview should fill it rather than sit at a fixed narrow size).
  useLayoutEffect(() => {
    const el = previewBoxRef.current;
    if (!el || !isOpen) return;
    const measure = () => setPreviewW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOpen]);

  const set = (patch: Partial<ExportImageOptions>) => setOptions((o) => ({ ...o, ...patch }));
  const choosePreset = (preset: ExportPreset) => setOptions((o) => applyPreset(preset, o));
  const toggleSection = (name: string) =>
    setOptions((o) => ({
      ...o,
      statSections: o.statSections.includes(name)
        ? o.statSections.filter((n) => n !== name)
        : [...o.statSections, name],
    }));

  const handleExport = async (mode: 'download' | 'copy') => {
    const node = captureRef.current;
    if (!node) return;
    setBusy(mode);
    try {
      const blob = await renderNodeToPng(node, {
        scale: options.scale,
        backgroundColor: options.transparent ? undefined : undefined, // card paints its own bg
      });
      if (mode === 'download') {
        downloadBlob(blob, `${slugifyFilename(build.name)}_${Date.now()}.png`);
        showToast({ message: 'Build image downloaded', tone: 'success' });
        setBusy('idle');
      } else {
        const ok = await copyPngToClipboard(blob);
        if (ok) {
          showToast({ message: 'Build image copied to clipboard', tone: 'success' });
          setBusy('copied');
          setTimeout(() => setBusy('idle'), 1500);
        } else {
          showToast({ message: 'Clipboard images not supported here — use Download', tone: 'warning' });
          setBusy('idle');
        }
      }
    } catch (err) {
      console.error('Build image export failed:', err);
      showToast({ message: 'Image export failed', tone: 'warning' });
      setBusy('error');
      setTimeout(() => setBusy('idle'), 1500);
    }
  };

  // Preview scales the full-size card down to fit the measured column width.
  const previewScale = previewW / CARD_WIDTH;

  const card = (
    <BuildImageCard
      build={build}
      allStats={allStats}
      setBonuses={setBonuses}
      options={options}
      colorTheme={colorTheme}
      colorMode={colorMode}
    />
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Export as Image" size="full">
      <ModalBody>
        <div className="flex flex-col lg:flex-row gap-5">
          {/* ── Controls ── */}
          <div className="lg:w-[300px] shrink-0 space-y-4">
            {/* Preset */}
            <div>
              <div className="text-xs font-semibold text-gray-300 uppercase mb-1.5">Detail preset</div>
              <div className="flex gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => choosePreset(p.id)}
                    title={p.hint}
                    className={`flex-1 px-2 py-1.5 rounded text-sm border transition-colors ${
                      options.preset === p.id
                        ? 'bg-[var(--color-primary)] border-[var(--color-primary-hover)] text-on-primary'
                        : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                {PRESETS.find((p) => p.id === options.preset)?.hint} Tweak below.
              </div>
            </div>

            {/* Author */}
            <div>
              <label className="text-xs font-semibold text-gray-300 uppercase mb-1.5 block">Author / character</label>
              <input
                type="text"
                value={options.authorName}
                onChange={(e) => set({ authorName: e.target.value })}
                placeholder="Optional credit"
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]/50"
              />
            </div>

            {/* Header + power toggles */}
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-gray-300 uppercase">Include</div>
              <Check label="Character level" checked={options.showLevel} onChange={(v) => set({ showLevel: v })} />
              <Check label="Origin" checked={options.showOrigin} onChange={(v) => set({ showOrigin: v })} />
              <Check label="Inherent powers" checked={options.showInherents} onChange={(v) => set({ showInherents: v })} />
              <Check label="Incarnates" checked={options.showIncarnates} onChange={(v) => set({ showIncarnates: v })} />
              <Check label="Only slotted powers" checked={options.onlySlotted} onChange={(v) => set({ onlySlotted: v })} />
              <Check label="Enhancement icons" checked={options.showEnhancements} onChange={(v) => set({ showEnhancements: v })} />
              <Check label="Set bonuses" checked={options.showSetBonuses} onChange={(v) => set({ showSetBonuses: v })} />
              <Check label="Date + app credit" checked={options.showCredit} onChange={(v) => set({ showCredit: v })} />
            </div>

            {/* Stat sections */}
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-gray-300 uppercase">Stat sections</div>
              <div className="grid grid-cols-1 gap-1">
                {ALL_STAT_SECTIONS.map((name) => (
                  <Check key={name} label={name} checked={options.statSections.includes(name)} onChange={() => toggleSection(name)} />
                ))}
              </div>
            </div>

            {/* Appearance */}
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-gray-300 uppercase">Appearance</div>
              <Check label="Transparent background" checked={options.transparent} onChange={(v) => set({ transparent: v })} />
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <span>Resolution</span>
                {[1, 2].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => set({ scale: s })}
                    className={`px-2 py-0.5 rounded text-xs border ${
                      options.scale === s
                        ? 'bg-[var(--color-primary)] border-[var(--color-primary-hover)] text-on-primary'
                        : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Preview ── */}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-gray-300 uppercase mb-1.5">Preview</div>
            <div
              ref={previewBoxRef}
              className="rounded-lg border border-gray-700 overflow-auto bg-[repeating-conic-gradient(#1f2937_0_25%,#111827_0_50%)] bg-[length:20px_20px]"
              style={{ maxHeight: '68vh' }}
            >
              {/* Box sized to the SCALED card so there's no dead space (see the
                  cardHeight measurement above). Inner node keeps its true size
                  and is visually scaled with a transform. */}
              <div style={{ width: previewW, height: cardHeight ? cardHeight * previewScale : undefined }}>
                <div style={{ transform: `scale(${previewScale})`, transformOrigin: 'top left', width: CARD_WIDTH }}>
                  {card}
                </div>
              </div>
            </div>
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <div className="flex items-center justify-between w-full gap-2 flex-wrap">
          <div className="text-[11px] text-gray-500 max-w-[40ch]">
            PNG renders locally — nothing is uploaded.
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
            <Button variant="secondary" size="sm" onClick={() => handleExport('copy')} disabled={busy === 'copy'}>
              {busy === 'copied' ? 'Copied!' : busy === 'copy' ? 'Copying…' : 'Copy to Clipboard'}
            </Button>
            <Button variant="primary" size="sm" onClick={() => handleExport('download')} disabled={busy === 'download'}>
              {busy === 'download' ? 'Rendering…' : 'Download PNG'}
            </Button>
          </div>
        </div>
      </ModalFooter>

      {/* Off-screen full-size capture node. Kept in-DOM (not display:none) so
          html-to-image can measure and rasterize it at true CARD_WIDTH. */}
      <div aria-hidden style={{ position: 'fixed', left: -100000, top: 0, pointerEvents: 'none', opacity: 0 }}>
        <div ref={captureRef}>{card}</div>
      </div>
    </Modal>
  );
}
