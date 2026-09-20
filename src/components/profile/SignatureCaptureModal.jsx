import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { X, PenLine, UploadCloud, Eraser, Check } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import Spinner from "@/components/ui/Spinner";
import TabGroup from "@/components/ui/TabGroup";
import { Button } from "@/components/ui/button";
import { signatureService } from "@/services/signatureService";
import { keyOutNearWhite } from "@/utils/signatureImage";

const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 180;
const INK_COLOR = "#1B1620"; // mauve-ink, matches the printed forms' typography token

/**
 * Draws freehand on a transparent canvas, or normalises an uploaded photo of
 * a written signature onto one — either way the result is a PNG with no
 * background, so it never prints a white box over a ruled line. The canvas
 * itself has no automated test: it needs a real Canvas implementation this
 * environment doesn't have. Its contract is that it emits a PNG blob, and
 * that blob's journey from there is what signatureService.test.js covers.
 */
export default function SignatureCaptureModal({ isOpen, onClose, employeeId, onSuccess }) {
  const [activeTab, setActiveTab] = useState("draw");
  const [hasDrawn, setHasDrawn] = useState(false);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState(null);
  const [uploadCanvasReady, setUploadCanvasReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const drawCanvasRef = useRef(null);
  const uploadCanvasRef = useRef(null);
  const drawingRef = useRef(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab("draw");
    setHasDrawn(false);
    setUploadPreviewUrl(null);
    setUploadCanvasReady(false);
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    };
  }, [uploadPreviewUrl]);

  const pointFromEvent = (canvas, e) => {
    const rect = canvas.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return {
      x: ((point.clientX - rect.left) / rect.width) * canvas.width,
      y: ((point.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const startStroke = (e) => {
    e.preventDefault();
    const canvas = drawCanvasRef.current;
    const ctx = canvas.getContext("2d");
    const { x, y } = pointFromEvent(canvas, e);
    drawingRef.current = true;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const continueStroke = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = drawCanvasRef.current;
    const ctx = canvas.getContext("2d");
    const { x, y } = pointFromEvent(canvas, e);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = INK_COLOR;
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const endStroke = () => {
    drawingRef.current = false;
  };

  const clearDrawing = () => {
    const canvas = drawCanvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleFileSelected = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = uploadCanvasRef.current;
      const scale = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight, 1);
      const drawW = img.naturalWidth * scale;
      const drawH = img.naturalHeight * scale;
      const drawX = (canvas.width - drawW) / 2;
      const drawY = (canvas.height - drawH) / 2;

      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, drawX, drawY, drawW, drawH);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      imageData.data.set(keyOutNearWhite(imageData.data));
      ctx.putImageData(imageData, 0, 0);

      setUploadCanvasReady(true);
      if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
      setUploadPreviewUrl(objectUrl);
    };
    img.src = objectUrl;
  };

  const handleSave = async () => {
    const canvas = activeTab === "draw" ? drawCanvasRef.current : uploadCanvasRef.current;

    setSaving(true);
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not export the signature image.");

      const file = new File([blob], "signature.png", { type: "image/png" });
      const updated = await signatureService.saveSignature(employeeId, file);
      toast.success("Signature saved.");
      onSuccess?.(updated);
      onClose();
    } catch (err) {
      toast.error(err.message || "Failed to save signature.");
    } finally {
      setSaving(false);
    }
  };

  const canSave = activeTab === "draw" ? hasDrawn : uploadCanvasReady;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="gap-0 p-0 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
          <h2 className="text-sm font-black text-foreground tracking-wide uppercase">Your Signature</h2>
          <Button
            onClick={onClose}
            variant="ghost" size="icon-xs"
          >
            <X size={18} strokeWidth={2.5} />
          </Button>
        </div>

        <div className="p-6 space-y-4">
          <TabGroup
            variant="pill"
            tabs={[
              { value: "draw", label: "Draw" },
              { value: "upload", label: "Upload a Photo" },
            ]}
            activeTab={activeTab}
            onChange={setActiveTab}
            size="sm"
          />

          {activeTab === "draw" && (
            <div className="space-y-3 animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <PenLine size={13} /> Draw with your mouse or finger
                </p>
                <Button
                  type="button"
                  onClick={clearDrawing}
                  disabled={!hasDrawn}
                  variant="ghost" className="h-auto"
                >
                  <Eraser size={13} /> Clear
                </Button>
              </div>
              <div className="rounded-xl border-2 border-dashed border-border bg-[repeating-linear-gradient(45deg,var(--color-muted)_0,var(--color-muted)_10px,transparent_10px,transparent_20px)]">
                <canvas
                  ref={drawCanvasRef}
                  width={CANVAS_WIDTH}
                  height={CANVAS_HEIGHT}
                  className="w-full touch-none cursor-crosshair"
                  onMouseDown={startStroke}
                  onMouseMove={continueStroke}
                  onMouseUp={endStroke}
                  onMouseLeave={endStroke}
                  onTouchStart={startStroke}
                  onTouchMove={continueStroke}
                  onTouchEnd={endStroke}
                />
              </div>
            </div>
          )}

          {activeTab === "upload" && (
            <div className="space-y-3 animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  A photo of your written signature
                </p>
                <Button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  variant="link"
                >
                  <UploadCloud size={13} /> Choose Photo
                </Button>
              </div>
              <div className="rounded-xl border-2 border-dashed border-border bg-[repeating-linear-gradient(45deg,var(--color-muted)_0,var(--color-muted)_10px,transparent_10px,transparent_20px)] flex items-center justify-center min-h-[180px]">
                {uploadCanvasReady ? (
                  <canvas ref={uploadCanvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="w-full" />
                ) : (
                  <>
                    <canvas ref={uploadCanvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="hidden" />
                    <p className="text-xs text-muted-foreground font-medium py-8">
                      No photo selected yet.
                    </p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileSelected}
              />
              {uploadCanvasReady && (
                <p className="text-[11px] font-semibold text-muted-foreground">
                  The background was removed automatically — check the ink still looks right.
                </p>
              )}
            </div>
          )}

          <Button
            type="button"
            onClick={handleSave}
            disabled={!canSave || saving}
            className="w-full h-11 rounded-xl font-bold shadow-md cursor-pointer"
          >
            {saving ? <Spinner size="sm" /> : <Check size={16} className="mr-1.5" />}
            {saving ? "Saving..." : "Save Signature"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
