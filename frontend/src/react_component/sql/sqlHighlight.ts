/**
 * A tiny SQL tokenizer for syntax highlighting. It is not a parser: it only
 * needs to split text into styled spans that, concatenated, reproduce the
 * input exactly (so a highlighted overlay lines up with the textarea that
 * actually holds the text).
 */

export type SqlTokenKind =
  | "keyword"
  | "function"
  | "string"
  | "number"
  | "comment"
  | "identifier"
  | "operator"
  | "text";

export interface SqlToken {
  kind: SqlTokenKind;
  text: string;
}

const KEYWORDS = new Set(
  (
    "select from where group by order having limit offset join left right inner outer full cross on as and or not in is null distinct " +
    "union all except intersect with case when then else end asc desc like ilike between exists over partition rows range " +
    "cast interval true false using natural qualify window filter within values top pivot unpivot semi anti lateral"
  ).split(" ")
);

const FUNCTIONS = new Set(
  (
    "count sum avg min max median mode stddev variance first last any_value string_agg list array_agg " +
    "coalesce nullif ifnull greatest least abs round floor ceil ceiling sqrt power log ln exp " +
    "lower upper trim ltrim rtrim length substring substr replace concat split_part left right contains starts_with regexp_matches " +
    "date_trunc date_part date_diff datediff epoch epoch_ms strftime strptime extract now current_date current_timestamp age to_timestamp make_date " +
    "row_number rank dense_rank lag lead ntile percent_rank cume_dist quantile quantile_cont quantile_disc approx_count_distinct " +
    "try_cast typeof list_contains array_length unnest generate_series range"
  ).split(" ")
);

// Order matters: comments before operators (`--`), strings before identifiers.
const TOKEN_RE =
  /(--[^\n]*)|(\/\*[\s\S]*?(?:\*\/|$))|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?)|(\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|([a-zA-Z_][a-zA-Z0-9_]*)|(::|<>|<=|>=|!=|\|\||[-+*/%<>=(),;.|&^~[\]{}])|(\s+)|([\s\S])/g;

export function tokenizeSql(source: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(source)) !== null) {
    const text = m[0];
    if (!text) {
      TOKEN_RE.lastIndex++;
      continue;
    }
    let kind: SqlTokenKind = "text";
    if (m[1] !== undefined || m[2] !== undefined) kind = "comment";
    else if (m[3] !== undefined) kind = "string";
    else if (m[4] !== undefined) kind = "identifier";
    else if (m[5] !== undefined) kind = "number";
    else if (m[6] !== undefined) {
      const lower = text.toLowerCase();
      // `count(` is a call, `count` alone (a column named count) is not
      const rest = source.slice(m.index + text.length);
      const isCall = /^\s*\(/.test(rest);
      if (KEYWORDS.has(lower)) kind = "keyword";
      else if (FUNCTIONS.has(lower) && isCall) kind = "function";
      else kind = "text";
    } else if (m[7] !== undefined) kind = "operator";
    else kind = "text";
    tokens.push({ kind, text });
  }
  return tokens;
}

/** CSS color per token kind; plain text inherits the editor color. */
export const SQL_TOKEN_COLORS: Record<SqlTokenKind, string | undefined> = {
  keyword: "hsl(262,60%,48%)",
  function: "hsl(212,80%,42%)",
  string: "hsl(142,55%,32%)",
  number: "hsl(24,80%,42%)",
  comment: "hsl(240,4%,58%)",
  identifier: "hsl(190,70%,30%)",
  operator: "hsl(240,5%,40%)",
  text: undefined,
};
