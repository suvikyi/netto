/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const LOG_PREF = "browser.netto.scrolling.log";

function enabled() {
  return Services.prefs.getBoolPref(LOG_PREF, false);
}

export function nettoDebugTab(tab) {
  if (!tab) {
    return null;
  }
  return {
    position: tab._tPos,
    panel: tab.linkedPanel || null,
  };
}

export function nettoDebugLog(event, details = {}) {
  if (!enabled()) {
    return;
  }
  if (typeof details == "function") {
    details = details();
  }
  Services.console.logStringMessage(
    `[Netto] ${event} ${JSON.stringify({ time: Date.now(), ...details })}`
  );
}
