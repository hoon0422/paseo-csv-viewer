import { useCallback, useRef, useState, type MouseEvent } from "react";
import { FlatList, Pressable, ScrollView, Text, View, type ViewToken } from "react-native";

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
  onSort?: (column: number, direction: "asc" | "desc") => void;
  onEndReached?: () => void;
  onVisibleRowsChange?: (indices: number[]) => void;
  onSelectRow?: (index: number, event: MouseEvent) => void;
};

const DEFAULT_WIDTH = 160;
const MIN_WIDTH = 80;
const MAX_WIDTH = 480;

export function TableView({ columns, rows, theme, sort, sortBusy, onSort, presentation, onPresentation, onCopy, onEndReached, onVisibleRowsChange, onSelectRow }: Props) {
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
  const visible = columns.map((_, index) => index).filter((index) => !hidden.includes(index));
  const toggleExpanded = (index: number) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });

  const control = (label: string, onPress: () => void, disabled = false, caption = label) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
      disabled={disabled} onPress={onPress}
      style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 }}>
      <Text style={{ color: disabled ? theme.muted : theme.foreground }}>{caption}</Text>
    </Pressable>
  );

  return <View role="table" accessibilityLabel="CSV rows" style={{ flex: 1, minHeight: 0 }}>
    <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ minWidth: "100%" }}>
      <View style={{ flex: 1 }}>
        <View role="row" style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: theme.border, backgroundColor: theme.border }}>
          <Text role="columnheader" style={{ width: 70, padding: 6, color: theme.foreground, fontWeight: "700" }}>#</Text>
          {visible.map((index) => <View key={index} style={{ width: widths[index] ?? DEFAULT_WIDTH, padding: 4, gap: 3 }}>
            <Text role="columnheader" accessibilityRole="header" accessibilityLabel={columns[index] || `Column ${index + 1}`}
              numberOfLines={1} style={{ color: theme.foreground, fontWeight: "700" }}>{columns[index] || `Column ${index + 1}`}</Text>
            {sort?.column === index && <Text style={{ color: theme.muted }}>{sort.direction === "asc" ? "Ascending ↑" : "Descending ↓"}</Text>}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 3 }}>
              {control(`Narrow ${columns[index] || `Column ${index + 1}`}`, () => setWidths({ ...widths, [index]: Math.max(MIN_WIDTH, (widths[index] ?? DEFAULT_WIDTH) - 40) }), (widths[index] ?? DEFAULT_WIDTH) <= MIN_WIDTH, "−")}
              {control(`Widen ${columns[index] || `Column ${index + 1}`}`, () => setWidths({ ...widths, [index]: Math.min(MAX_WIDTH, (widths[index] ?? DEFAULT_WIDTH) + 40) }), (widths[index] ?? DEFAULT_WIDTH) >= MAX_WIDTH, "+")}
              {control(`Hide ${columns[index] || `Column ${index + 1}`}`, () => setHidden([...hidden, index]), false, "Hide")}
              {onSort && control(`Sort column ${index + 1} ${columns[index] || `Column ${index + 1}`} ascending`, () => onSort(index, "asc"), sortBusy, "↑")}
              {onSort && control(`Sort column ${index + 1} ${columns[index] || `Column ${index + 1}`} descending`, () => onSort(index, "desc"), sortBusy, "↓")}
            </View>
          </View>)}
        </View>
        <FlatList data={rows} style={{ flex: 1 }} keyExtractor={(_, index) => String(index)}
          initialNumToRender={20} maxToRenderPerBatch={20} windowSize={5}
          onEndReached={onEndReached} onEndReachedThreshold={1}
          viewabilityConfig={viewabilityConfig.current} onViewableItemsChanged={onViewableItemsChanged}
          renderItem={({ item: row, index: rowIndex }) => <div role="row" aria-label={`Select row ${rowIndex + 1}`}
            aria-selected={selected.includes(rowIndex)} onClick={(event) => onSelectRow?.(rowIndex, event)}
            style={{ display: "flex", position: "relative", backgroundColor: selected.includes(rowIndex) ? "rgba(128, 128, 128, 0.25)" : "transparent",
              minHeight: 30, boxSizing: "border-box", borderBottom: `1px solid ${theme.border}` }}>
            <Text role="rowheader" style={{ width: 70, padding: 6, color: theme.foreground }}>{rowIndex + 1}</Text>
            {visible.map((index) => {
              const value = row[index] ?? "";
              return <Pressable key={index} accessibilityRole="button"
                accessibilityLabel={`Copy cell row ${rowIndex + 1}, ${columns[index] || `Column ${index + 1}`}, ${value === "" ? "empty cell" : `value: ${value}`}`}
                onPress={() => onCopy(value, "Copied cell")}
                style={{ width: widths[index] ?? DEFAULT_WIDTH, padding: 6 }}>
                <div title={value} style={{ color: theme.foreground, overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: expanded.has(rowIndex) ? "pre-wrap" : "nowrap", overflowWrap: "anywhere", lineHeight: "18px" }}>{value}</div>
              </Pressable>;
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
  </View>;
}
