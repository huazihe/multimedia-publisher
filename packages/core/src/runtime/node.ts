import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseHTML } from 'linkedom'
import type { Cookie, HeaderRule } from '../types'
import type { RuntimeConfig, RuntimeInterface } from './interface'

type CookieInput =
  | Cookie[]
  | Record<string, Cookie[] | Record<string, string> | string>

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

function normalizeDomain(domain: string): string {
  return domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
}

function domainMatches(hostname: string, domain: string): boolean {
  const host = normalizeDomain(hostname)
  const bareDomain = normalizeDomain(domain).replace(/^\./, '')
  return host === bareDomain || host.endsWith(`.${bareDomain}`)
}

function cookiePathMatches(requestPath: string, cookiePath?: string): boolean {
  if (!cookiePath || cookiePath === '/') return true
  return requestPath.startsWith(cookiePath)
}

function parseCookieHeader(header: string, domain: string): Cookie[] {
  return header
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const index = part.indexOf('=')
      return {
        name: index >= 0 ? part.slice(0, index).trim() : part,
        value: index >= 0 ? part.slice(index + 1).trim() : '',
        domain,
        path: '/',
      }
    })
}

function parseSetCookieHeader(header: string, fallbackDomain: string): Cookie | null {
  const segments = header.split(';').map(segment => segment.trim()).filter(Boolean)
  const [nameValue, ...attrs] = segments
  if (!nameValue) return null

  const index = nameValue.indexOf('=')
  if (index < 0) return null

  const cookie: Cookie = {
    name: nameValue.slice(0, index).trim(),
    value: nameValue.slice(index + 1).trim(),
    domain: fallbackDomain,
    path: '/',
  }

  for (const attr of attrs) {
    const [key, ...rest] = attr.split('=')
    const value = rest.join('=')
    switch (key.toLowerCase()) {
      case 'domain':
        cookie.domain = value || fallbackDomain
        break
      case 'path':
        cookie.path = value || '/'
        break
      case 'secure':
        cookie.secure = true
        break
      case 'httponly':
        cookie.httpOnly = true
        break
      case 'expires': {
        const date = Date.parse(value)
        if (!Number.isNaN(date)) cookie.expirationDate = Math.floor(date / 1000)
        break
      }
      case 'max-age': {
        const seconds = Number(value)
        if (!Number.isNaN(seconds)) {
          cookie.expirationDate = Math.floor(Date.now() / 1000) + seconds
        }
        break
      }
    }
  }

  return cookie
}

function urlFilterMatches(filter: string, target: string): boolean {
  const escaped = filter
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(target)
}

export class NodeRuntime implements RuntimeInterface {
  readonly type = 'node' as const

  private cookiesByDomain = new Map<string, Cookie[]>()
  private storageCache: Record<string, unknown> | null = null
  private sessionCache = new Map<string, unknown>()
  private headerRuleCounter = 0
  private headerRuleMap = new Map<string, HeaderRule>()
  private ready: Promise<void>

  constructor(private config: RuntimeConfig = {}) {
    this.ready = this.loadInitialCookies()
  }

  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    await this.ready

    const target = new URL(url)
    const headers = new Headers(options.headers || {})
    const credentials = options.credentials ?? 'include'

    if (!headers.has('User-Agent')) {
      headers.set('User-Agent', this.config.userAgent || DEFAULT_USER_AGENT)
    }

    for (const [key, value] of Object.entries(this.config.headers || {})) {
      if (!headers.has(key)) headers.set(key, value)
    }

    for (const rule of this.headerRuleMap.values()) {
      if (urlFilterMatches(rule.urlFilter, url)) {
        for (const [key, value] of Object.entries(rule.headers)) {
          headers.set(key, value)
        }
      }
    }

    if (credentials !== 'omit' && !headers.has('Cookie')) {
      const cookieHeader = this.getCookieHeader(target)
      if (cookieHeader) headers.set('Cookie', cookieHeader)
    }

    const controller = new AbortController()
    const timeout = this.config.timeout ?? 30000
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: options.signal || controller.signal,
      })
      await this.captureResponseCookies(response, target.hostname)
      return response
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Request timeout (${timeout / 1000}s): ${url}`)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  cookies = {
    get: async (domain: string): Promise<Cookie[]> => {
      await this.ready
      const result: Cookie[] = []
      for (const [storedDomain, cookies] of this.cookiesByDomain.entries()) {
        if (domainMatches(domain, storedDomain) || domainMatches(storedDomain, domain)) {
          result.push(...cookies)
        }
      }
      return result
    },

    set: async (cookie: Cookie): Promise<void> => {
      await this.ready
      this.setCookie(cookie)
    },

    remove: async (name: string, domain: string): Promise<void> => {
      await this.ready
      const key = normalizeDomain(domain)
      const current = this.cookiesByDomain.get(key) || []
      this.cookiesByDomain.set(key, current.filter(cookie => cookie.name !== name))
    },
  }

  async getCookie(domain: string, name: string): Promise<string | null> {
    const cookies = await this.cookies.get(domain)
    return cookies.find(cookie => cookie.name === name)?.value ?? null
  }

  storage = {
    get: async <T>(key: string): Promise<T | null> => {
      await this.loadStorage()
      return (this.storageCache?.[key] as T | undefined) ?? null
    },

    set: async <T>(key: string, value: T): Promise<void> => {
      await this.loadStorage()
      this.storageCache![key] = value
      await this.saveStorage()
    },

    remove: async (key: string): Promise<void> => {
      await this.loadStorage()
      delete this.storageCache![key]
      await this.saveStorage()
    },
  }

  session = {
    get: async <T>(key: string): Promise<T | null> => {
      return (this.sessionCache.get(key) as T | undefined) ?? null
    },

    set: async <T>(key: string, value: T): Promise<void> => {
      this.sessionCache.set(key, value)
    },
  }

  headerRules = {
    add: async (rule: HeaderRule): Promise<string> => {
      const id = `node_rule_${++this.headerRuleCounter}`
      this.headerRuleMap.set(id, { ...rule, id })
      return id
    },

    remove: async (ruleId: string): Promise<void> => {
      this.headerRuleMap.delete(ruleId)
    },

    clear: async (): Promise<void> => {
      this.headerRuleMap.clear()
    },
  }

  downloads = {
    download: async (blob: Blob, filename: string): Promise<number> => {
      const dir = this.resolveDownloadDir()
      await mkdir(dir, { recursive: true })
      const filePath = path.join(dir, filename)
      const buffer = Buffer.from(await blob.arrayBuffer())
      await writeFile(filePath, buffer)
      return Date.now()
    },
  }

  dom = {
    parseHTML: async (html: string): Promise<Document> => {
      return parseHTML(html).document as unknown as Document
    },

    querySelector: (doc: Document, selector: string): Element | null => {
      return doc.querySelector(selector)
    },

    querySelectorAll: (doc: Document, selector: string): Element[] => {
      return Array.from(doc.querySelectorAll(selector))
    },

    getTextContent: (element: Element): string => {
      return element.textContent || ''
    },

    getInnerHTML: (element: Element): string => {
      return element.innerHTML
    },
  }

  private async loadInitialCookies(): Promise<void> {
    if (this.config.cookies) {
      this.importCookies(this.config.cookies)
    }

    const cookieFile = this.config.cookieFile || process.env.CREATOR_COOKIE_FILE
    if (!cookieFile || !existsSync(cookieFile)) return

    const content = await readFile(cookieFile, 'utf-8')
    this.importCookies(JSON.parse(content) as CookieInput)
  }

  private importCookies(input: CookieInput): void {
    if (Array.isArray(input)) {
      for (const cookie of input) this.setCookie(cookie)
      return
    }

    for (const [domain, value] of Object.entries(input)) {
      if (Array.isArray(value)) {
        for (const cookie of value) this.setCookie({ ...cookie, domain: cookie.domain || domain })
      } else if (typeof value === 'string') {
        for (const cookie of parseCookieHeader(value, domain)) this.setCookie(cookie)
      } else {
        for (const [name, cookieValue] of Object.entries(value)) {
          this.setCookie({ name, value: cookieValue, domain, path: '/' })
        }
      }
    }
  }

  private setCookie(cookie: Cookie): void {
    const key = normalizeDomain(cookie.domain)
    const current = this.cookiesByDomain.get(key) || []
    const next = current.filter(existing => existing.name !== cookie.name || existing.path !== cookie.path)
    next.push({ ...cookie, domain: key })
    this.cookiesByDomain.set(key, next)
  }

  private getCookieHeader(target: URL): string {
    const now = Math.floor(Date.now() / 1000)
    const cookies: Cookie[] = []

    for (const [domain, storedCookies] of this.cookiesByDomain.entries()) {
      if (!domainMatches(target.hostname, domain)) continue

      for (const cookie of storedCookies) {
        if (cookie.expirationDate && cookie.expirationDate <= now) continue
        if (cookie.secure && target.protocol !== 'https:') continue
        if (!cookiePathMatches(target.pathname, cookie.path)) continue
        cookies.push(cookie)
      }
    }

    return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
  }

  private async captureResponseCookies(response: Response, fallbackDomain: string): Promise<void> {
    const headersWithCookies = response.headers as Headers & { getSetCookie?: () => string[] }
    const setCookieHeaders = headersWithCookies.getSetCookie?.() || []
    const fallback = response.headers.get('set-cookie')
    if (fallback && setCookieHeaders.length === 0) setCookieHeaders.push(fallback)

    for (const header of setCookieHeaders) {
      const cookie = parseSetCookieHeader(header, fallbackDomain)
      if (!cookie) continue
      if (cookie.expirationDate && cookie.expirationDate <= Math.floor(Date.now() / 1000)) {
        await this.cookies.remove(cookie.name, cookie.domain)
      } else {
        this.setCookie(cookie)
      }
    }
  }

  private resolveStorageDir(): string {
    return this.config.storageDir
      || process.env.CREATOR_STORAGE_DIR
      || path.join(os.homedir(), '.creator-node')
  }

  private resolveDownloadDir(): string {
    return this.config.downloadDir
      || process.env.CREATOR_DOWNLOAD_DIR
      || path.join(this.resolveStorageDir(), 'downloads')
  }

  private resolveStorageFile(): string {
    return path.join(this.resolveStorageDir(), 'storage.json')
  }

  private async loadStorage(): Promise<void> {
    if (this.storageCache) return
    const file = this.resolveStorageFile()
    try {
      this.storageCache = JSON.parse(await readFile(file, 'utf-8')) as Record<string, unknown>
    } catch {
      this.storageCache = {}
    }
  }

  private async saveStorage(): Promise<void> {
    const file = this.resolveStorageFile()
    await mkdir(path.dirname(file), { recursive: true })
    if (!this.storageCache || Object.keys(this.storageCache).length === 0) {
      if (existsSync(file)) await rm(file)
      return
    }
    await writeFile(file, JSON.stringify(this.storageCache, null, 2), 'utf-8')
  }
}

export function createNodeRuntime(config?: RuntimeConfig): NodeRuntime {
  return new NodeRuntime(config)
}
