'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { loadChromium: loadProjectChromium, resolveBrowserPath } = require('../runtime/browser.cjs');
const { createHash, randomBytes } = require('node:crypto');
const { createRequire } = require('node:module');

const requireFromCore = createRequire(path.join(__dirname, '../packages/core/package.json'));
const { parseHTML } = (() => {
  try { return require('linkedom'); } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return requireFromCore('linkedom');
  }
})();

const LIMITS = Object.freeze({
  inputBytes: 4 * 1024 * 1024, tables: 20, rows: 1000, totalRows: 2000,
  columns: 24, cellChars: 10000, tableChars: 100000, totalChars: 250000,
  nodes: 50000, depth: 64, images: 160, imageBytes: 8 * 1024 * 1024,
  totalImageBytes: 64 * 1024 * 1024,
});
const STYLE_VERSION = 'table-text-v1';
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META',
  'BASE', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'VIDEO', 'AUDIO', 'CANVAS', 'INPUT']);
const BLOCKS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'PRE', 'BLOCKQUOTE', 'SECTION', 'H1', 'H2', 'H3']);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function bound(value, fallback, min, max, name) {
  const result = value === undefined ? fallback : value;
  if (!Number.isInteger(result) || result < min || result > max) {
    throw fail('TABLE_IMAGE_OPTIONS', `${name} 必须是 ${min}–${max} 范围的整数`);
  }
  return result;
}
function escapeHTML(text) {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function digest(value) { return createHash('sha256').update(value).digest('hex'); }

// Nothing from the source DOM is passed to Chrome: only these text/span models.
function plainText(node, state, depth = 0) {
  if (++state.nodes > LIMITS.nodes || depth > LIMITS.depth) {
    throw fail('TABLE_IMAGE_LIMIT', '表格结构过深或节点过多，无法安全转图');
  }
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return '';
  if (DROP.has(node.tagName)) { state.dropped = true; return ''; }
  if (node.tagName === 'IMG') {
    state.images = true;
    return node.getAttribute('alt') || '[图片]';
  }
  if (node.tagName === 'BR') return '\n';
  const text = Array.from(node.childNodes, child => plainText(child, state, depth + 1)).join('');
  return BLOCKS.has(node.tagName) ? `\n${text}\n` : text;
}
function span(cell, name) {
  const raw = cell.getAttribute(name);
  if (raw === null) return 1;
  if (!/^\d{1,4}$/.test(raw) || Number(raw) < 1 || Number(raw) > LIMITS.rows) {
    throw fail('TABLE_IMAGE_STRUCTURE', `表格 ${name} 无效；不支持跨度为 0 的合并单元格`);
  }
  return Number(raw);
}

function readTable(table, index, totals, warnings) {
  if (table.querySelector('table')) throw fail('TABLE_IMAGE_STRUCTURE', `表格 ${index + 1} 含嵌套表格，请先展开`);
  const state = { nodes: 0, dropped: false, images: false };
  const rows = [];
  function structuralChildren(node, allowed) {
    for (const child of node.childNodes) {
      if (child.nodeType === 3 && !child.textContent.trim() || child.nodeType === 8) continue;
      if (child.nodeType === 1 && DROP.has(child.tagName)) { state.dropped = true; continue; }
      if (child.nodeType !== 1 || !allowed.includes(child.tagName)) {
        throw fail('TABLE_IMAGE_STRUCTURE', `表格 ${index + 1} 存在单元格外的内容或无效结构，无法无损转图`);
      }
      if (child.tagName === 'TR') {
        structuralChildren(child, ['TD', 'TH']);
        rows.push(child);
      } else if (['THEAD', 'TBODY', 'TFOOT'].includes(child.tagName)) {
        structuralChildren(child, ['TR']);
      } else if (child.tagName === 'COLGROUP') structuralChildren(child, ['COL']);
    }
  }
  structuralChildren(table, ['CAPTION', 'COLGROUP', 'COL', 'THEAD', 'TBODY', 'TFOOT', 'TR']);
  if (!rows.length) throw fail('TABLE_IMAGE_STRUCTURE', `表格 ${index + 1} 没有数据行`);
  totals.rows += rows.length;
  if (rows.length > LIMITS.rows || totals.rows > LIMITS.totalRows) {
    throw fail('TABLE_IMAGE_LIMIT', `表格行数超限：单表最多 ${LIMITS.rows} 行，合计最多 ${LIMITS.totalRows} 行`);
  }
  let chars = 0;
  const modelRows = rows.map(row => {
    const cells = Array.from(row.children).filter(c => c.tagName === 'TH' || c.tagName === 'TD').map(cell => {
      const text = plainText(cell, state).replace(/\r\n?/g, '\n').trim();
      if (text.length > LIMITS.cellChars) throw fail('TABLE_IMAGE_LIMIT', `表格 ${index + 1} 单元格超过 ${LIMITS.cellChars} 字符`);
      chars += text.length;
      return { text, header: cell.tagName === 'TH', colspan: span(cell, 'colspan'), rowspan: span(cell, 'rowspan') };
    });
    if (!cells.length || cells.length > LIMITS.columns) throw fail('TABLE_IMAGE_STRUCTURE', `表格 ${index + 1} 存在空行或列数超过 ${LIMITS.columns}`);
    return { cells, inHead: row.parentElement?.tagName === 'THEAD' };
  });
  const captions = Array.from(table.children).filter(n => n.tagName === 'CAPTION');
  const caption = captions.map(n => plainText(n, state).trim()).join('\n');
  chars += caption.length;
  totals.chars += chars;
  if (chars > LIMITS.tableChars || totals.chars > LIMITS.totalChars) {
    throw fail('TABLE_IMAGE_LIMIT', `表格字数超限：单表最多 ${LIMITS.tableChars} 字符，合计最多 ${LIMITS.totalChars} 字符`);
  }
  let headCount = 0;
  if (modelRows.some(r => r.inHead)) {
    while (modelRows[headCount]?.inHead) headCount++;
    if (modelRows.slice(headCount).some(r => r.inHead)) throw fail('TABLE_IMAGE_STRUCTURE', '表头必须在数据行之前');
  } else {
    while (modelRows[headCount]?.cells.every(c => c.header)) headCount++;
  }
  // Validate the occupied grid, and mark only boundaries with no crossing rowspan.
  const occupied = [];
  const safeBreaks = new Set([0]);
  let columns = 0;
  for (let r = 0; r < modelRows.length; r++) {
    let col = 0;
    for (const cell of modelRows[r].cells) {
      while ((occupied[col] || 0) > r) col++;
      if (col + cell.colspan > LIMITS.columns || r + cell.rowspan > modelRows.length) throw fail('TABLE_IMAGE_STRUCTURE', '合并单元格超出表格行列范围');
      if (r < headCount && r + cell.rowspan > headCount) throw fail('TABLE_IMAGE_STRUCTURE', '合并单元格不能跨越表头与正文');
      for (let c = col; c < col + cell.colspan; c++) {
        if ((occupied[c] || 0) > r) throw fail('TABLE_IMAGE_STRUCTURE', '合并单元格相互重叠');
        occupied[c] = r + cell.rowspan;
      }
      col += cell.colspan;
      columns = Math.max(columns, col);
    }
    if (occupied.every(end => end <= r + 1)) safeBreaks.add(r + 1);
  }
  if (state.dropped) warnings.push(`表格 ${index + 1} 的脚本、样式或嵌入资源已忽略，仅渲染纯文本结构。`);
  if (state.images) warnings.push(`表格 ${index + 1} 中的图片未加载，已使用替代文字。`);
  if (!headCount) warnings.push(`表格 ${index + 1} 没有可识别表头，分段时仅保留原数据行。`);
  return { caption, rows: modelRows, headCount, columns, safeBreaks };
}

function rowHTML(row) {
  return `<tr>${row.cells.map(cell => {
    const tag = cell.header ? 'th' : 'td';
    return `<${tag} colspan="${cell.colspan}" rowspan="${cell.rowspan}">${escapeHTML(cell.text)}</${tag}>`;
  }).join('')}</tr>`;
}
function renderDocument(model, start, end, options) {
  const { width, fontSize } = options;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; connect-src 'none'; font-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><style>
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#182230}
body{width:${width}px;font:${fontSize}px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
#table-image{width:${width}px;padding:20px;background:#fff}
table{border-collapse:collapse;table-layout:fixed;width:100%}caption{text-align:left;font-weight:700;padding:0 0 12px;white-space:pre-wrap;overflow-wrap:anywhere}
th,td{border:1px solid #cbd5e1;padding:10px 12px;vertical-align:top;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
th{background:#e8eef5;font-weight:600}tbody tr:nth-child(even) td{background:#f8fafc}
</style></head><body><div id="table-image"><table>${model.caption ? `<caption>${escapeHTML(model.caption)}</caption>` : ''}<colgroup>${'<col>'.repeat(model.columns)}</colgroup>${model.headCount ? `<thead>${model.rows.slice(0, model.headCount).map(rowHTML).join('')}</thead>` : ''}<tbody>${model.rows.slice(start, end).map(rowHTML).join('')}</tbody></table></div></body></html>`;
}

function loadChromium(injected) {
  if (injected) return injected;
  try { return loadProjectChromium(); } catch (error) {
    throw fail('TABLE_IMAGE_RENDERER_UNAVAILABLE', error.message);
  }
}

async function chromeRenderer(options) {
  const chromium = loadChromium(options.chromium);
  const executablePath = options.executablePath || (options.chromium ? undefined : resolveBrowserPath({ chromium }));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath, timeout: options.timeoutMs,
      args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true,
      serviceWorkers: 'block', acceptDownloads: false, deviceScaleFactor: 1,
      viewport: { width: options.width, height: 800 } });
    await context.route('**/*', route => route.abort('blockedbyclient'));
    const page = await context.newPage();
    page.setDefaultTimeout(options.timeoutMs);
    return {
      async render(request) {
        await page.setContent(request.html, { waitUntil: 'load', timeout: options.timeoutMs });
        const element = page.locator('#table-image');
        const box = await element.boundingBox();
        if (!box || box.width > options.width + 1) throw fail('TABLE_IMAGE_OVERFLOW', '表格超出图片宽度');
        const overflow = await element.evaluate(node => {
          const outer = node.getBoundingClientRect();
          return node.scrollWidth > node.clientWidth + 1 || Array.from(node.querySelectorAll('table,th,td,caption')).some(cell => {
            const rect = cell.getBoundingClientRect();
            return rect.right > outer.right + 1 || rect.left < outer.left - 1 || cell.scrollWidth > cell.clientWidth + 1;
          });
        });
        if (overflow) throw fail('TABLE_IMAGE_OVERFLOW', '表格列宽不足或内容横向溢出，请增加 width 或减少列数；未裁剪图片');
        if (Math.ceil(box.height) > options.maxHeight) throw fail('TABLE_IMAGE_TOO_TALL', '表格分段超过图片高度限制');
        // Screenshot the entire measured element, never a clipped viewport.
        return element.screenshot({ type: 'png', animations: 'disabled', timeout: options.timeoutMs });
      },
      close: () => browser.close(),
    };
  } catch (error) {
    if (browser) await browser.close();
    if (error.code?.startsWith('TABLE_IMAGE_')) throw error;
    throw fail('TABLE_IMAGE_RENDERER_UNAVAILABLE', '本机 Chrome 表格渲染器启动失败，请检查浏览器或注入 renderTable');
  }
}

function validatePNG(buffer, options) {
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) throw fail('TABLE_IMAGE_INVALID_PNG', 'renderTable 必须返回 PNG Buffer/Uint8Array');
  const data = Buffer.from(buffer);
  if (data.length < 45 || !data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || data.toString('ascii', 12, 16) !== 'IHDR' || data.toString('ascii', data.length - 8, data.length - 4) !== 'IEND') {
    throw fail('TABLE_IMAGE_INVALID_PNG', '渲染器或缓存返回的文件不是完整 PNG');
  }
  if (data.length > LIMITS.imageBytes) throw fail('TABLE_IMAGE_LIMIT', '表格图片超过 8 MiB 限制');
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (!width || !height || width > options.width) throw fail('TABLE_IMAGE_OVERFLOW', 'PNG 图片宽度无效或超限');
  if (height > options.maxHeight) throw fail('TABLE_IMAGE_TOO_TALL', 'PNG 图片高度超限');
  return data;
}

async function assetDirectory(assetsRoot) {
  if (typeof assetsRoot !== 'string' || !path.isAbsolute(assetsRoot) || assetsRoot.includes('\0') || assetsRoot.split(/[\\/]/).includes('..')) {
    throw fail('TABLE_IMAGE_PATH', 'assetsRoot 必须是无路径穿越的绝对目录');
  }
  const root = path.resolve(assetsRoot);
  if (root === path.parse(root).root) throw fail('TABLE_IMAGE_PATH', '不能使用文件系统根目录作为 assetsRoot');
  await fs.mkdir(root, { recursive: true });
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw fail('TABLE_IMAGE_PATH', 'assetsRoot 不能是符号链接');
  const realRoot = await fs.realpath(root);
  const dir = path.join(realRoot, 'table-images');
  await fs.mkdir(dir, { recursive: true });
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(dir) !== dir) throw fail('TABLE_IMAGE_PATH', '表格图片目录不允许符号链接');
  return dir;
}
async function checkDirectory(dir) {
  if (await fs.realpath(dir) !== dir || !(await fs.lstat(dir)).isDirectory()) throw fail('TABLE_IMAGE_PATH', '表格图片目录已改变');
}
async function readCache(filename, options) {
  let handle;
  try {
    handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > LIMITS.imageBytes) throw fail('TABLE_IMAGE_PATH', '表格缓存必须为大小受限的常规 PNG 文件');
    return validatePNG(await handle.readFile(), options);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'ELOOP') throw fail('TABLE_IMAGE_PATH', '表格缓存不允许符号链接');
    throw error;
  } finally { await handle?.close(); }
}
async function writeCache(dir, filename, data, options) {
  await checkDirectory(dir);
  const temp = path.join(dir, `.table-${randomBytes(16).toString('hex')}.tmp`);
  await fs.writeFile(temp, data, { flag: 'wx', mode: 0o600 });
  try {
    await checkDirectory(dir);
    try { await fs.link(temp, filename); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await readCache(filename, options);
    }
  } finally { await fs.unlink(temp); }
}

/**
 * Convert tables in a woshipm DERIVED HTML copy. Caller owns platform routing and
 * embeds /uploads/... assets into its CLI snapshot; source files are never read/written.
 * Non-table HTML is retained, so this is not a whole-article HTML sanitizer.
 * assetsRoot is the disk root served as /uploads/.
 * renderTable({html,width,maxHeight,tableIndex,segmentIndex,rowStart,rowEnd,
 *              rowCount,headerRowCount,signal}) => Promise<PNG Buffer> is a trusted
 * dependency injection point. Use TABLE_IMAGE_TOO_TALL to request further splitting.
 * rendererCacheKey should change when an injected renderer changes its output.
 */
async function transformTables(html, config = {}) {
  if (typeof html !== 'string') throw fail('TABLE_IMAGE_INPUT', 'html 必须是字符串');
  if (Buffer.byteLength(html) > LIMITS.inputBytes) throw fail('TABLE_IMAGE_LIMIT', 'HTML 超过 4 MiB 限制');
  const options = {
    ...config,
    width: bound(config.width, 1000, 480, 1600, 'width'),
    maxHeight: bound(config.maxHeight, 2400, 256, 4096, 'maxHeight'),
    maxRowsPerImage: bound(config.maxRowsPerImage, 30, 1, 100, 'maxRowsPerImage'),
    fontSize: bound(config.fontSize, 18, 12, 28, 'fontSize'),
    timeoutMs: bound(config.timeoutMs, 20000, 100, 60000, 'timeoutMs'),
  };
  if (config.renderTable !== undefined && typeof config.renderTable !== 'function') throw fail('TABLE_IMAGE_OPTIONS', 'renderTable 必须为函数');
  if (config.rendererCacheKey !== undefined && (typeof config.rendererCacheKey !== 'string' || config.rendererCacheKey.length > 200)) throw fail('TABLE_IMAGE_OPTIONS', 'rendererCacheKey 必须是至多 200 字符的字符串');
  const { document } = parseHTML(html);
  const tables = Array.from(document.querySelectorAll('table'));
  if (!tables.length) return { html, assets: [], warnings: [] };
  if (tables.length > LIMITS.tables) throw fail('TABLE_IMAGE_LIMIT', `HTML 表格数超过 ${LIMITS.tables}`);
  const warnings = [];
  const totals = { rows: 0, chars: 0, bytes: 0, images: 0 };
  const models = tables.map((table, index) => readTable(table, index, totals, warnings));
  const dir = await assetDirectory(options.assetsRoot);
  const assets = new Map();
  let chrome;
  try {
    for (let tableIndex = 0; tableIndex < models.length; tableIndex++) {
      const model = models[tableIndex];
      const rendered = [];
      const cacheKey = digest(JSON.stringify({ version: STYLE_VERSION, model: { ...model, safeBreaks: undefined },
        width: options.width, fontSize: options.fontSize, maxHeight: options.maxHeight,
        maxRowsPerImage: options.maxRowsPerImage, renderer: options.rendererCacheKey || (config.renderTable ? 'injected' : 'chrome') }));
      async function segment(start, end) {
        if (totals.images >= LIMITS.images) throw fail('TABLE_IMAGE_LIMIT', `表格图片总数超过 ${LIMITS.images}`);
        const filename = `${cacheKey}-${start}-${end}.png`;
        const absolutePath = path.join(dir, filename);
        await checkDirectory(dir);
        let data;
        try {
          data = await readCache(absolutePath, options);
          if (!data) {
            if (!options.renderTable && !chrome) chrome = await chromeRenderer(options);
            const controller = new AbortController();
            const request = { html: renderDocument(model, start, end, options), width: options.width,
              maxHeight: options.maxHeight, tableIndex, segmentIndex: rendered.length,
              rowStart: start, rowEnd: end, rowCount: end - start,
              headerRowCount: model.headCount, signal: controller.signal };
            let timer;
            try {
              data = validatePNG(await Promise.race([
                Promise.resolve().then(() => (options.renderTable || chrome.render)(request)),
                new Promise((_, reject) => { timer = setTimeout(() => {
                  controller.abort(); reject(fail('TABLE_IMAGE_TIMEOUT', '表格渲染超时，已停止本次转换'));
                }, options.timeoutMs); }),
              ]), options);
            } finally { clearTimeout(timer); }
            await writeCache(dir, absolutePath, data, options);
          }
        } catch (error) {
          if (error.code === 'TABLE_IMAGE_TOO_TALL') {
            const splits = [...model.safeBreaks].filter(n => n > start && n < end);
            if (!splits.length) throw fail('TABLE_IMAGE_LIMIT', `表格 ${tableIndex + 1} 的第 ${start + 1}–${end} 行（含表头或合并单元格）超过单图 ${options.maxHeight}px，无法无损分段，请缩短单元格或提高高度限制`);
            const middle = (start + end) / 2;
            const split = splits.reduce((best, n) => Math.abs(n - middle) < Math.abs(best - middle) ? n : best);
            await segment(start, split);
            await segment(split, end);
            return;
          }
          if (error.code?.startsWith('TABLE_IMAGE_')) throw error;
          throw fail('TABLE_IMAGE_RENDER_FAILED', `表格 ${tableIndex + 1} 第 ${start + 1}–${end} 行渲染或缓存失败`);
        }
        totals.bytes += data.length;
        totals.images++;
        if (totals.bytes > LIMITS.totalImageBytes) throw fail('TABLE_IMAGE_LIMIT', '表格图片合计超过 64 MiB');
        const asset = { filename, absolutePath, relativeUrl: `/uploads/table-images/${filename}`, mimeType: 'image/png' };
        assets.set(filename, asset);
        rendered.push(asset);
      }
      let start = model.headCount;
      if (start === model.rows.length) await segment(start, start);
      while (start < model.rows.length) {
        const end = Math.max(...[...model.safeBreaks].filter(n => n > start && n <= start + options.maxRowsPerImage), -1);
        if (end < 0) throw fail('TABLE_IMAGE_LIMIT', `表格 ${tableIndex + 1} 的合并单元格跨越超过 ${options.maxRowsPerImage} 行，无法按当前限制无损分段`);
        await segment(start, end);
        start = end;
      }
      const replacement = document.createElement('div');
      replacement.setAttribute('class', 'table-images');
      rendered.forEach((asset, segmentIndex) => {
        const img = document.createElement('img');
        img.setAttribute('src', asset.relativeUrl);
        img.setAttribute('alt', `表格 ${tableIndex + 1}（${segmentIndex + 1}/${rendered.length}）`);
        img.setAttribute('style', 'max-width:100%;height:auto;display:block;margin:12px auto;');
        replacement.appendChild(img);
      });
      tables[tableIndex].replaceWith(replacement);
      if (rendered.length > 1) warnings.push(`表格 ${tableIndex + 1} 已无损拆分为 ${rendered.length} 张图片${model.headCount ? '，每张重复表头' : ''}。`);
    }
    return { html: document.toString(), assets: [...assets.values()], warnings };
  } finally { await chrome?.close(); }
}

module.exports = { transformTables, TABLE_IMAGE_LIMITS: LIMITS };
