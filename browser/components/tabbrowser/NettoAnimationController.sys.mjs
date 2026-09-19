/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getCameraTransform } from "moz-src:///browser/components/tabbrowser/NettoTabGeometry.sys.mjs";
import { nettoDebugLog } from "moz-src:///browser/components/tabbrowser/NettoDebug.sys.mjs";

export const CAMERA_ANIMATION_MS = 180;
export const WORKSPACE_ANIMATION_MS = 300;
export const CAMERA_SETTLE_EPSILON = 0.5;
const ANIMATIONS_ENABLED_PREF = "browser.netto.animations.enabled";
const ANIMATION_EASING = "cubic-bezier(0.2, 0, 0, 1)";

export class NettoAnimationController {
  #window;
  #viewport;
  #track;
  #cameraTarget = 0;
  #presentedTab = null;
  #cameraAnimation = null;
  #workspaceAnimation = null;

  constructor(window, viewport, track) {
    this.#window = window;
    this.#viewport = viewport;
    this.#track = track;
  }

  get cameraTarget() {
    return this.#cameraTarget;
  }

  get presentedTab() {
    return this.#presentedTab;
  }

  get cameraOffset() {
    if (!this.#cameraAnimation) {
      return this.#cameraTarget;
    }
    return this.#getCameraOffset(this.#cameraAnimation);
  }

  get cameraAnimating() {
    return !!this.#cameraAnimation;
  }

  get workspaceAnimating() {
    return !!this.#workspaceAnimation;
  }

  get workspaceDirection() {
    return this.#workspaceAnimation?.direction ?? null;
  }

  get shouldAnimate() {
    return (
      Services.prefs.getBoolPref(ANIMATIONS_ENABLED_PREF, true) &&
      !this.#window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  retarget({ to, selectedTab, animate, onFinish }) {
    if (
      this.#cameraAnimation &&
      Math.abs(to - this.#cameraTarget) <= CAMERA_SETTLE_EPSILON
    ) {
      this.#cameraAnimation.selectedTab = selectedTab;
      return false;
    }
    const from = this.cameraOffset;
    if (
      animate &&
      Math.abs(to - from) > CAMERA_SETTLE_EPSILON &&
      this.#beginCameraAnimation({ from, to, selectedTab, onFinish })
    ) {
      return true;
    }
    this.cancelCamera();
    this.#commitCamera(to, selectedTab);
    return false;
  }

  #commitCamera(offset, selectedTab) {
    this.#cameraTarget = offset;
    this.#presentedTab = selectedTab;
    this.#writeCameraTransform(offset);
  }

  #beginCameraAnimation({ from, to, selectedTab, onFinish }) {
    if (!this.#window || this.#workspaceAnimation || !this.shouldAnimate) {
      return false;
    }
    this.cancelCamera("superseded");
    const isRTL = Services.locale.isAppLocaleRTL;
    const animation = {
      from,
      to,
      selectedTab,
      onFinish,
      player: this.#track.animate(
        [
          { transform: getCameraTransform(from, isRTL) },
          { transform: getCameraTransform(to, isRTL) },
        ],
        {
          duration: CAMERA_ANIMATION_MS,
          easing: ANIMATION_EASING,
          fill: "forwards",
        }
      ),
    };
    this.#cameraAnimation = animation;
    this.#cameraTarget = to;
    this.#track.setAttribute("netto-animating", "true");
    animation.player.finished.then(
      () => {
        if (this.#cameraAnimation == animation) {
          this.#finishCamera(animation);
        }
      },
      () => {}
    );
    return true;
  }

  cancelCamera(reason = "cancelled") {
    const animation = this.#cameraAnimation;
    if (!animation) {
      return null;
    }
    const currentOffset = this.#getCameraOffset(animation);
    const result = {
      type: "camera",
      reason,
      currentOffset,
      targetOffset: animation.to,
      selectedTab: animation.selectedTab,
    };
    this.#cameraAnimation = null;
    this.#cameraTarget = currentOffset;
    animation.player.cancel();
    this.#clearCameraAnimationState();
    this.#writeCameraTransform(currentOffset);
    return result;
  }

  beginWorkspaceTransition({ direction, participants, onFinish }) {
    if (!this.#window || !["previous", "next"].includes(direction)) {
      return false;
    }
    if (this.#workspaceAnimation) {
      this.cancelWorkspace("superseded");
    }
    if (!this.shouldAnimate) {
      onFinish?.({ type: "workspace", reason: "reduced-motion" });
      return false;
    }

    const incomingOffset = direction == "previous" ? "-100%" : "100%";
    const outgoingOffset = direction == "previous" ? "100%" : "-100%";
    nettoDebugLog("workspace-animation-start", {
      direction,
      participantCount: participants.length,
    });
    const animations = participants.map(participant => {
      let from;
      if (!participant.outgoing) {
        from = `0 ${incomingOffset}`;
      } else if (!participant.incoming) {
        from = `0 ${participant.outgoing.y}px`;
      } else {
        from = `${participant.outgoing.inlineOffset - participant.incoming.inlineOffset}px ${participant.outgoing.y}px`;
      }
      const to = participant.incoming ? "0 0" : `0 ${outgoingOffset}`;
      return participant.element.animate(
        [{ translate: from }, { translate: to }],
        {
          duration: WORKSPACE_ANIMATION_MS,
          easing: ANIMATION_EASING,
          fill: "none",
        }
      );
    });
    const animation = { direction, animations, onFinish };
    this.#workspaceAnimation = animation;
    this.#viewport.setAttribute("netto-workspace-transition", "true");
    const finished = animations.map(player => player.finished);
    Promise.all(finished).then(
      () => {
        if (this.#workspaceAnimation == animation) {
          this.#finishWorkspaceTransition(animation);
        }
      },
      () => {}
    );
    return true;
  }

  cancelWorkspace(reason = "cancelled") {
    const animation = this.#workspaceAnimation;
    nettoDebugLog("workspace-animation-cancel", {
      reason,
      direction: animation?.direction ?? null,
    });
    this.#workspaceAnimation = null;
    for (const player of animation?.animations ?? []) {
      player.cancel();
    }
    this.#clearWorkspaceAnimationState();
    animation?.onFinish?.({
      type: "workspace",
      reason,
      direction: animation.direction,
    });
    return animation
      ? {
          type: "workspace",
          reason,
          direction: animation.direction,
        }
      : null;
  }

  #finishWorkspaceTransition(animation) {
    nettoDebugLog("workspace-animation-finish");
    this.#workspaceAnimation = null;
    this.#clearWorkspaceAnimationState();
    animation.onFinish?.({
      type: "workspace",
      reason: "finished",
      direction: animation.direction,
    });
  }

  destroy() {
    this.cancelCamera("destroyed");
    this.cancelWorkspace("destroyed");
    this.#window = null;
  }

  #getCameraOffset(animation) {
    const progress = animation.player.effect.getComputedTiming().progress;
    if (!Number.isFinite(progress)) {
      return animation.from;
    }
    return animation.from + (animation.to - animation.from) * progress;
  }

  #finishCamera(animation) {
    this.#presentedTab = animation.selectedTab;
    animation.onFinish?.({
      type: "camera",
      reason: "finished",
      currentOffset: animation.to,
      targetOffset: animation.to,
      selectedTab: animation.selectedTab,
    });
    this.#cameraAnimation = null;
    this.#clearCameraAnimationState();
    animation.player.cancel();
    this.#writeCameraTransform(animation.to);
  }

  #writeCameraTransform(offset) {
    this.#track.style.setProperty(
      "transform",
      getCameraTransform(offset, Services.locale.isAppLocaleRTL)
    );
  }

  #clearCameraAnimationState() {
    this.#track.removeAttribute("netto-animating");
  }

  #clearWorkspaceAnimationState() {
    this.#viewport.removeAttribute("netto-workspace-transition");
  }
}
