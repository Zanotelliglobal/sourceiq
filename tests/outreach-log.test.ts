import { describe, it, expect } from "vitest";
import { summarizeOutreachThread } from "@/lib/outreach-log";

describe("summarizeOutreachThread", () => {
  it("returns a null/zero summary for an empty thread", () => {
    expect(summarizeOutreachThread([])).toEqual({
      messageCount: 0,
      lastDirection: null,
      lastSentAt: null,
      awaitingReply: false,
    });
  });

  it("flags awaitingReply when the most recent message is outbound", () => {
    const s = summarizeOutreachThread([
      { direction: "outbound", sent_at: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(s.messageCount).toBe(1);
    expect(s.lastDirection).toBe("outbound");
    expect(s.lastSentAt).toBe("2026-01-01T00:00:00.000Z");
    expect(s.awaitingReply).toBe(true);
  });

  it("clears awaitingReply once the supplier has replied most recently", () => {
    const s = summarizeOutreachThread([
      { direction: "outbound", sent_at: "2026-01-01T00:00:00.000Z" },
      { direction: "inbound", sent_at: "2026-01-02T00:00:00.000Z" },
    ]);
    expect(s.messageCount).toBe(2);
    expect(s.lastDirection).toBe("inbound");
    expect(s.awaitingReply).toBe(false);
  });

  it("re-flags awaitingReply on a follow-up sent after a reply", () => {
    const s = summarizeOutreachThread([
      { direction: "outbound", sent_at: "2026-01-01T00:00:00.000Z" },
      { direction: "inbound", sent_at: "2026-01-02T00:00:00.000Z" },
      { direction: "outbound", sent_at: "2026-01-03T00:00:00.000Z" },
    ]);
    expect(s.messageCount).toBe(3);
    expect(s.lastDirection).toBe("outbound");
    expect(s.lastSentAt).toBe("2026-01-03T00:00:00.000Z");
    expect(s.awaitingReply).toBe(true);
  });

  it("treats any non-'inbound' direction value as outbound", () => {
    const s = summarizeOutreachThread([{ direction: "weird-value", sent_at: "2026-01-01T00:00:00.000Z" }]);
    expect(s.lastDirection).toBe("outbound");
    expect(s.awaitingReply).toBe(true);
  });

  it("only looks at the last entry, ignoring earlier directions", () => {
    const s = summarizeOutreachThread([
      { direction: "inbound", sent_at: "2026-01-01T00:00:00.000Z" },
      { direction: "inbound", sent_at: "2026-01-02T00:00:00.000Z" },
      { direction: "outbound", sent_at: "2026-01-03T00:00:00.000Z" },
    ]);
    expect(s.messageCount).toBe(3);
    expect(s.lastDirection).toBe("outbound");
  });
});
