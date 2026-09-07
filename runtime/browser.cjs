'use strict';

const fs = require('node:fs');
const path = require('node:path');

function unavailable(message, code = 'BROWSER_UNAVAILABLE') {
  return Object.assign(new Error(message), { code });
}

function loadChromium(requireModule = require) {
  try {
    const chromium = requireModule('playwright').chromium;
    if (chromium) return chromium;
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  throw unavailable('缺少项目 Playwright 运行依赖，请先完成项目依赖安装。', 'BROWSER_RUNTIME_UNAVAILABLE');
}

function resolveBrowserPath(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const paths = platform === 'win32' ? path.win32 : path;
  const exists = options.existsSync || fs.existsSync;
  const candidates = [];
  if (options.executablePath) {
    const explicit = paths.resolve(options.executablePath);
    if (exists(explicit)) return explicit;
    throw unavailable('指定的浏览器不存在，请检查浏览器路径。');
  }
  if (env.CHROME_PATH) candidates.push(paths.resolve(env.CHROME_PATH));
  if (platform === 'win32') {
    for (const root of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(paths.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        paths.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }
  for (const candidate of candidates) if (exists(candidate)) return candidate;
  let chromium = options.chromium;
  if (!chromium) {
    try { chromium = loadChromium(options.requireModule); } catch (error) {
      if (error.code !== 'BROWSER_RUNTIME_UNAVAILABLE') throw error;
    }
  }
  const installed = chromium?.executablePath?.();
  if (installed && exists(installed)) return installed;
  throw unavailable('未找到浏览器。请设置 CHROME_PATH，或在项目根目录运行 npx playwright install chromium。');
}

function resolveLoginRoot({ env = process.env, cwd = process.cwd() } = {}) {
  return path.resolve(cwd, env.CREATOR_LOGIN_DIR || '.creator-login');
}

module.exports = { loadChromium, resolveBrowserPath, resolveLoginRoot };
