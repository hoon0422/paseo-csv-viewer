import { useWorkspace, useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Text } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { z } from "zod";
import { closePreview, openPreview, pageQuery, pageRows, sessionStatus, type Filter, type source } from "../shared/session";
import { chooseLocalFile, listenForDrops } from "./drop";
import { TableView, type TablePresentation } from "./table";
import { FilterBar, activeRule, emptyFilter } from "./filter";

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
  const [filter, setFilter] = useState<Filter | undefined>();
  const [filterDraft, setFilterDraft] = useState(emptyFilter);
  const [queryPending, setQueryPending] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasHeader, setHasHeader] = useState(true);
  const [table, setTable] = useState<TablePresentation>({ hidden: [], widths: {}, selected: [] });
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterFocus, setFilterFocus] = useState(0);
  const [toast, setToast] = useState<{ message: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const workspaceDirectory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const pendingPanel = useRef<string | null>(null);
  const pathErrorId = useId();
  const [tableKey, setTableKey] = useState(0);
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
  const zone = useRef<HTMLDivElement>(null);
  const openRpc = useRpc(openPreview);
  const closeRpc = useRpc(closePreview);
  const statusRpc = useRpc(sessionStatus);
  const queryRpc = useRpc(pageQuery);
  const mutation = useMutation({ mutationFn: openRpc });

  async function open(file: Source, header = currentHeader.current, refresh = false) {
    if (!mounted.current) return;
    if (currentHost.current !== host.id || currentWorkspace.current !== workspaceId) {
      setMessage("The selected workspace or host changed. Try the file again.");
      return;
    }
    const turn = ++generation.current;
    ++selection.current;
    ++pageRequest.current;
    ++queryRequest.current;
    setBusy(true);
    setMessage("");
    if (pendingPanel.current) void closeRpc({ panelId: pendingPanel.current, turn });
    // Keep the current snapshot until a candidate preview opens successfully.
    const candidate = crypto.randomUUID();
    pendingPanel.current = candidate;
    try {
      const next = await mutation.mutateAsync({ panelId: candidate, workspaceId, source: file, hasHeader: header, turn });
      if (!mounted.current || turn !== generation.current || currentHost.current !== host.id) {
        void closeRpc({ sessionId: next.sessionId });
        return;
      }
      if (session.current) void closeRpc({ sessionId: session.current });
      selectedSource.current = file;
      session.current = next.sessionId;
      setPath(displayPath(file.path));
      setToast(null);
      setStatus(null);
      setPageBusy(false);
      setQueryPending(false);
      setTotalRows(null);
      setOffset(0);
      queryDirty.current = refresh && !!(sort || filter);
      setTableKey((key) => key + 1);
      if (!refresh) {
        setTable({ hidden: [], widths: {}, selected: [] });
        setFilterOpen(false);
        setFilter(undefined);
        setFilterDraft(emptyFilter());
        setSort(null);
        setSortMode(undefined);
      }
      setPreview(next);
      setRows(next.rows);
    } catch (cause) {
      if (mounted.current && turn === generation.current) setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (pendingPanel.current === candidate) pendingPanel.current = null;
      if (mounted.current && turn === generation.current) setBusy(false);
    }
  }

  function displayPath(value: string) {
    const root = workspaceDirectory?.replace(/[\\/]+$/, "");
    const normalized = value.replace(/\\/g, "/");
    const prefix = root?.replace(/\\/g, "/") + "/";
    return root && normalized.startsWith(prefix) ? normalized.slice(prefix.length) : value;
  }

  function select(source: Source | Promise<Source | null>) {
    const action = ++selection.current;
    void Promise.resolve(source).then((file) => {
      if (file && mounted.current && action === selection.current && currentHost.current === host.id && currentWorkspace.current === workspaceId) void open(file, currentHeader.current);
    }, (cause) => {
      if (mounted.current && action === selection.current) setMessage(cause instanceof Error ? cause.message : String(cause));
    });
  }

  function applyFilter(next: Filter | undefined) {
    if (status?.phase !== "complete" || busy) return;
    queryDirty.current = true;
    ++queryRequest.current;
    ++pageRequest.current;
    const applied = next?.rules.some(activeRule) ? next : undefined;
    setFilter(applied);
    setTableKey((key) => key + 1);
    setRows([]);
    setOffset(0);
    setTotalRows(null);
    setPageBusy(false);
    setQueryPending(true);
    setMessage("");
    void navigate(0, sort, applied ?? null);
  }

  function openFilter() {
    if (status?.phase !== "complete" || busy || !preview?.columns.length) return;
    setFilterOpen(true);
    setFilterFocus((value) => value + 1);
  }

  function closeFilter() {
    setFilterOpen(false);
    setFilterDraft(emptyFilter());
    setFilter(undefined);
    queryDirty.current = true;
    applyFilter(undefined);
    zone.current?.focus({ preventScroll: true });
  }

  function cancelQuery() {
    ++queryRequest.current;
    ++pageRequest.current;
    queryDirty.current = false;
    setFilter(undefined);
    setFilterDraft(emptyFilter());
    setSort(null);
    setSortMode(undefined);
    setRows([]);
    setOffset(0);
    setTotalRows(null);
    setPageBusy(false);
    void navigate(0, null, null);
  }

  function changeSort(next: Sort) {
    ++queryRequest.current;
    setRows([]);
    setOffset(0);
    setTotalRows(null);
    setSortMode(undefined);
    setSort(next);
    void navigate(0, next);
  }

  async function navigate(nextOffset: number, nextSort = sort, nextFilter: Filter | null | undefined = filter) {
    if (!preview || status?.phase !== "complete") return;
    const turn = generation.current;
    const request = ++pageRequest.current;
    const query = queryRequest.current;
    setPageBusy(true);
    if (nextOffset === 0) setQueryPending(true);
    try {
      await queryRpc({ action: "start", sessionId: preview.sessionId, offset: nextOffset, limit: preview.limit, filter: nextFilter ? { ...nextFilter, visibleColumns: preview.columns.map((_, index) => index).filter((index) => !table.hidden.includes(index)) } : undefined, requestId: query, sort: nextSort ?? undefined });
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
    if (!preview || status?.phase !== "complete" || busy || !preview.columns.length) return;
    if (queryDirty.current) void navigate(0);
    else setTotalRows(status.rowCount);
  }, [preview?.sessionId, status?.phase, busy]);

  useEffect(() => {
    if (filter?.rules.some((rule) => rule.column === "any" && activeRule(rule))) applyFilter(filter);
  }, [table.hidden]);

  useEffect(() => {
    let live = true;
    const stop = listenForDrops(zone.current, host.id, workspaceId,
      (file) => { if (live) select(file); },
      (error) => { if (live) setMessage(error); },
      (active) => { if (live) setDragging(active); });
    return () => { live = false; stop(); };
  }, [host.id, workspaceId]);
  useEffect(() => {
    if (!preview) return;
    let live = true;
    const poll = () => void statusRpc({ sessionId: preview.sessionId }).then((next) => {
      if (live && mounted.current && session.current === preview.sessionId) setStatus(next);
    }, (cause) => {
      if (live && mounted.current && session.current === preview.sessionId) setMessage(cause instanceof Error ? cause.message : String(cause));
    });
    poll();
    const timer = setInterval(poll, 500);
    return () => { live = false; clearInterval(timer); };
  }, [preview?.sessionId, statusRpc]);
  useEffect(() => {
    setPath("");
    setTable({ hidden: [], widths: {}, selected: [] });
    setFilterOpen(false);
    setToast(null);
    setDragging(false);
    setPreview(null);
    setStatus(null);
    setRows([]);
    setOffset(0);
    setSort(null);
    setSortMode(undefined);
    setTotalRows(null);
    setBusy(false);
    setPageBusy(false);
    setFilter(undefined);
    setFilterDraft(emptyFilter());
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
      if (pendingPanel.current) void closeRpc({ panelId: pendingPanel.current, turn });
      if (session.current) void closeRpc({ sessionId: session.current });
    };
  }, [host.id, workspaceId]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    setTable((current) => current.selected.length ? { ...current, selected: [] } : current);
  }, [rows]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function copy(value: string, label: string) {
    const turn = generation.current;
    try {
      await navigator.clipboard.writeText(value);
      if (mounted.current && turn === generation.current) setToast({ message: label });
    } catch {
      if (mounted.current && turn === generation.current) setToast({ message: "Clipboard unavailable. Check desktop clipboard permission." });
    }
  }

  function copySelected() {
    const visible = preview?.columns.map((_, index) => index).filter((index) => !table.hidden.includes(index)) ?? [];
    const tsv = (value: string) => /[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    const value = [...table.selected].sort((a, b) => a - b).map((index) => visible.map((column) => tsv(rows[index]?.[column] ?? "")).join("\t")).join("\n");
    void copy(value, `Copied ${table.selected.length} ${table.selected.length === 1 ? "row" : "rows"}`);
  }

  const foreground = theme.colors.foreground;
  const muted = theme.colors.foregroundMuted;
  const colors = theme.colors;
  const ready = status?.phase === "complete" && !busy;
  const modifier = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent || "") ? "⌘" : "Ctrl+";
  const iconButton = (label: string, icon: string, action: () => void, disabled = false, title = label, pressed?: boolean, badge?: number) => (
    <span title={title} style={{ display: "inline-flex" }}>
      <button type="button" aria-label={label} title={title} disabled={disabled} aria-pressed={pressed} onClick={action}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3, padding: layout.compact ? 5 : 7,
          color: disabled ? muted : foreground, backgroundColor: pressed ? colors.surface2 : "transparent",
          border: `1px solid ${pressed ? colors.border : "transparent"}`, borderRadius: 4, cursor: disabled ? "default" : "pointer" }}>
        <span aria-hidden="true" style={{ display: "flex" }}><Icon name={icon} size={16} color={disabled ? muted : foreground} /></span>
        {!!badge && <span style={{ fontSize: 11 }}>{badge}</span>}
      </button>
    </span>
  );
  const count = (value: number) => value.toLocaleString("en-US");
  const rowCount = totalRows ?? status?.rowCount;
  const rowSummary = filter && totalRows !== null && status?.rowCount !== null && status?.rowCount !== undefined
    ? `${count(totalRows)} of ${count(status.rowCount)} rows`
    : rowCount == null ? `Showing ${count(rows.length)} rows`
    : rows.length < rowCount ? `Showing ${count(offset + rows.length)} of ${count(rowCount)} rows` : `${count(rowCount)} rows`;
  const bytes = preview?.sourceBytes ?? 0;
  const unit = Math.min(4, Math.floor(Math.log10(Math.max(1, bytes)) / 3));
  const size = `${(bytes / 1000 ** unit).toFixed(1)} ${["B", "kB", "MB", "GB", "TB"][unit]}`;
  const state = busy ? "Opening preview…" : status?.phase === "error" ? status.message
    : queryPending || pageBusy ? (filter ? "Filtering…" : sort ? "Sorting…" : "Loading rows…")
    : ready ? "Ready" : preview ? `Preparing${status?.percent == null ? "…" : ` ${Math.round(status.percent)}%`}` : "No source";
  const textButtonStyle = { color: foreground, backgroundColor: colors.surface0, border: `1px solid ${colors.border}`, borderRadius: 4, padding: 4 };
  const sortTitle = sort?.mode === "auto" ? `Auto${sortMode ? ` — ${sortMode === "numeric" ? "Numeric" : "Text"} detected` : " — detection pending"}` : "Sort mode";

  return (
    <div ref={zone} tabIndex={0}
      onPointerDown={(event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const focusable = target.closest("input, textarea, select, button, a, [contenteditable], [tabindex]");
        if (!focusable || focusable === event.currentTarget) event.currentTarget.focus({ preventScroll: true });
      }}
      onKeyDown={(event) => {
        const target = event.target;
        if (event.defaultPrevented || event.nativeEvent?.isComposing || !(target instanceof HTMLElement)) return;
        if (target.isContentEditable || target.closest("input, textarea, select, [role=textbox]")) return;
        if (event.key === "Escape" && filterOpen) { event.preventDefault(); event.stopPropagation(); closeFilter(); return; }
        if (event.repeat || event.altKey || event.shiftKey || (modifier === "⌘" ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey)) return;
        if (event.key.toLowerCase() === "f") { event.preventDefault(); event.stopPropagation(); openFilter(); }
      }}
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0,
      position: "relative", overflow: "hidden", color: foreground, backgroundColor: colors.surface0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderBottom: `1px solid ${colors.border}` }}>
        <span title={preview?.fileName} style={{ maxWidth: "35%", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{preview?.fileName ?? ""}</span>
        <span aria-hidden="true" style={{ color: muted }}>|</span>
        <input value={path} onChange={(event) => setPath(event.currentTarget.value)} placeholder="Type a path or drop a file"
          aria-label="Workspace file path" aria-describedby={message ? pathErrorId : undefined}
          onBlur={() => setPath(displayPath(selectedSource.current?.path ?? ""))}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); void open({ kind: /^(?:[a-z]:[\\/]|[\\/])/i.test(path) ? "local" : "workspace", path }); }
            if (event.key === "Escape") { event.preventDefault(); setPath(displayPath(selectedSource.current?.path ?? "")); }
          }} style={{ minWidth: 0, flex: 1, padding: 4, color: foreground, backgroundColor: colors.surface0, border: `1px solid ${colors.border}`, borderRadius: 4 }} />
      </div>
      {!!message && <div id={pathErrorId} role="alert" style={{ padding: "4px 8px", color: colors.statusDanger }}>{message}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2, padding: "2px 4px", borderBottom: `1px solid ${colors.border}` }}>
        {iconButton("Choose local CSV or TSV", "FolderOpen", () => select(chooseLocalFile(host.id)))}
        {iconButton("First record is header", "Table", () => {
          const next = !hasHeader;
          currentHeader.current = next;
          setHasHeader(next);
          if (selectedSource.current) void open(selectedSource.current, next);
        }, false, "First record is header", hasHeader)}
        {iconButton("Refresh source", "RefreshCw", () => { if (selectedSource.current) void open(selectedSource.current, currentHeader.current, true); }, !preview || busy)}
        {iconButton("Filter", "Filter", openFilter, !ready || !preview?.columns.length, `Filter (${modifier}F)`, filterOpen)}
        {iconButton("Copy selected rows", "Copy", copySelected, !table.selected.length, `Copy selected rows (${modifier}C)`)}
        {iconButton("Reveal hidden columns", "Eye", () => setTable({ ...table, hidden: [] }), !table.hidden.length, "Reveal hidden columns", undefined, table.hidden.length)}
        <span title={sortTitle}>
          <select aria-label="Sort mode" title={sortTitle} value={sort?.mode ?? "auto"} disabled={!sort || !ready || pageBusy}
            onChange={(event) => { if (sort) changeSort({ ...sort, mode: event.currentTarget.value as Sort["mode"] }); }}
            style={{ color: foreground, backgroundColor: colors.surface0, border: `1px solid ${colors.border}`, borderRadius: 4, padding: 4 }}>
            <option value="auto">Auto</option><option value="numeric">Numeric</option><option value="text">Text</option>
          </select>
        </span>
      </div>
      {filterOpen && preview && <FilterBar value={filterDraft} onChange={setFilterDraft} onApply={applyFilter}
        columns={preview.columns} hidden={table.hidden} onClose={closeFilter} focusRequest={filterFocus}
        disabled={!ready} style={textButtonStyle} danger={colors.statusDanger} />}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
        {preview && !(status?.sourceChanged && status.phase !== "complete") && (preview.columns.length === 0 ? <Text style={{ color: muted }}>This file is empty.</Text> : <>
          {filter && ready && !queryPending && totalRows === 0 && <Text style={{ color: muted }}>No matching rows.</Text>}
          {!filter && ready && !queryPending && totalRows === 0 && <Text style={{ color: muted }}>No data rows in this file.</Text>}
          <TableView key={tableKey} columns={preview.columns} rows={rows} sort={sort} sortBusy={pageBusy || !ready}
            presentation={table} onPresentation={setTable} onCopy={(value, label) => void copy(value, label)}
            onSort={(column, direction) => changeSort({ column, direction, mode: sort?.column === column ? sort.mode : "auto" })}
            theme={{ foreground, muted, border: colors.border }} />
        </>)}
        {ready && totalRows !== null && totalRows > 0 && !queryPending && <div style={{ display: "flex", gap: 12, padding: 4 }}>
          <button type="button" style={textButtonStyle} aria-label="Previous rows" disabled={pageBusy || offset === 0}
            onClick={() => void navigate(Math.max(0, offset - (preview?.limit ?? 50)))}>Previous</button>
          <button type="button" style={textButtonStyle} aria-label="Next rows" disabled={pageBusy || offset + rows.length >= totalRows}
            onClick={() => void navigate(offset + (preview?.limit ?? 50))}>Next</button>
        </div>}
      </div>
      <div role="status" aria-label="Source status" aria-live="polite" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12,
        padding: "5px 8px", fontSize: 12, color: muted, borderTop: `1px solid ${colors.border}` }}>
        {preview && <><span>{rowSummary}</span><span>{count(table.selected.length)} selected</span><span>{size}</span></>}
        <span>{state}</span>
        {status?.sourceChanged && <span>Source file changed or is no longer accessible. {ready ? "Showing the completed snapshot; refresh to read the current file." : "Refresh to read the current file."}</span>}
        {queryPending && ready && <button type="button" style={textButtonStyle} aria-label={filter ? "Cancel filter" : "Cancel sort"} onClick={cancelQuery}>Cancel</button>}
        {preview && !ready && !busy && status?.phase !== "error" && <button type="button" style={textButtonStyle} aria-label="Cancel preparation" onClick={() => {
          ++generation.current; ++selection.current; ++pageRequest.current; ++queryRequest.current;
          setPageBusy(false); setQueryPending(false);
          if (session.current) void closeRpc({ sessionId: session.current });
          session.current = null; selectedSource.current = null; setPath("");
          setPreview(null); setStatus(null); setRows([]); setMessage("Preparation cancelled");
        }}>Cancel</button>}
      </div>
      {toast && <div role="status" aria-label="Toast" style={{ position: "absolute", bottom: 38, right: 12, maxWidth: "85%", padding: "8px 12px",
        border: `1px solid ${colors.border}`, borderRadius: 6, color: foreground, backgroundColor: colors.surface2, pointerEvents: "none" }}>{toast.message}</div>}
      {dragging && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        border: `2px dashed ${colors.accent}`, backgroundColor: colors.surface1, opacity: 0.9, pointerEvents: "none" }}>Drop to open</div>}
    </div>
  );
}
