import { useRef } from "react";
import { ReaderIcon } from "./ReaderIcon";

export function AppHeader({
  themeLabel,
  onCycleTheme,
  onShowShortcuts,
}: {
  themeLabel: string;
  onCycleTheme: () => void;
  onShowShortcuts: () => void;
}) {
  const settings = useRef<HTMLDetailsElement>(null);
  return (
    <header className="app-header">
      <span className="app-logo">
        <ReaderIcon name="book" />
      </span>
      <h1>Paper workspace</h1>
      <span className="brand-label">Scientific Tooling</span>
      <details
        className="reader-settings"
        ref={settings}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.currentTarget.open = false;
            event.currentTarget.querySelector("summary")?.focus();
          }
        }}
      >
        <summary aria-label="Reader settings" title="Reader settings">
          <ReaderIcon name="settings" />
        </summary>
        <div className="reader-settings-popover">
          <button
            id="themeBtn"
            className="ghost-btn"
            aria-label={themeLabel}
            onClick={onCycleTheme}
          >
            {themeLabel}
          </button>
          <button
            id="shortcutsBtn"
            className="ghost-btn"
            onClick={() => {
              if (settings.current) settings.current.open = false;
              onShowShortcuts();
            }}
          >
            Keyboard shortcuts <kbd>?</kbd>
          </button>
        </div>
      </details>
    </header>
  );
}
