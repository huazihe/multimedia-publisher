'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadChromium, resolveBrowserPath } = require('../runtime/browser.cjs');
const { isIP } = require('node:net');
const { createHash } = require('node:crypto');
const requireCore = require('node:module').createRequire(path.join(__dirname, '../packages/core/package.json'));
const { parseHTML } = requireCore('linkedom');
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 24 * 1024 * 1024;
const MAX_ASSETS = 40;
const MAX_DIMENSION = 8192;
const MAX_IMAGE_PIXELS = 24 * 1024 * 1024;
const MAX_DECODED_PIXELS = 48 * 1024 * 1024;
const MAX_FRAMES = 100;

function fail(message, statusCode = 400) { const e = new Error(message); e.statusCode = statusCode; throw e; }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function relativeName(value) {
  if (typeof value !== 'string' || !value || value.length > 1024) fail('图片相对路径无效');
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { fail('图片路径编码无效'); }
  return decodedRelativeName(decoded);
}
function decodedRelativeName(decoded) {
  const parts = decoded.normalize('NFC').replace(/\\/g, '/').replace(/^\.\//, '').split('/');
  if (/%[0-9a-f]{2}/i.test(decoded) || parts.some(p => p === '..' || p === '.' || !p || /[\x00-\x1f\x7f:?#]/.test(p))) fail('图片路径必须位于导入文件夹内，不能使用多重编码');
  return parts.join('/');
}
function corrupt() { fail('仅支持结构完整且可解码的 PNG、JPEG、GIF、WebP 图片；图片损坏或格式不支持', 415); }
function dimensions(width, height, frames = 1) {
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_IMAGE_PIXELS ||
      !frames || frames > MAX_FRAMES || width * height * frames > MAX_DECODED_PIXELS) fail('图片尺寸、像素数或动画帧数超过安全解码上限', 413);
  return { width, height, frames };
}
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngInfo(b) {
  if (b.length < 57 || b.readUInt32BE(8) !== 13 || b.toString('ascii', 12, 16) !== 'IHDR') corrupt();
  const size = dimensions(b.readUInt32BE(16), b.readUInt32BE(20));
  const allowedDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!allowedDepths[b[25]]?.includes(b[24]) || b[26] || b[27] || b[28] > 1) corrupt();
  let offset = 8, idat = 0, ended = false, palette = false, frames = 1, frameControls = 0, animated = false;
  while (offset < b.length) {
    if (offset + 12 > b.length) corrupt();
    const length = b.readUInt32BE(offset), type = b.toString('ascii', offset + 4, offset + 8), start = offset + 8;
    const end = start + length;
    if (end + 4 > b.length || !/^[A-Za-z]{4}$/.test(type) || b.readUInt32BE(end) !== crc32(b.subarray(offset + 4, end))) corrupt();
    if (type === 'IHDR' && offset !== 8) corrupt();
    if (type === 'IDAT') idat += length;
    if (type === 'PLTE') { if (!length || length % 3 || length > 768 || idat) corrupt(); palette = true; }
    if (type === 'acTL') { if (length !== 8 || animated || idat) corrupt(); frames = b.readUInt32BE(start); animated = true; dimensions(size.width, size.height, frames); }
    if (type === 'fcTL') {
      if (!animated || length !== 26) corrupt();
      const width = b.readUInt32BE(start + 4), height = b.readUInt32BE(start + 8);
      dimensions(width, height);
      if (width + b.readUInt32BE(start + 12) > size.width || height + b.readUInt32BE(start + 16) > size.height) corrupt();
      frameControls++;
    }
    if (type === 'fdAT' && (!animated || length < 5)) corrupt();
    if (type === 'IEND') { if (length || end + 4 !== b.length) corrupt(); ended = true; }
    offset = end + 4;
  }
  if (!ended || !idat || (b[25] === 3 && !palette) || (animated && frameControls !== frames)) corrupt();
  return dimensions(size.width, size.height, frames);
}
function jpegInfo(b) {
  let offset = 2, size, scanned = false, ended = false;
  while (offset < b.length) {
    if (b[offset++] !== 255) corrupt();
    while (b[offset] === 255) offset++;
    const marker = b[offset++];
    if (marker === 0xd9) { if (offset !== b.length) corrupt(); ended = true; break; }
    if (marker === 0xd8 || marker === 0 || marker >= 0xd0 && marker <= 0xd7 || offset + 2 > b.length) corrupt();
    const length = b.readUInt16BE(offset);
    if (length < 2 || offset + length > b.length) corrupt();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8 || size || length !== 8 + 3 * b[offset + 7]) corrupt();
      size = dimensions(b.readUInt16BE(offset + 5), b.readUInt16BE(offset + 3));
    }
    offset += length;
    if (marker === 0xda) {
      if (!size) corrupt();
      scanned = true;
      while (offset < b.length) {
        if (b[offset] !== 255) { offset++; continue; }
        if (b[offset + 1] === 0 || b[offset + 1] >= 0xd0 && b[offset + 1] <= 0xd7) { offset += 2; continue; }
        break;
      }
    }
  }
  if (!ended || !scanned || !size) corrupt();
  return size;
}
function gifInfo(b) {
  if (b.length < 14) corrupt();
  const size = dimensions(b.readUInt16LE(6), b.readUInt16LE(8));
  let offset = 13 + (b[10] & 128 ? 3 * (2 ** ((b[10] & 7) + 1)) : 0), frames = 0, ended = false;
  function blocks() {
    let payload = 0;
    while (offset < b.length) {
      const length = b[offset++];
      if (!length) return payload;
      if (offset + length > b.length) corrupt();
      payload += length; offset += length;
    }
    corrupt();
  }
  while (offset < b.length) {
    const block = b[offset++];
    if (block === 0x3b) { if (offset !== b.length) corrupt(); ended = true; break; }
    if (block === 0x21) { offset++; blocks(); continue; }
    if (block !== 0x2c || offset + 9 > b.length) corrupt();
    const left = b.readUInt16LE(offset), top = b.readUInt16LE(offset + 2);
    const width = b.readUInt16LE(offset + 4), height = b.readUInt16LE(offset + 6), flags = b[offset + 8];
    dimensions(width, height);
    if (left + width > size.width || top + height > size.height) corrupt();
    offset += 9 + (flags & 128 ? 3 * (2 ** ((flags & 7) + 1)) : 0);
    if (b[offset] < 2 || b[offset] > 8) corrupt();
    offset++;
    if (!blocks()) corrupt();
    frames++;
    dimensions(size.width, size.height, frames);
  }
  if (!ended || !frames) corrupt();
  return dimensions(size.width, size.height, frames);
}
function webpInfo(b) {
  if (b.length < 26 || b.readUInt32LE(4) + 8 !== b.length) corrupt();
  let size, still, frames = 0, animated = false;
  function chunks(start, end, inFrame = false) {
    let frameSize;
    for (let offset = start; offset < end;) {
      if (offset + 8 > end) corrupt();
      const type = b.toString('ascii', offset, offset + 4), length = b.readUInt32LE(offset + 4), data = offset + 8;
      const next = data + length + (length & 1);
      if (next > end) corrupt();
      let current;
      if (type === 'VP8X') {
        if (inFrame || size || length !== 10) corrupt();
        animated = !!(b[data] & 2);
        size = dimensions(1 + b.readUIntLE(data + 4, 3), 1 + b.readUIntLE(data + 7, 3));
      } else if (type === 'VP8 ') {
        if (length < 10 || b.toString('hex', data + 3, data + 6) !== '9d012a') corrupt();
        current = dimensions(b.readUInt16LE(data + 6) & 0x3fff, b.readUInt16LE(data + 8) & 0x3fff);
      } else if (type === 'VP8L') {
        if (length < 5 || b[data] !== 0x2f || b[data + 4] >> 5) corrupt();
        const bits = b.readUInt32LE(data + 1);
        current = dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      } else if (type === 'ANMF') {
        if (inFrame || !animated || !size || length < 24) corrupt();
        const width = 1 + b.readUIntLE(data + 6, 3), height = 1 + b.readUIntLE(data + 9, 3);
        if (width + 2 * b.readUIntLE(data, 3) > size.width || height + 2 * b.readUIntLE(data + 3, 3) > size.height) corrupt();
        const frame = chunks(data + 16, data + length, true);
        if (!frame || frame.width !== width || frame.height !== height) corrupt();
        frames++; dimensions(size.width, size.height, frames);
      }
      if (current) { if (frameSize) corrupt(); frameSize = current; }
      offset = next;
    }
    return frameSize;
  }
  still = chunks(12, b.length);
  if (!size) size = still;
  if (!size || (animated ? !frames || still : !still || still.width !== size.width || still.height !== size.height)) corrupt();
  return dimensions(size.width, size.height, animated ? frames : 1);
}
function imageType(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_ASSET_BYTES) fail('图片内容或大小无效，单张不能超过8 MiB', 413);
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return { extension: 'png', mimeType: 'image/png', ...pngInfo(bytes) };
  if (bytes[0] === 255 && bytes[1] === 216) return { extension: 'jpg', mimeType: 'image/jpeg', ...jpegInfo(bytes) };
  if (/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return { extension: 'gif', mimeType: 'image/gif', ...gifInfo(bytes) };
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { extension: 'webp', mimeType: 'image/webp', ...webpInfo(bytes) };
  corrupt();
}
function base64Bytes(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_ASSET_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) fail('图片 base64 内容或大小无效', 413);
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > MAX_ASSET_BYTES) fail('单张图片不能超过8 MiB', 413);
  if (bytes.toString('base64') !== value) fail('图片 base64 编码不规范');
  return bytes;
}
function checkedAssets(assets) {
  if (!Array.isArray(assets) || assets.length > MAX_ASSETS) fail('每次最多导入40张图片');
  let total = 0;
  let pixels = 0;
  const names = new Set();
  return assets.map(asset => {
    if (!asset || typeof asset !== 'object') fail('图片信息无效');
    const name = relativeName(asset.relativePath || asset.name);
    if (names.has(name)) fail('存在重复图片路径，请保留原目录结构');
    names.add(name);
    const bytes = base64Bytes(asset.dataBase64);
    total += bytes.length;
    if (total > MAX_BUNDLE_BYTES) fail('配图总大小不能超过24 MiB', 413);
    const info = imageType(bytes);
    pixels += info.width * info.height * info.frames;
    if (pixels > MAX_DECODED_PIXELS) fail('配图累计解码像素数超过安全上限', 413);
    return { name, bytes, ...info, sha256: hash(bytes) };
  });
}
function storeAssets(assets, uploadsDir) {
  const checked = checkedAssets(assets);
  fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o700 });
  const root = fs.realpathSync(uploadsDir);
  return checked.map(asset => {
    const filename = `${asset.sha256}.${asset.extension}`;
    const file = path.join(root, filename);
    try { fs.writeFileSync(file, asset.bytes, { flag: 'wx', mode: 0o600 }); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || hash(readImageFile(file)) !== asset.sha256) fail('素材缓存完整性校验失败');
    }
    return { originalPath: asset.name, filename, url: `/uploads/${filename}`, mimeType: asset.mimeType,
      sha256: asset.sha256, bytes: asset.bytes.length };
  });
}
function replaceBundleImages(html, assets, { strict = true } = {}) {
  const document = parseHTML('<!doctype html><html><head></head><body>' + html + '</body></html>').document;
  const warnings = [];
  for (const img of document.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (/^(https?:\/\/|data:|\/)/i.test(src)) {
      allowedSource(src); // Absolute local paths are not import references.
      continue;
    }
    const ref = relativeName(src);
    const normalized = assets.map(a => ({ ...a, originalPath: relativeName(a.originalPath) }));
    const exact = normalized.filter(a => a.originalPath === ref);
    const byName = normalized.filter(a => path.posix.basename(a.originalPath) === path.posix.basename(ref));
    // Directory paths carry identity. A basename fallback is only unambiguous
    // when at least one side is a flat file selection and there is one candidate.
    const found = exact.length === 1 ? exact[0] : !exact.length && byName.length === 1 &&
      (!ref.includes('/') || !byName[0].originalPath.includes('/')) ? byName[0] : null;
    if (!found) {
      if (strict) fail(`配图未找到或存在重名：${path.posix.basename(ref)}。请选择对应配图或保留目录结构。`);
      warnings.push(`配图待补：${path.posix.basename(ref)}`); continue;
    }
    img.setAttribute('src', found.url);
  }
  return { html: document.body.innerHTML, warnings };
}
function publicImageURL(src) {
  if (src.length > 8192 || !/^https?:\/\//i.test(src) || /[\x00-\x20\x7f\\]/.test(src)) fail('图片必须使用公共 http/https 地址、data:image 或已导入的 /uploads 素材');
  let url;
  try { url = new URL(src); } catch { fail('图片 URL 无效'); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.username || url.password || !host || /(^|\.)(localhost|local|internal|invalid|test)$/.test(host)) fail('图片地址不允许凭据或本机/内网资源');
  if (isIP(host) === 4) {
    const [a, b, c] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
      a === 192 && (b === 168 || b === 0) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113) fail('图片地址不允许本机、内网或保留 IP');
  } else if (host.startsWith('[')) {
    if (!/^\[[23][0-9a-f]{0,3}:/i.test(host) || /^\[2001:db8:/i.test(host)) fail('图片地址不允许本机、内网或保留 IP');
  } else if (!host.includes('.') || !/^[a-z0-9.-]+$/.test(host)) fail('图片必须使用公共域名');
  return url.href;
}
function uploadRelative(src) {
  if (src.length > 4096 || /[\x00-\x1f\x7f\\]/.test(src)) fail('工作台素材路径无效');
  let decoded;
  try { decoded = decodeURIComponent(src.split(/[?#]/)[0]); } catch { fail('工作台素材路径编码无效'); }
  if (!decoded.startsWith('/uploads/')) fail('未导入的本地图片路径禁止进入 CLI，请先导入素材');
  return decodedRelativeName(decoded.slice('/uploads/'.length));
}
function allowedSource(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\x00-\x1f\x7f]/.test(value)) fail('图片来源为空或包含非法空白');
  if (/^https?:\/\//i.test(value)) return { kind: 'remote', src: publicImageURL(value) };
  if (/^data:/i.test(value)) {
    const match = value.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/i);
    if (!match) fail('仅支持 PNG、JPEG、GIF、WebP 的 base64 data:image');
    const bytes = base64Bytes(match[2]);
    const info = imageType(bytes);
    if (match[1].toLowerCase() !== info.mimeType) fail('data:image 类型与文件内容不一致', 415);
    return { kind: 'data', src: `data:${info.mimeType};base64,${bytes.toString('base64')}` };
  }
  if (value.startsWith('/') || /^%2f/i.test(value)) return { kind: 'upload', relative: uploadRelative(value) };
  fail('未导入的 file:、绝对或相对本地图片路径禁止进入 CLI，请先导入素材');
}
function localUploadedFile(url, uploadsDir) {
  const relative = uploadRelative(url);
  const root = fs.realpathSync(uploadsDir);
  const filename = path.join(root, relative);
  if (!fs.existsSync(filename)) fail('配图文件不存在，请重新导入对应图片');
  const real = fs.realpathSync(filename);
  if (!real.startsWith(root + path.sep) || !fs.statSync(real).isFile()) fail('素材路径越界');
  const stat = fs.statSync(real);
  if (stat.size > MAX_ASSET_BYTES) fail('配图超过读取上限', 413);
  return real;
}
function readImageFile(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_ASSET_BYTES) fail('配图不是常规文件或超过8 MiB读取上限', 413);
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function rawImageTags(html) {
  const tags = [], pattern = /<img\b/gi;
  let match;
  while ((match = pattern.exec(html))) {
    let quote = '', end = pattern.lastIndex;
    for (; end < html.length; end++) {
      const char = html[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === html.length) fail('图片标签未闭合，请修复 HTML 后导入');
    if (tags.length >= 1000) fail('正文图片标签数量超过安全上限', 413);
    tags.push(html.slice(match.index, end + 1));
    pattern.lastIndex = end + 1;
  }
  return tags;
}
function inlineUploadedAssets(source, uploadsDir) {
  const input = String(source);
  if (Buffer.byteLength(input) > 48 * 1024 * 1024) fail('正文图片内容超过读取上限', 413);
  rawImageTags(input); // Reject partial tags that another parser could repair.
  const { document } = parseHTML(input);
  const images = Array.from(document.querySelectorAll('img'));
  const checked = images.map(img => ({ img, source: allowedSource(img.getAttribute('src') || '') }));
  for (const { img, source: ref } of checked) {
    let src = ref.src;
    if (ref.kind === 'upload') {
      const file = localUploadedFile(img.getAttribute('src'), uploadsDir);
      const bytes = readImageFile(file);
      src = `data:${imageType(bytes).mimeType};base64,${bytes.toString('base64')}`;
    }
    for (const attr of Array.from(img.attributes)) {
      if (attr.name !== 'src' && (/src/i.test(attr.name) || ['sizes', 'data-original'].includes(attr.name))) img.removeAttribute(attr.name);
    }
    img.setAttribute('src', src);
  }
  for (const source of document.querySelectorAll('picture source')) source.remove();
  const output = images.length ? document.toString() : input;
  // The downstream CLI scans raw strings, including templates/comments/code and
  // misleading *src attributes. Refuse any residual local interpretation there.
  const rawSources = [...output.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
  for (const tag of rawImageTags(output)) {
    const img = parseHTML(tag).document.querySelector('img');
    if (img) rawSources.push(img.getAttribute('src') || '');
  }
  rawSources.push(...[...output.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1].trim()));
  for (const src of rawSources) {
    const ref = allowedSource(src);
    if (ref.kind === 'upload') fail('正文隐藏内容仍含本地素材引用，禁止交给 CLI 读取');
    if (!/^(?:https?:\/\/|data:image\/)/.test(src)) fail('正文图片引用格式与 CLI 不兼容');
  }
  return output;
}

function boundedOption(value, fallback, max, name) {
  const result = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(result) || result < 1 || result > max) fail(`${name} 超过允许范围`);
  return result;
}
function localChromium(injected) {
  if (injected) return injected;
  try { return loadChromium(); } catch (error) { fail(error.message, 503); }
}
function timed(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => { const error = new Error('图片解码超时，已拒绝导入'); error.statusCode = 408; reject(error); }, ms);
  })]).finally(() => clearTimeout(timer));
}

/**
 * Validate an import bundle BEFORE storeAssets. This function writes no files or
 * article content. It rechecks strict base64, sizes, structural headers and pixel
 * budgets, then fully decodes every image/frame in an isolated offline Chrome.
 * Returns metadata[], while the caller still passes its original assets to storeAssets.
 * chromium/executablePath are trusted dependency injection options, never body fields.
 */
async function validateAssetImages(assets, opts = {}) {
  const checked = checkedAssets(assets);
  const timeoutMs = boundedOption(opts.timeoutMs, 10000, 30000, 'timeoutMs');
  const totalTimeoutMs = boundedOption(opts.totalTimeoutMs, 30000, 60000, 'totalTimeoutMs');
  const maxDimension = boundedOption(opts.maxDimension, MAX_DIMENSION, MAX_DIMENSION, 'maxDimension');
  const maxPixels = boundedOption(opts.maxPixels, MAX_IMAGE_PIXELS, MAX_IMAGE_PIXELS, 'maxPixels');
  const maxTotalPixels = boundedOption(opts.maxTotalPixels, MAX_DECODED_PIXELS, MAX_DECODED_PIXELS, 'maxTotalPixels');
  let totalPixels = 0;
  for (const asset of checked) {
    totalPixels += asset.width * asset.height * asset.frames;
    if (asset.width > maxDimension || asset.height > maxDimension || asset.width * asset.height > maxPixels || totalPixels > maxTotalPixels) fail('配图尺寸或累计解码像素超过安全上限', 413);
  }
  if (!checked.length) return [];
  const deadline = Date.now() + totalTimeoutMs;
  const remaining = () => {
    const ms = deadline - Date.now();
    if (ms <= 0) fail('图片解码超时，已拒绝导入', 408);
    return Math.min(ms, timeoutMs);
  };
  let browser;
  let current = -1;
  try {
    browser = await localChromium(opts.chromium).launch({ headless: true,
      executablePath: opts.executablePath || (opts.chromium ? undefined : resolveBrowserPath()),
      timeout: remaining(), args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });
    const context = await timed(browser.newContext({ javaScriptEnabled: false, offline: true,
      serviceWorkers: 'block', acceptDownloads: false }), remaining());
    // ImageDecoder requires a secure context. Fulfill this one synthetic page
    // entirely from memory; every other request is aborted before network access.
    const origin = 'https://asset-decoder.invalid/';
    await timed(context.route('**/*', route => route.request().url() === origin && route.request().isNavigationRequest()
      ? route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; connect-src \'none\'; img-src \'none\'; frame-src \'none\'; base-uri \'none\'; form-action \'none\'">' })
      : route.abort('blockedbyclient')), remaining());
    const page = await timed(context.newPage(), remaining());
    await page.goto(origin, { timeout: remaining(), waitUntil: 'load' });
    const result = [];
    for (let i = 0; i < checked.length; i++) {
      current = i;
      const asset = checked[i];
      const decoded = await timed(page.evaluate(async input => {
        if (typeof ImageDecoder === 'undefined' || !await ImageDecoder.isTypeSupported(input.mimeType)) return { error: 'unsupported' };
        const data = Uint8Array.from(atob(input.base64), c => c.charCodeAt(0));
        const decoder = new ImageDecoder({ type: input.mimeType, data, preferAnimation: true });
        try {
          await decoder.tracks.ready;
          const count = decoder.tracks.selectedTrack?.frameCount;
          if (!count || count !== input.frames || count > input.maxFrames) return { error: 'frames' };
          let width = 0, height = 0;
          for (let frameIndex = 0; frameIndex < count; frameIndex++) {
            const frame = await decoder.decode({ frameIndex, completeFramesOnly: true });
            try {
              width = frame.image.displayWidth; height = frame.image.displayHeight;
              if (!frame.complete || !width || !height || width > input.maxDimension || height > input.maxDimension || width * height > input.maxPixels ||
                !((width === input.width && height === input.height) || (width === input.height && height === input.width))) return { error: 'dimensions' };
            } finally { frame.image.close(); }
          }
          return { width, height, frames: count };
        } catch { return { error: 'decode' }; } finally { decoder.close(); }
      }, { base64: asset.bytes.toString('base64'), mimeType: asset.mimeType, width: asset.width, height: asset.height,
        frames: asset.frames, maxDimension, maxPixels, maxFrames: MAX_FRAMES }), remaining());
      if (decoded.error) fail(`第 ${i + 1} 张图片无法完整解码或尺寸不一致，已拒绝导入`, decoded.error === 'unsupported' ? 503 : 415);
      result.push({ originalPath: asset.name, mimeType: asset.mimeType, width: decoded.width, height: decoded.height,
        frames: decoded.frames, bytes: asset.bytes.length, sha256: asset.sha256 });
    }
    return result;
  } catch (error) {
    if (error.statusCode) throw error;
    fail(current < 0 ? '本机离线图片解码器启动失败' : `第 ${current + 1} 张图片解码失败，已拒绝导入`, current < 0 ? 503 : 415);
  } finally {
    if (browser) await timed(browser.close(), 2000).catch(() => {});
  }
}

function importedAssetsFromBundle(bundle, allowedRoot) {
  const root = fs.realpathSync(allowedRoot);
  const assets = bundle.assets || [];
  if (!Array.isArray(assets) || assets.length > MAX_ASSETS) fail('每次最多导入40张图片');
  let total = 0;
  return assets.map(asset => {
    const file = fs.realpathSync(asset.absolutePath);
    if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) fail('导出配图路径越界');
    const bytes = readImageFile(file);
    total += bytes.length;
    if (total > MAX_BUNDLE_BYTES) fail('配图总大小不能超过24 MiB', 413);
    return { relativePath: asset.relativePath || asset.filename, dataBase64: bytes.toString('base64') };
  });
}
module.exports = { storeAssets, replaceBundleImages, inlineUploadedAssets, importedAssetsFromBundle,
  validateAssetImages, relativeName, imageType, MAX_ASSET_BYTES, MAX_BUNDLE_BYTES, MAX_ASSETS };
