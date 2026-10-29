import type { TextAnchor } from "../types/types";

type Position = { start: number; end: number };
type MappedText = { text: string; positions: Position[]; boundaries: Set<number> };
const ligatures: Record<string, string> = {
  "\uFB00": "ff",
  "\uFB01": "fi",
  "\uFB02": "fl",
  "\uFB03": "ffi",
  "\uFB04": "ffl",
  "\uFB05": "st",
  "\uFB06": "st",
};
const mathDelimiter = /[()[\]{}=+×÷≈<>≤≥±]/;

function expandLigatures(text: string): string {
  // Do not use NFKC here: it also rewrites superscripts, units and numbers.
  return text.replace(/[\uFB00-\uFB06]/g, (char) => ligatures[char]);
}

function mappedText(raw: string, optional: ReadonlySet<number>): MappedText {
  let text = "";
  const positions: Position[] = [];
  const boundaries = new Set<number>();
  for (let index = 0; index < raw.length;) {
    const start = index;
    if (/\s/.test(raw[index])) {
      while (index < raw.length && /\s/.test(raw[index])) index += 1;
      // Formula spacing is typographical; preserve every operator and operand.
      const mathSpace =
        mathDelimiter.test(raw[start - 1] ?? "") || mathDelimiter.test(raw[index] ?? "");
      let synthetic = true;
      for (let i = start; i < index; i += 1) synthetic &&= optional.has(i);
      if (synthetic || mathSpace) {
        boundaries.add(text.length);
      } else {
        text += " ";
        positions.push({ start, end: index });
      }
    } else {
      const expanded = expandLigatures(raw[index]);
      text += expanded;
      for (let i = 0; i < expanded.length; i += 1) positions.push({ start, end: index + 1 });
      index += 1;
    }
  }
  return { text, positions, boundaries };
}

function matchAt(page: MappedText, quote: string, start: number): number | null {
  let cursor = start;
  for (const char of quote) {
    if (char === " " && page.text[cursor] !== " " && page.boundaries.has(cursor)) continue;
    if (!page.text.startsWith(char, cursor)) return null;
    cursor += char.length;
  }
  return cursor;
}

function hits(page: MappedText, quote: string): Array<{ start: number; end: number }> {
  const matches = [];
  let cursor = page.text.indexOf(quote[0]);
  while (cursor !== -1) {
    const end = matchAt(page, quote, cursor);
    if (end !== null) matches.push({ start: cursor, end });
    cursor = page.text.indexOf(quote[0], cursor + 1);
  }
  return matches;
}

export function resolveAnchorOffsets(
  anchor: TextAnchor,
  pageText: string,
  optionalWhitespace: ReadonlySet<number> = new Set(),
): Position | null {
  const normalize = (value: string) => expandLigatures(value).replace(/\s+/g, " ").trim();
  const quote = normalize(anchor.quote);
  if (!quote) return null;
  const page = mappedText(pageText, optionalWhitespace);
  const candidates = hits(page, quote);
  const prefix = normalize(anchor.prefix ?? "");
  const suffix = normalize(anchor.suffix ?? "");
  const prefixHits = prefix ? hits(page, prefix) : [];
  const matches = candidates
    .filter(({ start, end }) => {
      const before = page.text.slice(0, start).trimEnd().length;
      let after = end;
      while (page.text[after] === " ") after += 1;
      return (
        (!prefix || prefixHits.some((hit) => hit.end === before)) &&
        (!suffix || matchAt(page, suffix, after) !== null)
      );
    })
    .map(({ start, end }) => ({
      start: page.positions[start].start,
      end: page.positions[end - 1].end,
    }));
  // A valid stored range disambiguates identical passages. Never trust offsets
  // independently of their quote, and never pick the first of multiple matches.
  const stored = matches.find((match) => match.start === anchor.start && match.end === anchor.end);
  if (stored) return stored;
  return matches.length === 1 ? matches[0] : null;
}
