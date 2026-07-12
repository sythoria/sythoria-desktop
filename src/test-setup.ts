import "@testing-library/jest-dom/vitest";

if (typeof window !== "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: window.localStorage,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    value: window.sessionStorage,
    writable: true,
    configurable: true,
  });
}

HTMLElement.prototype.scrollIntoView = function () {};

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock;
