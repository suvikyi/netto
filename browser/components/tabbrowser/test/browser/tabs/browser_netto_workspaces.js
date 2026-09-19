/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

async function waitForNettoLayout() {
  await new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );
}

add_task(async function test_workspace_switching_and_tab_movement() {
  await TestUtils.waitForCondition(
    () => gBrowser.nettoWorkspace?.getSnapshot().workspaces[0].tabCount,
    "Wait for Netto workspace restoration"
  );

  const controller = gBrowser.nettoWorkspace;
  const originalTab = gBrowser.selectedTab;
  const tabCountBeforeSplitView = gBrowser.tabs.length;
  is(
    gBrowser.addTabSplitView([originalTab]),
    null,
    "Netto vetoes native Split View creation"
  );
  is(
    gBrowser.tabs.length,
    tabCountBeforeSplitView,
    "Split View veto leaves the tab strip unchanged"
  );
  await SpecialPowers.pushPrefEnv({
    set: [["browser.tabs.splitView.enabled", true]],
  });
  const tabContextMenu = document.getElementById("tabContextMenu");
  const contextEvent = new Event("");
  originalTab.dispatchEvent(contextEvent);
  const contextMenuShown = BrowserTestUtils.waitForPopupEvent(
    tabContextMenu,
    "shown"
  );
  tabContextMenu.openPopup(
    originalTab,
    "end_after",
    0,
    0,
    true,
    false,
    contextEvent
  );
  await contextMenuShown;
  const splitViewItem = document.getElementById("context_moveTabToSplitView");
  ok(!splitViewItem.hidden, "The native Split View menu item is present");
  ok(splitViewItem.disabled, "Netto disables the native Split View menu item");
  const contextMenuHidden = BrowserTestUtils.waitForPopupEvent(
    tabContextMenu,
    "hidden"
  );
  tabContextMenu.hidePopup();
  await contextMenuHidden;
  is(controller.getSnapshot().activeId, 1, "Workspace one is initially active");
  is(
    document.querySelectorAll(".netto-workspace-indicator").length,
    9,
    "The workspace bar renders nine indicators"
  );
  for (const button of document.querySelectorAll(
    ".netto-workspace-indicator"
  )) {
    is(
      button.getAttribute("aria-controls"),
      "netto-tab-viewport",
      "Workspace indicators identify the controlled content viewport"
    );
  }
  is(
    document.getElementById("netto-workspace-bar").parentNode.id,
    "nav-bar-customization-target",
    "Workspace indicators share the navigation toolbar with the URL bar"
  );
  is(
    document.getElementById("key_selectTab1").getAttribute("modifiers"),
    "accel",
    "The native number binding no longer consumes Alt+1"
  );
  is(
    document.getElementById("netto-workspace1").getAttribute("modifiers"),
    "alt",
    "Alt+1 belongs to Netto workspace selection"
  );
  ok(
    document.getElementById("goBackKb").hasAttribute("disabled"),
    "The native Alt+Left binding is disabled"
  );
  ok(
    document.getElementById("goForwardKb").hasAttribute("disabled"),
    "The native Alt+Right binding is disabled"
  );
  const nettoBindings = [
    ["netto-new-tab", "alt"],
    ["netto-toggle-control-center", "alt"],
    ["netto-consume-zero", "alt"],
    ["netto-focus-left-h", "alt"],
    ["netto-focus-right-l", "alt"],
    ["netto-focus-left-arrow", "alt"],
    ["netto-focus-right-arrow", "alt"],
    ["netto-next-workspace-j", "alt"],
    ["netto-previous-workspace-k", "alt"],
    ["netto-resize-left-h", "alt,shift"],
    ["netto-resize-right-l", "alt,shift"],
    ["netto-resize-up-k", "alt,shift"],
    ["netto-resize-down-j", "alt,shift"],
    ["netto-swap-left-h", "alt,control"],
    ["netto-swap-right-l", "alt,control"],
    ["netto-close-workspace", "alt,shift"],
  ];
  for (const [id, modifiers] of nettoBindings) {
    const key = document.getElementById(id);
    is(key.getAttribute("modifiers"), modifiers, `${id} has its modifiers`);
    ok(key.hasAttribute("reserved"), `${id} is reserved for Netto`);
  }
  ok(
    document
      .getElementById("netto-workspace-1")
      .classList.contains("populated"),
    "The active workspace is populated"
  );
  ok(
    document.getElementById("netto-workspace-1").classList.contains("focused"),
    "The active workspace is focused"
  );
  ok(
    document.getElementById("netto-workspace-2").classList.contains("inactive"),
    "An inactive workspace has the inactive state"
  );

  const secondTab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "https://example.com/"
  );
  is(
    controller.getSnapshot().workspaces[0].tabCount,
    2,
    "New tabs are assigned to the active workspace"
  );
  await waitForNettoLayout();
  const trackSnapshot = gBrowser.nettoTabTrack.getSnapshot();
  const initialViewportWidth = document
    .getElementById("netto-tab-viewport")
    .getBoundingClientRect().width;
  Assert.lessOrEqual(
    Math.abs(trackSnapshot.paneWidth - (initialViewportWidth - 1) * 0.5),
    1,
    "New panes use the fixed 0.5 default"
  );
  const waitForResize = async label => {
    await waitForNettoLayout();
    Assert.greater(
      document
        .getElementById(gBrowser.selectedTab.linkedPanel)
        .getBoundingClientRect().width,
      0,
      `${label} commits live pane geometry`
    );
  };
  const cssResizeExpected =
    Services.prefs.getBoolPref("browser.netto.animations.enabled", true) &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches;
  gBrowser.nettoTabTrack.resize("up");
  await waitForResize("Grow the second tab to full width");
  await BrowserTestUtils.switchTab(gBrowser, originalTab);
  gBrowser.nettoTabTrack.resize("up");
  await waitForResize("Grow the original tab to full width");
  is(
    document
      .getElementById("tabbrowser-tabpanels")
      .hasAttribute("netto-resizing"),
    cssResizeExpected,
    "The first pane resize uses CSS geometry transitions"
  );
  await BrowserTestUtils.switchTab(gBrowser, secondTab);
  const workspaceTrack = gBrowser.tabpanels;
  const workspaceViewport = document.getElementById("netto-tab-viewport");
  const workspaceAnimationExpected = cssResizeExpected;
  gBrowser.nettoTabTrack.resize("left");
  await waitForNettoLayout();
  controller.selectWorkspace(2);
  const assertWorkspaceAnimation = async (direction, label) => {
    await TestUtils.waitForCondition(
      () => gBrowser.nettoTabTrack.getSnapshot().workspaceAnimating,
      `${label} starts`
    );
    is(
      gBrowser.nettoTabTrack.getSnapshot().workspaceAnimating,
      true,
      `${label} is running`
    );
    const paneAnimations = [
      ...document.querySelectorAll(".netto-workspace-transition-pane"),
    ].flatMap(panel =>
      panel
        .getAnimations()
        .filter(candidate =>
          candidate.effect
            ?.getKeyframes()
            .some(keyframe => "translate" in keyframe)
        )
    );
    ok(paneAnimations.length, `${label} has live pane animations`);
    const incomingAnimation = paneAnimations.find(animation => {
      const keyframes = animation.effect.getKeyframes();
      return (
        keyframes[0].translate ==
        `0px ${direction == "next" ? "100%" : "-100%"}`
      );
    });
    const outgoingAnimation = paneAnimations.find(animation => {
      const keyframes = animation.effect.getKeyframes();
      return (
        keyframes[keyframes.length - 1].translate ==
        `0px ${direction == "next" ? "-100%" : "100%"}`
      );
    });
    ok(incomingAnimation, `${label} animates incoming live panes`);
    ok(outgoingAnimation, `${label} animates outgoing live panes`);
    is(
      incomingAnimation.effect.getKeyframes().at(-1).translate,
      "0px",
      `${label} settles incoming panes in the viewport`
    );
    ok(
      /^0px(?: -?\d+(?:\.\d+)?px)?$/.test(
        outgoingAnimation.effect.getKeyframes()[0].translate
      ),
      `${label} starts outgoing panes at their sampled positions`
    );
  };
  if (workspaceAnimationExpected) {
    await assertWorkspaceAnimation("next", "The next workspace animation");
    is(
      gBrowser.nettoTabTrack.getSnapshot().workspaceDirection,
      "next",
      "The next workspace enters from the bottom"
    );
    const transitionPanel = document.getElementById(
      gBrowser.selectedTab.linkedPanel
    );
    const transitionWidth = transitionPanel.getBoundingClientRect().width;
    gBrowser.nettoTabTrack.resize("left");
    await waitForNettoLayout();
    ok(
      !workspaceTrack.hasAttribute("netto-resizing"),
      "Workspace transition cancels the CSS resize transition"
    );
    ok(
      !gBrowser.nettoTabTrack.getSnapshot().cameraAnimating,
      "Resize does not start a competing camera animation during workspace transition"
    );
    Assert.lessOrEqual(
      Math.abs(transitionPanel.getBoundingClientRect().width - transitionWidth),
      0.25,
      "Resize does not replace live workspace participant geometry"
    );
  }
  await TestUtils.waitForCondition(
    () =>
      controller.getSnapshot().activeId == 2 &&
      gBrowser.selectedTab != secondTab &&
      originalTab.hidden &&
      secondTab.hidden &&
      !workspaceViewport.hasAttribute("netto-workspace-transition"),
    "Wait for the second workspace transition to finish"
  );
  await waitForNettoLayout();
  ok(
    !document.querySelector(".netto-workspace-transition-pane"),
    "Transition participant classes are cleared after settling"
  );
  ok(
    originalTab.linkedBrowser.renderLayers &&
      !originalTab.linkedBrowser.docShellIsActive,
    "The previous workspace keeps its compositor path without an active docshell"
  );
  ok(originalTab.hidden, "Tabs in the previous workspace are hidden");
  ok(secondTab.hidden, "All previous workspace tabs are hidden");
  is(
    controller.getSnapshot().workspaces[1].tabCount,
    1,
    "Selecting an empty workspace creates a new tab"
  );

  controller.selectWorkspace(1);
  controller.selectWorkspace(2);
  await TestUtils.waitForCondition(
    () =>
      controller.getSnapshot().activeId == 2 &&
      !workspaceViewport.hasAttribute("netto-workspace-transition"),
    "Retarget the workspace transition from its sampled live positions"
  );
  ok(
    !document.querySelector(".netto-workspace-transition-pane"),
    "Superseded participants are released"
  );

  controller.selectWorkspace(1);
  if (workspaceAnimationExpected) {
    await assertWorkspaceAnimation(
      "previous",
      "The previous workspace animation"
    );
    is(
      gBrowser.nettoTabTrack.getSnapshot().workspaceDirection,
      "previous",
      "The previous workspace enters from the top"
    );
  }
  await TestUtils.waitForCondition(
    () =>
      controller.getSnapshot().activeId == 1 &&
      gBrowser.selectedTab == secondTab &&
      !workspaceViewport.hasAttribute("netto-workspace-transition"),
    "Restore the focused tab when returning to workspace one"
  );
  const viewportWidth = document
    .getElementById("netto-tab-viewport")
    .getBoundingClientRect().width;
  Assert.greater(
    document.getElementById(originalTab.linkedPanel).getBoundingClientRect()
      .width,
    viewportWidth * 0.9,
    "Workspace restore preserves the original tab width"
  );
  Assert.greater(
    document.getElementById(secondTab.linkedPanel).getBoundingClientRect()
      .width,
    viewportWidth * 0.9,
    "Workspace restore preserves the second tab width"
  );
  controller.selectWorkspace(2);
  await TestUtils.waitForCondition(
    () =>
      controller.getSnapshot().activeId == 2 &&
      gBrowser.selectedTab != secondTab &&
      originalTab.hidden &&
      secondTab.hidden,
    "Restore the focused tab when returning to workspace two"
  );

  const movedTab = gBrowser.selectedTab;
  controller.moveSelectedTabTo(1);
  await TestUtils.waitForCondition(
    () =>
      controller.getSnapshot().activeId == 1 &&
      controller.getSnapshot().workspaces[0].tabCount == 3,
    "Wait for a tab to move to workspace one"
  );
  is(
    gBrowser.selectedTab,
    movedTab,
    "Moving a tab follows it to the workspace"
  );
  ok(!movedTab.hidden, "The moved tab is visible");

  controller.previousWorkspace();
  if (workspaceAnimationExpected) {
    await assertWorkspaceAnimation(
      "previous",
      "The previous workspace animation wraps"
    );
    is(
      gBrowser.nettoTabTrack.getSnapshot().workspaceDirection,
      "previous",
      "Wrapping to workspace nine keeps previous direction"
    );
  }
  await TestUtils.waitForCondition(
    () =>
      controller.getSnapshot().activeId == 9 &&
      !workspaceViewport.hasAttribute("netto-workspace-transition"),
    "Wait for the wrapped workspace transition"
  );
  const wrappedTab = gBrowser.selectedTab;
  controller.nextWorkspace();
  if (workspaceAnimationExpected) {
    await assertWorkspaceAnimation(
      "next",
      "The next workspace animation wraps"
    );
    is(
      gBrowser.nettoTabTrack.getSnapshot().workspaceDirection,
      "next",
      "Wrapping to workspace one keeps next direction"
    );
  }
  await TestUtils.waitForCondition(
    () =>
      controller.getSnapshot().activeId == 1 &&
      !workspaceViewport.hasAttribute("netto-workspace-transition"),
    "Wait for the wrapped workspace transition back"
  );
  controller.selectWorkspace(2);
  const emptyWorkspaceTab = gBrowser.selectedTab;
  gBrowser.removeTab(secondTab);
  await TestUtils.waitForCondition(
    () =>
      controller.getSnapshot().activeId == 2 &&
      !workspaceViewport.hasAttribute("netto-workspace-transition") &&
      !document.querySelector(".netto-workspace-transition-pane"),
    "Cancel workspace participants when an outgoing tab closes"
  );
  controller.selectWorkspace(1);
  await TestUtils.waitForCondition(
    () =>
      controller.getSnapshot().activeId == 1 &&
      !workspaceViewport.hasAttribute("netto-workspace-transition"),
    "Restore workspace one before testing a silent tab move"
  );
  const silentlyMovedTab = gBrowser.selectedTab;
  const silentMoveFallback = gBrowser.tabs.find(
    tab => !tab.hidden && tab != silentlyMovedTab && !tab.pinned
  );
  ok(silentMoveFallback, "A silent move has an active-workspace fallback tab");
  const workspaceOneCount = controller.getSnapshot().workspaces[0].tabCount;
  controller.moveSelectedTabTo(2, false);
  await waitForNettoLayout();
  is(
    controller.getSnapshot().activeId,
    1,
    "A silent tab move keeps the current workspace active"
  );
  is(
    gBrowser.selectedTab,
    silentMoveFallback,
    "A silent tab move selects a remaining tab in the active workspace"
  );
  ok(
    silentlyMovedTab.hidden,
    "A silently moved tab is hidden from the active workspace"
  );
  is(
    controller.getSnapshot().workspaces[0].tabCount,
    workspaceOneCount - 1,
    "A silent tab move updates workspace membership"
  );
  for (const tab of new Set([
    wrappedTab,
    movedTab,
    emptyWorkspaceTab,
    silentlyMovedTab,
  ])) {
    if (!tab.closing && tab.linkedBrowser) {
      gBrowser.removeTab(tab);
    }
  }
});

add_task(async function test_netto_closing_active_workspace() {
  const controller = gBrowser.nettoWorkspace;
  const sourceId = controller.getSnapshot().activeId;
  const targetId = sourceId == 1 ? 2 : 1;
  const movedTab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "https://example.com/"
  );
  controller.moveSelectedTabTo(targetId, true);
  await TestUtils.waitForCondition(
    () =>
      controller.getSnapshot().activeId == targetId &&
      gBrowser.selectedTab == movedTab &&
      !document
        .getElementById("netto-tab-viewport")
        .hasAttribute("netto-workspace-transition"),
    "Move a tab into the workspace that will be closed"
  );

  const originalPrompt = Services.prompt;
  Services.prompt = {
    confirm() {
      return true;
    },
    QueryInterface: ChromeUtils.generateQI(["nsIPromptService"]),
  };
  try {
    await controller.closeWorkspace(targetId);
  } finally {
    Services.prompt = originalPrompt;
  }

  await TestUtils.waitForCondition(
    () =>
      controller.getSnapshot().activeId == sourceId &&
      controller.getSnapshot().workspaces[targetId - 1].tabCount == 0,
    "Close the active workspace after selecting its replacement"
  );
  ok(
    !gBrowser.tabs.includes(movedTab),
    "Closing the active workspace removes its tabs after the transition"
  );
});
