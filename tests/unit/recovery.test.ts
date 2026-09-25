import { describe, expect, it, vi } from "vitest";
import { startRecovery } from "@/lib/auth/recovery";

describe("recovery request", () => {
  it("answers before the provider call runs, and never waits for it", async () => {
    const tasks: Array<() => Promise<void>> = [];
    // A provider call that never finishes: the answer must not depend on it.
    const send = vi.fn(() => new Promise<string | null>(() => {}));
    const result = startRecovery(
      { email: " Someone@Example.com " },
      { origin: "http://app.localhost:3000", schedule: (task) => tasks.push(task), send },
    );

    expect(result).toEqual({ sent: true }); // synchronous: no await on the provider
    expect(send).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);

    void tasks[0](); // what Next.js `after` runs once the response is sent
    expect(send).toHaveBeenCalledWith("someone@example.com", "http://app.localhost:3000/auth/confirm");
  });

  it("logs provider failures by code only", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let task: (() => Promise<void>) | undefined;
    startRecovery(
      { email: "someone@example.com" },
      { origin: "http://x", schedule: (t) => (task = t), send: async () => "over_email_send_rate_limit" },
    );
    await task!();
    expect(errors).toHaveBeenCalledWith("Recovery email request failed:", "over_email_send_rate_limit");
    errors.mockRestore();
  });

  it("rejects an invalid address without scheduling anything", () => {
    const schedule = vi.fn();
    expect(startRecovery({ email: "nope" }, { origin: "http://x", schedule })).toEqual({
      toast: "Enter a valid email address.",
    });
    expect(schedule).not.toHaveBeenCalled();
  });
});
