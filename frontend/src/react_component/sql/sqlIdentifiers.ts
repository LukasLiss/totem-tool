/**
 * Small helpers for building SQL text in the editor: identifier quoting and
 * alias detection. Pure functions, unit-tested in sqlIdentifiers.test.ts.
 */

/**
 * Wrap `name` in double quotes (DuckDB identifier quoting), escaping embedded
 * quotes. Always quoting keeps names with spaces, dashes or reserved words
 * (e.g. `order`, `Order Total`) valid without a per-name decision.
 */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** a bare identifier that needs no quoting */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

/** quote only when the name would otherwise not parse as an identifier */
export function quoteIdentifierIfNeeded(name: string): string {
  return SAFE_IDENTIFIER.test(name) ? name : quoteIdentifier(name);
}

const CLAUSE_KEYWORDS =
  /^(where|group|order|limit|join|left|right|inner|outer|cross|full|on|having|using|natural|union|except|intersect|window|qualify)$/i;

/**
 * The alias a query uses for `table` (in `FROM events e` / `JOIN events AS e`),
 * the table's own name when it is referenced without an alias, or null when
 * the query does not reference the table at all. Quoted table names
 * (`FROM "events"`) are recognised too.
 */
export function aliasForTable(query: string, table: string): string | null {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ref = `(?:${escaped}|"${escaped}")`;
  const withAlias = query.match(
    new RegExp(`\\b(?:from|join)\\s+${ref}\\s+(?:as\\s+)?("[^"]+"|[a-z_]\\w*)`, "i")
  );
  if (withAlias && !CLAUSE_KEYWORDS.test(withAlias[1])) {
    return withAlias[1];
  }
  return new RegExp(`\\b(?:from|join)\\s+${ref}(?![\\w"])`, "i").test(query) ? table : null;
}

/** `alias.column` (both quoted as needed) or just the quoted column */
export function columnReference(query: string, table: string, column: string): string {
  const alias = aliasForTable(query, table);
  const col = quoteIdentifier(column);
  if (!alias) return col;
  const prefix = alias.startsWith('"') ? alias : quoteIdentifierIfNeeded(alias);
  return `${prefix}.${col}`;
}
