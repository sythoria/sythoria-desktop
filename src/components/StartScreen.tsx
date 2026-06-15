import { motion } from "motion/react";
import { Bot, Play } from "lucide-react";
import { springs, motionTokens } from "../lib/motion-tokens";

interface StartScreenProps {
  onStart: () => void;
}

export default function StartScreen({ onStart }: StartScreenProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-chat backdrop-blur-sm p-4">
      <motion.div
        className="glass-panel w-full max-w-md rounded-2xl p-8 relative text-center"
        style={{ boxShadow: "var(--shadow-xl)" }}
        initial={{ opacity: 0, y: motionTokens.distance.lg, scale: motionTokens.scale.subtle }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ ...springs.gentle, duration: motionTokens.duration.slow }}
      >
        <motion.div
          className="w-16 h-16 rounded-2xl bg-active border border-border flex items-center justify-center mx-auto mb-6"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...springs.bouncy, delay: 0.2 }}
        >
          <Bot size={32} className="text-text-primary" />
        </motion.div>
        <motion.h1
          className="text-3xl font-semibold tracking-tight text-text-primary mb-3"
          initial={{ opacity: 0, y: motionTokens.distance.sm }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.gentle, delay: 0.3 }}
        >
          Sythoria
        </motion.h1>
        <motion.p
          className="text-text-secondary mb-8"
          initial={{ opacity: 0, y: motionTokens.distance.sm }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.gentle, delay: 0.4 }}
        >
          Welcome to Sythoria. Ready to get started?
        </motion.p>

        <motion.button
          onClick={onStart}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent hover:bg-accent-hover text-accent-foreground font-medium transition-colors"
          style={{ boxShadow: "var(--shadow-md)" }}
          initial={{ opacity: 0, y: motionTokens.distance.sm }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.gentle, delay: 0.5 }}
          whileHover={{ scale: motionTokens.scale.pop }}
          whileTap={{ scale: motionTokens.scale.press }}
        >
          <Play size={18} />
          Start
        </motion.button>
      </motion.div>
    </div>
  );
}
