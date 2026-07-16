import { beforeEach, describe, expect, it, vi } from "vitest";

const eventMocks = vi.hoisted(() => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventMocks.listen,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { useModelStore } from "./useModelStore";

describe("useModelStore stream listeners", () => {
  beforeEach(() => {
    eventMocks.listen.mockReset();
  });

  it("waits for an in-flight listener initialization before resolving additional registrations", async () => {
    let finishFirstListen: ((unlisten: () => void) => void) | undefined;
    const firstListen = new Promise<() => void>((resolve) => {
      finishFirstListen = resolve;
    });
    const unlistenChunk = vi.fn();
    const unlistenDone = vi.fn();

    eventMocks.listen.mockImplementationOnce(() => firstListen).mockResolvedValueOnce(unlistenDone);

    const firstRegistration = useModelStore.getState().ensureStreamListeners("conversation-1", vi.fn(), vi.fn());
    const secondRegistration = useModelStore.getState().ensureStreamListeners("conversation-2", vi.fn(), vi.fn());
    let secondResolved = false;
    void secondRegistration.then(() => {
      secondResolved = true;
    });

    await Promise.resolve();
    expect(secondResolved).toBe(false);

    finishFirstListen?.(unlistenChunk);
    const [cleanupFirst, cleanupSecond] = await Promise.all([firstRegistration, secondRegistration]);
    expect(secondResolved).toBe(true);
    expect(eventMocks.listen).toHaveBeenCalledTimes(2);

    cleanupFirst();
    cleanupSecond();
    expect(unlistenChunk).toHaveBeenCalledOnce();
    expect(unlistenDone).toHaveBeenCalledOnce();
  });

  it("cleans up a partial registration and allows a later retry", async () => {
    const partialUnlisten = vi.fn();
    eventMocks.listen.mockResolvedValueOnce(partialUnlisten).mockRejectedValueOnce(new Error("done listener failed"));

    await expect(
      useModelStore.getState().ensureStreamListeners("failed-conversation", vi.fn(), vi.fn()),
    ).rejects.toThrow("done listener failed");
    expect(partialUnlisten).toHaveBeenCalledOnce();

    const retryChunkUnlisten = vi.fn();
    const retryDoneUnlisten = vi.fn();
    eventMocks.listen.mockResolvedValueOnce(retryChunkUnlisten).mockResolvedValueOnce(retryDoneUnlisten);

    const cleanup = await useModelStore.getState().ensureStreamListeners("retry-conversation", vi.fn(), vi.fn());
    cleanup();

    expect(retryChunkUnlisten).toHaveBeenCalledOnce();
    expect(retryDoneUnlisten).toHaveBeenCalledOnce();
  });
});
