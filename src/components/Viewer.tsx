import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PlicoDoc } from "../engine/plicoDoc";
import { useStore } from "../state/store";
import { viewerApi } from "../state/viewerApi";
import { PageOverlay } from "./PageOverlay";

export const PT = 96 / 72; // pixel CSS per punto PDF a zoom 100%
const GAP = 14;
const MARGIN = 28;

export function Viewer({ doc }: { doc: PlicoDoc }) {
  const version = useSyncExternalStore(doc.subscribe, doc.getSnapshot);
  const zoom = useStore((s) => s.zoom);
  const fit = useStore((s) => s.fit);
  const layout = useStore((s) => s.layout);
  const currentPage = useStore((s) => s.currentPage);
  const patch = useStore((s) => s.patch);

  const scrollRef = useRef<HTMLDivElement>(null);
  const slots = useRef(new Map<number, HTMLElement>());
  const [box, setBox] = useState({ w: 900, h: 600 });
  const [near, setNear] = useState<Set<number>>(new Set([0, 1]));
  const anchor = useRef({ page: 0, frac: 0 });

  const n = doc.pageCount;
  const cols = layout === "two" ? 2 : 1;
  const S = zoom * PT;

  const sizes = useMemo(() => Array.from({ length: n }, (_, i) => doc.size(i)), [doc, n, doc.structVersion]);

  // ----- dimensioni del contenitore -----
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ----- adattamento alla finestra -----
  useEffect(() => {
    if (fit === "none" || !n) return;
    const sample = sizes.slice(0, 40);
    const maxW = Math.max(...sample.map((s) => s[0]), sizes[currentPage]?.[0] ?? 0);
    const availW = box.w - 2 * MARGIN - (cols - 1) * GAP;
    let z = availW / cols / (maxW * PT);
    if (fit === "page") {
      const [pw, ph] = sizes[Math.min(currentPage, n - 1)];
      z = Math.min(availW / cols / (pw * PT), (box.h - 2 * MARGIN) / (ph * PT));
    }
    z = Math.max(0.1, Math.min(8, z));
    if (Math.abs(z - zoom) > 0.0005) patch({ zoom: z });
  }, [fit, box.w, box.h, cols, sizes, n, fit === "page" ? currentPage : -1]);

  // ----- quali pagine sono vicine alla vista -----
  useEffect(() => {
    const root = scrollRef.current!;
    const io = new IntersectionObserver(
      (entries) => {
        setNear((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const i = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(i); else next.delete(i);
          }
          return next;
        });
      },
      { root, rootMargin: "120% 0px" },
    );
    slots.current.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [n, layout, doc.structVersion, currentPage]);

  // ----- pagina corrente durante lo scroll -----
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || layout === "single") return;
    const focus = el.scrollTop + el.clientHeight * 0.3;
    let lo = 0, hi = n - 1, found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = slots.current.get(mid);
      if (!s) { hi = mid - 1; continue; }
      if (s.offsetTop <= focus) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const slot = slots.current.get(found);
    if (slot) anchor.current = { page: found, frac: (focus - slot.offsetTop) / Math.max(slot.offsetHeight, 1) };
    if (found !== useStore.getState().currentPage) {
      const s = useStore.getState();
      patch({ currentPage: found, selectedPages: s.selectedPages.length <= 1 ? [found] : s.selectedPages });
    }
  }, [n, layout, patch]);

  // ----- mantiene il punto di lettura quando cambia lo zoom -----
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const slot = slots.current.get(anchor.current.page);
    if (!el || !slot || layout === "single") return;
    el.scrollTop = slot.offsetTop + anchor.current.frac * slot.offsetHeight - el.clientHeight * 0.3;
  }, [S]);

  // ----- zoom con Ctrl/Cmd + rotellina o pizzico -----
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const z = Math.max(0.1, Math.min(8, useStore.getState().zoom * Math.exp(-e.deltaY * 0.01)));
      patch({ zoom: z, fit: "none" });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [patch]);

  // ----- API per gli altri componenti -----
  useEffect(() => {
    viewerApi.scrollToPage = (page, y = 0) => {
      const el = scrollRef.current;
      if (!el) return;
      patch({ currentPage: page });
      if (layout === "single") { el.scrollTop = 0; return; }
      const slot = slots.current.get(page);
      if (slot) el.scrollTop = slot.offsetTop + y * S - MARGIN / 2;
    };
    viewerApi.reveal = (page, rect) => {
      const el = scrollRef.current;
      if (!el) return;
      patch({ currentPage: page });
      if (layout === "single") return;
      const slot = slots.current.get(page);
      if (!slot) return;
      const top = slot.offsetTop + rect[1] * S, bottom = slot.offsetTop + rect[3] * S;
      if (top < el.scrollTop + 40 || bottom > el.scrollTop + el.clientHeight - 40) {
        el.scrollTop = (top + bottom) / 2 - el.clientHeight / 2;
      }
    };
  }, [layout, S, patch]);

  const indices = layout === "single" ? [Math.min(currentPage, n - 1)] : Array.from({ length: n }, (_, i) => i);

  return (
    <div className="viewer" ref={scrollRef} onScroll={onScroll} data-testid="viewer">
      <div className="pages" style={{ gridTemplateColumns: `repeat(${cols}, max-content)`, padding: MARGIN, gap: GAP }}>
        {indices.map((i) => (
          <div
            key={i}
            className="slot"
            data-page={i}
            ref={(el) => {
              if (el) slots.current.set(i, el); else slots.current.delete(i);
            }}
            style={{ width: sizes[i][0] * S, height: sizes[i][1] * S }}
          >
            {(near.has(i) || layout === "single") && (
              <PageView doc={doc} index={i} S={S} version={version} w={sizes[i][0]} h={sizes[i][1]} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const PageView = memo(function PageView(props: { doc: PlicoDoc; index: number; S: number; version: number; w: number; h: number }) {
  const { doc, index, S, version, w, h } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cw = Math.max(1, Math.round(w * S * dpr));
    const ch = Math.max(1, Math.round(h * S * dpr));
    try {
      const img = doc.render(index, cw / w, ch / h);
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      canvas.getContext("2d")!.putImageData(img, 0, 0);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [doc, index, S, dpr, version, w, h]);

  return (
    <>
      <canvas ref={canvasRef} className="page-canvas" style={{ width: w * S, height: h * S }} />
      {error && <div className="page-error">Impossibile disegnare questa pagina</div>}
      <PageOverlay doc={doc} index={index} S={S} w={w} h={h} version={version} />
    </>
  );
});
