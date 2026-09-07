import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import chalk from 'chalk'
import WebSocket from 'ws'
import type { Cookie } from '@creator-workbench/core'
import type { DirectRuntimeOptions } from './direct'
import { resolveBrowserPath as resolveSharedBrowserPath, resolveLoginRoot } from '../../../runtime/browser.cjs'

interface PlatformLoginConfig {
  name: string
  loginUrl: string
  domains: string[]
}

interface LoginOptions {
  output?: string
  browser?: string
  port?: string
  userDataDir?: string
  keepOpen?: boolean
}

type CookieFileInput =
  | Cookie[]
  | Record<string, Cookie[] | Record<string, string> | string>

interface CdpTarget {
  type?: string
  url?: string
  webSocketDebuggerUrl?: string
}

interface CdpCookie {
  name: string
  value: string
  domain: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  expires?: number
}

let cdpRequestId = 0
const DOUYIN_DEFAULT_CDP_PORT = 9333

const PLATFORM_LOGINS: Record<string, PlatformLoginConfig> = {
  jianshu: {name:'简书',loginUrl:'https://www.jianshu.com/sign_in',domains:['.jianshu.com']},
  netease: {name:'网易号',loginUrl:'https://mp.163.com/login.html',domains:['.mp.163.com']},
  uisdc: { name: '优设', loginUrl: 'https://www.uisdc.com/#login', domains: ['.uisdc.com'] },
  sspai: { name: '少数派', loginUrl: 'https://sspai.com/login', domains: ['.sspai.com'] },
  zhihu: {
    name: '知乎',
    loginUrl: 'https://www.zhihu.com/signin',
    domains: ['.zhihu.com'],
  },
  juejin: {
    name: '掘金',
    loginUrl: 'https://juejin.cn',
    domains: ['.juejin.cn'],
  },
  weibo: {
    name: '微博',
    loginUrl: 'https://weibo.com',
    domains: ['.weibo.com', '.sina.com.cn'],
  },
  bilibili: {
    name: '哔哩哔哩',
    loginUrl: 'https://www.bilibili.com',
    domains: ['.bilibili.com'],
  },
  baijiahao: {
    name: '百家号',
    loginUrl: 'https://baijiahao.baidu.com',
    domains: ['.baidu.com'],
  },
  csdn: {
    name: 'CSDN',
    loginUrl: 'https://www.csdn.net',
    domains: ['.csdn.net'],
  },
  yuque: {
    name: '语雀',
    loginUrl: 'https://www.yuque.com',
    domains: ['.yuque.com'],
  },
  douban: {
    name: '豆瓣',
    loginUrl: 'https://www.douban.com/topic/create?subtype=note',
    domains: ['.douban.com'],
  },
  douyin: {
    name: '抖音创作者中心',
    loginUrl: 'https://creator.douyin.com/creator-micro/home',
    domains: ['.douyin.com', '.douyinpic.com', '.bytedance.com', '.zijieapi.com'],
  },
  toutiao: {
    name: '今日头条',
    loginUrl: 'https://mp.toutiao.com/profile_v4/manage/content/all',
    domains: ['.toutiao.com', '.toutiaocdn.com', '.bytedance.com', '.snssdk.com'],
  },
  xiaohongshu: {
    name: '小红书',
    loginUrl: 'https://creator.xiaohongshu.com',
    domains: ['.xiaohongshu.com', '.xhscdn.com'],
  },
  qiehao: {
    name: '企鹅号',
    loginUrl: 'https://om.qq.com/',
    domains: ['.qq.com', '.om.qq.com'],
  },
  'china-vision': {
    name: '中国机器视觉网',
    loginUrl: 'https://www.china-vision.org/user-add-news.html',
    domains: ['.china-vision.org'],
  },
  'bjx-club': {
    name: '北极星社区',
    loginUrl: 'https://club.bjx.com.cn/',
    domains: ['.bjx.com.cn'],
  },
  elecfans: {
    name: '电子发烧友',
    loginUrl: 'https://bbs.elecfans.com/member.php?mod=logging&action=login',
    domains: ['.elecfans.com'],
  },
  'eet-china': {
    name: '电子工程专辑',
    loginUrl: 'https://www.eet-china.com/',
    domains: ['.eet-china.com'],
  },
  eeworld: {
    name: '电子工程世界',
    loginUrl: 'http://bbs.eeworld.com.cn/member.php?mod=logging&action=login',
    domains: ['.eeworld.com.cn'],
  },
  ca800: {
    name: '中国自动化网',
    loginUrl: 'http://www.ca800.com/c/Info/articleInfo.aspx',
    domains: ['.ca800.com'],
  },
  b2b168: {
    name: '八方资源网',
    loginUrl: 'https://m.b2b168.com/',
    domains: ['.b2b168.com'],
  },
  app17: {
    name: '阿仪网',
    loginUrl: 'https://user.app17.com/user.aspx?index/index',
    domains: ['.app17.com'],
  },
  huangye88: {
    name: '黄页88网',
    loginUrl: 'https://my.huangye88.com/',
    domains: ['.huangye88.com'],
  },
  '51sole': {
    name: '搜了网',
    loginUrl: 'https://user.51sole.com/user/WebSiteInfo.aspx',
    domains: ['.51sole.com'],
  },
  sohu: {
    name: '搜狐号',
    loginUrl: 'https://mp.sohu.com',
    domains: ['.sohu.com'],
  },
  xueqiu: {
    name: '雪球',
    loginUrl: 'https://xueqiu.com',
    domains: ['.xueqiu.com'],
  },
  weixin: {
    name: '微信公众号',
    loginUrl: 'https://mp.weixin.qq.com',
    domains: ['.qq.com', '.weixin.qq.com', '.mp.weixin.qq.com'],
  },
  woshipm: {
    name: '人人都是产品经理',
    loginUrl: 'https://www.woshipm.com',
    domains: ['.woshipm.com'],
  },
  '51cto': {
    name: '51CTO',
    loginUrl: 'https://blog.51cto.com',
    domains: ['.51cto.com'],
  },
  imooc: {
    name: '慕课手记',
    loginUrl: 'https://www.imooc.com',
    domains: ['.imooc.com'],
  },
  oschina: {
    name: '开源中国',
    loginUrl: 'https://www.oschina.net',
    domains: ['.oschina.net'],
  },
  segmentfault: {
    name: '思否',
    loginUrl: 'https://segmentfault.com',
    domains: ['.segmentfault.com'],
  },
  cnblogs: {
    name: '博客园',
    loginUrl: 'https://i.cnblogs.com',
    domains: ['.cnblogs.com'],
  },
  eastmoney: {
    name: '东方财富',
    loginUrl: 'https://mp.eastmoney.com/collect/pc_article/index.html#/',
    domains: ['.eastmoney.com'],
  },
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizeDomain(domain: string): string {
  return domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
}

function bareDomain(domain: string): string {
  return normalizeDomain(domain).replace(/^\./, '')
}

function domainMatches(cookieDomain: string, targetDomain: string): boolean {
  const cookie = bareDomain(cookieDomain)
  const target = bareDomain(targetDomain)
  return cookie === target || cookie.endsWith(`.${target}`)
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

function normalizeCookie(cookie: Cookie): Cookie {
  return {
    ...cookie,
    domain: normalizeDomain(cookie.domain),
    path: cookie.path || '/',
  }
}

function importCookies(input: CookieFileInput): Cookie[] {
  if (Array.isArray(input)) return input.map(normalizeCookie)

  const cookies: Cookie[] = []
  for (const [domain, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      cookies.push(...value.map(cookie => normalizeCookie({ ...cookie, domain: cookie.domain || domain })))
    } else if (typeof value === 'string') {
      cookies.push(...parseCookieHeader(value, domain).map(normalizeCookie))
    } else {
      for (const [name, cookieValue] of Object.entries(value)) {
        cookies.push(normalizeCookie({ name, value: cookieValue, domain, path: '/' }))
      }
    }
  }
  return cookies
}

function mergeCookies(existing: Cookie[], additions: Cookie[]): Cookie[] {
  const merged = new Map<string, Cookie>()
  for (const cookie of [...existing, ...additions]) {
    const normalized = normalizeCookie(cookie)
    const key = `${normalized.domain}\t${normalized.path || '/'}\t${normalized.name}`
    merged.set(key, normalized)
  }
  return Array.from(merged.values()).sort((a, b) => {
    const domainCompare = a.domain.localeCompare(b.domain)
    if (domainCompare !== 0) return domainCompare
    return a.name.localeCompare(b.name)
  })
}

function groupCookies(cookies: Cookie[]): Record<string, Cookie[]> {
  const grouped: Record<string, Cookie[]> = {}
  for (const cookie of cookies) {
    const normalized = normalizeCookie(cookie)
    grouped[normalized.domain] ||= []
    grouped[normalized.domain].push(normalized)
  }
  return grouped
}

async function readExistingCookies(filePath: string): Promise<Cookie[]> {
  if (!fs.existsSync(filePath)) return []
  const raw = await readFile(filePath, 'utf-8')
  if (!raw.trim()) return []
  return importCookies(JSON.parse(raw) as CookieFileInput)
}

function resolveOutputFile(options: LoginOptions, runtimeOptions: DirectRuntimeOptions): string {
  return path.resolve(options.output || runtimeOptions.cookieFile || process.env.CREATOR_COOKIE_FILE || 'cookies.json')
}

export function resolveUserDataDir(platform: string, options: LoginOptions, _runtimeOptions: DirectRuntimeOptions): string {
  if (options.userDataDir) return path.resolve(options.userDataDir)
  return path.join(resolveLoginRoot(), platform)
}

async function writeBrowserSession(
  userDataDir: string,
  session: { browserPath: string; port: number; userDataDir: string }
): Promise<void> {
  await mkdir(userDataDir, { recursive: true })
  await writeFile(path.join(userDataDir, 'session.json'), `${JSON.stringify(session, null, 2)}\n`, 'utf-8')
}

function resolveBrowserPath(explicitPath?: string): string {
  return resolveSharedBrowserPath({ executablePath: explicitPath })
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('Could not allocate a local port.'))
      })
    })
  })
}

async function waitForJson<T>(url: string, timeoutMs = 30000): Promise<T> {
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

async function connectCdp(webSocketDebuggerUrl: string): Promise<WebSocket> {
  const socket = new WebSocket(webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out connecting to Chrome DevTools WebSocket.')), 10000)
    socket.once('open', () => {
      clearTimeout(timeout)
      resolve()
    })
    socket.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
  })
  return socket
}

async function cdpRequest<T>(
  socket: WebSocket,
  method: string,
  params?: Record<string, unknown>
): Promise<T> {
  const id = ++cdpRequestId

  return new Promise<T>((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString()) as {
        id?: number
        result?: T
        error?: { message?: string }
      }

      if (message.id !== id) return
      socket.off('message', onMessage)

      if (message.error) {
        reject(new Error(message.error.message || `${method} failed`))
      } else {
        resolve(message.result as T)
      }
    }

    socket.on('message', onMessage)
    socket.send(JSON.stringify({ id, method, params }), error => {
      if (error) {
        socket.off('message', onMessage)
        reject(error)
      }
    })
  })
}

async function getPageDebuggerUrl(port: number, loginUrl: string): Promise<string> {
  const targets = await waitForJson<CdpTarget[]>(`http://127.0.0.1:${port}/json/list`)
  const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl)
    || targets.find(target => target.webSocketDebuggerUrl)

  if (!page?.webSocketDebuggerUrl) {
    const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(loginUrl)}`, {
      method: 'PUT',
    })
    if (!created.ok) throw new Error(`Could not create Chrome page: HTTP ${created.status}`)
    const target = await created.json() as CdpTarget
    if (!target.webSocketDebuggerUrl) throw new Error('Chrome page did not expose a DevTools WebSocket URL.')
    return target.webSocketDebuggerUrl
  }

  return page.webSocketDebuggerUrl
}

async function collectCookies(port: number, loginUrl: string): Promise<Cookie[]> {
  const debuggerUrl = await getPageDebuggerUrl(port, loginUrl)
  const socket = await connectCdp(debuggerUrl)

  try {
    await cdpRequest(socket, 'Network.enable').catch(() => undefined)

    let result: { cookies?: CdpCookie[] }
    try {
      result = await cdpRequest<{ cookies?: CdpCookie[] }>(socket, 'Network.getAllCookies')
    } catch {
      result = await cdpRequest<{ cookies?: CdpCookie[] }>(socket, 'Storage.getCookies')
    }

    return (result.cookies || []).map(cookie => normalizeCookie({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expirationDate: cookie.expires && cookie.expires > 0 ? Math.floor(cookie.expires) : undefined,
    }))
  } finally {
    socket.close()
  }
}

async function closeBrowser(port: number, loginUrl: string): Promise<void> {
  const debuggerUrl = await getPageDebuggerUrl(port, loginUrl)
  const socket = await connectCdp(debuggerUrl)
  try {
    await cdpRequest(socket, 'Browser.close')
  } finally {
    socket.close()
  }
}

function waitForEnter(message: string): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise(resolve => {
    rl.question(message, () => {
      rl.close()
      resolve()
    })
  })
}

export function listLoginPlatforms(): string[] {
  return Object.keys(PLATFORM_LOGINS)
}

export async function runDirectLogin(
  platform: string,
  options: LoginOptions,
  runtimeOptions: DirectRuntimeOptions
): Promise<void> {
  const platformId = platform.trim().toLowerCase()
  const config = PLATFORM_LOGINS[platformId]
  if (!config) {
    console.error(chalk.red(`暂不支持自动登录导出: ${platform}`))
    console.log(chalk.gray(`可用平台: ${listLoginPlatforms().join(', ')}`))
    process.exitCode = 1
    return
  }

  const browserPath = resolveBrowserPath(options.browser)
  const port = options.port
    ? Number(options.port)
    : platformId === 'douyin'
      ? DOUYIN_DEFAULT_CDP_PORT
      : await findFreePort()
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid port: ${options.port}`)

  const outputFile = resolveOutputFile(options, runtimeOptions)
  const userDataDir = resolveUserDataDir(platformId, options, runtimeOptions)

  await mkdir(userDataDir, { recursive: true })
  await mkdir(path.dirname(outputFile), { recursive: true })

  console.log()
  console.log(chalk.bold(`打开 ${config.name} 登录页...`))
  console.log(`  Browser: ${chalk.cyan(browserPath)}`)
  console.log(`  Profile: ${chalk.cyan(userDataDir.replace(os.homedir(), '~'))}`)
  console.log(`  Cookie: ${chalk.cyan(outputFile)}`)
  console.log()

  const child = spawn(browserPath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    config.loginUrl,
  ], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`)
  } catch (error) {
    throw new Error(`无法连接到登录浏览器调试端口。如果之前的 ${config.name} 登录窗口还开着，请先关闭后重试。${(error as Error).message}`)
  }

  console.log(chalk.yellow('请在打开的浏览器窗口完成登录。登录成功后，回到这个终端按 Enter 导出 Cookie。'))
  await waitForEnter('按 Enter 继续...')

  const allCookies = await collectCookies(port, config.loginUrl)
  const exportedCookies = allCookies.filter(cookie =>
    config.domains.some(domain => domainMatches(cookie.domain, domain))
  )

  if (exportedCookies.length === 0) {
    console.log(chalk.red(`没有读取到 ${config.name} 的 Cookie。请确认登录是在刚打开的浏览器窗口里完成的。`))
    process.exitCode = 1
    return
  }

  const existingCookies = await readExistingCookies(outputFile)
  const merged = mergeCookies(existingCookies, exportedCookies)
  await writeFile(outputFile, `${JSON.stringify(groupCookies(merged), null, 2)}\n`, 'utf-8')

  const keepOpen = options.keepOpen
  await writeBrowserSession(userDataDir, { browserPath, port, userDataDir })

  if (!keepOpen) {
    await closeBrowser(port, config.loginUrl).catch(() => undefined)
  }

  const domains = Array.from(new Set(exportedCookies.map(cookie => cookie.domain))).sort()
  console.log()
  console.log(chalk.green(`已导出 ${exportedCookies.length} 个 Cookie 到 ${outputFile}`))
  console.log(chalk.gray(`域名: ${domains.join(', ')}`))
  console.log()
  console.log(chalk.gray(`下一步可运行: creator --cookie-file ${outputFile} auth ${platformId}`))
}
