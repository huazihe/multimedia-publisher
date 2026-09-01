'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { createRequire } = require('node:module');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(REPO_ROOT, 'skills', 'weixin-layout', 'templates');
const ARTICLE_ALLOWED_ELEMENTS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'span',
  'strong', 'em', 'b', 'i', 'u', 's', 'del', 'mark', 'small', 'sub', 'sup',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'code', 'kbd', 'samp', 'var',
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'figure', 'figcaption', 'img', 'a', 'br', 'hr',
]);
const ARTICLE_DROP_ELEMENTS = [
  'title', 'textarea', 'xmp', 'noembed', 'noframes', 'plaintext',
  'script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript',
  'base', 'link', 'meta', 'svg', 'math', 'video', 'audio', 'source', 'track', 'canvas',
];
const DROP_ELEMENTS = [
  'script',
  'iframe',
  'object',
  'embed',
  'base',
  'link',
  'template',
  'noscript',
  'svg animate',
  'svg animateMotion',
  'svg animateTransform',
  'svg set',
  'svg foreignObject',
  'svg use',
];
const UNWRAP_ELEMENTS = [
  'form',
  'button',
  'input',
  'select',
  'option',
  'textarea',
  'dialog',
];
const COMMAND_ATTRIBUTES = new Set([
  'action',
  'formaction',
  'srcdoc',
  'contenteditable',
  'autofocus',
  'data-action',
  'data-command',
]);
const RESOURCE_ATTRIBUTES = new Set([
  'archive',
  'attributionsrc',
  'background',
  'cite',
  'classid',
  'codebase',
  'data',
  'dynsrc',
  'href',
  'icon',
  'imagesizes',
  'imagesrcset',
  'longdesc',
  'lowsrc',
  'manifest',
  'ping',
  'poster',
  'profile',
  'src',
  'srcset',
  'usemap',
  'xlink:href',
]);
const DEFAULT_STYLES = {
  title: 'margin:0 0 18px;font-size:28px;font-weight:700;line-height:1.4;letter-spacing:1px;text-align:center;color:#1f2937;',
  summary: 'margin:0 0 28px;padding:16px 18px;font-size:15px;line-height:1.9;color:#4b5563;background:#f7f8fa;border-radius:8px;',
  heading: 'margin:34px 0 14px;font-size:20px;font-weight:700;line-height:1.5;color:#1f2937;',
  paragraph: 'margin:0 0 16px;font-size:15px;line-height:2;color:#374151;text-align:justify;',
  list: 'margin:0 0 20px;padding-left:1.5em;font-size:15px;line-height:2;color:#374151;',
  quote: 'margin:24px 0;padding:16px 20px;border-left:4px solid #9ca3af;background:#f7f8fa;color:#4b5563;line-height:1.9;',
  figure: 'margin:24px 0;text-align:center;',
  image: 'display:block;max-width:100%;height:auto;margin:0 auto;',
  pre: 'margin:20px 0;padding:16px;overflow:auto;background:#f3f4f6;border-radius:8px;line-height:1.7;',
  footer: 'margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;text-align:center;',
  accountName: 'margin:0 0 6px;font-size:15px;font-weight:700;line-height:1.6;',
  accountDescription: 'margin:0;font-size:12px;line-height:1.8;color:#6b7280;',
};

function loadLinkedom() {
  try {
    return require('linkedom');
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND' || !String(error.message).includes("'linkedom'")) throw error;
    // The dashboard is not currently a pnpm workspace package. Root installs still
    // provide LinkeDOM through @weibot/core; standalone dashboard installs use the
    // dependency declared in publisher-dashboard/package.json.
    const requireFromCore = createRequire(path.join(REPO_ROOT, 'packages', 'core', 'package.json'));
    return requireFromCore('linkedom');
  }
}

const { parseHTML } = loadLinkedom();

function compareFilenames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readableTemplateLabel(filename) {
  const basename = filename.slice(0, -'.html'.length);
  const descriptiveTemplate = basename.match(/^template_style\d+_(.+)$/);
  if (descriptiveTemplate) return descriptiveTemplate[1].replace(/_/g, ' ').trim();
  const numberedTemplate = basename.match(/^(?:template_)?style_?(\d+)$/);
  if (numberedTemplate) return `样式 ${numberedTemplate[1]}`;
  return basename.replace(/^template_/, '').replace(/_/g, ' ').trim();
}

function listLayoutTemplates() {
  return fs.readdirSync(TEMPLATE_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.html'))
    .map(entry => ({
      filename: entry.name,
      label: readableTemplateLabel(entry.name),
    }))
    .sort((left, right) => compareFilenames(left.filename, right.filename));
}

function templateStatusError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function safeTemplatePath(filename) {
  if (typeof filename !== 'string'
    || !filename
    || filename.includes('\0')
    || filename !== path.basename(filename)
    || filename !== path.win32.basename(filename)
    || !filename.endsWith('.html')) {
    throw templateStatusError('模板名称无效', 400);
  }

  const target = path.join(TEMPLATE_DIR, filename);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error?.code === 'ENOENT') throw templateStatusError('模板不存在', 404);
    throw error;
  }
  if (!stat.isFile()) throw templateStatusError('模板不是普通文件', 400);
  return target;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRcdata(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;');
}

function normalizeCanonicalContent(content) {
  return {
    title: String(content?.title ?? '').trim(),
    summary: String(content?.summary ?? '').trim(),
    body: String(content?.body ?? '').trim(),
  };
}

function canonicalContentHash(content) {
  const { title, summary, body } = normalizeCanonicalContent(content);
  return createHash('sha256')
    .update(JSON.stringify([title, summary || '', body]), 'utf8')
    .digest('hex');
}

function renderMarkdownInline(value) {
  const code = [];
  let rendered = String(value || '').replace(/`([^`]+)`/g, (_, literal) => {
    const token = `\u0000CODE${code.length}\u0000`;
    code.push(`<code>${escapeHtml(literal)}</code>`);
    return token;
  });
  rendered = escapeHtml(rendered)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<a href="$2">$1</a>');
  return rendered.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)] || '');
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let index = 0;
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${paragraph.map(renderMarkdownInline).join('<br>')}</p>`);
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index];
    const fence = line.match(/^\s*(`{3,}|~{3,})([^\s]*)\s*$/);
    if (fence) {
      flushParagraph();
      const marker = fence[1][0];
      const minimum = fence[1].length;
      const language = /^[A-Za-z0-9_+-]+$/.test(fence[2]) ? fence[2] : '';
      const codeLines = [];
      index++;
      while (index < lines.length && !new RegExp(`^\\s*${marker}{${minimum},}\\s*$`).test(lines[index])) {
        codeLines.push(lines[index]);
        index++;
      }
      if (index < lines.length) index++;
      output.push(`<pre><code${language ? ` class="language-${language}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      output.push(`<h${heading[1].length}>${renderMarkdownInline(heading[2])}</h${heading[1].length}>`);
      index++;
      continue;
    }

    const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const tag = unordered ? 'ul' : 'ol';
      const items = [];
      while (index < lines.length) {
        const item = unordered
          ? lines[index].match(/^\s*[-+*]\s+(.+)$/)
          : lines[index].match(/^\s*\d+[.)]\s+(.+)$/);
        if (!item) break;
        items.push(`<li>${renderMarkdownInline(item[1])}</li>`);
        index++;
      }
      output.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      const quoteLines = [];
      while (index < lines.length) {
        const quoted = lines[index].match(/^\s*>\s?(.*)$/);
        if (!quoted) break;
        quoteLines.push(renderMarkdownInline(quoted[1]));
        index++;
      }
      output.push(`<blockquote>${quoteLines.join('<br>')}</blockquote>`);
      continue;
    }

    const image = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/);
    if (image) {
      flushParagraph();
      output.push(`<figure><img src="${escapeHtml(image[2])}" alt="${escapeHtml(image[1])}"></figure>`);
      index++;
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      index++;
      continue;
    }

    paragraph.push(line);
    index++;
  }
  flushParagraph();
  return output.join('\n');
}

function looksLikeHtml(value) {
  return /<(?:!doctype|html|body|article|main|section|div|p|h[1-6]|ul|ol|li|blockquote|figure|img|pre|table|a|title|textarea|xmp|noembed|noframes|plaintext|script|style|iframe|object|embed|template|noscript|base|link|meta|svg|math|video|audio|source|track|canvas)\b/i.test(String(value || ''));
}

function htmlBodyFragment(value) {
  const source = String(value || '');
  if (!/<(?:!doctype|html|body)\b/i.test(source)) return source;
  const { document } = parseHTML(source);
  return document.body?.innerHTML || '';
}

function removeComments(node) {
  for (const child of [...(node.childNodes || [])]) {
    if (child.nodeType === 8) child.remove();
    else removeComments(child);
  }
}

function unwrapElement(element) {
  const parent = element.parentNode;
  if (!parent) return;
  for (const child of [...element.childNodes]) parent.insertBefore(child, element);
  element.remove();
}

function sanitizeArticleHtmlSource(value) {
  let source = String(value || '').replace(/<!--[\s\S]*?-->/g, '');
  source = source.replace(/<\s*plaintext\b[^>]*>[\s\S]*$/gi, '');
  for (const tagName of ARTICLE_DROP_ELEMENTS.filter(tagName => tagName !== 'plaintext')) {
    const paired = new RegExp(`<\\s*${tagName}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${tagName}\\s*>`, 'gi');
    let previous;
    do {
      previous = source;
      source = source.replace(paired, '');
    } while (source !== previous);
    source = source.replace(new RegExp(`<\\s*${tagName}\\b[^>]*>[\\s\\S]*$`, 'gi'), '');
    source = source.replace(new RegExp(`<\\s*\\/?\\s*${tagName}\\b[^>]*>`, 'gi'), '');
  }
  return source.replace(/<\s*(\/?)\s*([a-z][\w:-]*)\b[^>]*>/gi, (tag, closing, rawName) => {
    const tagName = rawName.toLowerCase();
    return ARTICLE_ALLOWED_ELEMENTS.has(tagName) ? tag : '';
  });
}

function normalizedUrl(value) {
  return String(value || '').trim().replace(/[\u0000-\u0020\u007f]+/g, '');
}

function isSafeRelativeUrl(value) {
  if (!value || /^[\\/]{2}/.test(value)) return false;
  if (/^(?:#|\/(?!\/)|\.\/|\.\.\/)/.test(value)) return true;
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function isSafeHyperlink(value) {
  const normalized = normalizedUrl(value);
  return /^(?:https?:|mailto:|tel:)/i.test(normalized) || isSafeRelativeUrl(normalized);
}

function isSafeImageSource(value) {
  const normalized = String(value || '').trim().replace(/[\u0000-\u001f\u007f\s]+/g, '');
  if (/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i.test(normalized)) return true;
  return /^https?:/i.test(normalized) || isSafeRelativeUrl(normalized);
}

function isAllowedResourceAttribute(element, attributeName, value) {
  if (element.localName === 'a' && attributeName === 'href') return isSafeHyperlink(value);
  if (element.localName === 'img' && attributeName === 'src') return isSafeImageSource(value);
  return false;
}

function sanitizeAttributes(root, options = {}) {
  for (const element of root.querySelectorAll?.('*') || []) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || COMMAND_ATTRIBUTES.has(name)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (options.article && ['style', 'id', 'class'].includes(name)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (RESOURCE_ATTRIBUTES.has(name)
        && !isAllowedResourceAttribute(element, name, attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
}

function sanitizeTree(root, options = {}) {
  removeComments(root);
  for (const selector of DROP_ELEMENTS) {
    for (const element of [...(root.querySelectorAll?.(selector) || [])]) element.remove();
  }
  for (const meta of [...(root.querySelectorAll?.('meta') || [])]) {
    if (String(meta.getAttribute('http-equiv') || '').trim().toLowerCase() === 'refresh') meta.remove();
  }
  if (options.article) {
    for (const element of [...(root.querySelectorAll?.('*') || [])].reverse()) {
      if (!ARTICLE_ALLOWED_ELEMENTS.has(String(element.localName || '').toLowerCase())) element.remove();
    }
  } else {
    for (const selector of UNWRAP_ELEMENTS) {
      for (const element of [...(root.querySelectorAll?.(selector) || [])]) unwrapElement(element);
    }
  }
  sanitizeAttributes(root, options);
}

function clearElement(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function clearTextExcept(root, preservedElements = []) {
  const preserved = new Set(preservedElements.filter(Boolean));
  const visit = node => {
    if (node.nodeType === 3) {
      node.data = '';
      return;
    }
    if (node.nodeType !== 1 || preserved.has(node)) return;
    for (const child of [...node.childNodes]) visit(child);
  };
  visit(root);
}

function copyPresentation(source, target) {
  if (!source) return target;
  for (const name of ['class', 'style', 'align', 'dir']) {
    if (source.hasAttribute?.(name)) target.setAttribute(name, source.getAttribute(name));
  }

  if (source.namespaceURI?.includes('svg')) {
    const additions = [];
    if (source.getAttribute('font-size')) additions.push(`font-size:${source.getAttribute('font-size')}px`);
    if (source.getAttribute('font-weight')) additions.push(`font-weight:${source.getAttribute('font-weight')}`);
    const fill = source.getAttribute('fill');
    if (fill && !/^(?:none|url\()/i.test(fill)) additions.push(`color:${fill}`);
    if (source.getAttribute('letter-spacing')) additions.push(`letter-spacing:${source.getAttribute('letter-spacing')}px`);
    if (source.getAttribute('text-anchor') === 'middle') additions.push('text-align:center');
    if (additions.length) target.setAttribute('style', `${target.getAttribute('style') || ''};${additions.join(';')}`);
  }
  return target;
}

function withDefaultStyle(element, defaultStyle) {
  element.setAttribute('style', `${defaultStyle}${element.getAttribute('style') || ''}`);
  return element;
}

function numericStyleValue(element, property) {
  const inline = String(element?.getAttribute?.('style') || '');
  const match = inline.match(new RegExp(`${property}\\s*:\\s*([0-9.]+)`, 'i'));
  if (match) return Number(match[1]);
  const attribute = element?.getAttribute?.(property);
  return attribute ? Number(attribute) : 0;
}

function findNestedTitlePrototype(content) {
  const directChildren = [...content.children].slice(0, 4);
  let best = null;
  let bestScore = -1;
  for (let index = 0; index < directChildren.length; index++) {
    const shell = directChildren[index];
    for (const candidate of shell.querySelectorAll('h1,h2,h3,p,text,[class~="title"]')) {
      const text = normalizedText(candidate.textContent);
      if (text.length < 2 || text.length > 120) continue;
      if (/替换|图片|配图|logo|photo/i.test(text)) continue;
      const size = numericStyleValue(candidate, 'font-size');
      const style = String(candidate.getAttribute('style') || candidate.getAttribute('font-weight') || '');
      let score = size * 2 + Math.max(0, 80 - index * 20);
      if (candidate.localName === 'h1') score += 200;
      if (candidate.classList?.contains('title')) score += 160;
      if (/文章主标题|主标题|标题区域|title/i.test(text)) score += 140;
      if (/font-weight\s*:\s*(?:bold|[6-9]00)|^[6-9]00$|bold/i.test(style)) score += 20;
      if (text.length >= 4) score += 20;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
  }
  return best;
}

function findTitlePrototype(root, content) {
  const preferred = root.querySelector('h1,.rich_media_title,.hero .title,.header .title,.cover .title');
  if (preferred) return preferred;
  const nested = findNestedTitlePrototype(content);
  if (nested) return nested;

  let best = null;
  let bestScore = -1;
  for (const candidate of root.querySelectorAll('h2,h3,p,div,section,text')) {
    const text = String(candidate.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 120 || candidate.children.length > 4) continue;
    const size = numericStyleValue(candidate, 'font-size');
    const weight = String(candidate.getAttribute('style') || candidate.getAttribute('font-weight') || '');
    const className = String(candidate.className || '');
    let score = size * 2;
    if (/文章主标题|主标题|标题区域/.test(text)) score += 100;
    if (/title/i.test(className)) score += 50;
    if (/font-weight\s*:\s*(?:bold|[6-9]00)|^[6-9]00$|bold/i.test(weight)) score += 20;
    if (candidate.localName === 'h2') score += 10;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function findParagraphPrototype(content) {
  const paragraphs = [...content.querySelectorAll('p')];
  return paragraphs.find(element => {
    const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length >= 24 && text.length <= 500;
  }) || paragraphs[0] || null;
}

function findLeadPrototype(content) {
  const explicit = content.querySelector('.lead,.summary,.subtitle,.sub,[class*="lead"],[class*="summary"]');
  if (explicit) return explicit;
  for (const child of [...content.children].slice(0, 8)) {
    const text = String(child.textContent || '').replace(/\s+/g, ' ').trim();
    const style = String(child.getAttribute('style') || '');
    if (text.length >= 24 && text.length <= 320 && /background|border|padding/i.test(style)) return child;
  }
  return findParagraphPrototype(content);
}

function findHeadingPrototype(content, titlePrototype) {
  const heading = content.querySelector('h2,h3,h4');
  if (heading) return heading;
  let best = null;
  let bestScore = -1;
  for (const candidate of content.querySelectorAll('p,div,section')) {
    if (candidate === titlePrototype) continue;
    const text = String(candidate.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 80 || candidate.children.length > 2) continue;
    const size = numericStyleValue(candidate, 'font-size');
    const style = String(candidate.getAttribute('style') || '');
    const score = size * 2 + (/font-weight\s*:\s*(?:bold|[6-9]00)/i.test(style) ? 20 : 0);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

const FOOTER_CLASS_PRIORITY = [
  'footer',
  'follow-section',
  'follow',
  'account-footer',
  'account',
  'ending',
  'subscription',
  'subscribe',
  'brand-footer',
  'footer-card',
  'signature',
];
const FOOTER_FORBIDDEN_CLASS_TOKENS = new Set([
  'pending',
  'progress',
  'step-progress',
  'timeline',
  'carousel',
  'widget',
  'content-widget',
]);

function directFooterCandidates(root, content) {
  const containers = root === content ? [root] : [root, content];
  const candidates = [];
  for (const container of containers) {
    for (const child of container.children) {
      if (!candidates.includes(child)) candidates.push(child);
    }
  }
  return { containers, candidates };
}

function isValidDirectFooterCandidate(candidate, containers) {
  return containers.includes(candidate.parentElement)
    && ![...candidate.classList].some(token => FOOTER_FORBIDDEN_CLASS_TOKENS.has(token));
}

function isValidatedLastFooter(candidate, container) {
  if (!candidate || candidate !== container.lastElementChild) return false;
  if ([...candidate.classList].some(token => FOOTER_FORBIDDEN_CLASS_TOKENS.has(token))) return false;
  const text = normalizedText(candidate.textContent);
  const style = String(candidate.getAttribute('style') || '');
  const footerCue = /公众号|关注|二维码|订阅|每周.*更新|读到这里|business insight/i.test(text);
  const footerLayout = /text-align\s*:\s*center/i.test(style)
    && /(?:border-top|padding-top|margin-top)\s*:/i.test(style);
  return text.length >= 4 && text.length <= 320 && footerCue && footerLayout;
}

function findFooterPrototype(root, content) {
  const { containers, candidates } = directFooterCandidates(root, content);
  const semanticFooter = candidates.find(candidate => candidate.localName === 'footer'
    && isValidDirectFooterCandidate(candidate, containers));
  if (semanticFooter) return semanticFooter;

  for (const token of FOOTER_CLASS_PRIORITY) {
    const exactClassMatch = candidates.find(candidate => candidate.classList.contains(token)
      && isValidDirectFooterCandidate(candidate, containers));
    if (exactClassMatch) return exactClassMatch;
  }

  for (const container of [content, root]) {
    if (containers.includes(container) && isValidatedLastFooter(container.lastElementChild, container)) {
      return container.lastElementChild;
    }
  }
  return null;
}

function directChildContaining(ancestor, descendant) {
  let current = descendant;
  while (current?.parentElement && current.parentElement !== ancestor) current = current.parentElement;
  return current?.parentElement === ancestor ? current : null;
}

function createProfile(document, root, content) {
  const title = findTitlePrototype(root, content);
  const lead = findLeadPrototype(content);
  const paragraph = findParagraphPrototype(content);
  const heading = findHeadingPrototype(content, title);
  const footer = findFooterPrototype(root, content);
  return {
    title,
    lead,
    paragraph,
    heading,
    footer,
    footerName: footer?.querySelector('.big,.title,.author-name,.account-name,h2,h3,h4,strong,p') || null,
    footerDescription: footer?.querySelector('p:last-child,.f-desc,.desc,.account-description') || null,
  };
}

function createTitle(document, profile, title) {
  const element = document.createElement('h1');
  copyPresentation(profile.title, element);
  withDefaultStyle(element, DEFAULT_STYLES.title);
  element.setAttribute('data-wechat-slot', 'title');
  element.textContent = title;
  return element;
}

function createSummary(document, profile, summary) {
  const tagName = ['p', 'div', 'section', 'blockquote'].includes(profile.lead?.localName)
    ? profile.lead.localName
    : 'p';
  const element = document.createElement(tagName);
  copyPresentation(profile.lead, element);
  withDefaultStyle(element, DEFAULT_STYLES.summary);
  element.setAttribute('data-wechat-slot', 'summary');
  element.textContent = summary;
  return element;
}

function applyArticlePresentation(root, profile) {
  for (const heading of root.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    copyPresentation(profile.heading, heading);
    withDefaultStyle(heading, DEFAULT_STYLES.heading);
  }
  for (const paragraph of root.querySelectorAll('p')) {
    copyPresentation(profile.paragraph, paragraph);
    withDefaultStyle(paragraph, DEFAULT_STYLES.paragraph);
  }
  for (const list of root.querySelectorAll('ul,ol')) withDefaultStyle(list, DEFAULT_STYLES.list);
  for (const quote of root.querySelectorAll('blockquote')) withDefaultStyle(quote, DEFAULT_STYLES.quote);
  for (const figure of root.querySelectorAll('figure')) withDefaultStyle(figure, DEFAULT_STYLES.figure);
  for (const image of root.querySelectorAll('img')) withDefaultStyle(image, DEFAULT_STYLES.image);
  for (const pre of root.querySelectorAll('pre')) withDefaultStyle(pre, DEFAULT_STYLES.pre);
}

function normalizedText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function createArticleNodes(document, body, profile, title) {
  const html = looksLikeHtml(body) ? sanitizeArticleHtmlSource(body) : markdownToHtml(body);
  const holder = document.createElement('template');
  holder.innerHTML = html;
  sanitizeTree(holder.content, { article: true });

  const topLevelElements = [...holder.content.children];
  const articleRoot = topLevelElements.length === 1
    && ['article', 'main'].includes(topLevelElements[0].localName)
    ? topLevelElements[0]
    : holder.content;
  const leadingNode = [...articleRoot.childNodes].find(node => node.nodeType === 1
    || (node.nodeType === 3 && normalizedText(node.textContent)));
  if (leadingNode?.nodeType === 1
    && leadingNode.localName === 'h1'
    && normalizedText(leadingNode.textContent) === normalizedText(title)) {
    leadingNode.remove();
  }
  applyArticlePresentation(holder.content, profile);

  return articleRoot === holder.content
    ? [...holder.content.childNodes]
    : [...articleRoot.childNodes];
}

function createFooter(document, profile, accountName, accountDescription) {
  if (!accountName && !accountDescription) return null;
  const source = profile.footer;
  const tagName = ['footer', 'section', 'div'].includes(source?.localName) ? source.localName : 'footer';
  const footer = document.createElement(tagName);
  copyPresentation(source, footer);
  withDefaultStyle(footer, DEFAULT_STYLES.footer);
  footer.setAttribute('data-wechat-account', 'true');

  if (accountName) {
    const nameTag = ['h2', 'h3', 'h4', 'p'].includes(profile.footerName?.localName)
      ? profile.footerName.localName
      : 'p';
    const name = document.createElement(nameTag);
    copyPresentation(profile.footerName, name);
    withDefaultStyle(name, DEFAULT_STYLES.accountName);
    name.setAttribute('data-wechat-slot', 'account-name');
    name.textContent = accountName;
    footer.append(name);
  }

  if (accountDescription) {
    const descriptionTag = ['p', 'div'].includes(profile.footerDescription?.localName)
      ? profile.footerDescription.localName
      : 'p';
    const description = document.createElement(descriptionTag);
    copyPresentation(profile.footerDescription, description);
    withDefaultStyle(description, DEFAULT_STYLES.accountDescription);
    description.setAttribute('data-wechat-slot', 'account-description');
    description.textContent = accountDescription;
    footer.append(description);
  }
  return footer;
}

function updateFooterInPlace(document, profile, accountName, accountDescription) {
  if (!accountName && !accountDescription) return null;
  const footer = profile.footer;
  if (!footer) return createFooter(document, profile, accountName, accountDescription);

  let name = profile.footerName && footer.contains(profile.footerName) ? profile.footerName : null;
  let description = profile.footerDescription && footer.contains(profile.footerDescription)
    ? profile.footerDescription
    : null;
  if (name === description) description = null;
  clearTextExcept(footer, [accountName ? name : null, accountDescription ? description : null]);
  for (const action of [...footer.querySelectorAll('a,button')]) {
    if (action !== name && action !== description) action.remove();
  }

  footer.setAttribute('data-wechat-account', 'true');
  if (!footer.hasAttribute('class') && !footer.hasAttribute('style')) {
    footer.setAttribute('style', DEFAULT_STYLES.footer);
  }

  if (accountName) {
    if (!name) {
      name = document.createElement('p');
      withDefaultStyle(name, DEFAULT_STYLES.accountName);
      footer.append(name);
    }
    name.setAttribute('data-wechat-slot', 'account-name');
    name.textContent = accountName;
  } else {
    name?.remove();
  }

  if (accountDescription) {
    if (!description) {
      description = document.createElement('p');
      withDefaultStyle(description, DEFAULT_STYLES.accountDescription);
      footer.append(description);
    }
    description.setAttribute('data-wechat-slot', 'account-description');
    description.textContent = accountDescription;
  } else {
    description?.remove();
  }
  return footer;
}

function updateTitleInPlace(element, title) {
  clearElement(element);
  element.setAttribute('data-wechat-slot', 'title');
  element.textContent = title;
  return element;
}

function directChildOrSelf(ancestor, descendant) {
  return ancestor === descendant ? descendant : directChildContaining(ancestor, descendant);
}

function removeUnrelatedRootChildren(root, preservedBranches) {
  const preserved = new Set(preservedBranches.filter(Boolean));
  for (const child of [...root.children]) {
    if (preserved.has(child)) continue;
    if (String(child.textContent || '').trim()) child.remove();
  }
}

function findTemplateStructure(document) {
  const root = document.querySelector('#js_article')
    || document.body.querySelector(':scope > .wrap,:scope > .article-container,:scope > .article')
    || document.body.firstElementChild;
  if (!root) throw new Error('模板结构无法识别：缺少可渲染根节点');
  const content = root.querySelector('#js_content,.rich_media_content,.content-section,.content') || root;
  return {
    root,
    content,
    richMedia: content.id === 'js_content' || content.classList.contains('rich_media_content'),
  };
}

function normalizeTemplateDocument(document, values) {
  sanitizeTree(document);
  const structure = findTemplateStructure(document);
  const profile = createProfile(document, structure.root, structure.content);
  const summary = createSummary(document, profile, values.summary);
  const articleNodes = createArticleNodes(document, values.body, profile, values.title);
  const footer = updateFooterInPlace(document, profile, values.accountName, values.accountDescription);
  const footerInsideContent = profile.footer && structure.content.contains(profile.footer);
  const footerCarrier = footerInsideContent
    ? (directChildContaining(structure.content, profile.footer) || profile.footer)
    : null;
  if (footerCarrier && footerCarrier !== profile.footer) clearTextExcept(footerCarrier, [profile.footer]);
  footerCarrier?.remove();

  if (structure.richMedia) {
    const outsideTitle = profile.title && !structure.content.contains(profile.title) ? profile.title : null;
    const nestedTitle = profile.title && structure.content.contains(profile.title) ? profile.title : null;
    if (outsideTitle) {
      updateTitleInPlace(outsideTitle, values.title);
    }
    const titleCarrier = nestedTitle ? directChildContaining(structure.content, nestedTitle) : null;
    if (titleCarrier) {
      for (const child of [...structure.content.children]) {
        if (child !== titleCarrier) child.remove();
      }
      clearTextExcept(titleCarrier, [nestedTitle]);
      updateTitleInPlace(nestedTitle, values.title);
    } else {
      clearElement(structure.content);
      if (!outsideTitle) structure.content.append(createTitle(document, profile, values.title));
    }
    structure.content.append(summary, ...articleNodes);
    if (footer && footerCarrier) structure.content.append(footerCarrier);
    else if (footer && !profile.footer) structure.content.append(footer);
  } else if (structure.content !== structure.root) {
    const titleOutsideContent = profile.title && !structure.content.contains(profile.title)
      ? profile.title
      : null;
    let titleBranch = titleOutsideContent
      ? directChildContaining(structure.root, titleOutsideContent)
      : null;
    const contentBranch = directChildOrSelf(structure.root, structure.content);
    const outsideFooterBranch = profile.footer && !footerInsideContent
      ? directChildContaining(structure.root, profile.footer)
      : null;
    if (!footer) outsideFooterBranch?.remove();

    if (titleOutsideContent) {
      clearTextExcept(titleBranch || titleOutsideContent, [titleOutsideContent]);
      updateTitleInPlace(titleOutsideContent, values.title);
    } else {
      const titleHost = document.createElement('header');
      titleHost.append(createTitle(document, profile, values.title));
      structure.root.insertBefore(titleHost, contentBranch || structure.root.firstChild);
      titleBranch = titleHost;
    }
    removeUnrelatedRootChildren(structure.root, [titleBranch, contentBranch, footer ? outsideFooterBranch : null]);
    clearElement(structure.content);
    structure.content.append(summary, ...articleNodes);
    if (footer && footerCarrier) structure.content.append(footerCarrier);
    else if (footer && !profile.footer) structure.content.append(footer);
  } else {
    const title = profile.title;
    const titleBranch = title ? directChildContaining(structure.root, title) : null;
    const rootChildren = [...structure.root.children];
    const titleIndex = titleBranch ? rootChildren.indexOf(titleBranch) : -1;
    if (title && titleIndex >= 0) {
      for (let index = 0; index <= titleIndex; index++) {
        clearTextExcept(rootChildren[index], rootChildren[index] === titleBranch ? [title] : []);
      }
      for (let index = titleIndex + 1; index < rootChildren.length; index++) rootChildren[index].remove();
      updateTitleInPlace(title, values.title);
    } else {
      clearElement(structure.root);
      structure.root.append(createTitle(document, profile, values.title));
    }
    structure.root.append(summary, ...articleNodes);
    if (footer && footerCarrier) structure.root.append(footerCarrier);
    else if (footer && !profile.footer) structure.root.append(footer);
  }

  structure.root.setAttribute('data-wechat-template-root', 'true');
  for (const element of new Set([document.body, structure.root])) {
    element.setAttribute('data-wechat-template', values.filename);
    element.setAttribute('data-canonical-sha256', values.canonicalHash);
    element.setAttribute('data-layout-generated-at', values.generatedAt);
  }
  let documentTitle = document.head.querySelector('title');
  if (!documentTitle) {
    documentTitle = document.createElement('title');
    document.head.append(documentTitle);
  }
  documentTitle.textContent = '';
  sanitizeTree(document);
}

function serializeTemplateDocument(document, title) {
  const documentTitle = document.head.querySelector('title');
  if (!documentTitle) throw new Error('模板结构无法识别：缺少文档标题节点');
  const placeholder = `__PUBLISHER_SAFE_TITLE_${randomBytes(16).toString('hex')}__`;
  documentTitle.textContent = placeholder;
  const serialized = document.toString();
  const first = serialized.indexOf(placeholder);
  if (first < 0 || serialized.indexOf(placeholder, first + placeholder.length) >= 0) {
    throw new Error('模板文档标题序列化失败');
  }
  return `${serialized.slice(0, first)}${escapeRcdata(title)}${serialized.slice(first + placeholder.length)}`;
}

function parseTemplateDocument(source) {
  if (/<(?:!doctype|html)\b/i.test(source)) return parseHTML(source).document;
  return parseHTML(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body>${source}</body></html>`).document;
}

function inspectLayoutMetadata(html) {
  const source = String(html || '');
  if (!source.trim()) return null;
  let document;
  try {
    document = parseHTML(source).document;
  } catch {
    return null;
  }
  if (!layoutDocumentIsSafe(document)) return null;
  const body = document.body;
  const roots = [...document.querySelectorAll('[data-wechat-template-root]')];
  if (!body || roots.length !== 1 || roots[0].getAttribute('data-wechat-template-root') !== 'true') {
    return null;
  }
  const root = roots[0];
  if (root === body || !body.contains(root)) return null;

  const metadataSelector = [
    '[data-wechat-template]',
    '[data-canonical-sha256]',
    '[data-layout-generated-at]',
  ].join(',');
  const carriers = [...document.querySelectorAll(metadataSelector)];
  if (carriers.length !== 2 || !carriers.includes(body) || !carriers.includes(root)) return null;

  const readMetadata = element => ({
    template: element.getAttribute('data-wechat-template') || '',
    canonicalHash: element.getAttribute('data-canonical-sha256') || '',
    generatedAt: element.getAttribute('data-layout-generated-at') || '',
  });
  const bodyMetadata = readMetadata(body);
  const rootMetadata = readMetadata(root);
  if (JSON.stringify(bodyMetadata) !== JSON.stringify(rootMetadata)) return null;
  if (!listLayoutTemplates().some(template => template.filename === bodyMetadata.template)) return null;
  if (!/^[a-f0-9]{64}$/.test(bodyMetadata.canonicalHash)) return null;
  const generatedTime = Date.parse(bodyMetadata.generatedAt);
  if (!Number.isFinite(generatedTime)
    || new Date(generatedTime).toISOString() !== bodyMetadata.generatedAt) return null;
  return bodyMetadata;
}

function layoutDocumentIsSafe(document) {
  if (!document?.head || !document?.body) return false;
  if (document.head.querySelectorAll('title').length !== 1) return false;
  if (document.querySelector('script,iframe,object,embed,template,noscript,base,link,math,video,audio,source,track,canvas')) {
    return false;
  }
  if (document.body.querySelector('title,textarea,xmp,noembed,noframes,plaintext,style,meta,form,input,button,select,option,dialog')) {
    return false;
  }
  if (document.querySelector('meta[http-equiv="refresh"],svg animate,svg animateMotion,svg animateTransform,svg set,svg foreignObject,svg use')) {
    return false;
  }
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || COMMAND_ATTRIBUTES.has(name)) return false;
      if (RESOURCE_ATTRIBUTES.has(name)
        && !isAllowedResourceAttribute(element, name, attribute.value)) return false;
      if (name === 'style'
        && /(?:javascript\s*:|vbscript\s*:|expression\s*\(|@import)/i.test(attribute.value)) return false;
    }
  }
  return true;
}

function renderLayoutTemplate(filename, input = {}) {
  const target = safeTemplatePath(filename);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('排版内容必须是对象');
  for (const field of ['title', 'summary', 'body']) {
    if (typeof input[field] !== 'string') throw new Error(`${field} 必须是字符串`);
  }
  const { title, summary, body } = normalizeCanonicalContent(input);
  if (!title) throw new Error('title 不能为空');
  if (!body) throw new Error('body 不能为空');

  const accountName = input.accountName === undefined
    ? String(process.env.PUBLISHER_ACCOUNT_NAME || '').trim()
    : String(input.accountName).trim();
  const accountDescription = input.accountDescription === undefined
    ? String(process.env.PUBLISHER_ACCOUNT_DESCRIPTION || '').trim()
    : String(input.accountDescription).trim();
  const generatedAt = input.generatedAt === undefined
    ? new Date().toISOString()
    : String(input.generatedAt).trim();
  if (!generatedAt) throw new Error('generatedAt 不能为空');
  const source = fs.readFileSync(target, 'utf8');
  const document = parseTemplateDocument(source);
  normalizeTemplateDocument(document, {
    filename,
    title,
    summary,
    body,
    accountName,
    accountDescription,
    canonicalHash: canonicalContentHash({ title, summary, body }),
    generatedAt,
  });
  const serialized = serializeTemplateDocument(document, title);
  if (!inspectLayoutMetadata(serialized)) {
    throw new Error('模板最终产物安全校验失败');
  }
  return serialized;
}

module.exports = {
  ARTICLE_ALLOWED_ELEMENTS,
  TEMPLATE_DIR,
  canonicalContentHash,
  inspectLayoutMetadata,
  listLayoutTemplates,
  normalizeCanonicalContent,
  renderLayoutTemplate,
};
