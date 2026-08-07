import { describe, it, expect } from "vitest";
import { likeEscape, likeContains } from "@/lib/search";

describe("likeEscape", () => {
  it("escapes percent signs", () => {
    expect(likeEscape("50% off")).toBe("50\\% off");
  });

  it("escapes underscores", () => {
    expect(likeEscape("foo_bar")).toBe("foo\\_bar");
  });

  it("escapes backslashes", () => {
    expect(likeEscape("a\\b")).toBe("a\\\\b");
  });

  it("escapes a mix of special characters in one pass", () => {
    expect(likeEscape("100%_off\\now")).toBe("100\\%\\_off\\\\now");
  });

  it("leaves plain strings unchanged", () => {
    expect(likeEscape("Acme Corp")).toBe("Acme Corp");
  });

  it("handles an empty string", () => {
    expect(likeEscape("")).toBe("");
  });
});

describe("likeContains", () => {
  it("wraps an escaped term in wildcards", () => {
    expect(likeContains("acme")).toBe("%acme%");
  });

  it("escapes special characters before wrapping", () => {
    expect(likeContains("50%_off")).toBe("%50\\%\\_off%");
  });

  it("wraps an empty string in bare wildcards", () => {
    expect(likeContains("")).toBe("%%");
  });
});
