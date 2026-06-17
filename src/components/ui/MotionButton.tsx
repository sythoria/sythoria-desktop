import { forwardRef } from "react";
import { motion } from "motion/react";
import { springs, motionTokens } from "../../lib/motion-tokens";
import { useUIStore } from "../../store/useUIStore";

interface MotionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "accent" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
}

const MotionButton = forwardRef<HTMLButtonElement, MotionButtonProps>(function MotionButton(
  { children, className = "", variant: _variant, size: _size, disabled, ...props },
  ref,
) {
  const disabledAnimations = useUIStore((s) => s.animationsDisabled);
  const shouldAnimate = !disabled && !disabledAnimations;

  return (
    <motion.button
      ref={ref}
      disabled={disabled}
      whileHover={shouldAnimate ? { scale: motionTokens.scale.pop } : undefined}
      whileTap={shouldAnimate ? { scale: motionTokens.scale.press } : undefined}
      transition={springs.snappy}
      className={className}
      {...(props as Record<string, unknown>)}
    >
      {children}
    </motion.button>
  );
});

export default MotionButton;
