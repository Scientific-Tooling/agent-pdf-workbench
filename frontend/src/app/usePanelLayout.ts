import { useEffect, useState } from "react";

import { getPanelLayout, savePanelLayout } from "../services/storage";

/**
 * Width tiers. The document is the point of the app, so panels give way to it
 * rather than the other way round: below `medium` the control panel folds, and
 * below `narrow` both panels become drawers over the reading surface.
 */
export type PanelTier = "wide" | "medium" | "narrow";

const MEDIUM_MIN_WIDTH = 1100;
const WIDE_MIN_WIDTH = 1400;

interface PanelState {
  controlsOpen: boolean;
  workspaceOpen: boolean;
}

const TIER_DEFAULTS: Record<PanelTier, PanelState> = {
  wide: { controlsOpen: true, workspaceOpen: true },
  // At 1280px both panels still leave the document ~700px — enough for a
  // fit-width page — so folding one by default would surprise the reader for
  // nothing. The medium tier narrows the panels instead (see styles.css).
  medium: { controlsOpen: true, workspaceOpen: true },
  narrow: { controlsOpen: false, workspaceOpen: false },
};

export function tierForWidth(width: number): PanelTier {
  if (width >= WIDE_MIN_WIDTH) {
    return "wide";
  }
  return width >= MEDIUM_MIN_WIDTH ? "medium" : "narrow";
}

function initialState(tier: PanelTier): PanelState {
  const stored = getPanelLayout();
  // A choice made at another width says nothing about this one.
  if (stored && stored.tier === tier) {
    return { controlsOpen: stored.controlsOpen, workspaceOpen: stored.workspaceOpen };
  }
  return TIER_DEFAULTS[tier];
}

interface PanelLayoutParams {
  /** With nothing to read, the document has no claim on the space. */
  hasDocument: boolean;
}

export function usePanelLayout({ hasDocument }: PanelLayoutParams) {
  const [tier, setTier] = useState<PanelTier>(() => tierForWidth(window.innerWidth));
  const [panels, setPanels] = useState<PanelState>(() =>
    initialState(tierForWidth(window.innerWidth)),
  );

  useEffect(() => {
    let frame = 0;
    function onResize(): void {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const nextTier = tierForWidth(window.innerWidth);
        setTier((currentTier) => {
          if (currentTier === nextTier) {
            return currentTier;
          }
          // Crossing a breakpoint re-applies that tier's defaults, so a layout
          // chosen on a wide screen cannot squeeze the document on a narrow one.
          setPanels(TIER_DEFAULTS[nextTier]);
          return nextTier;
        });
      });
    }
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  function update(next: PanelState): void {
    setPanels(next);
    savePanelLayout({ tier, ...next });
  }

  // The session form is the only way in, so it stays out until there is a
  // document worth folding it away for.
  const controlsOpen = hasDocument ? panels.controlsOpen : true;

  return {
    tier,
    controlsOpen,
    workspaceOpen: panels.workspaceOpen,
    toggleControls: () => update({ ...panels, controlsOpen: !panels.controlsOpen }),
    toggleWorkspace: () => update({ ...panels, workspaceOpen: !panels.workspaceOpen }),
    closePanelsOverDocument: () => {
      // Tapping the backdrop in drawer mode dismisses whatever is open.
      if (tier === "narrow") {
        update({ controlsOpen: false, workspaceOpen: false });
      }
    },
  };
}
