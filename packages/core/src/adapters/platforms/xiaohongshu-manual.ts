import { ManualArticleAdapter } from './manual-base'
import type { PlatformMeta } from '../../types'

/** GPL-3.0 public fallback; no private adapter code or credentials are included. */
export class XiaohongshuManualAdapter extends ManualArticleAdapter {
  readonly meta: PlatformMeta = {
    id: 'xiaohongshu', name: '小红书',
    homepage: 'https://www.xiaohongshu.com',
    icon: 'https://www.xiaohongshu.com/favicon.ico',
    capabilities: [],
  }
  protected readonly manualURLs = {
    login: 'https://creator.xiaohongshu.com',
    editor: 'https://creator.xiaohongshu.com/publish/publish?source=official',
  }
}
