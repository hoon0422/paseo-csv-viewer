import { useEffect, useRef, type CSSProperties } from "react";
import { activeRule, filterOperators, operatorNeedsValue, type Filter } from "../shared/session";

export const emptyFilter = (): Filter => ({
  rules: [{ enabled: true, column: "any", operator: "contains", value: "" }],
  match: "all", caseSensitive: false, visibleColumns: [],
});

export function FilterBar({ value, columns, hidden, onChange, onApply, onClose, focusRequest, disabled, style, danger }: {
  value: Filter; columns: string[]; hidden: number[];
  onChange: (next: Filter) => void; onApply: (next: Filter) => void;
  onClose: () => void; focusRequest: number;
  disabled: boolean; style: CSSProperties; danger: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  // Keep UI identity across edits without adding IDs to the strict filter contract.
  const ruleKeys = useRef(new WeakMap<Filter["rules"][number], string>());
  const ruleKey = (rule: Filter["rules"][number]) => {
    if (!ruleKeys.current.has(rule)) ruleKeys.current.set(rule, crypto.randomUUID());
    return ruleKeys.current.get(rule)!;
  };
  useEffect(() => { (form.current?.querySelector<HTMLInputElement>("input[type=text]") ?? form.current?.querySelector("select"))?.focus(); }, [focusRequest]);
  const updateRule = (index: number, patch: Partial<Filter["rules"][number]>, apply = false) => {
    const next = { ...value, rules: value.rules.map((rule, i) => {
      if (i !== index) return rule;
      const updated = { ...rule, ...patch };
      ruleKeys.current.set(updated, ruleKey(rule));
      return updated;
    }) };
    onChange(next);
    if (apply) onApply(next);
  };
  return <form ref={form} aria-label="Filter rules" onSubmit={(event) => { event.preventDefault(); if (!disabled) onApply(value); }}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    }}
    style={{ width: "100%", overflowY: "auto", maxHeight: "40%", flexShrink: 1 }}>
    <fieldset disabled={disabled} style={{ display: "flex", flexDirection: "column", gap: 6, border: 0, margin: 0, padding: 6, minWidth: 0 }}>
      {value.rules.map((rule, index) => {
        const needsValue = operatorNeedsValue(rule.operator);
        const invalid = rule.enabled && !activeRule(rule);
        const inputStyle = { ...style, flex: 1, minWidth: 60, width: 80, ...(invalid ? { border: `1px solid ${danger}` } : {}) };
        return <div key={ruleKey(rule)} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <input type="checkbox" aria-label={`Enable filter rule ${index + 1}`} checked={rule.enabled}
            onChange={(event) => updateRule(index, { enabled: event.currentTarget.checked }, true)} />
          <select aria-label={`Filter column ${index + 1}`} value={rule.column} style={{ ...style, maxWidth: "100%" }}
            onChange={(event) => updateRule(index, { column: event.currentTarget.value === "any" ? "any" : Number(event.currentTarget.value) })}>
            <option value="any">Any column</option>
            {columns.map((column, i) => <option key={i} value={i}>{column}{hidden.includes(i) ? " [hidden]" : ""}</option>)}
          </select>
          <select aria-label={`Filter operator ${index + 1}`} value={rule.operator} style={style}
            onChange={(event) => updateRule(index, { operator: event.currentTarget.value as Filter["rules"][number]["operator"] })}>
            {filterOperators.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
          </select>
          {needsValue && <input type="text" aria-label={`Filter value ${index + 1}`} value={rule.value ?? ""} aria-invalid={invalid}
            title={invalid ? "This rule needs a value and will be ignored until complete" : undefined} style={inputStyle}
            onChange={(event) => updateRule(index, { value: event.currentTarget.value })} />}
          {rule.operator === "between" && <input type="text" aria-label={`Filter upper value ${index + 1}`} value={rule.value2 ?? ""} aria-invalid={invalid}
            title={invalid ? "Between needs both values and will be ignored until complete" : undefined} style={inputStyle}
            onChange={(event) => updateRule(index, { value2: event.currentTarget.value })} />}
          <button type="button" aria-label={`Remove filter rule ${index + 1}`} style={style}
            onClick={() => onChange({ ...value, rules: value.rules.length === 1 ? emptyFilter().rules : value.rules.filter((_, i) => i !== index) })}>−</button>
          <button type="button" aria-label={`Add filter rule after ${index + 1}`} style={style}
            onClick={() => onChange({ ...value, rules: [...value.rules.slice(0, index + 1), emptyFilter().rules[0], ...value.rules.slice(index + 1)] })}>+</button>
        </div>;
      })}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <select aria-label="Match filter rules" value={value.match} style={style}
          onChange={(event) => onChange({ ...value, match: event.currentTarget.value as Filter["match"] })}>
          <option value="all">Match all</option><option value="any">Match any</option>
        </select>
        <button type="button" aria-label="Case sensitive" title="Case sensitive" aria-pressed={value.caseSensitive}
          style={{ ...style, fontWeight: value.caseSensitive ? "bold" : "normal", textDecoration: value.caseSensitive ? "underline" : "none" }}
          onClick={() => onChange({ ...value, caseSensitive: !value.caseSensitive })}>Aa</button>
        <button type="submit" aria-label="Apply filter" style={style}>Filter</button>
      </div>
    </fieldset>
  </form>;
}
