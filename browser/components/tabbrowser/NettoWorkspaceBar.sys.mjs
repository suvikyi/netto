/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export class NettoWorkspaceBar {
  #document;
  #container;
  #buttons = new Map();

  constructor(document) {
    this.#document = document;
    this.#container = document.getElementById("netto-workspace-indicators");
  }

  get supported() {
    return !!this.#container;
  }

  build(count, { onSelect, onContextMenu }) {
    if (!this.#container || this.#buttons.size) {
      return;
    }
    const fragment = this.#document.createDocumentFragment();
    for (const button of this.#container.querySelectorAll(
      ".netto-workspace-indicator"
    )) {
      button.remove();
    }
    // The bar always shows one indicator per workspace slot, so buttons are
    // created once and updated in place. Rebuilding them on every tab event
    // would destroy keyboard focus.
    for (let id = 1; id <= count; id++) {
      const button = this.#document.createXULElement("toolbarbutton");
      button.classList.add("netto-workspace-indicator", "workspace");
      button.dataset.workspaceId = id;
      button.id = `netto-workspace-${id}`;
      button.setAttribute("type", "radio");
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", "netto-tab-viewport");
      button.addEventListener("command", () => onSelect(id));
      button.addEventListener("contextmenu", onContextMenu);
      this.#buttons.set(id, button);
      fragment.appendChild(button);
    }
    this.#container.replaceChildren(fragment);
  }

  update(entries, activeId) {
    if (!this.#container) {
      return;
    }
    for (const entry of entries) {
      const button = this.#buttons.get(entry.id);
      if (!button) {
        continue;
      }
      const active = entry.id == activeId;
      button.classList.toggle("populated", !!entry.populated);
      button.classList.toggle("empty", !entry.populated);
      button.classList.toggle("focused", active);
      button.classList.toggle("active", active);
      button.classList.toggle("selected", active);
      button.classList.toggle("inactive", !active);
      button.setAttribute("aria-selected", String(active));
      button.setAttribute("label", entry.label);
      button.setAttribute("tooltiptext", entry.label);
      if (active) {
        button.setAttribute("checked", "true");
      } else {
        button.removeAttribute("checked");
      }
    }
    this.#container.setAttribute(
      "aria-activedescendant",
      `netto-workspace-${activeId}`
    );
  }
}
