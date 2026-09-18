import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useContext,
  useMemo,
  forwardRef,
} from "react";
import { createPortal } from "react-dom";

/**
 * Nested Dropdowns both portal to document.body, so an inner popover is a
 * *sibling* of the outer one, never a descendant. An outside-click check based
 * on DOM containment alone therefore closes the outer Dropdown the instant you
 * mousedown on an inner option, unmounting the inner before its click can
 * fire — which is why no option could be picked in the Flow Canvas "View as"
 * and "Access settings" popovers, both of which hold a PeoplePicker.
 *
 * Context follows the React tree through a portal even though the DOM does
 * not, so each Dropdown hands its descendants a way to register their own
 * popover node upward. An ancestor then counts a click inside any registered
 * descendant popover as a click inside itself.
 */
const DropdownNestingContext = React.createContext(null);

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

    // Popover nodes of every Dropdown nested inside this one. Registration
    // chains upward, so a popover three levels deep is known to all three of
    // its ancestors, not just its parent.
    const parentNesting = useContext(DropdownNestingContext);
    const descendantPopovers = useRef(new Set());

    const registerDescendant = useCallback(
      (node) => {
        descendantPopovers.current.add(node);
        parentNesting?.register(node);
      },
      [parentNesting],
    );

    const unregisterDescendant = useCallback(
      (node) => {
        descendantPopovers.current.delete(node);
        parentNesting?.unregister(node);
      },
      [parentNesting],
    );

    const nesting = useMemo(
      () => ({ register: registerDescendant, unregister: unregisterDescendant }),
      [registerDescendant, unregisterDescendant],
    );

    // Keeps popoverRef exactly as it was, and additionally announces this
    // popover to whichever Dropdown encloses it.
    const setPopoverNode = useCallback(
      (node) => {
        const previous = popoverRef.current;
        if (previous && previous !== node) parentNesting?.unregister(previous);
        popoverRef.current = node;
        if (node) parentNesting?.register(node);
      },
      [parentNesting],
    );

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

        // Nor if we clicked inside a nested Dropdown's popover — a sibling in
        // the DOM, a descendant in the React tree.
        for (const node of descendantPopovers.current) {
          if (node.contains(event.target)) return;
        }

        // Close dropdown
        if (isControlled) {
          if (onClose) onClose();
        } else {
          setInternalIsOpen(false);
          if (onClose) onClose();
        }
      };

      const handleKeyDown = (event) => {
        // Escape belongs to the innermost open Dropdown: closing an ancestor
        // first would unmount the popover the key was meant for.
        if (
          event.key === "Escape" &&
          isOpen &&
          !disabled &&
          descendantPopovers.current.size === 0
        ) {
          if (isControlled) {
            if (onClose) onClose();
          } else {
            setInternalIsOpen(false);
            if (onClose) onClose();
          }
        }
      };

      document.addEventListener("mousedown", handleClickOutside, true);
      document.addEventListener("touchstart", handleClickOutside, true);
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside, true);
        document.removeEventListener("touchstart", handleClickOutside, true);
        document.removeEventListener("keydown", handleKeyDown);
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
                ref={setPopoverNode}
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
                <DropdownNestingContext.Provider value={nesting}>
                  {typeof children === "function"
                    ? children({
                        close: () =>
                          isControlled ? onClose?.() : setInternalIsOpen(false),
                      })
                    : children}
                </DropdownNestingContext.Provider>
              </div>,
              document.body,
            )
          ) : (
            <div
              ref={setPopoverNode}
              className={`${popoverClassName} ${placementClass}`}
              style={{
                maxHeight: "calc(100vh - 100px)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <DropdownNestingContext.Provider value={nesting}>
                {typeof children === "function"
                  ? children({
                      close: () =>
                        isControlled ? onClose?.() : setInternalIsOpen(false),
                    })
                  : children}
              </DropdownNestingContext.Provider>
            </div>
          ))}
      </div>
    );
  },
);

Dropdown.displayName = "Dropdown";

export default Dropdown;
