const port = Number(process.argv[2] || 57303)

let seq = 0
const pending = new Map()

async function wsUrl() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
  const page = targets.find(target => target.type === 'page' && /creator\.xiaohongshu\.com/.test(target.url))
    || targets.find(target => target.type === 'page')
  if (!page?.webSocketDebuggerUrl) throw new Error(`No page target found on port ${port}`)
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

const ws = new WebSocket(await wsUrl())
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
  const pointResult = await send(ws, 'Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector("xhs-publish-btn");
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width * 0.61),
        y: Math.round(rect.top + rect.height * 0.5),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  const point = pointResult.result?.value
  console.log(JSON.stringify({ point }, null, 2))
  if (!point) throw new Error('xhs-publish-btn not found')
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await new Promise(resolve => setTimeout(resolve, 8000))
  const result = await send(ws, 'Runtime.evaluate', {
    expression: `(() => ({
      url: location.href,
      text: (document.body?.innerText || "").replace(/\\s+/g, " ").slice(-2500)
    }))()`,
    awaitPromise: true,
    returnByValue: true,
  })
  console.log(JSON.stringify(result.result?.value, null, 2))
} finally {
  ws.close()
}
