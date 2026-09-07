'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadChromium, resolveBrowserPath, resolveLoginRoot } = require('../../runtime/browser.cjs');

test('browser priority is explicit path, CHROME_PATH, system browser, installed Playwright', () => {
  const system = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const installed = '/fixture/playwright/chromium';
  const present = new Set(['/fixture/custom', system, installed]);
  const options = { platform: 'darwin', env: { CHROME_PATH: '/fixture/custom' },
    existsSync: p => present.has(p), chromium: { executablePath: () => installed } };
  assert.equal(resolveBrowserPath(options), '/fixture/custom');
  assert.equal(resolveBrowserPath({ ...options, executablePath: installed }), installed);
  present.delete('/fixture/custom');
  assert.equal(resolveBrowserPath(options), system);
  present.delete(system);
  assert.equal(resolveBrowserPath(options), installed);
  present.delete(installed);
  assert.throws(() => resolveBrowserPath(options), e => e.code === 'BROWSER_UNAVAILABLE');
});

test('Linux and Windows use installed system Chrome before Playwright', () => {
  for (const [platform, env, expected] of [
    ['linux', {}, '/usr/bin/google-chrome'],
    ['win32', { PROGRAMFILES: 'C:\\Program Files' }, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
  ]) {
    assert.equal(resolveBrowserPath({ platform, env, existsSync: p => p === expected,
      requireModule: () => { assert.fail('system browser requires no Playwright lookup'); } }), expected);
  }
});

test('missing browser or runtime fails without searching private caches or installing anything', () => {
  const names = [];
  const missing = name => { names.push(name); throw Object.assign(new Error('absent'), { code: 'MODULE_NOT_FOUND' }); };
  assert.throws(() => loadChromium(missing), e => e.code === 'BROWSER_RUNTIME_UNAVAILABLE');
  assert.deepEqual(names, ['playwright']);
  assert.throws(() => resolveBrowserPath({ platform: 'linux', env: {}, existsSync: () => false, requireModule: missing }),
    /npx playwright install chromium/);
  assert.deepEqual(names, ['playwright', 'playwright']);
});

test('login root is neutral and uses only CREATOR_LOGIN_DIR, never storage-directory settings', () => {
  const cwd = path.resolve('/fixture/project');
  assert.equal(resolveLoginRoot({ cwd, env: { CREATOR_STORAGE_DIR: '/fixture/storage' } }), path.join(cwd, '.creator-login'));
  assert.equal(resolveLoginRoot({ cwd, env: { CREATOR_LOGIN_DIR: 'sessions' } }), path.join(cwd, 'sessions'));
  assert.equal(resolveLoginRoot({ cwd, env: { CREATOR_LOGIN_DIR: path.resolve('/fixture/shared') } }), path.resolve('/fixture/shared'));
});
