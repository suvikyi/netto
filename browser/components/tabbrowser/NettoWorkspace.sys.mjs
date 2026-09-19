/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { PrivateBrowsingUtils } from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";
import { SessionStore } from "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs";
import { MIN_PANE_RATIO } from "moz-src:///browser/components/tabbrowser/NettoTabGeometry.sys.mjs";
import { NettoWorkspaceBar } from "moz-src:///browser/components/tabbrowser/NettoWorkspaceBar.sys.mjs";
import { defineWindowController } from "moz-src:///browser/components/tabbrowser/NettoWindowController.sys.mjs";
import { nettoDebugLog } from "moz-src:///browser/components/tabbrowser/NettoDebug.sys.mjs";

const WINDOW_VALUE = "nettoWorkspaces";
const TAB_VALUE = "nettoWorkspace";
const PANE_RATIO_VALUE = "nettoPaneRatio";
const FOCUS_VALUE = "nettoWorkspaceFocus";
const HIDDEN_BY = "netto-workspace";
const VERSION = 1;
const MAX_WORKSPACES = 9;
const DEFAULT_NAME = "Workspace";
const NEW_TAB_URL = "about:newtab";
const TAB_EVENTS = [
  "TabOpen",
  "TabClose",
  "TabSelect",
  "TabShow",
  "TabHide",
  "TabMove",
];

class WorkspaceController {
  #window;
  #document;
  #tabbrowser;
  #bar;
  #contextMenu;
  #workspaces = new Map();
  #activeId = 1;
  #contextId = 1;
  #defaultName = DEFAULT_NAME;
  #initialized = false;
  #restored = false;
  #ensureScheduled = false;
  #commandHandlers = [];
  #pendingClose = null;

  constructor(window) {
    this.#window = window;
    this.#document = window.document;
    this.#tabbrowser = window.gBrowser;
    this.#bar = new NettoWorkspaceBar(window.document);
    this.#contextMenu = this.#document.getElementById(
      "netto-workspace-context-menu"
    );
    for (let id = 1; id <= MAX_WORKSPACES; id++) {
      this.#workspaces.set(id, { id, name: "", camera: 0 });
    }
  }

  init() {
    if (!this.#isSupportedWindow()) {
      return;
    }
    this.#initialized = true;
    this.#tabbrowser.nettoWorkspace = this;
    this.#document.documentElement.setAttribute("netto-workspaces", "true");
    this.#document
      .getElementById("TabsToolbar")
      ?.setAttribute("netto-workspaces", "true");
    for (const type of TAB_EVENTS) {
      this.#tabbrowser.tabContainer.addEventListener(type, this);
    }
    this.#window.addEventListener("SSWindowStateReady", this, { once: true });
    this.#bar.build(MAX_WORKSPACES, {
      onSelect: id => this.selectWorkspace(id),
      onContextMenu: event => this.#openContextMenu(event),
    });
    this.#bindCommands();
    this.#disableNativeNumberKeys();
    this.#getLocalizedString("netto-workspace-default-name").then(name => {
      if (this.#initialized && name) {
        this.#defaultName = name;
        this.#render();
      }
    });
    this.#render();
    SessionStore.promiseAllWindowsRestored.then(() => this.#restore());
  }

  destroy() {
    if (!this.#initialized) {
      return;
    }
    this.#captureCameraOffset();
    if (this.#restored) {
      this.#save();
    }
    this.#removeListeners();
    this.#revealWorkspaceTabs();
    if (this.#tabbrowser.nettoWorkspace == this) {
      delete this.#tabbrowser.nettoWorkspace;
    }
    this.#document.documentElement.removeAttribute("netto-workspaces");
    this.#document
      .getElementById("TabsToolbar")
      ?.removeAttribute("netto-workspaces");
    this.#restoreNativeTabKeys();
    this.#initialized = false;
  }

  getSnapshot() {
    return {
      activeId: this.#activeId,
      workspaces: [...this.#workspaces.values()].map(workspace => ({
        ...workspace,
        focusedTab: this.#focusedTabForWorkspace(workspace.id)?._tPos ?? null,
        tabCount: this.#tabsForWorkspace(workspace.id).length,
      })),
    };
  }

  handleEvent(event) {
    if (event.type == "SSWindowStateReady") {
      this.#restore();
      return;
    }

    switch (event.type) {
      case "TabOpen":
        this.#assignTab(event.target);
        this.#render();
        break;
      case "TabSelect":
        this.#revealSelectedTab();
        this.#rememberFocusedTab(this.#tabbrowser.selectedTab);
        break;
      case "TabClose":
      case "TabMove":
      case "TabShow":
      case "TabHide":
        this.#render();
        if (event.type == "TabClose") {
          this.#scheduleEnsureActiveWorkspace();
        }
        break;
    }
  }

  selectWorkspace(id, direction = null) {
    id = this.#normalizeId(id);
    const track = this.#tabbrowser.nettoTabTrack;
    if (!id || !this.#restored) {
      track?.cancelWorkspaceTransition("invalid-workspace");
      return false;
    }
    if (id == this.#activeId) {
      track?.cancelWorkspaceTransition("workspace-selection-cancelled");
      return false;
    }
    const previousId = this.#activeId;
    direction ??= id > previousId ? "next" : "previous";
    nettoDebugLog("workspace-request", {
      from: previousId,
      to: id,
      direction,
    });
    this.#captureCameraOffset();
    return this.#selectWorkspace(id, direction, null);
  }

  #selectWorkspace(id, direction, requestedTab) {
    if (!this.#initialized || !this.#restored) {
      return false;
    }

    const track = this.#tabbrowser.nettoTabTrack;
    const outgoingFrame = track?.getWorkspaceTransitionFrame() ?? null;
    const prepared = !!outgoingFrame;
    nettoDebugLog("workspace-frame-result", {
      from: this.#activeId,
      to: id,
      prepared,
    });

    const target = this.#findWorkspaceTarget(id, requestedTab);
    this.#commitWorkspaceSelection(id, target);
    const started = prepared
      ? track?.beginWorkspaceTransition(direction, outgoingFrame)
      : false;
    nettoDebugLog("workspace-commit", {
      activeId: id,
      prepared,
      started,
    });
    this.#render();
    this.#save();
    return !!started;
  }

  #findWorkspaceTarget(id, requestedTab) {
    const tabs = this.#tabsForWorkspace(id);
    return requestedTab && this.#workspaceForTab(requestedTab) == id
      ? requestedTab
      : this.#focusedTabForWorkspace(id) ||
          tabs.find(tab => !tab.hidden) ||
          tabs[0] ||
          null;
  }

  #ensureWorkspaceTarget(id, target = null) {
    if (target && !target.closing && this.#workspaceForTab(target) == id) {
      return target;
    }
    const created = this.#tabbrowser.addTrustedTab(NEW_TAB_URL, {
      selected: true,
    });
    this.#setTabWorkspace(created, id);
    return created;
  }

  #commitWorkspaceSelection(id, target) {
    this.#activeId = id;
    target = this.#ensureWorkspaceTarget(id, target);
    this.#applyVisibility(target);
    this.#tabbrowser.nettoTabTrack?.restoreCameraOffset(
      this.#workspaces.get(id).camera
    );
  }

  moveSelectedTabTo(id, follow = true) {
    id = this.#normalizeId(id);
    const tab = this.#tabbrowser.selectedTab;
    if (!id || !tab || tab.pinned || tab.closing) {
      return;
    }
    if (this.#workspaceForTab(tab) == id) {
      if (follow) {
        this.selectWorkspace(id);
      }
      return;
    }

    if (follow) {
      let fallback = this.#tabsForWorkspace(this.#activeId).find(
        candidate => candidate != tab
      );
      if (fallback) {
        this.#tabbrowser.selectedTab = fallback;
        this.#rememberFocusedTab(fallback);
      }
      SessionStore.deleteCustomTabValue(tab, FOCUS_VALUE);
      this.#setTabWorkspace(tab, id);
      this.#rememberFocusedTab(tab);
      this.selectWorkspace(id);
      return;
    }

    SessionStore.deleteCustomTabValue(tab, FOCUS_VALUE);
    this.#setTabWorkspace(tab, id);
    const fallback = this.#tabsForWorkspace(this.#activeId).find(
      candidate => candidate != tab && !candidate.hidden
    );
    if (fallback) {
      this.#applyVisibility(fallback);
      this.#rememberFocusedTab(fallback);
    } else {
      this.#applyVisibility(this.#ensureWorkspaceTarget(this.#activeId));
    }
    this.#save();
    this.#render();
  }

  #finishPendingClose() {
    const pending = this.#pendingClose;
    if (!pending) {
      return;
    }
    this.#pendingClose = null;
    this.#tabbrowser.removeTabs(pending.tabs, { animate: false });
    this.#workspaces.get(pending.id).name = "";
    this.#ensureActiveWorkspace();
    this.#save();
    this.#render();
  }

  updateCameraOffset(offset) {
    if (!Number.isFinite(offset) || offset < 0 || !this.#restored) {
      return;
    }
    this.#workspaces.get(this.#activeId).camera = offset;
  }

  getTabPaneRatio(tab) {
    const raw = SessionStore.getCustomTabValue(tab, PANE_RATIO_VALUE);
    if (!raw) {
      return null;
    }
    const value = Number(raw);
    return Number.isFinite(value)
      ? Math.min(1, Math.max(MIN_PANE_RATIO, value))
      : null;
  }

  setTabPaneRatio(tab, ratio) {
    if (!tab || !Number.isFinite(ratio)) {
      return;
    }
    SessionStore.setCustomTabValue(
      tab,
      PANE_RATIO_VALUE,
      String(Math.min(1, Math.max(MIN_PANE_RATIO, ratio)))
    );
  }

  #captureCameraOffset() {
    const offset = this.#tabbrowser.nettoTabTrack?.getCameraOffset();
    if (Number.isFinite(offset) && offset >= 0) {
      this.#workspaces.get(this.#activeId).camera = offset;
    }
  }

  nextWorkspace() {
    const id = (this.#activeId % MAX_WORKSPACES) + 1;
    this.selectWorkspace(id, "next");
  }

  previousWorkspace() {
    const id = ((this.#activeId - 2 + MAX_WORKSPACES) % MAX_WORKSPACES) + 1;
    this.selectWorkspace(id, "previous");
  }

  async renameWorkspace(id) {
    id = this.#normalizeId(id);
    if (!id) {
      return;
    }
    const [title, message] = await Promise.all([
      this.#getLocalizedString("netto-workspace-rename-title"),
      this.#getLocalizedString("netto-workspace-rename-prompt"),
    ]);
    const input = { value: this.#workspaces.get(id).name || this.#defaultName };
    if (Services.prompt.prompt(this.#window, title, message, input, null, {})) {
      this.#workspaces.get(id).name = input.value.trim();
      this.#save();
      this.#render();
    }
  }

  async closeWorkspace(id) {
    id = this.#normalizeId(id);
    if (!id) {
      return;
    }
    const tabs = this.#tabsForWorkspace(id);
    if (!tabs.length) {
      this.#workspaces.get(id).name = "";
      this.#save();
      this.#render();
      return;
    }

    const [title, message] = await Promise.all([
      this.#getLocalizedString("netto-workspace-close-title"),
      this.#getLocalizedString("netto-workspace-close-prompt", {
        count: tabs.length,
      }),
    ]);
    if (!Services.prompt.confirm(this.#window, title, message)) {
      return;
    }

    if (id == this.#activeId) {
      const next = this.#findWorkspaceWithTabs(id);
      if (next) {
        this.#pendingClose = { id, tabs: [...tabs] };
        await this.selectWorkspace(next);
      } else {
        this.#applyVisibility(this.#ensureWorkspaceTarget(this.#activeId));
      }
    }

    if (this.#pendingClose) {
      this.#finishPendingClose();
      return;
    }

    this.#tabbrowser.removeTabs(tabs, { animate: false });
    this.#workspaces.get(id).name = "";
    this.#ensureActiveWorkspace();
    this.#save();
    this.#render();
  }

  #removeListeners() {
    for (const type of TAB_EVENTS) {
      this.#tabbrowser.tabContainer.removeEventListener(type, this);
    }
    this.#window.removeEventListener("SSWindowStateReady", this);
    for (const [node, handler] of this.#commandHandlers) {
      node.removeEventListener("command", handler);
    }
    this.#commandHandlers = [];
    this.#ensureScheduled = false;
  }

  #bindCommands() {
    const bindings = [];
    for (let id = 1; id <= MAX_WORKSPACES; id++) {
      bindings.push(
        [`Netto:Workspace${id}`, () => this.selectWorkspace(id)],
        [`Netto:MoveWorkspace${id}`, () => this.moveSelectedTabTo(id, true)],
        [
          `Netto:MoveWorkspaceSilent${id}`,
          () => this.moveSelectedTabTo(id, false),
        ]
      );
    }
    bindings.push(
      ["Netto:NextWorkspace", () => this.nextWorkspace()],
      ["Netto:PreviousWorkspace", () => this.previousWorkspace()],
      ["Netto:CloseWorkspace", () => this.closeWorkspace(this.#activeId)],
      ["netto-workspace-rename", () => this.renameWorkspace(this.#contextId)],
      ["netto-workspace-close", () => this.closeWorkspace(this.#contextId)]
    );
    for (const [id, handler] of bindings) {
      const node = this.#document.getElementById(id);
      if (node) {
        node.addEventListener("command", handler);
        this.#commandHandlers.push([node, handler]);
      }
    }
  }

  async #getLocalizedString(id, args) {
    return this.#document.l10n.formatValue(id, args);
  }

  #openContextMenu(event) {
    const button = event.target.closest?.("[data-workspace-id]");
    if (!button || !this.#contextMenu) {
      return;
    }
    event.preventDefault();
    this.#contextId = Number(button.dataset.workspaceId);
    this.#contextMenu.openPopup(button, "after_start", 0, 0, true);
  }

  #nativeNumberKeyId(id) {
    return id == MAX_WORKSPACES ? "key_selectLastTab" : `key_selectTab${id}`;
  }

  #forEachNativeNumberKey(fn) {
    for (let id = 1; id <= MAX_WORKSPACES; id++) {
      const key = this.#document.getElementById(this.#nativeNumberKeyId(id));
      if (key?.getAttribute("modifiers") == "alt") {
        fn(key);
      }
    }
  }

  #restoreNativeTabKeys() {
    this.#forEachNativeNumberKey(key => key.removeAttribute("disabled"));
  }

  #disableNativeNumberKeys() {
    this.#forEachNativeNumberKey(key => key.setAttribute("disabled", "true"));
  }

  #restore() {
    if (!this.#initialized || this.#restored) {
      return;
    }
    let raw;
    try {
      raw = SessionStore.getCustomWindowValue(this.#window, WINDOW_VALUE);
    } catch (error) {
      if (error.result == Cr.NS_ERROR_ILLEGAL_VALUE) {
        return;
      }
      throw error;
    }
    this.#restored = true;
    if (raw) {
      try {
        const state = JSON.parse(raw);
        if (state.version == VERSION) {
          this.#activeId = this.#normalizeId(state.active) || 1;
          for (const workspace of state.workspaces || []) {
            const id = this.#normalizeId(workspace.id);
            if (id) {
              const entry = this.#workspaces.get(id);
              entry.name =
                typeof workspace.name == "string" ? workspace.name : "";
              const camera = Number(workspace.camera);
              if (Number.isFinite(camera) && camera >= 0) {
                entry.camera = camera;
              }
            }
          }
        }
      } catch (error) {
        console.warn("Ignoring malformed Netto workspace state", error);
      }
    }

    for (const tab of this.#tabbrowser.tabs) {
      this.#assignTab(tab);
    }
    this.#ensureActiveWorkspace();
    this.#applyVisibility(
      this.#focusedTabForWorkspace(this.#activeId) ||
        this.#tabsForWorkspace(this.#activeId)[0]
    );
    this.#rememberFocusedTab(this.#tabbrowser.selectedTab);
    this.#tabbrowser.nettoTabTrack?.restoreCameraOffset(
      this.#workspaces.get(this.#activeId).camera
    );
    this.#render();
    this.#save();
  }

  #assignTab(tab) {
    if (
      !tab ||
      tab.pinned ||
      tab.closing ||
      PrivateBrowsingUtils.isWindowPrivate(this.#window)
    ) {
      return;
    }
    const existing = this.#workspaceForTab(tab);
    if (!existing) {
      this.#setTabWorkspace(tab, this.#activeId);
    }
  }

  #revealSelectedTab() {
    if (!this.#restored) {
      return;
    }
    const tab = this.#tabbrowser.selectedTab;
    const id = this.#workspaceForTab(tab);
    if (!id) {
      return;
    }
    if (id == this.#activeId) {
      return;
    }
    const previousId = this.#activeId;
    nettoDebugLog("workspace-tab-request", {
      from: previousId,
      to: id,
      tab: tab?._tPos ?? null,
    });
    this.#captureCameraOffset();
    this.#selectWorkspace(id, id > previousId ? "next" : "previous", tab);
  }

  #scheduleEnsureActiveWorkspace() {
    if (this.#ensureScheduled) {
      return;
    }
    this.#ensureScheduled = true;
    this.#window.queueMicrotask(() => {
      this.#ensureScheduled = false;
      if (this.#initialized && this.#restored) {
        this.#ensureActiveWorkspace();
      }
    });
  }

  #ensureActiveWorkspace() {
    const tabs = this.#tabsForWorkspace(this.#activeId);
    if (tabs.length) {
      if (
        !this.#tabbrowser.selectedTab ||
        this.#workspaceForTab(this.#tabbrowser.selectedTab) != this.#activeId
      ) {
        this.#applyVisibility(
          this.#focusedTabForWorkspace(this.#activeId) || tabs[0]
        );
      }
      return;
    }
    this.#applyVisibility(this.#ensureWorkspaceTarget(this.#activeId));
  }

  #applyVisibility(target) {
    if (!target || target.closing) {
      target =
        this.#focusedTabForWorkspace(this.#activeId) ||
        this.#tabsForWorkspace(this.#activeId)[0];
    }
    if (!target) {
      return;
    }
    for (const tab of this.#tabsForWorkspace(this.#activeId)) {
      if (tab.hidden && this.#isWorkspaceHidden(tab)) {
        this.#tabbrowser.showTab(tab);
      }
    }
    if (target.hidden && this.#isWorkspaceHidden(target)) {
      this.#tabbrowser.showTab(target);
    }
    if (this.#tabbrowser.selectedTab != target) {
      this.#tabbrowser.selectedTab = target;
    }
    for (const tab of this.#tabbrowser.tabs) {
      if (
        tab == target ||
        tab.pinned ||
        tab.closing ||
        this.#workspaceForTab(tab) == this.#activeId
      ) {
        continue;
      }
      if (!tab.hidden) {
        this.#tabbrowser.hideTab(tab, HIDDEN_BY);
      }
    }
  }

  #revealWorkspaceTabs() {
    for (const tab of this.#tabbrowser.tabs) {
      if (tab.hidden && this.#isWorkspaceHidden(tab)) {
        this.#tabbrowser.showTab(tab);
      }
    }
  }

  #isWorkspaceHidden(tab) {
    return SessionStore.getCustomTabValue(tab, "hiddenBy") == HIDDEN_BY;
  }

  #save() {
    if (
      !this.#restored ||
      PrivateBrowsingUtils.isWindowPrivate(this.#window) ||
      !this.#window.__SSi
    ) {
      return;
    }
    try {
      SessionStore.setCustomWindowValue(
        this.#window,
        WINDOW_VALUE,
        JSON.stringify({
          version: VERSION,
          active: this.#activeId,
          workspaces: [...this.#workspaces.values()].map(
            ({ id, name, camera }) => ({
              id,
              name,
              camera,
            })
          ),
        })
      );
    } catch (error) {
      if (error.result != Cr.NS_ERROR_ILLEGAL_VALUE) {
        throw error;
      }
    }
  }

  #focusedTabForWorkspace(id) {
    return this.#tabsForWorkspace(id).find(
      tab => SessionStore.getCustomTabValue(tab, FOCUS_VALUE) == String(id)
    );
  }

  #rememberFocusedTab(tab) {
    const id = this.#workspaceForTab(tab);
    if (!id || PrivateBrowsingUtils.isWindowPrivate(this.#window)) {
      return;
    }
    for (const candidate of this.#tabsForWorkspace(id)) {
      if (candidate != tab) {
        SessionStore.deleteCustomTabValue(candidate, FOCUS_VALUE);
      }
    }
    SessionStore.setCustomTabValue(tab, FOCUS_VALUE, String(id));
  }

  #setTabWorkspace(tab, id) {
    if (
      !tab ||
      tab.pinned ||
      PrivateBrowsingUtils.isWindowPrivate(this.#window)
    ) {
      return;
    }
    SessionStore.setCustomTabValue(tab, TAB_VALUE, String(id));
  }

  #workspaceForTab(tab) {
    if (!tab || tab.pinned) {
      return null;
    }
    const id = Number(SessionStore.getCustomTabValue(tab, TAB_VALUE));
    return this.#normalizeId(id);
  }

  #tabsForWorkspace(id) {
    return this.#tabbrowser.tabs.filter(
      tab => !tab.pinned && !tab.closing && this.#workspaceForTab(tab) == id
    );
  }

  #findWorkspaceWithTabs(exclude) {
    for (let id = 1; id <= MAX_WORKSPACES; id++) {
      if (id != exclude && this.#tabsForWorkspace(id).length) {
        return id;
      }
    }
    return null;
  }

  #normalizeId(id) {
    id = Number(id);
    return Number.isInteger(id) && id >= 1 && id <= MAX_WORKSPACES ? id : null;
  }

  #render() {
    const entries = [...this.#workspaces.values()].map(workspace => ({
      id: workspace.id,
      populated: this.#tabsForWorkspace(workspace.id).length,
      label: this.#labelForWorkspace(workspace, workspace.id == this.#activeId),
    }));
    this.#bar.update(entries, this.#activeId);
  }

  #labelForWorkspace(workspace, active) {
    const name = workspace.name || this.#defaultName;
    return active ? `${workspace.id} · ${name}` : String(workspace.id);
  }

  #isSupportedWindow() {
    const root = this.#document.documentElement;
    return (
      !PrivateBrowsingUtils.isWindowPrivate(this.#window) &&
      !root.hasAttribute("taskbartab") &&
      !root.hasAttribute("ai-window") &&
      this.#bar.supported
    );
  }
}

export const NettoWorkspace = defineWindowController(
  window => new WorkspaceController(window)
);
