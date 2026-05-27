import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useWindowStore, type WindowState } from "../store/windowStore";

interface WindowProps {
  win: WindowState;
  children: ReactNode;
}

export function Window({ win, children }: WindowProps) {
  const { focus, move, close, minimize, toggleMaximize, resize } =
    useWindowStore();
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    origW: number;
    origH: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onTitlePointerDown = (e: ReactPointerEvent) => {
    if (win.maximized) return;
    focus(win.id);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: win.x,
      origY: win.y,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onTitlePointerMove = (e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const nx = Math.max(0, dragRef.current.origX + dx);
    const ny = Math.max(0, dragRef.current.origY + dy);
    move(win.id, nx, ny);
  };

  const onTitlePointerUp = (e: ReactPointerEvent) => {
    dragRef.current = null;
    setDragging(false);
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onResizePointerDown = (e: ReactPointerEvent) => {
    e.stopPropagation();
    if (win.maximized) return;
    focus(win.id);
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origW: win.w,
      origH: win.h,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onResizePointerMove = (e: ReactPointerEvent) => {
    if (!resizeRef.current) return;
    const dx = e.clientX - resizeRef.current.startX;
    const dy = e.clientY - resizeRef.current.startY;
    resize(
      win.id,
      Math.max(340, resizeRef.current.origW + dx),
      Math.max(220, resizeRef.current.origH + dy)
    );
  };
  const onResizePointerUp = (e: ReactPointerEvent) => {
    resizeRef.current = null;
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  if (win.minimized) return null;

  return (
    <div
      onMouseDown={() => focus(win.id)}
      className="absolute glass rounded-lg flex flex-col overflow-hidden"
      style={{
        left: win.x,
        top: win.y,
        width: win.w,
        height: win.h,
        zIndex: win.z,
        transition: dragging ? "none" : "box-shadow 200ms",
      }}
    >
      {/* title bar */}
      <div
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={onTitlePointerUp}
        onDoubleClick={() =>
          toggleMaximize(win.id, window.innerWidth, window.innerHeight)
        }
        className="h-9 flex items-center justify-between px-3 select-none cursor-grab active:cursor-grabbing"
        style={{
          background:
            "linear-gradient(180deg, rgba(122,18,24,0.5), rgba(36,16,19,0.7))",
          borderBottom: "1px solid rgba(255,138,42,0.25)",
        }}
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-dsos-flame shadow-ember" />
          <span className="script text-dsos-glow text-lg leading-none">
            {win.title}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            aria-label="minimize"
            onClick={(e) => {
              e.stopPropagation();
              minimize(win.id);
            }}
            className="w-5 h-5 rounded-sm hover:bg-dsos-flame/30 grid place-items-center text-dsos-ghost"
            title="minimize"
          >
            <span className="text-xs">—</span>
          </button>
          <button
            aria-label="maximize"
            onClick={(e) => {
              e.stopPropagation();
              toggleMaximize(win.id, window.innerWidth, window.innerHeight);
            }}
            className="w-5 h-5 rounded-sm hover:bg-dsos-flame/30 grid place-items-center text-dsos-ghost"
            title={win.maximized ? "restore" : "maximize"}
          >
            <span className="text-xs">{win.maximized ? "◱" : "□"}</span>
          </button>
          <button
            aria-label="close"
            onClick={(e) => {
              e.stopPropagation();
              close(win.id);
            }}
            className="w-5 h-5 rounded-sm hover:bg-dsos-blood grid place-items-center text-dsos-ghost"
            title="close"
          >
            <span className="text-xs">✕</span>
          </button>
        </div>
      </div>

      {/* body */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {children}
      </div>

      {/* resize handle */}
      {!win.maximized && (
        <div
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          style={{
            background:
              "linear-gradient(135deg, transparent 50%, rgba(255,138,42,0.55) 50%)",
          }}
          aria-hidden
        />
      )}
    </div>
  );
}
