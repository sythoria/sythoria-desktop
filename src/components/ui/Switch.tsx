import { motion } from "motion/react";
import { springs } from "../../lib/motion-tokens";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, label, description, ariaLabel, disabled, className = "" }: SwitchProps) {
  return (
    <div
      className={`flex items-center justify-between gap-4 ${disabled ? "opacity-50 pointer-events-none" : ""} ${className}`}
    >
      {(label || description) && (
        <div className="min-w-0">
          {label && <p className="text-sm font-medium text-text-primary">{label}</p>}
          {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
        </div>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel ?? label ?? "Toggle"}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onChange(!checked);
          }
        }}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          checked ? "bg-accent" : "bg-input-border"
        }`}
      >
        <motion.span
          className="inline-block h-4 w-4 rounded-full shadow-sm"
          style={{ backgroundColor: checked ? "var(--theme-accent-foreground)" : "#ffffff" }}
          initial={{ x: checked ? 24 : 4 }}
          animate={{
            x: checked ? 24 : 4,
          }}
          transition={springs.snappy}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
