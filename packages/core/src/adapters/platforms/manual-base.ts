import { BaseAdapter } from '../base'
import type { Article, AuthResult, SyncResult } from '../../types'
import type { PublishOptions } from '../types'

/** Official entry points only; no verified automation or identity contract. */
export abstract class ManualArticleAdapter extends BaseAdapter {
  readonly integrationMode = 'manual-only' as const
  protected abstract readonly manualURLs: { login: string; editor: string }

  async checkAuth(): Promise<AuthResult> {
    // An accessible page or stored cookie is not proof of current identity.
    // Do not inspect credentials or open a browser for this manual integration.
    return {
      isAuthenticated: false,
      error: `无法验证${this.meta.name}登录：当前为手工操作入口（manual-only），尚未接入可信的身份校验；请在官网 ${this.manualURLs.login} 确认登录。`,
    }
  }

  async publish(_article: Article, _options?: PublishOptions): Promise<SyncResult> {
    // Reject all modes before runtime access, including auth and image transfer.
    return this.createResult(false, {
      error: `${this.meta.name}当前仅支持手工操作（manual-only），不支持自动保存草稿或自动发布。`,
      message: `请前往官网写作后台 ${this.manualURLs.editor}，登录后手工创建文章并确认发布；本次未上传、未创建草稿、未发布。`,
    })
  }

  async uploadImage(_file: Blob, _filename?: string): Promise<string> {
    throw new Error(`${this.meta.name}当前仅支持手工操作（manual-only），不支持自动上传图片。`)
  }
}
