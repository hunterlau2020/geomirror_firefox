/* GeoMirror for Firefox — background event page.
 *
 * Firefox MV3 uses a non-persistent event page instead of Chrome's service
 * worker, so the lib helpers are loaded via manifest background.scripts (in
 * order) and importScripts() is gone. All APIs use the promise-based `browser.*`
 * namespace, and onMessage replies by returning a Promise instead of the
 * Chrome-style sendResponse + return true dance.
 *
 * Responsibilities (unchanged from upstream):
 *  - Detect the exit-IP geolocation (through the user's proxy).
 *  - Pick a nearby residential street as the override coordinate.
 *  - Resolve the exit IP's timezone and infer a matching locale.
 *  - Store everything so the content scripts can apply it to every page.
 *  - Push an Accept-Language header rule via declarativeNetRequest (supported
 *    in Firefox since 113) so the outgoing HTTP header matches the spoofed
 *    language, not just navigator.
 *  - Refresh on install / startup and on demand (one-tap re-detect).
 */
'use strict';

const DEFAULT_SETTINGS = {
  enabled: true,
  accuracyM: 30,          // reported accuracy in meters (GPS-like)
  refreshMinutes: 360,    // re-detect every 6h
  ipToken: '',            // optional ipinfo.io token for better fallback
  tzEnabled: true,        // spoof Date/Intl timezone to match exit IP
  langEnabled: true,      // spoof navigator.language / Intl locale + Accept-Language header
  fontEnabled: true,      // mask Chinese regional fonts for non-Chinese exit profiles
};

const ALARM = 'refresh';
const AL_RULE_ID = 9001; // dynamic declarativeNetRequest rule id for Accept-Language

async function getSettings() {
  const { settings } = await browser.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await browser.storage.local.set({ settings: next });
  return next;
}

async function patchState(patch) {
  const { state } = await browser.storage.local.get('state');
  await browser.storage.local.set({ state: { ...(state || {}), ...patch } });
}

/** Push / clear the dynamic Accept-Language rule. No-op if DNR is unavailable. */
async function syncHeaderRule(settings, override) {
  if (!browser.declarativeNetRequest || !browser.declarativeNetRequest.updateDynamicRules) return;
  try {
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [AL_RULE_ID],
    });
    if (!(settings && settings.enabled && settings.langEnabled)) return;
    let al = override && override.acceptLanguage;
    if (!al) return; // nothing to enforce yet
    const makeRule = (condition) => ({
      id: AL_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'accept-language', operation: 'set', value: al },
        ],
      },
      condition,
    });
    try {
      await browser.declarativeNetRequest.updateDynamicRules({
        addRules: [makeRule({
          urlFilter: '*',
          resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest'],
        })],
      });
    } catch (_) {
      // Some Firefox builds are picky about urlFilter:'*' — a condition with
      // only resourceTypes matches every request too.
      await browser.declarativeNetRequest.updateDynamicRules({
        addRules: [makeRule({
          resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest'],
        })],
      });
    }
  } catch (_) { /* DNR may be unavailable on some builds; fail soft */ }
}

async function refresh() {
  await patchState({ status: 'refreshing', lastError: null });
  const s = await getSettings();
  try {
    const ip = await IPLoc.getIPLocation(s.ipToken);
    if (!ip || ip.lat == null) throw new Error('All IP geolocation providers failed.');

    const pick = await GeoUtil.chooseResidential(ip.lat, ip.lon, {
      radius: 2500, limit: 150, timeoutMs: 12000,
    });
    const addr = await IPLoc.getDisplayAddress(pick.lat, pick.lon);
    const now = Date.now();

    // getIPLocation prefers a provider result with an IANA timezone and only
    // returns a location-only fallback when all timezone-capable providers fail.
    // The MAIN-world injector keeps its neutral bootstrap in that rare case
    // instead of leaking the host timezone.
    const timezone = ip.timezone || null;
    const loc = Locale.localeFor(ip.countryCode, timezone);

    const override = {
      lat: pick.lat, lon: pick.lon, acc: s.accuracyM,
      source: pick.source, road: pick.road || null,
      enabled: s.enabled, ts: now,
      timezone,
      tzEnabled: s.tzEnabled,
      langEnabled: s.langEnabled,
      fontEnabled: s.fontEnabled,
      locale: loc ? loc.language : null,
      languages: loc ? loc.languages : null,
      acceptLanguage: loc ? loc.acceptLanguage : null,
    };
    const state = {
      status: 'ok',
      ip: ip.ip, ipCity: ip.city, ipRegion: ip.region,
      ipCountry: ip.country, ipCountryCode: ip.countryCode,
      ipLat: ip.lat, ipLon: ip.lon, isp: ip.isp, provider: ip.provider,
      ipTimezone: timezone,
      ipLocale: loc ? loc.language : null,
      overrideLat: pick.lat, overrideLon: pick.lon,
      overrideSource: pick.source, overrideRoad: pick.road || null,
      overrideAddress: addr ? addr.text : '',
      lastUpdated: now, lastError: null,
    };
    await browser.storage.local.set({ override, state });
    await syncHeaderRule(s, override);
  } catch (e) {
    await patchState({
      status: 'error',
      lastError: String((e && e.message) || e),
      lastUpdated: Date.now(),
    });
  }
}

async function ensureAlarm() {
  const s = await getSettings();
  await browser.alarms.clear(ALARM);
  browser.alarms.create(ALARM, { periodInMinutes: Math.max(1, s.refreshMinutes) });
}

browser.runtime.onInstalled.addListener(async () => {
  const { settings } = await browser.storage.local.get('settings');
  if (!settings) await browser.storage.local.set({ settings: DEFAULT_SETTINGS });
  await ensureAlarm();
  await refresh();
});

browser.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  const { state, override, settings } = await browser.storage.local.get(['state', 'override', 'settings']);
  // Re-assert the header rule on startup (dynamic rules don't persist a value
  // we control across browser restarts in all cases).
  await syncHeaderRule({ ...DEFAULT_SETTINGS, ...(settings || {}) }, override);
  const s = await getSettings();
  const age = state && state.lastUpdated ? Date.now() - state.lastUpdated : Infinity;
  if (!state || age > s.refreshMinutes * 60000) await refresh();
});

browser.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) refresh();
});

// Firefox style: return a Promise from the listener; it resolves to the reply.
browser.runtime.onMessage.addListener(async (msg) => {
  if (msg && msg.type === 'REFRESH') {
    await refresh();
  } else if (msg && msg.type === 'SET_SETTINGS') {
    const next = await saveSettings(msg.patch || {});
    const { override } = await browser.storage.local.get('override');
    if (override) {
      override.enabled = next.enabled;
      override.acc = next.accuracyM;
      override.tzEnabled = next.tzEnabled;
      override.langEnabled = next.langEnabled;
      override.fontEnabled = next.fontEnabled;
      await browser.storage.local.set({ override });
    }
    // Toggling language spoofing changes whether the header rule is active.
    await syncHeaderRule(next, override);
    if (msg.patch && 'refreshMinutes' in msg.patch) await ensureAlarm();
  }
  // Return a fresh snapshot for any message (covers GET_STATE too).
  const { state, override, settings } = await browser.storage.local.get(['state', 'override', 'settings']);
  return { state, override, settings: { ...DEFAULT_SETTINGS, ...(settings || {}) } };
});
