interface CdpTarget {
  type?: string
  url?: string
  webSocketDebuggerUrl?: string
}

interface CdpMessage<T = unknown> {
  id?: number
  method?: string
  params?: unknown
  result?: T
  error?: {
    message?: string
  }
}

interface RuntimeEvaluateResult<T> {
  result?: {
    type?: string
    value?: T
    description?: string
  }
  exceptionDetails?: {
    text?: string
    exception?: {
      description?: string
    }
  }
}

interface DomDocumentResult {
  root: {
    nodeId: number
  }
}

interface DomQuerySelectorResult {
  nodeId: number
}

export class CdpClient {
  private nextId = 0

  private constructor(private socket: WebSocket) {}

  static async connect(webSocketDebuggerUrl: string): Promise<CdpClient> {
    if (typeof WebSocket === 'undefined') {
      throw new Error('Current runtime does not expose WebSocket. Please use Node.js 22+ or the bundled CLI.')
    }

    const socket = new WebSocket(webSocketDebuggerUrl)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out connecting to Chrome DevTools WebSocket.')), 10000)

      socket.addEventListener('open', () => {
        clearTimeout(timeout)
        resolve()
      }, { once: true })

      socket.addEventListener('error', () => {
        clearTimeout(timeout)
        reject(new Error('Failed to connect to Chrome DevTools WebSocket.'))
      }, { once: true })
    })

    const client = new CdpClient(socket)
    await client.send('Runtime.enable').catch(() => undefined)
    await client.send('Page.enable').catch(() => undefined)
    await client.send('DOM.enable').catch(() => undefined)
    return client
  }

  send<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
    const id = ++this.nextId

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket.removeEventListener('message', onMessage)
        reject(new Error(`${method} timeout`))
      }, timeoutMs)

      const onMessage = (event: MessageEvent) => {
        const message = JSON.parse(String(event.data)) as CdpMessage<T>
        if (message.id !== id) return

        clearTimeout(timeout)
        this.socket.removeEventListener('message', onMessage)

        if (message.error) {
          reject(new Error(message.error.message || `${method} failed`))
        } else {
          resolve(message.result as T)
        }
      }

      this.socket.addEventListener('message', onMessage)
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  waitForEvent<T = unknown>(method: string, timeoutMs = 15000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket.removeEventListener('message', onMessage)
        reject(new Error(`${method} event timeout`))
      }, timeoutMs)

      const onMessage = (event: MessageEvent) => {
        const message = JSON.parse(String(event.data)) as CdpMessage
        if (message.method !== method) return

        clearTimeout(timeout)
        this.socket.removeEventListener('message', onMessage)
        resolve(message.params as T)
      }

      this.socket.addEventListener('message', onMessage)
    })
  }

  async navigate(url: string, timeoutMs = 30000): Promise<void> {
    await this.send('Page.navigate', { url })
    await this.waitForExpression(
      `document.readyState === 'complete' || document.readyState === 'interactive'`,
      timeoutMs
    )
  }

  async evaluate<T>(expression: string, timeoutMs = 15000): Promise<T> {
    const result = await this.send<RuntimeEvaluateResult<T>>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs)

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Page evaluation failed.')
    }

    return result.result?.value as T
  }

  async waitForExpression(expression: string, timeoutMs: number, intervalMs = 400): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const result = await this.evaluate<boolean>(`Boolean(${expression})`).catch(() => false)
      if (result) return
      await delay(intervalMs)
    }
    throw new Error(`Timed out waiting for page condition: ${expression}`)
  }

  async setFileInputFiles(selector: string, files: string[], timeoutMs = 15000): Promise<void> {
    await this.waitForExpression(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, timeoutMs)
    const documentResult = await this.send<DomDocumentResult>('DOM.getDocument', { depth: -1, pierce: true })
    const queryResult = await this.send<DomQuerySelectorResult>('DOM.querySelector', {
      nodeId: documentResult.root.nodeId,
      selector,
    })
    if (!queryResult.nodeId) {
      throw new Error(`File input not found: ${selector}`)
    }
    await this.send('DOM.setFileInputFiles', {
      nodeId: queryResult.nodeId,
      files,
    }, timeoutMs)
  }

  async insertText(text: string, timeoutMs = 15000): Promise<void> {
    await this.send('Input.insertText', { text }, timeoutMs)
  }

  close(): void {
    this.socket.close()
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function waitForJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  const start = Date.now()
  let lastError: unknown

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json() as T
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await delay(400)
  }

  throw new Error(`Timed out waiting for Chrome DevTools at ${url}: ${(lastError as Error | undefined)?.message || 'unknown error'}`)
}

export async function getPageDebuggerUrl(port: number, targetUrl: string, preferredHost?: string): Promise<string> {
  const targets = await waitForJson<CdpTarget[]>(`http://127.0.0.1:${port}/json/list`)
  const hostMatches = (target: CdpTarget): boolean => {
    if (!target.url) return false
    try {
      return new URL(target.url).hostname.endsWith(preferredHost || '')
    } catch {
      return false
    }
  }
  const preferred = preferredHost
    ? targets.find(target =>
      target.type === 'page'
      && target.webSocketDebuggerUrl
      && hostMatches(target)
    )
    : null
  const page = preferred
    || targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl)
    || targets.find(target => target.webSocketDebuggerUrl)

  if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl

  const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(targetUrl)}`, {
    method: 'PUT',
  })
  if (!created.ok) throw new Error(`Could not create Chrome page: HTTP ${created.status}`)

  const target = await created.json() as CdpTarget
  if (!target.webSocketDebuggerUrl) throw new Error('Chrome page did not expose a DevTools WebSocket URL.')
  return target.webSocketDebuggerUrl
}

export async function connectCdpPage(port: number, targetUrl: string, preferredHost?: string): Promise<CdpClient> {
  const debuggerUrl = await getPageDebuggerUrl(port, targetUrl, preferredHost)
  return CdpClient.connect(debuggerUrl)
}

export function readEnv(name: string): string | undefined {
  if (typeof process === 'undefined') return undefined
  return process.env[name]
}

export function resolveEnvPort(names: string[], label: string): number | null {
  const raw = names.map(readEnv).find(Boolean)
  if (!raw) return null

  const port = Number(raw)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid ${label} CDP port: ${raw}`)
  }

  return port
}
