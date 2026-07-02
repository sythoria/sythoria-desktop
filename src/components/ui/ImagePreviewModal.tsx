import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ZoomIn, ZoomOut, Download, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { lockBodyScroll, unlockBodyScroll } from "../../utils/scrollLock";
import { useKeybindStore, matchKeybind } from "../../store/useKeybindStore";
import { formatFileSize } from "../../utils/attachments";

interface ImagePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: { url: string; name: string; size?: number }[];
  activeIndex: number;
  onChangeActiveIndex: (index: number) => void;
}

export function ImagePreviewModal({
  isOpen,
  onClose,
  images,
  activeIndex,
  onChangeActiveIndex,
}: ImagePreviewModalProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const keybinds = useKeybindStore((s) => s.keybinds);

  // Reset zoom/pan when image changes (handled in render to avoid ESLint/performance cascading effects)
  const [prevActiveIndex, setPrevActiveIndex] = useState(activeIndex);
  if (activeIndex !== prevActiveIndex) {
    setPrevActiveIndex(activeIndex);
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }

  const handlePrev = useCallback(() => {
    if (activeIndex > 0) {
      onChangeActiveIndex(activeIndex - 1);
    }
  }, [activeIndex, onChangeActiveIndex]);

  const handleNext = useCallback(() => {
    if (activeIndex < images.length - 1) {
      onChangeActiveIndex(activeIndex + 1);
    }
  }, [activeIndex, images.length, onChangeActiveIndex]);

  // Handle Keyboard Shortcuts based on Keybind settings
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape closes the modal
      if (e.key === "Escape") {
        onClose();
        return;
      }

      // Prev image matching settings
      if (matchKeybind(e, keybinds.prevImage.currentCombo)) {
        e.preventDefault();
        handlePrev();
      }
      // Next image matching settings
      else if (matchKeybind(e, keybinds.nextImage.currentCombo)) {
        e.preventDefault();
        handleNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    lockBodyScroll();

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      unlockBodyScroll();
    };
  }, [isOpen, keybinds, handlePrev, handleNext, onClose]);

  if (!isOpen || images.length === 0) return null;

  const currentImage = images[activeIndex];

  // Zoom Math helpers
  const handleZoomIn = () => setScale((s) => Math.min(5, s * 1.25));
  const handleZoomOut = () => {
    setScale((s) => {
      const next = s / 1.25;
      if (next <= 1.05) {
        setPosition({ x: 0, y: 0 });
        return 1;
      }
      return next;
    });
  };

  const handleToggleFit = () => {
    if (scale !== 1) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    } else {
      setScale(2);
    }
  };

  const handleDoubleClick = () => {
    handleToggleFit();
  };

  const handleWheel = (e: React.WheelEvent) => {
    const zoomFactor = 1.05;
    const newScale = e.deltaY < 0 ? Math.min(5, scale * zoomFactor) : Math.max(0.8, scale / zoomFactor);
    setScale(newScale);

    if (newScale <= 1.05) {
      setPosition({ x: 0, y: 0 });
      if (newScale < 1) setScale(1);
    }
  };

  // Pointer drag events for panning
  const handlePointerDown = (e: React.PointerEvent) => {
    if (scale <= 1) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const x = e.clientX - dragStart.current.x;
    const y = e.clientY - dragStart.current.y;

    // Apply bounding box constraints if zoomed in
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const boundX = (rect.width * (scale - 1)) / 2;
      const boundY = (rect.height * (scale - 1)) / 2;

      // Soft clamp dragging
      setPosition({
        x: Math.max(-boundX - 100, Math.min(boundX + 100, x)),
        y: Math.max(-boundY - 100, Math.min(boundY + 100, y)),
      });
    } else {
      setPosition({ x, y });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);

    // Snap back within boundary
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const boundX = (rect.width * (scale - 1)) / 2;
      const boundY = (rect.height * (scale - 1)) / 2;

      setPosition({
        x: Math.max(-boundX, Math.min(boundX, position.x)),
        y: Math.max(-boundY, Math.min(boundY, position.y)),
      });
    }
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const link = document.createElement("a");
    link.href = currentImage.url;
    link.download = currentImage.name || "attachment-image";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex flex-col backdrop-blur-md select-none overflow-hidden"
        style={{ backgroundColor: "var(--theme-overlay)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        {/* Header bar */}
        <div className="absolute top-0 left-0 right-0 h-24 pt-10 pl-6 pr-6 flex items-start justify-between z-20 bg-gradient-to-b from-surface/80 to-transparent pointer-events-none">
          <div className="pointer-events-auto flex flex-col max-w-[70%]">
            <span className="text-text-primary font-semibold text-sm truncate" title={currentImage.name}>
              {currentImage.name}
            </span>
            {currentImage.size !== undefined && (
              <span className="text-text-secondary text-xs mt-0.5">{formatFileSize(currentImage.size)}</span>
            )}
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-hover active:scale-95 transition-all"
              title="Download image"
            >
              <Download size={20} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-hover active:scale-95 transition-all"
              title="Close viewer (Esc)"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Viewport wrapper */}
        <div
          ref={containerRef}
          className={`w-full h-full flex items-center justify-center overflow-hidden relative ${
            scale > 1 ? (isDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default"
          }`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
        >
          {/* Backdrop click to close */}
          {scale <= 1 && <div className="absolute inset-0 z-0" onClick={onClose} aria-hidden="true" />}

          <motion.img
            key={activeIndex}
            src={currentImage.url}
            alt={currentImage.name}
            draggable={false}
            onDoubleClick={handleDoubleClick}
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transition: isDragging ? "none" : "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            className="max-w-[90vw] max-h-[85vh] object-contain rounded shadow-2xl z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
        </div>

        {/* Chevrons */}
        {activeIndex > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            className="absolute left-6 top-1/2 -translate-y-1/2 z-20 bg-surface/50 hover:bg-surface/80 text-text-primary p-3 rounded-full border border-border backdrop-blur-sm transition-all duration-200 active:scale-95"
            title="Previous image"
          >
            <ChevronLeft size={24} />
          </button>
        )}
        {activeIndex < images.length - 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            className="absolute right-6 top-1/2 -translate-y-1/2 z-20 bg-surface/50 hover:bg-surface/80 text-text-primary p-3 rounded-full border border-border backdrop-blur-sm transition-all duration-200 active:scale-95"
            title="Next image"
          >
            <ChevronRight size={24} />
          </button>
        )}

        {/* Bottom Toolbar */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2 rounded-full border border-border bg-surface/85 backdrop-blur-md shadow-2xl text-text-primary">
          <button
            onClick={handleZoomOut}
            disabled={scale <= 1}
            className="p-1.5 hover:bg-hover disabled:opacity-30 disabled:hover:bg-transparent rounded-full transition-colors active:scale-95"
            title="Zoom Out"
          >
            <ZoomOut size={16} />
          </button>
          <span className="text-xs font-mono min-w-[44px] text-center select-none">{Math.round(scale * 100)}%</span>
          <button
            onClick={handleZoomIn}
            disabled={scale >= 5}
            className="p-1.5 hover:bg-hover disabled:opacity-30 disabled:hover:bg-transparent rounded-full transition-colors active:scale-95"
            title="Zoom In"
          >
            <ZoomIn size={16} />
          </button>
          <div className="w-[1px] h-4 bg-border" />
          <button
            onClick={handleToggleFit}
            className="p-1.5 hover:bg-hover rounded-full transition-colors active:scale-95 text-text-secondary hover:text-text-primary"
            title={scale !== 1 ? "Reset zoom (Fit)" : "Zoom 200%"}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
