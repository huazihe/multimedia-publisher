const port = Number(process.argv[2] || 57303)
const out = process.argv[3] || 'tmp-cdp-screenshot.png'
let seq = 0
const pending = new Map()

async function wsUrl() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())
  const page = targets.find(target => target.type === 'page' && /creator\.xiaohongshu\.com|creator\.douyin\.com|mp\.toutiao\.com/.test(target.url))
    || targets.find(target => target.type === 'page')
  if (!page?.webSocketDebuggerUrl) throw new Error(`No page target found on port ${port}`)
  return page.webSocketDebuggerUrl
}

function send(ws, method, params = {}) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`${method} timeout`))
    }, 30000)
    pending.set(id, result => {
      clearTimeout(timer)
      resolve(result)
    })
  })
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
  await send(ws, 'Page.enable')
  const screenshot = await send(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true })
  const fs = await import('node:fs/promises')
  await fs.writeFile(out, Buffer.from(screenshot.data, 'base64'))
  console.log(out)
} finally {
  ws.close()
}
