// Checks GitHub for a newer published release of the desktop app and, if one
// exists, offers to open the download page on totem-tool.com.
//
// The installers are not replaced in place: the user downloads the new version
// from the website, so this only needs the latest release's tag. Drafts and
// prereleases are not returned by /releases/latest, so a draft release being
// tested does not trigger the popup.

const { app, dialog, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const LATEST_RELEASE_API = 'https://api.github.com/repos/LukasLiss/totem-tool/releases/latest';
const DOWNLOAD_PAGE = 'https://totem-tool.com';
const REQUEST_TIMEOUT_MS = 10_000;

/** Parse "v1.2.3" / "1.2.3-beta.1" into [1, 2, 3]; null when unparseable. */
function parseVersion(raw) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(raw || '').trim());
  return match ? match.slice(1, 4).map(Number) : null;
}

/** True when version `a` is strictly newer than version `b`. */
function isNewer(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return false;
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'update-check.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (e) {
    console.warn(`[Update] Could not save update settings: ${e.message}`);
  }
}

async function fetchLatestVersion() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // net.fetch goes through Chromium's network stack, so it honours the
    // system proxy settings like the rest of the app.
    const res = await net.fetch(LATEST_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `TOTeM-Tool/${app.getVersion()}`,
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const release = await res.json();
    return release && release.tag_name ? String(release.tag_name) : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Look for a newer release and show a popup if there is one.
 *
 * `manual` is for a user-triggered check: it also reports "up to date" and
 * errors, and ignores a previously skipped version.
 */
async function checkForUpdates(parentWindow, { manual = false } = {}) {
  const current = app.getVersion();
  let latestTag;
  try {
    latestTag = await fetchLatestVersion();
  } catch (e) {
    // Offline or rate limited: stay quiet on the automatic check.
    console.warn(`[Update] Update check failed: ${e.message}`);
    if (manual) {
      dialog.showMessageBox(parentWindow || undefined, {
        type: 'warning',
        title: 'Update check failed',
        message: 'Could not check for updates.',
        detail: `${e.message}\n\nYou can always get the latest version at ${DOWNLOAD_PAGE}.`,
      });
    }
    return;
  }

  const latest = latestTag ? latestTag.replace(/^v/, '') : null;
  if (!latest || !isNewer(latest, current)) {
    console.log(`[Update] Up to date (installed ${current}, latest ${latest || 'unknown'}).`);
    if (manual) {
      dialog.showMessageBox(parentWindow || undefined, {
        type: 'info',
        title: 'No updates available',
        message: 'TOTeM-Tool is up to date.',
        detail: `You are running version ${current}.`,
      });
    }
    return;
  }

  const settings = readSettings();
  if (!manual && settings.skippedVersion === latest) {
    console.log(`[Update] Version ${latest} is available but was skipped by the user.`);
    return;
  }

  // A window may have closed while the request was in flight.
  const parent = parentWindow && !parentWindow.isDestroyed() ? parentWindow : undefined;
  const { response } = await dialog.showMessageBox(parent, {
    type: 'info',
    title: 'Update available',
    message: `A new version of TOTeM-Tool is available: ${latest}`,
    detail: `You are running version ${current}.\n\nDownload the new version at ${DOWNLOAD_PAGE}.`,
    buttons: ['Download', 'Remind Me Later', 'Skip This Version'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });

  if (response === 0) {
    shell.openExternal(DOWNLOAD_PAGE);
  } else if (response === 2) {
    writeSettings({ ...settings, skippedVersion: latest });
  }
}

module.exports = { checkForUpdates, isNewer, parseVersion, DOWNLOAD_PAGE };
