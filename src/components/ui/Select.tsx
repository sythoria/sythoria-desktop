import { useState, useRef, useEffect, useId } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Check } from "lucide-react";
import { springs } from "../../lib/motion-tokens";

interface Option {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

export function Select({
  value,
  onChange,
  options,
  disabled = false,
  className = "",
  id,
  "aria-label": ariaLabel,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const generatedId = useId();
  const listboxId = `${id ?? generatedId}-listbox`;
  const triggerId = `${id ?? generatedId}-trigger`;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.value === value);
  const safeActiveIndex = Math.min(activeIndex, Math.max(0, options.length - 1));

  const openListbox = () => {
    const selectedIndex = options.findIndex((option) => option.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setIsOpen(true);
  };

  const closeListbox = (restoreFocus = true) => {
    setIsOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => buttonRef.current?.focus());
    }
  };

  const selectActiveOption = () => {
    const option = options[safeActiveIndex];
    if (!option) return;
    onChange(option.value);
    closeListbox();
  };

  useEffect(() => {
    if (isOpen) {
      listboxRef.current?.focus();
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (isOpen) {
        closeListbox();
      } else {
        openListbox();
      }
    } else if (e.key === "Escape") {
      closeListbox();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openListbox();
    }
  };

  const handleListboxKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(0, options.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(Math.max(0, options.length - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectActiveOption();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeListbox();
    } else if (e.key === "Tab") {
      closeListbox(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`} id={id}>
      <button
        ref={buttonRef}
        id={triggerId}
        type="button"
        disabled={disabled}
        onClick={() => (isOpen ? closeListbox() : openListbox())}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-label={ariaLabel}
        className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-all cursor-pointer ${
          disabled ? "opacity-50 cursor-not-allowed pointer-events-none" : ""
        }`}
      >
        <span className="truncate">{selectedOption?.label ?? value}</span>
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={springs.snappy}>
          <ChevronDown size={14} className="text-text-muted" />
        </motion.div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.ul
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabel ? undefined : triggerId}
            aria-activedescendant={options[safeActiveIndex] ? `${listboxId}-option-${safeActiveIndex}` : undefined}
            tabIndex={-1}
            onKeyDown={handleListboxKeyDown}
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={springs.snappy}
            className="absolute right-0 z-50 mt-1 max-h-60 w-full min-w-[150px] overflow-auto rounded-xl border border-border glass-dropdown p-1 shadow-lg focus:outline-none scrollbar-none"
          >
            {options.map((opt, index) => {
              const isSelected = opt.value === value;
              const isActive = index === safeActiveIndex;
              return (
                <li
                  id={`${listboxId}-option-${index}`}
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    onChange(opt.value);
                    closeListbox();
                  }}
                  className={`flex items-center justify-between px-3 py-1.5 text-sm rounded-lg cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-accent text-accent-foreground font-medium"
                      : isActive
                        ? "bg-hover text-text-primary"
                        : "text-text-primary hover:bg-hover hover:text-text-primary"
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSelected && <Check size={14} className="shrink-0 ml-2" />}
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
