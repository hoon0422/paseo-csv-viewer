import { activeRule, filter as filterSchema, operatorNeedsValue, type Filter } from "../shared/session";
import { numericValue } from "./sort";

export function buildFilter(input: Filter | undefined, width: number) {
  const params: string[] = [];
  const regexes: string[] = [];
  if (!input) return { where: "", params, regexes };
  const filter = filterSchema.parse(input);
  const column = (index: number) => {
    if (index >= width) throw new Error("Invalid filter column");
    return `COALESCE(column${index}, '')`;
  };
  filter.visibleColumns.forEach(column);
  const rules = filter.rules.flatMap((rule) => {
    if (rule.column !== "any") column(rule.column);
    if (!activeRule(rule)) return [];
    if (rule.operator === "matches regex") regexes.push(rule.value!);
    const columns = rule.column === "any" ? filter.visibleColumns : [rule.column];
    const clauses = columns.map((index) => {
      const cell = column(index);
      if (!operatorNeedsValue(rule.operator)) return `${cell} ${rule.operator === "is empty" ? "=" : "<>"} ''`;
      if ([">", "<", "≥", "≤", "between"].includes(rule.operator)) {
        // numericValue reads each operand twice: once for its grammar and once for the cast.
        params.push(rule.value!, rule.value!);
        if (rule.operator === "between") {
          params.push(rule.value2!, rule.value2!);
          return `${numericValue(cell)} BETWEEN ${numericValue("?")} AND ${numericValue("?")}`;
        }
        const operator = rule.operator === "≥" ? ">=" : rule.operator === "≤" ? "<=" : rule.operator;
        return `${numericValue(cell)} ${operator} ${numericValue("?")}`;
      }
      params.push(rule.value!);
      if (rule.operator === "matches regex") return `regexp_matches(${cell}, ?, '${filter.caseSensitive ? "c" : "i"}')`;
      const text = filter.caseSensitive ? cell : `lower(${cell})`;
      const value = filter.caseSensitive ? "?" : "lower(?)";
      switch (rule.operator) {
        case "contains": return `contains(${text}, ${value})`;
        case "does not contain": return `NOT contains(${text}, ${value})`;
        case "=": return `${text} = ${value}`;
        case "≠": return `${text} <> ${value}`;
        case "begins with": return `starts_with(${text}, ${value})`;
        case "ends with": return `ends_with(${text}, ${value})`;
        default: throw new Error("Unsupported filter operator");
      }
    });
    // Negation applies to the whole row; a positive rule needs only one visible cell.
    const negated = rule.operator === "does not contain" || rule.operator === "≠" || rule.operator === "is empty";
    return [`(${clauses.join(negated ? " AND " : " OR ") || "false"})`];
  });
  return { where: rules.join(filter.match === "all" ? " AND " : " OR "), params, regexes };
}
