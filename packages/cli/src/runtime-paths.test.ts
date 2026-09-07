import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { resolveBrowserSessionFile } from './direct'
import { resolveUserDataDir } from './login'

afterEach(() => { vi.unstubAllEnvs() })

it('login and publishing share the configured login root even with a separate storage directory', () => {
  const root = path.resolve('synthetic-session-root')
  vi.stubEnv('CREATOR_LOGIN_DIR', root)
  const options = { storageDir: path.resolve('synthetic-storage-root') }
  const login = resolveUserDataDir('zhihu', {}, options)
  expect(login).toBe(path.join(root, 'zhihu'))
  expect(resolveBrowserSessionFile('zhihu', options)).toBe(path.join(login, 'session.json'))
})

it('defaults to .creator-login and retains an explicit login profile directory override', () => {
  vi.stubEnv('CREATOR_LOGIN_DIR', '')
  const options = { storageDir: path.resolve('synthetic-storage-root') }
  expect(resolveBrowserSessionFile('douyin', options)).toBe(path.resolve('.creator-login/douyin/session.json'))
  expect(resolveUserDataDir('douyin', {}, options)).toBe(path.resolve('.creator-login/douyin'))
  expect(resolveUserDataDir('douyin', { userDataDir: 'custom-profile' }, options)).toBe(path.resolve('custom-profile'))
})
