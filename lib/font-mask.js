/* GeoMirror — font fingerprint helpers.
 *
 * Chinese system and vendor fonts are a strong regional signal on macOS and
 * Windows. This module identifies the families commonly used by canvas/font
 * probes and rewrites them to a deliberately unavailable family.
 */
(function () {
  'use strict';
  const root = (typeof self !== 'undefined') ? self
             : (typeof globalThis !== 'undefined') ? globalThis
             : (typeof global !== 'undefined') ? global : this;

  const MASKED_FAMILY = '__GeoMirror_Unavailable_Font__';
  const BLOCKED_FONT_FAMILIES = [
    // macOS / Windows Chinese fonts
    'PingFang SC', 'PingFang TC', 'PingFang HK',
    'Hiragino Sans GB', 'STHeiti', 'STSong', 'STKaiti', 'STFangsong',
    'Heiti SC', 'Heiti TC', 'Songti SC', 'Songti TC',
    'Kaiti SC', 'Kaiti TC', 'Yuanti SC',
    'Microsoft YaHei UI', 'Microsoft YaHei', 'SimSun', 'NSimSun',
    'SimHei', 'KaiTi', 'FangSong', 'DengXian',
    'KaiTi_GB2312', 'FangSong_GB2312',

    // Chinese device / software vendor fonts
    'MiSans VF', 'MiSans', 'MI Lan Pro',
    'HarmonyOS Sans SC', 'HarmonyOS Sans TC', 'HarmonyOS Sans',
    'Huawei Sans', 'OPPO Sans', 'vivo Sans',
    'FZLanTingHeiS-R-GB', 'FZLanTingHeiS', 'FZLTHJW',
    'FZYaoti', 'FZShuTi', 'FounderType', 'WPS Office',
    '方正兰亭黑', '方正黑体', '方正书宋', '方正仿宋',
    '方正楷体', '方正小标宋',
  ].sort((a, b) => b.length - a.length);

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const exactPattern = new RegExp(
    BLOCKED_FONT_FAMILIES.map(escapeRegExp).join('|'),
    'i'
  );
  const vendorPattern = /(?:^|[\s'",])(?:FZ[A-Za-z0-9_-]+|Founder[A-Za-z0-9 _-]+|WPS[A-Za-z0-9 _-]+)(?=$|[\s'",])/i;

  function containsBlockedFont(fontSpec) {
    if (typeof fontSpec !== 'string') return false;
    return exactPattern.test(fontSpec) || vendorPattern.test(fontSpec);
  }

  function rewriteFontSpec(fontSpec) {
    if (typeof fontSpec !== 'string' || !containsBlockedFont(fontSpec)) return fontSpec;
    let rewritten = fontSpec;
    for (const family of BLOCKED_FONT_FAMILIES) {
      rewritten = rewritten.replace(new RegExp(escapeRegExp(family), 'gi'), MASKED_FAMILY);
    }
    rewritten = rewritten.replace(
      /(?:FZ[A-Za-z0-9_-]+|Founder[A-Za-z0-9 _-]+|WPS[A-Za-z0-9 _-]+)/gi,
      MASKED_FAMILY
    );
    return rewritten;
  }

  function isChineseProfile(locale, timeZone) {
    if (typeof locale === 'string' && /^zh(?:-|$)/i.test(locale)) return true;
    return /^(?:Asia\/(?:Shanghai|Urumqi|Hong_Kong|Macau|Taipei)|PRC|ROC)$/i.test(timeZone || '');
  }

  const GeoMirrorFonts = {
    MASKED_FAMILY,
    BLOCKED_FONT_FAMILIES,
    containsBlockedFont,
    rewriteFontSpec,
    isChineseProfile,
  };
  root.GeoMirrorFonts = GeoMirrorFonts;
  if (typeof module !== 'undefined' && module.exports) module.exports = GeoMirrorFonts;
})();
