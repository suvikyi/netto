/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export const PANE_GAP = 1;
export const MIN_PANE_WIDTH_PX = 240;
export const MIN_PANE_RATIO = 0.2;

export function getPaneRatioBounds(
  viewportWidth,
  gap = PANE_GAP,
  minWidth = MIN_PANE_WIDTH_PX,
  minRatio = MIN_PANE_RATIO
) {
  const available = Math.max(1, viewportWidth - gap);
  return {
    min: Math.min(1, Math.max(minRatio, minWidth / available)),
    max: 1,
  };
}

export function getPaneMetrics({
  tabCount,
  selectedIndex,
  viewportWidth,
  getRatio,
  selectedRatio = null,
  gap = PANE_GAP,
  minWidth = MIN_PANE_WIDTH_PX,
}) {
  if (tabCount <= 1) {
    return {
      focusedWidth: viewportWidth,
      widths: [viewportWidth],
      offsets: [0],
      total: viewportWidth,
    };
  }

  const available = Math.max(1, viewportWidth - gap);
  const widths = Array.from({ length: tabCount }, (_, index) => {
    const ratio =
      index == selectedIndex && selectedRatio != null
        ? selectedRatio
        : getRatio(index);
    return Math.max(minWidth, available * ratio);
  });
  const offsets = [];
  let offset = 0;
  for (const width of widths) {
    offsets.push(offset);
    offset += width + gap;
  }

  return {
    focusedWidth: widths[selectedIndex] ?? viewportWidth,
    widths,
    offsets,
    total: Math.max(viewportWidth, offset - gap),
  };
}

export function getVisiblePaneIndices({
  metrics,
  viewportWidth,
  cameraOffset,
  cameraEndOffset = cameraOffset,
}) {
  const maxOffset = getCameraMaxOffset(metrics, viewportWidth);
  const start = Math.min(maxOffset, Math.max(0, cameraOffset));
  const end = Math.min(maxOffset, Math.max(0, cameraEndOffset)) + viewportWidth;
  const rangeStart = Math.min(start, end - viewportWidth);
  const rangeEnd = Math.max(start + viewportWidth, end);
  return metrics.offsets.reduce((visible, paneStart, index) => {
    const paneEnd = paneStart + metrics.widths[index];
    if (paneEnd > rangeStart && paneStart < rangeEnd) {
      visible.push(index);
    }
    return visible;
  }, []);
}

export function getCameraTargetOffset({
  metrics,
  viewportWidth,
  targetIndex,
  currentOffset,
  pendingOffset = null,
}) {
  const maxOffset = getCameraMaxOffset(metrics, viewportWidth);
  if (pendingOffset != null) {
    return Math.min(maxOffset, Math.max(0, pendingOffset));
  }

  const targetStart = metrics.offsets[targetIndex];
  const targetEnd = targetStart + metrics.widths[targetIndex];
  const currentEnd = currentOffset + viewportWidth;
  if (targetStart < currentOffset) {
    return Math.min(maxOffset, Math.max(0, targetStart));
  }
  if (targetEnd > currentEnd) {
    return Math.min(maxOffset, Math.max(0, targetEnd - viewportWidth));
  }
  return Math.min(maxOffset, Math.max(0, currentOffset));
}

export function getCameraMaxOffset(metrics, viewportWidth) {
  return Math.max(0, metrics.total - viewportWidth);
}

export function getCameraTransform(offset, isRTL) {
  const translation = isRTL ? offset : -offset;
  return `translateX(${translation}px)`;
}

export function toVisualStep(delta, isRTL) {
  return delta * (isRTL ? -1 : 1);
}

export function getVisualPlacement(
  metrics,
  index,
  cameraOffset,
  viewportWidth,
  isRTL
) {
  const width = metrics.widths[index];
  const visualX = isRTL
    ? metrics.total - metrics.offsets[index] - width
    : metrics.offsets[index];
  const x = visualX + (isRTL ? cameraOffset : -cameraOffset);
  return {
    x,
    inlineOffset: isRTL ? viewportWidth - x - width : x,
    width,
  };
}
