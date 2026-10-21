# Spec review: integration/ui-v2 (cd21645...HEAD) vs #11–#19, ADR 0001/0002

Overall: almost everything in #12–#19 is implemented and tested. Server limits, DOUBLE sort, rule validation, the bound-parameter injection test, blank-line skipping and paging during preparation all match the spec.

## (a) Missing or partial
- None found that block. Not verifiable from the diff: #16 "Rendering stays smooth after tens of thousands of loaded rows". It relies on FlatList virtualisation inside a horizontal ScrollView (client/table.tsx:46-58), and nothing measures it.

## (c) Looks implemented, but probably wrong
1. **"Any column" with negative operators.** #11: "The column list starts with "Any column", which covers visible columns only." server/filter.ts:47 joins the per-column clauses with `OR`. So `Any column does not contain x` (and `≠ x`) matches every row where *some* visible column lacks x, which is almost every row. Negated operators over "any column" should use `AND` (no column contains x).
2. **Status shows "Sorting…"/"Filtering…" while appending.** #11: state is "`Sorting…`, `Filtering…`, `Ready`". client/panel.tsx:377 shows these whenever `pageBusy`, which includes every infinite-scroll append under a sort or filter. Plain scrolling looks like a re-sort.
3. **Refresh with a sort or filter blocks scrolling during preparation.** #11: "After the preview, scrolling continues during preparation"; "Refresh keeps the sort, filter…". After a refresh, `queryDirty` is set (panel.tsx:100) and `navigate(true)` returns early (panel.tsx:202). Until preparation finishes, the user sees only the 50 unsorted preview rows, while the header still shows ↑/↓ and the filter bar still shows its rules. Defensible, since sort and filter need preparation, but the spec doesn't say so.

## (b) Scope creep (minor, mostly accessibility for #17 "reachable and labelled")
- Enter/Space on a focused cell copies it (client/table.tsx:71-74). The spec only says "Double-clicking a cell copies its value."
- The resize handle takes ArrowLeft/Right (±10 px) and Enter/Space to fit (client/columns.tsx:72-79). The ⋮ button opens on ArrowUp/Down.
- The status-bar "Cancel" for a running sort or filter clears **both** sort and filter (panel.tsx:178-188, 467). This carries over from v1, which #11 doesn't address. Keeping it is fine, but clearing both is unrequested behaviour.

Not checked: the 5 GB Cua re-measurement (#11 performance targets, belongs to #20); runtime behaviour (review was static only).
