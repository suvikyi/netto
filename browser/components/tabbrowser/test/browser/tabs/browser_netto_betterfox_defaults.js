/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

const BETTERFOX_VERSION = "browser.netto.betterfox.version";

const expectedDefaults = [
  [BETTERFOX_VERSION, "154.0"],
  ["browser.netto.dev.cssHotReload", false],
  ["gfx.content.skia-font-cache-size", 20],
  ["content.notify.interval", 100000],
  ["gfx.canvas.accelerated.cache-size", 512],
  ["media.cache_readahead_limit", 3600],
  ["media.cache_resume_threshold", 1800],
  ["image.mem.decode_bytes_at_a_time", 32768],
  ["network.buffer.cache.size", 65535],
  ["network.buffer.cache.count", 48],
  ["network.http.max-connections", 1800],
  ["network.http.max-persistent-connections-per-server", 10],
  ["network.http.max-urgent-start-excessive-connections-per-host", 5],
  ["network.http.request.max-start-delay", 5],
  ["network.dnsCacheExpiration", 3600],
  ["browser.download.start_downloads_in_tmp_dir", true],
  ["privacy.globalprivacycontrol.enabled", true],
  ["security.ssl.treat_unsafe_negotiation_as_broken", true],
  ["security.tls.enable_0rtt_data", false],
  ["browser.urlbar.scotchBonnet.enableOverride", false],
  ["browser.urlbar.trimHttps", false],
  ["browser.urlbar.untrimOnUserInteraction.featureGate", true],
  ["browser.urlbar.groupLabels.enabled", false],
  ["browser.newtabpage.activity-stream.showSponsoredTopSites", false],
  ["browser.newtabpage.activity-stream.showSponsored", false],
  ["browser.newtabpage.activity-stream.feeds.section.topstories", false],
  ["browser.download.manager.addToRecentDocs", false],
  ["browser.download.open_pdf_attachments_inline", true],
  ["browser.bookmarks.openInTabClosesMenu", false],
  ["findbar.highlightAll", true],
  ["datareporting.policy.dataSubmissionEnabled", false],
  ["datareporting.healthreport.uploadEnabled", false],
  ["datareporting.usage.uploadEnabled", false],
  ["toolkit.telemetry.unified", false],
  ["toolkit.telemetry.enabled", false],
  ["toolkit.telemetry.server", "data:,"],
  ["toolkit.telemetry.archive.enabled", false],
  ["toolkit.telemetry.newProfilePing.enabled", false],
  ["toolkit.telemetry.shutdownPingSender.enabled", false],
  ["toolkit.telemetry.updatePing.enabled", false],
  ["toolkit.telemetry.bhrPing.enabled", false],
  ["toolkit.telemetry.firstShutdownPing.enabled", false],
  ["toolkit.coverage.opt-out", true],
  ["toolkit.coverage.endpoint.base", ""],
  ["browser.newtabpage.activity-stream.feeds.telemetry", false],
  ["browser.newtabpage.activity-stream.telemetry", false],
  ["app.shield.optoutstudies.enabled", false],
  ["app.normandy.enabled", false],
  ["app.normandy.api_url", ""],
];

function readPref(branch, name, value) {
  if (typeof value == "boolean") {
    return branch.getBoolPref(name);
  }
  if (typeof value == "number") {
    return branch.getIntPref(name);
  }
  return branch.getStringPref(name);
}

add_task(function test_netto_betterfox_defaults() {
  const defaults = Services.prefs.getDefaultBranch("");
  for (const [name, expected] of expectedDefaults) {
    if (name == "toolkit.telemetry.enabled" && Cu.isInAutomation) {
      // The automation harness forces telemetry on at runtime. The packaged
      // product default is false; see netto-betterfox.js.
      continue;
    }
    Assert.equal(
      readPref(defaults, name, expected),
      expected,
      `${name} has the imported Netto default`
    );
  }
});

add_task(function test_netto_betterfox_existing_user_js_precedence() {
  const name = "browser.urlbar.trimHttps";
  const defaults = Services.prefs.getDefaultBranch("");
  const defaultValue = defaults.getBoolPref(name);
  const hadUserValue = Services.prefs.prefHasUserValue(name);
  const originalValue = hadUserValue ? Services.prefs.getBoolPref(name) : null;

  try {
    Services.prefs.setBoolPref(name, !defaultValue);
    is(
      Services.prefs.getBoolPref(name),
      !defaultValue,
      "An existing profile/user.js value overrides the application default"
    );
    is(
      defaults.getBoolPref(name),
      defaultValue,
      "A profile/user.js value does not mutate the application default"
    );
  } finally {
    if (hadUserValue) {
      Services.prefs.setBoolPref(name, originalValue);
    } else {
      Services.prefs.clearUserPref(name);
    }
  }
});

add_task(function test_netto_betterfox_locked_policy_precedence() {
  const name = "privacy.globalprivacycontrol.enabled";
  const defaults = Services.prefs.getDefaultBranch("");
  const defaultValue = defaults.getBoolPref(name);
  const wasLocked = Services.prefs.prefIsLocked(name);
  if (wasLocked) {
    return;
  }
  const hadUserValue = Services.prefs.prefHasUserValue(name);
  const originalValue = hadUserValue ? Services.prefs.getBoolPref(name) : null;

  Services.prefs.clearUserPref(name);
  Services.prefs.lockPref(name);
  try {
    Assert.ok(Services.prefs.prefIsLocked(name), "The policy lock is applied");
    try {
      Services.prefs.setBoolPref(name, !defaultValue);
    } catch (error) {}
    is(
      Services.prefs.getBoolPref(name),
      defaultValue,
      "A locked policy value remains authoritative over the default"
    );
  } finally {
    Services.prefs.unlockPref(name);
    if (hadUserValue) {
      Services.prefs.setBoolPref(name, originalValue);
    } else {
      Services.prefs.clearUserPref(name);
    }
  }
});
