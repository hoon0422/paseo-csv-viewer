import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

type Theme = { foreground: string; muted: string; border: string };

export function ColumnHeader({ name, width, theme, direction, rows, column, onWidth, menuId, onMenu }: {
  name: string; width: number; theme: Theme; direction?: "asc" | "desc"; rows: string[][]; column: number; onWidth: (width: number) => void;
  menuId?: string; onMenu: (anchor: HTMLButtonElement) => void;
}) {
  const label = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ x: number; width: number; pointerId: number; target: HTMLDivElement } | null>(null);
  const release = () => {
    const start = drag.current;
    drag.current = null;
    if (start?.target.hasPointerCapture(start.pointerId)) start.target.releasePointerCapture(start.pointerId);
  };
  useEffect(() => release, []);
  const fit = () => {
    const node = label.current;
    if (!node) return;
    const context = node.ownerDocument.createElement("canvas").getContext("2d");
    const font = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (!context || !font) return;
    context.font = `700 ${font.fontSize} ${font.fontFamily}`;
    let widest = context.measureText(name.replace(/[\r\n\t]/g, " ")).width + 48;
    context.font = `400 ${font.fontSize} ${font.fontFamily}`;
    for (const row of rows) {
      for (const line of (row[column] ?? "").split(/\r\n|\r|\n/)) {
        widest = Math.max(widest, context.measureText(line.replace(/\t/g, "        ")).width + 12);
      }
      if (widest >= 600) break;
    }
    onWidth(Math.max(40, Math.min(600, Math.ceil(widest))));
  };
  return <div style={{ display: "flex", alignItems: "center", position: "relative", width, flexShrink: 0,
    padding: "6px 8px 6px 6px", boxSizing: "border-box", color: theme.foreground, fontSize: 14, fontFamily: "system-ui, sans-serif" }}>
    <span ref={label} role="columnheader" aria-label={name} title={name}
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
      style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 700 }}>{name}</span>
    {direction && <span aria-hidden="true">{direction === "asc" ? "↑" : "↓"}</span>}
    <button type="button" aria-label={`Column menu ${name}`} title={`Column options for ${name}`}
      aria-haspopup="menu" aria-expanded={!!menuId} aria-controls={menuId}
      onClick={(event) => { event.stopPropagation(); onMenu(event.currentTarget); }}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault(); event.stopPropagation(); onMenu(event.currentTarget);
      }}
      style={{ flexShrink: 0, width: 24, padding: 0, border: 0, fontSize: 18, color: theme.foreground, background: "transparent", cursor: "pointer" }}>⋮</button>
    <div role="separator" aria-label={`Resize ${name}`} aria-orientation="vertical" aria-valuemin={40} aria-valuenow={width}
      tabIndex={0} title="Drag to resize; double-click to fit; arrow keys to resize"
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width, pointerId: event.pointerId, target: event.currentTarget };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start && start.pointerId === event.pointerId) onWidth(Math.max(40, start.width + event.clientX - start.x));
      }}
      onPointerUp={(event) => { if (drag.current?.pointerId === event.pointerId) release(); }}
      onPointerCancel={(event) => { if (drag.current?.pointerId === event.pointerId) release(); }}
      onLostPointerCapture={(event) => { if (drag.current?.pointerId === event.pointerId) release(); }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => { event.stopPropagation(); fit(); }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault(); event.stopPropagation(); fit(); return;
        }
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault(); event.stopPropagation();
        onWidth(Math.max(40, width + (event.key === "ArrowLeft" ? -10 : 10)));
      }}
      style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 6, cursor: "col-resize",
        touchAction: "none", userSelect: "none", borderRight: `1px solid ${theme.border}` }} />
  </div>;
}

export function ColumnMenu({ anchor, container, name, column, theme, direction, hasSort, sortBusy, onSort, onHide, onClose, id }: {
  anchor: HTMLButtonElement; container: RefObject<HTMLDivElement | null>; name: string; column: number; theme: Theme;
  direction?: "asc" | "desc"; hasSort: boolean; sortBusy?: boolean; id: string;
  onSort?: (column: number, direction: "asc" | "desc" | null) => void;
  onHide: () => void; onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 220, maxHeight: undefined as number | undefined });
  const close = (focus = false) => {
    const fallback = anchor.closest<HTMLElement>('[aria-label="CSV viewer"]') ?? container.current;
    onClose();
    if (focus) queueMicrotask(() => {
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
      else if (fallback?.isConnected) fallback.focus({ preventScroll: true });
    });
  };
  const latestClose = useRef(close);
  latestClose.current = close;
  useLayoutEffect(() => {
    const root = container.current;
    const popup = menu.current;
    if (!root || !popup) return;
    const bounds = root.getBoundingClientRect();
    const target = anchor.getBoundingClientRect();
    const height = popup.getBoundingClientRect().height;
    const width = Math.min(220, bounds.width);
    const top = Math.max(0, Math.min(target.bottom - bounds.top, bounds.height - height));
    setPosition({ left: Math.max(0, Math.min(target.right - bounds.left - width, bounds.width - width)),
      top, width, maxHeight: bounds.height - top });
    popup.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => {
      if (!popup.contains(event.target as Node) && !anchor.contains(event.target as Node)) latestClose.current();
    };
    const dismiss = () => latestClose.current();
    const scroll = (event: Event) => { if (!popup.contains(event.target as Node)) dismiss(); };
    root.ownerDocument.addEventListener("pointerdown", outside, true);
    root.addEventListener("scroll", scroll, true);
    root.ownerDocument.defaultView?.addEventListener("resize", dismiss);
    return () => {
      root.ownerDocument.removeEventListener("pointerdown", outside, true);
      root.removeEventListener("scroll", scroll, true);
      root.ownerDocument.defaultView?.removeEventListener("resize", dismiss);
    };
  }, [anchor, container]);
  const item = (label: string, caption: string, action: () => void, checked?: boolean, disabled = false) => <button type="button"
    role={checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={checked} aria-label={label} disabled={disabled} tabIndex={-1}
    onClick={(event) => { event.stopPropagation(); close(true); action(); }}
    style={{ display: "flex", gap: 6, width: "100%", padding: "6px 8px", border: 0, background: "transparent", textAlign: "left",
      color: disabled ? theme.muted : theme.foreground, cursor: disabled ? "default" : "pointer" }}>
    <span aria-hidden="true" style={{ width: 12 }}>{checked ? "✓" : ""}</span>{caption}
  </button>;
  return <div ref={menu} id={id} role="menu" aria-label={`Column options for ${name}`}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const current = buttons.indexOf(event.currentTarget.ownerDocument.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}
    style={{ position: "absolute", ...position, overflowY: "auto", zIndex: 10, padding: "4px 0", boxSizing: "border-box",
      background: theme.border, color: theme.foreground, border: `1px solid ${theme.muted}`, borderRadius: 4, boxShadow: "0 4px 12px #0004" }}>
    {item(`Sort column ${column + 1} ${name} ascending`, "Sort ascending", () => onSort?.(column, "asc"), direction === "asc", sortBusy || !onSort)}
    {item(`Sort column ${column + 1} ${name} descending`, "Sort descending", () => onSort?.(column, "desc"), direction === "desc", sortBusy || !onSort)}
    {item("Clear sort", "Clear sort", () => onSort?.(column, null), !hasSort, sortBusy || !onSort)}
    <div role="separator" style={{ borderTop: `1px solid ${theme.muted}`, margin: "4px 0" }} />
    {item(`Hide ${name}`, "Hide column", onHide)}
  </div>;
}
