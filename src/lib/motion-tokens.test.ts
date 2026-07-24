import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "../store/useUIStore";
import { motionTokens, REDUCED_MOTION_QUERY, shouldReduceMotion, springs } from "./motion-tokens";

const originalMatchMedia = window.matchMedia;

function mockReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === REDUCED_MOTION_QUERY ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("motion tokens", () => {
  beforeEach(() => {
    useUIStore.setState({ animationsDisabled: false });
    mockReducedMotion(false);
  });

  afterEach(() => {
    useUIStore.setState({ animationsDisabled: false });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  });

  it("uses normal animation values when reduced motion is not requested", () => {
    expect(shouldReduceMotion()).toBe(false);
    expect(motionTokens.duration.fast).toBe(0.18);
    expect(motionTokens.scale.pop).toBe(1.04);
    expect(springs.snappy).toEqual({ type: "spring", stiffness: 300, damping: 30 });
  });

  it("removes token-driven motion when the system requests reduced motion", () => {
    mockReducedMotion(true);

    expect(shouldReduceMotion()).toBe(true);
    expect(motionTokens.duration.fast).toBe(0);
    expect(motionTokens.scale.pop).toBe(1);
    expect(springs.snappy).toEqual({ type: "tween", duration: 0 });
  });

  it("continues to honor the in-app animation preference", () => {
    useUIStore.setState({ animationsDisabled: true });

    expect(shouldReduceMotion()).toBe(true);
    expect(motionTokens.duration.normal).toBe(0);
    expect(motionTokens.scale.press).toBe(1);
    expect(springs.gentle).toEqual({ type: "tween", duration: 0 });
  });
});
