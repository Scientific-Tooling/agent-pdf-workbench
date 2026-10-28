export interface Bibliography {
  authors?: string[];
  year?: number | string | null;
  venue?: string;
}

/** Show only recorded bibliography; local PDFs need not have these fields. */
export function paperByline(record?: Bibliography | null, compact = false): string {
  if (!record) return "";
  const authors = record.authors?.filter((author) => author.trim()) ?? [];
  const authorLine = authors.length > 2 ? `${authors[0]} et al.` : authors.join(" & ");
  return [authorLine, compact ? null : record.venue, record.year].filter(Boolean).join(" · ");
}
