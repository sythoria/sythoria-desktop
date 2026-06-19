import React from "react";
import { motion } from "motion/react";
import { FileUp } from "lucide-react";
import { springs, motionTokens } from "../../lib/motion-tokens";

export const DragOverlay: React.FC = () => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: motionTokens.duration.fast }}
      className="absolute inset-0 z-[100] flex items-center justify-center p-6 bg-chat/40 backdrop-blur-lg pointer-events-none"
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={springs.gentle}
        className="w-full h-full border-2 border-dashed border-accent/50 rounded-[24px] flex flex-col items-center justify-center bg-accent/5 p-8"
      >
        <motion.div
          animate={{
            y: [0, -8, 0],
          }}
          transition={{
            repeat: Infinity,
            duration: 1.8,
            ease: "easeInOut",
          }}
          className="p-5 rounded-2xl bg-accent/10 border border-accent/20 mb-4 shadow-lg shadow-accent/5"
        >
          <FileUp size={40} className="text-accent" />
        </motion.div>

        <h3 className="text-lg font-medium text-text-primary mb-1">Drop files to attach</h3>
        <p className="text-sm text-text-muted text-center max-w-xs">
          Release to add them as attachments to your message.
        </p>

        <div className="mt-6 flex items-center gap-4 text-xs text-text-muted/60 border-t border-white/5 pt-4">
          <span>Images & Text Files</span>
          <span className="w-1 h-1 rounded-full bg-text-muted/30" />
          <span>Max 10 MB per file</span>
        </div>
      </motion.div>
    </motion.div>
  );
};
