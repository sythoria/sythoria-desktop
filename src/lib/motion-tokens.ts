import { useUIStore } from "../store/useUIStore";

export const motionTokens = {
  get duration() {
    const disabled = useUIStore.getState().animationsDisabled;
    return {
      instant: disabled ? 0 : 0.08,
      fast: disabled ? 0 : 0.18,
      normal: disabled ? 0 : 0.35,
      slow: disabled ? 0 : 0.6,
      crawl: disabled ? 0 : 1.0,
    };
  },
  easing: {
    smooth: [0.22, 1, 0.36, 1] as [number, number, number, number],
    sharp: [0.4, 0, 0.2, 1] as [number, number, number, number],
    bounce: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
    linear: [0, 0, 1, 1] as [number, number, number, number],
  },
  distance: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 48,
  },
  get scale() {
    const disabled = useUIStore.getState().animationsDisabled;
    return {
      subtle: disabled ? 1 : 0.98,
      press: disabled ? 1 : 0.95,
      pop: disabled ? 1 : 1.04,
    };
  },
};

export const springs = {
  get snappy() {
    return useUIStore.getState().animationsDisabled
      ? { type: "tween" as const, duration: 0 }
      : { type: "spring" as const, stiffness: 300, damping: 30 };
  },
  get gentle() {
    return useUIStore.getState().animationsDisabled
      ? { type: "tween" as const, duration: 0 }
      : { type: "spring" as const, stiffness: 120, damping: 14 };
  },
  get bouncy() {
    return useUIStore.getState().animationsDisabled
      ? { type: "tween" as const, duration: 0 }
      : { type: "spring" as const, stiffness: 400, damping: 10 };
  },
  get instant() {
    return useUIStore.getState().animationsDisabled
      ? { type: "tween" as const, duration: 0 }
      : { type: "spring" as const, stiffness: 600, damping: 35 };
  },
  get release() {
    return useUIStore.getState().animationsDisabled
      ? { type: "tween" as const, duration: 0 }
      : { type: "spring" as const, stiffness: 200, damping: 20, restDelta: 0.001 };
  },
};

export const motionConfig = {
  isLowEnd() {
    return typeof navigator !== "undefined" && navigator.hardwareConcurrency <= 4;
  },
  prefersReduced() {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  },
  shouldAnimate({ essential = false } = {}) {
    if (useUIStore.getState().animationsDisabled) return false;
    if (this.prefersReduced()) return false;
    if (!essential && this.isLowEnd()) return false;
    return true;
  },
  duration() {
    return useUIStore.getState().animationsDisabled || this.isLowEnd() || this.prefersReduced()
      ? 0
      : motionTokens.duration.normal;
  },
};
