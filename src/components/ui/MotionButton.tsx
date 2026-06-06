import { forwardRef } from "react";
import { motion } from "motion/react";
import { springs, motionTokens } from "../../lib/motion-tokens";

interface MotionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "accent" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
}

const MotionButton = forwardRef<HTMLButtonElement, MotionButtonProps>(function MotionButton(
  { children, className = "", variant: _variant, size: _size, disabled, ...props },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: motionTokens.scale.pop }}
      whileTap={disabled ? undefined : { scale: motionTokens.scale.press }}
      transition={springs.snappy}
      className={className}
      {...(props as Record<string, unknown>)}
    >
      {children}
    </motion.button>
  );
});

export default MotionButton;
