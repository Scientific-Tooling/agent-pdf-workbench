import { useEffect, useRef } from "react";

import type { PageViewport, TextContent } from "../types/pdfjs-types";

const PAGE_CACHE_LIMIT = 8;

export type PageCacheEntry = {
  bitmap: ImageBitmap;
  textContent: TextContent;
  viewport: PageViewport;
  zoom: number;
  lastUsedAt: number;
};

export function usePageCache() {
  const pageTextCacheRef = useRef<Map<number, string>>(new Map());
  const pageCacheRef = useRef<Map<number, PageCacheEntry>>(new Map());

  function disposeBitmap(bitmap: ImageBitmap): void {
    try {
      bitmap.close();
    } catch {
      // Ignore close errors for runtime compatibility.
    }
  }

  function clearPageCache(): void {
    for (const entry of pageCacheRef.current.values()) {
      disposeBitmap(entry.bitmap);
    }
    pageCacheRef.current.clear();
  }

  function setPageCacheEntry(
    pageNumber: number,
    entry: {
      bitmap: ImageBitmap;
      textContent: TextContent;
      viewport: PageViewport;
      zoom: number;
    },
  ): void {
    const cache = pageCacheRef.current;
    const existing = cache.get(pageNumber);
    if (existing) {
      disposeBitmap(existing.bitmap);
    }

    cache.set(pageNumber, {
      ...entry,
      lastUsedAt: Date.now(),
    });

    while (cache.size > PAGE_CACHE_LIMIT) {
      let oldestKey: number | null = null;
      let oldestUsedAt = Number.POSITIVE_INFINITY;

      for (const [key, value] of cache.entries()) {
        if (value.lastUsedAt < oldestUsedAt) {
          oldestUsedAt = value.lastUsedAt;
          oldestKey = key;
        }
      }

      if (oldestKey === null) {
        break;
      }

      const evicted = cache.get(oldestKey);
      if (evicted) {
        disposeBitmap(evicted.bitmap);
      }
      cache.delete(oldestKey);
    }
  }

  useEffect(() => {
    const bitmaps = pageCacheRef.current;
    const texts = pageTextCacheRef.current;
    return () => {
      for (const entry of bitmaps.values()) {
        disposeBitmap(entry.bitmap);
      }
      bitmaps.clear();
      texts.clear();
    };
  }, []);

  return {
    pageTextCacheRef,
    pageCacheRef,
    disposeBitmap,
    clearPageCache,
    setPageCacheEntry,
  };
}
