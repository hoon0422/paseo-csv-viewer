# Standards review: cd21645...HEAD (integration/ui-v2)

## Hard violations (documented standards)

1. **"Query" used for filter/sort.** GLOSSARY.md, Filter: _Avoid: Find, Search, Query_; docs/agents/domain.md Vocabulary says to "use glossary terms in … tests".
   - tests/panel.test.tsx: `"filtered cursor pages append across gaps and query changes collapse expanded rows"`, `"new query, file replacement and cancellation supersede an in-flight filter"`
   - client/panel.tsx `resetRows`: `// A query/source generation owns scroll position…`
2. **Unrecorded domain concept.** domain.md asks for glossary gaps to be recorded. "Expanded row" (`toggleExpanded`, `aria-expanded`, test names) is a new user-facing concept that is not in GLOSSARY.md. *(Borderline)*

ADR-0001 is followed: `numericValue` uses `TRY_CAST … AS DOUBLE`. ADR-0002 is followed: `buildFilter` passes every value and regex as a `?` parameter, checks column indexes against `width`, and interpolates only fixed literals (`'c'`/`'i'`, operators).

## Baseline smells (judgement calls)

- **Duplicated Code**
  - The "empty operator / rule complete" test appears three times: `client/filter.tsx` `activeRule` and `const empty = rule.operator === "is empty" || …`, and `server/filter.ts:165-166` `if (!rule.enabled || (!empty && !rule.value) || (rule.operator === "between" && !rule.value2))`.
  - In `server/session.ts`, the `prepare` catch block (`interrupt` → `await pageOperation` → `clearInterval` → `cleanup`) re-creates `drain()`.
  - In `client/panel.tsx`, the visible-column list `preview.columns.map((_, index) => index).filter(…!table.hidden.includes…)` appears twice (`navigate`, `copySelected`), the Mac regex twice, and `{ hidden: [], widths: {}, selected: [] }` three times.
  - The page size `200` is hard-coded in `panel.tsx` (×3), `admitPage`, and the `shared/session.ts` schema.
- **Message Chains**: `client/filter.tsx` `filter.shape.rules.element.shape.operator.options`. Export the operator list from `shared/session.ts`.
- **Divergent Change**: `ViewerPanel` grew for filter, selection, copy, toast, drag hover, path display and layout reasons at once. The `Session` type gained `csv`, `csvConnection`, `pageConnection`, `pageOperation`, `order` and `filterOrder`. `order` and `filterOrder` are a Data Clump: a "built order" cache entry `{key, …}`.
- **Primitive Obsession**: the sort-mode union `"numeric" | "text"` is retyped in `session.ts`, `shared/session.ts` and `panel.tsx`. `server/sort.ts` `Sort` duplicates the zod sort schema instead of deriving from it.
- **Mysterious Name**: `table` (it holds the presentation state) and `state` (the status-bar text) in `panel.tsx`.

## Correctness / resource notes (in passing)

- **[Resource]** Every session now opens DuckDB with `memory_limit: "4GB"` and `threads: availableParallelism()`, so N open panels can reserve N×4 GB and oversubscribe the CPU.
- **[Perf]** While preparation runs, each appended page runs `SELECT * FROM read_csv(…) LIMIT ? OFFSET ?` on `csvConnection`. That re-parses the source from the start on every page and competes with the import, so scroll cost is O(position) on 5 GB files.
- **[Minor]** `client/filter.tsx` keys rule rows by `key={index}`. Removing a middle rule moves focus and DOM state onto the rule after it.

No SQL injection or cancellation race found. Unfinished sort and filter builds are marked (`order.mode` / `filterOrder.totalRows` unset) and rebuilt on the next query.
