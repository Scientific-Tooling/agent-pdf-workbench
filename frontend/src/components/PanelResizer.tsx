import { useRef } from "react";
import { clamp } from "../utils/main-utils";

export function PanelResizer({
  side,
  value,
  onResize,
}: {
  side: "left" | "right";
  value: number;
  onResize: (value: number) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const minimum = side === "left" ? 190 : 280;
  const maximum = side === "left" ? 310 : 420;
  const direction = side === "left" ? 1 : -1;
  return (
    <div
      className={`panel-resizer ${side}`}
      role="separator"
      tabIndex={0}
      aria-label={side === "left" ? "Resize paper navigation" : "Resize reading workspace"}
      aria-orientation="vertical"
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={value}
      onPointerDown={(event) => {
        const parent = event.currentTarget.parentElement;
        const panel = parent?.querySelector(side === "left" ? ".controls" : ".workspace");
        drag.current = { x: event.clientX, width: panel?.getBoundingClientRect().width ?? value };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (drag.current)
          onResize(
            clamp(
              drag.current.width + direction * (event.clientX - drag.current.x),
              minimum,
              maximum,
            ),
          );
      }}
      onPointerUp={(event) => {
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const next =
          event.key === "ArrowRight"
            ? value + direction * 16
            : event.key === "ArrowLeft"
              ? value - direction * 16
              : event.key === "Home"
                ? minimum
                : event.key === "End"
                  ? maximum
                  : null;
        if (next !== null) {
          event.preventDefault();
          onResize(clamp(next, minimum, maximum));
        }
      }}
    />
  );
}
