import { useReducedMotion } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";

export function useSafeMotion(fullY: number = motionTokens.distance.md) {
  const reduce = useReducedMotion();
  return {
    initial: { opacity: 0, y: reduce ? 0 : fullY },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: reduce ? 0 : -fullY },
  };
}

export function useSafeScale() {
  const reduce = useReducedMotion();
  return {
    initial: { opacity: 0, scale: reduce ? 1 : motionTokens.scale.subtle },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: reduce ? 1 : motionTokens.scale.subtle },
  };
}

export function useSafeSlideX(distance: number = motionTokens.distance.xl) {
  const reduce = useReducedMotion();
  return {
    initial: { opacity: 0, x: reduce ? 0 : distance },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: reduce ? 0 : distance },
  };
}
