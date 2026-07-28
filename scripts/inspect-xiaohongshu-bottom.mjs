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
  await evaluate(ws, `(() => {
    const primary = document.querySelector('.publish-page');
    const scrollers = [primary, document.scrollingElement, document.documentElement, document.body, ...document.querySelectorAll('*')];
    for (const el of scrollers) {
      if (!el || typeof el.scrollTo !== 'function') continue;
      try { el.scrollTo(0, el.scrollHeight || 999999); } catch {}
    }
    return { y: scrollY, bodyHeight: document.body.scrollHeight };
  })()`)
  await new Promise(resolve => setTimeout(resolve, 1000))
  const data = await evaluate(ws, `(() => {
    function visible(el) {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }
    return {
      url: location.href,
      text: (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(-1200),
      buttons: Array.from(document.querySelectorAll('button, [role="button"], div, span'))
        .filter(visible)
        .map(el => {
          const rect = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, '').trim().slice(0, 100),
            className: typeof el.className === 'string' ? el.className.slice(0, 140) : '',
            disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled/.test(el.className || '')),
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          };
        })
        .filter(item => item.text && /(发布|保存|草稿|取消|确定|确认|公开|定时)/.test(item.text))
        .slice(-120),
    };
  })()`)
  console.log(JSON.stringify(data, null, 2))
} finally {
  ws.close()
}
