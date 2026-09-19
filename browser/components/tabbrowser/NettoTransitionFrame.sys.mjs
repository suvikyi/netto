/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  getCameraMaxOffset,
  getPaneMetrics,
  getVisualPlacement,
} from "moz-src:///browser/components/tabbrowser/NettoTabGeometry.sys.mjs";
import {
  nettoDebugLog,
  nettoDebugTab,
} from "moz-src:///browser/components/tabbrowser/NettoDebug.sys.mjs";

export function buildAnalyticFrame({
  tabs,
  liveTabs,
  metrics = null,
  cameraOffset,
  viewport,
  selectedTab,
  isRTL,
  getRatio,
}) {
  if (!viewport.width || !viewport.height) {
    return null;
  }
  const selectedIndex = tabs.indexOf(selectedTab);
  if (selectedIndex < 0) {
    return null;
  }
  metrics ??= getPaneMetrics({
    tabCount: tabs.length,
    selectedIndex,
    viewportWidth: viewport.width,
    getRatio,
  });
  const maxOffset = getCameraMaxOffset(metrics, viewport.width);
  cameraOffset = Math.min(maxOffset, Math.max(0, cameraOffset));
  const placements = [];
  const missingTabs = [];
  const tabSet = new Set(tabs);
  for (let index = 0; index < tabs.length; index++) {
    const tab = tabs[index];
    if (!liveTabs.has(tab)) {
      continue;
    }
    if (!tab.linkedPanel) {
      missingTabs.push({ tab: nettoDebugTab(tab), reason: "no-panel" });
      continue;
    }
    const placement = getVisualPlacement(
      metrics,
      index,
      cameraOffset,
      viewport.width,
      isRTL
    );
    placements.push({
      tab,
      x: placement.x,
      y: 0,
      inlineOffset: placement.inlineOffset,
      width: placement.width,
      height: viewport.height,
    });
  }
  for (const tab of liveTabs) {
    if (!tabSet.has(tab)) {
      missingTabs.push({
        tab: nettoDebugTab(tab),
        reason: "not-visible",
      });
    }
  }
  nettoDebugLog("workspace-frame", {
    viewport: [viewport.left, viewport.top, viewport.width, viewport.height],
    cameraOffset,
    liveTabs: [...liveTabs].map(nettoDebugTab),
    missingTabs,
    placements: placements.map(placement => ({
      tab: nettoDebugTab(placement.tab),
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
    })),
  });
  if (missingTabs.length || !placements.length) {
    return null;
  }
  return {
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    trackWidth: metrics.total,
    selectedTab,
    placements,
  };
}

export function sampleCompositedFrame({
  tabs,
  viewport,
  selectedTab,
  outgoingTrackWidth,
  panelForTab,
  isRTL,
}) {
  const placements = [];
  for (const tab of tabs) {
    const panel = panelForTab(tab);
    if (!panel) {
      return null;
    }
    // Panel bounds include the current compositor translation.
    const bounds = panel.getBoundingClientRect();
    const x = bounds.left - viewport.left;
    placements.push({
      tab,
      x,
      y: bounds.top - viewport.top,
      inlineOffset: isRTL ? viewport.width - (bounds.right - viewport.left) : x,
      width: bounds.width,
      height: bounds.height,
    });
  }
  if (!placements.length || !viewport.width || !viewport.height) {
    return null;
  }
  return {
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    trackWidth: outgoingTrackWidth,
    selectedTab,
    placements,
  };
}

export function unionTransitionTabs(outgoingFrame, incomingFrame) {
  const outgoingByTab = new Map(
    outgoingFrame.placements.map(placement => [placement.tab, placement])
  );
  const incomingByTab = new Map(
    incomingFrame.placements.map(placement => [placement.tab, placement])
  );
  return {
    outgoingByTab,
    incomingByTab,
    tabs: new Set([...outgoingByTab.keys(), ...incomingByTab.keys()]),
  };
}

export function buildTransitionParticipants(union, panelForTab) {
  return [...union.tabs]
    .map(tab => {
      const panel = panelForTab(tab);
      if (!panel) {
        return null;
      }
      return {
        element: panel,
        tab,
        outgoing: union.outgoingByTab.get(tab),
        incoming: union.incomingByTab.get(tab),
      };
    })
    .filter(Boolean);
}

export function transitionDescriptor(tab, outgoing, incoming, selectedTab) {
  const placement = incoming || outgoing;
  if (!placement) {
    return null;
  }
  const isIncoming = !!incoming;
  return {
    focused: isIncoming && tab == selectedTab,
    inactive: !isIncoming || tab != selectedTab,
    offset: placement.inlineOffset,
    width: placement.width,
  };
}
