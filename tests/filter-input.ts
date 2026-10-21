import type { Filter } from "../shared/session";

export const anyColumnFilter = (value: string, visibleColumns: number[]): Filter => ({
  rules: [{ enabled: true, column: "any", operator: "contains", value }],
  match: "all", caseSensitive: false, visibleColumns,
});
