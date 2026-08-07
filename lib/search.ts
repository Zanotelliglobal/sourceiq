// ─── SEARCH HELPERS ────────────────────────────────────────────────────────────
// Small pure helper backing the cross-project search endpoint (#40,
// app/api/search/route.ts). Kept separate so it's unit-testable without a DB.

/**
 * Escapes LIKE/ILIKE wildcard characters in user input so a literal "%" or "_"
 * typed by the user isn't treated as a pattern wildcard. Postgres' default LIKE
 * escape character is backslash, so no explicit ESCAPE clause is needed as long
 * as the pattern is bound as a parameter (never interpolated into the SQL text).
 */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, ch => `\\${ch}`);
}

/** Wraps an already-escaped search term into a "contains" LIKE/ILIKE pattern. */
export function likeContains(q: string): string {
  return `%${likeEscape(q)}%`;
}
