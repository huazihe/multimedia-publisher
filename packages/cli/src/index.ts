import { Command } from 'commander'
import {
  runDirectAuth,
  runDirectPlatforms,
  runDirectPreview,
  runDirectSync,
  type DirectRuntimeOptions,
} from './direct'
import { runDirectLogin } from './login'

export const program = new Command()

function parseRuntimeOptions(): DirectRuntimeOptions {
  const options = program.opts()
  const runtime = String(options.runtime || 'node').toLowerCase()

  if (runtime !== 'node') {
    throw new Error('WEIBOT 已移除旧 Chrome 插件兼容层，只支持独立 Node/CDP 运行时。')
  }

  return {
    cookieFile: options.cookieFile,
    storageDir: options.storageDir,
    downloadDir: options.downloadDir,
    timeout: options.timeout,
    userAgent: options.userAgent,
    douyinCdpPort: options.douyinCdpPort,
    toutiaoCdpPort: options.toutiaoCdpPort,
    xiaohongshuCdpPort: options.xiaohongshuCdpPort,
    qiehaoCdpPort: options.qiehaoCdpPort,
  }
}

function handleError(error: unknown): void {
  console.error((error as Error).message || error)
  process.exitCode = 1
}

program
  .name('weibot')
  .description('WEIBOT 多平台内容发布 CLI（独立 Node/CDP 运行时）')
  .version('1.1.0')
  .showHelpAfterError()
  .option('--runtime <runtime>', '运行时，仅支持 node', process.env.WEIBOT_RUNTIME || 'node')
  .option('--cookie-file <file>', 'Cookie JSON 文件', process.env.WEIBOT_COOKIE_FILE || 'cookies.json')
  .option('--storage-dir <dir>', '持久化存储目录', process.env.WEIBOT_STORAGE_DIR)
  .option('--download-dir <dir>', '下载/导出目录', process.env.WEIBOT_DOWNLOAD_DIR)
  .option('--user-agent <ua>', '请求 User-Agent')
  .option('--timeout <ms>', '网络请求和浏览器等待超时（毫秒）', '30000')
  .option('--douyin-cdp-port <port>', '抖音登录浏览器 DevTools 端口', process.env.WEIBOT_DOUYIN_CDP_PORT)
  .option('--toutiao-cdp-port <port>', '头条登录浏览器 DevTools 端口', process.env.WEIBOT_TOUTIAO_CDP_PORT)
  .option('--xiaohongshu-cdp-port <port>', '小红书登录浏览器 DevTools 端口', process.env.WEIBOT_XIAOHONGSHU_CDP_PORT)
  .option('--qiehao-cdp-port <port>', '企鹅号登录浏览器 DevTools 端口', process.env.WEIBOT_QIEHAO_CDP_PORT)

program
  .command('login <platform>')
  .description('打开平台登录浏览器并导出 Cookie')
  .option('-o, --output <file>', 'Cookie JSON 输出文件，默认使用 --cookie-file 或 ./cookies.json')
  .option('--browser <path>', 'Chrome/Edge 可执行文件路径，也可使用 CHROME_PATH')
  .option('--port <port>', 'Chrome DevTools 调试端口，默认自动分配')
  .option('--user-data-dir <dir>', '登录浏览器用户数据目录，默认 ./.weibot-login/<platform>')
  .option('--keep-open', '导出 Cookie 后保留登录浏览器窗口')
  .action(async (platform: string, options) => {
    await runDirectLogin(platform, options, parseRuntimeOptions()).catch(handleError)
  })

program
  .command('sync <file>')
  .description('同步 Markdown/HTML 到指定平台，默认保存草稿')
  .requiredOption('-p, --platforms <platforms>', '目标平台，逗号分隔')
  .option('-t, --title <title>', '文章标题，默认从文件提取')
  .option('--cover <url>', '封面图 URL 或本地路径')
  .option('--direct', '直接发布（仅支持已实现直接发布的平台）')
  .option('--dry-run', '仅显示将要执行的操作，不实际同步')
  .action(async (file: string, options) => {
    await runDirectSync(file, options, parseRuntimeOptions()).catch(handleError)
  })

program
  .command('preview <file>')
  .description('预览 Markdown/HTML 的平台适配结果')
  .requiredOption('-p, --platform <platform>', '目标平台')
  .option('-t, --title <title>', '文章标题，默认从文件提取')
  .option('--cover <url>', '封面图 URL 或本地路径')
  .action(async (file: string, options) => {
    await runDirectPreview(file, options).catch(handleError)
  })

program
  .command('platforms')
  .alias('ls')
  .description('列出所有支持的平台')
  .option('-a, --auth', '同时显示登录状态')
  .action(async (options) => {
    await runDirectPlatforms(options, parseRuntimeOptions()).catch(handleError)
  })

program
  .command('auth [platform]')
  .description('检查平台登录状态')
  .action(async (platform: string | undefined) => {
    await runDirectAuth(platform, parseRuntimeOptions()).catch(handleError)
  })

if (process.argv.length <= 2) {
  program.outputHelp()
} else {
  program.parse()
}
