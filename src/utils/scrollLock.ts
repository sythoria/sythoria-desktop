let lockCount = 0;

export function lockBodyScroll(): void {
  lockCount++;
  if (lockCount === 1) {
    document.body.style.overflow = "hidden";
  }
}

export function unlockBodyScroll(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = "";
  }
}

export function useScrollLock(active: boolean): void {
  if (active) {
    lockBodyScroll();
  } else {
    unlockBodyScroll();
  }
}
