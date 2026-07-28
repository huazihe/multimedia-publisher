const port = Number(process.argv[2] || 28009)
const x = Number(process.argv[3] || 884)
const y = Number(process.argv[4] || 812)

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
  await send(ws, 'Runtime.enable')
  const result = await send(ws, 'Runtime.evaluate', {
    expression: `(() => {
      function info(el) {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || el.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().slice(0, 160),
          className: String(el.className || "").slice(0, 160),
          disabled: Boolean(el.disabled || el.getAttribute("aria-disabled") === "true" || /disabled/.test(String(el.className || ""))),
          pointerEvents: style.pointerEvents,
          zIndex: style.zIndex,
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        };
      }
      const pointEl = document.elementFromPoint(${JSON.stringify(x)}, ${JSON.stringify(y)});
      const publish = Array.from(document.querySelectorAll("button, [role=button], a, div, span"))
        .find(el => (el.textContent || "").replace(/\\s+/g, "").trim() === "预览并发布");
      return {
        viewport: { w: window.innerWidth, h: window.innerHeight, scrollX, scrollY },
        point: info(pointEl),
        pointParent: info(pointEl?.parentElement),
        publish: info(publish),
        publishAtCenter: publish ? info(document.elementFromPoint(
          publish.getBoundingClientRect().left + publish.getBoundingClientRect().width / 2,
          publish.getBoundingClientRect().top + publish.getBoundingClientRect().height / 2
        )) : null
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  console.log(JSON.stringify(result.result?.value, null, 2))
} finally {
  ws.close()
}
