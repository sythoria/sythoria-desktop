import { motion } from "motion/react";
import { springs } from "../../lib/motion-tokens";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
}

export function Switch({ checked, onChange, label, description }: SwitchProps) {
  return (
    <div className="flex items-center justify-between gap-4">
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
        aria-label={label ?? "Toggle"}
        onClick={() => onChange(!checked)}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onChange(!checked);
          }
        }}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-text-muted/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface outline-none ${
          checked ? "bg-accent" : "bg-input-border"
        }`}
      >
        <motion.span
          className="inline-block h-4 w-4 rounded-full shadow-sm"
          style={{ backgroundColor: checked ? "var(--theme-accent-foreground)" : "var(--theme-text-secondary)" }}
          animate={{
            x: checked ? 22 : 2,
          }}
          transition={springs.snappy}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
