const port = Number(process.argv[2] || process.env.WEIBOT_DOUYIN_CDP_PORT || 30782)
const durationMs = Number(process.argv[3] || 90000)

let seq = 0
const pending = new Map()
const requests = new Map()
const events = []

async function getPageWebSocketUrl() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
  const page = targets.find(target => target.type === 'page' && /creator\.douyin\.com/.test(target.url))
    || targets.find(target => target.type === 'page')
  if (!page?.webSocketDebuggerUrl) throw new Error(`No page target found on port ${port}`)
  return page.webSocketDebuggerUrl
}

function interesting(url = '') {
  return /creator\.douyin\.com|douyin\.com|byte/i.test(url)
    && /(publish|post|article|aweme|media|draft|creation|item|micro|upload|submit|cover|image|material)/i.test(url)
}

function connect(url) {
  const ws = new WebSocket(url)
  ws.addEventListener('message', async event => {
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
      requests.set(params.requestId, {
        method: params.request?.method,
        url,
        postData: params.request?.postData?.slice?.(0, 800),
      })
      events.push({
        type: 'request',
        method: params.request?.method,
        url,
        postData: params.request?.postData?.slice?.(0, 500),
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
          item.body = String(body.body || '').slice(0, 1200)
        } catch {}
      }, 250)
    }
  })

  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(ws), { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
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

const ws = await connect(await getPageWebSocketUrl())
try {
  await send(ws, 'Network.enable')
  await send(ws, 'Runtime.enable').catch(() => undefined)
  console.error(`Monitoring Douyin network on ${port} for ${durationMs}ms...`)
  await new Promise(resolve => setTimeout(resolve, durationMs))
  console.log(JSON.stringify(events, null, 2))
} finally {
  ws.close()
}
