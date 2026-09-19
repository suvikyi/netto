/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

ChromeUtils.defineESModuleGetters(this, {
  AboutNewTab: "resource:///modules/AboutNewTab.sys.mjs",
  NewTabUtils: "resource://gre/modules/NewTabUtils.sys.mjs",
});

const {
  getCameraMaxOffset,
  getCameraTargetOffset,
  getPaneMetrics,
  getPaneRatioBounds,
  getVisiblePaneIndices,
} = ChromeUtils.importESModule(
  "moz-src:///browser/components/tabbrowser/NettoTabGeometry.sys.mjs"
);

async function waitForNettoLayout() {
  await new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );
}

add_task(function test_netto_geometry_model() {
  const bounds = getPaneRatioBounds(1000);
  Assert.greaterOrEqual(
    bounds.min,
    0.2,
    "The ratio minimum is never below 20%"
  );
  Assert.equal(bounds.max, 1, "The ratio maximum is 100%");

  const single = getPaneMetrics({
    tabCount: 1,
    selectedIndex: 0,
    viewportWidth: 1000,
    getRatio: () => 0.5,
  });
  Assert.deepEqual(
    single,
    { focusedWidth: 1000, widths: [1000], offsets: [0], total: 1000 },
    "A single tab fills the viewport"
  );

  const metrics = getPaneMetrics({
    tabCount: 3,
    selectedIndex: 1,
    viewportWidth: 1000,
    getRatio: index => [0.1, 0.5, 0.8][index],
  });
  Assert.equal(metrics.widths[0], 240, "Panes obey the minimum width");
  Assert.equal(metrics.offsets[1], 241, "Offsets include the pane gap");
  Assert.greater(metrics.total, 1000, "Multiple panes extend the track");
  Assert.equal(
    getCameraTargetOffset({
      metrics,
      viewportWidth: 1000,
      targetIndex: 2,
      currentOffset: 0,
    }),
    Math.min(
      getCameraMaxOffset(metrics, 1000),
      metrics.offsets[2] + metrics.widths[2] - 1000
    ),
    "The camera fits a pane outside the viewport with minimal movement"
  );
  Assert.equal(
    getCameraMaxOffset(metrics, 1000),
    metrics.total - 1000,
    "The camera maximum is derived from track width"
  );

  const underfilled = getPaneMetrics({
    tabCount: 3,
    selectedIndex: 2,
    viewportWidth: 1000,
    getRatio: index => [0.2, 0.2, 0.5][index],
  });
  Assert.equal(
    underfilled.total,
    1000,
    "Underfilled panes use the viewport width"
  );
  Assert.deepEqual(
    getVisiblePaneIndices({
      metrics: underfilled,
      viewportWidth: 1000,
      cameraOffset: 0,
    }),
    [0, 1, 2],
    "Every pane remains visible when the track does not fill the viewport"
  );
  Assert.deepEqual(
    getVisiblePaneIndices({
      metrics,
      viewportWidth: 1000,
      cameraOffset: 0,
      cameraEndOffset: getCameraMaxOffset(metrics, 1000),
    }),
    [0, 1, 2],
    "A camera transition retains panes across its swept range"
  );
});

add_task(async function test_netto_swap_direction_commands() {
  await TestUtils.waitForCondition(
    () => gBrowser.nettoTabTrack?.getSnapshot().active,
    "Wait for Netto scrolling to become active"
  );

  const tabs = [];
  try {
    for (let index = 0; index < 3; index++) {
      tabs.push(
        await addTab(
          `http://mochi.test:8888/browser/browser/components/tabbrowser/test/browser/tabs/dummy_page.html?swap-${index}`,
          { inBackground: true }
        )
      );
    }
    await BrowserTestUtils.switchTab(gBrowser, tabs[1]);
    const panelOrder = () =>
      gBrowser.tabs
        .filter(tab => tabs.includes(tab))
        .map(tab => tab.linkedPanel);

    document.getElementById("Netto:SwapLeft").doCommand();
    await waitForNettoLayout();
    Assert.deepEqual(
      panelOrder(),
      [tabs[1], tabs[0], tabs[2]].map(tab => tab.linkedPanel),
      "The left swap command moves the selected tab left"
    );
    document.getElementById("Netto:SwapRight").doCommand();
    await waitForNettoLayout();
    Assert.deepEqual(
      panelOrder(),
      tabs.map(tab => tab.linkedPanel),
      "The right swap command moves the selected tab right"
    );

    EventUtils.synthesizeKey("h", { altKey: true, ctrlKey: true }, window);
    await waitForNettoLayout();
    Assert.deepEqual(
      panelOrder(),
      [tabs[1], tabs[0], tabs[2]].map(tab => tab.linkedPanel),
      "Alt+Ctrl+H moves the selected tab left"
    );
    EventUtils.synthesizeKey("l", { altKey: true, ctrlKey: true }, window);
    await waitForNettoLayout();
    Assert.deepEqual(
      panelOrder(),
      tabs.map(tab => tab.linkedPanel),
      "Alt+Ctrl+L moves the selected tab right"
    );
  } finally {
    for (const tab of tabs) {
      if (tab.parentNode) {
        await BrowserTestUtils.removeTab(tab);
      }
    }
  }
});

add_task(async function test_netto_large_resize_presets() {
  await TestUtils.waitForCondition(
    () => gBrowser.nettoTabTrack?.getSnapshot().active,
    "Wait for Netto scrolling to become active"
  );
  await SpecialPowers.pushPrefEnv({
    set: [["browser.netto.defaultPaneRatio", 50]],
  });

  let tab;
  try {
    tab = await addTab(
      "http://mochi.test:8888/browser/browser/components/tabbrowser/test/browser/tabs/dummy_page.html?resize-presets",
      { inBackground: false }
    );
    await waitForNettoLayout();
    const viewportWidth = document
      .getElementById("netto-tab-viewport")
      .getBoundingClientRect().width;
    const minimum = getPaneRatioBounds(viewportWidth).min;
    const assertRatio = (expected, label) =>
      Assert.lessOrEqual(
        Math.abs(gBrowser.nettoTabTrack.getPaneRatio() - expected),
        1e-9,
        label
      );

    assertRatio(0.5, "The large resize test starts at 50%");
    gBrowser.nettoWorkspace.setTabPaneRatio(tab, 0.75);
    gBrowser.nettoTabTrack.resize("down");
    await waitForNettoLayout();
    assertRatio(0.5, "Large resize down snaps an arbitrary ratio to 50%");
    gBrowser.nettoWorkspace.setTabPaneRatio(tab, 0.75);
    gBrowser.nettoTabTrack.resize("up");
    await waitForNettoLayout();
    assertRatio(1, "Large resize up snaps an arbitrary ratio to 100%");
    gBrowser.nettoWorkspace.setTabPaneRatio(tab, 0.5);
    gBrowser.nettoTabTrack.resize("down");
    await waitForNettoLayout();
    assertRatio(minimum, "Large resize down snaps to the minimum");
    gBrowser.nettoTabTrack.resize("up");
    await waitForNettoLayout();
    assertRatio(0.5, "Large resize up snaps from minimum to 50%");
    gBrowser.nettoTabTrack.resize("up");
    await waitForNettoLayout();
    assertRatio(1, "Large resize up snaps from 50% to 100%");
    gBrowser.nettoTabTrack.resize("down");
    await waitForNettoLayout();
    assertRatio(0.5, "Large resize down snaps from 100% to 50%");
    gBrowser.nettoTabTrack.resize("down");
    await waitForNettoLayout();
    assertRatio(minimum, "Large resize down snaps from 50% to the minimum");
  } finally {
    if (tab?.parentNode) {
      await BrowserTestUtils.removeTab(tab);
    }
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_netto_blocks_native_split_view_creation() {
  await TestUtils.waitForCondition(
    () => gBrowser.nettoTabTrack?.getSnapshot().active,
    "Wait for Netto scrolling to become active"
  );

  const firstTab = gBrowser.selectedTab;
  const secondTab = await addTab(
    "http://mochi.test:8888/browser/browser/components/tabbrowser/test/browser/tabs/dummy_page.html?split-view"
  );
  const splitView = gBrowser.addTabSplitView([firstTab, secondTab]);

  Assert.equal(splitView, null, "Netto vetoes native Split View creation");
  Assert.ok(
    !firstTab.splitview && !secondTab.splitview,
    "The tabs remain outside a native Split View"
  );

  await BrowserTestUtils.removeTab(secondTab);
});

add_task(async function test_netto_tab_track_layout_and_residency() {
  const originalTab = gBrowser.selectedTab;
  await BrowserTestUtils.loadURIString({
    browser: originalTab.linkedBrowser,
    uriString:
      "data:text/html,<meta name='viewport' content='width=device-width'><body>initial</body>",
  });
  await waitForNettoLayout();
  const singleTabSnapshot = gBrowser.nettoTabTrack.getSnapshot();
  const singleViewport = document.getElementById("netto-tab-viewport");
  const singlePanel = document.getElementById(originalTab.linkedPanel);
  Assert.equal(
    singleTabSnapshot.paneWidth,
    singleTabSnapshot.viewportWidth,
    "A single tab fills the viewport in the track geometry"
  );
  Assert.equal(
    singlePanel.getBoundingClientRect().width,
    singleViewport.getBoundingClientRect().width,
    "A single tab fills the rendered viewport"
  );
  const singleContainer = singlePanel.querySelector(".browserContainer");
  const singleBrowser = singlePanel.querySelector("browser");
  Assert.equal(
    singleContainer.getBoundingClientRect().width,
    singlePanel.getBoundingClientRect().width,
    "The browser container fills the tab panel"
  );
  Assert.equal(
    singleBrowser.getBoundingClientRect().width,
    singleContainer.getBoundingClientRect().width,
    "The tab content fills the browser container"
  );

  document.getElementById("cmd_newNavigatorTab").doCommand();
  await TestUtils.waitForCondition(
    () => gBrowser.tabs.length == 2,
    "Wait for Ctrl+T-style tab creation"
  );
  await waitForNettoLayout();
  const twoTabSnapshot = gBrowser.nettoTabTrack.getSnapshot();
  const originalAfterNewTab = document.getElementById(originalTab.linkedPanel);
  const originalAfterNewTabContainer =
    originalAfterNewTab.querySelector(".browserContainer");
  const originalAfterNewTabBrowser =
    originalAfterNewTab.querySelector("browser");
  await waitForNettoLayout();
  const originalContentWidthAfterNewTab = await SpecialPowers.spawn(
    originalAfterNewTabBrowser,
    [],
    () => content.innerWidth
  );
  Assert.equal(
    originalContentWidthAfterNewTab,
    Math.round(twoTabSnapshot.paneWidth),
    "The original content viewport resizes with the browser"
  );
  Assert.equal(
    originalAfterNewTab.getBoundingClientRect().width,
    twoTabSnapshot.paneWidth,
    "The original panel resizes when a new tab is opened"
  );
  Assert.equal(
    originalAfterNewTabContainer.getBoundingClientRect().width,
    twoTabSnapshot.paneWidth,
    "The original browser container resizes with the panel"
  );
  Assert.equal(
    originalAfterNewTabBrowser.getBoundingClientRect().width,
    twoTabSnapshot.paneWidth,
    "The original tab content resizes with the browser container"
  );
  ok(
    originalAfterNewTabBrowser.docShellIsActive,
    "The visible adjacent docshell stays active after resizing"
  );
  document.getElementById("Netto:NewTab").doCommand();
  await TestUtils.waitForCondition(
    () => gBrowser.tabs.length == 3,
    "Wait for the Netto command adapter to create a tab"
  );
  await BrowserTestUtils.removeTab(gBrowser.selectedTab);
  await BrowserTestUtils.removeTab(gBrowser.selectedTab);
  await waitForNettoLayout();

  const tabs = [
    await addTab(
      "http://mochi.test:8888/browser/browser/components/tabbrowser/test/browser/tabs/dummy_page.html?one"
    ),
    await addTab(
      "http://mochi.test:8888/browser/browser/components/tabbrowser/test/browser/tabs/dummy_page.html?two"
    ),
    await addTab(
      "http://mochi.test:8888/browser/browser/components/tabbrowser/test/browser/tabs/dummy_page.html?three"
    ),
  ];
  registerCleanupFunction(async () => {
    for (const tab of tabs) {
      if (tab.parentNode) {
        BrowserTestUtils.removeTab(tab);
      }
    }
  });

  await BrowserTestUtils.switchTab(gBrowser, tabs[1]);
  await TestUtils.waitForCondition(
    () => gBrowser.nettoTabTrack.getSnapshot().presentedTab == tabs[1],
    "The selected pane is presented"
  );
  await waitForNettoLayout();

  const viewport = document.getElementById("netto-tab-viewport");
  const track = gBrowser.tabpanels;
  const snapshot = gBrowser.nettoTabTrack.getSnapshot();

  ok(viewport.hasAttribute("netto-scrolling"), "The Netto viewport is active");
  Assert.greater(snapshot.paneWidth, 0, "The pane width was calculated");
  Assert.lessOrEqual(
    Math.abs(snapshot.paneWidth * 2 + 1 - snapshot.viewportWidth),
    1,
    "Multiple tabs use two panes with a single gap"
  );
  Assert.equal(snapshot.presentedTab, tabs[1], "The selected tab is presented");

  for (const tab of tabs) {
    const panel = document.getElementById(tab.linkedPanel);
    if (!panel.classList.contains("netto-live")) {
      continue;
    }
    const container = panel.querySelector(".browserContainer");
    const browser = panel.querySelector("browser");
    Assert.equal(
      panel.getBoundingClientRect().width,
      snapshot.paneWidth,
      "Each live tab panel uses the current pane width"
    );
    Assert.equal(
      container.getBoundingClientRect().width,
      snapshot.paneWidth,
      "Each live browser container follows the pane width"
    );
    Assert.equal(
      browser.getBoundingClientRect().width,
      snapshot.paneWidth,
      "Each live tab content browser follows the pane width"
    );
  }

  for (const tab of [originalTab, ...tabs]) {
    const panel = document.getElementById(tab.linkedPanel);
    Assert.equal(
      panel.parentNode,
      track,
      "The browser panel remains a direct child"
    );
    ok(
      panel.classList.contains("netto-positioned"),
      "The browser panel keeps its track geometry while off-camera"
    );
  }

  const livePanels = track.querySelectorAll(":scope > .netto-live");
  Assert.greaterOrEqual(
    livePanels.length,
    2,
    "The selected pane and visible panes are live"
  );
  Assert.equal(
    track.querySelectorAll(":scope > .netto-focused").length,
    1,
    "Only one pane is focused"
  );
  Assert.equal(
    track.querySelectorAll(":scope > .netto-live.netto-inactive").length,
    livePanels.length - 1,
    "Live non-selected panes are marked inactive"
  );
  const focusedContainer = document
    .getElementById(tabs[1].linkedPanel)
    .querySelector(".browserContainer");
  Assert.notEqual(
    getComputedStyle(focusedContainer, "::after").boxShadow,
    "none",
    "The focused pane has a theme-aware state outline"
  );
  const inactivePanel = document.getElementById(tabs[0].linkedPanel);
  Assert.notEqual(
    getComputedStyle(inactivePanel).pointerEvents,
    "none",
    "The inactive pane accepts pointer input"
  );
  const inactiveContainer = inactivePanel.querySelector(".browserContainer");
  Assert.notEqual(
    getComputedStyle(inactiveContainer, "::after").boxShadow,
    "none",
    "The inactive pane has a theme-aware state outline"
  );
  Assert.equal(
    gBrowser.tabs.filter(tab => tab.selected).length,
    1,
    "Only one tab is selected"
  );

  let frozenTab = null;
  for (const tab of [originalTab, ...tabs]) {
    if (snapshot.liveTabs.includes(tab)) {
      if (tab != gBrowser.selectedTab && tab.linkedBrowser.isRemoteBrowser) {
        ok(
          tab.linkedBrowser.renderLayers && tab.linkedBrowser.docShellIsActive,
          "A live adjacent pane keeps its layers and docshell active"
        );
      }
      continue;
    }
    if (!tab.linkedBrowser.renderLayers) {
      ok(
        !tab.linkedBrowser.docShellIsActive,
        "A released pane remains inactive outside live coverage"
      );
      continue;
    }
    frozenTab ??= tab;
    ok(
      snapshot.frozenTabs.includes(tab),
      "A positioned pane outside live coverage is frozen"
    );
    ok(
      !tab.linkedBrowser.docShellIsActive,
      "A frozen pane keeps layers without an active docshell"
    );
  }

  if (frozenTab) {
    await BrowserTestUtils.loadURIString({
      browser: frozenTab.linkedBrowser,
      uriString:
        "http://mochi.test:8888/browser/browser/components/tabbrowser/test/browser/tabs/dummy_page.html?frozen-navigation",
    });
    await TestUtils.waitForCondition(
      () =>
        frozenTab.linkedBrowser.currentURI.spec.includes("frozen-navigation"),
      "Navigate the frozen pane without selecting it"
    );
    await waitForNettoLayout();
    ok(
      !frozenTab.linkedBrowser.docShellIsActive,
      "A frozen pane returns to an inactive docshell after navigation"
    );
    ok(
      gBrowser.nettoTabTrack.getSnapshot().frozenTabs.includes(frozenTab),
      "Navigation preserves the frozen residency state"
    );

    await BrowserTestUtils.switchTab(gBrowser, frozenTab);
    await TestUtils.waitForCondition(
      () =>
        gBrowser.selectedTab == frozenTab &&
        frozenTab.linkedBrowser.docShellIsActive,
      "Selecting a frozen pane reactivates its docshell"
    );
    ok(
      frozenTab.linkedBrowser.renderLayers,
      "Selecting a frozen pane restores its compositor layers"
    );
    ok(
      !gBrowser.nettoTabTrack.getSnapshot().heldTabs.includes(frozenTab),
      "The selected pane is not retained in the held residency set"
    );
    await BrowserTestUtils.switchTab(gBrowser, tabs[1]);
    await TestUtils.waitForCondition(
      () => gBrowser.nettoTabTrack.getSnapshot().presentedTab == tabs[1],
      "Restore the selected pane after testing frozen activation"
    );
    ok(
      !gBrowser.nettoTabTrack.getSnapshot().heldTabs.includes(tabs[1]),
      "The restored selected pane is not retained in the held residency set"
    );
  }

  const selectedBrowser = tabs[1].linkedBrowser;
  const leftBrowser = tabs[0].linkedBrowser;
  const rightBrowser = tabs[2].linkedBrowser;
  const rightPanel = document.getElementById(tabs[2].linkedPanel);
  ok(selectedBrowser.docShellIsActive, "The selected docshell is active");
  ok(leftBrowser.renderLayers, "The left pane has requested compositor layers");
  ok(!leftBrowser.hasAttribute("primary"), "The left pane is not primary");
  if (rightPanel.classList.contains("netto-live")) {
    ok(
      rightBrowser.renderLayers,
      "The visible right pane has compositor layers"
    );
    ok(!rightBrowser.hasAttribute("primary"), "The right pane is not primary");
  }

  await SpecialPowers.spawn(leftBrowser, [], () => {
    content.document.documentElement.setAttribute("data-netto-clicks", "0");
    content.addEventListener("click", () => {
      const root = content.document.documentElement;
      root.setAttribute(
        "data-netto-clicks",
        String(Number(root.getAttribute("data-netto-clicks")) + 1)
      );
    });
  });
  const viewportBounds = viewport.getBoundingClientRect();
  const inactiveBounds = inactivePanel.getBoundingClientRect();
  const clickX = Math.max(viewportBounds.left + 10, inactiveBounds.left + 50);
  const clickY = viewportBounds.top + viewportBounds.height / 2;
  EventUtils.synthesizeMouseAtPoint(clickX, clickY, {}, window);
  await TestUtils.waitForCondition(
    () => gBrowser.selectedTab == tabs[0],
    "Clicking an inactive pane focuses its tab"
  );
  let forwardedClicks;
  await TestUtils.waitForCondition(async () => {
    forwardedClicks = await SpecialPowers.spawn(leftBrowser, [], () =>
      content.document.documentElement.getAttribute("data-netto-clicks")
    );
    return forwardedClicks == "1";
  }, "Wait for the click to reach page content");
  Assert.equal(forwardedClicks, "1", "The click is forwarded to page content");
  await BrowserTestUtils.switchTab(gBrowser, tabs[1]);

  await BrowserTestUtils.switchTab(gBrowser, tabs[2]);
  await TestUtils.waitForCondition(
    () => gBrowser.nettoTabTrack.getSnapshot().cameraAnimating,
    "The next-pane camera animation starts"
  );
  const interruptedCameraOffset =
    gBrowser.nettoTabTrack.getSnapshot().cameraOffset;
  await BrowserTestUtils.switchTab(gBrowser, tabs[1]);
  await TestUtils.waitForCondition(
    () =>
      !gBrowser.nettoTabTrack.getSnapshot().cameraAnimating &&
      gBrowser.nettoTabTrack.getSnapshot().presentedTab == tabs[1],
    "The superseded camera animation settles at the latest selection"
  );
  Assert.notEqual(
    interruptedCameraOffset,
    gBrowser.nettoTabTrack.getSnapshot().cameraTarget,
    "The camera state observes the in-flight visual offset"
  );
  await BrowserTestUtils.switchTab(gBrowser, tabs[2]);
  await TestUtils.waitForCondition(
    () => gBrowser.nettoTabTrack.getSnapshot().presentedTab == tabs[2],
    "Present the camera target after supersession"
  );
  const rightCameraOffset = gBrowser.nettoTabTrack.getSnapshot().cameraOffset;
  Assert.greater(
    rightCameraOffset,
    snapshot.cameraOffset,
    "Selecting the next pane advances the camera"
  );

  const fullyVisibleNeighbor = document.getElementById(tabs[1].linkedPanel);
  const fullyVisibleBounds = fullyVisibleNeighbor.getBoundingClientRect();
  EventUtils.synthesizeMouseAtPoint(
    fullyVisibleBounds.left + fullyVisibleBounds.width / 2,
    viewport.getBoundingClientRect().top +
      viewport.getBoundingClientRect().height / 2,
    {},
    window
  );
  await TestUtils.waitForCondition(
    () => gBrowser.selectedTab == tabs[1],
    "Clicking a fully visible pane focuses its tab"
  );
  Assert.equal(
    gBrowser.nettoTabTrack.getSnapshot().cameraOffset,
    rightCameraOffset,
    "Focusing a fully visible pane does not scroll the camera"
  );
  await BrowserTestUtils.switchTab(gBrowser, tabs[2]);

  document.getElementById("Netto:FocusLeft").doCommand();
  await TestUtils.waitForCondition(
    () => gBrowser.selectedTab == tabs[1],
    "The browser-level focus-left command selects the visual neighbor"
  );
  document.getElementById("Netto:FocusRight").doCommand();
  await TestUtils.waitForCondition(
    () => gBrowser.selectedTab == tabs[2],
    "The browser-level focus-right command restores the focused pane"
  );

  const equalPaneWidth = gBrowser.nettoTabTrack.getSnapshot().paneWidth;
  const cameraTransformBeforeResize = getComputedStyle(track).transform;
  const cssResizeExpected = !matchMedia("(prefers-reduced-motion: reduce)")
    .matches;
  gBrowser.nettoTabTrack.resize("right");
  await TestUtils.waitForCondition(
    () => gBrowser.nettoTabTrack.getSnapshot().paneWidth > equalPaneWidth,
    "Wait for the live resize to commit"
  );
  const resizeCommittedSnapshot = gBrowser.nettoTabTrack.getSnapshot();
  is(
    track.hasAttribute("netto-resizing"),
    cssResizeExpected,
    "Resizing starts a CSS geometry transition when motion is enabled"
  );
  Assert.equal(
    resizeCommittedSnapshot.cameraAnimating,
    false,
    "Resize does not start a live camera animation"
  );
  Assert.equal(
    resizeCommittedSnapshot.cameraTarget,
    resizeCommittedSnapshot.cameraOffset,
    "Resize commits the final camera before the CSS transition"
  );
  const resizeFocusedPanel = document.getElementById(tabs[2].linkedPanel);
  if (cssResizeExpected) {
    ok(
      getComputedStyle(resizeFocusedPanel).transitionProperty.includes("width"),
      "The focused pane uses a CSS width transition"
    );
  }
  await TestUtils.waitForCondition(
    () => !track.hasAttribute("netto-resizing"),
    "The CSS resize transition settles"
  );
  Assert.notEqual(
    getComputedStyle(track).transform,
    cameraTransformBeforeResize,
    "Resizing the end pane commits the camera with the pane geometry before animation"
  );
  const resizeViewportRight = viewport.getBoundingClientRect().right;
  Assert.lessOrEqual(
    Math.abs(
      resizeFocusedPanel.getBoundingClientRect().right - resizeViewportRight
    ),
    2,
    "The end pane is anchored to the viewport after the CSS transition"
  );
  await TestUtils.waitForCondition(
    () =>
      gBrowser.nettoTabTrack.getSnapshot().paneWidth > equalPaneWidth &&
      Math.abs(
        document.getElementById(tabs[2].linkedPanel).getBoundingClientRect()
          .width - gBrowser.nettoTabTrack.getSnapshot().paneWidth
      ) < 1,
    "Wait for the final pane geometry"
  );
  const resizedSnapshot = gBrowser.nettoTabTrack.getSnapshot();
  Assert.greater(
    resizedSnapshot.paneWidth,
    equalPaneWidth,
    "Resizing right grows the focused pane"
  );
  const resizedFocusedPanel = document
    .getElementById(tabs[2].linkedPanel)
    .getBoundingClientRect();
  const resizedNeighborPanel = document
    .getElementById(tabs[1].linkedPanel)
    .getBoundingClientRect();
  Assert.lessOrEqual(
    Math.abs(resizedFocusedPanel.width - resizedSnapshot.paneWidth),
    0.25,
    "The focused pane uses the committed resized width"
  );
  Assert.less(
    resizedNeighborPanel.width,
    resizedFocusedPanel.width,
    "The neighboring pane gives space to the focused pane"
  );
  if (cssResizeExpected) {
    gBrowser.nettoTabTrack.resize("left");
    await TestUtils.waitForCondition(
      () => track.hasAttribute("netto-resizing"),
      "A reverse resize starts a CSS geometry transition"
    );
    Assert.equal(
      gBrowser.nettoTabTrack.getSnapshot().cameraAnimating,
      false,
      "A reverse resize does not start a live camera animation"
    );
    await new Promise(resolve => requestAnimationFrame(resolve));
    gBrowser.nettoTabTrack.resize("right");
    await TestUtils.waitForCondition(
      () => track.hasAttribute("netto-resizing"),
      "A rapid resize retargets the CSS geometry transition"
    );
    const retargetedResize = gBrowser.nettoTabTrack.getSnapshot();
    Assert.equal(
      retargetedResize.cameraTarget,
      retargetedResize.cameraOffset,
      "Rapid resize commits the latest camera endpoint"
    );
    Assert.equal(
      retargetedResize.cameraAnimating,
      false,
      "Rapid resize retargeting keeps the live camera settled"
    );
    await TestUtils.waitForCondition(
      () => !track.hasAttribute("netto-resizing"),
      "The retargeted CSS resize transition settles"
    );
  }

  await SpecialPowers.spawn(rightBrowser, [], () => {
    content.document.documentElement.setAttribute(
      "data-netto-resize-clicks",
      "0"
    );
    content.addEventListener("click", () => {
      const root = content.document.documentElement;
      root.setAttribute(
        "data-netto-resize-clicks",
        String(Number(root.getAttribute("data-netto-resize-clicks")) + 1)
      );
    });
  });
  const resizedClickBounds = resizedFocusedPanel;
  EventUtils.synthesizeMouseAtPoint(
    resizedClickBounds.left + resizedClickBounds.width / 2,
    viewport.getBoundingClientRect().top +
      viewport.getBoundingClientRect().height / 2,
    {},
    window
  );
  await TestUtils.waitForCondition(async () => {
    const clicks = await SpecialPowers.spawn(rightBrowser, [], () =>
      content.document.documentElement.getAttribute("data-netto-resize-clicks")
    );
    return clicks == "1";
  }, "Wait for input after resizing");

  document.getElementById("Netto:ResizeUp").doCommand();
  await TestUtils.waitForCondition(
    () =>
      gBrowser.nettoTabTrack.getSnapshot().paneWidth >
      gBrowser.nettoTabTrack.getSnapshot().viewportWidth * 0.65,
    "The resize-up command performs a large increase"
  );
  document.getElementById("Netto:ResizeDown").doCommand();
  await TestUtils.waitForCondition(
    () =>
      gBrowser.nettoTabTrack.getSnapshot().paneWidth <
      gBrowser.nettoTabTrack.getSnapshot().viewportWidth * 0.65,
    "The first resize-down command reduces the pane"
  );
  document.getElementById("Netto:ResizeDown").doCommand();
  await TestUtils.waitForCondition(
    () =>
      gBrowser.nettoTabTrack.getSnapshot().paneWidth <
      gBrowser.nettoTabTrack.getSnapshot().viewportWidth * 0.4,
    "The resize-down command performs a large decrease"
  );

  const beforeBurst = gBrowser.nettoTabTrack.getSnapshot();
  const expectedWidth =
    beforeBurst.paneWidth + (beforeBurst.viewportWidth - 1) * 0.1;
  gBrowser.nettoTabTrack.resize("right");
  gBrowser.nettoTabTrack.resize("right");
  await TestUtils.waitForCondition(
    () =>
      Math.abs(gBrowser.nettoTabTrack.getSnapshot().paneWidth - expectedWidth) <
      1,
    "Both rapid increments accumulate into the final target"
  );
  Assert.less(
    Math.abs(gBrowser.nettoTabTrack.getSnapshot().paneWidth - expectedWidth),
    1,
    "Rapid increments are coalesced into the live final geometry"
  );

  await BrowserTestUtils.switchTab(gBrowser, tabs[1]);
  await TestUtils.waitForCondition(
    () => gBrowser.nettoTabTrack.getSnapshot().presentedTab == tabs[1],
    "Present the first full-width tab"
  );
  document.getElementById("Netto:ResizeUp").doCommand();
  await TestUtils.waitForCondition(
    () =>
      document.getElementById(tabs[1].linkedPanel).getBoundingClientRect()
        .width >
      gBrowser.nettoTabTrack.getSnapshot().viewportWidth * 0.9,
    "Grow the first tab to full width"
  );

  await BrowserTestUtils.switchTab(gBrowser, tabs[2]);
  await TestUtils.waitForCondition(
    () => gBrowser.nettoTabTrack.getSnapshot().presentedTab == tabs[2],
    "Present the second full-width tab"
  );
  document.getElementById("Netto:ResizeUp").doCommand();
  document.getElementById("Netto:ResizeUp").doCommand();
  await TestUtils.waitForCondition(
    () =>
      document.getElementById(tabs[2].linkedPanel).getBoundingClientRect()
        .width >
      gBrowser.nettoTabTrack.getSnapshot().viewportWidth * 0.9,
    "Grow the second tab to full width"
  );
  await BrowserTestUtils.switchTab(gBrowser, tabs[1]);
  await TestUtils.waitForCondition(
    () => gBrowser.nettoTabTrack.getSnapshot().presentedTab == tabs[1],
    "Present the middle tab before resizing it"
  );
  const middlePanel = document.getElementById(tabs[1].linkedPanel);
  const resizeViewport = viewport.getBoundingClientRect();
  Assert.greater(
    middlePanel.getBoundingClientRect().width,
    gBrowser.nettoTabTrack.getSnapshot().viewportWidth * 0.9,
    "The first tab retains its full width after focus changes"
  );

  document.getElementById("Netto:ResizeLeft").doCommand();
  await TestUtils.waitForCondition(
    () =>
      middlePanel.getBoundingClientRect().width <
      gBrowser.nettoTabTrack.getSnapshot().viewportWidth,
    "Shrink the full-width middle tab"
  );
  const afterShrink = middlePanel.getBoundingClientRect();
  ok(
    afterShrink.right > resizeViewport.left &&
      afterShrink.left < resizeViewport.right,
    "Shrinking a full-width middle tab keeps it in view"
  );

  document.getElementById("Netto:ResizeRight").doCommand();
  await TestUtils.waitForCondition(() => {
    const rect = middlePanel.getBoundingClientRect();
    return (
      rect.width > gBrowser.nettoTabTrack.getSnapshot().viewportWidth * 0.9 &&
      rect.right > resizeViewport.left &&
      rect.left < resizeViewport.right
    );
  }, "Grow the middle tab back to full width and refocus it");
  const afterRegrow = middlePanel.getBoundingClientRect();
  ok(
    afterRegrow.right > resizeViewport.left &&
      afterRegrow.left < resizeViewport.right,
    "Regrowing a full-width middle tab refocuses it"
  );
});

add_task(async function test_netto_newtab_tiles_open() {
  let tileURL =
    "http://mochi.test:8888/browser/browser/components/tabbrowser/test/browser/tabs/dummy_page.html?netto-top-site";
  let tile = { url: tileURL, title: "Netto top site" };
  NewTabUtils.pinnedLinks.pin(tile, 0);
  await SpecialPowers.pushPrefEnv({
    set: [["browser.newtabpage.activity-stream.feeds.system.topsites", false]],
  });
  await SpecialPowers.pushPrefEnv({
    set: [["browser.newtabpage.activity-stream.feeds.system.topsites", true]],
  });
  await TestUtils.waitForCondition(
    () => AboutNewTab.getTopSites()?.[0]?.url == tileURL,
    "Wait for the Netto test top site to be available"
  );

  let tabs = [];
  try {
    for (let index = 0; index < 3; index++) {
      let tab = BrowserTestUtils.addTab(gBrowser, BROWSER_NEW_TAB_URL);
      tabs.push(tab);
      await BrowserTestUtils.switchTab(gBrowser, tab);
      await waitForNettoLayout();

      Assert.equal(
        tab.linkedBrowser.currentURI.spec,
        BROWSER_NEW_TAB_URL,
        `New tab ${index + 1} navigates to the default new-tab URL`
      );
      Assert.ok(
        tab.linkedBrowser.docShellIsActive,
        `New tab ${index + 1} has an active docshell`
      );
      Assert.ok(
        tab.linkedBrowser.renderLayers,
        `New tab ${index + 1} renders layers`
      );
      Assert.ok(
        tab.linkedBrowser.hasLayers,
        `New tab ${index + 1} has compositor layers`
      );
      await TestUtils.waitForCondition(
        async () =>
          (await SpecialPowers.spawn(
            tab.linkedBrowser,
            [],
            () => content.document.readyState
          )) == "complete",
        `New tab ${index + 1} finishes loading`
      );
      await SpecialPowers.spawn(tab.linkedBrowser, [tileURL], async url => {
        await ContentTaskUtils.waitForCondition(
          () =>
            content.document.querySelector(`.top-site-button[href="${url}"]`),
          "Wait for the test top site to render"
        );
      });

      let tileBounds = await SpecialPowers.spawn(tab.linkedBrowser, [], () => {
        let bounds = content.document
          .querySelector(".top-site-button")
          .getBoundingClientRect();
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        };
      });
      let browserBounds = tab.linkedBrowser.getBoundingClientRect();
      let loadPromise = BrowserTestUtils.browserLoaded(
        tab.linkedBrowser,
        false,
        tileURL
      );
      EventUtils.synthesizeMouseAtPoint(
        browserBounds.left + tileBounds.x + tileBounds.width / 2,
        browserBounds.top + tileBounds.y + tileBounds.height / 2,
        {},
        window
      );
      await loadPromise;
      Assert.equal(
        tab.linkedBrowser.currentURI.spec,
        tileURL,
        `Clicking the top-site tile navigates new tab ${index + 1}`
      );
    }
  } finally {
    for (let tab of tabs) {
      if (tab.parentNode) {
        gBrowser.removeTab(tab);
      }
    }
    NewTabUtils.pinnedLinks.unpin(tile);
    await SpecialPowers.popPrefEnv();
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_netto_newtab_commands_mount() {
  let tabs = [];
  await SpecialPowers.pushPrefEnv({
    set: [["browser.newtab.preload", false]],
  });
  NewTabPagePreloading.removePreloadedBrowser(window);
  try {
    for (let index = 0; index < 3; index++) {
      let opened = BrowserTestUtils.waitForEvent(
        gBrowser.tabContainer,
        "TabOpen"
      );
      BrowserCommands.openTab();
      tabs.push((await opened).target);
    }
    await waitForNettoLayout();
    for (let index = 0; index < tabs.length; index++) {
      let tab = tabs[index];
      await TestUtils.waitForCondition(
        () => tab.linkedBrowser.currentURI.spec == BROWSER_NEW_TAB_URL,
        `Rapid new tab ${index + 1} receives the new-tab URL`
      );
      await BrowserTestUtils.switchTab(gBrowser, tab);
      await waitForNettoLayout();
      await TestUtils.waitForCondition(
        async () =>
          await SpecialPowers.spawn(
            tab.linkedBrowser,
            [],
            () => content.document.getElementById("root")?.childElementCount > 0
          ),
        `Rapid new tab ${index + 1} mounts Activity Stream`
      );
      await TestUtils.waitForCondition(
        async () =>
          (await SpecialPowers.spawn(
            tab.linkedBrowser,
            [],
            () => content.document.readyState
          )) == "complete",
        `Rapid new tab ${index + 1} finishes loading`
      );
    }
  } finally {
    for (let tab of tabs) {
      if (tab.parentNode) {
        gBrowser.removeTab(tab);
      }
    }
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_netto_newtab_tile_inactive_click() {
  let tileURL =
    "http://mochi.test:8888/browser/browser/components/tabbrowser/test/browser/tabs/dummy_page.html?netto-inactive-top-site";
  let tile = { url: tileURL, title: "Netto inactive top site" };
  NewTabUtils.pinnedLinks.pin(tile, 0);
  await SpecialPowers.pushPrefEnv({
    set: [["browser.newtabpage.activity-stream.feeds.system.topsites", false]],
  });
  await SpecialPowers.pushPrefEnv({
    set: [["browser.newtabpage.activity-stream.feeds.system.topsites", true]],
  });
  await TestUtils.waitForCondition(
    () => AboutNewTab.getTopSites()?.[0]?.url == tileURL,
    "Wait for the inactive-click test top site to be available"
  );

  let tabs = [];
  try {
    for (let index = 0; index < 3; index++) {
      let tab = BrowserTestUtils.addTab(gBrowser, BROWSER_NEW_TAB_URL);
      tabs.push(tab);
      await BrowserTestUtils.switchTab(gBrowser, tab);
      await waitForNettoLayout();
      await SpecialPowers.spawn(tab.linkedBrowser, [tileURL], async url => {
        await ContentTaskUtils.waitForCondition(
          () =>
            content.document.querySelector(`.top-site-button[href="${url}"]`),
          "Wait for the test top site to render"
        );
      });
    }

    let tileBounds = await SpecialPowers.spawn(
      tabs[2].linkedBrowser,
      [],
      () => {
        let bounds = content.document
          .querySelector(".top-site-button")
          .getBoundingClientRect();
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        };
      }
    );
    await BrowserTestUtils.switchTab(gBrowser, tabs[1]);
    await waitForNettoLayout();
    let targetBrowser = tabs[2].linkedBrowser;
    let browserBounds = targetBrowser.getBoundingClientRect();
    let loadPromise = BrowserTestUtils.browserLoaded(
      targetBrowser,
      false,
      tileURL
    );
    EventUtils.synthesizeMouseAtPoint(
      browserBounds.left + tileBounds.x + tileBounds.width / 2,
      browserBounds.top + tileBounds.y + tileBounds.height / 2,
      {},
      window
    );
    await loadPromise;
    Assert.equal(
      gBrowser.selectedTab,
      tabs[2],
      "Clicking an inactive new-tab tile focuses its tab"
    );
    Assert.equal(
      targetBrowser.currentURI.spec,
      tileURL,
      "Clicking an inactive new-tab tile navigates it"
    );
  } finally {
    for (let tab of tabs) {
      if (tab.parentNode) {
        gBrowser.removeTab(tab);
      }
    }
    NewTabUtils.pinnedLinks.unpin(tile);
    await SpecialPowers.popPrefEnv();
    await SpecialPowers.popPrefEnv();
  }
});

add_task(
  async function test_netto_camera_retarget_settles_on_latest_selection() {
    await TestUtils.waitForCondition(
      () => gBrowser.nettoTabTrack?.getSnapshot().active,
      "Wait for Netto scrolling to become active"
    );

    const firstTab = gBrowser.selectedTab;
    const secondTab = await addTab(
      "http://mochi.test:8888/browser/browser/components/tabbrowser/test/browser/tabs/dummy_page.html?retarget"
    );
    try {
      await waitForNettoLayout();
      gBrowser.selectedTab = firstTab;
      await TestUtils.waitForCondition(
        () => !gBrowser.nettoTabTrack.getSnapshot().cameraAnimating,
        "Camera animation settled after retarget"
      );
      await waitForNettoLayout();
      const snapshot = gBrowser.nettoTabTrack.getSnapshot();
      Assert.equal(
        snapshot.presentedTab,
        firstTab,
        "Retargeted camera presents the latest selected tab"
      );
      Assert.equal(
        snapshot.cameraOffset,
        snapshot.cameraTarget,
        "Retargeted camera converged on its target"
      );
    } finally {
      await BrowserTestUtils.removeTab(secondTab);
    }
  }
);
