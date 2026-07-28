const port = Number(process.argv[2] || 57303)
let seq = 0
const pending = new Map()

async function wsUrl() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())
  const page = targets.find(target => target.type === 'page' && /creator\.xiaohongshu\.com/.test(target.url))
    || targets.find(target => target.type === 'page')
  if (!page?.webSocketDebuggerUrl) throw new Error(`No page target found on port ${port}`)
  return page.webSocketDebuggerUrl
}

function send(ws, method, params = {}) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise(resolve => pending.set(id, resolve))
}

async function evaluate(ws, expression) {
  const result = await send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return result.result?.value
}

const ws = new WebSocket(await wsUrl())
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (!pending.has(message.id)) return
  const resolve = pending.get(message.id)
  pending.delete(message.id)
  resolve(message.result)
})

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

try {
  await send(ws, 'Runtime.enable')
  const data = await evaluate(ws, `(() => {
    function selector(el) {
      const parts = [];
      let current = el;
      while (current && current.nodeType === 1 && parts.length < 5) {
        let part = current.tagName.toLowerCase();
        if (current.id) part += '#' + CSS.escape(current.id);
        const cls = typeof current.className === 'string' ? current.className.trim().split(/\\s+/).slice(0, 4).join('.') : '';
        if (cls) part += '.' + cls;
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(' > ');
    }
    function visible(el) {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }
    return Array.from(document.querySelectorAll('button, [role="button"], a, div, span'))
      .map(el => {
        const rect = el.getBoundingClientRect();
        const text = (el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, '').trim();
        return {
          tag: el.tagName.toLowerCase(),
          text: text.slice(0, 200),
          className: typeof el.className === 'string' ? el.className.slice(0, 200) : '',
          selector: selector(el),
          visible: visible(el),
          disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled/.test(el.className || '')),
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        };
      })
      .filter(item => {
        const haystack = item.text + ' ' + item.className + ' ' + item.selector;
        if (/^(发布|发布笔记|立即发布|提交|完成|下一步|保存草稿|存草稿)$/.test(item.text)) return true;
        if (/(submit|publish|post|footer|action|btn|button)/i.test(haystack) && /(发布|提交|完成|保存)/.test(haystack)) return true;
        return false;
      })
      .filter(item => item.text.length <= 80)
      .slice(0, 300);
  })()`)
  console.log(JSON.stringify(data, null, 2))
} finally {
  ws.close()
}
