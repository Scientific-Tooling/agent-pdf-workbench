const EDGE_PADDING_PX = 24;
/** Where a scrolled-to target lands vertically: a third down reads better than the top edge. */
const TARGET_OFFSET_RATIO = 1 / 3;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Bring a mark inside the PDF stage into view, if it is not already.
 *
 * Jumping to a search hit or an annotation renders the right page but says
 * nothing about where on that page the target sits; at anything above fit-width
 * zoom it is often below the fold. Scrolling only when the target is actually
 * out of view keeps clicking a visible mark from yanking the page around.
 */
export function scrollIntoStageView(stage: HTMLElement, target: HTMLElement): void {
  const stageRect = stage.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  const above = targetRect.top < stageRect.top + EDGE_PADDING_PX;
  const below = targetRect.bottom > stageRect.bottom - EDGE_PADDING_PX;
  const leftOf = targetRect.left < stageRect.left + EDGE_PADDING_PX;
  const rightOf = targetRect.right > stageRect.right - EDGE_PADDING_PX;
  if (!above && !below && !leftOf && !rightOf) {
    return;
  }

  const scrollOptions: ScrollToOptions = {
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  };
  if (above || below) {
    const offset = targetRect.top - stageRect.top - stage.clientHeight * TARGET_OFFSET_RATIO;
    scrollOptions.top = Math.max(0, stage.scrollTop + offset);
  }
  if (leftOf || rightOf) {
    const offset = targetRect.left - stageRect.left - stage.clientWidth / 2 + targetRect.width / 2;
    scrollOptions.left = Math.max(0, stage.scrollLeft + offset);
  }
  stage.scrollTo(scrollOptions);
}
