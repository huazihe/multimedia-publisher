import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(root, 'packages/core/src/adapters/platforms/xiaohongshu.ts')
// Keep every existing local implementation or symlink intact. A clean public
// clone uses a generated, ignored bridge to the explicitly manual fallback.
try {
  fs.lstatSync(file)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  fs.writeFileSync(file,
    '// PUBLIC_MANUAL_FALLBACK: generated; private implementation is not distributed.\n' +
    "export { XiaohongshuManualAdapter as XiaohongshuAdapter } from './xiaohongshu-manual'\n",
    { flag: 'wx' })
  console.log('小红书：公开版本使用手工入口，未安装私有自动化适配器。')
}
