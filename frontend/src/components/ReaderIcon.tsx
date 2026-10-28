/** A small, consistent set of stroke icons for the reader chrome. */
export function ReaderIcon({
  name,
}: {
  name: "book" | "papers" | "workspace" | "focus" | "search" | "settings" | "close" | "quote";
}) {
  const paths = {
    book: "M12 5v15M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z",
    papers: "M4 3h16v18H4zM9 3v18",
    workspace: "M4 3h16v18H4zM15 3v18",
    focus: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
    search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    settings: "M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6",
    close: "m6 6 12 12M6 18 18 6",
    quote: "M4 5h16M10 10h10M10 15h7M4 10v8",
  };
  return (
    <svg
      className="reader-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
