import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { z } from "zod";
import { closePreview, openPreview, type source } from "../shared/session";
import { chooseLocalFile, listenForDrops } from "./drop";

type Source = z.output<typeof source>;
type Preview = z.output<typeof openPreview.output>;

export function ViewerPanel({ theme, host, workspaceId, layout }: PluginWorkspacePanelProps) {
  const [path, setPath] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasHeader, setHasHeader] = useState(true);
  const panelId = useRef(crypto.randomUUID());
  const generation = useRef(0);
  const session = useRef<string | null>(null);
  const selectedSource = useRef<Source | null>(null);
  const currentHost = useRef(host.id);
  currentHost.current = host.id;
  const zone = useRef<View>(null);
  const openRpc = useRpc(openPreview);
  const closeRpc = useRpc(closePreview);
  const mutation = useMutation({ mutationFn: openRpc });

  async function open(file: Source, header = hasHeader) {
    if (currentHost.current !== host.id) {
      setMessage("The selected host changed. Try the file again.");
      return;
    }
    const turn = ++generation.current;
    selectedSource.current = file;
    setBusy(true);
    setMessage("");
    setPreview(null);
    try {
      const next = await mutation.mutateAsync({ panelId: panelId.current, workspaceId, source: file, hasHeader: header });
      if (turn !== generation.current || currentHost.current !== host.id) {
        void closeRpc({ sessionId: next.sessionId });
        return;
      }
      session.current = next.sessionId;
      setPreview(next);
    } catch (cause) {
      if (turn === generation.current) setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (turn === generation.current) setBusy(false);
    }
  }

  useEffect(() => listenForDrops(zone.current, host.id, workspaceId, (file) => void open(file), setMessage), [host.id, workspaceId]);
  useEffect(() => () => {
    generation.current++;
    if (session.current) void closeRpc({ sessionId: session.current });
  }, [closeRpc, host.id, workspaceId]);

  const foreground = theme.colors.foreground;
  const muted = theme.colors.foregroundMuted;
  return (
    <View ref={zone} style={{ flex: 1, padding: layout.compact ? 12 : 20, backgroundColor: theme.colors.surface0, gap: 12 }}>
      <Text style={{ color: foreground, fontSize: 20, fontWeight: "600" }}>CSV Viewer</Text>
      <Text style={{ color: muted }}>Open a CSV or TSV in this workspace, or drop one here.</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <TextInput value={path} onChangeText={setPath} placeholder="Workspace-relative path, e.g. data.csv"
          placeholderTextColor={muted} accessibilityLabel="Workspace file path"
          style={{ minWidth: 220, flexGrow: 1, borderWidth: 1, borderColor: muted, borderRadius: 6, padding: 8, color: foreground }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Open workspace file" onPress={() => void open({ kind: "workspace", path })}
          style={{ padding: 9, borderWidth: 1, borderColor: muted, borderRadius: 6 }}>
          <Text style={{ color: foreground }}>Open path</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Choose local CSV or TSV" onPress={() => {
          void chooseLocalFile(host.id).then((file) => { if (file) void open(file); }, (cause) => setMessage(cause instanceof Error ? cause.message : String(cause)));
        }} style={{ padding: 9, borderWidth: 1, borderColor: muted, borderRadius: 6 }}>
          <Text style={{ color: foreground }}>Choose local file</Text>
        </Pressable>
      </View>
      <Pressable accessibilityRole="switch" accessibilityLabel="First record is header"
        accessibilityState={{ checked: hasHeader }} onPress={() => {
          const next = !hasHeader;
          setHasHeader(next);
          if (selectedSource.current) void open(selectedSource.current, next);
        }} style={{ alignSelf: "flex-start", padding: 9, borderWidth: 1, borderColor: muted, borderRadius: 6 }}>
        <Text style={{ color: foreground }}>First record is header: {hasHeader ? "On" : "Off"}</Text>
      </Pressable>
      {busy && <Text style={{ color: muted }}>Opening preview…</Text>}
      {!!message && <Text accessibilityRole="alert" style={{ color: foreground }}>{message}</Text>}
      {preview && <>
        <Text style={{ color: foreground }}>{preview.fileName} · {preview.sourceBytes} bytes · first {preview.limit} rows only</Text>
        {preview.columns.length === 0 ? <Text style={{ color: muted }}>This file is empty.</Text> : <>
          {preview.rows.length === 0 && <Text style={{ color: muted }}>No data rows in this file.</Text>}
          <ScrollView horizontal style={{ flex: 1 }}><ScrollView>
            <View style={{ flexDirection: "row" }}>
              {preview.columns.map((column, index) => <Text key={index} style={{ color: foreground, fontWeight: "700", minWidth: 130, padding: 6 }}>{column || "Column " + (index + 1)}</Text>)}
            </View>
            {preview.rows.map((row, rowIndex) => <View key={rowIndex} style={{ flexDirection: "row" }}>
              {row.map((cell, columnIndex) => <Text key={columnIndex} selectable style={{ color: foreground, minWidth: 130, padding: 6 }}>{cell}</Text>)}
            </View>)}
          </ScrollView></ScrollView></>}
      </>}
    </View>
  );
}
