/* GeoMirror for Firefox — isolated-world bridge.
 *
 * Runs in the isolated world (has browser.* access) at document_start. It reads
 * the chosen override from storage and publishes it onto <html data-geomirror>,
 * where the MAIN-world injector can read it. MAIN-world scripts cannot access
 * extension storage, so this bridge is the only way to pass the profile across.
 *
 * Firefox specifics: storage.local.get returns a Promise via the browser.*
 * namespace, so the callback style of the Chrome version becomes a .then().
 * The DOM itself is shared between both worlds, so the attribute hand-off and
 * the storage.onChanged live-republish behave exactly like upstream.
 */
(function () {
  function publish() {
    browser.storage.local.get(['override', 'settings']).then((data) => {
      const root = document.documentElement;
      if (!root) return;
      const s = data.settings || {};
      const o = data.override;
      const enabled = s.enabled !== false;
      const payload = {
        enabled,
        lat: o ? o.lat : null,
        lon: o ? o.lon : null,
        acc: o ? o.acc : (s.accuracyM || 30),
        ts: o ? o.ts : 0,
        timezone: o ? o.timezone : null,
        tzEnabled: s.tzEnabled !== false,
        langEnabled: s.langEnabled !== false,
        fontEnabled: s.fontEnabled !== false,
        locale: o ? o.locale : null,
        languages: o ? o.languages : null,
      };
      root.setAttribute('data-geomirror', JSON.stringify(payload));
    }).catch(() => { /* storage read failed; keep whatever was published */ });
  }

  publish();
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.override || changes.settings)) publish();
  });
})();
