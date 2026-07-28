const port = Number(process.argv[2] || 57303)
const keyword = process.argv[3] || '将进酒'

let seq = 0
const pending = new Map()

async function getPageWebSocketUrl() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
  const page = targets.find(target => target.type === 'page' && /creator\.xiaohongshu\.com/.test(target.url))
    || targets.find(target => target.type === 'page')
  if (!page?.webSocketDebuggerUrl) throw new Error(`No Xiaohongshu page target found on port ${port}`)
  return page.webSocketDebuggerUrl
}

function send(ws, method, params = {}, timeoutMs = 30000) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`${method} timed out`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timeout })
  })
}

const ws = new WebSocket(await getPageWebSocketUrl())
ws.addEventListener('message', event => {
  const payload = JSON.parse(String(event.data))
  if (!payload.id || !pending.has(payload.id)) return
  const item = pending.get(payload.id)
  pending.delete(payload.id)
  clearTimeout(item.timeout)
  if (payload.error) item.reject(new Error(payload.error.message || JSON.stringify(payload.error)))
  else item.resolve(payload.result)
})

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

try {
  await send(ws, 'Runtime.enable')
  await send(ws, 'Runtime.evaluate', {
    expression: `(() => {
      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      }
      const item = Array.from(document.querySelectorAll("div,span,a,button"))
        .filter(visible)
        .find(el => (el.textContent || "").replace(/\\s+/g, "").trim() === "笔记管理");
      if (item) item.click();
      return Boolean(item);
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  await new Promise(resolve => setTimeout(resolve, 3500))
  const result = await send(ws, 'Runtime.evaluate', {
    expression: `(() => {
      const text = (document.body?.innerText || "").replace(/\\s+/g, " ");
      return {
        url: location.href,
        hasKeyword: text.includes(${JSON.stringify(keyword)}),
        text: text.slice(0, 5000)
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  console.log(JSON.stringify(result.result?.value, null, 2))
} finally {
  ws.close()
}
