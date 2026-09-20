import { useCallback, useEffect, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, RotateCcw, Check, CropIcon } from "lucide-react";
import Spinner from "@/components/ui/Spinner";
import ModalOverlay from "@/components/ui/ModalOverlay";

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const OUTPUT_SIZE = 400; // square output in px
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function blobToFile(blob, originalName) {
  const ext = "jpg";
  const name = originalName
    ? originalName.replace(/\.[^.]+$/, `.${ext}`)
    : `cropped.${ext}`;
  return new File([blob], name, { type: "image/jpeg" });
}

// ─────────────────────────────────────────────────────────────────────────────
//  COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
/**
 * ImageCropModal
 * @param {object}   props
 * @param {File}     props.file          - Raw image File from <input>
 * @param {boolean}  props.isOpen        - Controlled open state
 * @param {Function} props.onConfirm     - Called with a cropped File
 * @param {Function} props.onCancel      - Called when user dismisses
 */
export default function ImageCropModal({ file, isOpen, onConfirm, onCancel }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const animFrameRef = useRef(null);

  // Interaction state
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imgLoaded, setImgLoaded] = useState(false);
  const [isCropping, setIsCropping] = useState(false);

  // Derived sizes – set once the image is loaded
  const [, setImgNaturalSize] = useState({ w: 1, h: 1 });
  // imgNaturalSize

  // Sync internal state during render when props change to avoid calling setState synchronously within useEffect
  const [prevFile, setPrevFile] = useState(file);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

  if (file !== prevFile || isOpen !== prevIsOpen) {
    setPrevFile(file);
    setPrevIsOpen(isOpen);
    if (file && isOpen) {
      setImgLoaded(false);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    }
  }

  // ── Load image ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!file || !isOpen) return;

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      setImgLoaded(true);
      URL.revokeObjectURL(url);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, isOpen]);

  // ── Draw loop ──────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgLoaded) return;

    const ctx = canvas.getContext("2d");
    const size = canvas.width; // always square

    ctx.clearRect(0, 0, size, size);

    // Calculate how image fits inside canvas at zoom=1 (cover)
    const scale =
      Math.max(size / img.naturalWidth, size / img.naturalHeight) * zoom;
    const drawW = img.naturalWidth * scale;
    const drawH = img.naturalHeight * scale;

    // Clamp offset so image always covers the square canvas
    const maxOffX = (drawW - size) / 2;
    const maxOffY = (drawH - size) / 2;
    const clampedX = clamp(offset.x, -maxOffX, maxOffX);
    const clampedY = clamp(offset.y, -maxOffY, maxOffY);

    const drawX = (size - drawW) / 2 + clampedX;
    const drawY = (size - drawH) / 2 + clampedY;

    ctx.drawImage(img, drawX, drawY, drawW, drawH);

    // Overlay: circle mask
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, [imgLoaded, zoom, offset]);

  useEffect(() => {
    if (!imgLoaded) return;
    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [draw, imgLoaded]);

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const getEventPos = (e) => {
    if (e.touches) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    const pos = getEventPos(e);
    setDragging(true);
    setDragStart({ x: pos.x - offset.x, y: pos.y - offset.y });
  };

  const onPointerMove = useCallback(
    (e) => {
      if (!dragging) return;
      const pos = getEventPos(e);
      setOffset({ x: pos.x - dragStart.x, y: pos.y - dragStart.y });
    },
    [dragging, dragStart],
  );

  const onPointerUp = () => setDragging(false);

  useEffect(() => {
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);
    window.addEventListener("touchmove", onPointerMove, { passive: false });
    window.addEventListener("touchend", onPointerUp);
    return () => {
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("mouseup", onPointerUp);
      window.removeEventListener("touchmove", onPointerMove);
      window.removeEventListener("touchend", onPointerUp);
    };
  }, [onPointerMove]);

  // ── Wheel zoom ─────────────────────────────────────────────────────────────
  const onWheel = (e) => {
    e.preventDefault();
    setZoom((z) =>
      clamp(e.deltaY < 0 ? z + ZOOM_STEP : z - ZOOM_STEP, MIN_ZOOM, MAX_ZOOM),
    );
  };

  // ── Reset ──────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  // ── Crop & export ──────────────────────────────────────────────────────────
  const handleConfirm = async () => {
    setIsCropping(true);
    try {
      const canvas = canvasRef.current;

      // Build output canvas
      const outCanvas = document.createElement("canvas");
      outCanvas.width = OUTPUT_SIZE;
      outCanvas.height = OUTPUT_SIZE;
      const outCtx = outCanvas.getContext("2d");

      // Re-draw at output resolution
      const img = imgRef.current;
      const scale =
        Math.max(
          OUTPUT_SIZE / img.naturalWidth,
          OUTPUT_SIZE / img.naturalHeight,
        ) * zoom;
      const drawW = img.naturalWidth * scale;
      const drawH = img.naturalHeight * scale;
      const previewSize = canvas.width;
      // Ratio between output and preview canvas
      const ratio = OUTPUT_SIZE / previewSize;
      const maxOffX = (drawW - OUTPUT_SIZE) / 2;
      const maxOffY = (drawH - OUTPUT_SIZE) / 2;
      const clampedX = clamp(offset.x * ratio, -maxOffX, maxOffX);
      const clampedY = clamp(offset.y * ratio, -maxOffY, maxOffY);
      const drawX = (OUTPUT_SIZE - drawW) / 2 + clampedX;
      const drawY = (OUTPUT_SIZE - drawH) / 2 + clampedY;

      outCtx.drawImage(img, drawX, drawY, drawW, drawH);

      // Circle clip
      outCtx.save();
      outCtx.globalCompositeOperation = "destination-in";
      outCtx.beginPath();
      outCtx.arc(
        OUTPUT_SIZE / 2,
        OUTPUT_SIZE / 2,
        OUTPUT_SIZE / 2,
        0,
        Math.PI * 2,
      );
      outCtx.fill();
      outCtx.restore();

      outCanvas.toBlob(
        (blob) => {
          const croppedFile = blobToFile(blob, file?.name);
          setIsCropping(false);
          onConfirm(croppedFile);
        },
        "image/jpeg",
        0.92,
      );
    } catch {
      setIsCropping(false);
    }
  };

  // ── Canvas display size (responsive) ──────────────────────────────────────
  // We use a fixed logical size of 280px; the canvas element is sized via CSS.
  const CANVAS_LOGICAL = 280;

  return (
    <ModalOverlay isOpen={isOpen} onClose={onCancel} zIndex="z-[90]" className="[&]:cursor-default" >
      {/* Panel — LogTaskModal design language */}
      <div
        className="relative w-[340px] max-w-[95vw] rounded-2xl bg-popover ring-1 ring-foreground/10 shadow-[0_10px_40px_-10px_rgba(79,70,229,0.18)] flex flex-col overflow-hidden animate-slide-down"
        onMouseUp={onPointerUp}
        onTouchEnd={onPointerUp}
      >

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-mauve-3/40 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-[18px] h-[18px] rounded flex items-center justify-center bg-primary text-primary-foreground font-bold text-[9px] shrink-0">
              <CropIcon size={10} />
            </div>
            <span className="text-xs font-semibold text-muted-foreground">
              Crop Profile Photo
            </span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* ── Canvas area ────────────────────────────────────────────────── */}
        <div className="px-5 pt-5 pb-3 flex flex-col items-center gap-3">
          <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest self-start">
            Drag to reposition · scroll or pinch to zoom
          </p>

          {/* Circular frame */}
          <div
            ref={containerRef}
            className="relative rounded-full overflow-hidden border-2 border-mauve-5 bg-mauve-3 shadow-inner"
            style={{ width: CANVAS_LOGICAL, height: CANVAS_LOGICAL }}
          >
            {!imgLoaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner size="md" />
              </div>
            )}
            <canvas
              ref={canvasRef}
              width={CANVAS_LOGICAL}
              height={CANVAS_LOGICAL}
              className="block cursor-grab active:cursor-grabbing"
              style={{
                width: CANVAS_LOGICAL,
                height: CANVAS_LOGICAL,
                opacity: imgLoaded ? 1 : 0,
                transition: "opacity 0.2s",
              }}
              onMouseDown={onPointerDown}
              onTouchStart={onPointerDown}
              onWheel={onWheel}
            />
          </div>

          {/* ── Zoom controls ──────────────────────────────────────────── */}
          <div className="flex items-center gap-3 w-full">
            <button
              type="button"
              onClick={() => setZoom((z) => clamp(z - ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            >
              <ZoomOut size={14} />
            </button>

            {/* Zoom slider */}
            <div className="flex-1 relative h-1.5 rounded-full bg-mauve-4 overflow-visible">
              <div
                className="absolute left-0 top-0 h-full rounded-full bg-primary transition-all"
                style={{ width: `${((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100}%` }}
              />
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={ZOOM_STEP}
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>

            <button
              type="button"
              onClick={() => setZoom((z) => clamp(z + ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            >
              <ZoomIn size={14} />
            </button>

            <span className="text-[10px] font-black text-mauve-8 w-9 text-right tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="px-5 py-4 border-t border-border bg-muted/30 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-[10px] font-black uppercase tracking-widest transition hover:bg-muted text-muted-foreground"
          >
            <RotateCcw size={12} />
            Reset
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-muted-foreground/80 hover:text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!imgLoaded || isCropping}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-widest shadow-lg shadow-primary/20 transition hover:opacity-90 disabled:opacity-60"
            >
              {isCropping ? (
                <Spinner size="sm" />
              ) : (
                <Check size={13} strokeWidth={3} />
              )}
              Apply
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
