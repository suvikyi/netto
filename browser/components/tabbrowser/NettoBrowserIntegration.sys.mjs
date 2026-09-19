/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { NettoTabTrack } from "moz-src:///browser/components/tabbrowser/NettoTabTrack.sys.mjs";
import { NettoWorkspace } from "moz-src:///browser/components/tabbrowser/NettoWorkspace.sys.mjs";
import { defineWindowController } from "moz-src:///browser/components/tabbrowser/NettoWindowController.sys.mjs";

const TABBAR_VISIBLE_PREF = "browser.netto.tabbar.visible";
const PANE_OUTLINE_COLOR_PREFS = Object.freeze([
  Object.freeze({
    pref: "browser.netto.pane.focusedOutlineColor",
    property: "--netto-pane-focused-outline-color-override",
  }),
  Object.freeze({
    pref: "browser.netto.pane.inactiveOutlineColor",
    property: "--netto-pane-inactive-outline-color-override",
  }),
]);
const TRACK_COMMANDS = new Map([
  ["Netto:FocusLeft", ["focus", "left"]],
  ["Netto:FocusRight", ["focus", "right"]],
  ["Netto:ResizeLeft", ["resize", "left"]],
  ["Netto:ResizeRight", ["resize", "right"]],
  ["Netto:ResizeUp", ["resize", "up"]],
  ["Netto:ResizeDown", ["resize", "down"]],
  ["Netto:SwapLeft", ["swap", "left"]],
  ["Netto:SwapRight", ["swap", "right"]],
]);

class BrowserIntegrationController {
  #window;
  #commandSet;
  #tabbrowser;
  #tabContextMenu;

  constructor(window) {
    this.#window = window;
    this.#commandSet = window.document.getElementById("mainCommandSet");
    this.#tabbrowser = window.gBrowser;
    this.#tabContextMenu = window.document.getElementById("tabContextMenu");
  }

  init() {
    Services.prefs.addObserver(TABBAR_VISIBLE_PREF, this);
    for (let { pref } of PANE_OUTLINE_COLOR_PREFS) {
      Services.prefs.addObserver(pref, this);
    }
    this.#updateTabbarVisibility();
    this.#updatePaneOutlineColors();
    NettoWorkspace.init(this.#window);
    NettoTabTrack.init(this.#window);
    this.#commandSet?.addEventListener("command", this);
    this.#tabbrowser?.addEventListener("TabSplitViewBeforeCreate", this);
    this.#tabContextMenu?.addEventListener("popupshown", this);
  }

  destroy() {
    Services.prefs.removeObserver(TABBAR_VISIBLE_PREF, this);
    for (let { pref } of PANE_OUTLINE_COLOR_PREFS) {
      Services.prefs.removeObserver(pref, this);
    }
    this.#commandSet?.removeEventListener("command", this);
    this.#tabbrowser?.removeEventListener("TabSplitViewBeforeCreate", this);
    this.#tabContextMenu?.removeEventListener("popupshown", this);
    // Workspace teardown captures its camera offset through the live track.
    NettoWorkspace.destroy(this.#window);
    NettoTabTrack.destroy(this.#window);
  }

  observe(_subject, _topic, data) {
    if (data == TABBAR_VISIBLE_PREF) {
      this.#updateTabbarVisibility();
    } else if (PANE_OUTLINE_COLOR_PREFS.some(({ pref }) => pref == data)) {
      this.#updatePaneOutlineColors();
    }
  }

  #updateTabbarVisibility() {
    this.#window.document.documentElement.toggleAttribute(
      "netto-tabbar-visible",
      Services.prefs.getBoolPref(TABBAR_VISIBLE_PREF, false)
    );
  }

  #updatePaneOutlineColors() {
    let root = this.#window.document.documentElement;
    let supportsColor = this.#window.CSS?.supports("color", "red");

    for (let { pref, property } of PANE_OUTLINE_COLOR_PREFS) {
      let color = Services.prefs.getStringPref(pref, "").trim();
      if (supportsColor && color && this.#window.CSS.supports("color", color)) {
        root.style.setProperty(property, color);
      } else {
        root.style.removeProperty(property);
      }
    }
  }

  handleEvent(event) {
    if (event.type == "TabSplitViewBeforeCreate") {
      if (this.#tabbrowser.nettoTabTrack?.getSnapshot().active) {
        event.preventDefault();
      }
      return;
    }

    if (
      event.type == "popupshown" &&
      this.#tabbrowser.nettoTabTrack?.getSnapshot().active
    ) {
      for (let id of ["context_moveTabToSplitView"]) {
        this.#window.document
          .getElementById(id)
          ?.setAttribute("disabled", "true");
      }
      return;
    }

    if (event.target.id == "Netto:NewTab") {
      this.#window.BrowserCommands.openTab();
      return;
    }
    const trackCommand = TRACK_COMMANDS.get(event.target.id);
    if (trackCommand) {
      const [method, direction] = trackCommand;
      this.#tabbrowser.nettoTabTrack?.[method](direction);
    }
  }
}

export const NettoBrowserIntegration = defineWindowController(
  window => new BrowserIntegrationController(window)
);
