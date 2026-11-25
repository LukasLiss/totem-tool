// afterSign hook: notarizes the signed macOS app.
//
// Replaces electron-builder's built-in `notarize` (disabled in package.json)
// because that gives up on the first network error while stapling. GitHub's
// Intel macOS runners regularly lose the connection to Apple's ticket service
// right after a successful notarization, failing the whole release. Here only
// the staple step is retried; the notarization itself is never resubmitted.

const { execFileSync } = require("child_process");
const path = require("path");
const { notarize } = require("@electron/notarize");

const STAPLE_ATTEMPTS = 5;

// Same environment variables electron-builder reads for its built-in notarize.
function credentials() {
  const env = process.env;
  if (env.APPLE_ID || env.APPLE_APP_SPECIFIC_PASSWORD) {
    if (!env.APPLE_ID || !env.APPLE_APP_SPECIFIC_PASSWORD || !env.APPLE_TEAM_ID) {
      throw new Error("APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID must all be set");
    }
    return {
      appleId: env.APPLE_ID,
      appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: env.APPLE_TEAM_ID,
    };
  }
  if (env.APPLE_KEYCHAIN_PROFILE) {
    return env.APPLE_KEYCHAIN
      ? { keychainProfile: env.APPLE_KEYCHAIN_PROFILE, keychain: env.APPLE_KEYCHAIN }
      : { keychainProfile: env.APPLE_KEYCHAIN_PROFILE };
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stapleWithRetry(appPath) {
  for (let attempt = 1; attempt <= STAPLE_ATTEMPTS; attempt++) {
    await sleep(attempt * 30_000);
    try {
      execFileSync("xcrun", ["stapler", "staple", appPath], { stdio: "inherit" });
      return true;
    } catch {
      console.log(`  • stapling failed  attempt=${attempt}/${STAPLE_ATTEMPTS}`);
    }
  }
  return false;
}

exports.default = async function notarizeApp(context) {
  if (context.electronPlatformName !== "darwin") return;

  const creds = credentials();
  if (!creds) {
    console.log("  • skipped macOS notarization  reason=no Apple credentials in env");
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  try {
    await notarize({ appPath, ...creds });
  } catch (e) {
    // Anything other than stapling (rejected submission, bad credentials) is fatal.
    if (!/staple/i.test(e.message)) throw e;
    console.log("  • notarization accepted, retrying staple");
    if (!(await stapleWithRetry(appPath))) {
      // Still notarized: Gatekeeper fetches the ticket online on first launch.
      // Only offline first launches lose out, so warn instead of failing.
      console.log("::warning::App is notarized but the ticket could not be stapled.");
    }
  }
  console.log("  • notarization successful");
};
