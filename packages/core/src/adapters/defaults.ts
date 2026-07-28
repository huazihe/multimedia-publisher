import type { RuntimeInterface } from '../runtime/interface'
import type { AdapterRegistryEntry, PlatformAdapter } from './types'
import { adapterRegistry } from './registry'
import {
  App17Adapter,
  B2b168Adapter,
  BaijiahaoAdapter,
  BilibiliAdapter,
  BjxClubAdapter,
  Ca800Adapter,
  ChinaVisionAdapter,
  CnblogsAdapter,
  CSDNAdapter,
  Cto51Adapter,
  DoubanAdapter,
  DouyinAdapter,
  EastmoneyAdapter,
  EetChinaAdapter,
  EeworldAdapter,
  ElecfansAdapter,
  Huangye88Adapter,
  ImoocAdapter,
  JuejinAdapter,
  OschinaAdapter,
  QiehaoAdapter,
  SegmentfaultAdapter,
  SohuAdapter,
  Sole51Adapter,
  ToutiaoAdapter,
  WeiboAdapter,
  WeixinAdapter,
  WoshipmAdapter,
  XiaohongshuAdapter,
  XueqiuAdapter,
  YuqueAdapter,
  ZhihuAdapter,
  ZipDownloadAdapter,
} from './platforms'

type AdapterConstructor = new () => PlatformAdapter

export const DEFAULT_ADAPTER_CLASSES: AdapterConstructor[] = [
  ZhihuAdapter,
  JuejinAdapter,
  DouyinAdapter,
  ToutiaoAdapter,
  XiaohongshuAdapter,
  QiehaoAdapter,
  ChinaVisionAdapter,
  BjxClubAdapter,
  ElecfansAdapter,
  EetChinaAdapter,
  EeworldAdapter,
  Ca800Adapter,
  B2b168Adapter,
  App17Adapter,
  Huangye88Adapter,
  Sole51Adapter,
  WeiboAdapter,
  BilibiliAdapter,
  BaijiahaoAdapter,
  CSDNAdapter,
  YuqueAdapter,
  DoubanAdapter,
  SohuAdapter,
  XueqiuAdapter,
  WeixinAdapter,
  WoshipmAdapter,
  Cto51Adapter,
  ImoocAdapter,
  OschinaAdapter,
  SegmentfaultAdapter,
  CnblogsAdapter,
  ZipDownloadAdapter,
  EastmoneyAdapter,
]

export function createDefaultAdapterEntries(): AdapterRegistryEntry[] {
  return DEFAULT_ADAPTER_CLASSES.map(AdapterClass => {
    const instance = new AdapterClass()
    return {
      meta: instance.meta,
      factory: () => new AdapterClass(),
      preprocessConfig: instance.preprocessConfig,
    }
  })
}

export function registerDefaultAdapters(runtime: RuntimeInterface): void {
  adapterRegistry.setRuntime(runtime)
  adapterRegistry.registerAll(createDefaultAdapterEntries())
}
