/**
 * PopOutInfoPanel — the InfoPanel in a floating draggable/resizable window.
 *
 * The drag/resize/portal shell lives in the shared `FloatingWindow` primitive
 * (rearrangeable-layout-10); this component supplies only the Dock action + the InfoPanel body.
 * Position + size persist via the `info-panel` persistKey.
 */

import { InfoPanel } from './InfoPanel';
import { FloatingWindow } from '@/components/ui';
import { useUIStore } from '@/stores';

export function PopOutInfoPanel() {
  const dockInfoPanel = useUIStore((s) => s.dockInfoPanel);

  return (
    <FloatingWindow
      title="Power Info"
      persistKey="info-panel"
      defaultWidth={380}
      defaultHeight={500}
      minWidth={280}
      minHeight={200}
      defaultY={80}
      headerRight={
        <button
          onClick={dockInfoPanel}
          className="flex items-center gap-1 px-2 py-0.5 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          title="Dock panel back into main layout"
        >
          {/* Dock icon */}
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
          </svg>
          Dock
        </button>
      }
    >
      <InfoPanel />
    </FloatingWindow>
  );
}
