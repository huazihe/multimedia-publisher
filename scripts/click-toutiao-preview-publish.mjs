const port = Number(process.argv[2] || 28009)

let seq = 0
const pending = new Map()

async function wsUrl() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
  const page = targets.find(target => target.type === 'page' && /mp\.toutiao\.com/.test(target.url))
    || targets.find(target => target.type === 'page')
  if (!page?.webSocketDebuggerUrl) throw new Error(`No Toutiao page target found on port ${port}`)
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
  await send(ws, 'Page.enable').catch(() => undefined)
  await send(ws, 'Page.bringToFront').catch(() => undefined)
  await send(ws, 'Runtime.enable')
  const closePoint = await send(ws, 'Runtime.evaluate', {
    expression: `(() => {
      const drawer = document.querySelector(".ai-assistant-drawer, .byte-drawer");
      if (!drawer) return null;
      const rect = drawer.getBoundingClientRect();
      return { x: Math.round(rect.right - 24), y: Math.round(rect.top + 24) };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  }).catch(() => null)
  if (closePoint?.result?.value) {
    const point = closePoint.result.value
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  }
  await new Promise(resolve => setTimeout(resolve, 800))
  const targetResult = await send(ws, 'Runtime.evaluate', {
    expression: `(() => {
      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      }
      const button = Array.from(document.querySelectorAll("button, [role=button], a, div, span"))
        .filter(visible)
        .find(el => (el.textContent || "").replace(/\\s+/g, "").trim() === "预览并发布");
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), text: button.textContent };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  const target = targetResult.result?.value
  console.log(JSON.stringify({ target }, null, 2))
  if (!target) throw new Error('预览并发布 button not found')
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y, button: 'none', buttons: 0 })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', buttons: 1, clickCount: 1 })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', buttons: 0, clickCount: 1 })
  await new Promise(resolve => setTimeout(resolve, 5000))
  const state = await send(ws, 'Runtime.evaluate', {
    expression: `(() => ({
      url: location.href,
      text: (document.body?.innerText || "").replace(/\\s+/g, " ").slice(-2500)
    }))()`,
    awaitPromise: true,
    returnByValue: true,
  })
  console.log(JSON.stringify(state.result?.value, null, 2))
} finally {
  ws.close()
}
