import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { z } from "zod";
import { closePreview, openPreview, pageQuery, pageRows, sessionStatus, type source } from "../shared/session";
import { chooseLocalFile, listenForDrops } from "./drop";
import { TableView } from "./table";

type Source = z.output<typeof source>;
type Preview = z.output<typeof openPreview.output>;
type Status = z.output<typeof sessionStatus.output>;
type Sort = NonNullable<z.output<typeof pageRows.input>["sort"]>;

export function ViewerPanel({ theme, host, workspaceId, layout }: PluginWorkspacePanelProps) {
  const [path, setPath] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [offset, setOffset] = useState(0);
  const [totalRows, setTotalRows] = useState<number | null>(null);
  const [pageBusy, setPageBusy] = useState(false);
  const [sort, setSort] = useState<Sort | null>(null);
  const [sortMode, setSortMode] = useState<"numeric" | "text" | undefined>();
  const [search, setSearch] = useState("");
  const [queryPending, setQueryPending] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasHeader, setHasHeader] = useState(true);
  const panelId = useRef(crypto.randomUUID());
  const generation = useRef(0);
  const selection = useRef(0);
  const pageRequest = useRef(0);
  const queryRequest = useRef(0);
  const queryDirty = useRef(false);
  const mounted = useRef(true);
  const session = useRef<string | null>(null);
  const selectedSource = useRef<Source | null>(null);
  const currentHost = useRef(host.id);
  const currentWorkspace = useRef(workspaceId);
  const currentHeader = useRef(hasHeader);
  currentHost.current = host.id;
  currentWorkspace.current = workspaceId;
  const zone = useRef<View>(null);
  const openRpc = useRpc(openPreview);
  const closeRpc = useRpc(closePreview);
  const statusRpc = useRpc(sessionStatus);
  const queryRpc = useRpc(pageQuery);
  const mutation = useMutation({ mutationFn: openRpc });

  async function open(file: Source, header = currentHeader.current) {
    if (!mounted.current) return;
    if (currentHost.current !== host.id || currentWorkspace.current !== workspaceId) {
      setMessage("The selected workspace or host changed. Try the file again.");
      return;
    }
    const turn = ++generation.current;
    ++selection.current;
    ++pageRequest.current;
    ++queryRequest.current;
    queryDirty.current = false;
    selectedSource.current = file;
    setBusy(true);
    setPageBusy(false);
    setSearch("");
    setQueryPending(false);
    setTotalRows(null);
    setMessage("");
    setPreview(null);
    setStatus(null);
    setRows([]);
    setOffset(0);
    setSort(null);
    setSortMode(undefined);
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

  function select(source: Source | Promise<Source | null>) {
    const action = ++selection.current;
    void Promise.resolve(source).then((file) => {
      if (file && mounted.current && action === selection.current && currentHost.current === host.id && currentWorkspace.current === workspaceId) void open(file, currentHeader.current);
    }, (cause) => {
      if (mounted.current && action === selection.current) setMessage(cause instanceof Error ? cause.message : String(cause));
    });
  }

  function changeSearch(next: string) {
    queryDirty.current = true;
    ++queryRequest.current;
    ++pageRequest.current;
    setSearch(next);
    setRows([]);
    setOffset(0);
    setTotalRows(null);
    setPageBusy(false);
    setQueryPending(!!next);
  }

  function cancelQuery() {
    ++queryRequest.current;
    ++pageRequest.current;
    queryDirty.current = false;
    setSearch("");
    setSort(null);
    setSortMode(undefined);
    setRows([]);
    setOffset(0);
    setTotalRows(null);
    setPageBusy(false);
    void navigate(0, null, "");
  }

  async function navigate(nextOffset: number, nextSort = sort, nextSearch = search) {
    if (!preview || status?.phase !== "complete") return;
    const turn = generation.current;
    const request = ++pageRequest.current;
    const query = queryRequest.current;
    setPageBusy(true);
    if (nextOffset === 0) setQueryPending(true);
    try {
      await queryRpc({ action: "start", sessionId: preview.sessionId, offset: nextOffset, limit: preview.limit, search: nextSearch, requestId: query, sort: nextSort ?? undefined });
      let page: z.output<typeof pageRows.output>;
      for (;;) {
        if (!mounted.current || turn !== generation.current || request !== pageRequest.current || session.current !== preview.sessionId) return;
        const result = await queryRpc({ action: "poll", sessionId: preview.sessionId, requestId: query });
        if (result.state === "ready") { page = result.page; break; }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!mounted.current || turn !== generation.current || request !== pageRequest.current || query !== queryRequest.current || session.current !== preview.sessionId) return;
      setRows(page.rows);
      setOffset(page.offset);
      setTotalRows(page.totalRows);
      setSortMode(page.sortMode);
    } catch (cause) {
      if (mounted.current && turn === generation.current && request === pageRequest.current) setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current && turn === generation.current && request === pageRequest.current) { setPageBusy(false); setQueryPending(false); }
    }
  }

  useEffect(() => {
    if (!preview || status?.phase !== "complete" || !preview.columns.length) return;
    if (queryDirty.current) void navigate(0);
    else setTotalRows(status.rowCount);
  }, [preview?.sessionId, status?.phase, search]);

  useEffect(() => {
    let live = true;
    const stop = listenForDrops(zone.current, host.id, workspaceId,
      (file) => { if (live) select(file); },
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
    setSort(null);
    setSortMode(undefined);
    setTotalRows(null);
    setBusy(false);
    setPageBusy(false);
    setSearch("");
    setQueryPending(false);
    queryDirty.current = false;
    setMessage("");
    session.current = null;
    selectedSource.current = null;
    return () => {
      const turn = ++generation.current;
      ++selection.current;
      ++pageRequest.current;
      ++queryRequest.current;
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
          select(chooseLocalFile(host.id));
        }} style={{ padding: 9, borderWidth: 1, borderColor: muted, borderRadius: 6 }}>
          <Text style={{ color: foreground }}>Choose local file</Text>
        </Pressable>
      </View>
      <Pressable accessibilityRole="switch" accessibilityLabel="First record is header"
        accessibilityState={{ checked: hasHeader }} onPress={() => {
          const next = !hasHeader;
          currentHeader.current = next;
          setHasHeader(next);
          if (selectedSource.current) void open(selectedSource.current, next);
        }} style={{ alignSelf: "flex-start", padding: 9, borderWidth: 1, borderColor: muted, borderRadius: 6 }}>
        <Text style={{ color: foreground }}>First record is header: {hasHeader ? "On" : "Off"}</Text>
      </Pressable>
      {busy && <Text style={{ color: muted }}>Opening preview…</Text>}
      {!!message && <Text accessibilityRole="alert" style={{ color: foreground }}>{message}</Text>}
      {status?.sourceChanged && status.phase === "complete" && <Text accessibilityRole="alert" style={{ color: foreground }}>
        Source file changed or is no longer accessible. Showing the completed snapshot; refresh to read the current file.
      </Text>}
      {selectedSource.current && !busy && <Pressable accessibilityRole="button" accessibilityLabel="Refresh source"
        onPress={() => { if (selectedSource.current) void open(selectedSource.current); }}
        style={{ alignSelf: "flex-start", padding: 9, borderWidth: 1, borderColor: muted, borderRadius: 6 }}>
        <Text style={{ color: foreground }}>Refresh</Text>
      </Pressable>}
      {preview && <>
        <Text style={{ color: foreground }}>{preview.fileName} · {preview.sourceBytes} bytes</Text>
        {preview.columns.length > 0 && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <TextInput value={search} onChangeText={changeSearch} maxLength={2048} placeholder="Search all columns"
            placeholderTextColor={muted} accessibilityLabel="Search all columns"
            style={{ minWidth: 220, flexGrow: 1, borderWidth: 1, borderColor: muted, borderRadius: 6, padding: 8, color: foreground }} />
          {!!search && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => changeSearch("")}>
            <Text style={{ color: foreground }}>Clear search</Text>
          </Pressable>}
          {queryPending && status?.phase === "complete" && <Pressable accessibilityRole="button" accessibilityLabel={search ? "Cancel search" : "Cancel sort"} onPress={cancelQuery}>
            <Text style={{ color: foreground }}>{search ? "Cancel search" : "Cancel sort"}</Text>
          </Pressable>}
        </View>}
        {!!search && status?.phase !== "complete" && status?.phase !== "error" && <Text style={{ color: muted }}>Search pending until the whole file is ready.</Text>}
        {queryPending && status?.phase === "complete" && <Text accessibilityLiveRegion="polite" style={{ color: muted }}>{sort ? (search ? "Searching and sorting matching rows…" : "Sorting the whole file…") : "Searching the whole file…"}</Text>}
        {status && <Text accessibilityRole="text" style={{ color: status.phase === "error" ? foreground : muted }}>
          {status.phase === "error" ? status.message : `${status.message}${status.percent == null ? "" : ` · ${Math.round(status.percent)}%`}`}
        </Text>}
        {status?.phase !== "complete" && status?.phase !== "error" && <Pressable accessibilityRole="button" accessibilityLabel="Cancel preparation"
          onPress={() => { const turn = ++generation.current; ++selection.current; ++pageRequest.current; ++queryRequest.current; setPageBusy(false); setQueryPending(false); void closeRpc({ panelId: panelId.current, turn }); setPreview(null); setStatus(null); setRows([]); setMessage("Preparation cancelled"); }}>
          <Text style={{ color: foreground }}>Cancel</Text>
        </Pressable>}
        {status?.phase === "complete" && totalRows !== null && totalRows > 0 && !queryPending && <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous rows" disabled={pageBusy || offset === 0}
            onPress={() => void navigate(Math.max(0, offset - preview.limit))}><Text style={{ color: foreground }}>Previous</Text></Pressable>
          <Text style={{ color: muted }}>Rows {offset + 1}–{Math.min(offset + rows.length, totalRows)} of {totalRows}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Next rows" disabled={pageBusy || offset + rows.length >= totalRows}
            onPress={() => void navigate(offset + preview.limit)}><Text style={{ color: foreground }}>Next</Text></Pressable>
        </View>}
        {pageBusy && <Text accessibilityLiveRegion="polite" style={{ color: muted }}>{sort ? "Sorting rows…" : "Loading rows…"}</Text>}
        {status?.sourceChanged && status.phase !== "complete" ? null : preview.columns.length === 0 ? <Text style={{ color: muted }}>This file is empty.</Text> : <>
          {search && status?.phase === "complete" && !queryPending && totalRows === 0 && <Text style={{ color: muted }}>No matching rows.</Text>}
          {!search && status?.phase === "complete" && !queryPending && totalRows === 0 && <Text style={{ color: muted }}>No data rows in this file.</Text>}
          <TableView key={preview.sessionId} columns={preview.columns} rows={rows} sort={sort} sortMode={sortMode} sortBusy={pageBusy || status?.phase !== "complete"}
            onSort={(column, direction) => { const next = { column, direction, mode: sort?.column === column ? sort.mode : "auto" } as Sort; ++queryRequest.current; setRows([]); setOffset(0); setTotalRows(null); setSortMode(undefined); setSort(next); void navigate(0, next); }}
            onSortMode={(mode) => { if (!sort) return; const next = { ...sort, mode }; ++queryRequest.current; setRows([]); setOffset(0); setTotalRows(null); setSortMode(undefined); setSort(next); void navigate(0, next); }}
            theme={{ foreground, muted, border: theme.colors.border }} /></>}
      </>}
    </View>
  );
}
