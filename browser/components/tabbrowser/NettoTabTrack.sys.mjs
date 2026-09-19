/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  getCameraMaxOffset,
  getCameraTargetOffset,
  getPaneMetrics,
  getPaneRatioBounds,
  getVisiblePaneIndices,
  toVisualStep,
} from "moz-src:///browser/components/tabbrowser/NettoTabGeometry.sys.mjs";
import {
  CAMERA_SETTLE_EPSILON,
  NettoAnimationController,
} from "moz-src:///browser/components/tabbrowser/NettoAnimationController.sys.mjs";
import { NettoTabResidency } from "moz-src:///browser/components/tabbrowser/NettoTabResidency.sys.mjs";
import {
  buildAnalyticFrame,
  buildTransitionParticipants,
  sampleCompositedFrame,
  transitionDescriptor,
  unionTransitionTabs,
} from "moz-src:///browser/components/tabbrowser/NettoTransitionFrame.sys.mjs";
import { nettoDebugLog } from "moz-src:///browser/components/tabbrowser/NettoDebug.sys.mjs";
import { defineWindowController } from "moz-src:///browser/components/tabbrowser/NettoWindowController.sys.mjs";

const DEFAULT_RATIO_PREF = "browser.netto.defaultPaneRatio";
const ANIMATIONS_ENABLED_PREF = "browser.netto.animations.enabled";
const WHEEL_THRESHOLD = 60;
const RESIZE_STEP = 0.05;
const DEFAULT_PANE_RATIO = 0.5;
const DEFAULT_PANE_RATIO_PERCENT = 50;
const MIN_DEFAULT_PANE_RATIO = 0.05;
const WINDOW_TAB_EVENTS = [
  "TabOpen",
  "TabClose",
  "TabMove",
  "TabShow",
  "TabHide",
  "TabRemotenessChange",
];
const SPLIT_VIEW_EVENTS = ["TabSplitViewActivate", "TabSplitViewDeactivate"];

class TabTrackController {
  #window;
  #tabbrowser;
  #viewport;
  #track;
  #residency;
  #animationController;
  #active = false;
  #initialized = false;
  #viewportWidth = 0;
  #paneWidth = 0;
  #pendingRestoredOffset = null;
  #syncFrame = 0;
  #wheelDelta = 0;
  #pendingResize = false;
  #liveTabs = new Set();
  #workspaceTransition = null;
  #resizeObserver;

  constructor(window) {
    this.#window = window;
    this.#tabbrowser = window.gBrowser;
    this.#viewport = window.document.getElementById("netto-tab-viewport");
    this.#track = this.#tabbrowser.tabpanels;
    this.#residency = new NettoTabResidency(window);
    this.#animationController = new NettoAnimationController(
      window,
      this.#viewport,
      this.#track
    );
  }

  init() {
    if (!this.#isSupportedWindow()) {
      return;
    }
    Services.prefs.addObserver(DEFAULT_RATIO_PREF, this);
    Services.prefs.addObserver(ANIMATIONS_ENABLED_PREF, this);
    this.#bindEvents();
    this.#initialized = true;
    this.#animationController.retarget({
      to: 0,
      selectedTab: this.#tabbrowser.selectedTab,
      animate: false,
    });
    this.#updateActiveState();
  }

  destroy() {
    if (!this.#initialized) {
      this.#animationController.destroy();
      return;
    }
    Services.prefs.removeObserver(DEFAULT_RATIO_PREF, this);
    Services.prefs.removeObserver(ANIMATIONS_ENABLED_PREF, this);
    this.#unbindEvents();
    this.#finishResizeTransition();
    this.#animationController.cancelCamera("destroyed");
    this.#animationController.cancelWorkspace("destroyed");
    if (this.#syncFrame) {
      this.#window.cancelAnimationFrame(this.#syncFrame);
      this.#syncFrame = 0;
    }
    this.#residency.destroy();
    this.#liveTabs.clear();
    this.#pendingResize = false;
    this.#active = false;
    this.#clearLayout();
    if (this.#tabbrowser.nettoTabTrack == this) {
      delete this.#tabbrowser.nettoTabTrack;
    }
    this.#tabbrowser._switcher?.queueUnload(0);
    this.#animationController.destroy();
    this.#initialized = false;
  }

  observe(_subject, _topic, data) {
    if (data == DEFAULT_RATIO_PREF) {
      this.#scheduleSync();
      return;
    }
    if (data == ANIMATIONS_ENABLED_PREF) {
      this.#finishResizeTransition();
      this.#animationController.cancelCamera("animations-disabled");
      this.#animationController.cancelWorkspace("animations-disabled");
      this.#scheduleSync();
    }
  }

  shouldKeepLayers(tab) {
    return this.#residency.shouldKeepLayers(tab);
  }

  shouldKeepActive(tab) {
    return this.#residency.shouldKeepActive(tab);
  }

  getSnapshot() {
    const residency = this.#residency.getSnapshot();
    const camera = this.#animationController;
    return {
      active: this.#active,
      cameraOffset: camera.cameraOffset,
      settledOffset: camera.cameraTarget,
      cameraTarget: camera.cameraTarget,
      cameraAnimating: camera.cameraAnimating,
      workspaceAnimating: camera.workspaceAnimating,
      workspaceDirection: camera.workspaceDirection,
      paneWidth: this.#paneWidth,
      viewportWidth: this.#viewportWidth,
      presentedTab: camera.presentedTab,
      liveTabs: [...this.#liveTabs],
      heldTabs: residency.heldTabs,
      frozenTabs: residency.frozenTabs,
    };
  }

  focus(direction) {
    if (!this.#active || !["left", "right"].includes(direction)) {
      return;
    }
    const tabs = this.#orderedTabs();
    const currentIndex = tabs.indexOf(this.#tabbrowser.selectedTab);
    const delta = direction == "left" ? -1 : 1;
    const target = tabs[currentIndex + toVisualStep(delta, this.#isRTL())];
    if (target) {
      this.#tabbrowser.selectedTab = target;
    }
  }

  resize(direction) {
    if (!this.#active || !["left", "right", "up", "down"].includes(direction)) {
      return;
    }
    const tab = this.#tabbrowser.selectedTab;
    const currentRatio = this.#getTabPaneRatio(tab);
    const increase = direction == "right" || direction == "up";
    const { min, max } = this.#getPaneRatioBounds();
    const middle = Math.max(min, Math.min(max, DEFAULT_PANE_RATIO));
    let nextRatio;
    if (["up", "down"].includes(direction)) {
      if (increase) {
        nextRatio = currentRatio < middle ? middle : max;
      } else {
        nextRatio = currentRatio > middle ? middle : min;
      }
    } else {
      nextRatio = Math.min(
        max,
        Math.max(min, currentRatio + (increase ? RESIZE_STEP : -RESIZE_STEP))
      );
    }
    if (nextRatio == currentRatio) {
      return;
    }

    this.#pendingResize = true;
    if (this.#workspaceTransition || !this.#animationController.shouldAnimate) {
      this.#finishResizeTransition();
    } else {
      this.#track.setAttribute("netto-resizing", "true");
    }
    this.#animationController.cancelCamera("resize");
    this.#pendingRestoredOffset = null;
    this.#setTabPaneRatio(tab, nextRatio);
    this.#scheduleSync();
  }

  swap(direction) {
    if (!this.#active || !["left", "right"].includes(direction)) {
      return;
    }
    const tabs = this.#orderedTabs();
    const current = this.#tabbrowser.selectedTab;
    const currentIndex = tabs.indexOf(current);
    const delta = direction == "left" ? -1 : 1;
    const target = tabs[currentIndex + toVisualStep(delta, this.#isRTL())];
    if (target) {
      this.#tabbrowser.moveTabTo(current, {
        tabIndex: this.#tabbrowser.tabs.indexOf(target),
      });
    }
  }

  getCameraOffset() {
    return this.#animationController.cameraOffset;
  }

  getPaneRatio() {
    return this.#getTabPaneRatio(this.#tabbrowser.selectedTab);
  }

  restoreCameraOffset(offset) {
    if (Number.isFinite(offset) && offset >= 0) {
      this.#pendingRestoredOffset = offset;
      this.#scheduleSync();
    }
  }

  getWorkspaceTransitionFrame() {
    if (!this.#active) {
      return null;
    }
    this.#finishResizeTransition();
    const tabs = this.#orderedTabs();
    const selectedTab = this.#tabbrowser.selectedTab;
    const selectedIndex = tabs.indexOf(selectedTab);
    if (selectedIndex < 0) {
      return null;
    }
    const metrics = this.#getPaneMetrics(tabs, selectedIndex);
    const isRTL = this.#isRTL();
    const outgoingFrame = this.#workspaceTransition
      ? sampleCompositedFrame({
          tabs: [...this.#workspaceTransition.tabs],
          viewport: this.#measureViewport(),
          selectedTab,
          outgoingTrackWidth: metrics.total,
          panelForTab: tab => this.#panelForTab(tab),
          isRTL,
        })
      : buildAnalyticFrame({
          tabs,
          liveTabs: this.#liveTabs,
          metrics,
          cameraOffset: this.#animationController.cameraOffset,
          viewport: this.#measureViewport(),
          selectedTab,
          isRTL,
          getRatio: index => this.#getTabPaneRatio(tabs[index]),
        });
    if (outgoingFrame) {
      this.#residency.preserveForWorkspaceTransition(this.#liveTabs);
    }
    this.#animationController.cancelWorkspace("workspace-switch");
    this.#animationController.cancelCamera("workspace-switch");
    return outgoingFrame;
  }

  cancelWorkspaceTransition(reason = "cancelled") {
    this.#finishResizeTransition();
    this.#animationController.cancelWorkspace(reason);
  }

  beginWorkspaceTransition(direction, outgoingFrame) {
    this.#finishResizeTransition();
    if (!this.#active || !outgoingFrame) {
      return false;
    }
    const tabs = this.#orderedTabs();
    const selectedTab = this.#tabbrowser.selectedTab;
    const selectedIndex = tabs.indexOf(selectedTab);
    if (selectedIndex < 0) {
      return false;
    }
    const metrics = this.#getPaneMetrics(tabs, selectedIndex);
    const targetOffset = this.#getCameraTarget(
      metrics,
      selectedIndex,
      this.#animationController.cameraOffset,
      this.#pendingRestoredOffset
    );
    const liveTabs = this.#getLiveTabs(
      tabs,
      metrics,
      selectedTab,
      targetOffset,
      targetOffset
    );
    const incomingFrame = buildAnalyticFrame({
      tabs,
      liveTabs,
      metrics,
      cameraOffset: targetOffset,
      viewport: this.#measureViewport(),
      selectedTab,
      isRTL: this.#isRTL(),
      getRatio: index => this.#getTabPaneRatio(tabs[index]),
    });
    if (!incomingFrame) {
      return false;
    }
    const union = unionTransitionTabs(outgoingFrame, incomingFrame);
    const participants = buildTransitionParticipants(union, tab =>
      this.#panelForTab(tab)
    );
    if (participants.length != union.tabs.size) {
      return false;
    }
    this.#renderTransitionParticipants(
      participants,
      outgoingFrame,
      incomingFrame
    );
    this.#workspaceTransition = {
      outgoingFrame,
      incomingFrame,
      tabs: union.tabs,
    };
    this.#liveTabs = new Set(union.tabs);
    this.#residency.sync(this.#liveTabs, tabs, selectedTab, metrics, false);
    const started = this.#animationController.beginWorkspaceTransition({
      direction,
      participants,
      onFinish: result => this.#finishWorkspaceTransition(result),
    });
    if (!started) {
      this.#finishWorkspaceTransition({ reason: "not-started" });
    }
    return started;
  }

  #renderTransitionParticipants(participants, outgoingFrame, incomingFrame) {
    const selectedTab = incomingFrame.selectedTab;
    const byElement = new Map(
      participants.map(participant => [participant.element, participant])
    );
    this.#track.style.setProperty("transform", "none");
    this.#track.style.setProperty(
      "inline-size",
      `${Math.max(outgoingFrame.trackWidth, incomingFrame.trackWidth)}px`
    );
    for (const panel of this.#track.children) {
      const participant = byElement.get(panel);
      const descriptor =
        participant &&
        transitionDescriptor(
          participant.tab,
          participant.outgoing,
          participant.incoming,
          selectedTab
        );
      this.#applyPanelPresentation(panel, {
        tab: participant?.tab,
        selectedTab,
        live: !!participant,
        positioned: !!participant,
        transition: !!participant,
        focused: descriptor?.focused ?? false,
        inactive: descriptor?.inactive ?? false,
        ariaHidden: descriptor?.inactive ?? false,
        placement: descriptor
          ? { offset: descriptor.offset, width: descriptor.width }
          : null,
      });
    }
  }

  handleEvent(event) {
    switch (event.type) {
      case "TabSelect":
        this.#pendingResize = false;
        this.#finishResizeTransition();
        this.#scheduleSync();
        break;
      case "TabSwitched":
      case "TabOpen":
      case "TabMove":
      case "TabShow":
      case "TabHide":
      case "TabRemotenessChange":
        if (event.type == "TabRemotenessChange") {
          this.#residency.reconcileFrozenTab(event.target);
        }
        if (
          event.type == "TabOpen" &&
          event.target == this.#tabbrowser.selectedTab &&
          !event.target.linkedPanel
        ) {
          this.#tabbrowser.insertBrowser(event.target);
        }
        this.#scheduleSync();
        break;
      case "TabClose":
        this.#pendingResize = false;
        this.#finishResizeTransition();
        if (this.#workspaceTransition?.tabs.has(event.target)) {
          this.#animationController.cancelWorkspace("tab-close");
        }
        this.#scheduleSync();
        break;
      case "TabSplitViewActivate":
      case "TabSplitViewDeactivate":
        this.#updateActiveState();
        break;
      case "wheel":
        this.#handleWheel(event);
        break;
      case "click":
        this.#focusPaneFromPointer(event);
        break;
      case "visibilitychange":
        this.#scheduleSync();
        break;
      case "transitionend":
        if (
          event.target == this.#track &&
          this.#track.hasAttribute("netto-resizing")
        ) {
          this.#finishResizeTransition();
        }
        break;
    }
  }

  onStateChange(browser, webProgress, _request, stateFlags) {
    if (!webProgress?.isTopLevel) {
      return;
    }
    const tab = this.#tabbrowser.getTabForBrowser(browser);
    if (!tab) {
      return;
    }
    if (stateFlags & Ci.nsIWebProgressListener.STATE_STOP) {
      this.#residency.reconcileFrozenTab(tab);
    }
    if (
      stateFlags &
      (Ci.nsIWebProgressListener.STATE_START |
        Ci.nsIWebProgressListener.STATE_STOP)
    ) {
      this.#scheduleSync();
    }
  }

  #isSupportedWindow() {
    const root = this.#window.document.documentElement;
    return (
      this.#window.gMultiProcessBrowser &&
      !this.#window.browsingContext.isDocumentPiP &&
      !root.hasAttribute("taskbartab") &&
      !root.hasAttribute("ai-window")
    );
  }

  #bindEvents() {
    this.#tabbrowser.nettoTabTrack = this;
    this.#tabbrowser.tabContainer.addEventListener("TabSelect", this);
    this.#tabbrowser.addEventListener("TabSwitched", this);
    this.#tabbrowser.addTabsProgressListener(this);
    for (const type of WINDOW_TAB_EVENTS) {
      this.#window.addEventListener(type, this);
    }
    this.#window.document.addEventListener("visibilitychange", this);
    this.#viewport.addEventListener("wheel", this, { passive: false });
    this.#track.addEventListener("click", this);
    this.#track.addEventListener("transitionend", this, true);
    this.#resizeObserver = new this.#window.ResizeObserver(entries => {
      this.#viewportWidth = entries[0].contentRect.width;
      this.#scheduleSync();
    });
    this.#resizeObserver.observe(this.#viewport);
    for (const type of SPLIT_VIEW_EVENTS) {
      this.#window.addEventListener(type, this);
    }
  }

  #unbindEvents() {
    this.#tabbrowser.tabContainer.removeEventListener("TabSelect", this);
    this.#tabbrowser.removeEventListener("TabSwitched", this);
    this.#tabbrowser.removeTabsProgressListener(this);
    for (const type of WINDOW_TAB_EVENTS) {
      this.#window.removeEventListener(type, this);
    }
    this.#window.document.removeEventListener("visibilitychange", this);
    this.#viewport.removeEventListener("wheel", this);
    this.#track.removeEventListener("click", this);
    this.#track.removeEventListener("transitionend", this, true);
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    for (const type of SPLIT_VIEW_EVENTS) {
      this.#window.removeEventListener(type, this);
    }
  }

  #updateActiveState() {
    const active = !this.#tabbrowser.activeSplitView;
    if (this.#active == active) {
      this.#scheduleSync();
      return;
    }
    this.#active = active;
    if (!active) {
      this.#finishResizeTransition();
      this.#animationController.cancelCamera("inactive");
      this.#animationController.cancelWorkspace("inactive");
      this.#residency.releaseAll();
      this.#liveTabs.clear();
      this.#pendingResize = false;
      this.#clearLayout();
      return;
    }
    this.#viewport.setAttribute("netto-scrolling", "true");
    this.#window.document.documentElement.setAttribute(
      "netto-scrolling",
      "true"
    );
    this.#scheduleSync();
  }

  #scheduleSync() {
    if (!this.#active || this.#syncFrame) {
      return;
    }
    this.#syncFrame = this.#window.requestAnimationFrame(() => {
      this.#syncFrame = 0;
      this.#sync();
    });
  }

  #sync() {
    if (!this.#active) {
      return;
    }
    const tabs = this.#orderedTabs();
    const selectedTab = this.#tabbrowser.selectedTab;
    const selectedIndex = tabs.indexOf(selectedTab);
    if (selectedIndex < 0) {
      return;
    }
    this.#viewportWidth ||= this.#window.windowUtils.getBoundsWithoutFlushing(
      this.#viewport
    ).width;
    if (!this.#viewportWidth) {
      this.#scheduleSync();
      return;
    }

    const metrics = this.#getPaneMetrics(tabs, selectedIndex);
    if (this.#workspaceTransition) {
      this.#residency.sync(
        this.#workspaceTransition.tabs,
        tabs,
        selectedTab,
        metrics
      );
      return;
    }
    const resizeIntent = this.#pendingResize;
    this.#pendingResize = false;
    const currentOffset = this.#animationController.cameraOffset;
    const targetOffset = this.#getCameraTarget(
      metrics,
      selectedIndex,
      currentOffset,
      this.#pendingRestoredOffset
    );
    const restoring = this.#pendingRestoredOffset != null;
    this.#pendingRestoredOffset = null;
    const selectionChanged =
      this.#animationController.presentedTab != selectedTab;
    const animate =
      !restoring &&
      selectionChanged &&
      Math.abs(targetOffset - currentOffset) > CAMERA_SETTLE_EPSILON;
    const liveTabs = this.#getLiveTabs(
      tabs,
      metrics,
      selectedTab,
      resizeIntent || animate || this.#animationController.cameraAnimating
        ? currentOffset
        : targetOffset,
      targetOffset
    );

    this.#paneWidth = metrics.focusedWidth;
    this.#liveTabs = liveTabs;
    this.#render(tabs, selectedTab, metrics, liveTabs);
    this.#animationController.retarget({
      to: targetOffset,
      selectedTab,
      animate: resizeIntent ? false : animate,
      onFinish: () => this.#scheduleSync(),
    });
    this.#residency.sync(liveTabs, tabs, selectedTab, metrics);
  }

  #render(tabs, selectedTab, metrics, liveTabs) {
    const panelStates = new Map();
    for (let index = 0; index < tabs.length; index++) {
      const tab = tabs[index];
      if (liveTabs.has(tab) && !tab.linkedPanel) {
        this.#tabbrowser.insertBrowser(tab);
      }
      if (!tab.linkedPanel) {
        continue;
      }
      const panel = this.#panelForTab(tab);
      if (panel) {
        panelStates.set(panel, {
          tab,
          index,
          live: liveTabs.has(tab),
        });
      }
    }

    for (const panel of this.#track.children) {
      const state = panelStates.get(panel);
      this.#applyPanelPresentation(panel, {
        tab: state?.tab,
        selectedTab,
        live: !!state?.live,
        positioned: !!state,
        placement: state
          ? {
              offset: metrics.offsets[state.index],
              width: metrics.widths[state.index],
            }
          : null,
      });
    }
    this.#track.style.setProperty("inline-size", `${metrics.total}px`);
  }

  #applyPanelPresentation(
    panel,
    {
      tab = null,
      selectedTab = null,
      live = false,
      positioned = false,
      transition = false,
      focused = positioned && tab == selectedTab,
      inactive = live && tab != selectedTab,
      ariaHidden = positioned && tab != selectedTab,
      placement = null,
    }
  ) {
    panel.classList.toggle("netto-live", live);
    panel.classList.toggle("netto-positioned", positioned);
    panel.classList.toggle("netto-focused", focused);
    panel.classList.toggle("netto-inactive", inactive);
    panel.classList.toggle("netto-workspace-transition-pane", transition);
    panel.toggleAttribute("aria-hidden", ariaHidden);
    if (!placement) {
      panel.style.removeProperty("--netto-pane-offset");
      panel.style.removeProperty("--netto-pane-width");
      return;
    }
    panel.style.setProperty("--netto-pane-offset", `${placement.offset}px`);
    panel.style.setProperty("--netto-pane-width", `${placement.width}px`);
  }

  #getLiveTabs(tabs, metrics, selectedTab, cameraOffset, cameraEndOffset) {
    const presentedTab = this.#animationController.presentedTab;
    const liveTabs = new Set(
      getVisiblePaneIndices({
        metrics,
        viewportWidth: this.#viewportWidth,
        cameraOffset,
        cameraEndOffset,
      }).map(index => tabs[index])
    );
    liveTabs.add(selectedTab);
    if (presentedTab && tabs.includes(presentedTab)) {
      liveTabs.add(presentedTab);
    }
    return liveTabs;
  }

  #getCameraTarget(
    metrics,
    selectedIndex,
    currentOffset,
    pendingOffset = null
  ) {
    const maxOffset = getCameraMaxOffset(metrics, this.#viewportWidth);
    const boundedOffset = Math.min(maxOffset, Math.max(0, currentOffset));
    return getCameraTargetOffset({
      metrics,
      viewportWidth: this.#viewportWidth,
      targetIndex: selectedIndex,
      currentOffset: boundedOffset,
      pendingOffset,
    });
  }

  #isRTL() {
    return Services.locale.isAppLocaleRTL;
  }

  #finishResizeTransition() {
    this.#track.removeAttribute("netto-resizing");
  }

  #clearLayout() {
    this.#pendingResize = false;
    this.#finishResizeTransition();
    this.#viewport.removeAttribute("netto-scrolling");
    this.#window.document.documentElement.removeAttribute("netto-scrolling");
    this.#track.style.removeProperty("transform");
    this.#track.style.removeProperty("inline-size");
    for (const panel of this.#track.children) {
      panel.classList.remove(
        "netto-live",
        "netto-positioned",
        "netto-focused",
        "netto-inactive",
        "netto-workspace-transition-pane"
      );
      panel.style.removeProperty("--netto-pane-offset");
      panel.style.removeProperty("--netto-pane-width");
      panel.removeAttribute("aria-hidden");
    }
  }

  #finishWorkspaceTransition(result) {
    if (!this.#workspaceTransition) {
      return;
    }
    nettoDebugLog("workspace-live-transition-finish", result);
    this.#workspaceTransition = null;
    this.#scheduleSync();
  }

  #measureViewport() {
    const bounds = this.#window.windowUtils.getBoundsWithoutFlushing(
      this.#viewport
    );
    const width = this.#viewportWidth || bounds.width;
    this.#viewportWidth ||= width;
    return {
      left: bounds.left,
      top: bounds.top,
      width,
      height: bounds.height,
    };
  }

  #panelForTab(tab) {
    return tab.linkedPanel
      ? this.#window.document.getElementById(tab.linkedPanel)
      : null;
  }

  #getTabPaneRatio(tab) {
    const ratio = this.#tabbrowser.nettoWorkspace?.getTabPaneRatio(tab);
    if (Number.isFinite(ratio)) {
      return ratio;
    }
    const defaultRatioPercent = Services.prefs.getIntPref(
      DEFAULT_RATIO_PREF,
      DEFAULT_PANE_RATIO_PERCENT
    );
    if (
      defaultRatioPercent < MIN_DEFAULT_PANE_RATIO * 100 ||
      defaultRatioPercent > 100
    ) {
      return DEFAULT_PANE_RATIO;
    }
    return defaultRatioPercent / 100;
  }

  #setTabPaneRatio(tab, ratio) {
    this.#tabbrowser.nettoWorkspace?.setTabPaneRatio(tab, ratio);
  }

  #getPaneRatioBounds() {
    const width =
      this.#viewportWidth ||
      this.#window.windowUtils.getBoundsWithoutFlushing(this.#viewport).width;
    return getPaneRatioBounds(width);
  }

  #getPaneMetrics(tabs, selectedIndex) {
    const viewportWidth =
      this.#viewportWidth ||
      this.#window.windowUtils.getBoundsWithoutFlushing(this.#viewport).width;
    return getPaneMetrics({
      tabCount: tabs.length,
      selectedIndex,
      viewportWidth,
      getRatio: index => this.#getTabPaneRatio(tabs[index]),
    });
  }

  #orderedTabs() {
    return this.#tabbrowser.tabs.filter(
      tab => !tab.hidden && !tab.pinned && !tab.closing
    );
  }

  #focusPaneFromPointer(event) {
    if (event.button != 0) {
      return;
    }
    const panel = event.target.closest?.(".browserSidebarContainer");
    if (!panel || !panel.classList.contains("netto-inactive")) {
      return;
    }
    const tab = this.#tabbrowser.tabs.find(
      candidate => candidate.linkedPanel == panel.id
    );
    if (tab && tab != this.#tabbrowser.selectedTab) {
      this.#tabbrowser.selectedTab = tab;
    }
  }

  #handleWheel(event) {
    if (
      !this.#active ||
      event.ctrlKey ||
      event.metaKey ||
      Services.prefs.getBoolPref("toolkit.tabbox.switchByScrolling", false) ||
      (!event.deltaX && !event.shiftKey)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.#wheelDelta += event.deltaX || event.deltaY;
    if (Math.abs(this.#wheelDelta) < WHEEL_THRESHOLD) {
      return;
    }
    const tabs = this.#orderedTabs();
    const index = tabs.indexOf(this.#tabbrowser.selectedTab);
    const direction = toVisualStep(Math.sign(this.#wheelDelta), this.#isRTL());
    this.#wheelDelta = 0;
    const target = tabs[index + direction];
    if (target) {
      this.#tabbrowser.selectedTab = target;
    }
  }
}

export const NettoTabTrack = defineWindowController(
  window => new TabTrackController(window)
);
