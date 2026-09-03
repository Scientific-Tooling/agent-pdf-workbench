interface ShortcutHelpProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: "j", action: "Next page" },
  { keys: "k", action: "Previous page" },
  { keys: "f  /  /", action: "Find in document" },
  { keys: "Ctrl/Cmd + F", action: "Find in document" },
  { keys: "Enter", action: "Next match (Shift+Enter for previous)" },
  { keys: "Esc", action: "Clear the search, or dismiss the annotator" },
  { keys: "?", action: "This list" },
];

/** The shortcuts existed; nothing in the UI ever said so. */
export function ShortcutHelp({ open, onClose }: ShortcutHelpProps) {
  if (!open) {
    return null;
  }
  return (
    <div className="shortcut-scrim" role="presentation" onClick={onClose}>
      <div
        id="shortcutHelp"
        className="shortcut-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shortcut-head">
          <h2>Keyboard shortcuts</h2>
          <button
            id="shortcutHelpClose"
            className="ghost-btn icon-btn"
            aria-label="Close shortcuts"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <dl className="shortcut-list">
          {SHORTCUTS.map((shortcut) => (
            <div key={`${shortcut.keys}:${shortcut.action}`} className="shortcut-row">
              <dt>
                <kbd>{shortcut.keys}</kbd>
              </dt>
              <dd>{shortcut.action}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
