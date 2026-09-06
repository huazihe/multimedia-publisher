'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { Marked } = require('marked');
const requireFromCore = createRequire(path.resolve(__dirname, '../packages/core/package.json'));
const { parseHTML } = (() => {
  try { return require('linkedom'); } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return requireFromCore('linkedom');
  }
})();
const markdownParser = new Marked();

const DEFAULT_OUTPUT_ROOT = path.join(__dirname, 'data', 'feishu-imports');
// Use the installed native CLI, not its JS launcher (which can auto-install and
// leave a child running after a launcher timeout). Never inspect CLI credentials.
const DEFAULT_CLI_PATH = process.env.PUBLISHER_LARK_CLI || path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', '@larksuite', 'cli', 'bin', 'lark-cli');
const DEFAULT_PROFILE = process.env.PUBLISHER_FEISHU_PROFILE || 'misshe-personal';
const PROFILES = new Set([DEFAULT_PROFILE, 'enterprise-reader']);
const RESOURCE_ID = /^[A-Za-z0-9]{10,128}$/;
const FEISHU_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)?(?:feishu\.cn|larksuite\.com)$/;
const MAX_MARKDOWN_BYTES = 8 * 1024 * 1024;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 128 * 1024 * 1024;
const MAX_IMAGES = 100;

class FeishuImportError extends Error {
  constructor(code, message, statusCode = 502) {
    super(message);
    this.name = 'FeishuImportError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function fail(code, message, statusCode) {
  throw new FeishuImportError(code, message, statusCode);
}

function validateFeishuUrl(input) {
  if (typeof input !== 'string' || input.length > 2048 || /[\s\\\u0000-\u001f\u007f]/u.test(input)) {
    fail('INVALID_URL', '飞书链接格式或长度无效。', 400);
  }
  // Validate the raw spelling before URL normalization can hide ../, escaped
  // separators, userinfo, a port, IDN lookalikes, or trailing-dot hostnames.
  const match = input.match(/^https:\/\/([a-z0-9.-]+)\/(docx|wiki)\/([A-Za-z0-9]{10,128})\/?(?:[?#][^\s]*)?$/);
  const host = match?.[1];
  if (!match || !FEISHU_HOST.test(host)) {
    fail('INVALID_URL', '只支持 HTTPS 飞书或 Lark 的 docx、wiki 文档链接。', 400);
  }
  return { url: `https://${host}/${match[2]}/${match[3]}`, type: match[2], id: match[3] };
}

function cliFailure(error, diagnostic = '') {
  // Deliberately never return stderr, stdout, an upstream message, or a cause.
  // These can contain credentials, URLs with secrets, and user-controlled text.
  const hint = `${error?.code || ''} ${error?.message || ''} ${error?.stderr || ''} ${diagnostic}`;
  if (/missing_scope|insufficient.scope|permission_violations/i.test(hint)) {
    return new FeishuImportError('FEISHU_MISSING_SCOPE', '飞书读取权限不足；已停止导出，未切换身份或修改权限。', 403);
  }
  if (/token_missing|needs_refresh|need_user_authorization|token_expired|invalid_access_token|99991663|99991668/i.test(hint)) {
    return new FeishuImportError('FEISHU_AUTH_REQUIRED', '当前飞书用户授权不可用或已过期；请在应用外处理授权后重试。', 401);
  }
  if (/permission_denied|permission denied|forbidden|\b403\b/i.test(hint)) {
    return new FeishuImportError('FEISHU_PERMISSION_DENIED', '飞书拒绝读取文档或下载原图；已停止导出。', 403);
  }
  if (error?.killed || error?.signal || /ETIMEDOUT|ABORT_ERR/i.test(hint)) {
    return new FeishuImportError('FEISHU_TIMEOUT', '飞书导出超时；未导入不完整内容。', 504);
  }
  if (error?.code === 'ENOENT') {
    return new FeishuImportError('FEISHU_CLI_UNAVAILABLE', '未找到已安装的飞书 CLI；未自动安装或修改配置。', 503);
  }
  return new FeishuImportError('FEISHU_CLI_FAILED', '飞书 CLI 读取或下载失败；未导入不完整内容。');
}

function commandRunner(profile, deps) {
  const timeoutMs = deps.timeoutMs ?? 30000;
  const totalTimeoutMs = deps.totalTimeoutMs ?? 180000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000
      || !Number.isInteger(totalTimeoutMs) || totalTimeoutMs < 1 || totalTimeoutMs > 300000) {
    fail('INVALID_OPTIONS', '导出超时设置超出允许范围。', 400);
  }
  const cliPath = deps.cliPath ?? DEFAULT_CLI_PATH;
  if (typeof cliPath !== 'string' || !path.isAbsolute(cliPath) || /[\u0000-\u001f]/u.test(cliPath)) {
    fail('INVALID_OPTIONS', 'CLI 路径必须是服务端配置的绝对路径。', 400);
  }
  const execute = deps.execFile ?? execFile;
  const started = performance.now();
  return async (args, cwd) => {
    const remaining = Math.floor(totalTimeoutMs - (performance.now() - started));
    if (remaining < 1) fail('FEISHU_TIMEOUT', '飞书导出超过总时间限制。', 504);
    let result;
    try {
      result = await new Promise((resolve, reject) => execute(cliPath, ['--profile', profile, '--as', 'user', ...args], {
        shell: false,
        encoding: 'utf8',
        timeout: Math.min(timeoutMs, remaining),
        killSignal: 'SIGKILL',
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        cwd,
      }, (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stderr }));
        else resolve({ stdout, stderr });
      }));
    } catch (error) {
      throw cliFailure(error);
    }
    if (/\[identity:\s*bot\]/i.test(result.stderr || '')) {
      fail('FEISHU_WRONG_IDENTITY', 'CLI 未使用 user 身份；已停止导出。', 403);
    }
    let response;
    try {
      response = JSON.parse(result.stdout);
    } catch {
      throw cliFailure(null, result.stderr);
    }
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      fail('FEISHU_INVALID_RESPONSE', '飞书 CLI 返回格式无效。');
    }
    if (response.identity != null && response.identity !== 'user') {
      fail('FEISHU_WRONG_IDENTITY', 'CLI 未使用 user 身份；已停止导出。', 403);
    }
    if (response.ok === false || response.success === false || response.error
        || (response.code != null && response.code !== 0 && response.code !== '0')) {
      throw cliFailure(null, JSON.stringify(response));
    }
    if (response.dry_run) fail('FEISHU_INVALID_RESPONSE', '飞书 CLI 只返回了预演结果，未读取真实内容。');
    return response;
  };
}

function readDocument(response, expectedId) {
  const data = response.data ?? response;
  const document = data.document ?? data;
  // Current +fetch performs the full read internally and exposes no offset /
  // limit / page-token flags. Do not invent continuation requests or accept a
  // partial result. Older JSON-shaped fixtures can be read, but not old flags.
  for (const object of [response, data, document, data.pagination, document.pagination]) {
    if (!object || typeof object !== 'object') continue;
    if (['has_more', 'hasMore', 'truncated', 'is_truncated', 'partial'].some(key => object[key] != null && object[key] !== false && object[key] !== 0)
        || ['next_page_token', 'nextPageToken', 'page_token', 'next_cursor'].some(key => Boolean(object[key]))) {
      fail('FEISHU_INCOMPLETE_DOCUMENT', '飞书返回了分页或截断内容，当前 CLI 不提供续页参数；导出已停止。');
    }
  }
  if (document.document_id != null && document.document_id !== expectedId) {
    fail('FEISHU_DOCUMENT_MISMATCH', '飞书返回的文档与请求不一致。');
  }
  const markdown = document.content ?? document.markdown ?? data.markdown;
  if (typeof markdown !== 'string' || Buffer.byteLength(markdown) > MAX_MARKDOWN_BYTES) {
    fail('FEISHU_INVALID_DOCUMENT', '飞书正文缺失、格式无效或超过大小限制。');
  }
  if (/^\s*<(?:fragment|excerpt)\b/i.test(markdown)
      || /truncat|incomplete|partial|截断|不完整/i.test(String(document.tips || ''))) {
    fail('FEISHU_INCOMPLETE_DOCUMENT', '飞书返回了局部内容或截断提示；导出已停止。');
  }
  return {
    markdown,
    title: document.title ?? data.title,
    references: document.reference_map ?? data.reference_map ?? {},
    hasTips: Boolean(document.tips),
  };
}

function decodeEntities(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d{1,7}|#x[0-9a-f]{1,6});/gi, entity => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const hex = /^&#x/i.test(entity);
    const value = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : '\ufffd';
  });
}

function attributes(tag) {
  const attrs = Object.create(null);
  const body = tag.replace(/^<\w+\b/, '').replace(/\/?\s*>$/, '');
  const pattern = /\s+([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let end = 0;
  for (const match of body.matchAll(pattern)) {
    if (body.slice(end, match.index).trim() || Object.hasOwn(attrs, match[1].toLowerCase())) {
      fail('FEISHU_INVALID_IMAGE', '飞书图片属性格式无效。');
    }
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3]);
    end = match.index + match[0].length;
  }
  if (body.slice(end).trim()) fail('FEISHU_INVALID_IMAGE', '飞书图片属性格式无效。');
  return attrs;
}

// Use the workbench's Markdown grammar to distinguish container indentation
// from real code. Lists/quotes remove prefixes (including expanded tabs), but
// retain their internal line order. Map code-token lines back to the original
// source, retaining CRLF and all untouched bytes instead of serializing the AST.
function codeMask(markdown) {
  const mask = new Uint8Array(markdown.length);
  const lines = [...markdown.matchAll(/[^\r\n]*(?:\r\n|[\r\n]|$)/g)];
  const normalized = markdown.replace(/\r\n?/g, '\n');
  const newlineCount = text => (text.match(/\n/g) || []).length;
  function visit(tokens, source, firstLine) {
    let cursor = 0;
    let line = firstLine;
    for (const token of tokens) {
      // Marked emits a synthetic checkbox token after removing that prefix from
      // list_item.text. It has no independent source line and cannot hold code.
      if (token.type === 'checkbox') continue;
      const start = source.indexOf(token.raw, cursor);
      if (start < 0) fail('FEISHU_MARKDOWN_PARSE_FAILED', '无法将 Markdown 代码块定位到原文；导出已停止。', 422);
      line += newlineCount(source.slice(cursor, start));
      if (token.type === 'code') {
        const lastLine = line + newlineCount(token.raw.replace(/\n$/, ''));
        if (!lines[line] || !lines[lastLine]) fail('FEISHU_MARKDOWN_PARSE_FAILED', 'Markdown 代码块位置无效。', 422);
        mask.fill(1, lines[line].index, lines[lastLine].index + lines[lastLine][0].length);
      } else if (token.type === 'list') {
        visit(token.items, token.raw, line);
      } else if (token.type === 'list_item' || token.type === 'blockquote') {
        visit(token.tokens, token.text, line);
      }
      cursor = start + token.raw.length;
      line += newlineCount(token.raw);
    }
  }
  visit(markdownParser.lexer(normalized), normalized, 0);
  for (const match of markdown.matchAll(/<!--[^]*?(?:-->|$)|<(pre|code)\b[^>]*>[^]*?(?:<\/\1\s*>|$)/gi)) {
    if (!mask[match.index]) mask.fill(1, match.index, match.index + match[0].length);
  }
  for (let i = 0; i < markdown.length; i++) {
    if (mask[i] || markdown[i] !== '`' || isEscaped(markdown, i)) continue;
    let length = 1;
    while (markdown[i + length] === '`') length++;
    let end = i + length;
    while (end < markdown.length) {
      if (mask[end] || markdown[end] !== '`') { end++; continue; }
      let closeLength = 1;
      while (markdown[end + closeLength] === '`') closeLength++;
      if (closeLength === length) {
        mask.fill(1, i, end + closeLength);
        i = end + closeLength - 1;
        break;
      }
      end += closeLength;
    }
    if (end >= markdown.length) i += length - 1;
  }
  return mask;
}

function isEscaped(text, index) {
  let count = 0;
  while (index > 0 && text[--index] === '\\') count++;
  return count % 2 === 1;
}

function imageResource(attrs, references) {
  let token = attrs.token;
  const key = attrs.ref ?? attrs['data-ref'] ?? token ?? attrs.src;
  for (const group of ['img', 'image']) {
    const map = references?.[group];
    if (key != null && map && Object.hasOwn(map, key)) {
      const entry = map[key];
      if (!entry || typeof entry !== 'object') fail('FEISHU_INVALID_IMAGE', '飞书图片引用无效。');
      token = entry.token ?? entry.file_token ?? entry.src;
      break;
    }
  }
  token ??= attrs.src;
  if (typeof token !== 'string' || !RESOURCE_ID.test(token)) {
    fail('FEISHU_UNSUPPORTED_IMAGE', '图片缺少有效的飞书素材标识；未下载外部 URL 或未解析的引用。', 422);
  }
  return token;
}

function markdownResource(destination) {
  if (RESOURCE_ID.test(destination)) return destination;
  // The installed CLI (1.0.91) emits Markdown image destinations in this form.
  // Extract its media identifier and use +media-download; NEVER request the URL.
  const match = destination.length <= 2048 && destination.match(/^https:\/\/([a-z0-9.-]+)\/file\/([A-Za-z0-9]{10,128})$/);
  if (match && FEISHU_HOST.test(match[1])) return match[2];
  fail('FEISHU_UNSUPPORTED_IMAGE', '图片不是飞书素材引用；未请求外部图片 URL。', 422);
}

function markdownImageAt(markdown, start) {
  let depth = 1;
  let endAlt = start + 2;
  for (; endAlt < markdown.length && depth; endAlt++) {
    if (isEscaped(markdown, endAlt)) continue;
    if (markdown[endAlt] === '[') depth++;
    if (markdown[endAlt] === ']') depth--;
  }
  if (depth) return null;
  const match = markdown.slice(endAlt).match(/^\([ \t]*(?:<([^<>\n]*)>|([^\s()<>\n]+))([ \t]+(?:"(?:\\.|[^"\n])*"|'(?:\\.|[^'\n])*'|\((?:\\.|[^)\n])*\)))?[ \t]*\)/);
  if (!match) return null;
  const destination = match[1] ?? match[2];
  const destinationStart = endAlt + match[0].indexOf(destination);
  const end = endAlt + match[0].length;
  return {
    start, end, token: markdownResource(destination),
    before: markdown.slice(start, destinationStart),
    after: markdown.slice(destinationStart + destination.length, end),
  };
}

function collectImages(markdown, references, warnings) {
  const mask = codeMask(markdown);
  const images = [];
  for (const match of markdown.matchAll(/!\[/g)) {
    if (mask[match.index] || isEscaped(markdown, match.index) || images.some(image => match.index < image.end)) continue;
    const image = markdownImageAt(markdown, match.index);
    if (!image) fail('FEISHU_UNSUPPORTED_IMAGE', '存在无法解析的 Markdown 图片引用；导出已停止。', 422);
    images.push(image);
  }
  const tags = /<(img|image)\b(?:"[^"]*"|'[^']*'|[^'">])*\/?\s*>(?:\s*<\/\1\s*>)?/gi;
  for (const match of markdown.matchAll(tags)) {
    if (mask[match.index] || isEscaped(markdown, match.index) || images.some(image => match.index >= image.start && match.index < image.end)) continue;
    const opening = match[0].replace(/\s*<\/(?:img|image)\s*>$/i, '');
    const attrs = attributes(opening);
    images.push({ start: match.index, end: match.index + match[0].length, token: imageResource(attrs, references), alt: attrs.alt ?? attrs.caption ?? attrs.name ?? '' });
  }
  if (images.length > 1000) fail('FEISHU_TOO_MANY_IMAGES', '图片插入位置超过导出上限。', 422);
  images.sort((a, b) => a.start - b.start);
  // Markdown/HTML URL images must not trigger a second downloader or silently
  // appear as successfully localized. Ordinary text hyperlinks are preserved.
  for (const match of markdown.matchAll(/!\[|<(?:img|image)\b/gi)) {
    if (mask[match.index] || isEscaped(markdown, match.index)) continue;
    if (!images.some(image => match.index >= image.start && match.index < image.end)) {
      fail('FEISHU_UNSUPPORTED_IMAGE', '存在未能本地化的图片语法或外部图片；导出已停止。', 422);
    }
  }
  let unsupported = false;
  for (const match of markdown.matchAll(/<(?:file|source|whiteboard|sheet|bitable|iframe|video|audio)\b/gi)) {
    if (!mask[match.index] && !isEscaped(markdown, match.index)) unsupported = true;
  }
  if (unsupported) warnings.push('文档含附件、画板或其他嵌入内容；已保留原标记，仅下载图片原图。');
  return images;
}

function verifyRenderedImages(markdown, images, byToken) {
  // Parsing HTML is offline: it neither executes scripts nor requests URLs.
  // Inspect the rendered DOM as well as the lexical collector so a missed image
  // can never silently survive as a remote (including permission-gated) source.
  const { document } = parseHTML(markdownParser.parse(markdown));
  const rendered = [...document.querySelectorAll('img, image')];
  const expected = images.map(image => byToken.get(image.token).relativePath);
  if (rendered.length !== expected.length || rendered.some((image, index) => (
    image.getAttribute('src') !== expected[index] || image.hasAttribute('srcset')
  ))) {
    fail('FEISHU_IMAGE_REFERENCE_MISMATCH', '渲染图片与已下载的本地原图引用不一致；导出已停止。', 422);
  }
}

function safeTitle(title, markdown, id) {
  if (typeof title !== 'string' || !title.trim()) {
    const heading = markdown.match(/^ {0,3}#\s+(.+?)\s*#*\s*$/m);
    title = heading?.[1] ?? `飞书文档-${id}`;
  }
  return title.toWellFormed().replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, 500);
}

async function prepareRoot(outputRoot) {
  if (typeof outputRoot !== 'string' || outputRoot.length > 4096 || !path.isAbsolute(outputRoot)
      || /[\u0000-\u001f\u007f]/u.test(outputRoot) || outputRoot.split(path.sep).includes('..')) {
    fail('INVALID_OUTPUT_ROOT', '导出目录必须是服务端指定的安全绝对路径。', 400);
  }
  const root = path.resolve(outputRoot);
  if ([path.parse(root).root, os.homedir(), __dirname, path.dirname(__dirname)].includes(root)) {
    fail('INVALID_OUTPUT_ROOT', '请使用专用导出目录。', 400);
  }
  // Check each existing parent before creating anything. The caller should
  // canonicalize OS temp aliases (e.g. /tmp on macOS); symlinks are not followed.
  let current = path.parse(root).root;
  for (const segment of root.slice(current.length).split(path.sep)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail('UNSAFE_OUTPUT_PATH', '导出目录包含符号链接或非目录路径。', 400);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try { await fs.mkdir(current, { mode: 0o700 }); } catch (mkdirError) {
        if (mkdirError.code !== 'EEXIST') throw mkdirError;
      }
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail('UNSAFE_OUTPUT_PATH', '导出目录在创建时发生变化。', 400);
    }
  }
  if (await fs.realpath(root) !== root) fail('UNSAFE_OUTPUT_PATH', '导出目录不再位于预期位置。', 400);
  return root;
}

function imageType(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) && bytes.readUInt32BE(20)) return ['png', 'image/png'];
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return ['jpg', 'image/jpeg'];
  if (bytes.length >= 13 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))
      && bytes.readUInt16LE(6) && bytes.readUInt16LE(8)) return ['gif', 'image/gif'];
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
      && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))) return ['webp', 'image/webp'];
  if (bytes.length >= 26 && bytes.toString('ascii', 0, 2) === 'BM' && bytes.readUInt32LE(2) === bytes.length) return ['bmp', 'image/bmp'];
  if (bytes.length >= 16 && bytes.toString('ascii', 4, 8) === 'ftyp'
      && ['avif', 'avis'].includes(bytes.toString('ascii', 8, 12))) return ['avif', 'image/avif'];
  // SVG is deliberately excluded: it can embed scripts and remote resources.
  fail('FEISHU_UNSAFE_MEDIA', '下载内容不是受支持的原始图片格式；未保留可执行文件、SVG 或未知二进制。', 422);
}

async function readDownloadedImage(filename) {
  let handle;
  try {
    handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o111) || stat.size < 1 || stat.size > MAX_ASSET_BYTES) {
      fail('FEISHU_UNSAFE_MEDIA', '图片文件类型、权限或大小无效。', 422);
    }
    const bytes = await handle.readFile();
    if (bytes.length !== stat.size || bytes.length > MAX_ASSET_BYTES) fail('FEISHU_UNSAFE_MEDIA', '图片在校验期间发生变化。', 422);
    return bytes;
  } catch (error) {
    if (error instanceof FeishuImportError) throw error;
    fail('FEISHU_IMAGE_DOWNLOAD_FAILED', 'CLI 未在指定位置写入可读取的原图；导出已停止。');
  } finally {
    await handle?.close();
  }
}

/**
 * Export only; no DB writes, workbench insertion, auth changes, or publishing.
 *
 * outputRoot is trusted SERVER configuration, never an HTTP request field.
 * A fresh 0700 bundle is created per call; original.md is written last with wx.
 * The integration may copy assets into uploads and rewrite its own Markdown
 * string, but should preserve original.md and its relative assets/... links.
 *
 * deps: { execFile } uses Node's callback signature (for tests); cliPath is an
 * absolute installed executable; timeoutMs <= 60000, totalTimeoutMs <= 300000.
 * Errors expose only stable code/message/statusCode, never raw CLI diagnostics.
 */
async function exportFeishuDocument({ url, profile = DEFAULT_PROFILE, outputRoot = DEFAULT_OUTPUT_ROOT } = {}, deps = {}) {
  const source = validateFeishuUrl(url);
  if (!PROFILES.has(profile)) fail('INVALID_PROFILE', '仅支持个人 user 或企业只读 user profile。', 400);
  const run = commandRunner(profile, deps);
  let bundleDir;
  try {
    // Validate output paths before invoking the CLI, and never derive filenames
    // or output destinations from document titles, media names, or CLI stdout.
    const root = await prepareRoot(outputRoot);
    let documentId = source.id;
    let wikiTitle;
    if (source.type === 'wiki') {
      const result = await run(['wiki', 'spaces', 'get_node', '--token', source.id, '--format', 'json']);
      const node = result.data?.node ?? result.node;
      if (node?.obj_type !== 'docx') fail('FEISHU_UNSUPPORTED_DOCUMENT', 'Wiki 目标不是新版 docx 云文档，无法导出。', 422);
      if (typeof node.obj_token !== 'string' || !RESOURCE_ID.test(node.obj_token)) fail('FEISHU_INVALID_RESPONSE', 'Wiki 未返回有效的文档标识。');
      documentId = node.obj_token;
      wikiTitle = node.title;
    }
    const result = await run(['docs', '+fetch', '--doc', documentId, '--doc-format', 'markdown', '--scope', 'full', '--detail', 'simple']);
    const document = readDocument(result, documentId);
    const warnings = [];
    if (document.hasTips) warnings.push('飞书返回了读取提示；正文已导出，未执行提示中的操作。');
    const images = collectImages(document.markdown, document.references, warnings);
    const uniqueTokens = [...new Set(images.map(image => image.token))];
    if (uniqueTokens.length > MAX_IMAGES) fail('FEISHU_TOO_MANY_IMAGES', '文档原图数量超过导出上限。', 422);
    bundleDir = await fs.mkdtemp(path.join(root, 'feishu-'));
    await fs.chmod(bundleDir, 0o700);
    const assetDir = path.join(bundleDir, 'assets');
    if (uniqueTokens.length) await fs.mkdir(assetDir, { mode: 0o700 });
    const assets = [];
    const byToken = new Map();
    let totalBytes = 0;
    for (const token of uniqueTokens) {
      const stem = `image-${String(assets.length + 1).padStart(4, '0')}`;
      // A fixed extension disables CLI Content-Type/filename-based auto-renaming.
      const downloadedPath = path.join(assetDir, `${stem}.download`);
      // Current CLI rejects absolute --output paths at execution time (not in
      // dry-run). Pin cwd to our private assets directory and pass one basename.
      await run(['docs', '+media-download', '--token', token, '--output', `${stem}.download`, '--type', 'media', '--format', 'json'], assetDir);
      const bytes = await readDownloadedImage(downloadedPath);
      const [extension, mimeType] = imageType(bytes);
      totalBytes += bytes.length;
      if (totalBytes > MAX_BUNDLE_BYTES) fail('FEISHU_MEDIA_LIMIT', '文档图片总大小超过导出上限。', 422);
      const filename = `${stem}.${extension}`;
      const absolutePath = path.join(assetDir, filename);
      await fs.writeFile(absolutePath, bytes, { flag: 'wx', mode: 0o600 });
      await fs.unlink(downloadedPath);
      const asset = { relativePath: `assets/${filename}`, absolutePath, filename, mimeType, sha256: createHash('sha256').update(bytes).digest('hex') };
      byToken.set(token, asset);
      assets.push(asset);
    }
    let markdown = '';
    let cursor = 0;
    for (const image of images) {
      const relativePath = byToken.get(image.token).relativePath;
      const alt = (image.alt ?? '').replace(/[\r\n]/g, ' ').replace(/[\\\[\]<>]/g, char => `\\${char}`);
      const replacement = image.before != null ? image.before + relativePath + image.after : `![${alt}](${relativePath})`;
      markdown += document.markdown.slice(cursor, image.start) + replacement;
      cursor = image.end;
    }
    markdown += document.markdown.slice(cursor);
    verifyRenderedImages(markdown, images, byToken);
    const markdownPath = path.join(bundleDir, 'original.md');
    await fs.writeFile(markdownPath, markdown, { flag: 'wx', mode: 0o600 });
    return {
      title: safeTitle(document.title ?? wikiTitle, markdown, documentId), markdown, assets, warnings,
      source: { url: source.url, documentId, profile }, bundleDir, markdownPath,
    };
  } catch (error) {
    // Only the private directory created by this call is removed. A failed
    // download must not leave a bundle that the workbench can mistake for done.
    if (bundleDir) {
      try { await fs.rm(bundleDir, { recursive: true, force: true }); } catch {
        fail('FEISHU_CLEANUP_FAILED', '导出失败且临时目录未能清理；请检查专用导出目录。', 500);
      }
    }
    if (error instanceof FeishuImportError) throw error;
    fail('FEISHU_LOCAL_IO_FAILED', '本地导出文件读写失败。', 500);
  }
}

module.exports = { exportFeishuDocument, FeishuImportError, DEFAULT_OUTPUT_ROOT, DEFAULT_CLI_PATH };
