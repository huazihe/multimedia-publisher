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
    return Array.from(document.querySelectorAll('*'))
      .map(el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          selector: selector(el),
          className: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
          overflowY: style.overflowY,
          scrollTop: Math.round(el.scrollTop || 0),
          scrollHeight: Math.round(el.scrollHeight || 0),
          clientHeight: Math.round(el.clientHeight || 0),
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          text: (el.textContent || '').replace(/\\s+/g, '').trim().slice(0, 80),
        };
      })
      .filter(item => item.scrollHeight > item.clientHeight + 20)
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
      .slice(0, 80);
  })()`)
  console.log(JSON.stringify(data, null, 2))
} finally {
  ws.close()
}
