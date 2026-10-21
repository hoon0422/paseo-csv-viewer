import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

type Props = {
  columns: string[];
  rows: string[][];
  theme: { foreground: string; muted: string; border: string };
};

const DEFAULT_WIDTH = 160;
const MIN_WIDTH = 80;
const MAX_WIDTH = 480;

export function TableView({ columns, rows, theme }: Props) {
  const [hidden, setHidden] = useState<number[]>([]);
  const [widths, setWidths] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  const visible = columns.map((_, index) => index).filter((index) => !hidden.includes(index));

  useEffect(() => { setSelected([]); }, [rows]);

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied`);
    } catch {
      setMessage("Clipboard unavailable. Check desktop clipboard permission.");
    }
  }

  function tsv(value: string) {
    return /[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }

  const control = (label: string, onPress: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
      disabled={disabled} onPress={onPress}
      style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 }}>
      <Text style={{ color: disabled ? theme.muted : theme.foreground }}>{label}</Text>
    </Pressable>
  );

  return <View style={{ flex: 1, minHeight: 140, gap: 6 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      {control("Copy selected rows", () => {
        const value = [...selected].sort((a, b) => a - b).map((index) => visible.map((column) => tsv(rows[index]?.[column] ?? "")).join("\t")).join("\n");
        void copy(value, "Rows");
      }, selected.length === 0)}
      {hidden.map((index) => <View key={index}>{control(`Reveal ${columns[index] || `Column ${index + 1}`}`, () => setHidden(hidden.filter((value) => value !== index)))}</View>)}
      <Text accessibilityLiveRegion="polite" style={{ color: theme.muted }}>{message || `${selected.length} rows selected`}</Text>
    </View>
    <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ minWidth: "100%" }}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: theme.border, backgroundColor: theme.border }}>
          <Text style={{ width: 70, padding: 6, color: theme.foreground, fontWeight: "700" }}>Select</Text>
          {visible.map((index) => <View key={index} style={{ width: widths[index] ?? DEFAULT_WIDTH, padding: 4, gap: 3 }}>
            <Text accessibilityRole="header" style={{ color: theme.foreground, fontWeight: "700" }}>{columns[index] || `Column ${index + 1}`}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 3 }}>
              {control(`Narrow ${columns[index] || `Column ${index + 1}`}`, () => setWidths({ ...widths, [index]: Math.max(MIN_WIDTH, (widths[index] ?? DEFAULT_WIDTH) - 40) }), (widths[index] ?? DEFAULT_WIDTH) <= MIN_WIDTH)}
              {control(`Widen ${columns[index] || `Column ${index + 1}`}`, () => setWidths({ ...widths, [index]: Math.min(MAX_WIDTH, (widths[index] ?? DEFAULT_WIDTH) + 40) }), (widths[index] ?? DEFAULT_WIDTH) >= MAX_WIDTH)}
              {control(`Hide ${columns[index] || `Column ${index + 1}`}`, () => setHidden([...hidden, index]))}
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
            {visible.map((index) => <Pressable key={index} accessibilityRole="button"
              accessibilityLabel={`Copy cell row ${rowIndex + 1}, ${columns[index] || `Column ${index + 1}`}`}
              onPress={() => void copy(row[index] ?? "", "Cell")}
              style={{ width: widths[index] ?? DEFAULT_WIDTH, padding: 6 }}>
              <Text style={{ color: theme.foreground }}>{row[index] ?? ""}</Text>
            </Pressable>)}
          </View>)}
        </ScrollView>
      </View>
    </ScrollView>
  </View>;
}
