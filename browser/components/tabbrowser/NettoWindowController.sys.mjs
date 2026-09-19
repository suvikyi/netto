/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export function defineWindowController(build) {
  const controllers = new WeakMap();
  return {
    init(window) {
      if (controllers.has(window)) {
        return;
      }
      const controller = build(window);
      controllers.set(window, controller);
      controller.init();
    },

    destroy(window) {
      controllers.get(window)?.destroy();
      controllers.delete(window);
    },
  };
}
