import React, { useState, useRef, useEffect, useCallback, forwardRef } from "react";
import { createPortal } from "react-dom";

const Dropdown = forwardRef(
  (
    {
      trigger,
      children,
      isOpen: controlledIsOpen,
      onToggle,
      onClose,
      className = "",
      popoverClassName = "absolute top-full left-0 mt-1.5 bg-muted border border-border rounded-xl shadow-2xl z-[10001] min-w-[150px] popover-enter p-1",
      placement = "bottom-start", // bottom-start, bottom-end, etc.
      disabled = false,
      usePortal = false,
    },
    ref,
  ) => {
    const [internalIsOpen, setInternalIsOpen] = useState(false);
    const [coords, setCoords] = useState(null);
    const dropdownRef = useRef(null);
    const popoverRef = useRef(null);

    const isControlled = controlledIsOpen !== undefined;
    const isOpen = isControlled ? controlledIsOpen : internalIsOpen;

    // Compute coords from the trigger element
    const computeCoords = useCallback(() => {
      if (!dropdownRef.current) return null;
      const rect = dropdownRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const windowWidth = window.innerWidth;
      
      const spaceBelow = windowHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      
      const isExplicitTop = placement.startsWith("top");
      const shouldFlipTop =
        isExplicitTop ||
        (placement.startsWith("bottom") &&
          spaceBelow < 220 &&
          spaceAbove > spaceBelow);

      const availableHeight = shouldFlipTop
        ? Math.max(140, Math.min(spaceAbove, 380))
        : Math.max(140, Math.min(spaceBelow, 380));

      return {
        left: rect.left,
        top: rect.bottom,
        rectTop: rect.top,
        width: rect.width,
        right: windowWidth - rect.right,
        windowHeight,
        windowWidth,
        shouldFlipTop,
        availableHeight,
      };
    }, [placement]);

    const updateCoords = useCallback(() => {
      const next = computeCoords();
      if (!next) return;
      setCoords((prev) => {
        if (
          prev &&
          prev.left === next.left &&
          prev.top === next.top &&
          prev.rectTop === next.rectTop &&
          prev.width === next.width &&
          prev.right === next.right &&
          prev.windowHeight === next.windowHeight &&
          prev.shouldFlipTop === next.shouldFlipTop &&
          prev.availableHeight === next.availableHeight
        ) {
          return prev;
        }
        return next;
      });
    }, [computeCoords]);

    const handleToggle = (e) => {
      if (disabled) return;
      if (e) {
        e.stopPropagation();
      }

      // Pre-compute coords before opening so portal positions correctly on first paint
      if (!isOpen && usePortal) {
        updateCoords();
      }

      if (isControlled) {
        if (onToggle) onToggle();
      } else {
        setInternalIsOpen((prev) => !prev);
        if (onToggle && !internalIsOpen) onToggle();
      }
    };

    useEffect(() => {
      if (isOpen && usePortal) {
        // Also update coords when controlled isOpen changes from outside.
        // Using requestAnimationFrame avoids calling setState synchronously within the effect body
        // and prevents cascading renders on mount/update.
        const frameId = requestAnimationFrame(updateCoords);
        // Reposition on window resize
        window.addEventListener("resize", updateCoords);
        // Optional: hide or reposition on scroll
        const handleScroll = (e) => {
          // If clicking inside the popover causes scroll, ignore it
          if (e.target.closest?.(".popover-enter")) return;
          updateCoords();
        };
        // use capture phase to catch scrolls on inner elements like overflow-x-auto
        window.addEventListener("scroll", handleScroll, true);
        return () => {
          cancelAnimationFrame(frameId);
          window.removeEventListener("resize", updateCoords);
          window.removeEventListener("scroll", handleScroll, true);
        };
      }
    }, [isOpen, usePortal, updateCoords]);

    useEffect(() => {
      const handleClickOutside = (event) => {
        // Don't close if it's disabled or not open
        if (!isOpen || disabled) return;

        // If we clicked inside the dropdown, do nothing wrapper
        if (dropdownRef.current && dropdownRef.current.contains(event.target)) {
          return;
        }

        // If we clicked inside the portal popover, do nothing
        if (popoverRef.current && popoverRef.current.contains(event.target)) {
          return;
        }

        // Close dropdown
        if (isControlled) {
          if (onClose) onClose();
        } else {
          setInternalIsOpen(false);
          if (onClose) onClose();
        }
      };

      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("touchstart", handleClickOutside);
      };
    }, [isOpen, isControlled, onClose, disabled]);

    // Adjust placement class if customized
    let placementClass = "";
    if (placement === "bottom-end") {
      placementClass = "right-0";
    } else if (placement === "bottom-start") {
      placementClass = "left-0";
    }

    return (
      <div
        className={`relative ${className}`}
        data-state={isOpen ? "open" : "closed"}
        ref={(node) => {
          dropdownRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
      >
        <div
          onClick={handleToggle}
          className={`w-full ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
        >
          {typeof trigger === "function"
            ? trigger({ isOpen, disabled })
            : trigger}
        </div>

        {isOpen &&
          (usePortal ? (
            coords &&
            createPortal(
              <div
                ref={popoverRef}
                className={popoverClassName}
                style={{
                  position: "fixed",
                  zIndex: 10001,
                  top: coords.shouldFlipTop ? "auto" : coords.top + 6,
                  bottom: coords.shouldFlipTop
                    ? coords.windowHeight - coords.rectTop + 6
                    : "auto",
                  maxHeight: coords.availableHeight,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  ...(placement.endsWith("end")
                    ? { right: coords.right, left: "auto" }
                    : { left: coords.left, right: "auto" }),
                  minWidth: coords.width,
                }}
              >
                {typeof children === "function"
                  ? children({
                      close: () =>
                        isControlled ? onClose?.() : setInternalIsOpen(false),
                    })
                  : children}
              </div>,
              document.body,
            )
          ) : (
            <div
              ref={popoverRef}
              className={`${popoverClassName} ${placementClass}`}
              style={{
                maxHeight: "calc(100vh - 100px)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              {typeof children === "function"
                ? children({
                    close: () =>
                      isControlled ? onClose?.() : setInternalIsOpen(false),
                  })
                : children}
            </div>
          ))}
      </div>
    );
  },
);

Dropdown.displayName = "Dropdown";

export default Dropdown;
