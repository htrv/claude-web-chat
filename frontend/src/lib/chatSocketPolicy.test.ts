import { describe, expect, it } from "vitest";
import { assistantTurnFromServerEvent, socketClosePolicy } from "./chatSocketPolicy";

describe("assistantTurnFromServerEvent", () => {
  it("marks in-flight assistant turn on stream lifecycle events", () => {
    for (const t of ["thinking", "catchup", "chunk", "thinking_chunk"]) {
      expect(assistantTurnFromServerEvent(t)).toBe("start");
    }
    for (const t of ["done", "error", "limit_hit"]) {
      expect(assistantTurnFromServerEvent(t)).toBe("end");
    }
    expect(assistantTurnFromServerEvent("ping")).toBeNull();
    expect(assistantTurnFromServerEvent("ready")).toBeNull();
  });
});

describe("socketClosePolicy", () => {
  it("active chat: always schedules reconnect; shows disconnect until re-open", () => {
    const idle = socketClosePolicy({ assistantTurnPending: false, isActiveChat: true });
    expect(idle.shouldClearStreamVisual).toBe(true);
    expect(idle.shouldScheduleReconnect).toBe(true);
    expect(idle.shouldWarnDisconnected).toBe(true);

    const busy = socketClosePolicy({ assistantTurnPending: true, isActiveChat: true });
    expect(busy.shouldClearStreamVisual).toBe(false);
    expect(busy.shouldScheduleReconnect).toBe(true);
    expect(busy.shouldWarnDisconnected).toBe(true);
  });

  it("background chat with pending assistant: reconnect but keep streaming UI and no banner", () => {
    const p = socketClosePolicy({ assistantTurnPending: true, isActiveChat: false });
    expect(p.shouldClearStreamVisual).toBe(false);
    expect(p.shouldScheduleReconnect).toBe(true);
    expect(p.shouldWarnDisconnected).toBe(false);
  });

  it("background idle chat: no reconnect, clear visual state", () => {
    const p = socketClosePolicy({ assistantTurnPending: false, isActiveChat: false });
    expect(p.shouldClearStreamVisual).toBe(true);
    expect(p.shouldScheduleReconnect).toBe(false);
    expect(p.shouldWarnDisconnected).toBe(false);
  });
});
