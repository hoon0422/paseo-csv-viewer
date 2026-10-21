import { Pressable, ScrollView, Text, View } from "react-native";

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
};

const DEFAULT_WIDTH = 160;
const MIN_WIDTH = 80;
const MAX_WIDTH = 480;

export function TableView({ columns, rows, theme, sort, sortBusy, onSort, presentation, onPresentation, onCopy }: Props) {
  const { hidden, widths, selected } = presentation;
  const setHidden = (hidden: number[]) => onPresentation({ ...presentation, hidden });
  const setWidths = (widths: Record<number, number>) => onPresentation({ ...presentation, widths });
  const setSelected = (selected: number[]) => onPresentation({ ...presentation, selected });
  const visible = columns.map((_, index) => index).filter((index) => !hidden.includes(index));

  const control = (label: string, onPress: () => void, disabled = false, caption = label) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
      disabled={disabled} onPress={onPress}
      style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 }}>
      <Text style={{ color: disabled ? theme.muted : theme.foreground }}>{caption}</Text>
    </Pressable>
  );

  return <View style={{ flex: 1, minHeight: 0 }}>
    <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ minWidth: "100%" }}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: theme.border, backgroundColor: theme.border }}>
          <Text style={{ width: 70, padding: 6, color: theme.foreground, fontWeight: "700" }}>Select</Text>
          {visible.map((index) => <View key={index} style={{ width: widths[index] ?? DEFAULT_WIDTH, padding: 4, gap: 3 }}>
            <Text accessibilityRole="header" accessibilityLabel={columns[index] || `Column ${index + 1}`}
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
        <ScrollView style={{ flex: 1 }}>
          {rows.map((row, rowIndex) => <View key={rowIndex} style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: theme.border }}>
            <Pressable accessibilityRole="checkbox" accessibilityLabel={`Select row ${rowIndex + 1}`}
              accessibilityState={{ checked: selected.includes(rowIndex) }}
              onPress={() => setSelected(selected.includes(rowIndex) ? selected.filter((index) => index !== rowIndex) : [...selected, rowIndex])}
              style={{ width: 70, padding: 6 }}>
              <Text style={{ color: theme.foreground }}>{selected.includes(rowIndex) ? "☑" : "☐"} {rowIndex + 1}</Text>
            </Pressable>
            {visible.map((index) => {
              const value = row[index] ?? "";
              return <Pressable key={index} accessibilityRole="button"
                accessibilityLabel={`Copy cell row ${rowIndex + 1}, ${columns[index] || `Column ${index + 1}`}, ${value === "" ? "empty cell" : `value: ${value}`}`}
                onPress={() => onCopy(value, "Copied cell")}
                style={{ width: widths[index] ?? DEFAULT_WIDTH, padding: 6 }}>
                <Text style={{ color: theme.foreground }}>{value}</Text>
              </Pressable>;
            })}
          </View>)}
        </ScrollView>
      </View>
    </ScrollView>
  </View>;
}
