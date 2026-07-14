#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

const TZ = require(path.join(__dirname, '..', 'lib', 'timezone.js'));
const Locale = require(path.join(__dirname, '..', 'lib', 'locale.js'));
const Fonts = require(path.join(__dirname, '..', 'lib', 'font-mask.js'));
const IPLoc = require(path.join(__dirname, '..', 'lib', 'providers.js'));

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

function eq(actual, expected) {
  assert.deepStrictEqual(actual, expected);
}

test('timezone offsets are DST-aware and use the supplied Date instance', () => {
  eq(TZ.tzOffsetMinutes('America/Los_Angeles', new Date('2026-06-15T12:00:00Z')), 420);
  eq(TZ.tzOffsetMinutes('America/Los_Angeles', new Date('2026-01-15T12:00:00Z')), 480);
  eq(TZ.tzOffsetMinutes('Europe/London', new Date('2026-06-15T12:00:00Z')), -60);
  eq(TZ.tzOffsetMinutes('Europe/London', new Date('2026-01-15T12:00:00Z')), 0);
  eq(TZ.tzOffsetMinutes('Asia/Tokyo', new Date('2026-06-15T12:00:00Z')), -540);
  eq(TZ.tzOffsetMinutes('Asia/Shanghai', new Date('2026-06-15T12:00:00Z')), -480);
});

test('timezone helper returns null for invalid IANA timezone', () => {
  eq(TZ.tzOffsetMinutes('Not/A_Zone', new Date('2026-06-15T12:00:00Z')), null);
});

test('timezone helper preserves Invalid Date semantics', () => {
  assert(Number.isNaN(TZ.tzOffsetMinutes('America/Los_Angeles', new Date('invalid'))));
});

test('locale inference handles country defaults', () => {
  eq(Locale.localeFor('JP', 'Asia/Tokyo'), {
    language: 'ja-JP',
    languages: ['ja-JP', 'ja', 'en-US', 'en'],
    acceptLanguage: 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
  });
  eq(Locale.localeFor('BR', 'America/Sao_Paulo').language, 'pt-BR');
  eq(Locale.localeFor('US', 'America/New_York').language, 'en-US');
});

test('locale inference uses timezone tie-breakers', () => {
  eq(Locale.localeFor('CA', 'America/Montreal').language, 'fr-CA');
  eq(Locale.localeFor('CA', 'America/Toronto').language, 'en-CA');
  eq(Locale.localeFor('BE', 'Europe/Brussels').languages, ['nl-BE', 'nl', 'fr-BE', 'fr', 'en']);
});

test('locale inference falls back to neutral English', () => {
  eq(Locale.localeFor('ZZ', null), {
    language: 'en-US',
    languages: ['en-US', 'en'],
    acceptLanguage: 'en-US,en;q=0.9',
  });
});

test('IP providers parse timezone fields without discarding location fields', () => {
  const providers = Object.fromEntries(IPLoc.IP_PROVIDERS.map((provider) => [provider.name, provider]));

  eq(providers['ipwho.is'].parse({
    ip: '203.0.113.1',
    city: 'Tokyo',
    region: 'Tokyo',
    country: 'Japan',
    country_code: 'JP',
    latitude: 35.6895,
    longitude: 139.6917,
    connection: { isp: 'Example ISP' },
    timezone: { id: 'Asia/Tokyo' },
  }), {
    ip: '203.0.113.1',
    city: 'Tokyo',
    region: 'Tokyo',
    country: 'Japan',
    countryCode: 'JP',
    lat: 35.6895,
    lon: 139.6917,
    isp: 'Example ISP',
    timezone: 'Asia/Tokyo',
  });

  eq(providers['ipapi.co'].parse({
    ip: '203.0.113.2',
    city: 'Los Angeles',
    region: 'California',
    country_name: 'United States',
    country_code: 'US',
    latitude: '34.05',
    longitude: '-118.24',
    org: 'Example Org',
    timezone: 'America/Los_Angeles',
  }).timezone, 'America/Los_Angeles');

  eq(providers['ipinfo.io'].parse({
    ip: '203.0.113.3',
    city: 'London',
    region: 'England',
    country: 'GB',
    loc: '51.5072,-0.1276',
    org: 'Example Org',
    timezone: 'Europe/London',
  }).timezone, 'Europe/London');
});

test('preferred providers run before the location-only fallback', () => {
  eq(IPLoc.IP_PROVIDERS[0].name, 'ipapi.co');
  const fallback = IPLoc.IP_PROVIDERS[IPLoc.IP_PROVIDERS.length - 1];
  eq(fallback.name, 'reallyfreegeoip');
  eq(fallback.parse({
    ip: '203.0.113.4',
    latitude: 34.05,
    longitude: -118.24,
  }).timezone, null);
  assert(
    IPLoc.IP_PROVIDERS.slice(0, -1).some((provider) =>
      provider.parse(provider.name === 'ipwho.is'
        ? { timezone: { id: 'America/Los_Angeles' } }
        : { timezone: 'America/Los_Angeles' }
      ).timezone === 'America/Los_Angeles'
    )
  );
});

test('font mask recognizes system and Chinese vendor fonts', () => {
  assert(Fonts.containsBlockedFont("72px 'PingFang SC', sans-serif"));
  assert(Fonts.containsBlockedFont('16px MiSans'));
  assert(Fonts.containsBlockedFont('12px FZCustomFont'));
  assert(!Fonts.containsBlockedFont('16px Arial, sans-serif'));
});

test('font mask rewrites only regional font families', () => {
  eq(
    Fonts.rewriteFontSpec("72px 'PingFang SC', monospace"),
    `72px '${Fonts.MASKED_FAMILY}', monospace`
  );
  eq(Fonts.rewriteFontSpec('16px Arial, sans-serif'), '16px Arial, sans-serif');
});

test('font mask stays off for Chinese exit profiles', () => {
  assert(Fonts.isChineseProfile('zh-CN', 'Asia/Shanghai'));
  assert(Fonts.isChineseProfile('en-US', 'Asia/Hong_Kong'));
  assert(!Fonts.isChineseProfile('en-US', 'America/Los_Angeles'));
});

test('manifest includes helpers before MAIN-world injector', () => {
  const manifest = require(path.join(__dirname, '..', 'manifest.json'));
  const mainScript = manifest.content_scripts.find((script) => script.world === 'MAIN');
  assert(mainScript, 'MAIN world content script is missing');
  eq(mainScript.js, ['lib/timezone.js', 'lib/font-mask.js', 'content-inject.js']);
  assert(manifest.permissions.includes('declarativeNetRequest'), 'DNR permission is required for Accept-Language');
});

if (process.exitCode) {
  console.error('\nTests failed.');
  process.exit(process.exitCode);
} else {
  console.log(`\n${passed} tests passed.`);
}
