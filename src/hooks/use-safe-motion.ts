import { useReducedMotion } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import { useUIStore } from "../store/useUIStore";

export function useSafeMotion(fullY: number = motionTokens.distance.md) {
  const reduce = useReducedMotion();
  const disabled = useUIStore((s) => s.animationsDisabled);
  const isReduced = reduce || disabled;
  return {
    initial: { opacity: isReduced ? 1 : 0, y: isReduced ? 0 : fullY },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: isReduced ? 0 : 0, y: isReduced ? 0 : -fullY },
    transition: isReduced ? { duration: 0 } : undefined,
  };
}

export function useSafeScale() {
  const reduce = useReducedMotion();
  const disabled = useUIStore((s) => s.animationsDisabled);
  const isReduced = reduce || disabled;
  return {
    initial: { opacity: isReduced ? 1 : 0, scale: isReduced ? 1 : motionTokens.scale.subtle },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: isReduced ? 0 : 0, scale: isReduced ? 1 : motionTokens.scale.subtle },
    transition: isReduced ? { duration: 0 } : undefined,
  };
}

export function useSafeSlideX(distance: number = motionTokens.distance.xl) {
  const reduce = useReducedMotion();
  const disabled = useUIStore((s) => s.animationsDisabled);
  const isReduced = reduce || disabled;
  return {
    initial: { opacity: isReduced ? 1 : 0, x: isReduced ? 0 : distance },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: isReduced ? 0 : 0, x: isReduced ? 0 : distance },
    transition: isReduced ? { duration: 0 } : undefined,
  };
}
