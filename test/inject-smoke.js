#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const context = vm.createContext({
  console,
  setTimeout: () => 0,
  clearTimeout: () => {},
  navigator: {
    geolocation: {
      getCurrentPosition() {},
      watchPosition() { return 1; },
      clearWatch() {},
    },
    permissions: { query: () => Promise.resolve({ state: 'prompt' }) },
    language: 'zh-CN',
    languages: ['zh-CN', 'zh'],
  },
  document: {
    documentElement: {
      // Regression fixture: the first location provider succeeded but returned
      // no timezone. This must retain the neutral bootstrap, not restore the
      // host's Asia/Shanghai timezone.
      getAttribute: () => JSON.stringify({
        enabled: true,
        lat: 34.0636,
        lon: -118.2638,
        timezone: null,
        tzEnabled: true,
        langEnabled: true,
        fontEnabled: true,
        locale: 'en-US',
        languages: ['en-US', 'en'],
      }),
    },
  },
  MutationObserver: class {
    observe() {}
  },
});

vm.runInContext(`
  this.window = this;
  this.self = this;

  class CanvasRenderingContext2D {
    constructor() { this._font = '10px sans-serif'; }
  }
  Object.defineProperty(CanvasRenderingContext2D.prototype, 'font', {
    configurable: true,
    enumerable: true,
    get() { return this._font; },
    set(value) { this._font = String(value); },
  });
  this.CanvasRenderingContext2D = CanvasRenderingContext2D;

  class OffscreenCanvasRenderingContext2D extends CanvasRenderingContext2D {}
  this.OffscreenCanvasRenderingContext2D = OffscreenCanvasRenderingContext2D;

  class CSSStyleDeclaration {
    constructor() { this._font = ''; this._fontFamily = ''; this._cssText = ''; }
    setProperty(name, value) { this[name] = value; }
  }
  for (const [prop, slot] of [
    ['font', '_font'],
    ['fontFamily', '_fontFamily'],
    ['cssText', '_cssText'],
  ]) {
    Object.defineProperty(CSSStyleDeclaration.prototype, prop, {
      configurable: true,
      enumerable: true,
      get() { return this[slot]; },
      set(value) { this[slot] = String(value); },
    });
  }
  this.CSSStyleDeclaration = CSSStyleDeclaration;

  class FontFaceSet { check() { return true; } }
  this.FontFaceSet = FontFaceSet;
`, context);

for (const file of ['lib/timezone.js', 'lib/font-mask.js', 'content-inject.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

const result = vm.runInContext(`(() => {
  const canvas = new CanvasRenderingContext2D();
  canvas.font = "72px 'PingFang SC', monospace";
  const offscreen = new OffscreenCanvasRenderingContext2D();
  offscreen.font = '72px MiSans, monospace';
  const style = new CSSStyleDeclaration();
  style.fontFamily = "'Microsoft YaHei', sans-serif";
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offset: new Date('2026-07-06T00:00:00Z').getTimezoneOffset(),
    language: navigator.language,
    canvasFont: canvas.font,
    offscreenFont: offscreen.font,
    styleFont: style.fontFamily,
    fontCheck: new FontFaceSet().check("12px 'HarmonyOS Sans SC'"),
  };
})()`, context);

assert.notStrictEqual(result.timezone, 'Asia/Shanghai');
assert.strictEqual(result.offset, 0);
assert.strictEqual(result.language, 'en-US');
assert(result.canvasFont.includes('__GeoMirror_Unavailable_Font__'));
assert(result.offscreenFont.includes('__GeoMirror_Unavailable_Font__'));
assert(result.styleFont.includes('__GeoMirror_Unavailable_Font__'));
assert.strictEqual(result.fontCheck, false);

console.log('PASS synchronous bootstrap hides host timezone and regional fonts');
