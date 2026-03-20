import type { ReadingProgress, RecentPaper } from "../types/types";

const PROGRESS_KEY = "apw:reading-progress:v1";
const RECENT_KEY = "apw:recent-papers:v1";
const MAX_RECENT = 12;

function readJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getProgressMap(): Record<string, ReadingProgress> {
  return readJson<Record<string, ReadingProgress>>(PROGRESS_KEY, {});
}

export function getProgress(paperRef: string): ReadingProgress | null {
  return getProgressMap()[paperRef] ?? null;
}

export function upsertProgress(progress: ReadingProgress): void {
  const map = getProgressMap();
  map[progress.paperRef] = progress;
  writeJson(PROGRESS_KEY, map);
}

export function getRecentPapers(): RecentPaper[] {
  return readJson<RecentPaper[]>(RECENT_KEY, []);
}

export function upsertRecentPaper(entry: RecentPaper): void {
  const existing = getRecentPapers().filter((paper) => paper.paperRef !== entry.paperRef);
  const next = [entry, ...existing]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, MAX_RECENT);
  writeJson(RECENT_KEY, next);
}
