/* GeoMirror for Firefox — popup UI logic.
 *
 * Firefox port notes:
 *  - browser.runtime.sendMessage returns a Promise; the Chrome callback form
 *    is replaced with .catch(() => null) so a sleeping background page or a
 *    closed message channel never breaks the UI.
 *  - Since Firefox 127, MV3 host permissions are opt-in: they are NOT granted
 *    automatically at install time. Without <all_urls> granted, content
 *    scripts don't run and DNR can't rewrite headers, so the popup checks and
 *    offers a one-click permissions.request() (allowed from this user gesture).
 */
const $ = (id) => document.getElementById(id);
let busy = false;

function fmtTime(ts) {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

function sourceLabel(s) {
  return ({
    overpass: 'Residential street · OpenStreetMap',
    jitter: 'Nearby point · offset fallback',
    ipcenter: 'IP center',
  })[s] || s || '';
}

async function checkPerm() {
  try {
    const granted = await browser.permissions.contains({ origins: ['<all_urls>'] });
    $('permWarn').style.display = granted ? 'none' : 'flex';
    return granted;
  } catch (_) {
    return true; // permissions API unavailable — assume granted, fail soft
  }
}

function render({ state, override, settings }) {
  const st = state || {};
  const ok = st.status === 'ok';
  const dot = $('dot'), txt = $('statusText');

  if (st.status === 'refreshing' || busy) {
    dot.className = 'dot busy';
    txt.textContent = 'Updating…';
  } else if (ok) {
    dot.className = 'dot ok';
    txt.textContent = 'Active';
  } else {
    dot.className = 'dot err';
    txt.textContent = st.lastError ? ('Error: ' + st.lastError) : 'Error';
  }

  $('ip').textContent = st.ip || '—';
  $('ipLoc').textContent = [st.ipCity, st.ipRegion, st.ipCountry].filter(Boolean).join(', ') || '—';
  $('isp').textContent = st.isp ? st.isp : '';

  const lat = (st.overrideLat != null) ? st.overrideLat : (override ? override.lat : null);
  const lon = (st.overrideLon != null) ? st.overrideLon : (override ? override.lon : null);
  $('addr').textContent = st.overrideAddress ||
    (lat != null ? lat.toFixed(5) + ', ' + lon.toFixed(5) : '—');
  $('coords').textContent = (lat != null) ? lat.toFixed(5) + ', ' + lon.toFixed(5) : '—';
  $('source').textContent = st.overrideSource
    ? sourceLabel(st.overrideSource) + (st.overrideRoad ? ' · ' + st.overrideRoad : '')
    : '';

  $('tz').textContent = (override && override.timezone) ? override.timezone
    : (st.ipTimezone ? st.ipTimezone + ' (no override)' : '—');
  $('lang').textContent = (override && override.locale) ? override.locale
    : (st.ipLocale ? st.ipLocale + ' (no override)' : '—');

  $('updated').textContent = 'Updated ' + fmtTime(st.lastUpdated);

  $('enabled').checked = settings ? settings.enabled !== false : true;
  $('tzEnabled').checked = settings ? settings.tzEnabled !== false : true;
  $('langEnabled').checked = settings ? settings.langEnabled !== false : true;
  $('fontEnabled').checked = settings ? settings.fontEnabled !== false : true;
  if (settings) {
    $('accuracyM').value = settings.accuracyM;
    $('refreshMinutes').value = settings.refreshMinutes;
    $('ipToken').value = settings.ipToken || '';
  }
}

function send(msg) {
  return browser.runtime.sendMessage(msg).catch(() => null);
}

async function load() {
  const snap = await send({ type: 'GET_STATE' });
  if (snap) render(snap);
  await checkPerm();
}

function bind(id, key, map) {
  $(id).addEventListener('change', async (e) => {
    let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (map) v = map(v);
    await send({ type: 'SET_SETTINGS', patch: { [key]: v } });
    await load();
  });
}

bind('enabled', 'enabled');
bind('tzEnabled', 'tzEnabled');
bind('langEnabled', 'langEnabled');
bind('fontEnabled', 'fontEnabled');
bind('accuracyM', 'accuracyM', (v) => Math.max(5, Math.min(500, +v || 30)));
bind('refreshMinutes', 'refreshMinutes', (v) => Math.max(30, Math.min(10080, +v || 360)));
bind('ipToken', 'ipToken', (v) => (v || '').trim());

$('grantPerm').addEventListener('click', async () => {
  try {
    await browser.permissions.request({ origins: ['<all_urls>'] });
  } catch (_) { /* user dismissed or API unavailable */ }
  await checkPerm();
  await load();
});

$('refresh').addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  $('refresh').disabled = true;
  $('dot').className = 'dot busy';
  $('statusText').textContent = 'Updating…';
  await send({ type: 'REFRESH' });
  busy = false;
  $('refresh').disabled = false;
  await load();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.state || changes.override || changes.settings)) load();
});

load();
