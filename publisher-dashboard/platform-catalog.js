'use strict';

const fs = require('node:fs');
const path = require('node:path');
const XIAOHONGSHU_SOURCE = path.resolve(__dirname, '../packages/core/src/adapters/platforms/xiaohongshu.ts');
const XIAOHONGSHU_MANUAL_URL = 'https://creator.xiaohongshu.com/publish/publish?source=official';

// Dashboard curation only: retain legacy adapters, historical records and credentials.
const GROUPS = Object.freeze([
  Object.freeze({ id: 'general', name: '通用内容平台' }),
  Object.freeze({ id: 'technical', name: '技术与知识平台' }),
  Object.freeze({ id: 'tool', name: '本地工具' }),
]);
const GENERAL = ['weixin','woshipm','sspai','xiaohongshu','uisdc','douyin','zhihu','toutiao',
  'baijiahao','sohu','qiehao','weibo','bilibili','jianshu','netease','douban'];
const TECHNICAL = ['juejin','csdn','yuque','cnblogs'];
const ACTIVE_PLATFORM_IDS = Object.freeze([...GENERAL,...TECHNICAL,'zip-download']);
const INDUSTRY_PLATFORM_IDS = Object.freeze(['china-vision','bjx-club','elecfans','eet-china','eeworld','ca800','b2b168','app17','huangye88','51sole']);
const MANUAL_PLATFORM_IDS = Object.freeze(['uisdc','jianshu','netease']);
const EDITOR_PLATFORM_IDS = Object.freeze(['xiaohongshu','toutiao','douban']);
const TEXT_DRAFT_PLATFORM_IDS = Object.freeze(['douyin','qiehao']);
const PREPARATION_LABELS = Object.freeze({
  manual: '手工填写',
  editor: '准备编辑器（需人工核对）',
  'draft-text': '保存文字草稿',
  draft: '保存平台草稿',
  export: '本地导出',
});
const MANUAL_URLS = Object.freeze({uisdc:'https://www.uisdc.com/contribution?type=post',jianshu:'https://www.jianshu.com/writer#/',netease:'https://mp.163.com/index.html'});
const ACTIVE = new Set(ACTIVE_PLATFORM_IDS);

function isActivePlatform(id) { return ACTIVE.has(String(id || '').trim().toLowerCase()); }
function hasPublicXiaohongshuFallback() {
  // Inspect only the marker; never load, execute or expose the optional private source.
  try { return fs.readFileSync(XIAOHONGSHU_SOURCE, 'utf8').includes('PUBLIC_MANUAL_FALLBACK'); }
  catch { return true; }
}
function preparationMode(id) {
  if (id === 'xiaohongshu' && hasPublicXiaohongshuFallback()) return 'manual';
  if (MANUAL_PLATFORM_IDS.includes(id)) return 'manual';
  if (EDITOR_PLATFORM_IDS.includes(id)) return 'editor';
  if (TEXT_DRAFT_PLATFORM_IDS.includes(id)) return 'draft-text';
  return id === 'zip-download' ? 'export' : 'draft';
}
function catalogPlatforms(records) {
  return records.filter(p=>isActivePlatform(p.id)).map(p=>{
    const mode = preparationMode(p.id);
    const publicXiaohongshu = p.id === 'xiaohongshu' && mode === 'manual';
    return { ...p,
    catalog_group: TECHNICAL.includes(p.id) ? 'technical' : p.id==='zip-download' ? 'tool' : 'general',
    catalog_order: ACTIVE_PLATFORM_IDS.indexOf(p.id),
    delivery_mode: mode === 'manual' ? 'manual' : ['weixin','woshipm','sspai'].includes(p.id) ? 'draft' : 'adapter',
    preparation_mode: mode,
    preparation_label: publicXiaohongshu ? '公开版：手工操作' : PREPARATION_LABELS[mode],
    supports_direct: false,
    auto_check_auth: !publicXiaohongshu && !['jianshu','netease','zip-download'].includes(p.id),
    ...(MANUAL_URLS[p.id] ? {manual_url:MANUAL_URLS[p.id]} : {}),
    ...(publicXiaohongshu ? {manual_url:XIAOHONGSHU_MANUAL_URL} : {}),
  };}).sort((a,b)=>a.catalog_order-b.catalog_order);
}
module.exports={GROUPS,ACTIVE_PLATFORM_IDS,INDUSTRY_PLATFORM_IDS,MANUAL_PLATFORM_IDS,isActivePlatform,preparationMode,catalogPlatforms};
