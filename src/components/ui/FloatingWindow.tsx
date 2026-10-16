/**
 * FloatingWindow — the one reusable draggable/resizable floating panel.
 *
 * Rendered via createPortal to document.body so it floats above all content.
 * Draggable by its header bar (anything but a button in the header starts a
 * drag), resizable via the bottom-right corner handle. Owns its own
 * position/size state and the global mousemove/mouseup listeners.
 *
 * Callers supply only the header title, an optional header-right action node
 * (dock / close button), and the body. Pass `persistKey` to remember position
 * + size across reloads via `uiStore.floatingWindows`.
 *
 * Extracted from the previously-duplicated PopOutInfoPanel + SetBonusPopup
 * desktop shells (rearrangeable-layout-10).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore } from '@/stores';

interface FloatingWindowProps {
  /** Header title text. */
  title: string;
  /** Optional node rendered at the right of the header (e.g. a Dock/Close button). */
  headerRight?: React.ReactNode;
  /** Window body. Rendered inside a `flex-1 overflow-y-auto` scroll area. */
  children: React.ReactNode;
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  /** Initial top offset (px) when no persisted position exists. */
  defaultY?: number;
  /**
   * When set, position + size persist to `uiStore.floatingWindows[persistKey]`
   * (written on drag/resize end) and are restored on mount.
   */
  persistKey?: string;
  /** Extra classes for the scrollable body wrapper (defaults to `p-2`). */
  bodyClassName?: string;
}

export function FloatingWindow({
  title,
  headerRight,
  children,
  defaultWidth = 380,
  defaultHeight = 500,
  minWidth = 280,
  minHeight = 200,
  defaultY = 80,
  persistKey,
  bodyClassName = 'p-2',
}: FloatingWindowProps) {
  const setFloatingWindow = useUIStore((s) => s.setFloatingWindow);

  // Seed from persisted geometry if present, else default to the right edge.
  const [pos, setPos] = useState(() => {
    const saved = persistKey ? useUIStore.getState().floatingWindows[persistKey] : undefined;
    if (saved) return { x: saved.x, y: saved.y };
    return { x: Math.max(16, window.innerWidth - defaultWidth - 16), y: defaultY };
  });
  const [size, setSize] = useState(() => {
    const saved = persistKey ? useUIStore.getState().floatingWindows[persistKey] : undefined;
    if (saved) return { w: saved.w, h: saved.h };
    return { w: defaultWidth, h: defaultHeight };
  });

  // Drag state
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Resize state
  const resizing = useRef(false);
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  // Latest geometry, updated synchronously inside the move handler so the
  // mouseup persist write never lags the final mousemove's (async) setState.
  const geom = useRef({ pos, size });

  const onDragStart = useCallback((e: React.MouseEvent) => {
    // Only drag from the header area (not buttons inside it).
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  }, [pos.x, pos.y]);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
  }, [size.w, size.h]);

  // Global mousemove/mouseup for drag and resize.
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (dragging.current) {
        const newX = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - dragOffset.current.x));
        const newY = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragOffset.current.y));
        geom.current.pos = { x: newX, y: newY };
        setPos({ x: newX, y: newY });
      }
      if (resizing.current) {
        const dx = e.clientX - resizeStart.current.x;
        const dy = e.clientY - resizeStart.current.y;
        const w = Math.max(minWidth, resizeStart.current.w + dx);
        const h = Math.max(minHeight, resizeStart.current.h + dy);
        geom.current.size = { w, h };
        setSize({ w, h });
      }
    };

    const onMouseUp = () => {
      const wasInteracting = dragging.current || resizing.current;
      dragging.current = false;
      resizing.current = false;
      if (wasInteracting && persistKey) {
        const { pos: p, size: s } = geom.current;
        setFloatingWindow(persistKey, { x: p.x, y: p.y, w: s.w, h: s.h });
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [minWidth, minHeight, persistKey, setFloatingWindow]);

  return createPortal(
    <div
      className="fixed z-50 flex flex-col bg-slate-900 border border-slate-600 rounded-lg shadow-2xl overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      {/* Draggable header */}
      <div
        className="flex items-center justify-between px-3 py-1.5 bg-slate-800 border-b border-slate-700 shrink-0 cursor-move select-none"
        onMouseDown={onDragStart}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">{title}</h2>
        {headerRight}
      </div>

      {/* Scrollable body */}
      <div className={`flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>

      {/* Resize handle (bottom-right corner) */}
      <div className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize" onMouseDown={onResizeStart}>
        <svg className="w-4 h-4 text-slate-500" viewBox="0 0 16 16" fill="currentColor">
          <path d="M14 14H12V12H14V14ZM14 10H12V8H14V10ZM10 14H8V12H10V14Z" />
        </svg>
      </div>
    </div>,
    document.body
  );
}
