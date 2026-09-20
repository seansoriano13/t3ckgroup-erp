import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ImagePlus, Maximize2, ClipboardPaste } from "lucide-react";
import Spinner from "@/components/ui/Spinner";
import { storageService } from "../services/storageService";
import toast from "react-hot-toast";

export default function ImageAttachment({ 
  taskId, 
  userId, 
  attachments = [], 
  onChange, 
  readOnly = false 
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [signedUrls, setSignedUrls] = useState([]);
  const [isLoadingUrls, setIsLoadingUrls] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const fileInputRef = useRef(null);
  // Always reflects latest attachments — avoids stale-closure bug in uploadFiles
  const attachmentsRef = useRef(attachments);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);

  // Core upload logic — shared by file picker and paste handler
  const uploadFiles = useCallback(async (files) => {
    if (!files || files.length === 0) return;

    // Read current attachments from ref to avoid stale closure on paste
    const currentAttachments = attachmentsRef.current;

    if (currentAttachments.length + files.length > 5) {
      toast.error("Maximum 5 images allowed per task.");
      return;
    }

    setIsUploading(true);
    const newPaths = [...currentAttachments];

    try {
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          toast.error(`${file.name} is not an image.`);
          continue;
        }
        if (file.size > 5 * 1024 * 1024) {
          toast.error(`${file.name} is too large (max 5MB).`);
          continue;
        }
        const path = await storageService.uploadTaskAttachment(userId, taskId, file);
        newPaths.push(path);
      }
      onChange(newPaths);
      toast.success("Attachment uploaded!");
    } catch (err) {
      toast.error("Failed to upload: " + err.message);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [taskId, userId, onChange]);

  // Clipboard paste handler  intercepts Ctrl+V screenshots
  useEffect(() => {
    if (readOnly || taskId === "NEW") return;

    const handlePaste = (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imageItems = items.filter((item) => item.type.startsWith("image/"));
      if (imageItems.length === 0) return;

      e.preventDefault();
      toast("Screenshot detected  uploading...", { icon: "??" });
      const files = imageItems.map((item) => {
        const blob = item.getAsFile();
        return new File([blob], `paste_${Date.now()}.png`, { type: blob.type });
      });
      uploadFiles(files);
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [readOnly, taskId, uploadFiles]);

  // Load signed URLs whenever the attachments array changes
  useEffect(() => {
    let isMounted = true;
    
    const loadUrls = async () => {
      if (!attachments || attachments.length === 0) {
        setSignedUrls([]);
        return;
      }
      
      setIsLoadingUrls(true);
      try {
        const urls = await storageService.getSignedUrls(attachments);
        if (isMounted) setSignedUrls(urls);
      } catch (err) {
        console.error("Failed to load attachment URLs:", err);
      } finally {
        if (isMounted) setIsLoadingUrls(false);
      }
    };
    
    loadUrls();
    
    return () => { isMounted = false; };
  }, [attachments]);

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    await uploadFiles(files);
  };

  const handleDelete = async (pathToRemove) => {
    try {
      await storageService.deleteAttachment(pathToRemove);
      const newPaths = attachments.filter(p => p !== pathToRemove);
      onChange(newPaths);
    } catch (err) {
      toast.error("Failed to delete attachment: " + err.message);
    }
  };

  if (readOnly && (!attachments || attachments.length === 0)) {
    return null; // Don't render anything if readonly and no attachments
  }

  return (
    <div className="space-y-3">
      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept="image/jpeg, image/png, image/webp" 
        multiple 
        className="hidden" 
      />

      {/* Gallery */}
      {signedUrls.length > 0 && (
         <div className="grid grid-cols-3 gap-2">
            {signedUrls.map((item, index) => (
              <div key={item.path} className="relative group rounded-lg overflow-hidden border border-mauve-4 bg-mauve-2 aspect-video flex items-center justify-center">
                 {isLoadingUrls ? (
                    <Spinner size="sm" />
                 ) : (
                   <>
                     <img 
                       src={item.signedUrl} 
                       alt={`Attachment ${index + 1}`} 
                       className="object-cover w-full h-full cursor-pointer hover:opacity-90 transition-opacity"
                       onClick={() => setFullscreenImage(item.signedUrl)}
                     />
                     
                     <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                           onClick={(e) => { e.stopPropagation(); setFullscreenImage(item.signedUrl); }}
                           className="bg-black/60 hover:bg-mauve-12/80 text-primary-foreground p-1 rounded backdrop-blur-sm"
                        >
                           <Maximize2 size={12} />
                        </button>
                        {!readOnly && (
                          <button 
                             onClick={(e) => { e.stopPropagation(); handleDelete(item.path); }}
                             className="bg-destructive/80 hover:bg-destructive text-primary-foreground p-1 rounded backdrop-blur-sm"
                          >
                             <X size={12} />
                          </button>
                        )}
                     </div>
                   </>
                 )}
              </div>
            ))}
         </div>
      )}

      {/* Upload Button */}
      {!readOnly && attachments.length < 5 && (
         <div className="space-y-2">
           <button 
             type="button"
             onClick={() => fileInputRef.current?.click()}
             disabled={isUploading || taskId === "NEW"}
             className="w-full py-4 border-2 border-dashed border-mauve-4 rounded-xl flex items-center justify-center gap-2 text-sm font-bold text-muted-foreground hover:border-foreground hover:text-foreground hover:bg-muted transition-all disabled:opacity-50 disabled:cursor-not-allowed"
           >
             {isUploading ? (
                <>
                   <Spinner size="sm" /> Uploading...
                </>
             ) : taskId === "NEW" ? (
               "Save task first to upload attachments"
             ) : (
                <>
                   <ImagePlus size={18} /> Add Images (Max 5)
                </>
             )}
           </button>
           {taskId !== "NEW" && !isUploading && (
             <p className="flex items-center justify-center gap-1.5 text-[11px] text-mauve-7 font-medium">
               <ClipboardPaste size={12} />
               Or paste a screenshot directly (Ctrl+V)
             </p>
           )}
         </div>
      )}

      {/* Fullscreen Lightbox */}
      {fullscreenImage &&
        typeof document !== "undefined" &&
        createPortal(
          <div 
            className="fixed inset-0 z-[9999999] bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm"
            onClick={() => setFullscreenImage(null)}
          >
            <button 
              className="absolute top-6 right-6 text-primary-foreground hover:text-destructive transition-colors bg-black/50 p-2 rounded-full"
              onClick={() => setFullscreenImage(null)}
            >
              <X size={24} />
            </button>
            <img 
              src={fullscreenImage} 
              alt="Fullscreen Attachment" 
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl" 
              onClick={(e) => e.stopPropagation()} 
            />
          </div>,
          document.body
        )}
    </div>
  );
}
