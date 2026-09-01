'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { createRequire } = require('node:module');
const { execFile, spawn } = require('child_process');
const net = require('net');
const { DatabaseSync } = require('node:sqlite');
const { marked, Parser, Renderer } = require('marked');
const TurndownService = require('turndown');
const { gfm: turndownGfm } = require('turndown-plugin-gfm');
const {
  canonicalContentHash,
  listLayoutTemplates,
  renderLayoutTemplate,
} = require('./layout-templates');

const ROOT = __dirname;
const REPO_ROOT = path.resolve(ROOT, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DRAFTS_DIR = path.join(DATA_DIR, 'drafts');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = process.env.PUBLISHER_DB || path.join(DATA_DIR, 'publisher.sqlite');
const OPERATIONS_FILE = process.env.PUBLISHER_OPERATIONS_FILE || path.join(DATA_DIR, 'publish-operations.json');
const CLI_PATH = path.join(REPO_ROOT, 'packages', 'cli', 'dist', 'index.js');
const COOKIE_FILE = process.env.WEIBOT_COOKIE_FILE || path.join(REPO_ROOT, 'cookies.json');
const LOGIN_DIR = path.join(REPO_ROOT, '.weibot-login');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 18810);
const requireFromCore = createRequire(path.join(REPO_ROOT, 'packages', 'core', 'package.json'));
const { parseHTML } = (() => {
  try {
    return require('linkedom');
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
    return requireFromCore('linkedom');
  }
})();
const loginSessions = new Map();
const DEFAULT_SELECTED_PLATFORMS = [];
const DASHBOARD_DISTRIBUTION_PLATFORMS = [
  'weixin',
  'douyin',
  'xiaohongshu',
  'toutiao',
  'qiehao',
  'zhihu',
  'weibo',
  'bilibili',
  'baijiahao',
  'csdn',
  'juejin',
  'yuque',
  'douban',
  'sohu',
  'xueqiu',
];
const DASHBOARD_PLATFORM_LABELS = {
  weixin: '微信公众号',
  douyin: '抖音',
  xiaohongshu: '小红书',
  toutiao: '今日头条',
  qiehao: '企鹅号',
  zhihu: '知乎',
  weibo: '微博',
  bilibili: 'B站',
  baijiahao: '百家号',
  csdn: 'CSDN',
  juejin: '掘金',
  yuque: '语雀',
  douban: '豆瓣',
  sohu: '搜狐号',
  xueqiu: '雪球',
};

const FALLBACK_PLATFORMS = [
  ['zhihu', '知乎'],
  ['juejin', '掘金'],
  ['douyin', '抖音文章'],
  ['toutiao', '今日头条'],
  ['xiaohongshu', '小红书'],
  ['qiehao', '企鹅号'],
  ['china-vision', '中国机器视觉网'],
  ['bjx-club', '北极星社区'],
  ['elecfans', '电子发烧友'],
  ['eet-china', '电子工程专辑'],
  ['eeworld', '电子工程世界'],
  ['ca800', '中国自动化网'],
  ['b2b168', '八方资源网'],
  ['app17', '阿仪网'],
  ['huangye88', '黄页88网'],
  ['51sole', '搜了网'],
  ['weibo', '微博'],
  ['bilibili', '哔哩哔哩'],
  ['baijiahao', '百家号'],
  ['csdn', 'CSDN'],
  ['yuque', '语雀'],
  ['douban', '豆瓣'],
  ['sohu', '搜狐号'],
  ['xueqiu', '雪球'],
  ['weixin', '微信公众号'],
  ['woshipm', '人人都是产品经理'],
  ['51cto', '51CTO'],
  ['imooc', '慕课手记'],
  ['oschina', '开源中国'],
  ['segmentfault', '思否'],
  ['cnblogs', '博客园'],
  ['zip-download', 'Markdown 压缩包'],
  ['eastmoney', '东方财富'],
];

const LOGIN_PLATFORMS = {
  zhihu: { name: '知乎', loginUrl: 'https://www.zhihu.com/signin', domains: ['.zhihu.com'] },
  juejin: { name: '掘金', loginUrl: 'https://juejin.cn', domains: ['.juejin.cn'] },
  weibo: { name: '微博', loginUrl: 'https://weibo.com', domains: ['.weibo.com', '.sina.com.cn'] },
  bilibili: { name: '哔哩哔哩', loginUrl: 'https://www.bilibili.com', domains: ['.bilibili.com'] },
  baijiahao: { name: '百家号', loginUrl: 'https://baijiahao.baidu.com', domains: ['.baidu.com'] },
  csdn: { name: 'CSDN', loginUrl: 'https://www.csdn.net', domains: ['.csdn.net'] },
  yuque: { name: '语雀', loginUrl: 'https://www.yuque.com', domains: ['.yuque.com'] },
  douban: { name: '豆瓣', loginUrl: 'https://www.douban.com/topic/create?subtype=note', domains: ['.douban.com'] },
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
  'china-vision': { name: '中国机器视觉网', loginUrl: 'https://www.china-vision.org/user-add-news.html', domains: ['.china-vision.org'] },
  'bjx-club': { name: '北极星社区', loginUrl: 'https://club.bjx.com.cn/', domains: ['.bjx.com.cn'] },
  elecfans: { name: '电子发烧友', loginUrl: 'https://bbs.elecfans.com/member.php?mod=logging&action=login', domains: ['.elecfans.com'] },
  'eet-china': { name: '电子工程专辑', loginUrl: 'https://www.eet-china.com/', domains: ['.eet-china.com'] },
  eeworld: { name: '电子工程世界', loginUrl: 'http://bbs.eeworld.com.cn/member.php?mod=logging&action=login', domains: ['.eeworld.com.cn'] },
  ca800: { name: '中国自动化网', loginUrl: 'http://www.ca800.com/c/Info/articleInfo.aspx', domains: ['.ca800.com'] },
  b2b168: { name: '八方资源网', loginUrl: 'https://m.b2b168.com/', domains: ['.b2b168.com'] },
  app17: { name: '阿仪网', loginUrl: 'https://user.app17.com/user.aspx?index/index', domains: ['.app17.com'] },
  huangye88: { name: '黄页88网', loginUrl: 'https://my.huangye88.com/', domains: ['.huangye88.com'] },
  '51sole': { name: '搜了网', loginUrl: 'https://user.51sole.com/user/WebSiteInfo.aspx', domains: ['.51sole.com'] },
  sohu: { name: '搜狐号', loginUrl: 'https://mp.sohu.com', domains: ['.sohu.com'] },
  xueqiu: { name: '雪球', loginUrl: 'https://xueqiu.com', domains: ['.xueqiu.com'] },
  weixin: { name: '微信公众号', loginUrl: 'https://mp.weixin.qq.com', domains: ['.qq.com', '.weixin.qq.com', '.mp.weixin.qq.com'] },
  woshipm: { name: '人人都是产品经理', loginUrl: 'https://www.woshipm.com', domains: ['.woshipm.com'] },
  '51cto': { name: '51CTO', loginUrl: 'https://blog.51cto.com', domains: ['.51cto.com'] },
  imooc: { name: '慕课手记', loginUrl: 'https://www.imooc.com', domains: ['.imooc.com'] },
  oschina: { name: '开源中国', loginUrl: 'https://www.oschina.net', domains: ['.oschina.net'] },
  segmentfault: { name: '思否', loginUrl: 'https://segmentfault.com', domains: ['.segmentfault.com'] },
  cnblogs: { name: '博客园', loginUrl: 'https://i.cnblogs.com', domains: ['.cnblogs.com'] },
  eastmoney: { name: '东方财富', loginUrl: 'https://mp.eastmoney.com/collect/pc_article/index.html#/', domains: ['.eastmoney.com'] },
};

const INTERACTIVE_AUTH_PLATFORMS = new Set([
  'douyin',
  'toutiao',
  'xiaohongshu',
  'qiehao',
  'douban',
  'china-vision',
  'bjx-club',
  'elecfans',
  'eet-china',
  'eeworld',
  'ca800',
  'b2b168',
  'app17',
  'huangye88',
  '51sole',
]);
const RETIRED_PLATFORM_IDS = ['cnaiplus', 'zhike', 'cechina', 'sensorexpert'];

const CONTENT_TYPES = ['行业分析', '案例复盘', '方法论', '清单指南', '热点解读'];
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const MAX_CONTENT_TITLE_CHARACTERS = 200;
const MAX_CONTENT_SUMMARY_CHARACTERS = 1000;
const MAX_CONTENT_TYPE_CHARACTERS = 100;
const MAX_CONTENT_BODY_BYTES = 5 * 1024 * 1024;
const DEFAULT_REQUEST_BODY_BYTES = 8 * 1024 * 1024;
const MAX_IMPORTED_BODY_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_REQUEST_BYTES = 32 * 1024 * 1024;
const PUBLISH_EXECUTION_META = Symbol('publisher-dashboard.publish-execution');
const canonicalTurndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  fence: '```',
  emDelimiter: '*',
  strongDelimiter: '**',
  linkStyle: 'inlined',
});
canonicalTurndown.use(turndownGfm);
const canonicalMarkdownRenderer = new Renderer();
const renderCanonicalMarkdownLink = canonicalMarkdownRenderer.link;
canonicalMarkdownRenderer.link = function renderSafeCanonicalMarkdownLink(token) {
  const scheme = String(token.href || '').match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() || '';
  if (['javascript', 'data', 'vbscript'].includes(scheme)) return '';
  return renderCanonicalMarkdownLink.call(this, token);
};

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(DRAFTS_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

function now() {
  return new Date().toISOString();
}

function timestampAfter(previousTimestamp) {
  const currentMs = Date.now();
  const previousMs = Date.parse(previousTimestamp);
  const nextMs = Number.isFinite(previousMs) && currentMs <= previousMs
    ? previousMs + 1
    : currentMs;
  return new Date(nextMs).toISOString();
}

function updateContentRowWithMonotonicTimestamp(contentId, assignments, values = [], options = {}) {
  const hasExpectedRevision = Object.prototype.hasOwnProperty.call(options, 'expectedUpdatedAt');
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = one('SELECT updated_at FROM contents WHERE id = ?', contentId);
    if (!current) return { changes: 0, updatedAt: null };
    if (hasExpectedRevision && current.updated_at !== options.expectedUpdatedAt) {
      return { changes: 0, updatedAt: null };
    }
    const updatedAt = timestampAfter(current.updated_at);
    const result = db.prepare(`
      UPDATE contents
      SET ${assignments}, updated_at = ?
      WHERE id = ? AND updated_at = ?
    `).run(...values, updatedAt, contentId, current.updated_at);
    if (result.changes === 1) return { changes: 1, updatedAt };
    if (hasExpectedRevision) return { changes: 0, updatedAt: null };
  }
  throw statusError('内容状态更新冲突，请重试', 409);
}

function statusError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function operationTimestamp(nowMs) {
  return new Date(nowMs()).toISOString();
}

function normalizeOperationSignature(signature) {
  if (!signature || typeof signature !== 'object' || Array.isArray(signature)) {
    throw new Error('发布操作签名无效');
  }
  const contentId = String(signature.contentId || '');
  const platforms = Array.isArray(signature.platforms)
    ? [...new Set(signature.platforms.map(platform => String(platform || '').trim().toLowerCase()).filter(Boolean))].sort()
    : [];
  const publishMode = signature.publishMode === 'draft' ? 'draft' : signature.publishMode === 'direct' ? 'direct' : '';
  const contentHash = String(signature.contentHash || '').toLowerCase();
  const sourceHash = String(signature.sourceHash || '').toLowerCase();
  const expectedUpdatedAt = typeof signature.expectedUpdatedAt === 'string'
    ? signature.expectedUpdatedAt
    : '';
  if (!contentId
    || !platforms.length
    || !publishMode
    || !/^[a-f0-9]{64}$/.test(contentHash)
    || (sourceHash && !/^[a-f0-9]{64}$/.test(sourceHash))) {
    throw new Error('发布操作签名无效');
  }
  return {
    contentId,
    platforms,
    publishMode,
    contentHash,
    ...(sourceHash ? { sourceHash } : {}),
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
  };
}

function operationSignatureKey(signature) {
  return JSON.stringify(normalizeOperationSignature(signature));
}

function operationSignaturesMatch(existingSignature, candidateSignature) {
  const existing = normalizeOperationSignature(existingSignature);
  const candidate = normalizeOperationSignature(candidateSignature);
  if (existing.contentId !== candidate.contentId
    || existing.publishMode !== candidate.publishMode
    || existing.contentHash !== candidate.contentHash
    || JSON.stringify(existing.platforms) !== JSON.stringify(candidate.platforms)) return false;
  if (existing.sourceHash && candidate.sourceHash && existing.sourceHash !== candidate.sourceHash) {
    return false;
  }
  if (!existing.expectedUpdatedAt) return true;
  return candidate.expectedUpdatedAt === existing.expectedUpdatedAt;
}

function normalizeJournalResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const jobId = typeof result.jobId === 'string' ? result.jobId : '';
  const jobStatus = typeof result.jobStatus === 'string' ? result.jobStatus : '';
  const platformResults = Array.isArray(result.platformResults)
    ? result.platformResults.map(item => ({
      platform: String(item?.platform || '').trim().toLowerCase(),
      status: String(item?.status || ''),
    })).filter(item => item.platform && item.status)
    : [];
  const sourceUpdatedAt = typeof result.sourceUpdatedAt === 'string' ? result.sourceUpdatedAt : '';
  const contentUpdatedAt = typeof result.contentUpdatedAt === 'string' ? result.contentUpdatedAt : '';
  const canonicalConflict = result.canonicalConflict === true;
  const needsReload = result.needsReload === true || canonicalConflict;
  return {
    ...(jobId ? { jobId } : {}),
    ...(jobStatus ? { jobStatus } : {}),
    ...(platformResults.length ? { platformResults } : {}),
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
    ...(contentUpdatedAt ? { contentUpdatedAt } : {}),
    ...(canonicalConflict ? { canonicalConflict: true } : {}),
    ...(needsReload ? { needsReload: true } : {}),
  };
}

function createOperationJournal(options = {}) {
  const filePath = path.resolve(options.filePath || OPERATIONS_FILE);
  const nowMs = typeof options.nowMs === 'function' ? options.nowMs : Date.now;
  const ttlMs = Number.isFinite(options.ttlMs) ? Math.max(1, options.ttlMs) : 30 * 24 * 60 * 60 * 1000;
  const limit = Number.isInteger(options.limit) ? Math.max(1, options.limit) : 1000;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  let records = [];
  const reload = () => {
    if (!fs.existsSync(filePath)) {
      records = [];
      return records;
    }
    let document;
    try {
      document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      throw new Error(`发布操作日志损坏: ${error.message}`);
    }
    if (document?.version !== 1 || !Array.isArray(document.records)) {
      throw new Error('发布操作日志格式无效');
    }
    records = document.records.filter(record => record && typeof record === 'object');
    return records;
  };

  const persist = () => {
    const temporaryPath = `${filePath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify({ version: 1, records }, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      fs.renameSync(temporaryPath, filePath);
    } finally {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    }
  };

  const prune = currentTime => {
    const cutoff = currentTime - ttlMs;
    const protectedRecords = records.filter(record => record.state === 'running' || record.state === 'uncertain');
    const expirableRecords = records.filter(record => record.state !== 'running' && record.state !== 'uncertain').filter(record => {
      const updatedAt = Date.parse(record.updatedAt || record.createdAt || '');
      return !Number.isFinite(updatedAt) || updatedAt >= cutoff;
    });
    expirableRecords.sort((left, right) => Date.parse(right.updatedAt || right.createdAt || 0) - Date.parse(left.updatedAt || left.createdAt || 0));
    const availableSlots = Math.max(0, limit - protectedRecords.length);
    records = [...protectedRecords, ...expirableRecords.slice(0, availableSlots)];
    records.sort((left, right) => Date.parse(left.updatedAt || left.createdAt || 0) - Date.parse(right.updatedAt || right.createdAt || 0));
  };

  const reloadAndPrune = () => {
    reload();
    const before = JSON.stringify(records);
    prune(nowMs());
    return before !== JSON.stringify(records);
  };

  const updateState = (operationId, state, result = null) => {
    reload();
    const record = records.find(item => item.operationId === operationId);
    if (!record || record.state !== 'running') return record || null;
    const timestamp = operationTimestamp(nowMs);
    record.state = state;
    record.result = normalizeJournalResult(result);
    record.updatedAt = timestamp;
    if (state === 'completed') record.completedAt = timestamp;
    if (state === 'failed') record.failedAt = timestamp;
    if (state === 'uncertain') record.uncertainAt = timestamp;
    persist();
    return record;
  };

  reload();

  return {
    filePath,
    get(operationId) {
      if (reloadAndPrune()) persist();
      return records.find(record => record.operationId === operationId) || null;
    },
    findBySourceRevision({ contentId, platforms, publishMode, expectedUpdatedAt }) {
      if (reloadAndPrune()) persist();
      const normalizedPlatforms = [...new Set((Array.isArray(platforms) ? platforms : [])
        .map(platform => String(platform || '').trim().toLowerCase())
        .filter(Boolean))].sort();
      return records.find(record => {
        const signature = normalizeOperationSignature(record.signature);
        return signature.contentId === String(contentId || '')
          && signature.publishMode === publishMode
          && signature.expectedUpdatedAt === expectedUpdatedAt
          && (!normalizedPlatforms.length
            || JSON.stringify(signature.platforms) === JSON.stringify(normalizedPlatforms));
      }) || null;
    },
    begin(operationId, signature) {
      const canonicalSignature = normalizeOperationSignature(signature);
      reloadAndPrune();

      const existing = records.find(record => record.operationId === operationId);
      if (existing) {
        if (!operationSignaturesMatch(existing.signature, canonicalSignature)) {
          throw statusError('operationId 已用于其他发布参数或内容版本', 409);
        }
        if (existing.state === 'completed') return { kind: 'replay', record: existing };
        if (existing.state === 'uncertain') {
          throw statusError('该发布操作结果不确定，禁止自动重试；请人工核对平台结果', 409);
        }
        if (existing.state === 'failed') {
          throw statusError('该发布操作已失败，禁止用相同 operationId 自动重试', 409);
        }
        throw statusError('相同 operationId 的发布正在进行，请勿重复提交', 409);
      }
      const matchingSignature = records.filter(record => operationSignaturesMatch(record.signature, canonicalSignature));
      const uncertain = matchingSignature.find(record => record.state === 'uncertain');
      if (uncertain) {
        throw statusError('相同内容与平台的发布结果不确定，禁止自动重试；请人工核对平台结果', 409);
      }
      const running = matchingSignature.find(record => record.state === 'running');
      if (running) {
        throw statusError('相同内容与平台的发布正在进行，请勿重复提交', 409);
      }
      const completed = matchingSignature.find(record => record.state === 'completed');
      if (completed) {
        const timestamp = operationTimestamp(nowMs);
        const completedSignature = normalizeOperationSignature(completed.signature);
        const missingExpectedRevision = !completedSignature.expectedUpdatedAt;
        const preserveLegacySignature = missingExpectedRevision || !completedSignature.sourceHash;
        const completedResult = normalizeJournalResult(completed.result);
        const alias = {
          operationId,
          signature: preserveLegacySignature ? completedSignature : canonicalSignature,
          state: 'completed',
          result: missingExpectedRevision
            ? { ...(completedResult || {}), canonicalConflict: true, needsReload: true }
            : completedResult,
          aliasOf: completed.aliasOf || completed.operationId,
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: timestamp,
        };
        if (records.length >= limit) {
          const removable = records
            .filter(record => record.state !== 'running' && record.state !== 'uncertain')
            .sort((left, right) => Date.parse(left.updatedAt || left.createdAt || 0) - Date.parse(right.updatedAt || right.createdAt || 0));
          while (records.length >= limit && removable.length) {
            const oldest = removable.shift();
            records = records.filter(record => record !== oldest);
          }
        }
        if (records.length >= limit) {
          throw statusError('已完成操作无法安全写入回放别名，请使用原 operationId 查询结果', 409);
        }
        records.push(alias);
        persist();
        return { kind: 'replay', record: alias };
      }
      if (records.length >= limit) {
        records = records.filter(record => record.state === 'running' || record.state === 'uncertain');
        if (records.length >= limit) throw statusError('发布操作日志已满，请先人工处理不确定操作', 503);
      }

      const timestamp = operationTimestamp(nowMs);
      const record = {
        operationId,
        signature: canonicalSignature,
        state: 'running',
        result: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      records.push(record);
      persist();
      return { kind: 'started', record };
    },
    complete(operationId, result) {
      const record = updateState(operationId, 'completed', result);
      if (!record || record.state !== 'completed') throw new Error('发布操作不在运行状态');
      return record;
    },
    fail(operationId, result = null) {
      return updateState(operationId, 'failed', result);
    },
    markUncertain(operationId, result = null) {
      return updateState(operationId, 'uncertain', result);
    },
    recoverRunning() {
      reload();
      const timestamp = operationTimestamp(nowMs);
      let changed = false;
      for (const record of records) {
        if (record.state !== 'running') continue;
        const signature = normalizeOperationSignature(record.signature);
        if (!signature.expectedUpdatedAt) continue;
        record.state = 'uncertain';
        record.updatedAt = timestamp;
        record.uncertainAt = timestamp;
        changed = true;
      }
      prune(nowMs());
      if (changed) persist();
      return changed;
    },
  };
}

function defaultProcessIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function createInstanceLock(options = {}) {
  const filePath = path.resolve(options.filePath || `${OPERATIONS_FILE}.instance.lock`);
  const ownerPid = Number.isInteger(options.pid) ? options.pid : process.pid;
  const isProcessAlive = typeof options.isProcessAlive === 'function' ? options.isProcessAlive : defaultProcessIsAlive;
  const token = String(options.token || randomBytes(18).toString('hex'));
  let owned = false;

  const readLock = () => {
    const descriptor = fs.openSync(filePath, 'r');
    try {
      const stat = fs.fstatSync(descriptor);
      const document = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
      return { document, stat };
    } finally {
      fs.closeSync(descriptor);
    }
  };
  const releaseOnExit = () => {
    try {
      release();
    } catch {
      // Process exit must continue even when lock cleanup cannot complete.
    }
  };
  const acquire = () => {
    if (owned) return true;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    for (let attempt = 0; attempt < 4; attempt++) {
      let descriptor;
      try {
        descriptor = fs.openSync(filePath, 'wx', 0o600);
        fs.writeFileSync(descriptor, `${JSON.stringify({ pid: ownerPid, token, createdAt: now() })}\n`, 'utf8');
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        owned = true;
        process.once('exit', releaseOnExit);
        return true;
      } catch (error) {
        if (descriptor !== undefined) fs.closeSync(descriptor);
        if (error?.code !== 'EEXIST') throw error;
      }

      let existing;
      try {
        existing = readLock();
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        existing = { document: {}, stat: fs.lstatSync(filePath) };
      }
      const existingPid = Number(existing.document?.pid);
      if (isProcessAlive(existingPid)) {
        const error = new Error(`已有发布面板进程正在使用当前数据目录（PID ${existingPid}）`);
        error.code = 'PUBLISHER_INSTANCE_ACTIVE';
        throw error;
      }
      try {
        const currentStat = fs.lstatSync(filePath);
        if (currentStat.dev !== existing.stat.dev || currentStat.ino !== existing.stat.ino) continue;
        fs.unlinkSync(filePath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    throw new Error('无法安全获取发布面板实例锁');
  };
  const release = () => {
    if (!owned) return false;
    try {
      const current = readLock().document;
      if (Number(current?.pid) === ownerPid && current?.token === token) fs.unlinkSync(filePath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    } finally {
      owned = false;
      process.removeListener('exit', releaseOnExit);
    }
    return true;
  };

  return { filePath, acquire, release, isOwned: () => owned };
}

function attachInstanceLock(server, instanceLock, operationJournal) {
  const listen = server.listen;
  server.listen = function listenWithInstanceLock(...args) {
    instanceLock.acquire();
    try {
      operationJournal.recoverRunning();
      return listen.apply(this, args);
    } catch (error) {
      instanceLock.release();
      throw error;
    }
  };
  server.on('close', () => instanceLock.release());
  server.on('error', () => {
    if (!server.listening) instanceLock.release();
  });
  return server;
}

function loopbackHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function requestOriginIsTrusted(req, originHeader) {
  if (!req.headers.host) return false;
  try {
    const requestHost = new URL(`http://${req.headers.host}`);
    if (!loopbackHostname(requestHost.hostname)) return false;
    if (!originHeader) return true;
    if (originHeader === 'null') return false;
    const origin = new URL(originHeader);
    if (origin.protocol !== 'http:'
      || origin.username
      || origin.password
      || origin.pathname !== '/'
      || origin.search
      || origin.hash
      || !loopbackHostname(origin.hostname)) return false;
    return origin.port === requestHost.port;
  } catch {
    return false;
  }
}

function csrfTokenMatches(expected, supplied) {
  if (typeof supplied !== 'string') return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toDateKey(date = new Date()) {
  const d = typeof date === 'string' ? new Date(`${date}T00:00:00`) : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateKey, days) {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

function weekdayForDate(dateKey) {
  const d = new Date(`${dateKey}T00:00:00`);
  return WEEKDAYS[d.getDay()];
}

function daySpan(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  return Math.round((end - start) / 86400000);
}

function getMonday(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return toDateKey(d);
}

function jsonValue(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function encodeJson(value) {
  return JSON.stringify(value ?? null);
}

function stripAnsi(value) {
  return String(value || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platforms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      auth_status TEXT NOT NULL DEFAULT 'unknown',
      account TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS weekly_plans (
      date TEXT PRIMARY KEY,
      weekday TEXT NOT NULL,
      topic TEXT,
      type TEXT,
      audience TEXT,
      materials TEXT,
      status TEXT NOT NULL,
      content_id TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      plan_date TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      priority TEXT NOT NULL,
      score INTEGER NOT NULL,
      evidence TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT,
      body TEXT NOT NULL,
      type TEXT,
      plan_date TEXT,
      status TEXT NOT NULL,
      layout_html TEXT,
      images TEXT NOT NULL,
      selected_platforms TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS publish_jobs (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      platforms TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS publish_results (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      url TEXT,
      post_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_commands (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL,
      progress TEXT NOT NULL,
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

function upsertPlatform(id, name, status = 'available') {
  db.prepare(`
    INSERT INTO platforms (id, name, status, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(id, name, status, now());
}

function cleanupRetiredPlatforms() {
  for (const id of RETIRED_PLATFORM_IDS) {
    db.prepare('DELETE FROM platforms WHERE id = ?').run(id);
  }
}

function addActivity(action, targetType = null, targetId = null, actor = 'AI 助手') {
  db.prepare(`
    INSERT INTO activity (id, actor, action, target_type, target_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(makeId('act'), actor, action, targetType, targetId, now());
}

function runTransaction(callback) {
  db.exec('BEGIN');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Preserve the original transaction error.
    }
    throw error;
  }
}

function seedData() {
  for (const [id, name] of FALLBACK_PLATFORMS) upsertPlatform(id, name);
  cleanupRetiredPlatforms();

  const planCount = db.prepare('SELECT COUNT(*) AS count FROM weekly_plans').get().count;
  if (planCount === 0) {
    const monday = getMonday();
    const seedTopics = [
      ['新能源行业视觉检测方案升级', '行业分析', '设备商 / 集成商', '客户案例、新能源产线资料', '选题已确认'],
      ['视觉检测项目验收常见误区', '清单指南', '工艺工程师', '项目复盘、售后问题库', '正文已生成'],
      ['从客户案例看缺陷检测 ROI', '案例复盘', '团队主管', '客户案例资料包', '已排版'],
      ['AI 质检上线前的准备清单', '方法论', '集成商', '方法论知识库', '待选题'],
      ['本周制造业热点解读', '热点解读', '内容运营', '行业新闻、趋势报告', '待选题'],
      ['机器视觉项目沟通模板', '方法论', '销售 / 售前', '方案模板库', '待选题'],
      ['下周选题预留', '行业分析', '运营团队', '待补充', '待选题'],
    ];

    for (let i = 0; i < 7; i++) {
      const date = addDays(monday, i);
      const d = new Date(`${date}T00:00:00`);
      const [topic, type, audience, materials, status] = seedTopics[i];
      db.prepare(`
        INSERT INTO weekly_plans (date, weekday, topic, type, audience, materials, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(date, WEEKDAYS[d.getDay()], topic, type, audience, materials, status, now());
    }

    addActivity('初始化本周内容排期', 'weekly_plan', monday);
  }

  const contentCount = db.prepare('SELECT COUNT(*) AS count FROM contents').get().count;
  if (contentCount === 0) {
    const plan = db.prepare("SELECT * FROM weekly_plans WHERE status IN ('正文已生成', '已排版') ORDER BY date LIMIT 1").get();
    if (plan) {
      const contentId = makeId('content');
      db.prepare(`
        INSERT INTO contents
          (id, title, summary, body, type, plan_date, status, layout_html, images, selected_platforms, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        contentId,
        plan.topic,
        '这是一篇由可视化面板生成的示例内容，用于演示正文预览、排版预览和发布流转。',
        buildArticleBody(plan.topic, plan.type, plan.audience, plan.materials),
        plan.type,
        plan.date,
        plan.status,
        buildLayoutHtml(plan.topic, buildArticleBody(plan.topic, plan.type, plan.audience, plan.materials)),
        encodeJson(sampleImages()),
        encodeJson(DEFAULT_SELECTED_PLATFORMS),
        now(),
        now()
      );
      db.prepare('UPDATE weekly_plans SET content_id = ? WHERE date = ?').run(contentId, plan.date);
      addActivity(`生成示例内容《${plan.topic}》`, 'content', contentId);
    }
  }
}

function sampleImages() {
  return [
    { id: 'img_001', source: '客户案例', status: '已审核', usage: '正文配图', position: '第 2 段' },
    { id: 'img_002', source: 'AI 生成', status: '已审核', usage: '封面', position: '封面' },
    { id: 'img_003', source: '客户案例', status: '待审核', usage: '正文配图', position: '第 4 段' },
  ];
}

function buildArticleBody(topic, type = '行业分析', audience = '内容运营', materials = '资料库') {
  return [
    `# ${topic}`,
    '',
    `这篇内容面向 ${audience}，采用「${type}」的表达方式，结合 ${materials} 做结构化说明。`,
    '',
    '## 现状判断',
    '制造业内容传播的关键不只是把案例讲清楚，还要让不同平台读者能在最短时间理解问题、方案和价值。',
    '',
    '## 解决思路',
    '先用业务场景建立共识，再用案例证据支撑判断，最后给出可执行的检查清单，降低读者理解成本。',
    '',
    '## 发布建议',
    '公众号适合完整叙事，知乎适合方法论拆解，掘金/CSDN 适合技术细节，抖音文章适合提炼成短段落和强标题。',
  ].join('\n');
}

function separateLegacyIndentedHtmlCode(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const output = [];
  let fenceCharacter = '';
  let fenceLength = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (!fenceCharacter) {
        fenceCharacter = fence[1][0];
        fenceLength = fence[1].length;
      } else if (fence[1][0] === fenceCharacter && fence[1].length >= fenceLength) {
        fenceCharacter = '';
        fenceLength = 0;
      }
      output.push(line);
      continue;
    }
    const legacyIndentedHtml = !fenceCharacter && /^(?: {4}|\t)<[^>\r\n]+>/.test(line);
    if (legacyIndentedHtml && output.length && output[output.length - 1].trim()) output.push('');
    output.push(line);
    const nextLine = lines[index + 1];
    if (legacyIndentedHtml && nextLine !== undefined && nextLine.trim() && !/^(?: {4}|\t)/.test(nextLine)) {
      output.push('');
    }
  }
  return output.join('\n');
}

function markdownToImportedHtml(markdown) {
  return marked.parse(separateLegacyIndentedHtmlCode(markdown), {
    async: false,
    gfm: true,
    renderer: canonicalMarkdownRenderer,
  });
}

function textToImportedHtml(text) {
  return String(text || '')
    .split(/(?:\r?\n){2,}/)
    .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, '<br>')}</p>`)
    .join('\n');
}

function markdownToHtml(markdown, options = {}) {
  if (options.imported) return markdownToImportedHtml(markdown);
  if (isHtmlBody(markdown)) return String(markdown || '');
  return markdownToImportedHtml(markdown);
}

function isHtmlBody(value) {
  return /<(article|section|p|div|h[1-6]|img|figure|br|hr|ul|ol|li|blockquote|strong|em|pre|code|table|a)\b/i.test(String(value || ''));
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<img[^>]+alt=["']?([^"'>]*)["']?[^>]*>/gi, ' $1 ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|figure)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractEmbeddedHtmlDocument(value) {
  const text = stripHtml(value);
  const startMatch = text.match(/<!doctype\s+html/i) || text.match(/<html[\s>]/i);
  if (!startMatch || typeof startMatch.index !== 'number') return '';
  let documentText = text.slice(startMatch.index).trim();
  const endMatch = documentText.match(/<\/html>/i);
  if (endMatch && typeof endMatch.index === 'number') {
    documentText = documentText.slice(0, endMatch.index + endMatch[0].length);
  }
  return isFullHtmlDocument(documentText) ? documentText : '';
}

function htmlToMarkdown(html) {
  return canonicalTurndown.turndown(sanitizeImportedHtml(String(html || ''))).trim();
}

function contentBodyToMarkdown(body) {
  const value = String(body || '');
  return isHtmlBody(value) ? htmlToMarkdown(value) : value;
}

function buildLayoutHtml(title, body) {
  const embeddedHtml = extractEmbeddedHtmlDocument(body);
  if (embeddedHtml) return embeddedHtml;
  return [
    '<article class="wechat-preview">',
    `<h1>${escapeHtml(title)}</h1>`,
    '<p class="lead">排版模板：清爽运营稿。标题突出，正文按移动端阅读节奏分段。</p>',
    markdownToHtml(body).replace(/<h1>.*?<\/h1>/, ''),
    '</article>',
  ].join('\n');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function rows(sql, ...params) {
  return db.prepare(sql).all(...params);
}

function one(sql, ...params) {
  return db.prepare(sql).get(...params);
}

function normalizeContent(row) {
  if (!row) return null;
  return {
    ...row,
    body: normalizeCanonicalBody(row.body),
    images: jsonValue(row.images, []),
    selected_platforms: jsonValue(row.selected_platforms, []),
  };
}

function normalizeJob(row) {
  if (!row) return null;
  const results = rows('SELECT * FROM publish_results WHERE job_id = ? ORDER BY created_at', row.id);
  return {
    ...row,
    platforms: jsonValue(row.platforms, []),
    results,
  };
}

function getDashboardData() {
  const platforms = platformRows();
  const plans = rows('SELECT * FROM weekly_plans ORDER BY date');
  const contents = rows('SELECT * FROM contents ORDER BY updated_at DESC').map(normalizeContent);
  const jobs = rows('SELECT * FROM publish_jobs ORDER BY created_at DESC LIMIT 50').map(normalizeJob);
  const commands = rows('SELECT * FROM ai_commands ORDER BY created_at DESC LIMIT 20')
    .map(command => ({
      ...command,
      progress: jsonValue(command.progress, []),
      result: jsonValue(command.result_json, null),
    }));
  const activity = rows('SELECT * FROM activity ORDER BY created_at DESC LIMIT 10');

  const thisWeekPublished = jobs.filter(job => job.status === 'published').length;
  const pendingDrafts = contents.filter(content => content.status === '草稿已保存').length;
  const generated = contents.filter(content => ['正文已生成', '已排版', '草稿已保存'].includes(content.status)).length;
  const failed = jobs.filter(job => job.status === 'failed').length;

  const dashboardPlatformOrder = new Map(DASHBOARD_DISTRIBUTION_PLATFORMS.map((id, index) => [id, index]));
  const platformDistribution = platforms
    .filter(platform => dashboardPlatformOrder.has(platform.id))
    .map(platform => {
      const countRow = one(`
        SELECT
          COUNT(*) AS count,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
        FROM publish_results
        WHERE platform = ? AND status IN ('success', 'failed')
      `, platform.id);
      return {
        id: platform.id,
        name: DASHBOARD_PLATFORM_LABELS[platform.id] || platform.name,
        count: countRow.count || 0,
        success: countRow.success || 0,
        failed: countRow.failed || 0,
      };
    })
    .filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count || dashboardPlatformOrder.get(a.id) - dashboardPlatformOrder.get(b.id));

  return {
    stats: {
      thisWeekPublished,
      pendingDrafts,
      generated,
      failed,
      monthPublished: thisWeekPublished,
      platformCount: platforms.length,
    },
    platforms,
    platformDistribution,
    plans,
    contents,
    jobs,
    commands,
    activity,
    today: toDateKey(),
  };
}

function parsePlatformOutput(output) {
  const platforms = [];
  for (const rawLine of String(output || '').split('\n')) {
    const line = stripAnsi(rawLine).trim();
    if (!line || /支持的平台|Supported platforms/i.test(line)) continue;
    const match = line.match(/^([a-z0-9_-]+)\s+(.+)$/i);
    if (!match) continue;
    platforms.push({ id: match[1], name: match[2].trim() });
  }
  return platforms;
}

const GENERIC_AUTH_ACCOUNTS = new Set([
  'Chrome CDP session',
  'Browser page session',
  'Cookie session',
  'Douban Cookie session',
]);

function normalizePlatformAccount(account) {
  const value = String(account || '').trim();
  return value && !GENERIC_AUTH_ACCOUNTS.has(value) ? value : null;
}

function normalizePlatformRow(platform) {
  return platform ? { ...platform, account: normalizePlatformAccount(platform.account) } : platform;
}

function platformRows() {
  return rows('SELECT * FROM platforms ORDER BY name').map(normalizePlatformRow);
}

function setPlatformAuthStatus(platform, authStatus, account = null) {
  db.prepare('UPDATE platforms SET auth_status = ?, account = ?, updated_at = ? WHERE id = ?')
    .run(authStatus, normalizePlatformAccount(account), now(), platform);
}

const AUTH_FAILURE_PATTERN = /(?:\u672a\u767b\u5f55|\u767b\u5f55.*(?:\u8fc7\u671f|\u5931\u6548|\u65e0\u6548)|\u767b\u5f55\u6001.*(?:\u8fc7\u671f|\u5931\u6548|\u65e0\u6548)|\u4f1a\u8bdd.*(?:\u672a\u767b\u5f55|\u8fc7\u671f|\u5931\u6548|\u65e0\u6548)|\u8bf7.*\u767b\u5f55|\u6ca1\u6709\u8bfb\u53d6\u5230.*\u767b\u5f55|login session not found|not logged in|session.*expired|unauthorized|forbidden|\b401\b|\b403\b)/i;

function isAuthFailureMessage(message) {
  return AUTH_FAILURE_PATTERN.test(stripAnsi(String(message || '')));
}

function parseAuthOutput(platform, output) {
  const clean = stripAnsi(output);
  const loggedIn = /(?:✓|✔).+已登录|已登录/i.test(clean) && !/(?:✗|✘|×).+未登录/.test(clean);
  const account = normalizePlatformAccount(clean.match(/用户:\s*(.+)/)?.[1]?.trim()
    || clean.match(/\(([^)]+)\)/)?.[1]?.trim()
    || null);
  const error = clean.match(/错误:\s*(.+)/)?.[1]?.trim()
    || clean.match(/Error:\s*(.+)/)?.[1]?.trim()
    || clean.match(/login session not found\..+/i)?.[0]?.trim()
    || null;
  return {
    id: platform,
    auth_status: loggedIn ? 'logged_in' : 'logged_out',
    account,
    message: loggedIn ? `已登录${account ? ` (${account})` : ''}` : (error || '未登录'),
  };
}

function parseSyncResults(output) {
  const results = {};
  const lines = String(output || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const clean = stripAnsi(lines[i]).trim();
    const success = clean.match(/^(?:✓|✔|\[OK\])\s+(.+?)\s*$/u);
    const failed = clean.match(/^(?:✗|✘|×|\[FAIL\])\s+(.+?)\s*$/u);
    if (!success && !failed) continue;

    const platform = (success?.[1] || failed?.[1]).replace(/\s+\(.+?\)$/, '').trim();
    const details = [];
    let url = null;
    for (let j = i + 1; j < lines.length; j++) {
      const raw = lines[j];
      const detail = stripAnsi(raw).trim();
      if (!detail) break;
      if (/^(?:✓|✔|✗|✘|×|\[OK\]|\[FAIL\])\s+/.test(detail)) break;
      if (!/^\s/.test(raw)) break;
      const urlMatch = detail.match(/https?:\/\/\S+/);
      if (urlMatch && !url) url = urlMatch[0].replace(/[),\]}]+$/, '');
      if (!/^https?:\/\/\S+$/.test(detail)) details.push(detail);
      i = j;
    }
    results[platform] = success
      ? { status: 'success', url, message: details.join(' ') }
      : { status: 'failed', error: details.join(' ') || '未知错误' };
  }

  const douyinDraftId = output.match(/\[Douyin\]\s+Draft saved:\s*([^\s]+)/i)?.[1];
  const weixinAppMsgId = output.match(/appMsgId:\s*['"]?([0-9]+)/i)?.[1];
  if (results.douyin && douyinDraftId) results.douyin.postId = douyinDraftId;
  if (results.weixin && weixinAppMsgId) results.weixin.postId = weixinAppMsgId;
  return results;
}

function runProcess(command, args, options = {}) {
  return new Promise(resolve => {
    execFile(command, args, {
      cwd: options.cwd || REPO_ROOT,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...(options.env || {}) },
      timeout: options.timeout || 30000,
      windowsHide: true,
      maxBuffer: options.maxBuffer || 20 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolve({
        code: error?.code || 0,
        error,
        stdout: stdout || '',
        stderr: stderr || '',
        output: `${stdout || ''}${stderr || ''}`,
      });
    });
  });
}

async function runWeibotCli(args, timeout = 30000) {
  if (!fs.existsSync(CLI_PATH)) {
    throw new Error(`CLI 尚未构建: ${CLI_PATH}`);
  }
  return runProcess(process.execPath, [CLI_PATH, '--runtime', 'node', '--cookie-file', COOKIE_FILE, ...args], {
    cwd: REPO_ROOT,
    env: commandEnv({ WEIBOT_COOKIE_FILE: COOKIE_FILE }),
    timeout,
  });
}

function commandEnv(extra = {}) {
  return {
    ...process.env,
    ...extra,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };
}

function ensureCliBuilt() {
  if (!fs.existsSync(CLI_PATH)) {
    throw new Error(`CLI 尚未构建: ${CLI_PATH}`);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeDomain(domain) {
  return String(domain || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
}

function bareDomain(domain) {
  return normalizeDomain(domain).replace(/^\./, '');
}

function domainMatches(cookieDomain, targetDomain) {
  const cookie = bareDomain(cookieDomain);
  const target = bareDomain(targetDomain);
  return cookie === target || cookie.endsWith(`.${target}`);
}

function normalizeCookie(cookie) {
  return {
    ...cookie,
    domain: normalizeDomain(cookie.domain),
    path: cookie.path || '/',
  };
}

function parseCookieHeader(header, domain) {
  return String(header || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const index = part.indexOf('=');
      return normalizeCookie({
        name: index >= 0 ? part.slice(0, index).trim() : part,
        value: index >= 0 ? part.slice(index + 1).trim() : '',
        domain,
        path: '/',
      });
    });
}

function importCookies(input) {
  if (Array.isArray(input)) return input.map(normalizeCookie);
  const cookies = [];
  for (const [domain, value] of Object.entries(input || {})) {
    if (Array.isArray(value)) {
      cookies.push(...value.map(cookie => normalizeCookie({ ...cookie, domain: cookie.domain || domain })));
    } else if (typeof value === 'string') {
      cookies.push(...parseCookieHeader(value, domain));
    } else if (value && typeof value === 'object') {
      for (const [name, cookieValue] of Object.entries(value)) {
        cookies.push(normalizeCookie({ name, value: cookieValue, domain, path: '/' }));
      }
    }
  }
  return cookies;
}

function readExistingCookies(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return [];
  return importCookies(JSON.parse(raw));
}

function mergeCookies(existing, additions) {
  const merged = new Map();
  for (const cookie of [...existing, ...additions]) {
    const normalized = normalizeCookie(cookie);
    const key = `${normalized.domain}\t${normalized.path || '/'}\t${normalized.name}`;
    merged.set(key, normalized);
  }
  return [...merged.values()].sort((a, b) => {
    const domainCompare = a.domain.localeCompare(b.domain);
    return domainCompare || a.name.localeCompare(b.name);
  });
}

function groupCookies(cookies) {
  const grouped = {};
  for (const cookie of cookies) {
    const normalized = normalizeCookie(cookie);
    grouped[normalized.domain] ||= [];
    grouped[normalized.domain].push(normalized);
  }
  return grouped;
}

function candidateBrowsers() {
  const candidates = [process.env.CHROME_PATH].filter(Boolean);
  if (process.platform === 'win32') {
    for (const root of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(
        path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      );
    }
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }
  return candidates;
}

function resolveBrowserPath() {
  for (const candidate of candidateBrowsers()) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error('没有找到 Chrome 或 Edge，请设置 CHROME_PATH 后重试');
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('无法分配本地调试端口'));
      });
    });
  });
}

async function waitForJson(url, timeoutMs = 30000) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(400);
  }
  throw new Error(`等待 Chrome DevTools 超时: ${url} (${lastError?.message || 'unknown error'})`);
}

async function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('连接 Chrome DevTools WebSocket 超时')), 10000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener('error', event => {
      clearTimeout(timer);
      reject(event.error || new Error('Chrome DevTools WebSocket 连接失败'));
    }, { once: true });
  });
  return socket;
}

let cdpRequestId = 0;
async function websocketMessageText(data) {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString();
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString();
  if (data && typeof data.text === 'function') return data.text();
  return String(data);
}

function cdpRequest(socket, method, params) {
  const id = ++cdpRequestId;
  return new Promise((resolve, reject) => {
    const onMessage = async event => {
      const raw = await websocketMessageText(event.data);
      const message = JSON.parse(raw);
      if (message.id !== id) return;
      socket.removeEventListener('message', onMessage);
      if (message.error) reject(new Error(message.error.message || `${method} failed`));
      else resolve(message.result);
    };
    socket.addEventListener('message', onMessage);
    try {
      socket.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      socket.removeEventListener('message', onMessage);
      reject(error);
    }
  });
}

async function getPageDebuggerUrl(port, loginUrl) {
  const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`);
  const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl)
    || targets.find(target => target.webSocketDebuggerUrl);
  if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;

  const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(loginUrl)}`, { method: 'PUT' });
  if (!created.ok) throw new Error(`无法创建 Chrome 页面: HTTP ${created.status}`);
  const target = await created.json();
  if (!target.webSocketDebuggerUrl) throw new Error('Chrome 页面没有暴露 DevTools WebSocket');
  return target.webSocketDebuggerUrl;
}

async function collectBrowserCookies(port, loginUrl) {
  const debuggerUrl = await getPageDebuggerUrl(port, loginUrl);
  const socket = await connectCdp(debuggerUrl);
  try {
    await cdpRequest(socket, 'Network.enable').catch(() => undefined);
    let result;
    try {
      result = await cdpRequest(socket, 'Network.getAllCookies');
    } catch {
      result = await cdpRequest(socket, 'Storage.getCookies');
    }
    return (result.cookies || []).map(cookie => normalizeCookie({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expirationDate: cookie.expires && cookie.expires > 0 ? Math.floor(cookie.expires) : undefined,
    }));
  } finally {
    socket.close();
  }
}

async function closeLoginBrowser(port, loginUrl) {
  const debuggerUrl = await getPageDebuggerUrl(port, loginUrl);
  const socket = await connectCdp(debuggerUrl);
  try {
    await cdpRequest(socket, 'Browser.close');
  } finally {
    socket.close();
  }
}

function writePlatformSession(session) {
  const stableDir = path.join(LOGIN_DIR, session.platform);
  fs.mkdirSync(stableDir, { recursive: true });
  fs.writeFileSync(path.join(stableDir, 'session.json'), `${JSON.stringify({
    platform: session.platform,
    browserPath: session.browserPath,
    port: session.port,
    userDataDir: session.userDataDir,
    loginUrl: session.loginUrl,
    updatedAt: now(),
  }, null, 2)}\n`, 'utf8');
}

async function startLoginSession(platform) {
  const platformId = String(platform || '').trim().toLowerCase();
  if (!platformId) throw new Error('缺少平台 ID');
  const config = LOGIN_PLATFORMS[platformId];
  if (!config) throw new Error(`暂不支持网页登录导出: ${platformId}`);

  const existing = [...loginSessions.values()].find(session => session.platform === platformId && !session.done);
  if (existing) return existing;

  const id = makeId('login');
  const userDataDir = path.join(LOGIN_DIR, platformId, 'profile');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true });
  const browserPath = resolveBrowserPath();
  const port = await findFreePort();

  const session = {
    id,
    platform: platformId,
    name: config.name,
    loginUrl: config.loginUrl,
    domains: config.domains,
    browserPath,
    port,
    output: `Browser: ${browserPath}\nProfile: ${userDataDir}\nCookie: ${COOKIE_FILE}\n`,
    ready: true,
    done: false,
    exporting: false,
    exitCode: null,
    error: null,
    userDataDir,
    cookieFile: COOKIE_FILE,
  };

  const child = spawn(browserPath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    config.loginUrl,
  ], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
  } catch (error) {
    session.done = true;
    session.error = `无法连接登录浏览器调试端口。请关闭刚才打开的 ${config.name} 登录窗口后重试。${error.message}`;
    throw new Error(session.error);
  }

  writePlatformSession(session);
  loginSessions.set(id, session);
  return session;
}

function waitForLoginReady(session, timeoutMs = 12000) {
  return Promise.resolve(session);
}

async function finishLoginSession(session) {
  if (session.done) return session;
  if (session.exporting) throw new Error(`${session.name || session.platform} 正在导出 Cookie，请不要重复点击`);
  session.exporting = true;
  try {
    await waitForJson(`http://127.0.0.1:${session.port}/json/version`, 5000)
      .catch(() => {
        throw new Error('登录浏览器已经关闭，请重新点击登录并在新窗口完成登录');
      });
    const allCookies = await collectBrowserCookies(session.port, session.loginUrl);
    const exported = allCookies.filter(cookie => session.domains.some(domain => domainMatches(cookie.domain, domain)));
    if (!exported.length) {
      throw new Error(`没有读取到 ${session.name || session.platform} 的 Cookie，请确认已经在刚才打开的浏览器窗口完成登录`);
    }

    const merged = mergeCookies(readExistingCookies(session.cookieFile), exported);
    fs.writeFileSync(session.cookieFile, `${JSON.stringify(groupCookies(merged), null, 2)}\n`, 'utf8');
    session.exportedCount = exported.length;
    session.exportedDomains = [...new Set(exported.map(cookie => cookie.domain))].sort();
    session.output += `Exported ${exported.length} cookies to ${session.cookieFile}\n`;
    writePlatformSession(session);
    if (!INTERACTIVE_AUTH_PLATFORMS.has(session.platform)) {
      await closeLoginBrowser(session.port, session.loginUrl).catch(() => undefined);
    }
    session.done = true;
    session.exitCode = 0;
    setTimeout(() => loginSessions.delete(session.id), 120000);
    return session;
  } catch (error) {
    session.error = error.message;
    if (/登录浏览器已经关闭|等待 Chrome DevTools/.test(error.message)) {
      session.done = true;
      loginSessions.delete(session.id);
    }
    throw error;
  } finally {
    session.exporting = false;
  }
}

function exportedLoginResult(session) {
  const domains = Array.isArray(session.exportedDomains) && session.exportedDomains.length
    ? `；域名: ${session.exportedDomains.join(', ')}`
    : '';
  return {
    id: session.platform,
    auth_status: 'logged_in',
    account: session.name || session.platform,
    message: `已导出 ${session.exportedCount || 0} 个 Cookie${domains}`,
  };
}

function loginExported(output) {
  return /(已导出\s+\d+\s+个\s*Cookie|Exported\s+\d+\s+cookies?)/i.test(stripAnsi(output));
}

async function refreshPlatformsFromCli() {
  try {
    const result = await runWeibotCli(['platforms'], 20000);
    if (result.error) throw result.error;
    const parsed = parsePlatformOutput(result.output);
    if (!parsed.length) {
      throw new Error(stripAnsi(result.output).trim() || '未读取到平台列表');
    }
    for (const platform of parsed) upsertPlatform(platform.id, platform.name);
    addActivity(`刷新平台列表：${parsed.length} 个平台`, 'platforms', null, '系统');
    return { platforms: platformRows() };
  } catch (error) {
    const message = stripAnsi(error?.message || String(error)).trim() || '未知错误';
    addActivity(`刷新平台列表失败，已使用本地平台列表：${message}`, 'platforms', null, '系统');
    return {
      platforms: platformRows(),
      warning: `CLI 刷新平台列表失败，已使用本地平台列表（${message}）`,
    };
  }
}

function generateCandidates(planDate = toDateKey()) {
  const d = new Date(`${planDate}T00:00:00`);
  const base = [
    ['P0', 92, '新能源产线视觉检测升级的三个关键判断', '行业分析', '新能源案例库、设备商访谈'],
    ['P1', 84, '项目验收前必须确认的 6 个视觉检测指标', '清单指南', '验收问题库、项目复盘'],
    ['P1', 79, '从客户案例复盘缺陷检测方案落地路径', '案例复盘', '客户案例、方案文档'],
    ['P2', 73, 'AI 质检与传统规则检测如何分工', '方法论', '技术白皮书、售前问答'],
    ['P2', 68, '本周制造业热点对机器视觉内容的启发', '热点解读', '行业新闻、趋势报告'],
  ];
  db.prepare('DELETE FROM candidates WHERE plan_date = ?').run(planDate);
  for (const [priority, score, title, type, evidence] of base) {
    db.prepare(`
      INSERT INTO candidates (id, plan_date, title, type, priority, score, evidence, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '候选', ?)
    `).run(makeId('cand'), planDate, title, type, priority, score, evidence, now());
  }
  const plan = one('SELECT * FROM weekly_plans WHERE date = ?', planDate);
  if (!plan) {
    db.prepare(`
      INSERT INTO weekly_plans (date, weekday, topic, type, audience, materials, status, updated_at)
      VALUES (?, ?, '', '', '', '', '待选题', ?)
    `).run(planDate, WEEKDAYS[d.getDay()], now());
  }
  addActivity(`${planDate} 生成 5 个候选选题`, 'candidate', planDate);
  return rows('SELECT * FROM candidates WHERE plan_date = ? ORDER BY score DESC', planDate);
}

function confirmCandidate(candidateId) {
  const candidate = one('SELECT * FROM candidates WHERE id = ?', candidateId);
  if (!candidate) throw new Error('候选选题不存在');
  db.prepare("UPDATE candidates SET status = '未采用' WHERE plan_date = ?").run(candidate.plan_date);
  db.prepare("UPDATE candidates SET status = '已确认' WHERE id = ?").run(candidateId);
  db.prepare(`
    UPDATE weekly_plans
    SET topic = ?, type = ?, materials = ?, audience = ?, status = '选题已确认', updated_at = ?
    WHERE date = ?
  `).run(candidate.title, candidate.type, candidate.evidence, '内容运营 / 业务负责人', now(), candidate.plan_date);
  addActivity(`确认选题《${candidate.title}》`, 'candidate', candidateId, '运营');
  return {
    candidate: one('SELECT * FROM candidates WHERE id = ?', candidateId),
    plan: one('SELECT * FROM weekly_plans WHERE date = ?', candidate.plan_date),
  };
}

function cleanPlanPayload(payload = {}) {
  return {
    topic: String(payload.topic || '').trim(),
    type: String(payload.type || '').trim(),
    audience: String(payload.audience || '').trim(),
    materials: String(payload.materials || '').trim(),
    status: String(payload.status || '待选题').trim() || '待选题',
  };
}

function ensurePlan(date) {
  const dateKey = toDateKey(date);
  const existing = one('SELECT * FROM weekly_plans WHERE date = ?', dateKey);
  if (existing) return existing;
  db.prepare(`
    INSERT INTO weekly_plans (date, weekday, topic, type, audience, materials, status, updated_at)
    VALUES (?, ?, '', '', '', '', '待选题', ?)
  `).run(dateKey, weekdayForDate(dateKey), now());
  return one('SELECT * FROM weekly_plans WHERE date = ?', dateKey);
}

function updatePlan(date, payload = {}) {
  const dateKey = toDateKey(date);
  ensurePlan(dateKey);
  const plan = cleanPlanPayload(payload);
  db.prepare(`
    UPDATE weekly_plans
    SET weekday = ?, topic = ?, type = ?, audience = ?, materials = ?, status = ?, updated_at = ?
    WHERE date = ?
  `).run(
    weekdayForDate(dateKey),
    plan.topic,
    plan.type,
    plan.audience,
    plan.materials,
    plan.status,
    now(),
    dateKey
  );
  addActivity(`更新选题计划 ${dateKey}`, 'plan', dateKey, '用户');
  return one('SELECT * FROM weekly_plans WHERE date = ?', dateKey);
}

function createPlansRange(startDate, endDate, payload = {}) {
  const start = toDateKey(startDate || toDateKey());
  const end = toDateKey(endDate || start);
  const span = daySpan(start, end);
  if (Number.isNaN(span)) throw new Error('日期范围无效');
  if (span < 0) throw new Error('结束日期不能早于开始日期');
  if (span > 370) throw new Error('一次最多新增 371 天计划');

  const plan = cleanPlanPayload(payload);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO weekly_plans (date, weekday, topic, type, audience, materials, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let created = 0;
  for (let i = 0; i <= span; i++) {
    const dateKey = addDays(start, i);
    const result = insert.run(
      dateKey,
      weekdayForDate(dateKey),
      plan.topic,
      plan.type,
      plan.audience,
      plan.materials,
      plan.status,
      now()
    );
    created += result.changes;
  }
  addActivity(`批量新增 ${start} 至 ${end} 的选题计划`, 'plan', `${start}_${end}`, '用户');
  return {
    startDate: start,
    endDate: end,
    created,
    plans: rows('SELECT * FROM weekly_plans WHERE date BETWEEN ? AND ? ORDER BY date', start, end),
  };
}

function titleFromMarkdown(body, fallback = '未命名内容') {
  const raw = String(body || '');
  const heading = isHtmlBody(raw)
    ? raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    : raw.match(/^\s*#\s+(.+)$/m)?.[1];
  const cleanHeading = stripHtml(heading || '').trim();
  return cleanHeading || fallback;
}

const IMPORT_BLOCKED_CONTENT_ELEMENTS = ['head', 'script', 'style', 'iframe', 'object', 'template', 'noscript', 'svg'];
const IMPORT_ALLOWED_ELEMENTS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'section', 'article',
  'strong', 'em', 'b', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'figure', 'figcaption', 'img', 'a', 'br', 'hr',
]);
const IMPORT_VOID_ELEMENTS = new Set(['img', 'br', 'hr', 'col']);
const IMPORT_GLOBAL_ALLOWED_ATTRIBUTES = new Set(['title']);
const IMPORT_ALLOWED_ATTRIBUTES = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  code: new Set(['class', 'title']),
  ol: new Set(['start', 'reversed', 'title']),
  li: new Set(['value', 'title']),
  th: new Set(['align', 'colspan', 'rowspan', 'scope', 'title']),
  td: new Set(['align', 'colspan', 'rowspan', 'title']),
  col: new Set(['span', 'title']),
  colgroup: new Set(['span', 'title']),
};

function decodeImportedUrl(value) {
  let decoded = String(value || '');
  for (let i = 0; i < 3; i++) {
    const next = decoded
      .replace(/&#x([0-9a-f]+);?/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
      .replace(/&#([0-9]+);?/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
      .replace(/&(colon|tab|newline|amp);/gi, (_, name) => ({ colon: ':', tab: '\t', newline: '\n', amp: '&' })[name.toLowerCase()]);
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function isAllowedImportedUrl(value, attributeName) {
  const compact = decodeImportedUrl(value)
    .replace(/[\u0000-\u0020\u007f-\u009f]+/g, '')
    .toLowerCase();
  if (!compact) return false;

  const scheme = compact.match(/^([a-z][a-z0-9+.-]*):/)?.[1] || '';
  if (!scheme) return !compact.startsWith('\\');
  if (attributeName === 'href') return ['http', 'https', 'mailto', 'tel'].includes(scheme);
  if (attributeName !== 'src') return false;
  if (['http', 'https'].includes(scheme)) return true;
  return /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i.test(compact);
}

function isAllowedImportedAttribute(tagName, attributeName, attributeValue) {
  const allowed = IMPORT_ALLOWED_ATTRIBUTES[tagName] || IMPORT_GLOBAL_ALLOWED_ATTRIBUTES;
  if (!allowed.has(attributeName)) return false;
  if (attributeName === 'href' || attributeName === 'src') {
    return isAllowedImportedUrl(attributeValue, attributeName);
  }
  if (['width', 'height', 'colspan', 'rowspan', 'span'].includes(attributeName)) {
    return /^\d{1,5}$/.test(attributeValue);
  }
  if (['start', 'value'].includes(attributeName)) return /^-?\d+$/.test(attributeValue);
  if (attributeName === 'align') return /^(?:left|center|right)$/i.test(attributeValue);
  if (attributeName === 'scope') return /^(?:row|col|rowgroup|colgroup)$/i.test(attributeValue);
  if (attributeName === 'class') return /^language-[A-Za-z0-9_+-]+$/.test(attributeValue);
  return attributeName === 'reversed' || attributeName === 'title' || attributeName === 'alt';
}

function sanitizeImportedTag(tag) {
  const closing = tag.match(/^<\s*\/\s*([a-z][\w:-]*)[^>]*>$/i);
  if (closing) {
    const tagName = closing[1].toLowerCase();
    return IMPORT_ALLOWED_ELEMENTS.has(tagName) && !IMPORT_VOID_ELEMENTS.has(tagName) ? `</${tagName}>` : '';
  }

  const opening = tag.match(/^<\s*([a-z][\w:-]*)([\s\S]*?)(\/?)>$/i);
  if (!opening) return '';
  const [, rawTagName, rawAttributes] = opening;
  const tagName = rawTagName.toLowerCase();
  if (!IMPORT_ALLOWED_ELEMENTS.has(tagName)) return '';

  const attributePattern = /\s+([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const safeAttributes = [];
  const seenAttributes = new Set();
  for (const match of rawAttributes.matchAll(attributePattern)) {
    const attributeName = match[1].toLowerCase();
    const attributeValue = match[2] ?? match[3] ?? match[4] ?? '';
    if (seenAttributes.has(attributeName)
      || !isAllowedImportedAttribute(tagName, attributeName, attributeValue)) continue;
    seenAttributes.add(attributeName);
    safeAttributes.push(match[0].trim());
  }
  return `<${tagName}${safeAttributes.length ? ` ${safeAttributes.join(' ')}` : ''}>`;
}

function sanitizeImportedHtml(value) {
  let sanitized = String(value || '');
  for (const tagName of IMPORT_BLOCKED_CONTENT_ELEMENTS) {
    const pairedElement = new RegExp(`<\\s*${tagName}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${tagName}\\s*>`, 'gi');
    let previous;
    do {
      previous = sanitized;
      sanitized = sanitized.replace(pairedElement, '');
    } while (sanitized !== previous);
  }
  return sanitized.replace(/<!--[\s\S]*?-->|<[^>]*>/g, sanitizeImportedTag);
}

function readableImportedText(value) {
  const markdownWithoutSyntax = String(value || '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]*|[-+*][ \t]+|\d+[.)][ \t]+)/gm, '')
    .replace(/```[^\n]*|~~|[*_`]/g, '');
  return stripHtml(markdownWithoutSyntax).replace(/\s+/g, ' ').trim();
}

function importedHtmlDetectionProbe(body) {
  const mask = literal => literal.replace(/[^\r\n]/g, ' ');
  let probe = protectImportedFencedCode(body, mask);
  probe = protectImportedIndentedCode(probe, mask);
  probe = protectImportedInlineCode(probe, mask);
  return replaceImportedMarkdownAutolinks(probe, mask, mask);
}

function protectImportedFencedCode(body, protect) {
  const source = String(body || '');
  const linePattern = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  let output = '';
  let cursor = 0;
  let fenceStart = -1;
  let fenceCharacter = '';
  let fenceLength = 0;
  let match;

  while ((match = linePattern.exec(source))) {
    const fullLine = match[0];
    if (!fullLine) break;
    const line = fullLine.replace(/(?:\r\n|\r|\n)$/, '');

    if (fenceStart === -1) {
      const openingFence = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
      if (!openingFence) continue;
      fenceStart = match.index;
      fenceCharacter = openingFence[1][0];
      fenceLength = openingFence[1].length;
      continue;
    }

    const closingFence = line.match(/^[ \t]{0,3}(`+|~+)[ \t]*$/);
    if (!closingFence
      || closingFence[1][0] !== fenceCharacter
      || closingFence[1].length < fenceLength) continue;

    const fenceEnd = match.index + fullLine.length;
    output += source.slice(cursor, fenceStart);
    output += protect(source.slice(fenceStart, fenceEnd));
    cursor = fenceEnd;
    fenceStart = -1;
    fenceCharacter = '';
    fenceLength = 0;
  }

  if (fenceStart !== -1) {
    output += source.slice(cursor, fenceStart);
    output += protect(source.slice(fenceStart));
    cursor = source.length;
  }
  return output + source.slice(cursor);
}

function protectImportedIndentedCode(body, protect) {
  return String(body || '').replace(/^(?: {4}|\t)[^\r\n]*(?:\r\n|\r|\n|$)/gm, protect);
}

function protectImportedInlineCode(body, protect) {
  const source = String(body || '');
  let output = '';
  let cursor = 0;
  let index = 0;

  while (index < source.length) {
    if (source[index] !== '`') {
      index++;
      continue;
    }
    let openingEnd = index + 1;
    while (source[openingEnd] === '`') openingEnd++;
    const markerLength = openingEnd - index;
    let searchIndex = openingEnd;
    let closingEnd = -1;

    while (searchIndex < source.length) {
      const closingStart = source.indexOf('`', searchIndex);
      if (closingStart === -1) break;
      let runEnd = closingStart + 1;
      while (source[runEnd] === '`') runEnd++;
      if (runEnd - closingStart === markerLength) {
        closingEnd = runEnd;
        break;
      }
      searchIndex = runEnd;
    }

    if (closingEnd === -1) {
      index = openingEnd;
      continue;
    }
    output += source.slice(cursor, index);
    output += protect(source.slice(index, closingEnd));
    cursor = closingEnd;
    index = closingEnd;
  }
  return output + source.slice(cursor);
}

function replaceImportedMarkdownAutolinks(body, replaceSafe, replaceDangerous) {
  const markdownAutolink = /<(?:[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\u0000-\u0020\u007f]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/g;
  const dangerousSchemes = new Set(['javascript', 'data', 'vbscript']);
  return String(body || '').replace(markdownAutolink, autolink => {
    const scheme = autolink.match(/^<([A-Za-z][A-Za-z0-9.+-]{1,31}):/)?.[1].toLowerCase();
    return scheme && dangerousSchemes.has(scheme)
      ? replaceDangerous(autolink)
      : replaceSafe(autolink);
  });
}

function containsImportedHtml(body) {
  return /<\s*\/?\s*(?:html|head|title|body|article|section|main|aside|nav|header|footer|div|p|h[1-6]|table|caption|colgroup|col|thead|tbody|tfoot|tr|th|td|ul|ol|li|blockquote|figure|figcaption|pre|code|strong|em|b|i|u|s|a|img|br|hr|form|input|button|select|option|textarea|dialog|details|summary|video|audio|source|canvas|style|script|iframe|object|embed|meta|link|base|template|svg)\b/i.test(String(body || ''));
}

function importedContentFormat(filename, body, format) {
  const requested = String(format || '').trim().toLowerCase();
  const extension = path.extname(String(filename || '')).toLowerCase();
  if (['.html', '.htm'].includes(extension)) return 'html';
  if (extension === '.txt') return 'text';
  if (['.md', '.markdown'].includes(extension)) return 'markdown';
  if (requested === 'html') return 'html';
  if (['text', 'txt', 'plain', 'plain-text'].includes(requested)) return 'text';
  if (['markdown', 'md'].includes(requested)) return 'markdown';

  const source = String(body || '').replace(/^\uFEFF/, '');
  const probe = importedHtmlDetectionProbe(source).replace(/^\uFEFF/, '').trimStart();
  if (/^<!doctype\s+html\b/i.test(probe) || /^<html[\s>]/i.test(probe)) return 'html';
  if (containsImportedHtml(probe)) return 'mixed';
  if (/^[ \t]{0,3}(?:#{1,6}[ \t]+|>|[-+*][ \t]+|`{3,}|~{3,})/m.test(source)
    || /(?:!?)\[[^\]]*\]\([^)]+\)/.test(source)
    || /`[^`\r\n]+`/.test(source)
    || /^(?: {4}|\t)\S/m.test(source)) return 'markdown';
  return 'text';
}

function normalizeCanonicalBody(value) {
  const source = String(value || '');
  if (!source.trim()) return '';
  if (containsImportedHtml(importedHtmlDetectionProbe(source))) {
    return sanitizeImportedHtml(source).trim();
  }
  const format = importedContentFormat('', source, '');
  if (format === 'html') return sanitizeImportedHtml(source).trim();
  if (format === 'markdown' || format === 'mixed') {
    return sanitizeImportedHtml(markdownToHtml(source, { imported: true })).trim();
  }
  return sanitizeImportedHtml(textToImportedHtml(source)).trim();
}

function importedHtmlMetadataProbe(body) {
  let probe = String(body || '').replace(/<!--[\s\S]*?-->/g, '');
  for (const tagName of IMPORT_BLOCKED_CONTENT_ELEMENTS) {
    if (tagName === 'head') continue;
    const pairedElement = new RegExp(`<\\s*${tagName}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${tagName}\\s*>`, 'gi');
    let previous;
    do {
      previous = probe;
      probe = probe.replace(pairedElement, '');
    } while (probe !== previous);
  }
  return probe.replace(/<\s*\/?\s*(?:meta|link|base)\b[^>]*>/gi, '');
}

function importedMarkdownMetadataProbe(body) {
  let probe = String(body || '').replace(/<!--[\s\S]*?-->/g, '');
  const blockedBlocks = [...IMPORT_BLOCKED_CONTENT_ELEMENTS, 'embed', 'meta', 'link', 'base', 'pre', 'code'];
  for (const tagName of blockedBlocks) {
    const pairedElement = new RegExp(`<\\s*${tagName}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${tagName}\\s*>`, 'gi');
    let previous;
    do {
      previous = probe;
      probe = probe.replace(pairedElement, '');
    } while (probe !== previous);
  }
  probe = probe.replace(/<\s*\/?\s*(?:embed|meta|link|base)\b[^>]*>/gi, '');
  return importedHtmlDetectionProbe(probe);
}

function titleFromImportedBody(body, filename = '', format = 'text', fallback = '未命名文章') {
  const raw = String(body || '');
  const markdownProbe = importedMarkdownMetadataProbe(raw);
  const htmlProbe = importedHtmlMetadataProbe(raw);
  const markdownHeading = markdownProbe.match(/^[ \t]{0,3}#[ \t]+(.+?)[ \t]*#*[ \t]*$/m)?.[1];
  const htmlTitle = htmlProbe.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1];
  const htmlHeading = htmlProbe.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i)?.[1];
  const firstPlainLine = raw.split(/\r?\n/).map(line => line.trim()).find(Boolean);
  const readableSource = format === 'html' ? htmlProbe : markdownProbe;
  const firstReadableLine = readableSource.split(/\r?\n/)
    .map(line => {
      const markdownImage = line.match(/^[ \t]*!\[([^\]]*)\]\([^)]+\)[ \t]*$/);
      return stripHtml(markdownImage ? markdownImage[1] : line).trim();
    })
    .find(Boolean);
  const filenameTitle = path.basename(String(filename || '').trim())
    .replace(/\.(?:md|markdown|html?|txt)$/i, '');

  if (format === 'text' && firstPlainLine) return firstPlainLine;
  const candidates = format === 'html'
    ? [htmlTitle, htmlHeading, firstReadableLine]
    : (format === 'mixed'
      ? [htmlTitle, htmlHeading, markdownHeading, firstReadableLine]
      : [markdownHeading, htmlTitle, htmlHeading, firstReadableLine]);
  for (const candidate of [...candidates, filenameTitle]) {
    const title = stripHtml(candidate || '').trim();
    if (title) return title;
  }
  return fallback;
}

function validateImportPayload(payload) {
  const prototype = payload && typeof payload === 'object' ? Object.getPrototypeOf(payload) : null;
  if (payload === null
    || typeof payload !== 'object'
    || Array.isArray(payload)
    || (prototype !== Object.prototype && prototype !== null)) {
    throw statusError('导入请求必须是 JSON 对象', 400);
  }
  for (const field of ['title', 'body', 'summary', 'type', 'filename', 'format']) {
    if (Object.prototype.hasOwnProperty.call(payload, field) && typeof payload[field] !== 'string') {
      throw statusError(`导入字段 ${field} 必须是字符串`, 400);
    }
  }
  return payload;
}

function importContent(payload) {
  const input = validateImportPayload(payload);
  const rawBody = input.body ?? '';
  if (!rawBody.trim()) throw statusError('导入正文不能为空', 400);
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_IMPORTED_BODY_BYTES) {
    throw statusError('导入正文不能超过 5 MiB', 400);
  }
  const filename = (input.filename ?? '').trim();
  if (filename && !/\.(?:md|markdown|html|htm|txt)$/i.test(filename)) {
    throw statusError('文件格式不支持，仅支持 .md、.markdown、.html、.htm、.txt', 415);
  }
  const trimmedBody = rawBody.trim();
  const format = importedContentFormat(filename, trimmedBody, input.format);
  const title = (input.title || '').trim()
    || titleFromImportedBody(trimmedBody, filename, format);
  let body;
  if (format === 'html') {
    body = sanitizeImportedHtml(trimmedBody).trim();
  } else if (format === 'markdown' || format === 'mixed') {
    body = sanitizeImportedHtml(markdownToHtml(trimmedBody, { imported: true })).trim();
  } else {
    body = sanitizeImportedHtml(textToImportedHtml(trimmedBody)).trim();
  }
  if (!body.trim()) throw statusError('导入正文不能为空', 400);
  const summary = (input.summary ?? '').trim()
    || Array.from(readableImportedText(body)).slice(0, 120).join('');
  const type = (input.type ?? '').trim() || '导入文章';
  const contentId = makeId('content');
  const timestamp = now();
  return runTransaction(() => {
    db.prepare(`
      INSERT INTO contents
        (id, title, summary, body, type, plan_date, status, layout_html, images, selected_platforms, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, '已导入', '', ?, ?, ?, ?)
    `).run(
      contentId,
      title,
      summary,
      body,
      type,
      encodeJson([]),
      encodeJson([]),
      timestamp,
      timestamp
    );
    addActivity(`导入文章《${title}》`, 'content', contentId, '用户');
    const content = normalizeContent(one('SELECT * FROM contents WHERE id = ?', contentId));
    if (!content) throw new Error('导入内容读取失败');
    return content;
  });
}

function validateContentUpdatePayload(payload) {
  const prototype = payload && typeof payload === 'object' ? Object.getPrototypeOf(payload) : null;
  if (payload === null
    || typeof payload !== 'object'
    || Array.isArray(payload)
    || (prototype !== Object.prototype && prototype !== null)) {
    throw statusError('内容更新请求必须是 JSON 对象', 400);
  }
  for (const field of ['title', 'summary', 'body', 'type', 'expectedUpdatedAt']) {
    if (Object.prototype.hasOwnProperty.call(payload, field) && typeof payload[field] !== 'string') {
      throw statusError(`内容更新字段 ${field} 必须是字符串`, 400);
    }
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'expectedUpdatedAt') || !payload.expectedUpdatedAt) {
    throw statusError('expectedUpdatedAt 必须是非空字符串', 400);
  }
  validateContentFieldLimits(payload);
  return payload;
}

function validateContentFieldLimits(fields) {
  if (typeof fields.title === 'string'
    && Array.from(fields.title).length > MAX_CONTENT_TITLE_CHARACTERS) {
    throw statusError(`标题不能超过 ${MAX_CONTENT_TITLE_CHARACTERS} 个 Unicode 字符`, 400);
  }
  if (typeof fields.summary === 'string'
    && Array.from(fields.summary).length > MAX_CONTENT_SUMMARY_CHARACTERS) {
    throw statusError(`摘要不能超过 ${MAX_CONTENT_SUMMARY_CHARACTERS} 个 Unicode 字符`, 400);
  }
  if (typeof fields.type === 'string'
    && Array.from(fields.type).length > MAX_CONTENT_TYPE_CHARACTERS) {
    throw statusError(`类型不能超过 ${MAX_CONTENT_TYPE_CHARACTERS} 个 Unicode 字符`, 400);
  }
  if (typeof fields.body === 'string'
    && Buffer.byteLength(fields.body, 'utf8') > MAX_CONTENT_BODY_BYTES) {
    throw statusError('正文不能超过 5 MiB', 413);
  }
}

function validateExpectedUpdatedAt(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw statusError('expectedUpdatedAt 必须是非空字符串', 400);
  }
  return value;
}

function updateContent(contentId, payload = {}) {
  const input = validateContentUpdatePayload(payload);
  return runTransaction(() => {
    const storedContent = one('SELECT * FROM contents WHERE id = ?', contentId);
    const content = normalizeContent(storedContent);
    if (!content) throw new Error('内容不存在');
    const body = normalizeCanonicalBody(input.body ?? content.body ?? '');
    const title = (input.title || '').trim() || titleFromMarkdown(body, content.title);
    const summary = (input.summary ?? content.summary ?? '').trim();
    const type = (input.type ?? content.type ?? '').trim();
    validateContentFieldLimits({ title, summary, body, type });
    const canonicalChanged = title !== storedContent.title
      || summary !== (storedContent.summary ?? '')
      || body !== storedContent.body
      || type !== (storedContent.type ?? '');
    const status = canonicalChanged ? (content.plan_date ? '正文已生成' : '已导入') : content.status;
    const layoutHtml = canonicalChanged ? '' : (content.layout_html ?? '');
    const mutation = updateContentRowWithMonotonicTimestamp(
      contentId,
      'title = ?, summary = ?, body = ?, type = ?, status = ?, layout_html = ?',
      [title, summary, body, type, status, layoutHtml],
      { expectedUpdatedAt: input.expectedUpdatedAt }
    );
    if (mutation.changes === 0) {
      throw statusError('文章已在其他位置更新，请重新加载最新版本', 409);
    }
    if (content.plan_date) {
      if (canonicalChanged) {
        db.prepare("UPDATE weekly_plans SET topic = ?, type = ?, status = '正文已生成', updated_at = ? WHERE date = ?")
          .run(title, type, mutation.updatedAt, content.plan_date);
      } else {
        db.prepare('UPDATE weekly_plans SET topic = ?, type = ?, updated_at = ? WHERE date = ?')
          .run(title, type, mutation.updatedAt, content.plan_date);
      }
    }
    addActivity(`更新正文《${title}》`, 'content', contentId, '用户');
    const updated = normalizeContent(one('SELECT * FROM contents WHERE id = ?', contentId));
    if (!updated) throw new Error('更新内容读取失败');
    return updated;
  });
}

function generateContent(planDate, explicitTopic) {
  const plan = planDate ? one('SELECT * FROM weekly_plans WHERE date = ?', planDate) : null;
  const title = explicitTopic || plan?.topic || '新的内容主题';
  const type = plan?.type || '行业分析';
  const audience = plan?.audience || '内容运营';
  const materials = plan?.materials || '本地素材库';
  const contentId = makeId('content');
  const body = buildArticleBody(title, type, audience, materials);
  db.prepare(`
    INSERT INTO contents
      (id, title, summary, body, type, plan_date, status, layout_html, images, selected_platforms, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '正文已生成', '', ?, ?, ?, ?)
  `).run(
    contentId,
    title,
    `围绕「${title}」生成的 V1.0 示例正文，可进入内容中心继续编辑和排版。`,
    body,
    type,
    planDate || null,
    encodeJson(sampleImages()),
    encodeJson(DEFAULT_SELECTED_PLATFORMS),
    now(),
    now()
  );
  if (planDate) {
    db.prepare("UPDATE weekly_plans SET status = '正文已生成', content_id = ?, updated_at = ? WHERE date = ?")
      .run(contentId, now(), planDate);
  }
  addActivity(`生成正文《${title}》`, 'content', contentId);
  return normalizeContent(one('SELECT * FROM contents WHERE id = ?', contentId));
}

function layoutContent(contentId, template, expectedUpdatedAt) {
  const templateProvided = template !== undefined || arguments.length === 2;
  if (templateProvided && (typeof template !== 'string' || !template.trim())) {
    throw statusError('template 必须是非空字符串', 400);
  }
  const expectedRevision = validateExpectedUpdatedAt(expectedUpdatedAt);
  return runTransaction(() => {
    const content = normalizeContent(one('SELECT * FROM contents WHERE id = ?', contentId));
    if (!content) throw new Error('内容不存在');
    if (content.updated_at !== expectedRevision) {
      throw statusError('文章已在其他标签页更新，请重新加载最新版本', 409);
    }
    const html = templateProvided
      ? renderLayoutTemplate(template, {
        title: content.title,
        summary: content.summary || '',
        body: content.body,
      })
      : buildLayoutHtml(content.title, content.body);
    const mutation = updateContentRowWithMonotonicTimestamp(
      contentId,
      "layout_html = ?, status = '已排版'",
      [html],
      { expectedUpdatedAt: expectedRevision }
    );
    if (mutation.changes === 0) throw statusError('文章已被更新，请重新生成排版', 409);
    if (content.plan_date) {
      db.prepare("UPDATE weekly_plans SET status = '已排版', updated_at = ? WHERE date = ?")
        .run(mutation.updatedAt, content.plan_date);
    }
    addActivity(`完成排版预览《${content.title}》`, 'content', contentId);
    const updated = normalizeContent(one('SELECT * FROM contents WHERE id = ?', contentId));
    if (!updated) throw new Error('排版内容读取失败');
    return updated;
  });
}

function saveLocalDraft(contentId, platforms = [], expectedUpdatedAt) {
  const expectedRevision = validateExpectedUpdatedAt(expectedUpdatedAt);
  return runTransaction(() => {
    const content = normalizeContent(one('SELECT * FROM contents WHERE id = ?', contentId));
    if (!content) throw new Error('内容不存在');
    if (content.updated_at !== expectedRevision) {
      throw statusError('文章已在其他标签页更新，请重新加载最新版本', 409);
    }
    const selected = (Array.isArray(platforms) ? platforms : content.selected_platforms)
      .map(platform => String(platform || '').trim().toLowerCase())
      .filter(platform => platform && !RETIRED_PLATFORM_IDS.includes(platform));
    const mutation = updateContentRowWithMonotonicTimestamp(
      contentId,
      "status = '草稿已保存', selected_platforms = ?",
      [encodeJson(selected)],
      { expectedUpdatedAt: expectedRevision }
    );
    if (mutation.changes === 0) throw statusError('文章已被更新，请重新保存草稿', 409);
    if (content.plan_date) {
      db.prepare("UPDATE weekly_plans SET status = '草稿已保存', updated_at = ? WHERE date = ?")
        .run(mutation.updatedAt, content.plan_date);
    }

    const jobId = makeId('job');
    db.prepare(`
      INSERT INTO publish_jobs (id, content_id, title, status, platforms, created_at, updated_at)
      VALUES (?, ?, ?, 'local_draft', ?, ?, ?)
    `).run(jobId, contentId, content.title, encodeJson(selected), now(), now());
    for (const platform of selected) {
      db.prepare(`
        INSERT INTO publish_results (id, job_id, platform, status, message, created_at)
        VALUES (?, ?, ?, 'local_draft', '已保存到内容中心草稿，等待一键发布', ?)
      `).run(makeId('res'), jobId, platform, now());
    }
    addActivity(`保存本地草稿《${content.title}》`, 'content', contentId, '运营');
    const job = normalizeJob(one('SELECT * FROM publish_jobs WHERE id = ?', jobId));
    const updatedContent = normalizeContent(one('SELECT * FROM contents WHERE id = ?', contentId));
    if (!job || !updatedContent) throw new Error('草稿结果读取失败');
    return { job, content: updatedContent, sourceUpdatedAt: expectedRevision };
  });
}

function contentToMarkdown(content) {
  const title = String(content.title || '');
  const body = removeMatchingLeadingH1(contentBodyToMarkdown(content.body), title);
  const headingTitle = encodeMarkdownHeadingDisplay(title);
  const encodedTitle = encodeExactJsonTitle(title);
  return `---\ntitle: ${encodedTitle}\npublisher-title-json-v1: ${encodedTitle}\n---\n\n# ${headingTitle}\n\n${body}\n`;
}

function hashSource(source) {
  return createHash('sha256').update(source).digest('hex');
}

function hashFile(filePath) {
  return hashSource(fs.readFileSync(filePath));
}

function layoutHash(html) {
  return String(html || '').match(
    /\bdata-canonical-sha256\s*=\s*(["'])([a-f0-9]{64})\1/i
  )?.[2].toLowerCase() || '';
}

function selectPlatformSourcePayload(content, platform) {
  const platformId = String(platform || '').trim().toLowerCase();
  if (!platformId) throw new Error('平台源缺少平台 ID');
  const canonicalMarkdown = contentToMarkdown(content);
  const useLayout = platformId === 'weixin'
    && layoutHash(content?.layout_html) === canonicalContentHash(content);
  const sourceContent = useLayout ? String(content.layout_html) : canonicalMarkdown;
  const format = useLayout ? 'html' : 'markdown';
  return {
    platform: platformId,
    format,
    extension: format === 'html' ? 'html' : 'md',
    content: sourceContent,
    contentHash: hashSource(sourceContent),
    templated: useLayout,
    warnings: platformId === 'weixin' && !useLayout ? ['尚未使用公众号模板'] : [],
  };
}

function writePlatformSourceFile(rootDir, basename, payload) {
  const safeBasename = String(basename || '');
  if (!/^[A-Za-z0-9_-]+$/.test(safeBasename)) throw new Error('平台源文件名无效');
  if (!payload || typeof payload !== 'object' || !['html', 'md'].includes(payload.extension)) {
    throw new Error('平台源载荷无效');
  }
  const filePath = path.join(path.resolve(rootDir), `${safeBasename}.${payload.extension}`);
  fs.writeFileSync(filePath, String(payload.content || ''), 'utf8');
  return {
    ...payload,
    filePath,
    contentHash: hashFile(filePath),
  };
}

function createPlatformSource(content, platform, rootDir, options = {}) {
  const payload = selectPlatformSourcePayload(content, platform);
  const basename = options.basename === undefined ? payload.platform : options.basename;
  return writePlatformSourceFile(rootDir, basename, payload);
}

function encodeExactJsonTitle(value) {
  return JSON.stringify(String(value || ''))
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function normalizeVisibleTitle(value) {
  return String(value || '')
    .toWellFormed()
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .normalize('NFC');
}

function encodeMarkdownHeadingDisplay(value) {
  return normalizeVisibleTitle(value).replace(
    /[^\p{L}\p{N} ]/gu,
    character => `&#${character.codePointAt(0)};`
  );
}

function renderedMarkdownVisibleText(tokens) {
  const rendered = Parser.parseInline(tokens || [], {
    async: false,
    gfm: true,
    renderer: canonicalMarkdownRenderer,
  });
  const { document } = parseHTML('<!doctype html><html><body></body></html>');
  document.body.innerHTML = rendered;
  return document.body.textContent;
}

function removeMatchingLeadingH1(markdown, title) {
  const source = String(markdown || '');
  const tokens = marked.lexer(source, { gfm: true });
  let offset = 0;
  for (const token of tokens) {
    if (token.type === 'space') {
      offset += token.raw.length;
      continue;
    }
    if (token.type !== 'heading' || token.depth !== 1) return source;
    const visibleHeading = normalizeVisibleTitle(renderedMarkdownVisibleText(token.tokens));
    if (visibleHeading !== normalizeVisibleTitle(title)) return source;
    return source.slice(0, offset) + source.slice(offset + token.raw.length);
  }
  return source;
}

function previewApiError(message, statusCode, apiCode) {
  const error = statusError(message, statusCode);
  error.apiCode = apiCode;
  return error;
}

const PREVIEW_ERROR_MESSAGES = {
  timeout: '平台预览超时，请重试',
  unavailable: '平台预览服务尚未构建，请先运行 npm run build',
  failed: '平台预览失败，请重试',
  invalidResponse: '平台预览结果无效，请重试',
};

function isPreviewTimeout(error) {
  const code = String(error?.code || '').toUpperCase();
  return error?.killed === true
    || code === 'ETIMEDOUT'
    || code === 'ERR_CHILD_PROCESS_TIMEOUT';
}

function isPreviewCliUnavailable(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '');
  return code === 'ENOENT'
    || code === 'MODULE_NOT_FOUND'
    || /CLI\s+尚未构建|Cannot find module.+packages[\\/]cli[\\/]dist/i.test(message);
}

function mapPreviewExecutionError(error) {
  if (isPreviewTimeout(error)) {
    return previewApiError(PREVIEW_ERROR_MESSAGES.timeout, 504, 'PREVIEW_TIMEOUT');
  }
  if (isPreviewCliUnavailable(error)) {
    return previewApiError(
      PREVIEW_ERROR_MESSAGES.unavailable,
      503,
      'PREVIEW_CLI_UNAVAILABLE'
    );
  }
  return previewApiError(
    PREVIEW_ERROR_MESSAGES.failed,
    502,
    'PREVIEW_CLI_FAILED'
  );
}

function validatePlatformPreviewResult(preview, platformId) {
  const validFormats = new Set(['html', 'markdown', 'text']);
  const valid = preview
    && typeof preview === 'object'
    && !Array.isArray(preview)
    && preview.platform === platformId
    && typeof preview.title === 'string'
    && preview.title.trim().length > 0
    && validFormats.has(preview.format)
    && typeof preview.content === 'string'
    && typeof preview.htmlPreview === 'string'
    && Number.isInteger(preview.imageCount)
    && preview.imageCount >= 0
    && Array.isArray(preview.warnings)
    && preview.warnings.every(warning => typeof warning === 'string')
    && (preview.limits === undefined
      || (preview.limits !== null && typeof preview.limits === 'object' && !Array.isArray(preview.limits)));
  if (!valid) {
    throw previewApiError(
      PREVIEW_ERROR_MESSAGES.invalidResponse,
      502,
      'PREVIEW_INVALID_RESPONSE'
    );
  }
  return preview;
}

async function previewContentForPlatform(contentId, platform, options = {}) {
  const content = normalizeContent(one('SELECT * FROM contents WHERE id = ?', contentId));
  if (!content) throw statusError('内容不存在', 404);

  const platformId = String(platform || '').trim().toLowerCase();
  if (!platformId) throw statusError('缺少平台参数', 400);
  const knownPlatform = one('SELECT id FROM platforms WHERE id = ?', platformId);
  if (!knownPlatform || RETIRED_PLATFORM_IDS.includes(platformId)) {
    throw statusError(`平台不存在: ${platformId}`, 400);
  }

  const tempRoot = path.resolve(options.tempRoot || os.tmpdir());
  const previewDir = fs.mkdtempSync(path.join(tempRoot, 'publisher-dashboard-preview-'));
  try {
    const source = createPlatformSource(content, platformId, previewDir, { basename: 'content' });

    const runner = options.runner || runWeibotCli;
    let result;
    try {
      result = await runner(['preview', source.filePath, '-p', platformId], options.timeout || 30000);
    } catch (error) {
      throw mapPreviewExecutionError(error);
    }
    if (result && typeof result === 'object'
      && (result.error || (result.code !== undefined && result.code !== 0))) {
      const executionError = result.error || {
        code: result.code,
      };
      throw mapPreviewExecutionError(executionError);
    }

    const stdout = typeof result === 'string'
      ? result
      : (typeof result?.stdout === 'string' ? result.stdout : result?.output);
    const cleanOutput = String(stdout || '').trim();
    const lines = cleanOutput ? cleanOutput.split(/\r?\n/) : [];
    if (lines.length !== 1) {
      throw previewApiError(
        PREVIEW_ERROR_MESSAGES.invalidResponse,
        502,
        'PREVIEW_INVALID_RESPONSE'
      );
    }

    let preview;
    try {
      preview = JSON.parse(lines[0]);
    } catch {
      throw previewApiError(
        PREVIEW_ERROR_MESSAGES.invalidResponse,
        502,
        'PREVIEW_INVALID_RESPONSE'
      );
    }
    const validated = validatePlatformPreviewResult(preview, platformId);
    return {
      ...validated,
      warnings: [...new Set([...validated.warnings, ...source.warnings])],
    };
  } finally {
    fs.rmSync(previewDir, { recursive: true, force: true });
  }
}

function readPlatformSessionFile(platform) {
  const platformId = String(platform || '').trim().toLowerCase();
  if (!platformId) return null;
  const file = path.join(LOGIN_DIR, platformId, 'session.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function defaultPlatformOpenUrl(platform) {
  if (platform === 'douyin') return 'https://creator.douyin.com/creator-micro/content/manage';
  if (platform === 'toutiao') return 'https://mp.toutiao.com/profile_v4/manage/content/all';
  if (platform === 'xiaohongshu') return 'https://creator.xiaohongshu.com/publish/publish?source=official';
  if (platform === 'qiehao') return 'https://om.qq.com/main/creation/article';
  if (platform === 'ca800') return 'http://www.ca800.com/c/Info/articleInfo.aspx';
  if (platform === 'b2b168') return 'https://m.b2b168.com/index.aspx?pg=glNews&t=0';
  if (platform === 'app17') return 'https://user.app17.com/user.aspx?article/articleedit';
  if (platform === 'huangye88') return 'https://fabuxinxi.huangye88.com/';
  if (platform === '51sole') return 'https://user.51sole.com/user/web/send_information.aspx';
  if (platform === 'weixin') return 'https://mp.weixin.qq.com/';
  return LOGIN_PLATFORMS[platform]?.loginUrl || null;
}

function assertPlatformUrl(platform, targetUrl) {
  const config = LOGIN_PLATFORMS[platform];
  if (!config) throw new Error(`暂不支持使用平台会话打开: ${platform}`);
  const parsed = new URL(targetUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只能打开 http/https 链接');
  const allowed = config.domains.some(domain => domainMatches(parsed.hostname, domain));
  if (!allowed) throw new Error(`链接域名不属于 ${config.name}: ${parsed.hostname}`);
}

async function isCdpAlive(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

async function openInPlatformSession(platform, targetUrl) {
  const platformId = String(platform || '').trim().toLowerCase();
  const session = readPlatformSessionFile(platformId);
  const url = targetUrl || defaultPlatformOpenUrl(platformId);
  if (!url) throw new Error('缺少要打开的链接');
  assertPlatformUrl(platformId, url);
  if (!session?.browserPath || !session?.port || !session?.userDataDir) {
    throw new Error(`请先在“平台登录”里登录 ${LOGIN_PLATFORMS[platformId]?.name || platformId}`);
  }
  if (!fs.existsSync(session.userDataDir)) {
    throw new Error(`平台登录目录不存在，请重新登录 ${LOGIN_PLATFORMS[platformId]?.name || platformId}`);
  }

  if (await isCdpAlive(session.port)) {
    const created = await fetch(`http://127.0.0.1:${session.port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    if (!created.ok) throw new Error(`无法在平台会话里打开链接: HTTP ${created.status}`);
  } else {
    const child = spawn(session.browserPath, [
      `--remote-debugging-port=${session.port}`,
      `--user-data-dir=${session.userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--new-window',
      url,
    ], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    await waitForJson(`http://127.0.0.1:${session.port}/json/version`, 20000);
  }

  return {
    platform: platformId,
    url,
    port: session.port,
    userDataDir: session.userDataDir,
  };
}

async function browserSessionFailureForPublish(platform) {
  if (!INTERACTIVE_AUTH_PLATFORMS.has(platform)) return null;
  const config = LOGIN_PLATFORMS[platform];
  const session = readPlatformSessionFile(platform);
  const name = config?.name || platform;
  if (!session?.port || !session?.userDataDir) {
    setPlatformAuthStatus(platform, 'logged_out');
    return `${name} 登录会话不存在，请先在“平台登录”里重新登录`;
  }
  if (!fs.existsSync(session.userDataDir)) {
    setPlatformAuthStatus(platform, 'logged_out');
    return `${name} 登录目录不存在，请先在“平台登录”里重新登录`;
  }

  if (platform === 'douyin') {
    const stableDir = path.resolve(LOGIN_DIR, 'douyin');
    const sessionDir = path.resolve(session.userDataDir);
    if (sessionDir === stableDir || session.port === 9333) {
      return '检测到抖音仍在使用旧登录会话，可能会发到错误账号。请在“平台登录”里重新登录抖音后再发布';
    }
  }

  // CDP 平台的登录检查有时会被页面加载、验证码弹层或后台接口拖慢。
  // 发布前这里只校验会话存在，把最终登录态判断交给对应平台 adapter，
  // 避免正常登录的浏览器会话因为 auth 超时被误判为未登录。
  return null;
}

async function publishOnePlatform(markdownFile, platform, title, publishMode = 'direct') {
  const args = ['sync', markdownFile, '-p', platform, '-t', title];
  if (publishMode === 'direct') args.push('--direct');
  const result = await runWeibotCli(args, 180000);
  const parsed = parseSyncResults(result.output);
  const parsedKeys = Object.keys(parsed);
  const info = parsed[platform] || (parsedKeys.length === 1 ? parsed[parsedKeys[0]] : null);
  return {
    output: result.output,
    info: info || {
      status: 'failed',
      error: stripAnsi(result.output).trim() || `CLI 没有返回 ${platform} 发布结果`,
    },
  };
}

function normalizeStoredPublishResult(platform, info) {
  if (platform === 'weixin' && info.status === 'success') {
    return {
      ...info,
      url: 'https://mp.weixin.qq.com/',
      message: '已保存到微信公众号草稿箱。公众号编辑链接带临时 token，容易登录超时，请在已登录的公众号后台草稿箱查看。',
    };
  }
  return info;
}

function publishSnapshotName(jobId, contentId, platform = '', extension = 'md') {
  const safeIdPattern = /^[A-Za-z0-9_-]+$/;
  const job = String(jobId || '');
  const content = String(contentId || '');
  const platformId = String(platform || '');
  const sourceExtension = String(extension || '');
  if (!safeIdPattern.test(job)
    || !safeIdPattern.test(content)
    || (platformId && !safeIdPattern.test(platformId))
    || !/^(?:md|html|txt)$/.test(sourceExtension)) {
    throw new Error('发布快照 ID 无效');
  }
  return `${job}-${content}${platformId ? `-${platformId}` : ''}.${sourceExtension}`;
}

function normalizePublishPlatforms(content, platforms) {
  return [...new Set((Array.isArray(platforms) && platforms.length ? platforms : content?.selected_platforms || [])
    .map(platform => String(platform || '').trim().toLowerCase())
    .filter(platform => platform && !RETIRED_PLATFORM_IDS.includes(platform)))];
}

function validatePublishOperationId(operationId) {
  if (typeof operationId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(operationId)) {
    throw statusError('operationId 必须是 16-128 位字母、数字、下划线或连字符', 400);
  }
  return operationId;
}

function immutableSnapshot(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(item => immutableSnapshot(item)));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, immutableSnapshot(item)])
    ));
  }
  return value;
}

function buildPublishOperationSignature(content, platforms, publishMode, expectedUpdatedAt = '') {
  const normalizedPlatforms = [...new Set((Array.isArray(platforms) ? platforms : [])
    .map(platform => String(platform || '').trim().toLowerCase())
    .filter(Boolean))].sort();
  const platformSourceHashes = normalizedPlatforms.map(platform => {
    const source = selectPlatformSourcePayload(content, platform);
    return [platform, source.format, source.contentHash];
  });
  return normalizeOperationSignature({
    contentId: content.id,
    platforms: normalizedPlatforms,
    publishMode,
    contentHash: hashSource(contentToMarkdown(content)),
    sourceHash: hashSource(JSON.stringify(platformSourceHashes)),
    expectedUpdatedAt,
  });
}

function journalResultForPublish(result) {
  return {
    jobId: result.job?.id || '',
    jobStatus: result.job?.status || '',
    platformResults: (result.job?.results || []).map(item => ({
      platform: item.platform,
      status: item.status,
    })),
    sourceUpdatedAt: result.sourceUpdatedAt,
    contentUpdatedAt: result.content?.updated_at || '',
    canonicalConflict: result.canonicalConflict === true,
    needsReload: result.needsReload === true,
  };
}

function replayedPublishResult(record) {
  const jobId = record.result?.jobId;
  const storedJob = jobId ? normalizeJob(one('SELECT * FROM publish_jobs WHERE id = ?', jobId)) : null;
  const storedContent = normalizeContent(one('SELECT * FROM contents WHERE id = ?', record.signature.contentId));
  const sourceUpdatedAt = record.result?.sourceUpdatedAt || record.signature.expectedUpdatedAt || '';
  const contentUpdatedAt = record.result?.contentUpdatedAt || '';
  const canonicalConflict = record.result?.canonicalConflict === true
    || !storedContent
    || !contentUpdatedAt
    || storedContent.updated_at !== contentUpdatedAt;
  const job = storedJob || {
      id: jobId || record.operationId,
      content_id: record.signature.contentId,
      status: record.result?.jobStatus || 'published',
      platforms: record.signature.platforms,
      results: record.result?.platformResults || [],
    };
  return {
    job,
    rawOutput: '',
    content: canonicalConflict ? null : storedContent,
    sourceUpdatedAt,
    canonicalConflict,
    needsReload: canonicalConflict || record.result?.needsReload === true,
  };
}

async function publishContent(contentId, platforms = [], options = {}) {
  const loadedContent = options.contentSnapshot
    || normalizeContent(one('SELECT * FROM contents WHERE id = ?', contentId));
  if (!loadedContent) throw new Error('内容不存在');
  const expectedUpdatedAt = validateExpectedUpdatedAt(
    options.expectedUpdatedAt || loadedContent.updated_at
  );
  if (loadedContent.updated_at !== expectedUpdatedAt) {
    throw statusError('文章已在其他标签页更新，请重新加载最新版本', 409);
  }
  const content = immutableSnapshot(loadedContent);
  const selected = normalizePublishPlatforms(content, platforms);
  if (!selected.length) throw new Error('请选择至少一个平台');
  const publishMode = options.publishMode === 'draft' ? 'draft' : 'direct';

  const jobId = makeId('job');
  db.prepare(`
    INSERT INTO publish_jobs (id, content_id, title, status, platforms, created_at, updated_at)
    VALUES (?, ?, ?, 'running', ?, ?, ?)
  `).run(jobId, contentId, content.title, encodeJson(selected), now(), now());

  const platformSources = new Map();
  for (const platform of selected) {
    const payload = selectPlatformSourcePayload(content, platform);
    const snapshotName = publishSnapshotName(
      jobId,
      contentId,
      selected.length > 1 ? platform : '',
      payload.extension
    );
    const basename = snapshotName.slice(0, -(payload.extension.length + 1));
    platformSources.set(
      platform,
      writePlatformSourceFile(DRAFTS_DIR, basename, payload)
    );
  }

  const finalResults = {};
  const rawOutputs = [];
  let publisherCallsStarted = 0;
  const preflight = options.preflight || browserSessionFailureForPublish;
  const platformPublisher = options.platformPublisher || publishOnePlatform;
  for (const platform of selected) {
    const preflightFailure = await preflight(platform);
    if (preflightFailure) {
      finalResults[platform] = { status: 'failed', error: preflightFailure };
      rawOutputs.push(`[${platform}] ${preflightFailure}`);
      continue;
    }

    publisherCallsStarted += 1;
    if (typeof options.onPublisherStart === 'function') options.onPublisherStart(platform);
    let single;
    try {
      single = await platformPublisher(
        platformSources.get(platform).filePath,
        platform,
        content.title,
        publishMode
      );
    } catch (error) {
      Object.defineProperty(error, PUBLISH_EXECUTION_META, {
        value: { publisherCallsStarted },
        enumerable: false,
      });
      throw error;
    }
    finalResults[platform] = single.info;
    rawOutputs.push(single.output);
  }

  let successCount = 0;
  for (const platform of selected) {
    const info = normalizeStoredPublishResult(platform, finalResults[platform] || { status: 'failed', error: '没有返回该平台结果' });
    const succeeded = info.status === 'success' || info.status === 'platform_draft';
    const status = succeeded ? (publishMode === 'draft' ? 'platform_draft' : 'success') : 'failed';
    if (succeeded) successCount++;
    if (status === 'failed' && isAuthFailureMessage(info.error || info.message)) {
      setPlatformAuthStatus(platform, 'logged_out');
    } else if (succeeded) {
      const existing = db.prepare('SELECT account FROM platforms WHERE id = ?').get(platform);
      setPlatformAuthStatus(platform, 'logged_in', existing?.account || null);
    }
    db.prepare(`
      INSERT INTO publish_results (id, job_id, platform, status, message, url, post_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      makeId('res'),
      jobId,
      platform,
      status,
      info.message || info.error || (status === 'platform_draft' ? '平台草稿已保存' : status === 'success' ? '发布成功' : ''),
      info.url || null,
      info.postId || null,
      now()
    );
  }

  const jobStatus = successCount === selected.length
    ? (publishMode === 'draft' ? 'draft_saved' : 'published')
    : (successCount > 0 ? 'partial_failed' : 'failed');
  db.prepare('UPDATE publish_jobs SET status = ?, updated_at = ? WHERE id = ?').run(jobStatus, now(), jobId);
  const contentAssignments = [];
  const contentValues = [];
  if (options.persistSelection !== false) {
    contentAssignments.push('selected_platforms = ?');
    contentValues.push(encodeJson(selected));
  }
  let aggregateStatus = '';
  if (options.updateAggregateStatus !== false) {
    aggregateStatus = jobStatus === 'published'
      ? '已发布'
      : jobStatus === 'draft_saved' ? '草稿已保存' : '发布失败';
    contentAssignments.push('status = ?');
    contentValues.push(aggregateStatus);
  }

  let canonicalConflict = false;
  let resultContent = null;
  if (contentAssignments.length) {
    const mutation = updateContentRowWithMonotonicTimestamp(
      contentId,
      contentAssignments.join(', '),
      contentValues,
      { expectedUpdatedAt }
    );
    if (mutation.changes === 0) {
      canonicalConflict = true;
    } else {
      if (aggregateStatus && content.plan_date) {
        db.prepare('UPDATE weekly_plans SET status = ?, updated_at = ? WHERE date = ?')
          .run(aggregateStatus, mutation.updatedAt, content.plan_date);
      }
      const current = normalizeContent(one('SELECT * FROM contents WHERE id = ?', contentId));
      if (current?.updated_at === mutation.updatedAt) resultContent = current;
      else canonicalConflict = true;
    }
  } else {
    const current = normalizeContent(one('SELECT * FROM contents WHERE id = ?', contentId));
    if (current?.updated_at === expectedUpdatedAt) resultContent = current;
    else canonicalConflict = true;
  }

  const activityVerb = publishMode === 'draft' ? '保存平台草稿' : '一键发布';
  addActivity(`${activityVerb}《${content.title}》到 ${selected.length} 个平台，成功 ${successCount} 个`, 'publish_job', jobId, '运营');
  const result = {
    job: normalizeJob(one('SELECT * FROM publish_jobs WHERE id = ?', jobId)),
    rawOutput: rawOutputs.join('\n\n'),
    content: canonicalConflict ? null : resultContent,
    sourceUpdatedAt: expectedUpdatedAt,
    canonicalConflict,
    needsReload: canonicalConflict,
  };
  if (!result.job || (!canonicalConflict && !result.content)) throw new Error('发布结果读取失败');
  Object.defineProperty(result, PUBLISH_EXECUTION_META, {
    value: { publisherCallsStarted, successCount, jobStatus },
    enumerable: false,
  });
  return result;
}

function recordCommand(type, text, progress, status = 'success', result = null) {
  const id = makeId('cmd');
  db.prepare(`
    INSERT INTO ai_commands (id, type, text, status, progress, result_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, type, text, status, encodeJson(progress), encodeJson(result), now(), now());
  return {
    id,
    type,
    text,
    status,
    progress,
    result,
  };
}

function runFakeAiCommand(payload) {
  const type = String(payload.type || 'custom');
  const text = String(payload.text || '').trim() || type;
  const progress = ['接收指令', '分析上下文', '生成模拟结果'];
  let result = null;

  if (type === 'today_topics') {
    const date = payload.date || toDateKey();
    result = { candidates: generateCandidates(date), date };
    progress.push(`已生成 ${result.candidates.length} 个候选选题`);
  } else if (type === 'week_plan') {
    result = { plans: rows('SELECT * FROM weekly_plans ORDER BY date') };
    progress.push('已刷新本周计划');
  } else if (type === 'write_article') {
    result = { content: generateContent(payload.date || toDateKey(), payload.topic) };
    progress.push('正文已生成，可进入内容中心审核');
  } else if (type === 'layout_preview') {
    if (!payload.contentId) throw new Error('请选择要排版的内容');
    const content = normalizeContent(one('SELECT * FROM contents WHERE id = ?', payload.contentId));
    if (!content) throw new Error('内容不存在');
    result = {
      content: layoutContent(payload.contentId, undefined, content.updated_at),
      sourceUpdatedAt: content.updated_at,
    };
    progress.push('排版预览已生成');
  } else if (type === 'save_draft') {
    if (!payload.contentId) throw new Error('请选择要保存的内容');
    const content = normalizeContent(one('SELECT * FROM contents WHERE id = ?', payload.contentId));
    if (!content) throw new Error('内容不存在');
    result = saveLocalDraft(payload.contentId, payload.platforms || [], content.updated_at);
    progress.push('已保存到内容中心草稿');
  } else {
    progress.push('当前为 V1.0 假数据流程，已记录指令');
    addActivity(`执行自定义指令：${text}`, 'ai_command', null);
  }

  return recordCommand(type, text, progress, 'success', result);
}

function readBody(req, options = {}) {
  return new Promise((resolve, reject) => {
    const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : DEFAULT_REQUEST_BODY_BYTES;
    const declaredBytes = Number(req.headers['content-length']);
    let settled = false;
    let byteLength = 0;
    const chunks = [];

    const fail = error => {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      req.resume();
      reject(error);
    };
    const onData = chunk => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += buffer.length;
      if (byteLength > maxBytes) {
        fail(statusError('请求内容过大', 413));
        return;
      }
      chunks.push(buffer);
    };

    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      fail(statusError('请求内容过大', 413));
      return;
    }
    req.on('data', onData);
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const body = Buffer.concat(chunks, byteLength).toString('utf8');
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        const error = new Error('请求 JSON 格式无效');
        if (options.invalidJsonStatusCode) error.statusCode = options.invalidJsonStatusCode;
        reject(error);
      }
    });
    req.on('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function sendJson(res, data, code = 200) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(data));
}

function mimeTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml; charset=utf-8',
  }[ext] || 'application/octet-stream';
}

function pathIsWithin(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function resolveContainedPath(root, relativePath) {
  const lexicalRoot = path.resolve(root);
  const lexicalCandidate = path.resolve(lexicalRoot, String(relativePath || ''));
  if (!pathIsWithin(lexicalRoot, lexicalCandidate) || !fs.existsSync(lexicalRoot)) return null;

  let realRoot;
  try {
    realRoot = fs.realpathSync(lexicalRoot);
  } catch {
    return null;
  }

  let existingPath = lexicalCandidate;
  while (!fs.existsSync(existingPath)) {
    const parent = path.dirname(existingPath);
    if (parent === existingPath) return null;
    existingPath = parent;
  }
  try {
    const realExistingPath = fs.realpathSync(existingPath);
    const realCandidate = path.resolve(realExistingPath, path.relative(existingPath, lexicalCandidate));
    return pathIsWithin(realRoot, realCandidate) ? realCandidate : null;
  } catch {
    return null;
  }
}

function sendNotFound(res) {
  sendJson(res, { ok: false, error: 'Not found' }, 404);
}

function sendStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = resolveContainedPath(PUBLIC_DIR, relative);
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendNotFound(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': mimeTypeFor(filePath) });
  fs.createReadStream(filePath).pipe(res);
}

function sendUpload(res, pathname, uploadsDir = UPLOADS_DIR) {
  let relative;
  try {
    relative = decodeURIComponent(pathname.replace(/^\/uploads\/?/, ''));
  } catch {
    sendNotFound(res);
    return;
  }
  const filePath = resolveContainedPath(uploadsDir, relative);
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendNotFound(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': mimeTypeFor(filePath) });
  fs.createReadStream(filePath).pipe(res);
}

function isFullHtmlDocument(html) {
  return /<!doctype\s+html/i.test(String(html || '')) || /<html[\s>]/i.test(String(html || ''));
}

function injectPreviewBase(html) {
  const source = String(html || '');
  if (/<base\s/i.test(source)) return source;
  if (/<head[^>]*>/i.test(source)) {
    return source.replace(/<head([^>]*)>/i, '<head$1>\n  <base href="/">');
  }
  return `<base href="/">\n${source}`;
}

function previewDocument(content) {
  const html = content?.layout_html || '<main class="empty-preview">排版 HTML 尚未生成</main>';
  const embeddedHtml = extractEmbeddedHtmlDocument(html);
  if (embeddedHtml) return injectPreviewBase(embeddedHtml);
  if (isFullHtmlDocument(html)) return injectPreviewBase(html);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(content?.title || '排版预览')}</title>
  <style>
    body { margin: 0; background: #f5f7fb; color: #111827; font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif; }
    .preview-shell { max-width: 760px; margin: 0 auto; padding: 32px 20px 56px; }
    .preview-card { background: #fff; border: 1px solid #dbe3ee; border-radius: 8px; padding: 28px; box-shadow: 0 14px 36px rgba(16, 24, 40, 0.055); }
    img { max-width: 100%; height: auto; border-radius: 8px; }
    h1 { margin-top: 0; line-height: 1.25; }
    p { line-height: 1.8; }
    .empty-preview { min-height: 260px; display: grid; place-items: center; color: #667085; }
  </style>
</head>
<body>
  <div class="preview-shell">
    <div class="preview-card">${html}</div>
  </div>
</body>
</html>`;
}

function sendLayoutPreview(res, contentId) {
  const content = normalizeContent(one('SELECT * FROM contents WHERE id = ?', contentId));
  if (!content) {
    sendJson(res, { ok: false, error: 'Not found' }, 404);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(previewDocument(content));
}

function createDashboardServer(options = {}) {
  const previewOptions = {
    ...(options.previewRunner ? { runner: options.previewRunner } : {}),
    ...(options.previewTimeout ? { timeout: options.previewTimeout } : {}),
    ...(options.previewTempRoot ? { tempRoot: options.previewTempRoot } : {}),
  };
  const publishDependencies = {
    ...(options.preflight ? { preflight: options.preflight } : {}),
    ...(options.platformPublisher ? { platformPublisher: options.platformPublisher } : {}),
  };
  const nowMs = typeof options.nowMs === 'function' ? options.nowMs : Date.now;
  const operationJournal = options.operationJournal || createOperationJournal({
    filePath: options.operationsFile || OPERATIONS_FILE,
    nowMs,
    ttlMs: options.operationJournalTtlMs ?? options.singlePublishCacheTtlMs,
    limit: options.operationJournalLimit ?? options.singlePublishCacheLimit,
  });
  const instanceLock = options.instanceLock || createInstanceLock({
    filePath: options.instanceLockFile || `${operationJournal.filePath}.instance.lock`,
    ...(options.processIsAlive ? { isProcessAlive: options.processIsAlive } : {}),
  });
  const workbenchCsrfToken = randomBytes(32).toString('base64url');
  const uploadsDir = path.resolve(options.uploadsDir || UPLOADS_DIR);

  const executePublishOperation = async ({
    operationId,
    contentId,
    platforms,
    publishMode,
    expectedUpdatedAt,
    persistSelection = true,
    updateAggregateStatus = true,
  }) => {
    validatePublishOperationId(operationId);
    const expectedRevision = validateExpectedUpdatedAt(expectedUpdatedAt);
    if (publishMode !== 'draft' && publishMode !== 'direct') {
      throw statusError('publishMode 必须是 draft 或 direct', 400);
    }
    const requestedPlatforms = normalizePublishPlatforms(null, platforms);
    const existingOperation = operationJournal.get(operationId);
    const matchingSourceOperation = existingOperation || operationJournal.findBySourceRevision({
      contentId,
      platforms: requestedPlatforms,
      publishMode,
      expectedUpdatedAt: expectedRevision,
    });
    if (existingOperation || (matchingSourceOperation && matchingSourceOperation.state !== 'failed')) {
      const priorSignature = normalizeOperationSignature(matchingSourceOperation.signature);
      const replaySignature = {
        ...priorSignature,
        contentId: String(contentId || ''),
        platforms: requestedPlatforms.length ? requestedPlatforms : priorSignature.platforms,
        publishMode,
        expectedUpdatedAt: expectedRevision,
      };
      const priorAdmission = operationJournal.begin(operationId, replaySignature);
      if (priorAdmission.kind === 'replay') {
        return { ...replayedPublishResult(priorAdmission.record), cached: true };
      }
    }

    const content = runTransaction(() => {
      const current = normalizeContent(one('SELECT * FROM contents WHERE id = ?', contentId));
      if (!current) throw statusError('内容不存在', 404);
      if (current.updated_at !== expectedRevision) {
        throw statusError('文章已在其他标签页更新，请重新加载最新版本', 409);
      }
      return immutableSnapshot(current);
    });
    const selected = normalizePublishPlatforms(content, platforms);
    if (!selected.length) throw statusError('请选择至少一个平台', 400);
    for (const platform of selected) {
      if (!one('SELECT id FROM platforms WHERE id = ?', platform)) {
        throw statusError(`平台不存在: ${platform}`, 400);
      }
    }

    const signature = buildPublishOperationSignature(content, selected, publishMode, expectedRevision);
    const admission = operationJournal.begin(operationId, signature);
    if (admission.kind === 'replay') {
      return { ...replayedPublishResult(admission.record), cached: true };
    }

    let publisherStarted = false;
    try {
      const result = await publishContent(contentId, selected, {
        ...publishDependencies,
        publishMode,
        expectedUpdatedAt: expectedRevision,
        contentSnapshot: content,
        persistSelection,
        updateAggregateStatus,
        onPublisherStart: () => { publisherStarted = true; },
      });
      const execution = result[PUBLISH_EXECUTION_META] || {};
      const journalResult = journalResultForPublish(result);
      if (result.job?.status === 'failed') {
        if (execution.publisherCallsStarted > 0) operationJournal.markUncertain(operationId, journalResult);
        else operationJournal.fail(operationId, journalResult);
      } else {
        operationJournal.complete(operationId, journalResult);
      }
      return { ...result, cached: false };
    } catch (error) {
      const execution = error?.[PUBLISH_EXECUTION_META] || {};
      if (publisherStarted || execution.publisherCallsStarted > 0) operationJournal.markUncertain(operationId);
      else operationJournal.fail(operationId);
      throw error;
    }
  };

  const dashboardServer = http.createServer(async (req, res) => {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (!requestOriginIsTrusted(req, origin)) {
    sendJson(res, { ok: false, error: 'Origin 不受信任' }, 403);
    return;
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    if (!origin) {
      sendJson(res, { ok: false, error: 'OPTIONS 请求缺少可信 Origin' }, 403);
      return;
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Workbench-CSRF');
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === 'POST' && !csrfTokenMatches(workbenchCsrfToken, req.headers['x-workbench-csrf'])) {
    sendJson(res, { ok: false, error: 'Workbench CSRF 校验失败' }, 403);
    return;
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    const previewMatch = url.pathname.match(/^\/content\/([^/]+)\/preview\.html$/);
    if (previewMatch && req.method === 'GET') {
      sendLayoutPreview(res, previewMatch[1]);
      return;
    }

    if (url.pathname.startsWith('/uploads/') && req.method === 'GET') {
      sendUpload(res, url.pathname, uploadsDir);
      return;
    }

    if (url.pathname === '/api/bootstrap' && req.method === 'GET') {
      sendJson(res, { ok: true, data: { ...getDashboardData(), csrfToken: workbenchCsrfToken } });
      return;
    }

    if (url.pathname === '/api/layout-templates' && req.method === 'GET') {
      sendJson(res, { ok: true, templates: listLayoutTemplates() });
      return;
    }

    if (url.pathname === '/api/platforms' && req.method === 'GET') {
      const refresh = url.searchParams.get('refresh') === '1';
      if (refresh) {
        sendJson(res, { ok: true, ...(await refreshPlatformsFromCli()) });
      } else {
        sendJson(res, { ok: true, platforms: platformRows() });
      }
      return;
    }

    if (url.pathname === '/api/platform-auth' && req.method === 'POST') {
      const body = await readBody(req);
      const platform = String(body.platform || '').trim().toLowerCase();
      const interactive = body.interactive === true;
      if (!platform) throw new Error('缺少平台 ID');
      if (INTERACTIVE_AUTH_PLATFORMS.has(platform) && !interactive) {
        const existing = db.prepare('SELECT * FROM platforms WHERE id = ?').get(platform);
        const name = LOGIN_PLATFORMS[platform]?.name || platform;
        const session = readPlatformSessionFile(platform);
        const account = normalizePlatformAccount(existing?.account);
        let authStatus = existing?.auth_status || 'unknown';
        let message = `${name} 检查需要打开浏览器，请单独点击“检查”或“重新登录”`;
        if (!session?.userDataDir || !fs.existsSync(session.userDataDir)) {
          authStatus = 'logged_out';
          message = `${name} 登录会话不存在或已失效，请重新登录`;
        } else if (authStatus === 'logged_in') {
          message = account
            ? `${name} 已登录`
            : `${name} 已有浏览器发布会话，账号信息待解析`;
        } else if (authStatus === 'logged_out') {
          message = `${name} 上次发布或检查发现登录已失效，请重新登录`;
        } else {
          authStatus = 'unknown';
          message = `${name} 已保存浏览器会话，请单独点击“检查”确认是否仍然有效`;
        }
        setPlatformAuthStatus(platform, authStatus, account);
        sendJson(res, {
          ok: true,
          platform: {
            id: platform,
            auth_status: authStatus,
            account,
            message,
          },
          skippedInteractive: true,
        });
        return;
      }
      const result = await runWeibotCli(['auth', platform], 45000);
      const parsed = parseAuthOutput(platform, result.output);
      setPlatformAuthStatus(platform, parsed.auth_status, parsed.account);
      sendJson(res, { ok: true, platform: parsed, rawOutput: result.output });
      return;
    }

    if (url.pathname === '/api/platform-login/start' && req.method === 'POST') {
      const body = await readBody(req);
      const platform = String(body.platform || '').trim().toLowerCase();
      if (!platform) throw new Error('缺少平台 ID');

      const session = await startLoginSession(platform);
      await waitForLoginReady(session);

      if (session.done && session.exitCode !== 0) {
        throw new Error(stripAnsi(session.output).trim() || session.error || '登录浏览器启动失败');
      }

      sendJson(res, {
        ok: true,
        session: {
          id: session.id,
          platform: session.platform,
          ready: session.ready,
          cookieFile: session.cookieFile,
          userDataDir: session.userDataDir,
          port: session.port,
        },
        message: '登录浏览器已打开。完成登录后，回到面板点击“完成登录”。',
        rawOutput: session.output,
      });
      return;
    }

    if (url.pathname === '/api/platform-login/finish' && req.method === 'POST') {
      const body = await readBody(req);
      const sessionId = String(body.sessionId || '').trim();
      const session = loginSessions.get(sessionId);
      if (!session) throw new Error('登录会话不存在或已过期，请重新点击登录');

      await finishLoginSession(session);

      let parsed;
      let authOutput = '';
      const authResult = await runWeibotCli(['auth', session.platform], 60000);
      authOutput = authResult.output;
      parsed = parseAuthOutput(session.platform, authResult.output);
      if (INTERACTIVE_AUTH_PLATFORMS.has(session.platform) && parsed.auth_status !== 'logged_in' && session.exportedCount > 0) {
        parsed = {
          ...parsed,
          auth_status: 'logged_in',
          account: parsed.account || null,
          message: parsed.account
            ? `已导出 Cookie，并识别到账户 ${parsed.account}`
            : `已导出 Cookie，浏览器发布会话已保存，账号信息待解析`,
        };
      }
      setPlatformAuthStatus(session.platform, parsed.auth_status, parsed.account);
      addActivity(`完成 ${session.platform} 登录 Cookie 导出`, 'platform', session.platform, '用户');
      loginSessions.delete(session.id);

      sendJson(res, {
        ok: true,
        platform: parsed,
        cookieFile: session.cookieFile,
        exportedCount: session.exportedCount,
        exportedDomains: session.exportedDomains || [],
        rawOutput: session.output,
        authOutput,
      });
      return;
    }

    if (url.pathname === '/api/platform-open' && req.method === 'POST') {
      const body = await readBody(req);
      const opened = await openInPlatformSession(body.platform, body.url);
      sendJson(res, { ok: true, opened });
      return;
    }

    if (url.pathname === '/api/plans/range' && req.method === 'POST') {
      const body = await readBody(req);
      sendJson(res, { ok: true, ...createPlansRange(body.startDate, body.endDate, body) });
      return;
    }

    const planMatch = url.pathname.match(/^\/api\/plans\/([^/]+)$/);
    if (planMatch && req.method === 'POST') {
      const body = await readBody(req);
      const plan = updatePlan(decodeURIComponent(planMatch[1]), body);
      sendJson(res, { ok: true, plan });
      return;
    }

    if (url.pathname === '/api/topics/generate' && req.method === 'POST') {
      const body = await readBody(req);
      sendJson(res, { ok: true, candidates: generateCandidates(body.date || toDateKey()) });
      return;
    }

    if (url.pathname === '/api/topics/confirm' && req.method === 'POST') {
      const body = await readBody(req);
      sendJson(res, { ok: true, ...confirmCandidate(body.candidateId) });
      return;
    }

    if (url.pathname === '/api/content/generate' && req.method === 'POST') {
      const body = await readBody(req);
      sendJson(res, { ok: true, content: generateContent(body.date, body.topic) });
      return;
    }

    if (url.pathname === '/api/content/import' && req.method === 'POST') {
      const body = await readBody(req, {
        maxBytes: MAX_IMPORT_REQUEST_BYTES,
        invalidJsonStatusCode: 400,
      });
      sendJson(res, { ok: true, content: importContent(body) });
      return;
    }

    const platformPreviewMatch = url.pathname.match(/^\/api\/content\/([^/]+)\/platform-preview$/);
    if (platformPreviewMatch && req.method === 'GET') {
      const preview = await previewContentForPlatform(
        platformPreviewMatch[1],
        url.searchParams.get('platform'),
        previewOptions
      );
      sendJson(res, { ok: true, preview });
      return;
    }

    const contentUpdateMatch = url.pathname.match(/^\/api\/content\/([^/]+)$/);
    if (contentUpdateMatch && req.method === 'POST') {
      const body = await readBody(req, { invalidJsonStatusCode: 400 });
      sendJson(res, {
        ok: true,
        content: updateContent(contentUpdateMatch[1], body),
        sourceUpdatedAt: body.expectedUpdatedAt,
      });
      return;
    }

    const layoutMatch = url.pathname.match(/^\/api\/content\/([^/]+)\/layout$/);
    if (layoutMatch && req.method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw statusError('请求体必须是 JSON 对象', 400);
      }
      const templateProvided = Object.prototype.hasOwnProperty.call(body, 'template');
      const content = templateProvided
        ? layoutContent(layoutMatch[1], body.template, body.expectedUpdatedAt)
        : layoutContent(layoutMatch[1], undefined, body.expectedUpdatedAt);
      sendJson(res, { ok: true, content, sourceUpdatedAt: body.expectedUpdatedAt });
      return;
    }

    const draftMatch = url.pathname.match(/^\/api\/content\/([^/]+)\/save-draft$/);
    if (draftMatch && req.method === 'POST') {
      const body = await readBody(req);
      sendJson(res, {
        ok: true,
        ...saveLocalDraft(draftMatch[1], body.platforms || [], body.expectedUpdatedAt),
      });
      return;
    }

    const singlePlatformPublishMatch = url.pathname.match(/^\/api\/content\/([^/]+)\/publish-platform$/);
    if (singlePlatformPublishMatch && req.method === 'POST') {
      const body = await readBody(req, { invalidJsonStatusCode: 400 });
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw statusError('请求体必须是 JSON 对象', 400);
      }

      if (typeof body.platform !== 'string'
        || !body.platform.trim()
        || body.platform.includes(',')) {
        throw statusError('platform 必须且只能指定一个平台', 400);
      }
      const platform = body.platform.trim().toLowerCase();
      const knownPlatform = one('SELECT id FROM platforms WHERE id = ?', platform);
      if (!knownPlatform || RETIRED_PLATFORM_IDS.includes(platform)) {
        throw statusError(`平台不存在: ${platform}`, 400);
      }

      if (body.publishMode !== 'draft' && body.publishMode !== 'direct') {
        throw statusError('publishMode 必须是 draft 或 direct', 400);
      }
      const contentId = singlePlatformPublishMatch[1];
      const result = await executePublishOperation({
        operationId: body.operationId,
        contentId,
        platforms: [platform],
        publishMode: body.publishMode,
        expectedUpdatedAt: body.expectedUpdatedAt,
        persistSelection: false,
        updateAggregateStatus: false,
      });
      sendJson(res, { ok: true, ...result });
      return;
    }

    if (url.pathname === '/api/publish' && req.method === 'POST') {
      const body = await readBody(req, { invalidJsonStatusCode: 400 });
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw statusError('请求体必须是 JSON 对象', 400);
      }
      if (typeof body.contentId !== 'string' || !body.contentId) {
        throw statusError('contentId 不能为空', 400);
      }
      const result = await executePublishOperation({
        operationId: body.operationId,
        contentId: body.contentId,
        platforms: body.platforms || [],
        publishMode: body.publishMode || 'direct',
        expectedUpdatedAt: body.expectedUpdatedAt,
      });
      sendJson(res, { ok: true, ...result });
      return;
    }

    if (url.pathname === '/api/ai-command' && req.method === 'POST') {
      const body = await readBody(req);
      sendJson(res, { ok: true, command: runFakeAiCommand(body) });
      return;
    }

    if (url.pathname === '/api/content' && req.method === 'GET') {
      sendJson(res, { ok: true, contents: rows('SELECT * FROM contents ORDER BY updated_at DESC').map(normalizeContent) });
      return;
    }

    if (url.pathname === '/api/history' && req.method === 'GET') {
      sendJson(res, { ok: true, jobs: rows('SELECT * FROM publish_jobs ORDER BY created_at DESC LIMIT 100').map(normalizeJob) });
      return;
    }

    sendStatic(req, res, url.pathname);
  } catch (error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    sendJson(res, {
      ok: false,
      error: error.message,
      ...(error.apiCode ? { code: error.apiCode } : {}),
    }, statusCode);
  }
  });
  return attachInstanceLock(dashboardServer, instanceLock, operationJournal);
}

const server = createDashboardServer();

function listenWithFallback(port) {
  const onListening = () => {
    server.off('error', onError);
    console.log(`多平台内容发布可视化面板: http://${HOST}:${port}`);
  };
  const onError = error => {
    server.off('listening', onListening);
    throw error;
  };
  server.once('listening', onListening);
  server.once('error', onError);
  server.listen(port, HOST);
}

initDb();
seedData();

if (require.main === module) {
  listenWithFallback(PORT);
}

module.exports = {
  DATA_DIR,
  DB_PATH,
  DRAFTS_DIR,
  CLI_PATH,
  server,
  createDashboardServer,
  db,
  parsePlatformOutput,
  parseSyncResults,
  loginExported,
  generateCandidates,
  confirmCandidate,
  createPlansRange,
  updatePlan,
  generateContent,
  importContent,
  updateContent,
  layoutContent,
  saveLocalDraft,
  contentToMarkdown,
  canonicalContentHash,
  layoutHash,
  selectPlatformSourcePayload,
  writePlatformSourceFile,
  createPlatformSource,
  hashSource,
  hashFile,
  previewContentForPlatform,
  publishSnapshotName,
  buildPublishOperationSignature,
  publishContent,
  createOperationJournal,
  createInstanceLock,
  getDashboardData,
  listenWithFallback,
};
