"use client";

import Image from "next/image";
import {
  Expand,
  Minus,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { VerglasMapOverlay } from "@/components/VerglasMapOverlay";
import { isDrawnHome, type MapHome } from "@/lib/verglas-map";

const MIN_ZOOM = 1;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.25;
const MAP_ALT =
  "An illustrated map of Verglas, with homes and establishments gathered around rivers, roads, and warm lights";

interface Point {
  x: number;
  y: number;
}

interface DragStart extends Point {
  pointerId: number;
  panX: number;
  panY: number;
}

const controlClass =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#a67b3c]/40 bg-ink-900/80 text-ink-300 transition-colors hover:border-[#d0aa62]/70 hover:bg-ink-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-35";

export function VerglasTownView({ homes }: { homes: MapHome[] }) {
  const paintedHomes = homes.filter((home) => isDrawnHome(home.handle));
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragStart | null>(null);

  const clampPan = useCallback((next: Point, atZoom: number): Point => {
    const viewport = viewportRef.current;
    const map = mapRef.current;
    if (!viewport || !map || atZoom <= MIN_ZOOM) return { x: 0, y: 0 };

    const maxX = Math.max(0, (map.offsetWidth * atZoom - viewport.clientWidth) / 2);
    const maxY = Math.max(0, (map.offsetHeight * atZoom - viewport.clientHeight) / 2);

    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }, []);

  const changeZoom = useCallback(
    (amount: number) => {
      setZoom((current) =>
        Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current + amount)),
      );
    },
    [],
  );

  const resetView = useCallback(() => {
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
  }, []);

  function openMap() {
    resetView();
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;

    const bodyOverflow = document.body.style.overflow;
    const opener = openerRef.current;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus());

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        changeZoom(ZOOM_STEP);
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        changeZoom(-ZOOM_STEP);
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        resetView();
        return;
      }
      if (event.key !== "Tab") return;

      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
        "a[href], button:not(:disabled)",
      );
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = bodyOverflow;
      opener?.focus();
    };
  }, [changeZoom, open, resetView]);

  useEffect(() => {
    if (!open) return;
    function keepMapInFrame() {
      setPan((current) => clampPan(current, zoom));
    }
    keepMapInFrame();
    window.addEventListener("resize", keepMapInFrame);
    return () => window.removeEventListener("resize", keepMapInFrame);
  }, [clampPan, open, zoom]);

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (zoom <= MIN_ZOOM) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    setPan(
      clampPan(
        {
          x: drag.panX + event.clientX - drag.x,
          y: drag.panY + event.clientY - drag.y,
        },
        zoom,
      ),
    );
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <>
      <figure className="animate-slide-up opacity-0 [animation-delay:180ms] [animation-fill-mode:forwards]">
        <div
          className="rounded-md border border-[#d8b875]/70 bg-gradient-to-br from-[#d6b56f] via-[#5c3d1b] to-[#bb8d48] p-[3px] shadow-[0_24px_70px_-24px_rgba(0,0,0,0.9),0_0_38px_-16px_rgba(210,168,92,0.45)]"
        >
          <div className="rounded-[3px] border border-[#2b1b0d] bg-ink-950 p-1">
            <button
              ref={openerRef}
              type="button"
              onClick={openMap}
              aria-haspopup="dialog"
              aria-label="Open an enlarged, zoomable view of the map of Verglas"
              className="group relative block aspect-[3/2] w-full overflow-hidden bg-ink-950 text-left"
            >
              <Image
                src="/verglas-map-v2.png"
                alt={MAP_ALT}
                fill
                preload
                quality={90}
                sizes="(max-width: 1023px) calc(100vw - 2rem), 420px"
                className="object-cover transition-transform duration-500 ease-soft group-hover:scale-[1.025]"
              />
              <VerglasMapOverlay homes={paintedHomes} mode="preview" />
              <span className="absolute inset-0 bg-gradient-to-t from-ink-950/75 via-transparent to-transparent opacity-70 transition-opacity group-hover:opacity-100" />
              <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-lg border border-[#d8b875]/45 bg-ink-950/80 px-2.5 py-1.5 text-xs font-medium text-ink-100 shadow-lg backdrop-blur-sm">
                <Expand className="h-3.5 w-3.5 text-[#e2bd72]" aria-hidden="true" />
                Explore
              </span>
            </button>
          </div>
        </div>
        <figcaption className="mt-2.5 flex items-center justify-between gap-4 px-1 text-xs text-ink-500">
          <span>
            {paintedHomes.length} home{paintedHomes.length === 1 ? "" : "s"}, painted into town
          </span>
          <span className="text-[#c6a263]">open to look closer</span>
        </figcaption>
      </figure>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-ink-950/90 p-2 backdrop-blur-md sm:p-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Explore the map of Verglas"
            className="flex h-[min(94vh,960px)] w-full max-w-[90rem] flex-col overflow-hidden rounded-xl border border-[#c39a55]/60 bg-ink-950 shadow-[0_30px_100px_rgba(0,0,0,0.8),0_0_50px_-24px_rgba(214,181,111,0.55)]"
          >
            <div className="flex min-h-14 items-center justify-between gap-3 border-b border-[#9c7135]/35 bg-ink-900/95 px-3 sm:px-4">
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-semibold text-ink-100 sm:text-base">
                  Verglas from further out
                </p>
                <p className="hidden text-xs text-ink-500 sm:block">
                  Zoom in, then drag the map to travel.
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => changeZoom(-ZOOM_STEP)}
                  disabled={zoom <= MIN_ZOOM}
                  aria-label="Zoom out"
                  title="Zoom out (−)"
                  className={controlClass}
                >
                  <Minus className="h-4 w-4" aria-hidden="true" />
                </button>
                <output
                  className="hidden w-11 text-center font-mono text-[11px] text-[#d8b875] xs:block"
                  aria-live="polite"
                  aria-label={`Map zoom ${Math.round(zoom * 100)} percent`}
                >
                  {Math.round(zoom * 100)}%
                </output>
                <button
                  type="button"
                  onClick={() => changeZoom(ZOOM_STEP)}
                  disabled={zoom >= MAX_ZOOM}
                  aria-label="Zoom in"
                  title="Zoom in (+)"
                  className={controlClass}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={resetView}
                  disabled={zoom === MIN_ZOOM && pan.x === 0 && pan.y === 0}
                  aria-label="Reset map view"
                  title="Reset view (0)"
                  className={controlClass}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                </button>
                <span className="mx-0.5 h-6 w-px bg-ink-700/70" aria-hidden="true" />
                <button
                  ref={closeRef}
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close map"
                  title="Close (Escape)"
                  className={controlClass}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div
              ref={viewportRef}
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              className={`relative flex min-h-0 flex-1 select-none items-center justify-center overflow-hidden bg-[#070b10] ${
                zoom > MIN_ZOOM ? "cursor-grab active:cursor-grabbing" : "cursor-default"
              }`}
              style={{ touchAction: "none" }}
            >
              <div
                ref={mapRef}
                className="relative aspect-[3/2] w-full max-w-[calc((100vh-11rem)*1.5)] shrink-0 will-change-transform"
                style={{
                  transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
                }}
              >
                <div
                  className="absolute inset-0 will-change-transform"
                  style={{ transform: `scale(${zoom})` }}
                >
                  <Image
                    src="/verglas-map-v2.png"
                    alt={MAP_ALT}
                    fill
                    unoptimized
                    draggable={false}
                    className="pointer-events-none object-contain"
                  />
                  <VerglasMapOverlay homes={paintedHomes} mode="explore" />
                </div>
              </div>
            </div>

            <p className="border-t border-[#9c7135]/25 bg-ink-900/90 px-4 py-2 text-center text-[11px] text-ink-500">
              Use the controls or scroll to zoom · drag to move · press 0 to reset
            </p>
          </div>
        </div>
      )}
    </>
  );
}
