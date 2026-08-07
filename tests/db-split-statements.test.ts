import { describe, it, expect } from "vitest";
import { splitStatements } from "@/lib/db";

// Regression coverage for a real production incident: initSchema()'s DDL is a
// single template string split on `;` for the Neon HTTP driver (which rejects
// multi-statement queries). A `--` comment containing a semicolon of its own
// ("...list; archive hides...") silently corrupted that split, sending
// "archive hides it..." to Postgres as if it were a statement and crashing
// initSchema() — which every DB-backed route awaits — with
// `NeonDbError: syntax error at or near "archive"`. See lib/db.ts's
// splitStatements() comment for the postmortem.
describe("splitStatements", () => {
  it("splits simple statements on semicolons", () => {
    const out = splitStatements("SELECT 1; SELECT 2;");
    expect(out).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("ignores semicolons that appear inside a line comment", () => {
    const ddl = `
      -- a note; with a semicolon in the middle of it
      CREATE TABLE IF NOT EXISTS foo (id INT);
    `;
    const out = splitStatements(ddl);
    expect(out).toEqual(["CREATE TABLE IF NOT EXISTS foo (id INT)"]);
  });

  it("strips a comment even when it shares a line with real SQL before it", () => {
    const ddl = `SELECT 1; -- trailing note; with a semicolon\nSELECT 2;`;
    const out = splitStatements(ddl);
    expect(out).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("drops empty statements produced by blank lines/comment-only lines", () => {
    const ddl = `
      -- just a comment, no statement here
      SELECT 1;

      -- another comment
    `;
    const out = splitStatements(ddl);
    expect(out).toEqual(["SELECT 1"]);
  });

  it("handles multiple comment lines with semicolons back-to-back", () => {
    const ddl = `
      -- first note; has one
      -- second note; has another
      SELECT 1;
    `;
    expect(splitStatements(ddl)).toEqual(["SELECT 1"]);
  });
});
