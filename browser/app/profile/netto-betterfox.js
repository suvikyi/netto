// Betterfox 154.0, adapted for Netto application defaults.
// Source: https://github.com/yokoffing/Betterfox/tree/067172a4b0dc90e78e5b8b94d9abfe6430c6a7be
// These are default preferences, not user.js overrides. Explicit profile and
// policy values remain authoritative.

pref("browser.netto.betterfox.version", "154.0");
pref("browser.netto.dev.cssHotReload", false);

// Fastfox: bounded cache and rendering defaults.
pref("gfx.content.skia-font-cache-size", 20);
pref("content.notify.interval", 100000);
pref("gfx.canvas.accelerated.cache-size", 512);
pref("media.cache_readahead_limit", 3600);
pref("media.cache_resume_threshold", 1800);
pref("image.mem.decode_bytes_at_a_time", 32768);
pref("network.buffer.cache.size", 65535);
pref("network.buffer.cache.count", 48);
pref("network.http.max-connections", 1800);
pref("network.http.max-persistent-connections-per-server", 10);
pref("network.http.max-urgent-start-excessive-connections-per-host", 5);
pref("network.http.request.max-start-delay", 5);
pref("network.dnsCacheExpiration", 3600);

// Securefox: low-breakage transport and privacy defaults.
pref("browser.download.start_downloads_in_tmp_dir", true);
pref("privacy.globalprivacycontrol.enabled", true);
pref("security.ssl.treat_unsafe_negotiation_as_broken", true);
pref("security.tls.enable_0rtt_data", false);

// Peskyfox: reduce sponsored and nonessential new-tab UI.
// The Scotch Bonnet override forces trimHttps on regardless of the pref
// below, so it must be off for the protocol to stay visible. This also
// returns the other Scotch Bonnet-gated behaviors (one-offs, search-mode
// persistence, keyword restrictions, search terms) to their own prefs.
pref("browser.urlbar.scotchBonnet.enableOverride", false);
pref("browser.urlbar.trimHttps", false);
pref("browser.urlbar.untrimOnUserInteraction.featureGate", true);
pref("browser.urlbar.groupLabels.enabled", false);
pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
pref("browser.newtabpage.activity-stream.showSponsored", false);
pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
pref("browser.download.manager.addToRecentDocs", false);
pref("browser.download.open_pdf_attachments_inline", true);
pref("browser.bookmarks.openInTabClosesMenu", false);
pref("findbar.highlightAll", true);

// Telemetry and studies: no data leaves the browser by default. Crash
// reporting is deliberately left enabled so field crashes stay diagnosable.
pref("datareporting.policy.dataSubmissionEnabled", false);
pref("datareporting.healthreport.uploadEnabled", false);
pref("datareporting.usage.uploadEnabled", false);
pref("toolkit.telemetry.unified", false);
pref("toolkit.telemetry.enabled", false);
pref("toolkit.telemetry.server", "data:,");
pref("toolkit.telemetry.archive.enabled", false);
pref("toolkit.telemetry.newProfilePing.enabled", false);
pref("toolkit.telemetry.shutdownPingSender.enabled", false);
pref("toolkit.telemetry.updatePing.enabled", false);
pref("toolkit.telemetry.bhrPing.enabled", false);
pref("toolkit.telemetry.firstShutdownPing.enabled", false);
pref("toolkit.coverage.opt-out", true);
pref("toolkit.coverage.endpoint.base", "");
pref("browser.newtabpage.activity-stream.feeds.telemetry", false);
pref("browser.newtabpage.activity-stream.telemetry", false);
pref("app.shield.optoutstudies.enabled", false);
pref("app.normandy.enabled", false);
pref("app.normandy.api_url", "");
