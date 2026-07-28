const port = Number(process.argv[2] || process.env.WEIBOT_TOUTIAO_CDP_PORT || 28009)
const durationMs = Number(process.argv[3] || 120000)

let seq = 0
const pending = new Map()
const events = []

async function getPageWebSocketUrl() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
  const page = targets.find(target => target.type === 'page' && /mp\.toutiao\.com/.test(target.url))
    || targets.find(target => target.type === 'page')
  if (!page?.webSocketDebuggerUrl) throw new Error(`No Toutiao page target found on port ${port}`)
  return page.webSocketDebuggerUrl
}

function interesting(url = '') {
  return /toutiao\.com|byteimg\.com|bytedance|snssdk/i.test(url)
    && /(publish|article|graphic|create|submit|save|draft|media|image|upload|mp|pgc|api)/i.test(url)
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
  if (payload.id && pending.has(payload.id)) {
    const item = pending.get(payload.id)
    pending.delete(payload.id)
    clearTimeout(item.timeout)
    if (payload.error) item.reject(new Error(payload.error.message || JSON.stringify(payload.error)))
    else item.resolve(payload.result)
    return
  }
  if (payload.method === 'Network.requestWillBeSent') {
    const params = payload.params || {}
    const url = params.request?.url || ''
    if (!interesting(url)) return
    events.push({
      type: 'request',
      method: params.request?.method,
      url,
      postData: params.request?.postData?.slice?.(0, 1200),
    })
    return
  }
  if (payload.method === 'Network.responseReceived') {
    const params = payload.params || {}
    const url = params.response?.url || ''
    if (!interesting(url)) return
    const item = {
      type: 'response',
      requestId: params.requestId,
      status: params.response?.status,
      url,
      mimeType: params.response?.mimeType,
    }
    events.push(item)
    setTimeout(async () => {
      try {
        const body = await send(ws, 'Network.getResponseBody', { requestId: params.requestId }, 5000)
        item.body = String(body.body || '').slice(0, 2500)
      } catch {}
    }, 250)
  }
})

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

try {
  await send(ws, 'Network.enable')
  await send(ws, 'Runtime.enable').catch(() => undefined)
  console.error(`Monitoring Toutiao network on ${port} for ${durationMs}ms...`)
  await new Promise(resolve => setTimeout(resolve, durationMs))
  console.log(JSON.stringify(events, null, 2))
} finally {
  ws.close()
}
