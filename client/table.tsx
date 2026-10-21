import { useCallback, useId, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View, type ViewToken } from "react-native";
import { ColumnHeader, ColumnMenu } from "./columns";

export type TablePresentation = { hidden: number[]; widths: Record<number, number>; selected: number[] };

type Props = {
  presentation: TablePresentation;
  onPresentation: (next: TablePresentation) => void;
  onCopy: (value: string, label: string) => void;
  columns: string[];
  rows: string[][];
  theme: { foreground: string; muted: string; border: string };
  sort?: { column: number; direction: "asc" | "desc"; mode: "auto" | "numeric" | "text" } | null;
  sortBusy?: boolean;
  onSort?: (column: number, direction: "asc" | "desc" | null) => void;
  onEndReached?: () => void;
  onVisibleRowsChange?: (indices: number[]) => void;
};

const DEFAULT_WIDTH = 160;

export function TableView({ columns, rows, theme, sort, sortBusy, onSort, presentation, onPresentation, onCopy, onEndReached, onVisibleRowsChange }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ column: number; anchor: HTMLButtonElement } | null>(null);
  const menuId = useId();
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const visibleRows = useRef(onVisibleRowsChange);
  visibleRows.current = onVisibleRowsChange;
  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 0 });
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    visibleRows.current?.(viewableItems.flatMap((item) => item.index === null ? [] : [item.index]));
  }, []);
  const { hidden, widths, selected } = presentation;
  const setHidden = (hidden: number[]) => onPresentation({ ...presentation, hidden });
  const setWidths = (widths: Record<number, number>) => onPresentation({ ...presentation, widths });
  const setSelected = (selected: number[]) => onPresentation({ ...presentation, selected });
  const visible = columns.map((_, index) => index).filter((index) => !hidden.includes(index));
  const toggleExpanded = (index: number) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });

  return <div ref={container} tabIndex={-1} style={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0, position: "relative" }}>
    <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ minWidth: "100%" }}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: theme.border, backgroundColor: theme.border }}>
          <Text style={{ width: 70, padding: 6, color: theme.foreground, fontWeight: "700" }}>Select</Text>
          {visible.map((index) => <ColumnHeader key={index} name={columns[index] || `Column ${index + 1}`}
            width={widths[index] ?? DEFAULT_WIDTH} theme={theme} direction={sort?.column === index ? sort.direction : undefined}
            rows={rows} column={index}
            menuId={menu?.column === index ? menuId : undefined}
            onMenu={(anchor) => setMenu(menu?.column === index ? null : { column: index, anchor })}
            onWidth={(width) => setWidths({ ...widths, [index]: width })} />)}
        </View>
        <FlatList data={rows} style={{ flex: 1 }} keyExtractor={(_, index) => String(index)}
          initialNumToRender={20} maxToRenderPerBatch={20} windowSize={5}
          onEndReached={onEndReached} onEndReachedThreshold={1}
          viewabilityConfig={viewabilityConfig.current} onViewableItemsChanged={onViewableItemsChanged}
          renderItem={({ item: row, index: rowIndex }) => <div style={{ display: "flex", position: "relative",
            minHeight: 30, boxSizing: "border-box", borderBottom: `1px solid ${theme.border}` }}>
            <Pressable accessibilityRole="checkbox" accessibilityLabel={`Select row ${rowIndex + 1}`}
              accessibilityState={{ checked: selected.includes(rowIndex) }}
              onPress={() => setSelected(selected.includes(rowIndex) ? selected.filter((index) => index !== rowIndex) : [...selected, rowIndex])}
              style={{ width: 70, padding: 6 }}>
              <Text style={{ color: theme.foreground }}>{selected.includes(rowIndex) ? "☑" : "☐"} {rowIndex + 1}</Text>
            </Pressable>
            {visible.map((index) => {
              const value = row[index] ?? "";
              return <button key={index} type="button" tabIndex={0}
                aria-label={`Copy cell row ${rowIndex + 1}, ${columns[index] || `Column ${index + 1}`}, ${value === "" ? "empty cell" : `value: ${value}`}`}
                onDoubleClick={(event) => { event.stopPropagation(); onCopy(value, "Copied cell"); }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault(); event.stopPropagation(); onCopy(value, "Copied cell");
                }}
                style={{ width: widths[index] ?? DEFAULT_WIDTH, padding: 6, boxSizing: "border-box", flexShrink: 0, border: 0,
                  background: "transparent", textAlign: "left",
                  fontSize: 14, fontFamily: "system-ui, sans-serif" }}>
                <div title={value} style={{ color: theme.foreground, overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: expanded.has(rowIndex) ? "pre-wrap" : "nowrap", overflowWrap: "anywhere", lineHeight: "18px", tabSize: 8 }}>{value}</div>
              </button>;
            })}
            <button type="button" aria-label={`Toggle row ${rowIndex + 1} expansion`} aria-expanded={expanded.has(rowIndex)}
              title="Double-click to expand or collapse row"
              onDoubleClick={(event) => { event.stopPropagation(); toggleExpanded(rowIndex); }}
              onClick={(event) => { event.stopPropagation(); if (event.detail === 0) toggleExpanded(rowIndex); }}
              style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: 5, padding: 0,
                border: 0, background: "transparent", cursor: "row-resize" }} />
          </div>} />
      </View>
    </ScrollView>
    {menu && <ColumnMenu id={menuId} anchor={menu.anchor} container={container} column={menu.column}
      name={columns[menu.column] || `Column ${menu.column + 1}`} theme={theme}
      direction={sort?.column === menu.column ? sort.direction : undefined} hasSort={!!sort} sortBusy={sortBusy} onSort={onSort}
      onHide={() => setHidden([...hidden, menu.column])} onClose={() => setMenu(null)} />}
  </div>;
}
