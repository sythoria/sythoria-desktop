import { forwardRef } from "react";
import { motion } from "motion/react";
import { ArrowDown } from "lucide-react";
import { springs, motionTokens } from "../lib/motion-tokens";

interface ScrollToBottomButtonProps {
  onClick: () => void;
  hasNewMessages?: boolean;
  className?: string;
}

const ScrollToBottomButton = forwardRef<HTMLButtonElement, ScrollToBottomButtonProps>(function ScrollToBottomButton(
  { onClick, hasNewMessages, className = "" },
  ref,
) {
  const label = hasNewMessages ? "New messages below. Scroll to bottom." : "Scroll to bottom";

  return (
    <motion.button
      ref={ref}
      onClick={onClick}
      className={`
          relative flex items-center justify-center
          w-10 h-10 rounded-full
          bg-accent text-white shadow-lg
          hover:bg-accent-hover hover:shadow-xl
          transition-colors duration-200
          focus:outline-none focus:ring-2 focus:ring-accent/50 focus:ring-offset-2 focus:ring-offset-chat
          z-30
          ${className}
        `}
      aria-label={label}
      title={label}
      whileHover={{ scale: motionTokens.scale.pop }}
      whileTap={{ scale: motionTokens.scale.press }}
      transition={springs.snappy}
    >
      <ArrowDown size={18} className="shrink-0" />
      {hasNewMessages && (
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full border-2 border-chat animate-pulse" />
      )}
    </motion.button>
  );
});

export default ScrollToBottomButton;
