import { motion } from "motion/react";
import { Bot, Play } from "lucide-react";
import { springs, motionTokens } from "../lib/motion-tokens";

interface StartScreenProps {
  onStart: () => void;
}

export default function StartScreen({ onStart }: StartScreenProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-chat/80 backdrop-blur-sm p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/4 -right-1/4 w-[600px] h-[600px] rounded-full bg-accent/5 blur-3xl" />
        <div className="absolute -bottom-1/4 -left-1/4 w-[500px] h-[500px] rounded-full bg-accent/3 blur-3xl" />
      </div>

      <motion.div
        className="glass-panel w-full max-w-md rounded-2xl p-8 shadow-2xl relative text-center"
        initial={{ opacity: 0, y: motionTokens.distance.lg, scale: motionTokens.scale.subtle }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ ...springs.gentle, duration: motionTokens.duration.slow }}
      >
        <motion.div
          className="w-20 h-20 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto mb-6"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...springs.bouncy, delay: 0.2 }}
        >
          <Bot size={40} className="text-accent" />
        </motion.div>
        <motion.h1
          className="text-4xl font-bold text-text-primary mb-4"
          initial={{ opacity: 0, y: motionTokens.distance.sm }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.gentle, delay: 0.3 }}
        >
          Sythoria
        </motion.h1>
        <motion.p
          className="text-text-muted mb-8"
          initial={{ opacity: 0, y: motionTokens.distance.sm }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.gentle, delay: 0.4 }}
        >
          Welcome to Sythoria. Ready to get started?
        </motion.p>

        <motion.button
          onClick={onStart}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent hover:bg-accent-hover text-white font-medium shadow-lg shadow-accent/20 text-lg"
          initial={{ opacity: 0, y: motionTokens.distance.sm }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.gentle, delay: 0.5 }}
          whileHover={{ scale: motionTokens.scale.pop }}
          whileTap={{ scale: motionTokens.scale.press }}
        >
          <Play size={20} />
          Start
        </motion.button>
      </motion.div>
    </div>
  );
}
