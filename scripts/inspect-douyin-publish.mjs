const port = Number(process.argv[2] || process.env.WEIBOT_DOUYIN_CDP_PORT || 19734)
const targetUrl = process.argv[3] || 'https://creator.douyin.com/creator-micro/content/upload?default-tab=5&enter_from=publish'
const clickText = process.env.CLICK_TEXT || ''

let seq = 0
const pending = new Map()

async function getPageWebSocketUrl() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
  const page = targets.find(target => target.type === 'page' && /creator\.douyin\.com/.test(target.url))
    || targets.find(target => target.type === 'page')
  if (!page?.webSocketDebuggerUrl) throw new Error(`No page target found on port ${port}`)
  return page.webSocketDebuggerUrl
}

function send(ws, method, params = {}) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    setTimeout(() => {
      if (!pending.has(id)) return
      pending.delete(id)
      reject(new Error(`${method} timed out`))
    }, 30000)
  })
}

function connect(url) {
  const ws = new WebSocket(url)
  ws.addEventListener('message', event => {
    const payload = JSON.parse(event.data)
    if (!payload.id || !pending.has(payload.id)) return
    const item = pending.get(payload.id)
    pending.delete(payload.id)
    if (payload.error) item.reject(new Error(payload.error.message || JSON.stringify(payload.error)))
    else item.resolve(payload.result)
  })
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(ws), { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
}

async function evaluate(ws, expression, timeout = 30000) {
  const result = await send(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed')
  }
  return result.result?.value
}

async function waitForReady(ws) {
  const start = Date.now()
  while (Date.now() - start < 45000) {
    const ready = await evaluate(ws, `document.readyState === 'complete' || document.readyState === 'interactive'`).catch(() => false)
    if (ready) return
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

const ws = await connect(await getPageWebSocketUrl())
try {
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'DOM.enable').catch(() => undefined)
  await send(ws, 'Page.navigate', { url: targetUrl })
  await waitForReady(ws)
  await new Promise(resolve => setTimeout(resolve, 6000))

  if (clickText) {
    const clicked = await evaluate(ws, `(() => {
      const clickText = ${JSON.stringify(clickText)};
      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }
      const items = Array.from(document.querySelectorAll('button, [role="button"], a, span, div'))
        .filter(visible)
        .map(el => ({
          el,
          text: (el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim(),
          isButton: el.matches('button, [role="button"], a')
        }))
        .filter(item => item.text && item.text.length <= 80);
      const item = items.find(item => item.isButton && item.text === clickText)
        || items.find(item => item.text === clickText)
        || items.find(item => item.isButton && item.text.includes(clickText))
        || items.find(item => item.text.includes(clickText));
      if (!item) return { ok: false, error: 'click target not found', clickText };
      item.el.scrollIntoView({ block: 'center', inline: 'center' });
      item.el.click();
      return { ok: true, text: item.text, url: location.href };
    })()`)
    console.log(JSON.stringify({ clicked }, null, 2))
    await new Promise(resolve => setTimeout(resolve, 8000))
  }

  const data = await evaluate(ws, `(() => {
    function visible(el) {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }
    function selector(el) {
      const parts = [];
      let current = el;
      while (current && current.nodeType === 1 && parts.length < 4) {
        let part = current.tagName.toLowerCase();
        if (current.id) part += '#' + CSS.escape(current.id);
        const className = typeof current.className === 'string' ? current.className.trim().split(/\\s+/).slice(0, 3).join('.') : '';
        if (className) part += '.' + className;
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(' > ');
    }
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, span, div'))
      .filter(visible)
      .map(el => {
        const rect = el.getBoundingClientRect();
        const fullText = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim();
        const text = fullText.length > 160 ? '' : fullText;
        return {
          tag: el.tagName.toLowerCase(),
          text: text.slice(0, 120),
          className: typeof el.className === 'string' ? el.className.slice(0, 160) : '',
          selector: selector(el),
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        };
      })
      .filter(item => item.text && /(发布|发表|提交|保存|草稿|图文|文章|发文|导入|下一步|确认|确定)/.test(item.text))
      .slice(0, 120);
    const fields = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]'))
      .filter(visible)
      .map(el => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || '',
          placeholder: el.getAttribute('placeholder') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          className: typeof el.className === 'string' ? el.className.slice(0, 160) : '',
          text: ((el.value || el.innerText || el.textContent || '') + '').replace(/\\s+/g, ' ').slice(0, 120),
          selector: selector(el),
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        };
      });
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'))
      .map(el => ({
        accept: el.getAttribute('accept') || '',
        multiple: el.hasAttribute('multiple'),
        className: typeof el.className === 'string' ? el.className.slice(0, 160) : '',
        selector: selector(el),
      }));
    return {
      url: location.href,
      title: document.title,
      bodyText: (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 1200),
      candidates,
      fields,
      fileInputs,
    };
  })()`)

  console.log(JSON.stringify(data, null, 2))
} finally {
  ws.close()
}
