const port = Number(process.argv[2])
const url = process.argv[3]
const hostPattern = process.argv[4] || ''

if (!port || !url) {
  console.error('Usage: node scripts/navigate-cdp-page.mjs <port> <url> [host-pattern]')
  process.exit(1)
}

let seq = 0
const pending = new Map()

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
const pattern = hostPattern ? new RegExp(hostPattern) : null
const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl && (!pattern || pattern.test(target.url || '')))
  || targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl)
if (!page?.webSocketDebuggerUrl) throw new Error(`No page target found on port ${port}`)

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

const ws = new WebSocket(page.webSocketDebuggerUrl)
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
  await send(ws, 'Page.enable')
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.navigate', { url })
  const started = Date.now()
  while (Date.now() - started < 30000) {
    const result = await send(ws, 'Runtime.evaluate', {
      expression: `document.readyState === "complete" || document.readyState === "interactive"`,
      returnByValue: true,
    }).catch(() => null)
    if (result?.result?.value) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  await new Promise(resolve => setTimeout(resolve, 3000))
  const state = await send(ws, 'Runtime.evaluate', {
    expression: `({ url: location.href, title: document.title, text: (document.body?.innerText || "").replace(/\\s+/g, " ").slice(0, 800) })`,
    returnByValue: true,
  })
  console.log(JSON.stringify(state.result?.value, null, 2))
} finally {
  ws.close()
}
