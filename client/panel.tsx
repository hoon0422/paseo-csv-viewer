import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { z } from "zod";
import { closePreview, openPreview, pageRows, sessionStatus, type source } from "../shared/session";
import { chooseLocalFile, listenForDrops } from "./drop";

type Source = z.output<typeof source>;
type Preview = z.output<typeof openPreview.output>;
type Status = z.output<typeof sessionStatus.output>;

export function ViewerPanel({ theme, host, workspaceId, layout }: PluginWorkspacePanelProps) {
  const [path, setPath] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [offset, setOffset] = useState(0);
  const [pageBusy, setPageBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasHeader, setHasHeader] = useState(true);
  const panelId = useRef(crypto.randomUUID());
  const generation = useRef(0);
  const mounted = useRef(true);
  const session = useRef<string | null>(null);
  const selectedSource = useRef<Source | null>(null);
  const currentHost = useRef(host.id);
  currentHost.current = host.id;
  const zone = useRef<View>(null);
  const openRpc = useRpc(openPreview);
  const closeRpc = useRpc(closePreview);
  const statusRpc = useRpc(sessionStatus);
  const pageRpc = useRpc(pageRows);
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
    setStatus(null);
    setRows([]);
    setOffset(0);
    try {
      const next = await mutation.mutateAsync({ panelId: panelId.current, workspaceId, source: file, hasHeader: header, turn });
      if (!mounted.current || turn !== generation.current || currentHost.current !== host.id) {
        void closeRpc({ sessionId: next.sessionId });
        return;
      }
      session.current = next.sessionId;
      setPreview(next);
      setRows(next.rows);
    } catch (cause) {
      if (mounted.current && turn === generation.current) setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current && turn === generation.current) setBusy(false);
    }
  }

  async function navigate(nextOffset: number) {
    if (!preview || status?.phase !== "complete") return;
    const turn = generation.current;
    setPageBusy(true);
    try {
      const page = await pageRpc({ sessionId: preview.sessionId, offset: nextOffset, limit: preview.limit });
      if (!mounted.current || turn !== generation.current || session.current !== preview.sessionId) return;
      setRows(page.rows);
      setOffset(page.offset);
    } catch (cause) {
      if (mounted.current && turn === generation.current) setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current && turn === generation.current) setPageBusy(false);
    }
  }

  useEffect(() => {
    let live = true;
    const stop = listenForDrops(zone.current, host.id, workspaceId,
      (file) => { if (live) void open(file); },
      (error) => { if (live) setMessage(error); });
    return () => { live = false; stop(); };
  }, [host.id, workspaceId]);
  useEffect(() => {
    if (!preview) return;
    let live = true;
    const turn = generation.current;
    const poll = () => void statusRpc({ sessionId: preview.sessionId }).then((next) => {
      if (live && mounted.current && turn === generation.current && session.current === preview.sessionId) setStatus(next);
    }, (cause) => {
      if (live && mounted.current && turn === generation.current) setMessage(cause instanceof Error ? cause.message : String(cause));
    });
    poll();
    const timer = setInterval(poll, 500);
    return () => { live = false; clearInterval(timer); };
  }, [preview?.sessionId, statusRpc]);
  useEffect(() => {
    setPreview(null);
    setStatus(null);
    setRows([]);
    setOffset(0);
    setBusy(false);
    setMessage("");
    session.current = null;
    selectedSource.current = null;
    return () => {
      const turn = ++generation.current;
      void closeRpc({ panelId: panelId.current, turn });
    };
  }, [host.id, workspaceId]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

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
          const turn = generation.current;
          void chooseLocalFile(host.id).then((file) => {
            if (file && mounted.current && turn === generation.current && currentHost.current === host.id) void open(file);
          }, (cause) => {
            if (mounted.current && turn === generation.current) setMessage(cause instanceof Error ? cause.message : String(cause));
          });
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
        <Text style={{ color: foreground }}>{preview.fileName} · {preview.sourceBytes} bytes</Text>
        {status && <Text accessibilityRole="text" style={{ color: status.phase === "error" ? foreground : muted }}>
          {status.phase === "error" ? status.message : `${status.message}${status.percent == null ? "" : ` · ${Math.round(status.percent)}%`}`}
        </Text>}
        {status?.phase !== "complete" && status?.phase !== "error" && <Pressable accessibilityRole="button" accessibilityLabel="Cancel preparation"
          onPress={() => { const turn = ++generation.current; void closeRpc({ panelId: panelId.current, turn }); setPreview(null); setStatus(null); setRows([]); setMessage("Preparation cancelled"); }}>
          <Text style={{ color: foreground }}>Cancel</Text>
        </Pressable>}
        {status?.phase === "complete" && !!status.rowCount && <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous rows" disabled={pageBusy || offset === 0}
            onPress={() => void navigate(Math.max(0, offset - preview.limit))}><Text style={{ color: foreground }}>Previous</Text></Pressable>
          <Text style={{ color: muted }}>Rows {offset + 1}–{Math.min(offset + rows.length, status.rowCount)} of {status.rowCount}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Next rows" disabled={pageBusy || offset + rows.length >= status.rowCount}
            onPress={() => void navigate(offset + preview.limit)}><Text style={{ color: foreground }}>Next</Text></Pressable>
        </View>}
        {preview.columns.length === 0 ? <Text style={{ color: muted }}>This file is empty.</Text> : <>
          {rows.length === 0 && <Text style={{ color: muted }}>No data rows in this file.</Text>}
          <ScrollView horizontal style={{ flex: 1 }}><ScrollView>
            <View style={{ flexDirection: "row" }}>
              {preview.columns.map((column, index) => <Text key={index} style={{ color: foreground, fontWeight: "700", minWidth: 130, padding: 6 }}>{column || "Column " + (index + 1)}</Text>)}
            </View>
            {rows.map((row, rowIndex) => <View key={rowIndex} style={{ flexDirection: "row" }}>
              {row.map((cell, columnIndex) => <Text key={columnIndex} selectable style={{ color: foreground, minWidth: 130, padding: 6 }}>{cell}</Text>)}
            </View>)}
          </ScrollView></ScrollView></>}
      </>}
    </View>
  );
}
