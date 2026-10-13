import { useEffect, useRef, useState, type ReactNode } from "react";

export function IconButton(props: {
  title: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  label?: string;
  testId?: string;
}) {
  return (
    <button
      className={"icon-btn" + (props.active ? " active" : "") + (props.label ? " with-label" : "")}
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      data-testid={props.testId}
    >
      {props.children}
      {props.label && <span>{props.label}</span>}
    </button>
  );
}

export interface MenuItem {
  label?: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  separator?: boolean;
  checked?: boolean;
  icon?: ReactNode;
  testId?: string;
}

export function Menu(props: { label: ReactNode; title?: string; items: MenuItem[]; testId?: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={"menu-btn" + (open ? " active" : "")} title={props.title} onClick={() => setOpen(!open)} data-testid={props.testId}>
        {props.label}
      </button>
      {open && (
        <div className={"menu-pop " + (props.align === "right" ? "right" : "")} role="menu">
          {props.items.map((it, i) =>
            it.separator ? (
              <div key={i} className="menu-sep" />
            ) : (
              <button
                key={i}
                role="menuitem"
                className="menu-item"
                disabled={it.disabled}
                onClick={() => { setOpen(false); it.onClick?.(); }}
                data-testid={it.testId}
              >
                <span className="check">{it.checked ? "✓" : ""}</span>
                {it.icon}
                <span className="grow">{it.label}</span>
                {it.shortcut && <span className="kbd">{it.shortcut}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [props]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="modal" style={{ width: props.width ?? 440 }} role="dialog" aria-label={props.title}>
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}

export function ContextMenu(props: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  useEffect(() => {
    const close = () => props.onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("blur", close); window.removeEventListener("keydown", close); };
  }, [props]);
  return (
    <div className="menu-pop context" style={{ left: props.x, top: props.y }} onMouseDown={(e) => e.stopPropagation()}>
      {props.items.map((it, i) =>
        it.separator ? <div key={i} className="menu-sep" /> : (
          <button key={i} className="menu-item" disabled={it.disabled} onClick={() => { props.onClose(); it.onClick?.(); }}>
            <span className="grow">{it.label}</span>
          </button>
        ),
      )}
    </div>
  );
}
