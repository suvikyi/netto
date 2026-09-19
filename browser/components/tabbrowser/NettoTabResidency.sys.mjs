/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export class NettoTabResidency {
  #window;
  #tabbrowser;
  #liveTabs = new Set();
  #heldTabs = new Set();
  #frozenTabs = new Set();
  #browserViewportWidths = new Map();

  constructor(window) {
    this.#window = window;
    this.#tabbrowser = window.gBrowser;
  }

  sync(liveTabs, tabs, selectedTab, metrics, refresh = true) {
    this.#liveTabs = new Set(liveTabs);
    let switcher = this.#tabbrowser._switcher;
    for (const tab of [...this.#heldTabs, ...this.#frozenTabs]) {
      if (tab.closing || !tab.linkedBrowser) {
        this.#releaseTab(tab);
      }
    }
    if (this.#window.document.hidden) {
      this.releaseAll();
      this.#tabbrowser._switcher?.queueUnload(0);
      return;
    }

    for (const tab of [...this.#heldTabs]) {
      if (!this.#liveTabs.has(tab)) {
        this.#freezeTab(tab);
      }
    }

    for (const tab of this.#liveTabs) {
      this.#heldTabs.delete(tab);
      const wasFrozen = this.#frozenTabs.delete(tab);
      if (wasFrozen && tab.linkedBrowser) {
        if (switcher) {
          switcher.clearNettoTabLayerPreservation(tab);
        } else {
          tab.linkedBrowser.preserveLayers(false);
        }
      }
      if (tab == selectedTab || tab.closing || !tab.linkedPanel) {
        continue;
      }
      switcher ??= this.#tabbrowser._getSwitcher();
      this.#heldTabs.add(tab);
      switcher.holdNettoTab(tab);
    }
    (switcher ?? this.#tabbrowser._switcher)?.queueUnload(250);
    if (refresh) {
      this.#refreshBrowserViewports(tabs, selectedTab, metrics);
    }
  }

  getSnapshot() {
    return {
      liveTabs: [...this.#liveTabs],
      heldTabs: [...this.#heldTabs],
      frozenTabs: [...this.#frozenTabs],
    };
  }

  shouldKeepLayers(tab) {
    return (
      !this.#window.document.hidden &&
      (this.#liveTabs.has(tab) || this.#frozenTabs.has(tab))
    );
  }

  shouldKeepActive(tab) {
    return (
      !this.#window.document.hidden &&
      !this.#tabbrowser._switcher?.switchInProgress &&
      this.#liveTabs.has(tab)
    );
  }

  reconcileFrozenTab(tab) {
    if (this.#frozenTabs.has(tab)) {
      this.#freezeTab(tab);
    }
  }

  preserveForWorkspaceTransition(tabs) {
    const switcher = this.#tabbrowser._switcher;
    for (const tab of tabs) {
      if (switcher) {
        switcher.preserveNettoTabLayers(tab);
      } else {
        const browser = tab.linkedBrowser;
        if (browser?.hasLayers) {
          browser.preserveLayers(true);
        }
      }
    }
  }

  releaseAll() {
    const tabs = new Set([
      ...this.#liveTabs,
      ...this.#heldTabs,
      ...this.#frozenTabs,
    ]);
    this.#liveTabs.clear();
    for (const tab of tabs) {
      this.#releaseTab(tab);
    }
    this.#heldTabs.clear();
    this.#frozenTabs.clear();
  }

  destroy() {
    this.releaseAll();
    this.#browserViewportWidths.clear();
  }

  #releaseTab(tab) {
    this.#heldTabs.delete(tab);
    this.#frozenTabs.delete(tab);
    if (tab == this.#tabbrowser.selectedTab || !tab.linkedBrowser) {
      return;
    }
    const switcher = this.#tabbrowser._switcher;
    if (switcher) {
      switcher.releaseNettoTab(tab);
      return;
    }
    const browser = tab.linkedBrowser;
    browser.preserveLayers(false);
    browser.docShellIsActive = false;
    browser.renderLayers = false;
  }

  #freezeTab(tab) {
    this.#heldTabs.delete(tab);
    if (tab == this.#tabbrowser.selectedTab || !tab.linkedBrowser) {
      return;
    }
    const wasFrozen = this.#frozenTabs.has(tab);
    this.#frozenTabs.add(tab);
    const remoteTab = tab.linkedBrowser.frameLoader?.remoteTab;
    if (
      wasFrozen &&
      !tab.linkedBrowser.docShellIsActive &&
      !remoteTab?.priorityHint &&
      tab.linkedBrowser.hasLayers
    ) {
      return;
    }
    const switcher = this.#tabbrowser._switcher;
    if (switcher) {
      switcher.freezeNettoTab(tab);
      return;
    }
    const browser = tab.linkedBrowser;
    browser.preserveLayers(true);
    browser.docShellIsActive = false;
  }

  #refreshBrowserViewports(tabs, selectedTab, metrics) {
    const tabSet = new Set(tabs);
    for (const tab of this.#browserViewportWidths.keys()) {
      if (!tabSet.has(tab)) {
        this.#browserViewportWidths.delete(tab);
      }
    }
    for (const tab of this.#liveTabs) {
      const index = tabs.indexOf(tab);
      const width = index >= 0 ? metrics.widths[index] : metrics.focusedWidth;
      const previousWidth = this.#browserViewportWidths.get(tab);
      this.#browserViewportWidths.set(tab, width);
      if (tab == selectedTab || previousWidth == width) {
        continue;
      }
      const browser = tab.linkedBrowser;
      if (!browser || browser.docShellIsActive) {
        continue;
      }
      try {
        // A live inactive browser needs one activation when its pane width
        // changes so its content viewport can reflow. Residency keeps it
        // active while the pane remains live.
        const switcher = this.#tabbrowser._switcher;
        if (switcher) {
          switcher.activateNettoTab(tab);
        } else {
          browser.docShellIsActive = true;
        }
      } catch {
        continue;
      }
    }
  }
}
