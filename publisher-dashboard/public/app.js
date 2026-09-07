const API = window.location.origin;
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
const PLATFORM_NAMES = {
  jianshu: '简书',
  netease: '网易号',
  uisdc: '优设',
  sspai: '少数派',
  weixin: '微信公众号',
  zhihu: '知乎',
  juejin: '掘金',
  douyin: '抖音',
  toutiao: '今日头条',
  xiaohongshu: '小红书',
  qiehao: '企鹅号',
  'china-vision': '中国机器视觉网',
  'bjx-club': '北极星社区',
  elecfans: '电子发烧友',
  'eet-china': '电子工程专辑',
  eeworld: '电子工程世界',
  ca800: '中国自动化网',
  b2b168: '八方资源网',
  app17: '阿仪网',
  huangye88: '黄页88网',
  '51sole': '搜了网',
};

const PLATFORM_ICON_FILES = {
  jianshu: '/assets/platform-icons/jianshu.png',
  netease: '/assets/platform-icons/netease.png',
  uisdc: '/assets/platform-icons/uisdc.ico',
  sspai: '/assets/platform-icons/sspai.ico',
  zhihu: '/assets/platform-icons/zhihu.ico',
  juejin: '/assets/platform-icons/juejin.png',
  douyin: '/assets/platform-icons/douyin.ico',
  toutiao: '/assets/platform-icons/toutiao.ico',
  xiaohongshu: '/assets/platform-icons/xiaohongshu.ico',
  qiehao: '/assets/platform-icons/qiehao.ico',
  'china-vision': '/assets/platform-icons/china-vision.jpg',
  'bjx-club': '/assets/platform-icons/bjx-club.ico',
  elecfans: '/assets/platform-icons/elecfans.ico',
  'eet-china': '/assets/platform-icons/eet-china.ico',
  eeworld: '/assets/platform-icons/eeworld.ico',
  ca800: '/assets/platform-icons/ca800.png',
  b2b168: '/assets/platform-icons/b2b168.ico',
  app17: '/assets/platform-icons/app17.ico',
  huangye88: '/assets/platform-icons/huangye88.ico',
  '51sole': '/assets/platform-icons/51sole.ico',
  weibo: '/assets/platform-icons/weibo.ico',
  bilibili: '/assets/platform-icons/bilibili.ico',
  baijiahao: '/assets/platform-icons/baijiahao.ico',
  csdn: '/assets/platform-icons/csdn.ico',
  yuque: '/assets/platform-icons/yuque.png',
  douban: '/assets/platform-icons/douban.ico',
  sohu: '/assets/platform-icons/sohu.ico',
  xueqiu: '/assets/platform-icons/xueqiu.ico',
  weixin: '/assets/platform-icons/weixin.ico',
  woshipm: '/assets/platform-icons/woshipm.ico',
  '51cto': '/assets/platform-icons/51cto.ico',
  imooc: '/assets/platform-icons/imooc.ico',
  oschina: '/assets/platform-icons/oschina.ico',
  segmentfault: '/assets/platform-icons/segmentfault.png',
  cnblogs: '/assets/platform-icons/cnblogs.ico',
  eastmoney: '/assets/platform-icons/eastmoney.ico',
  'zip-download': '/assets/platform-icons/zip-download.svg',
};

const LOGIN_PLATFORM_PRIORITY = [
  'weixin',
  'woshipm',
  'sspai',
  'xiaohongshu',
  'uisdc',
  'douyin',
  'zhihu',
  'toutiao',
  'juejin',
  'csdn',
  'weibo',
  'bilibili',
  'baijiahao',
  'yuque',
  'douban',
  'sohu',
  'xueqiu',
  'qiehao',
  '51cto',
  'imooc',
  'oschina',
  'segmentfault',
  'cnblogs',
  'eastmoney',
  'zip-download',
];
const FORUM_PLATFORM_IDS = new Set([
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
const PLAN_STATUSES = ['待选题', '选题已确认', '正文已生成', '已排版', '草稿已保存', '已发布', '发布失败'];
const HISTORY_STATUSES = [
  ['all', '全部状态'],
  ['published', '发布成功'],
  ['draft_saved', '草稿已保存'],
  ['partial_failed', '部分失败'],
  ['uncertain', '结果待核对'],
  ['failed', '发布失败'],
  ['local_draft', '本地草稿'],
  ['running', '发布中'],
];
const SIDEBAR_COLLAPSED_KEY = 'content-workbench.sidebarCollapsed';
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
const CONTENT_CHANGED_DURING_SAVE_MESSAGE = '正文在保存期间又有修改，请先保存后重试';
const IMPORT_FILE_EXTENSION = /\.(?:md|markdown|html|htm|txt)$/i;
const FEATURED_PREVIEW_PLATFORMS = ['weixin', 'woshipm', 'sspai', 'xiaohongshu', 'uisdc', 'douyin'];
const UISDC_SUBMISSION_URL = 'https://www.uisdc.com/contribution?type=post';
const PREVIEW_FORMAT_LABELS = {
  html: 'HTML',
  markdown: 'Markdown',
  text: '纯文本',
};

const state = {
  activeView: 'content',
  data: null,
  workbenchCsrfToken: '',
  recoveryContext: null,
  recoveryRequestVersion: 0,
  recoveryBusy: false,
  publishRecoveryError: null,
  selectedDate: '',
  planStartDate: '',
  planEndDate: '',
  selectedContentId: '',
  contentPage: 1,
  contentPageSize: 8,
  contentMode: 'edit',
  libraryVisibility: 'auto',
  templateCatalogNamed: false,
  dirtyContentIds: new Set(),
  contentEditRevisions: new Map(),
  contentOperationLocks: new Map(),
  contentOperationSequence: 0,
  contentCanonicalConflicts: new Set(),
  layoutTemplates: [],
  layoutTemplatesLoaded: false,
  layoutTemplatesLoading: false,
  layoutTemplatesError: '',
  activePreviewPlatform: 'weixin',
  previewCache: new Map(),
  previewLoading: new Set(),
  previewErrors: new Map(),
  previewDevice: 'desktop',
  draftPreviewTimer: null,
  wechatTemplateChoices: new Map(),
  selectedWechatTemplate: '',
  pendingSinglePublish: null,
  singlePublishSubmitting: false,
  singlePublishOperationToken: '',
  singlePublishOperationSequence: 0,
  batchPublishSubmitting: false,
  batchPublishOperation: null,
  contentTransitionInFlight: false,
  importTab: 'paste',
  importFileName: '',
  importReadToken: 0,
  importReader: null,
  importSubmitting: false,
  topicRun: null,
  topicLoading: false,
  topicPollTimer: null,
  topicRequestVersion: 0,
  selectedPlatforms: new Set(),
  loginSessions: {},
  loginStarting: new Set(),
  loginFinishing: new Set(),
  authAutoChecked: false,
  authCheckingAll: false,
  authChecking: new Set(),
  lastProgress: [],
  historyFilters: {
    keyword: '',
    platform: 'all',
    status: 'all',
    startDate: '',
    endDate: '',
  },
  historyPage: 1,
  historyPageSize: 10,
};

let layoutTemplatesRequest = null;

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function getStoredSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function setStoredSidebarCollapsed(collapsed) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // Ignore storage errors in restricted browser modes.
  }
}


function applySidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  const button = $('[data-action="toggle-sidebar"]');
  if (!button) return;
  button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  button.setAttribute('aria-label', collapsed ? '展开菜单' : '折叠菜单');
  button.setAttribute('title', collapsed ? '展开菜单' : '折叠菜单');
}

applySidebarCollapsed(getStoredSidebarCollapsed());

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
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

function getMonday(dateKey) {
  const d = new Date(`${dateKey}T00:00:00`);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return toDateKey(d);
}

function sortLoginPlatforms(platforms) {
  return [...platforms].sort((a, b) => {
    const aPriority = LOGIN_PLATFORM_PRIORITY.indexOf(a.id);
    const bPriority = LOGIN_PLATFORM_PRIORITY.indexOf(b.id);
    const aRank = Number.isInteger(a.catalog_order) ? a.catalog_order : aPriority >= 0 ? aPriority : FORUM_PLATFORM_IDS.has(a.id) ? 1000 : 500;
    const bRank = Number.isInteger(b.catalog_order) ? b.catalog_order : bPriority >= 0 ? bPriority : FORUM_PLATFORM_IDS.has(b.id) ? 1000 : 500;
    if (aRank !== bRank) return aRank - bRank;
    return String(a.name || a.id).localeCompare(String(b.name || b.id), 'zh-CN');
  });
}

function platformName(id) {
  const platform = state.data?.platforms?.find(item => item.id === id);
  return platform?.name || state.data?.platformLabels?.[id] || PLATFORM_NAMES[id] || id;
}

function planStatusOptions(status) {
  const current = status || '待选题';
  const options = PLAN_STATUSES.includes(current) ? PLAN_STATUSES : [current, ...PLAN_STATUSES];
  return options.map(option => `<option value="${escapeHtml(option)}" ${option === current ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('');
}

function statusClass(status) {
  if (status === '已发布' || status === 'published' || status === 'success') return 'done';
  if (status === '草稿已保存' || status === 'local_draft' || status === 'draft_saved' || status === 'platform_draft') return 'draft';
  if (status === '正文已生成' || status === '选题已确认') return 'generated';
  if (status === '已排版') return 'layout';
  if (status === '部分失败' || status === 'partial_failed') return 'partial';
  if (status === '发布失败' || status === 'failed' || status === 'partial_failed' || status === 'uncertain') return 'failed';
  if (status === '待选题' || status === '待处理' || status === '待检查') return 'pending';
  return '';
}

function statusLabel(status) {
  const labels = {
    published: '发布成功',
    success: '发布成功',
    draft_saved: '草稿已保存',
    platform_draft: '平台草稿已保存',
    exported: '本地导出已完成',
    partial_failed: '部分失败',
    uncertain: '结果待核对',
    retry_allowed: '人工确认可重新准备',
    failed: '发布失败',
    local_draft: '本地草稿',
    running: '发布中',
  };
  return labels[status] || status || '待处理';
}

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  $('#toast-root').appendChild(node);
  setTimeout(() => node.remove(), 3600);
}

async function request(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && state.workbenchCsrfToken) {
    headers['X-Workbench-CSRF'] = state.workbenchCsrfToken;
  }
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const error = new Error(data.error || `HTTP ${res.status}`);
    error.statusCode = res.status;
    if (data.code) error.apiCode = data.code;
    throw error;
  }
  return data;
}

async function loadLayoutTemplates() {
  if (state.layoutTemplatesLoaded) return state.layoutTemplates;
  if (layoutTemplatesRequest) return layoutTemplatesRequest;

  state.layoutTemplatesLoading = true;
  state.layoutTemplatesError = '';
  layoutTemplatesRequest = request('/api/layout-templates')
    .then(result => {
      state.templateCatalogNamed = result.catalogVersion === 1;
      state.layoutTemplates = Array.isArray(result.templates)
        ? result.templates.filter(template => (
          template
          && typeof template.filename === 'string'
          && template.filename.trim()
          && typeof template.label === 'string'
          && template.label.trim()
        ))
        : [];
      if (!state.layoutTemplates.some(template => template.filename === state.selectedWechatTemplate)) {
        state.selectedWechatTemplate = state.layoutTemplates[0]?.filename || '';
      }
      return state.layoutTemplates;
    })
    .catch(error => {
      state.layoutTemplates = [];
      state.layoutTemplatesError = error.message || '排版模板加载失败';
      return state.layoutTemplates;
    })
    .finally(() => {
      state.layoutTemplatesLoaded = true;
      state.layoutTemplatesLoading = false;
      layoutTemplatesRequest = null;
      if (state.data && state.activeView === 'content') renderPlatformAdaptationPane();
    });
  return layoutTemplatesRequest;
}

async function loadData(options = {}) {
  const res = await request('/api/bootstrap');
  if (options.operationContext && !contentOperationIsStable(options.operationContext)) {
    return { applied: false, data: res.data };
  }
  state.workbenchCsrfToken = res.data.csrfToken || '';
  state.data = res.data;
  state.contentCanonicalConflicts?.clear();
  state.selectedDate ||= res.data.today;
  if (!state.planStartDate || !state.planEndDate) {
    state.planStartDate = getMonday(res.data.today);
    state.planEndDate = addDays(state.planStartDate, 6);
  }
  if (state.selectedContentId && !res.data.contents.some(content => content.id === state.selectedContentId)) {
    state.selectedContentId = '';
  }
  state.selectedContentId ||= res.data.contents[0]?.id || '';
  syncContentPageToSelected();
  applyContentPlatforms(getSelectedContent());
  render();
  if (!state.layoutTemplatesLoaded && !layoutTemplatesRequest) void loadLayoutTemplates();
  if (!state.authAutoChecked && res.data.platforms?.length) {
    state.authAutoChecked = true;
    setTimeout(() => checkAllAuth({ silent: true }), 250);
  }
  return { applied: true, data: res.data };
}

function getSelectedContent() {
  return state.data?.contents.find(content => content.id === state.selectedContentId) || state.data?.contents[0] || null;
}

function syncContentPageToSelected() {
  const contents = state.data?.contents || [];
  const totalPages = Math.max(1, Math.ceil(contents.length / state.contentPageSize));
  const selectedIndex = contents.findIndex(content => content.id === state.selectedContentId);
  if (selectedIndex >= 0) {
    state.contentPage = Math.floor(selectedIndex / state.contentPageSize) + 1;
    return;
  }
  state.contentPage = Math.min(Math.max(1, state.contentPage), totalPages);
}

function applyContentPlatforms(content) {
  const active=new Set((state.data?.platforms || []).map(p=>p.id));
  state.selectedPlatforms = new Set((Array.isArray(content?.selected_platforms) ? content.selected_platforms : []).filter(id=>active.has(id)));
}

function switchView(view) {
  state.activeView = view;
  $$('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  $$('.view').forEach(node => node.classList.toggle('active', node.id === `view-${view}`));
  render();
}

function statePill(status) {
  return `<span class="state-pill ${statusClass(status)}">${escapeHtml(statusLabel(status))}</span>`;
}

function syncStatusSelectClass(select) {
  select.className = `table-input status-select ${statusClass(select.value)}`;
}

function platformIconUrl(id) {
  return PLATFORM_ICON_FILES[id] || '';
}

function platformInitial(platform) {
  const label = platform?.name || PLATFORM_NAMES[platform?.id] || platform?.id || '?';
  return String(label).trim().slice(0, 1).toUpperCase() || '?';
}

function platformAvatar(platform) {
  const icon = platformIconUrl(platform.id);
  const label = platform.name || PLATFORM_NAMES[platform.id] || platform.id;
  return `
    <span class="platform-avatar ${icon ? 'has-icon' : ''}" aria-hidden="true" title="${escapeHtml(label)}">
      <span class="platform-avatar-fallback">${escapeHtml(platformInitial(platform))}</span>
      ${icon ? `<img src="${escapeHtml(icon)}" alt="" loading="lazy" onerror="this.parentElement.classList.remove('has-icon'); this.remove()">` : ''}
    </span>
  `;
}

function imageSource(img) {
  return normalizeImageSrc(img.thumbnail_url || img.thumbnail || img.url || img.src || img.path || '');
}

function imageReviewCell(img) {
  const src = imageSource(img);
  const fallback = escapeHtml(String(img.id || 'IMG').slice(0, 3).toUpperCase());
  return `
    <div class="image-cell">
      <div class="image-thumb ${src ? 'has-image' : ''}">
        ${src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(img.id || '配图')}">` : `<span>${fallback}</span>`}
      </div>
      <div>
        <strong>${escapeHtml(img.id || '未命名图片')}</strong>
        <span>${src ? '已接入缩略图' : '等待缩略图接口'}</span>
      </div>
    </div>
  `;
}

function normalizeImageSrc(src) {
  const value = String(src || '').trim();
  if (!value) return '';
  if (/^(https?:|data:|\/)/i.test(value)) return value.replace(/\\/g, '/');
  const normalized = value.replace(/\\/g, '/');
  const marker = '/publisher-dashboard/data/uploads/';
  const markerIndex = normalized.toLowerCase().indexOf(marker);
  if (markerIndex >= 0) return `/uploads/${normalized.slice(markerIndex + marker.length)}`;
  return normalized;
}

function contentImagesHtml(content, existingHtml = '') {
  const existing = String(existingHtml || '');
  const images = (content.images || [])
    .map(img => ({ ...img, src: imageSource(img) }))
    .filter(img => img.src && !existing.includes(img.src));
  if (!images.length) return '';
  return `
    <div class="editor-image-strip" contenteditable="false">
      ${images.map(img => `
        <figure class="editor-image-card">
          <img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.id || img.usage || '正文配图')}">
          <figcaption>${escapeHtml(img.usage || img.id || '正文配图')}</figcaption>
        </figure>
      `).join('')}
    </div>
  `;
}

function sanitizeClientCanonicalHtml(value, documentRef = document) {
  const blockedElements = new Set(['head', 'script', 'style', 'iframe', 'object', 'template', 'noscript', 'svg']);
  const allowedElements = new Set([
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'section', 'article',
    'strong', 'em', 'b', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'figure', 'figcaption', 'img', 'a', 'br', 'hr',
  ]);
  const allowedAttributes = {
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
  const safeUrl = (url, attribute) => {
    const normalized = String(url || '').trim().replace(/[\u0000-\u0020\u007f-\u009f]+/g, '');
    if (!normalized || normalized.startsWith('\\') || normalized.startsWith('//')) return false;
    const scheme = normalized.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() || '';
    if (!scheme) return true;
    if (attribute === 'href') return ['http', 'https', 'mailto', 'tel'].includes(scheme);
    if (['http', 'https'].includes(scheme)) return true;
    return /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i.test(normalized);
  };
  const container = documentRef.createElement('div');
  container.innerHTML = String(value || '');
  for (const element of [...container.querySelectorAll('*')]) {
    const tagName = element.tagName.toLowerCase();
    if (blockedElements.has(tagName)) {
      element.remove();
      continue;
    }
    if (!allowedElements.has(tagName)) {
      element.replaceWith(...element.childNodes);
      continue;
    }
    const allowed = allowedAttributes[tagName] || new Set(['title']);
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const attributeValue = attribute.value;
      const numeric = ['width', 'height', 'colspan', 'rowspan', 'span'].includes(name);
      const integer = ['start', 'value'].includes(name);
      const valid = allowed.has(name)
        && (name === 'href' || name === 'src' ? safeUrl(attributeValue, name) : true)
        && (!numeric || /^\d{1,5}$/.test(attributeValue))
        && (!integer || /^-?\d+$/.test(attributeValue))
        && (name !== 'align' || /^(?:left|center|right)$/i.test(attributeValue))
        && (name !== 'scope' || /^(?:row|col|rowgroup|colgroup)$/i.test(attributeValue))
        && (name !== 'class' || /^language-[A-Za-z0-9_+-]+$/.test(attributeValue));
      if (!valid) element.removeAttribute(attribute.name);
    }
  }
  return container.innerHTML;
}

function editableArticleHtml(content) {
  const body = String(content.body || '');
  return sanitizeClientCanonicalHtml(`${body}${contentImagesHtml(content, body)}`);
}

function render() {
  if (!state.data) return;
  renderDashboard();
  renderPlans();
  renderContent();
  renderPublish();
  renderPlatformLogin();
  renderHistory();
  renderRecoveryBanners();
}

function renderDashboard() {
  const { stats, platformDistribution, jobs = [] } = state.data;
  const max = Math.max(1, ...platformDistribution.map(item => item.count));
  const recentJobs = jobs.slice(0, 6);
  const distributionHtml = platformDistribution.length
    ? platformDistribution.slice(0, 12).map(item => `
      <div class="bar-row">
        <span title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(5, item.count / max * 100)}%"></div></div>
        <strong class="bar-count" title="成功 ${item.success || 0} 次，失败 ${item.failed || 0} 次">
          <b>${item.success || 0}/${item.count}</b>
          <em>成功/总数</em>
        </strong>
      </div>
    `).join('')
    : '<div class="empty compact-empty">暂无主流平台发布历史数据</div>';
  const recentHtml = recentJobs.length
    ? recentJobs.map(job => `
      <button class="recent-job" data-action="go-history">
        <span>
          <strong>${escapeHtml(job.title)}</strong>
          <em>${formatTime(job.created_at)} · ${job.platforms.map(platformName).join('、')}</em>
        </span>
        ${statePill(job.status)}
      </button>
    `).join('')
    : '<div class="empty compact-empty">暂无发布记录</div>';

  $('#view-dashboard').innerHTML = `
    <div class="section-head">
      <div>
        <h1>数据看板</h1>
        <p>集中查看发布结果、平台表现和最近发布记录。</p>
      </div>
      <div class="toolbar">
        <button class="primary" data-action="go-publish">进入发布中心</button>
      </div>
    </div>

    <div class="metrics">
      <div class="metric"><span>本周已发布</span><strong>${stats.thisWeekPublished}</strong></div>
      <div class="metric"><span>发布失败</span><strong>${stats.failed}</strong></div>
      <div class="metric"><span>待确认草稿</span><strong>${stats.pendingDrafts}</strong></div>
      <div class="metric"><span>已生成内容</span><strong>${stats.generated}</strong></div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <h2>主流平台发布历史分布</h2>
        <div class="bar-list">
          ${distributionHtml}
        </div>
      </div>
      <div class="panel">
        <h2>最近发布记录</h2>
        <div class="recent-list">
          ${recentHtml}
        </div>
      </div>
    </div>
  `;
}

function platformAccountLabel(platform) {
  const account = String(platform.account || '').trim();
  if (account) return account;
  if (platform.auth_status === 'logged_in' && INTERACTIVE_AUTH_PLATFORMS.has(platform.id)) {
    return '浏览器发布会话已连接';
  }
  if (platform.auth_status === 'logged_in') return '已登录，未返回账号';
  return '未登录或待检查';
}

function platformCard(platform) {
  const manualAuth=platform.auto_check_auth===false && platform.id!=='zip-download';
  const checking = state.authChecking.has(platform.id);
  const loggedIn = platform.auth_status === 'logged_in';
  const loggedOut = platform.auth_status === 'logged_out';
  const pendingSession = Boolean(state.loginSessions[platform.id]);
  const starting = state.loginStarting.has(platform.id);
  const finishing = state.loginFinishing.has(platform.id);
  const loginLabel = pendingSession
    ? (finishing ? '保存连接中' : manualAuth ? '完成连接' : '完成登录')
    : (starting ? '打开中' : manualAuth ? '连接登录窗口' : (loggedIn ? '重新登录' : '去登录'));
  const accountLabel = platformAccountLabel(platform);
  const statusClass = manualAuth ? 'unknown' : loggedIn ? 'logged-in' : loggedOut ? 'logged-out' : 'unknown';
  const cardClass = [
    checking ? 'checking' : '',
    statusClass,
  ].filter(Boolean).join(' ');
  const metaText = manualAuth ? '手工写作入口，登录情况以官网显示为准' : checking
    ? '正在检查登录状态...'
    : loggedIn
      ? accountLabel
      : loggedOut
        ? (platform.message || '未登录，需重新登录')
        : (platform.message || '待检查，可登录或点击全部检查');
  const actionHtml = pendingSession
    ? `<button class="mini-btn login-mini primary-mini" data-action="finish-login" data-platform="${platform.id}" ${finishing ? 'disabled' : ''} title="${escapeHtml(loginLabel)}">${escapeHtml(loginLabel)}</button>`
    : checking
      ? '<span class="checking-badge">检查中</span>'
      : loggedIn
      ? platform.id === 'zip-download' ? '<span class="field-note">无需登录</span>' : `<button class="mini-btn login-mini" data-action="start-login" data-platform="${platform.id}" title="重新连接登录浏览器">重新连接</button>`
      : `<button class="mini-btn login-mini needs-login" data-action="start-login" data-platform="${platform.id}" ${starting || checking ? 'disabled' : ''} title="${escapeHtml(loginLabel)}">${escapeHtml(loginLabel)}</button>`;
  return `
    <div class="platform-card ${cardClass}" data-platform-card="${platform.id}">
      <div class="platform-info">
        ${platformAvatar(platform)}
        <div class="platform-copy">
          <strong>${escapeHtml(platform.name)}</strong>
          <span class="platform-meta">${platform.id === 'uisdc' ? '手工投稿 · ' : ''}${escapeHtml(metaText)}</span>
        </div>
      </div>
      <div class="platform-actions">
        ${platform.manual_url || platform.id==='uisdc' ? `<button class="mini-btn" data-action="open-platform-session" data-platform="${escapeHtml(platform.id)}" data-url="${escapeHtml(platform.manual_url || UISDC_SUBMISSION_URL)}">${platform.id==='uisdc'?'去投稿':'打开写作后台'}</button>` : ''}
        ${actionHtml}
      </div>
    </div>
  `;
}

function renderPlans() {
  const plans = state.data.plans.filter(plan => {
    if (state.planStartDate && plan.date < state.planStartDate) return false;
    if (state.planEndDate && plan.date > state.planEndDate) return false;
    return true;
  });
  $('#view-plans').innerHTML = `
    <div class="section-head plan-page-head">
      <div>
        <h1>选题计划</h1>
        <p>先采集真实线索，再用共用选题 Skill 分析；采用后进入计划，不自动写稿或发布。</p>
      </div>
      <div class="toolbar">
        <button class="secondary" data-action="open-plan-range">新增计划</button>
        <button class="primary" data-action="go-history">发布历史</button>
      </div>
    </div>

    ${topicResearchPanel()}

    <div class="panel plan-filter-panel">
      <div class="panel-head plan-card-head">
        <div>
          <h2>日期范围</h2>
          <span>切换周期，查看或编辑对应日期的选题安排</span>
        </div>
      </div>
      <div class="plan-range-tools">
        <button class="mini-btn" data-action="shift-plan-range" data-days="-7">上一周</button>
        <label class="date-control"><span>开始</span><input type="date" data-plan-range="start" value="${escapeHtml(state.planStartDate)}"></label>
        <label class="date-control"><span>结束</span><input type="date" data-plan-range="end" value="${escapeHtml(state.planEndDate)}"></label>
        <button class="mini-btn" data-action="shift-plan-range" data-days="7">下一周</button>
      </div>
    </div>

    <div class="panel plan-table-panel">
      <div class="panel-head plan-card-head">
        <div>
          <h2>计划明细</h2>
          <span>点击单元格即可编辑，状态可直接切换</span>
        </div>
      </div>
      <div class="table-scroll">
      <table class="editable-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>选题方向</th>
            <th>内容类型</th>
            <th>目标受众</th>
            <th>关联素材</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${plans.length ? plans.map(plan => `
            <tr data-plan-row="${plan.date}">
              <td><strong>${plan.weekday}</strong><br><span>${plan.date}</span></td>
              <td><input class="table-input plan-field-input wide" data-plan-field="topic" value="${escapeHtml(plan.topic || '')}" placeholder="未填写"></td>
              <td><input class="table-input plan-field-input" data-plan-field="type" value="${escapeHtml(plan.type || '')}" placeholder="未填写"></td>
              <td><input class="table-input plan-field-input" data-plan-field="audience" value="${escapeHtml(plan.audience || '')}" placeholder="未填写"></td>
              <td><input class="table-input plan-field-input" data-plan-field="materials" value="${escapeHtml(plan.materials || '')}" placeholder="未填写"></td>
              <td class="status-cell"><select class="table-input status-select ${statusClass(plan.status)}" data-plan-field="status">${planStatusOptions(plan.status)}</select></td>
              <td>
                <div class="table-actions">
                  ${planActions(plan)}
                </div>
              </td>
            </tr>
          `).join('') : '<tr><td colspan="7"><div class="empty">当前日期范围没有计划，可点击“新增计划”批量生成。</div></td></tr>'}
        </tbody>
      </table>
      </div>
    </div>
  `;
}

function planActions(plan) {
  const mainAction = plan.content_id
    ? `<button class="row-primary-action" data-action="open-content" data-id="${plan.content_id}">编辑正文</button>`
    : `<button class="row-primary-action" data-action="open-import-dialog">导入成稿</button>`;
  const menuActions = [
    `<button data-action="save-plan" data-date="${plan.date}">保存修改</button>`,
    `<button data-action="generate-topics" data-date="${plan.date}">启动选题</button>`,
  ];
  if (plan.content_id) {
    menuActions.push(`<button data-action="open-content" data-id="${plan.content_id}">打开关联文章</button>`);
  }
  return `
    ${mainAction}
    <details class="action-menu">
      <summary aria-label="更多操作" title="更多操作">...</summary>
      <div class="action-menu-popover">
        ${menuActions.join('')}
      </div>
    </details>
  `;
}

function previewPlatformRecord(platformId) {
  return state.data?.platforms?.find(platform => platform.id === platformId) || {
    id: platformId,
    name: PLATFORM_NAMES[platformId] || platformId,
  };
}

function platformTabId(platformId) {
  const safeId = String(platformId || '').replace(/[^a-z0-9_-]+/gi, '-');
  return `platform-preview-tab-${safeId}`;
}

function ensureActivePreviewPlatform() {
  const platforms = state.data?.platforms || [];
  if (platforms.some(platform => platform.id === state.activePreviewPlatform)) return;
  state.activePreviewPlatform = FEATURED_PREVIEW_PLATFORMS.find(id => (
    platforms.some(platform => platform.id === id)
  )) || platforms[0]?.id || 'weixin';
}

function platformPreviewKey(content, platform) {
  const revision = typeof state !== 'undefined' && state.dirtyContentIds?.has(String(content?.id))
    ? `draft-${state.contentEditRevisions?.get(String(content.id)) || 0}` : content?.updated_at || content?.created_at || '';
  const template = platform === 'weixin' && String(revision).startsWith('draft-')
    ? `::${state.selectedWechatTemplate || ''}` : '';
  return `${content?.id || ''}::${revision}::${platform || ''}${template}`;
}

function clearPlatformPreviews(contentId) {
  const prefix = `${contentId}::`;
  for (const key of state.previewCache.keys()) {
    if (key.startsWith(prefix)) state.previewCache.delete(key);
  }
  for (const key of state.previewErrors.keys()) {
    if (key.startsWith(prefix)) state.previewErrors.delete(key);
  }
}

async function loadPlatformPreview(content, platform) {
  if (!content?.id || !platform) return;
  const key = platformPreviewKey(content, platform);
  if (state.previewCache.has(key) || state.previewLoading.has(key)) return;

  state.previewErrors.delete(key);
  state.previewLoading.add(key);
  renderPlatformAdaptationPane();
  try {
    const dirty = state.dirtyContentIds.has(String(content.id));
    const result = dirty ? await request(`/api/content/${encodeURIComponent(content.id)}/draft-preview`, {
      method: 'POST', body: JSON.stringify({ platform, template: state.selectedWechatTemplate,
        title: $(`[data-content-title="${content.id}"]`)?.value ?? content.title,
        summary: $(`[data-content-summary="${content.id}"]`)?.value ?? content.summary,
        body: $(`[data-content-body="${content.id}"]`)?.innerHTML ?? content.body }),
    }) : await request(`/api/content/${encodeURIComponent(content.id)}/platform-preview?platform=${encodeURIComponent(platform)}`);
    if (key === platformPreviewKey(getSelectedContent(), platform)) state.previewCache.set(key, result.preview);
  } catch (error) {
    if (key === platformPreviewKey(getSelectedContent(), platform)) state.previewErrors.set(key, error.message || '平台预览加载失败');
  } finally {
    state.previewLoading.delete(key);
    renderPlatformAdaptationPane();
  }
}

function selectPreviewPlatform(platform) {
  if (state.contentOperationLocks.has(String(state.selectedContentId))) {
    toast('正文操作正在进行，请稍候', 'error');
    return;
  }
  if (!state.data?.platforms?.some(item => item.id === platform)) {
    toast('当前平台不可用', 'error');
    return;
  }
  state.activePreviewPlatform = platform;
  renderPlatformAdaptationPane();
  void loadPlatformPreview(getSelectedContent(), platform);
}

function previewLimitChips(preview) {
  const limits = preview?.limits || {};
  const chips = [
    `<span>${escapeHtml(PREVIEW_FORMAT_LABELS[preview?.format] || preview?.format || '未知格式')}</span>`,
    `<span>${Number(preview?.imageCount || 0)} 个图片引用</span>`,
  ];
  if (Number.isFinite(limits.maxTitleLength)) {
    chips.push(`<span>标题上限 ${limits.maxTitleLength} 字</span>`);
  }
  if (Number.isFinite(limits.maxImages)) {
    chips.push(`<span>图片上限 ${limits.maxImages} 张</span>`);
  }
  return chips.join('');
}

function platformPreviewDocument(preview, platform) {
  if (preview.format === 'html') {
    const html = preview.htmlPreview || preview.content || '';
    // The iframe is its own document: dashboard CSS cannot constrain its images.
    // Keep WeChat's template HTML untouched; supply a reading canvas for woshipm.
    const srcdoc = ['woshipm','uisdc','jianshu','netease'].includes(platform) ? `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      html{background:#fff;color:#252525;}body{margin:0;font:16px/1.85 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;}
      .workbench-reading-column{box-sizing:border-box;width:100%;max-width:760px;min-width:0;margin:0 auto;padding:32px;overflow-wrap:anywhere;}
      .workbench-reading-column p,.workbench-reading-column figure{margin:0 0 1.4em;max-width:100%;}
      .workbench-reading-column img{box-sizing:border-box;display:block;max-width:100%!important;min-width:0!important;height:auto!important;margin-left:auto;margin-right:auto;}
      .workbench-reading-column h1{font-size:28px;line-height:1.5;margin:0 0 24px;}.workbench-reading-column h2{font-size:22px;line-height:1.5;margin:1.7em 0 .8em;}
      .workbench-reading-column pre{max-width:100%;overflow:auto;}.workbench-reading-column blockquote{margin:1.4em 0;padding-left:16px;border-left:3px solid #ddd;}
      @media(max-width:600px){.workbench-reading-column{padding:20px 16px;}.workbench-reading-column h1{font-size:24px;}}
      </style></head><body><main class="workbench-reading-column">${html}</main></body></html>` : html;
    return `
      <iframe class="platform-preview-iframe" title="${escapeHtml(platformName(platform))}适配预览" sandbox srcdoc="${escapeHtml(srcdoc)}" referrerpolicy="no-referrer"></iframe>
    `;
  }
  return `<pre class="platform-plain-preview">${escapeHtml(preview.content || '')}</pre>`;
}

function wechatTemplateControls(content) {
  const choices = state.templateCatalogNamed ? distinctWechatTemplates(state.layoutTemplates, state.selectedWechatTemplate) : state.layoutTemplates;
  const templateOptions = choices.map(template => `
    <option value="${escapeHtml(template.filename)}" ${template.filename === state.selectedWechatTemplate ? 'selected' : ''}>${escapeHtml(template.label)}</option>
  `).join('');
  const unavailableMessage = state.layoutTemplatesError
    ? `<span class="template-load-note error" role="status">${escapeHtml(state.layoutTemplatesError)}</span>`
    : state.layoutTemplatesLoading || !state.layoutTemplatesLoaded
      ? '<span class="template-load-note" role="status">正在载入排版模板…</span>'
      : !state.layoutTemplates.length
        ? '<span class="template-load-note error" role="status">暂无可用排版模板</span>'
        : '';
  const templateDisabled = !state.layoutTemplates.length;
  const previewUrl = `/content/${encodeURIComponent(content.id)}/preview.html`;
  return `
    <div class="wechat-layout-tools">
      <div class="wechat-template-field">
        <label for="wechat-template-select">公众号排版模板（${choices.length} ${state.templateCatalogNamed ? '种风格' : '个模板文件'}）</label>
        <select id="wechat-template-select" data-wechat-template-select ${templateDisabled ? 'disabled' : ''}>
          ${templateOptions || '<option value="">模板载入后可选择</option>'}
        </select>
      </div>
      <div class="wechat-layout-actions">
        <button class="secondary" type="button" data-action="random-wechat-template" ${templateDisabled ? 'disabled' : ''}>随机模板</button>
        <button class="primary" type="button" data-action="generate-wechat-layout" data-id="${escapeHtml(content.id)}" ${templateDisabled ? 'disabled' : ''}>生成排版</button>
        <a class="secondary link-action" href="${previewUrl}" target="_blank" rel="noopener">打开完整 HTML</a>
      </div>
      ${unavailableMessage}
      ${state.templateCatalogNamed && choices.length < state.layoutTemplates.length ? '<p class="field-note template-alias-note">同款副本已合并展示，已有文章的模板关联不变。</p>' : ''}
    </div>
  `;
}

function platformPreviewResult(content, platform) {
  const key = platformPreviewKey(content, platform);
  const preview = state.previewCache.get(key);
  const error = state.previewErrors.get(key);
  const loading = state.previewLoading.has(key);

  if (loading) {
    return `
      <div class="platform-preview-state" role="status" aria-live="polite">
        <span class="preview-spinner" aria-hidden="true"></span>
        <strong>正在生成 ${escapeHtml(platformName(platform))} 适配预览</strong>
        <span>首次打开该平台时按需加载</span>
      </div>
    `;
  }
  if (error) {
    return `
      <div class="platform-preview-state error" role="alert" aria-live="assertive">
        <strong>预览加载失败</strong>
        <span>${escapeHtml(error)}</span>
        <button class="secondary" type="button" data-action="retry-platform-preview" data-platform="${escapeHtml(platform)}">重试</button>
      </div>
    `;
  }
  if (!preview) {
    return '<div class="platform-preview-state" role="status" aria-live="polite"><strong>正在准备预览</strong></div>';
  }

  const notices = [...(preview.warnings || [])];
  const imageHtml = String(preview.article?.html || preview.htmlPreview || '');
  const relativeImages = [...imageHtml.matchAll(/<img\b[^>]*\bsrc=["']([^"']*)["']/gi)]
    .filter(match => !/^(?:https?:|data:image\/|\/uploads\/)/i.test(match[1])).length;
  if (relativeImages) notices.push(`存在 ${relativeImages} 个本地或相对图片引用，尚不能确认平台可访问。`);
  if (platform === 'woshipm' && /<table\b/i.test(imageHtml)) {
    notices.push('当前适配器尚未将表格转成图片，投递前需要处理。');
  }
  const warnings = notices.length
    ? `<ul>${notices.map(warning => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`
    : '<p class="preview-check-ok">基础格式已处理。图片可用性与平台最终效果仍需核对。</p>';
  return `
    <div class="platform-preview-summary">
      <div>
        <span>${escapeHtml(platformName(platform))} · ${preview.sourceState === 'unsaved' ? '未保存编辑预览，不会自动保存或发布' : '已保存母稿的适配结果'}</span>
      </div>
      <div class="preview-limit-chips">${previewLimitChips(preview)}</div>
    </div>
    <div class="preview-warning-box" aria-label="平台适配检查">
      ${warnings}
    </div>
    <div class="platform-preview-stage">
      <div class="platform-preview-frame is-${escapeHtml(state.previewDevice)}">
        ${platformPreviewDocument(preview, platform)}
      </div>
    </div>
  `;
}

function platformAdaptationHtml(content) {
  ensureActivePreviewPlatform();
  const platform = state.activePreviewPlatform;
  const allPlatforms = sortLoginPlatforms(state.data?.platforms || []);
  const featured = FEATURED_PREVIEW_PLATFORMS.map(id => previewPlatformRecord(id));
  const activeIsFeatured = FEATURED_PREVIEW_PLATFORMS.includes(platform);
  const rovingTabPlatform = activeIsFeatured ? platform : FEATURED_PREVIEW_PLATFORMS[0];
  const preparation = platformPreparationMode(platform);
  const manualOnly = preparation === 'manual';
  const manualUrl = allPlatforms.find(p=>p.id===platform)?.manual_url || (platform==='uisdc' ? UISDC_SUBMISSION_URL : '');
  const handoff = platformHandoffResult(content.id, platform);
  return `
    <div class="platform-adaptation-head">
      <div>
        <h2>${escapeHtml(platformName(platform))} 预览</h2>
      </div>
      <div class="preview-device-control" role="group" aria-label="预览设备">
        <button type="button" data-action="select-preview-device" data-preview-device="desktop" data-platform-focus-key="device:desktop" class="${state.previewDevice === 'desktop' ? 'active' : ''}" aria-pressed="${state.previewDevice === 'desktop'}">桌面</button>
        <button type="button" data-action="select-preview-device" data-preview-device="mobile" data-platform-focus-key="device:mobile" class="${state.previewDevice === 'mobile' ? 'active' : ''}" aria-pressed="${state.previewDevice === 'mobile'}">手机</button>
      </div>
    </div>

    <div class="platform-selection-row">
    <div class="platform-preview-tabs" role="tablist" aria-label="常用平台">
      ${featured.map(item => `
        <button id="${escapeHtml(platformTabId(item.id))}" type="button" role="tab" aria-controls="platform-preview-panel" aria-selected="${platform === item.id}" tabindex="${rovingTabPlatform === item.id ? '0' : '-1'}" class="platform-preview-tab ${platform === item.id ? 'active' : ''}" data-action="select-preview-platform" data-platform="${escapeHtml(item.id)}" data-platform-focus-key="tab:${escapeHtml(item.id)}">
          ${platformAvatar(item)}
          <span>${escapeHtml(item.name)}</span>
        </button>
      `).join('')}
    </div>

    <label class="all-platform-selector" for="platform-preview-select">
      <span>全部平台</span>
      <select id="platform-preview-select" data-platform-preview-select data-platform-focus-key="selector">
        ${allPlatforms.map(item => `<option value="${escapeHtml(item.id)}" ${platform === item.id ? 'selected' : ''}>${escapeHtml(item.name || item.id)}</option>`).join('')}
      </select>
    </label>

    </div>
    <div id="platform-preview-panel" class="platform-preview-panel" role="tabpanel" ${activeIsFeatured ? `aria-labelledby="${escapeHtml(platformTabId(platform))}"` : `aria-label="${escapeHtml(platformName(platform))} 平台适配预览"`}>
      ${platform === 'weixin' ? wechatTemplateControls(content) : ''}

      <div class="platform-publish-actions">
        ${manualOnly ? `<button class="primary" type="button" data-action="open-platform-session" data-platform="${escapeHtml(platform)}" data-url="${escapeHtml(manualUrl)}" ${manualUrl?'':'disabled'}>${platform==='uisdc'?'去优设投稿':'打开写作后台'}</button>` : `
        <button class="primary" type="button" data-action="open-platform-draft" data-id="${escapeHtml(content.id)}" data-platform="${escapeHtml(platform)}">${preparation === 'editor' ? '准备平台编辑器' : preparation === 'draft-text' ? '同步纯文字草稿' : preparation === 'export' ? '导出到本机' : '同步该平台草稿'}</button>
        ${preparation !== 'export' ? `<button class="secondary" type="button" data-action="open-platform-session" data-platform="${escapeHtml(platform)}" data-url="${escapeHtml(handoff?.url || '')}" ${handoff?.url ? '' : 'disabled'} aria-describedby="platform-delivery-note">${handoff?.status === 'uncertain' ? '去平台核对结果' : '检查草稿并发表'}</button>` : ''}
        `}
      </div>
      <p id="platform-delivery-note" class="field-note platform-delivery-note">${manualOnly ? '此平台需在官方写作入口手工投稿，工作台只提供本地预览。' : preparation === 'export' ? '只导出到本机，不会发表文章。' : `${preparation === 'editor' ? '只准备编辑器内容，不能确认云端草稿已保存。' : preparation === 'draft-text' ? '仅支持纯文字草稿，带图或封面会阻止同步。' : '同步只保存平台草稿，不会公开发表。'}${handoff?.url ? '核对入口打开最近一次同步的稿件；本地后续修改不会自动覆盖它。' : '同步后会提供对应的稿件核对入口。'}最终内容、发表时间和通知方式由你在平台确认。${platform === 'weixin' ? '公众号“不群发通知”仍是公开发表，不是草稿；发表时请单独检查群发通知开关。' : ''}`}</p>

      <div class="platform-preview-live" data-platform-preview-live>
        ${platformPreviewResult(content, platform)}
      </div>
    </div>
  `;
}

function platformPaneFocusKey(element, host) {
  if (!element || !host?.contains(element)) return '';
  return element.closest?.('[data-platform-focus-key]')?.dataset.platformFocusKey || '';
}

function restorePlatformPaneFocus(host, focusKey) {
  if (!host || !focusKey) return;
  [...host.querySelectorAll('[data-platform-focus-key]')]
    .find(control => control.dataset.platformFocusKey === focusKey)
    ?.focus();
}

function renderPlatformAdaptationPane() {
  const host = $('[data-platform-adaptation-pane]');
  const content = getSelectedContent();
  if (!host || !content || host.dataset.contentId !== String(content.id)) return;
  const focusKey = platformPaneFocusKey(document.activeElement, host);
  host.innerHTML = platformAdaptationHtml(content);
  restorePlatformPaneFocus(host, focusKey);
}

function renderContent() {
  const allContents = state.data.contents;
  const totalPages = Math.max(1, Math.ceil(allContents.length / state.contentPageSize));
  state.contentPage = Math.min(Math.max(1, state.contentPage), totalPages);
  const start = (state.contentPage - 1) * state.contentPageSize;
  const contents = allContents.slice(start, start + state.contentPageSize);
  const selected = allContents.find(content => content.id === state.selectedContentId) || null;
  if (selected) {
    const stored = String(selected.layout_html || '').match(/data-wechat-template="([^"]+)"/);
    state.selectedWechatTemplate = state.wechatTemplateChoices?.get(selected.id) || stored?.[1] || state.selectedWechatTemplate;
  }
  ensureActivePreviewPlatform();
  $('#view-content').innerHTML = `
    <div class="section-head">
      <div>
        <h1>内容中心</h1>
        <p>写好一篇文章，在这里整理、预览，再交给各个平台。</p>
      </div>
      <div class="toolbar">
        <span class="workspace-local-note">母稿保存在本机</span>
        <button class="secondary" type="button" data-action="toggle-content-library" aria-controls="content-library">文章列表（${allContents.length}）</button>
        <button class="primary" type="button" data-action="open-import-dialog">导入文章</button>
      </div>
    </div>

    <div data-publish-recovery-banner></div>
    <div class="content-layout content-layout-stacked" data-library-visibility="${state.libraryVisibility || 'auto'}">
      <div id="content-library" class="panel content-list-panel content-list-wide">
        <div class="panel-head compact-head">
          <div>
            <h2>我的文章</h2>
            <span>${allContents.length} 篇 · 本地内容库</span>
          </div>
        </div>
        <div class="content-list content-strip">
          ${contents.length ? contents.map(content => `
            <button class="content-item ${selected?.id === content.id ? 'active' : ''}" data-action="select-content" data-id="${content.id}">
              <span class="content-item-kicker">${escapeHtml(content.type || '内容稿')}</span>
              <strong>${escapeHtml(content.title)}</strong>
              <span class="content-item-summary">${escapeHtml(content.summary || '点击打开正文草稿')}</span>
              <span class="content-item-meta">${formatTime(content.updated_at || content.created_at)} ${statePill(content.status)}</span>
            </button>
          `).join('') : '<div class="empty">还没有文章。导入一篇写好的稿件，开始整理与分发。</div>'}
        </div>
        ${contentPagination(allContents.length, totalPages)}
      </div>

      ${selected ? `
        <div class="panel content-detail-panel">
          ${contentDetail(selected)}
        </div>
      ` : '<div class="empty content-empty-state">请选择一篇文章打开正文草稿</div>'}
    </div>
  `;
  if (selected) bindContentEditorDirtyTracking(selected.id);
  renderRecoveryBanners();
  if (typeof syncContentLibraryButton === 'function') syncContentLibraryButton();
  if (selected && state.activeView === 'content') {
    void loadPlatformPreview(selected, state.activePreviewPlatform);
  }
}

function contentDetail(content) {
  const isDirty = state.dirtyContentIds.has(String(content.id));
  return `
    <div class="content-detail-head">
      <div class="content-title-block">
        <h2>${escapeHtml(content.title)}</h2>
        <p class="content-detail-description">一份母稿，分别检查各平台的呈现与投递结果。</p>
        <div class="content-status-row">
          ${statePill(content.status)}
          <span>${escapeHtml(content.type || '内容稿')}</span>
          <span class="editor-save-state ${isDirty ? 'is-dirty' : ''}" data-content-save-state="${escapeHtml(content.id)}" role="status" aria-live="polite">${isDirty ? '有未保存更改' : '所有更改已保存'}</span>
        </div>
      </div>
      <div class="editor-actions">
        <button class="primary compact-action editor-save-action ${isDirty ? '' : 'is-hidden'}" type="button" data-action="save-content" data-id="${escapeHtml(content.id)}" data-save-content-button="${escapeHtml(content.id)}">保存正文</button>
        <button class="secondary compact-action" type="button" data-action="save-draft" data-id="${escapeHtml(content.id)}">保存本地草稿</button>
      </div>
    </div>
    <div class="content-mode-toolbar">
      <div class="content-mode-tabs" role="tablist" aria-label="写作与平台预览">
        <button id="content-mode-edit" type="button" role="tab" data-action="select-content-mode" data-content-mode="edit" aria-controls="content-editor-panel" aria-selected="${state.contentMode !== 'preview'}" tabindex="${state.contentMode !== 'preview' ? '0' : '-1'}">编辑正文</button>
        <button id="content-mode-preview" type="button" role="tab" data-action="select-content-mode" data-content-mode="preview" aria-controls="content-preview-panel" aria-selected="${state.contentMode === 'preview'}" tabindex="${state.contentMode === 'preview' ? '0' : '-1'}">平台预览</button>
      </div>
      <span class="field-note">切换保留当前编辑，不会自动保存</span>
    </div>
    <div class="content-adaptation-workspace" data-content-mode="${state.contentMode || 'edit'}">
      <section id="content-editor-panel" class="canonical-editor-pane" role="tabpanel" aria-labelledby="content-mode-edit" ${state.contentMode === 'preview' ? 'hidden' : ''}>
        <div class="workspace-pane-head visually-hidden">
          <div>
            <h2 id="canonical-editor-heading">正文编辑</h2>
            <p>专注正文，切换到平台预览检查格式。</p>
          </div>
        </div>

        <details class="article-metadata">
          <summary>标题与摘要 <span>展开编辑</span></summary>
        <div class="canonical-editor-fields" data-user-editable>
          <label for="canonical-title-editor"><span>文章标题</span></label>
          <input id="canonical-title-editor" type="text" value="${escapeHtml(content.title)}" data-content-title="${escapeHtml(content.id)}" aria-describedby="canonical-save-hint">
          <label for="canonical-summary-editor"><span>文章摘要</span></label>
          <textarea id="canonical-summary-editor" rows="3" data-content-summary="${escapeHtml(content.id)}" aria-describedby="canonical-save-hint">${escapeHtml(content.summary || '')}</textarea>
        </div>
        </details>
        <div class="canonical-body-label" id="canonical-body-label">文章正文</div>
        <div class="content-editor rich-content-editor" data-content-body="${escapeHtml(content.id)}" data-user-editable data-imported-article contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="canonical-body-label" aria-describedby="canonical-save-hint" spellcheck="false">${editableArticleHtml(content)}</div>
        <p id="canonical-save-hint" class="field-note">切到“平台预览”查看当前编辑的呈现；点击“保存正文”才会保存。摘要可以留空，平台发布仍使用已确认保存的版本。</p>
      </section>

      <section id="content-preview-panel" class="platform-adaptation-pane" role="tabpanel" aria-labelledby="content-mode-preview" data-platform-adaptation-pane data-content-id="${escapeHtml(content.id)}" ${state.contentMode === 'preview' ? '' : 'hidden'}>
        ${platformAdaptationHtml(content)}
      </section>
    </div>
  `;
}

function contentPagination(total, totalPages) {
  if (total <= state.contentPageSize) return '';
  const from = (state.contentPage - 1) * state.contentPageSize + 1;
  const to = Math.min(total, state.contentPage * state.contentPageSize);
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1)
    .filter(page => page === 1 || page === totalPages || Math.abs(page - state.contentPage) <= 1);
  return `
    <div class="pagination content-pagination">
      <span>${from}-${to} / ${total}</span>
      <div class="pagination-actions">
        <button class="mini-btn" data-action="content-page" data-page="${state.contentPage - 1}" ${state.contentPage <= 1 ? 'disabled' : ''}>上一页</button>
        ${pages.map((page, index) => {
          const previous = pages[index - 1];
          const gap = previous && page - previous > 1 ? '<span class="page-gap">...</span>' : '';
          return `${gap}<button class="mini-btn ${page === state.contentPage ? 'active-page' : ''}" data-action="content-page" data-page="${page}">${page}</button>`;
        }).join('')}
        <button class="mini-btn" data-action="content-page" data-page="${state.contentPage + 1}" ${state.contentPage >= totalPages ? 'disabled' : ''}>下一页</button>
      </div>
    </div>
  `;
}

function layoutPreviewFrame(content) {
  const previewUrl = `/content/${encodeURIComponent(content?.id || '')}/preview.html`;
  if (!content?.layout_html) {
    return `
      <div class="phone-shell" aria-label="微信公众号阅读预览">
        <div class="wechat-preview-frame">
          <div class="wechat-preview-meta">
            <span class="wechat-avatar">W</span>
            <div>
              <strong>公众号文章预览</strong>
              <span>公众号文章阅读环境</span>
            </div>
          </div>
          <div class="wechat-preview-body">
            <div class="layout-preview"><div class="empty">尚未生成排版预览</div></div>
          </div>
        </div>
      </div>
    `;
  }
  return `
    <div class="phone-shell" aria-label="微信公众号阅读预览">
      <div class="wechat-preview-frame">
        <div class="wechat-preview-meta">
          <span class="wechat-avatar">W</span>
          <div>
            <strong>公众号文章预览</strong>
            <span>公众号文章阅读环境</span>
          </div>
        </div>
        <div class="wechat-preview-body">
          <iframe class="layout-preview-iframe" src="${previewUrl}" title="${escapeHtml(content?.title || '排版预览')}" sandbox loading="lazy"></iframe>
        </div>
      </div>
    </div>
  `;
}

function openLayoutDialog(content) {
  const previewUrl = `/content/${encodeURIComponent(content?.id || '')}/preview.html`;
  $('#layout-dialog-title').textContent = content?.title || '';
  $('#layout-dialog-body').innerHTML = `
    <div class="layout-dialog-preview">
      <div class="layout-preview-actions">
        <a class="secondary compact-action link-action" href="${previewUrl}" target="_blank" rel="noopener">在浏览器打开HTML预览</a>
      </div>
      ${layoutPreviewFrame(content)}
    </div>
  `;
  $('#layout-dialog').showModal();
}

function renderPublish() {
  const content = getSelectedContent();
  const platforms = sortLoginPlatforms(state.data.platforms);
  const selectedCount = [...state.selectedPlatforms].filter(id => !batchPlatformRestriction(id)).length;
  const jobs = state.data.jobs.filter(job => String(job.content_id) === String(content?.id));
  $('#view-publish').innerHTML = `
    <div class="section-head">
      <div>
        <h1>发布中心</h1>
        <p>准备内容 → 同步平台草稿 → 你检查后发表。工作台不会自动公开文章或通知粉丝。</p>
      </div>
    </div>

    <div data-publish-recovery-banner></div>
    <div class="grid-2">
      <div class="panel">
        <h2>目标内容</h2>
        ${content ? `
          <div class="title-cell">
            <strong>${escapeHtml(content.title)}</strong>
            <span>${escapeHtml(content.summary || '')}</span>
          </div>
          <div style="margin-top:12px;">${statePill(content.status)}</div>
          <div class="publish-preview">
            <span>待同步正文预览</span>
            <div class="publish-rich-preview rich-content-editor" aria-label="待同步正文预览">
              ${editableArticleHtml(content)}
            </div>
          </div>
        ` : '<div class="empty">暂无可发布内容</div>'}
      </div>
      <div class="panel">
        <h2>同步结果与人工核对</h2>
        <div id="publish-progress" class="publish-result">
          ${jobs.length ? jobResult(jobs[0]) : '<div class="empty">暂无发布记录</div>'}
        </div>
      </div>
    </div>

    <div class="panel publish-platform-panel">
      <h2>文章发布与导出（${platforms.filter(p=>p.id!=='zip-download').length} 个平台）</h2>
      <p class="field-note">选择目标平台，每项均标明支持的内容准备方式。</p>
      ${platformCatalogGroups(platforms).map(group=>group.id==='technical'
        ? `<details class="platform-catalog-group" data-platform-group="technical" ${group.platforms.some(p=>state.selectedPlatforms.has(p.id))?'open':''}><summary>${escapeHtml(group.name)}（${group.platforms.length}）</summary>${platformPickerHtml(group.platforms)}</details>`
        : `<section class="platform-catalog-group" data-platform-group="${group.id}"><h3>${escapeHtml(group.name)}（${group.platforms.length}）</h3>${group.id==='tool'?'<p class="field-note">只导出到本机，不会发布到网站。</p>':''}${platformPickerHtml(group.platforms)}</section>`).join('')}
      <div class="publish-bottom-actions">
        <span class="tag" data-selected-platform-count>已选择 ${selectedCount} 项</span>
        <div class="batch-publish-buttons">
          <button class="primary publish-bottom-button" data-action="publish-selected" aria-describedby="batch-delivery-note" disabled>同步草稿 / 准备内容</button>
        </div>
      </div>
      <p id="batch-delivery-note" class="field-note" data-batch-delivery-note aria-live="polite"></p>
    </div>
  `;
  syncPublishSelectionUi();
}

function sessionOpenButton(platform, url, label) {
  return `<button class="inline-link" data-action="open-platform-session" data-platform="${escapeHtml(platform)}" data-url="${escapeHtml(url)}">${escapeHtml(label)}</button>`;
}

function resultPlatformNode(result) {
  const name = platformName(result.platform);
  if (['success', 'platform_draft', 'uncertain'].includes(result.status) && result.url) {
    return `<button class="result-platform-link" data-action="open-platform-session" data-platform="${escapeHtml(result.platform)}" data-url="${escapeHtml(result.url)}" title="使用该平台登录会话打开">${escapeHtml(name)}</button>`;
  }
  return `<span class="result-platform-name">${escapeHtml(name)}</span>`;
}

function resultDetailNode(result) {
  const message = result.message || result.error || '未知原因';
  if (result.status === 'uncertain') {
    const guidance = '禁止自动重试，请到平台后台人工核对';
    const detail = `${guidance}。平台返回：${message}`;
    return `<span class="failure-help" data-tooltip="${escapeHtml(detail)}" aria-label="${escapeHtml(detail)}">!</span>`;
  }
  if (result.status === 'failed') {
    return `<span class="failure-help" data-tooltip="${escapeHtml(message)}" aria-label="${escapeHtml(message)}">!</span>`;
  }
  return '';
}

function jobResult(job) {
  if (!job?.results?.length) return '<span class="tag">无平台结果</span>';
  return job.results.map(result => `
    <div class="result-line compact-result ${result.status === 'failed' || result.status === 'uncertain' ? 'failed-result' : ''}">
      ${resultPlatformNode(result)}
      <span class="result-status-label">${escapeHtml(statusLabel(result.status))}</span>
      ${resultDetailNode(result)}
      ${['platform_draft','uncertain'].includes(result.status) && result.url ? sessionOpenButton(result.platform, result.url, result.status === 'platform_draft' ? '检查草稿并发表' : '去平台核对') : ''}
      ${['uncertain','failed','platform_draft','retry_allowed'].includes(result.status) ? `<button class="mini-btn" data-action="open-publish-recovery" data-id="${escapeHtml(job.content_id || '')}" data-platform="${escapeHtml(result.platform)}">${result.status === 'platform_draft' ? '查看已有草稿' : '恢复 / 核对'}</button>` : ''}
    </div>
  `).join('');
}

function historyResultChip(result) {
  const failed = result.status === 'failed' || result.status === 'uncertain';
  const message = result.message || result.error || '';
  const label = `${platformName(result.platform)} · ${statusLabel(result.status)}`;
  return `
    <span class="history-result-chip ${failed ? 'failed' : 'success'}" title="${escapeHtml(message || label)}">
      ${resultPlatformNode(result)}
      <span class="result-status-label">${escapeHtml(statusLabel(result.status))}</span>
      ${failed ? resultDetailNode(result) : ''}
    </span>
  `;
}

function historyJobResult(job) {
  const results = Array.isArray(job?.results) ? job.results : [];
  if (!results.length) return '<span class="tag">无平台结果</span>';
  const visibleCount = 6;
  const visible = results.slice(0, visibleCount);
  const hidden = results.slice(visibleCount);
  return `
    <div class="history-result-list">
      ${visible.map(historyResultChip).join('')}
      ${hidden.length ? `
        <details class="history-result-more">
          <summary>
            <span class="more-closed-label">展开 ${hidden.length} 个平台</span>
            <span class="more-open-label">收起平台</span>
          </summary>
          <div class="history-result-more-list">
            ${hidden.map(historyResultChip).join('')}
          </div>
        </details>
      ` : ''}
    </div>
  `;
}

function renderPlatformLogin() {
  const platforms = state.data.platforms.filter(p=>p.id!=='zip-download');
  const sortedPlatforms = sortLoginPlatforms(platforms);
  const loggedIn = platforms.filter(platform => platform.id !== 'zip-download' && platform.auth_status === 'logged_in').length;
  $('#view-platforms').innerHTML = `
    <div class="section-head">
      <div>
        <h1>平台登录</h1>
        <p>在一处连接常用平台。会话失效时重新登录，凭据不会显示在界面中。</p>
      </div>
      <div class="toolbar">
        <button class="secondary" data-action="refresh-platforms">刷新平台</button>
        <button class="primary" data-action="check-all-auth" ${state.authCheckingAll ? 'disabled' : ''}>
          ${state.authCheckingAll ? '检查中' : '全部检查'}
        </button>
      </div>
    </div>

    <div class="metrics compact-metrics">
      <div class="metric split-metric"><span>文章平台</span><strong>${platforms.length}</strong></div>
      <div class="metric split-metric"><span>已登录</span><strong data-auth-logged>${loggedIn}</strong></div>
      <div class="metric split-metric"><span>待检查</span><strong data-auth-unknown>${platforms.filter(platform => platform.auto_check_auth!==false && (!platform.auth_status || platform.auth_status === 'unknown')).length}</strong></div>
      <div class="metric split-metric"><span>检查中</span><strong data-auth-checking>${state.authChecking.size}</strong></div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2>连接与登录</h2>
        <span class="tag">通用内容优先，手工入口单独标明</span>
      </div>
      ${platformCatalogGroups(sortedPlatforms).map(group=>group.id==='technical'
        ? `<details class="platform-catalog-group"><summary>${escapeHtml(group.name)}（${group.platforms.length}）</summary><div class="platform-grid" data-auth-grid data-auth-group="${group.id}">${group.platforms.map(p=>platformCard(p)).join('')}</div></details>`
        : `<section class="platform-catalog-group"><h3>${escapeHtml(group.name)}（${group.platforms.length}）</h3><div class="platform-grid" data-auth-grid data-auth-group="${group.id}">${group.platforms.map(p=>platformCard(p)).join('')}</div></section>`).join('')}
    </div>
  `;
}

function renderHistory() {
  const jobs = state.data.jobs;
  const { keyword, platform, status, startDate, endDate } = state.historyFilters;
  const normalizedKeyword = normalizeSearchText(keyword);
  const filteredJobs = jobs.filter(job => historyMatch(job, { keyword: normalizedKeyword, platform, status, startDate, endDate }));
  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / state.historyPageSize));
  state.historyPage = Math.min(Math.max(1, state.historyPage), totalPages);
  const pageStart = (state.historyPage - 1) * state.historyPageSize;
  const pageJobs = filteredJobs.slice(pageStart, pageStart + state.historyPageSize);
  const platformOptions = [
    ['all', '全部平台'],
    ...[...new Set([...state.data.platforms.map(p=>p.id),...jobs.flatMap(j=>[...(j.platforms || []),...(j.results || []).map(r=>r.platform)])])].map(id=>[id,platformName(id)]),
  ];
  $('#view-history').innerHTML = `
    <div class="section-head">
      <div>
        <h1>发布历史</h1>
        <p>集中查看保存草稿、一键发布后的平台结果和失败原因。</p>
      </div>
    </div>

    <div class="panel history-panel">
      <div class="history-tools">
        <label class="search-control" for="history-search">
          <span>综合搜索</span>
          <input id="history-search" type="search" data-history-filter="keyword" placeholder="标题、平台、状态、结果信息" value="${escapeHtml(keyword)}" autocomplete="off">
        </label>
        <label class="search-control compact">
          <span>平台</span>
          <select data-history-filter="platform">
            ${platformOptions.map(([value, label]) => `<option value="${escapeHtml(value)}" ${platform === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
          </select>
        </label>
        <label class="search-control compact">
          <span>状态</span>
          <select data-history-filter="status">
            ${HISTORY_STATUSES.map(([value, label]) => `<option value="${escapeHtml(value)}" ${status === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
          </select>
        </label>
        <label class="search-control compact">
          <span>开始日期</span>
          <input type="date" data-history-filter="startDate" value="${escapeHtml(startDate)}">
        </label>
        <label class="search-control compact">
          <span>结束日期</span>
          <input type="date" data-history-filter="endDate" value="${escapeHtml(endDate)}">
        </label>
      </div>
      ${jobs.length ? `
        ${filteredJobs.length ? `
          <table class="history-table">
            <thead><tr><th>时间</th><th>内容标题</th><th>状态</th><th>平台结果</th></tr></thead>
            <tbody>
              ${pageJobs.map(job => `
                <tr>
                  <td>${formatTime(job.created_at)}</td>
                  <td>${escapeHtml(job.title)}</td>
                  <td>${statePill(job.status)}</td>
                  <td>${historyJobResult(job)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ${historyPagination(filteredJobs.length, totalPages)}
        ` : '<div class="empty">没有匹配当前筛选条件的发布历史</div>'}
      ` : '<div class="empty">暂无发布历史</div>'}
    </div>
  `;
}

function historyPagination(total, totalPages) {
  const from = total ? (state.historyPage - 1) * state.historyPageSize + 1 : 0;
  const to = Math.min(total, state.historyPage * state.historyPageSize);
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1)
    .filter(page => page === 1 || page === totalPages || Math.abs(page - state.historyPage) <= 2);
  return `
    <div class="pagination">
      <span>${from}-${to} / ${total}</span>
      <div class="pagination-actions">
        <button class="mini-btn" data-action="history-page" data-page="${state.historyPage - 1}" ${state.historyPage <= 1 ? 'disabled' : ''}>上一页</button>
        ${pages.map((page, index) => {
          const previous = pages[index - 1];
          const gap = previous && page - previous > 1 ? '<span class="page-gap">...</span>' : '';
          return `${gap}<button class="mini-btn ${page === state.historyPage ? 'active-page' : ''}" data-action="history-page" data-page="${page}">${page}</button>`;
        }).join('')}
        <button class="mini-btn" data-action="history-page" data-page="${state.historyPage + 1}" ${state.historyPage >= totalPages ? 'disabled' : ''}>下一页</button>
      </div>
    </div>
  `;
}

function historyMatch(job, filters) {
  if (filters.platform !== 'all' && !job.platforms.includes(filters.platform) && !job.results.some(result => result.platform === filters.platform)) return false;
  if (filters.status !== 'all' && job.status !== filters.status && !job.results.some(result => result.status === filters.status)) return false;
  const jobDate = String(job.created_at || '').slice(0, 10);
  if (filters.startDate && jobDate < filters.startDate) return false;
  if (filters.endDate && jobDate > filters.endDate) return false;
  if (!filters.keyword) return true;
  const haystack = [
    job.title,
    job.status,
    statusLabel(job.status),
    ...job.platforms.map(platformName),
    ...job.platforms,
    ...job.results.flatMap(result => [
      result.platform,
      platformName(result.platform),
      result.status,
      statusLabel(result.status),
      result.message,
      result.url,
      result.post_id,
    ]),
  ].map(normalizeSearchText).join(' ');
  return haystack.includes(filters.keyword);
}

function renderAuthPanels() {
  const platforms = state.data?.platforms || [];
  const loggedIn = platforms.filter(platform => platform.id !== 'zip-download' && platform.auth_status === 'logged_in').length;
  const unknown = platforms.filter(platform => platform.auto_check_auth!==false && (!platform.auth_status || platform.auth_status === 'unknown')).length;
  $$('[data-auth-grid]').forEach(grid => {
    const selected=grid.dataset.authGroup ? platformCatalogGroups(platforms).find(group=>group.id===grid.dataset.authGroup)?.platforms || [] : platforms;
    grid.innerHTML = sortLoginPlatforms(selected).map(platform => platformCard(platform)).join('');
  });
  $$('[data-auth-logged]').forEach(node => { node.textContent = loggedIn; });
  $$('[data-auth-unknown]').forEach(node => { node.textContent = unknown; });
  $$('[data-auth-checking]').forEach(node => { node.textContent = state.authChecking.size; });
  $$('[data-action="check-all-auth"]').forEach(button => {
    button.disabled = state.authCheckingAll;
    button.textContent = state.authCheckingAll ? '检查中' : '全部检查';
  });
}

function batchPlatformRestriction(id, publishMode = 'draft') {
  if (publishMode === 'direct') return '最终发表和通知粉丝请在平台确认，工作台仅准备内容或同步草稿';
  const platform = state.data?.platforms?.find(item => item.id === id);
  if (platform?.delivery_mode === 'manual' || ['uisdc','jianshu','netease'].includes(id)) return '仅支持手工写作/投稿，请在内容中心打开平台入口';
  return '';
}

function confirmBatchPublish(contentId, platforms, publishMode) {
  if (publishMode !== 'draft') return false;
  const content = state.data?.contents?.find(item => String(item.id) === String(contentId));
  const names = platforms.map(platformName).join('、');
  const action = publishMode === 'direct' ? '直接发布' : '同步草稿';
  const note = publishMode === 'direct'
    ? '这会尝试向所选平台公开发布文章，请确认正文与平台选择。'
    : '支持保存的平台将保存草稿；仅支持填页的平台会准备编辑器内容，不代表云端草稿保存成功。不会公开发布文章，请在同步后检查各平台结果。';
  const limits = [
    platforms.includes('xiaohongshu') && publishMode === 'draft' ? '小红书只填入编辑器，不会报告云端草稿已保存。' : '',
    platforms.some(id => ['douyin','qiehao'].includes(id)) ? '抖音和企鹅号目前仅支持纯文字草稿，含图片或封面会停止提交。' : '',
    platforms.includes('weixin') ? '公众号的最终发表及群发通知，需你到公众号后台单独确认。' : '',
  ].filter(Boolean).join('\n');
  return window.confirm(`${action}《${content?.title || '当前文章'}》\n平台：${names}\n\n${note}${limits ? '\n' + limits : ''}`);
}

function syncPublishSelectionUi() {
  const selected = [...state.selectedPlatforms];
  const count = selected.filter(id => !batchPlatformRestriction(id)).length;
  const draftBlocked = selected.some(id => batchPlatformRestriction(id));
  const locked = state.batchPublishSubmitting || state.contentOperationLocks?.has(String(state.selectedContentId));
  const mode = state.batchPublishOperation?.publishMode;
  $$('[data-selected-platform-count]').forEach(node => {
    node.textContent = `已选择 ${count} 项`;
  });
  $$('[data-action="publish-selected"]').forEach(button => {
    button.disabled = Boolean(locked || draftBlocked || count === 0 || !getSelectedContent());
    button.textContent = state.batchPublishSubmitting && mode === 'draft' ? '同步中…' : '同步草稿 / 准备内容';
  });
  $$('[data-action="publish-selected-direct"]').forEach(button => {
    button.disabled = true; // Stale pages must not regain an automatic publication action.
    button.textContent = state.batchPublishSubmitting && mode === 'direct' ? '发布中…' : '直接发布';
    button.title = '最终发表请到平台确认';
  });
  $$('[data-batch-delivery-note]').forEach(node => {
    node.textContent = [
      draftBlocked ? '手工平台请到内容中心打开写作/投稿入口。' : '',
      '不会公开文章或通知粉丝。同步后，从结果列表打开对应稿件，检查后再发表。',
      selected.some(id => !['weixin','woshipm','sspai','zip-download'].includes(id)) ? '仅支持填页的平台会准备编辑器内容，不代表云端草稿已保存。' : '',
      selected.includes('xiaohongshu') ? '小红书只填入编辑器。' : '',
      selected.some(id => ['douyin','qiehao'].includes(id)) ? '抖音和企鹅号仅支持纯文字草稿。' : '',
      selected.includes('weixin') ? '公众号发表时请单独确认群发通知开关。' : '',
    ].filter(Boolean).join('');
  });
  if (typeof renderRecoveryBanners === 'function') renderRecoveryBanners();
}

function readSelectedPlatforms() {
  const choices = $$('[data-platform-choice]');
  if (choices.length) {
    state.selectedPlatforms = new Set(
      choices
        .filter(checkbox => checkbox.checked && !checkbox.disabled)
        .map(checkbox => checkbox.dataset.platformChoice)
        .filter(Boolean)
    );
    syncPublishSelectionUi();
  }
  return [...state.selectedPlatforms]
    .map(platform => String(platform || '').trim().toLowerCase())
    .filter(Boolean);
}

function renderProgress(steps = []) {
  const box = $('#progress-box');
  if (!box) return;
  box.innerHTML = steps.length ? steps.map(step => `
    <div class="progress-step"><i class="progress-dot"></i><span>${escapeHtml(step)}</span></div>
  `).join('') : '<div class="empty">等待指令</div>';
}

async function generateTopics(date) {
  state.selectedDate = date;
  switchView('plans');
  $('.topic-research-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function openCandidates(date, candidates) {
  $('#candidate-date').textContent = date;
  $('#candidate-list').innerHTML = candidates.map(candidate => `
    <div class="candidate-row">
      <span class="tag">${candidate.priority}</span>
      <div>
        <strong>${escapeHtml(candidate.title)}</strong>
        <span>${escapeHtml(candidate.type)} · ${escapeHtml(candidate.evidence)}</span>
      </div>
      <strong>${candidate.score}</strong>
      <button class="primary" data-action="confirm-candidate" data-id="${candidate.id}">确认</button>
    </div>
  `).join('');
  $('#candidate-dialog').showModal();
}

async function confirmCandidate(id) {
  await request('/api/topics/confirm', {
    method: 'POST',
    body: JSON.stringify({ candidateId: id }),
  });
  $('#candidate-dialog').close();
  toast('选题已确认');
  await loadData();
}

function planPayload(date) {
  const row = $(`[data-plan-row="${date}"]`);
  if (!row) return {};
  const value = field => row.querySelector(`[data-plan-field="${field}"]`)?.value || '';
  return {
    topic: value('topic'),
    type: value('type'),
    audience: value('audience'),
    materials: value('materials'),
    status: value('status') || '待选题',
  };
}

async function savePlan(date, options = {}) {
  if (!date) return null;
  const res = await request(`/api/plans/${encodeURIComponent(date)}`, {
    method: 'POST',
    body: JSON.stringify(planPayload(date)),
  });
  if (!options.silent) toast(`${date} 计划已保存`);
  await loadData();
  return res.plan;
}

function openPlanDialog() {
  $('#plan-start-input').value = state.planStartDate || state.data.today;
  $('#plan-end-input').value = state.planEndDate || state.data.today;
  $('#plan-status-input').value = '待选题';
  $('#plan-topic-input').value = '';
  $('#plan-dialog').showModal();
}

async function createPlanRange() {
  const startDate = $('#plan-start-input').value;
  const endDate = $('#plan-end-input').value;
  const status = $('#plan-status-input').value;
  const topic = $('#plan-topic-input').value;
  if (!startDate || !endDate) return toast('请选择开始和结束日期', 'error');
  const res = await request('/api/plans/range', {
    method: 'POST',
    body: JSON.stringify({ startDate, endDate, status, topic }),
  });
  $('#plan-dialog').close();
  state.planStartDate = res.startDate;
  state.planEndDate = res.endDate;
  toast(`已新增 ${res.created} 天计划`);
  await loadData();
}

function shiftPlanRange(days) {
  state.planStartDate = addDays(state.planStartDate || getMonday(state.data.today), days);
  state.planEndDate = addDays(state.planEndDate || addDays(state.planStartDate, 6), days);
  renderPlans();
}

function invalidateImportRead(readState) {
  const reader = readState.importReader;
  if (reader && typeof reader.abort === 'function') {
    try {
      reader.abort();
    } catch {
      // A reader that has already completed cannot be aborted.
    }
  }
  readState.importReader = null;
  readState.importReadToken = Number(readState.importReadToken || 0) + 1;
  return readState.importReadToken;
}

function applyLatestImportRead(readState, token, apply) {
  if (token !== readState.importReadToken) return false;
  apply();
  return true;
}

function nextTabIndexForKey(key, currentIndex, totalTabs) {
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || !Number.isInteger(totalTabs) || totalTabs < 1) return -1;
  if (key === 'ArrowRight') return (currentIndex + 1) % totalTabs;
  if (key === 'ArrowLeft') return (currentIndex - 1 + totalTabs) % totalTabs;
  if (key === 'Home') return 0;
  if (key === 'End') return totalTabs - 1;
  return -1;
}

function handleTablistKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false;
  const currentTab = event.target.closest?.('[role="tab"]');
  const tablist = currentTab?.closest('[role="tablist"]');
  if (!currentTab || !tablist) return false;
  const tabs = [...tablist.querySelectorAll('[role="tab"]')].filter(tab => !tab.disabled);
  const nextIndex = nextTabIndexForKey(event.key, tabs.indexOf(currentTab), tabs.length);
  if (nextIndex < 0) return false;

  event.preventDefault();
  const nextTab = tabs[nextIndex];
  nextTab.focus();
  if (nextTab.dataset.importTab) setImportTab(nextTab.dataset.importTab);
  if (nextTab.dataset.platform) selectPreviewPlatform(nextTab.dataset.platform);
  if (nextTab.dataset.contentMode) selectContentMode(nextTab.dataset.contentMode);
  return true;
}

function setImportFeedback(message = '', type = '') {
  const feedback = $('#import-dialog-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `dialog-feedback span-2 ${type}`.trim();
}

function setImportTab(tab) {
  if (state.importSubmitting) return;
  const nextTab = ['file', 'feishu'].includes(tab) ? tab : 'paste';
  if (state.importTab !== nextTab) invalidateImportRead(state);
  state.importTab = nextTab;
  $$('[data-import-tab]').forEach(button => {
    const active = button.dataset.importTab === nextTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.setAttribute('tabindex', active ? '0' : '-1');
  });
  $('#import-paste-panel').hidden = nextTab !== 'paste';
  $('#import-file-panel').hidden = nextTab !== 'file';
  if ($('#import-feishu-panel')) $('#import-feishu-panel').hidden = nextTab !== 'feishu';
  setImportFeedback();
}

function resetImportDialog() {
  invalidateImportRead(state);
  state.importFileName = '';
  state.importSubmitting = false;
  const title = $('#import-title-input');
  const content = $('#import-content-input');
  const file = $('#import-file-input');
  const status = $('#import-file-status');
  const submit = $('[data-action="submit-import"]');
  if (title) title.value = '';
  if (content) content.value = '';
  if (file) file.value = '';
  if ($('#import-images-input')) $('#import-images-input').value = '';
  if ($('#import-feishu-url')) $('#import-feishu-url').value = '';
  if (status) status.textContent = '尚未选择文件';
  if (submit) {
    submit.disabled = false;
    submit.textContent = '导入并打开';
  }
  setImportTab('paste');
}

function openImportDialog() {
  resetImportDialog();
  $('#import-dialog').showModal();
  $('#import-title-input').focus();
}

function cancelImport() {
  if (state.importSubmitting) return;
  $('#import-dialog').close();
  resetImportDialog();
}

function beginPasteImport() {
  if (state.importTab === 'paste') invalidateImportRead(state);
  else setImportTab('paste');
  state.importFileName = '';
}

function inferImportFormat(filename, content) {
  const name = String(filename || '').trim().toLowerCase();
  const source = String(content || '');
  if (/\.txt$/.test(name)) return 'text';
  if (/\.(?:html|htm)$/.test(name)) return 'html';
  if (/\.(?:md|markdown)$/.test(name)) return 'markdown';
  const markdownAutolink = /<(?:[a-z][a-z0-9+.-]{1,31}:[^<>\s]+|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>/gi;
  const htmlProbe = source
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
    .replace(/^(?: {4}|\t).+$/gm, '')
    .replace(/(`+)([\s\S]*?)\1/g, '')
    .replace(markdownAutolink, '');
  const htmlElement = /<!doctype\s+html\b|<\s*\/?\s*(?:html|head|body|main|article|section|div|p|h[1-6]|ul|ol|li|blockquote|table|thead|tbody|tfoot|tr|th|td|caption|colgroup|col|figure|figcaption|pre|code|hr|br|img|a|strong|em|b|i|u|s|del|span)(?=\s|\/?>)[^>]*>/i;
  if (htmlElement.test(htmlProbe)) return 'html';
  const markdownSyntax = /^\s*(?:#{1,6}\s+|[-*+]\s+|>\s+|```|~~~)|^(?: {4}|\t)\S|\[[^\]]+\]\([^)]+\)|<(?:[a-z][a-z0-9+.-]{1,31}:[^<>\s]+|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>|`+/im;
  if (markdownSyntax.test(source)) return 'markdown';
  return 'text';
}

function importedBodyByteLength(value) {
  return new Blob([String(value || '')]).size;
}

function readImportFile(input) {
  const readToken = invalidateImportRead(state);
  const file = input?.files?.[0];
  const status = $('#import-file-status');
  if (!file) {
    state.importFileName = '';
    if (status) status.textContent = '尚未选择文件';
    return;
  }
  if (!IMPORT_FILE_EXTENSION.test(file.name)) {
    input.value = '';
    state.importFileName = '';
    if (status) status.textContent = '文件格式不受支持';
    setImportFeedback('仅支持 .md、.markdown、.html、.htm、.txt 文件', 'error');
    return;
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    input.value = '';
    state.importFileName = '';
    if (status) status.textContent = '文件超过 5 MiB';
    setImportFeedback('文件不能超过 5 MiB，请缩小后重试', 'error');
    return;
  }

  const reader = new FileReader();
  state.importReader = reader;
  if (status) status.textContent = `正在读取 ${file.name}…`;
  setImportFeedback();
  reader.onload = () => {
    applyLatestImportRead(state, readToken, () => {
      state.importReader = null;
      const body = String(reader.result || '');
      if (importedBodyByteLength(body) > MAX_IMPORT_FILE_BYTES) {
        input.value = '';
        state.importFileName = '';
        if (status) status.textContent = '读取后的正文超过 5 MiB';
        setImportFeedback('读取后的正文不能超过 5 MiB', 'error');
        return;
      }
      state.importFileName = file.name;
      $('#import-content-input').value = body;
      if (status) status.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KiB · 已在本机读取`;
    });
  };
  reader.onerror = () => {
    applyLatestImportRead(state, readToken, () => {
      state.importReader = null;
      state.importFileName = '';
      if (status) status.textContent = `${file.name} 读取失败`;
      setImportFeedback('无法读取该文件，请重新选择', 'error');
    });
  };
  reader.readAsText(file);
}

async function submitImport() {
  if (state.importSubmitting) return;
  if (state.importTab === 'feishu') return submitFeishuImport();
  const body = $('#import-content-input').value;
  const title = $('#import-title-input').value.trim();
  if (state.importTab === 'file' && !state.importFileName) {
    setImportFeedback('请先选择并成功读取一个本地文件', 'error');
    return;
  }
  if (!body.trim()) {
    setImportFeedback(state.importTab === 'file' ? '所选文件没有可导入的正文' : '请粘贴文章正文', 'error');
    return;
  }
  if (importedBodyByteLength(body) > MAX_IMPORT_FILE_BYTES) {
    setImportFeedback('导入正文不能超过 5 MiB', 'error');
    return;
  }

  const sourceFilename = state.importTab === 'file' ? state.importFileName : '';
  const format = inferImportFormat(sourceFilename, body);
  const extension = format === 'html' ? 'html' : format === 'markdown' ? 'md' : 'txt';
  const filename = sourceFilename || `pasted-article.${extension}`;
  const submit = $('[data-action="submit-import"]');
  state.importSubmitting = true;
  submit.disabled = true;
  submit.textContent = '正在导入…';
  let importSucceeded = false;
  try {
    const transitioned = await runContentTransition(async () => {
      setImportFeedback('正在创建内容记录…');
      try {
        const assets = state.importTab === 'file' ? await readSelectedImportImages() : null;
        const result = await request(assets ? '/api/content/import-bundle' : '/api/content/import', {
          method: 'POST',
          body: JSON.stringify({ filename, title, body, format, ...(assets ? { assets, summary: '' } : {}) }),
        });
        state.selectedContentId = result.content.id;
        $('#import-dialog').close();
        resetImportDialog();
        await loadData();
        switchView('content');
        toast(`已导入《${result.content.title}》`);
        importSucceeded = true;
        return true;
      } catch (error) {
        setImportFeedback(error.message || '文章导入失败', 'error');
        return false;
      }
    });
    if (!transitioned) {
      setImportFeedback('当前正文保存失败，未导入文章', 'error');
      return false;
    }
    return importSucceeded;
  } finally {
    state.importSubmitting = false;
    if (submit) {
      submit.disabled = false;
      submit.textContent = '导入并打开';
    }
  }
}

function chooseRandomWechatTemplate() {
  if (!state.layoutTemplates.length) return;
  if (state.contentOperationLocks.has(String(state.selectedContentId))) return;
  const choices = state.templateCatalogNamed ? distinctWechatTemplates(state.layoutTemplates, state.selectedWechatTemplate) : state.layoutTemplates;
  const currentIndex = choices.findIndex(template => template.filename === state.selectedWechatTemplate);
  let nextIndex = Math.floor(Math.random() * choices.length);
  if (choices.length > 1 && nextIndex === currentIndex) {
    nextIndex = (nextIndex + 1) % choices.length;
  }
  state.selectedWechatTemplate = choices[nextIndex].filename;
  state.wechatTemplateChoices.set(state.selectedContentId, state.selectedWechatTemplate);
  markContentDirty(state.selectedContentId);
  renderPlatformAdaptationPane();
}

async function generateWechatLayout(id) {
  const template = String(state.selectedWechatTemplate || '').trim();
  if (!template) {
    toast('请先选择公众号排版模板', 'error');
    return;
  }
  try {
    await layoutContent(id, template);
  } catch (error) {
    toast(error.message || '排版生成失败', 'error');
  }
}

function selectPreviewDevice(device) {
  state.previewDevice = device === 'mobile' ? 'mobile' : 'desktop';
  renderPlatformAdaptationPane();
}

function retryPlatformPreview(platform) {
  const content = getSelectedContent();
  if (!content) return;
  state.previewErrors.delete(platformPreviewKey(content, platform));
  renderPlatformAdaptationPane();
  void loadPlatformPreview(content, platform);
}

function contentOperationSnapshot(id) {
  const target = String(id || '');
  const editor = $(`[data-content-body="${target}"]`);
  const titleEditor = $(`[data-content-title="${target}"]`);
  const summaryEditor = $(`[data-content-summary="${target}"]`);
  return {
    revision: state.contentEditRevisions.get(target) || 0,
    body: editor ? (editor.innerHTML ?? editor.value ?? '') : null,
    title: titleEditor ? titleEditor.value : null,
    summary: summaryEditor ? summaryEditor.value : null,
  };
}

function setContentOperationBusy(context, busy) {
  const target = context.contentId;
  if (busy) {
    context.restore = [];
    const fields = [
      $(`[data-content-body="${target}"]`),
      $(`[data-content-title="${target}"]`),
      $(`[data-content-summary="${target}"]`),
    ].filter(Boolean);
    for (const field of fields) {
      if (field.matches?.('[data-content-body]')) {
        context.restore.push({ element: field, type: 'contenteditable', value: field.getAttribute('contenteditable') });
        field.setAttribute('contenteditable', 'false');
        field.setAttribute('aria-busy', 'true');
      } else {
        context.restore.push({ element: field, type: 'disabled', value: Boolean(field.disabled) });
        field.disabled = true;
      }
    }
    const actions = new Set([
      'save-content', 'layout-selected', 'layout-content', 'generate-wechat-layout',
      'save-draft', 'publish-content', 'publish-selected', 'publish-selected-direct', 'open-platform-draft', 'open-platform-direct',
    ]);
    for (const control of $$('[data-action]')) {
      if (!actions.has(control.dataset.action)) continue;
      if (control.dataset.id && String(control.dataset.id) !== target) continue;
      if (!control.dataset.id && state.selectedContentId && String(state.selectedContentId) !== target) continue;
      context.restore.push({ element: control, type: 'disabled', value: Boolean(control.disabled) });
      control.disabled = true;
    }
    return;
  }
  for (const item of context.restore || []) {
    if (item.type === 'contenteditable') {
      if (item.value === null) item.element.removeAttribute('contenteditable');
      else item.element.setAttribute('contenteditable', item.value);
      item.element.removeAttribute('aria-busy');
    } else {
      item.element.disabled = item.value;
    }
  }
  context.restore = [];
}

function beginContentOperation(id) {
  const target = String(id || '');
  if (!target || state.contentOperationLocks.has(target)) return null;
  const sequence = Number(state.contentOperationSequence || 0) + 1;
  state.contentOperationSequence = sequence;
  const context = {
    contentId: target,
    token: `content-operation-${sequence}`,
    snapshot: contentOperationSnapshot(target),
    restore: [],
  };
  state.contentOperationLocks.set(target, context);
  setContentOperationBusy(context, true);
  return context;
}

function contentOperationIsStable(context) {
  if (!context || state.contentOperationLocks.get(context.contentId)?.token !== context.token) return false;
  const current = contentOperationSnapshot(context.contentId);
  return current.revision === context.snapshot.revision
    && current.body === context.snapshot.body
    && current.title === context.snapshot.title
    && current.summary === context.snapshot.summary;
}

function preserveContentOperationChanges(context, serverContent = null) {
  if (!context) return;
  const target = context.contentId;
  const current = contentOperationSnapshot(target);
  state.dirtyContentIds.add(target);
  const contentIndex = state.data?.contents?.findIndex(content => String(content.id) === target) ?? -1;
  if (contentIndex < 0) return;
  const existing = state.data.contents[contentIndex];
  state.data.contents[contentIndex] = {
    ...existing,
    ...(serverContent || {}),
    title: current.title ?? existing.title,
    summary: current.summary ?? existing.summary,
    body: current.body ?? existing.body,
  };
}

function endContentOperation(context) {
  if (!context || state.contentOperationLocks.get(context.contentId)?.token !== context.token) return false;
  state.contentOperationLocks.delete(context.contentId);
  setContentOperationBusy(context, false);
  return true;
}

function createPublishOperationId(cryptoSource = crypto) {
  if (typeof cryptoSource?.randomUUID === 'function') return cryptoSource.randomUUID();
  const bytes = new Uint8Array(24);
  cryptoSource.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function beginBatchPublishOperation(publishState, pending) {
  if (!pending || publishState.batchPublishSubmitting) return null;
  const operation = Object.freeze({
    ...pending,
    platforms: Object.freeze([...(pending.platforms || [])]),
    operationId: createPublishOperationId(),
  });
  publishState.batchPublishSubmitting = true;
  publishState.batchPublishOperation = operation;
  return operation;
}

function finishBatchPublishOperation(publishState, operationId) {
  if (!operationId || publishState.batchPublishOperation?.operationId !== operationId) return false;
  publishState.batchPublishSubmitting = false;
  publishState.batchPublishOperation = null;
  return true;
}

function setBatchPublishBusy(busy) {
  syncPublishSelectionUi();
}

function beginSinglePublishOperation(publishState, pending) {
  if (!pending || publishState.singlePublishSubmitting) return null;
  const sequence = Number(publishState.singlePublishOperationSequence || 0) + 1;
  const token = `single-publish-${sequence}`;
  publishState.singlePublishOperationSequence = sequence;
  publishState.singlePublishSubmitting = true;
  publishState.singlePublishOperationToken = token;
  return Object.freeze({ ...pending, token });
}

function finishSinglePublishOperation(publishState, token) {
  if (!token || publishState.singlePublishOperationToken !== token) return false;
  publishState.singlePublishSubmitting = false;
  publishState.singlePublishOperationToken = '';
  return true;
}

function canCancelSinglePublish(publishState) {
  return !publishState.singlePublishSubmitting;
}

function handleSinglePublishDialogCancel(event) {
  if (!canCancelSinglePublish(state)) {
    event.preventDefault();
    setSinglePublishFeedback('平台操作正在执行，完成前不能关闭。', 'error');
    return false;
  }
  cancelSinglePublish();
  return true;
}

function setSinglePublishFeedback(message = '', type = '') {
  const feedback = $('#single-publish-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `dialog-feedback ${type}`.trim();
}

function setSinglePublishBusy(busy) {
  const dialog = $('#platform-publish-dialog');
  dialog?.querySelectorAll('button').forEach(button => {
    button.disabled = busy;
  });
  const confirm = dialog?.querySelector('[data-action="confirm-single-publish"]');
  if (confirm) confirm.textContent = busy ? '正在执行…' : '确认执行';
}

function openSinglePublishConfirmation({ contentId, platform, mode }) {
  if (['uisdc','jianshu','netease'].includes(platform) || state.data?.platforms?.find(item => item.id === platform)?.delivery_mode === 'manual') { toast('该平台当前为手工操作，请使用官网写作/投稿入口', 'error'); return false; }
  if (!canCancelSinglePublish(state)) {
    toast('已有平台操作正在执行，请等待完成', 'error');
    return false;
  }
  const recoveryButton = $('#single-publish-recovery-button');
  if (recoveryButton) recoveryButton.hidden = true;
  const content = state.data?.contents.find(item => item.id === contentId);
  if (!content || !platform || !['draft', 'direct'].includes(mode)) {
    toast('缺少平台发布信息', 'error');
    return false;
  }
  if (mode !== 'draft') {
    toast('最终发表和通知粉丝请在平台确认，工作台仅同步草稿或准备内容', 'error');
    return false;
  }
  state.pendingSinglePublish = Object.freeze({
    contentId,
    articleTitle: content.title,
    platform,
    mode,
    operationId: createPublishOperationId(),
  });
  $('#single-publish-article').textContent = content.title;
  $('#single-publish-platform').textContent = platformName(platform);
  const fillOnly = ['xiaohongshu','toutiao','douban'].includes(platform);
  $('#single-publish-mode').textContent = fillOnly ? '填入平台编辑器（非云端草稿）' : mode === 'draft' ? '保存平台草稿' : '提交发布并核对回执';
  setSinglePublishFeedback((fillOnly ? '只准备平台编辑器，无法确认云端草稿保存，请在平台检查，勿重复提交。' : '仅同步平台草稿，不会自动发表。') + (platform === 'weixin' ? '最终发表时，请自行确认群发通知开关；不通知也属于公开发表。' : '请在平台确认最终内容与发表时间。'));
  $('#platform-publish-dialog').showModal();
  return true;
}

function cancelSinglePublish() {
  if (!canCancelSinglePublish(state)) return false;
  state.pendingSinglePublish = null;
  setSinglePublishFeedback();
  $('#platform-publish-dialog').close();
  return true;
}

async function confirmSinglePlatformPublish() {
  if (state.pendingSinglePublish?.mode !== 'draft') {
    toast('工作台不自动发表，请到平台确认', 'error');
    return false;
  }
  const operation = beginSinglePublishOperation(state, state.pendingSinglePublish);
  if (!operation) return false;
  let operationFinished = false;
  let operationContext = null;
  setSinglePublishBusy(true);
  setSinglePublishFeedback(`正在${operation.mode === 'draft' ? '保存草稿到' : '发布到'}${platformName(operation.platform)}…`);
  try {
    operationContext = beginContentOperation(operation.contentId);
    if (!operationContext) {
      setSinglePublishFeedback('正文操作正在进行，请稍候', 'error');
      toast('正文操作正在进行，请稍候', 'error');
      return false;
    }
    if ($(`[data-content-body="${operation.contentId}"]`)) {
      const saveResult = await saveContent(operation.contentId, {
        silent: true,
        skipReload: true,
        operationContext,
      });
      if (!saveResult.stable) {
        if (saveResult.conflict) { setSinglePublishFeedback('本地稿件需要恢复最新版本，当前编辑已保留。请点击“恢复 / 核对”。', 'error'); return false; }
        setSinglePublishFeedback(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
        toast(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
        return false;
      }
    }
    const expectedUpdatedAt = state.data?.contents
      ?.find(content => String(content.id) === String(operation.contentId))?.updated_at || '';
    const result = await request(`/api/content/${encodeURIComponent(operation.contentId)}/publish-platform`, {
      method: 'POST',
      body: JSON.stringify({
        platform: operation.platform,
        publishMode: operation.mode,
        operationId: operation.operationId,
        expectedUpdatedAt,
      }),
    });
    if (state.singlePublishOperationToken !== operation.token) return false;
    if (result.canonicalConflict === true || result.needsReload === true) {
      markContentCanonicalConflict(operation.contentId);
      return false;
    }
    const merged = mergeContentRevisionMetadata(result.content, operation.contentId, {
      expectedUpdatedAt,
      sourceUpdatedAt: result.sourceUpdatedAt,
      canonicalConflict: result.canonicalConflict,
      needsReload: result.needsReload,
    });
    if (!merged) {
      markContentCanonicalConflict(operation.contentId);
      return false;
    }
    const platformResult = result.job?.results?.find(item => item.platform === operation.platform);
    if (!contentOperationIsStable(operationContext)) {
      preserveContentOperationChanges(operationContext, result.content);
      setSinglePublishFeedback(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
      toast(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
      return false;
    }
    $('#platform-publish-dialog').close();
    state.pendingSinglePublish = null;
    operationFinished = finishSinglePublishOperation(state, operation.token);
    if (operationFinished) setSinglePublishBusy(false);
    if (['success','platform_draft','exported'].includes(platformResult?.status)) {
      const fallback = operation.mode === 'draft' ? '平台草稿已保存' : '平台发布成功';
      toast(`${platformName(operation.platform)}：${platformResult.message || fallback}`);
    } else {
      toast(`${platformName(operation.platform)}：${platformResult?.message || '平台未返回成功结果'}`, 'error');
    }
    try {
      const loaded = await loadData({ operationContext });
      if (!loaded.applied) {
        preserveContentOperationChanges(operationContext, result.content);
        toast(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
        return false;
      }
    } catch {
      toast('平台操作已返回，但列表刷新失败；请在发布历史核对结果', 'error');
    }
    return true;
  } catch (error) {
    if (state.singlePublishOperationToken === operation.token) {
      if (error?.apiCode === 'CONTENT_REVISION_CONFLICT' || (error?.statusCode === 409 && /文章.*更新|正文.*版本|重新加载最新版本/.test(error.message || ''))) {
        markContentCanonicalConflict(operation.contentId);
        return false;
      }
      showPublishRecoveryError(error, operation.contentId, operation.platform);
      setSinglePublishFeedback(error.message || '平台操作失败', 'error');
      toast(error.message || '平台操作失败', 'error');
    }
    return false;
  } finally {
    if (operationContext) endContentOperation(operationContext);
    if (!operationFinished && finishSinglePublishOperation(state, operation.token)) {
      setSinglePublishBusy(false);
    }
  }
}

function hasDirtyCanonicalContent(dirtyIds = state.dirtyContentIds) {
  return Boolean(dirtyIds?.size);
}

async function runContentTransition(transition) {
  if (state.contentTransitionInFlight) return false;
  state.contentTransitionInFlight = true;
  const currentId = state.selectedContentId;
  let operationContext = null;
  try {
    if (currentId) {
      operationContext = beginContentOperation(currentId);
      if (!operationContext) {
        toast('正文操作正在进行，请稍候', 'error');
        return false;
      }
    }
    if (currentId && state.dirtyContentIds.has(String(currentId))) {
      const saveResult = await saveContent(currentId, {
        silent: true,
        skipReload: true,
        operationContext,
      });
      if (!saveResult.stable) {
        if (saveResult.conflict) return false;
        toast(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
        return false;
      }
    }
    if (operationContext && !contentOperationIsStable(operationContext)) {
      preserveContentOperationChanges(operationContext);
      toast(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
      return false;
    }
    await transition();
    return true;
  } catch (error) {
    toast(`正文保存失败，已留在当前页面：${error.message || '未知错误'}`, 'error');
    return false;
  } finally {
    if (operationContext) endContentOperation(operationContext);
    state.contentTransitionInFlight = false;
  }
}

function handleBeforeUnload(event) {
  if (!hasDirtyCanonicalContent()) return undefined;
  event.preventDefault();
  event.returnValue = '';
  return '';
}

async function generateContent(date) {
  if (date && $(`[data-plan-row="${date}"]`)) await savePlan(date, { silent: true });
  const res = await request('/api/content/generate', {
    method: 'POST',
    body: JSON.stringify({ date }),
  });
  state.selectedContentId = res.content.id;
  switchView('content');
  toast('正文已生成');
  await loadData();
}

function markContentCanonicalConflict(
  contentId,
  message = '文章已在其他标签页更新，请重新加载最新版本后再继续'
) {
  if (!contentId) return false;
  const target = String(contentId);
  state.contentCanonicalConflicts ||= new Set();
  state.contentCanonicalConflicts.add(target);
  state.dirtyContentIds.add(target);
  $(`[data-save-content-button="${target}"]`)?.classList.remove('is-hidden');
  const saveState = $(`[data-content-save-state="${target}"]`);
  if (saveState) {
    saveState.textContent = message;
    saveState.classList.add('is-dirty');
  }
  toast(message, 'error');
  if (typeof renderRecoveryBanners === 'function') renderRecoveryBanners();
  const recoveryButton = $('#single-publish-recovery-button');
  if (recoveryButton) recoveryButton.hidden = false;
  return true;
}

function mergeContentRevisionMetadata(serverContent, contentId = serverContent?.id, proof = {}) {
  if (!serverContent || !contentId || proof.canonicalConflict === true || proof.needsReload === true) return false;
  if (typeof proof.expectedUpdatedAt !== 'string'
    || !proof.expectedUpdatedAt
    || proof.sourceUpdatedAt !== proof.expectedUpdatedAt
    || typeof serverContent.updated_at !== 'string'
    || !serverContent.updated_at) return false;
  const target = String(contentId);
  const contentIndex = state.data?.contents?.findIndex(content => String(content.id) === target) ?? -1;
  if (contentIndex < 0) return false;
  const existing = state.data.contents[contentIndex];
  if (existing.updated_at !== proof.expectedUpdatedAt) return false;
  state.data.contents[contentIndex] = {
    ...existing,
    ...(typeof serverContent.updated_at === 'string' ? { updated_at: serverContent.updated_at } : {}),
    ...(Object.prototype.hasOwnProperty.call(serverContent, 'status') ? { status: serverContent.status } : {}),
    ...(Object.prototype.hasOwnProperty.call(serverContent, 'layout_html') ? { layout_html: serverContent.layout_html } : {}),
  };
  return true;
}

async function saveContent(id, options = {}) {
  const target = id || state.selectedContentId;
  if (!target) return { content: null, stable: true };
  const targetKey = String(target);
  if (state.contentCanonicalConflicts?.has(targetKey)) {
    markContentCanonicalConflict(targetKey);
    return { content: null, stable: false, conflict: true, blocked: true };
  }
  const ownsOperation = !options.operationContext;
  const operationContext = options.operationContext || beginContentOperation(targetKey);
  if (!operationContext) {
    if (!options.silent) toast('正文操作正在进行，请稍候', 'error');
    return { content: null, stable: false, busy: true };
  }
  try {
    const editor = $(`[data-content-body="${target}"]`);
    const titleEditor = $(`[data-content-title="${target}"]`);
    const summaryEditor = $(`[data-content-summary="${target}"]`);
    const body = editor ? (editor.innerHTML ?? editor.value) : undefined;
    const current = state.data.contents.find(content => content.id === target);
    const expectedUpdatedAt = current?.updated_at;
    const templateToSave = state.wechatTemplateChoices?.get(target)
      || (state.activePreviewPlatform === 'weixin' ? state.selectedWechatTemplate : null)
      || String(current?.layout_html || '').match(/data-wechat-template="([^"]+)"/)?.[1];
    const res = await request(`/api/content/${encodeURIComponent(target)}`, {
      method: 'POST',
      body: JSON.stringify({
        title: titleEditor?.value ?? current?.title,
        summary: summaryEditor?.value ?? current?.summary,
        type: current?.type,
        body: body ?? current?.body ?? '',
        expectedUpdatedAt,
        ...(templateToSave ? { template: templateToSave } : {}),
      }),
    });
    state.selectedContentId = res.content.id;
    const merged = mergeContentRevisionMetadata(res.content, targetKey, {
      expectedUpdatedAt,
      sourceUpdatedAt: res.sourceUpdatedAt,
      canonicalConflict: res.canonicalConflict,
      needsReload: res.needsReload,
    });
    if (!merged) {
      markContentCanonicalConflict(targetKey);
      return { content: null, stable: false, conflict: true, blocked: true };
    }
    clearPlatformPreviews(target);
    if (!contentOperationIsStable(operationContext)) {
      preserveContentOperationChanges(operationContext, res.content);
      return { content: res.content, stable: false };
    }
    state.dirtyContentIds.delete(targetKey);
    if (!options.skipReload) {
      let loaded;
      try {
        loaded = await loadData({ operationContext });
      } catch {
        if (!contentOperationIsStable(operationContext)) {
          preserveContentOperationChanges(operationContext, res.content);
          toast(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
          return { content: res.content, stable: false };
        }
        const message = '正文已保存，但列表刷新失败；可继续编辑或稍后刷新';
        $(`[data-save-content-button="${target}"]`)?.classList.add('is-hidden');
        const saveState = $(`[data-content-save-state="${target}"]`);
        if (saveState) {
          saveState.textContent = message;
          saveState.classList.remove('is-dirty');
        }
        toast(message, 'error');
        return { content: res.content, stable: true, refreshFailed: true };
      }
      if (!loaded.applied) {
        preserveContentOperationChanges(operationContext, res.content);
        return { content: res.content, stable: false };
      }
    }
    if (!options.silent) toast('正文已保存');
    return { content: res.content, stable: true };
  } catch (error) {
    if (error?.statusCode === 409) {
      markContentCanonicalConflict(targetKey);
      return { content: null, stable: false, conflict: true, blocked: true };
    }
    if (!options.userInitiated) throw error;
    const message = `保存失败：${error?.message || '未知错误'}。请修改后重试`;
    state.dirtyContentIds.add(targetKey);
    $(`[data-save-content-button="${target}"]`)?.classList.remove('is-hidden');
    const saveState = $(`[data-content-save-state="${target}"]`);
    if (saveState) {
      saveState.textContent = message;
      saveState.classList.add('is-dirty');
    }
    toast(message, 'error');
    return {
      content: null,
      stable: false,
      saveError: true,
      statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : 0,
    };
  } finally {
    if (ownsOperation) endContentOperation(operationContext);
  }
}

function markContentDirty(id) {
  if (!id) return false;
  const target = String(id);
  if (state.contentOperationLocks.has(target)) return false;
  state.contentEditRevisions.set(target, (state.contentEditRevisions.get(target) || 0) + 1);
  state.dirtyContentIds.add(target);
  $(`[data-save-content-button="${id}"]`)?.classList.remove('is-hidden');
  const saveState = $(`[data-content-save-state="${id}"]`);
  if (saveState) {
    saveState.textContent = '有未保存更改';
    saveState.classList.add('is-dirty');
  }
  if (typeof scheduleDraftPreview === 'function') scheduleDraftPreview(id);
  return true;
}

function bindContentEditorDirtyTracking(id) {
  const fields = [
    $(`[data-content-body="${id}"]`),
    $(`[data-content-title="${id}"]`),
    $(`[data-content-summary="${id}"]`),
  ].filter(Boolean);
  for (const field of fields) {
    field.addEventListener('input', () => markContentDirty(id));
  }
}

async function layoutContent(id, template) {
  const target = id || state.selectedContentId;
  const templateProvided = arguments.length >= 2;
  if (templateProvided && !template) throw new Error('请选择有效的公众号排版模板');
  if (!target) return toast('请选择内容', 'error');
  const operationContext = beginContentOperation(target);
  if (!operationContext) return toast('正文操作正在进行，请稍候', 'error');
  try {
    if ($(`[data-content-body="${target}"]`)) {
      const saveResult = await saveContent(target, { silent: true, skipReload: true, operationContext });
      if (!saveResult.stable) {
        toast(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
        return false;
      }
    }
    const expectedUpdatedAt = state.data?.contents
      ?.find(content => String(content.id) === String(target))?.updated_at || '';
    const requestOptions = {
      method: 'POST',
      body: JSON.stringify({
        expectedUpdatedAt,
        ...(templateProvided ? { template } : {}),
      }),
    };
    const res = await request(`/api/content/${encodeURIComponent(target)}/layout`, requestOptions);
    const merged = mergeContentRevisionMetadata(res.content, target, {
      expectedUpdatedAt,
      sourceUpdatedAt: res.sourceUpdatedAt,
      canonicalConflict: res.canonicalConflict,
      needsReload: res.needsReload,
    });
    if (!merged) {
      markContentCanonicalConflict(target);
      return false;
    }
    if (!contentOperationIsStable(operationContext)) {
      preserveContentOperationChanges(operationContext, res.content);
      toast(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
      return false;
    }
    state.selectedContentId = res.content.id;
    let loaded;
    try {
      loaded = await loadData({ operationContext });
    } catch {
      if (!contentOperationIsStable(operationContext)) {
        preserveContentOperationChanges(operationContext, res.content);
        toast(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
        return false;
      }
      openLayoutDialog(getSelectedContent());
      toast('排版预览已生成，但列表刷新失败', 'error');
      return true;
    }
    if (!loaded.applied) {
      preserveContentOperationChanges(operationContext, res.content);
      toast(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
      return false;
    }
    openLayoutDialog(getSelectedContent());
    toast('排版预览已生成');
    return true;
  } catch (error) {
    if (error?.statusCode === 409) {
      markContentCanonicalConflict(target);
      return false;
    }
    throw error;
  } finally {
    endContentOperation(operationContext);
  }
}

async function saveDraft(id) {
  const target = id || state.selectedContentId;
  const selectedPlatforms = readSelectedPlatforms();
  if (!target) return toast('请选择内容', 'error');
  const operationContext = beginContentOperation(target);
  if (!operationContext) return toast('正文操作正在进行，请稍候', 'error');
  try {
    if ($(`[data-content-body="${target}"]`)) {
      const saveResult = await saveContent(target, { silent: true, skipReload: true, operationContext });
      if (!saveResult.stable) {
        toast(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
        return false;
      }
    }
    const expectedUpdatedAt = state.data?.contents
      ?.find(content => String(content.id) === String(target))?.updated_at || '';
    const res = await request(`/api/content/${target}/save-draft`, {
      method: 'POST',
      body: JSON.stringify({ platforms: selectedPlatforms, expectedUpdatedAt }),
    });
    const merged = mergeContentRevisionMetadata(res.content, target, {
      expectedUpdatedAt,
      sourceUpdatedAt: res.sourceUpdatedAt,
      canonicalConflict: res.canonicalConflict,
      needsReload: res.needsReload,
    });
    if (!merged) {
      markContentCanonicalConflict(target);
      return false;
    }
    if (!contentOperationIsStable(operationContext)) {
      preserveContentOperationChanges(operationContext, res.content);
      toast(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
      return false;
    }
    let loaded;
    try {
      loaded = await loadData({ operationContext });
    } catch {
      if (!contentOperationIsStable(operationContext)) {
        preserveContentOperationChanges(operationContext, res.content);
        toast(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
        return false;
      }
      toast('草稿已保存，但列表刷新失败', 'error');
      return true;
    }
    if (!loaded.applied) {
      preserveContentOperationChanges(operationContext, res.content);
      toast(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
      return false;
    }
    toast('已保存到内容中心草稿');
    return true;
  } catch (error) {
    if (error?.statusCode === 409) {
      markContentCanonicalConflict(target);
      return false;
    }
    throw error;
  } finally {
    endContentOperation(operationContext);
  }
}

async function publishContent(id, publishMode = 'draft') {
  if (state.batchPublishSubmitting) return false;
  const target = id || state.selectedContentId;
  const selectedPlatforms = readSelectedPlatforms();
  if (!target) return toast('请选择内容', 'error');
  if (!selectedPlatforms.length) return toast('请选择至少一个发布平台', 'error');
  if (!['draft', 'direct'].includes(publishMode)) return false;
  const blocked = selectedPlatforms.find(platform => batchPlatformRestriction(platform, publishMode));
  if (blocked) return toast(`${platformName(blocked)}：${batchPlatformRestriction(blocked, publishMode)}`, 'error');
  if (!confirmBatchPublish(target, selectedPlatforms, publishMode)) return false;
  const operation = beginBatchPublishOperation(state, {
    contentId: target,
    platforms: selectedPlatforms,
    publishMode,
  });
  if (!operation) return false;
  const operationContext = beginContentOperation(target);
  if (!operationContext) {
    finishBatchPublishOperation(state, operation.operationId);
    toast('正文操作正在进行，请稍候', 'error');
    return false;
  }
  setBatchPublishBusy(true);
  try {
    if ($(`[data-content-body="${target}"]`)) {
      const saveResult = await saveContent(target, { silent: true, skipReload: true, operationContext });
      if (!saveResult.stable) {
        if (saveResult.conflict) return false;
        toast(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
        return false;
      }
    }
    state.selectedPlatforms = new Set(operation.platforms);
    state.lastProgress = operation.publishMode === 'draft'
      ? [`正在同步到 ${operation.platforms.length} 个平台`, '准备平台草稿或编辑器内容，不公开发布']
      : [`正在直接发布到 ${operation.platforms.length} 个平台`, '进入多平台直发流程'];
    renderProgress(state.lastProgress);
    const expectedUpdatedAt = state.data?.contents
      ?.find(content => String(content.id) === String(target))?.updated_at || '';
    const result = await request('/api/publish', {
      method: 'POST',
      body: JSON.stringify({ ...operation, expectedUpdatedAt }),
    });
    if (result.canonicalConflict === true || result.needsReload === true) {
      markContentCanonicalConflict(target);
      return false;
    }
    const merged = mergeContentRevisionMetadata(result.content, target, {
      expectedUpdatedAt,
      sourceUpdatedAt: result.sourceUpdatedAt,
      canonicalConflict: result.canonicalConflict,
      needsReload: result.needsReload,
    });
    if (!merged) {
      markContentCanonicalConflict(target);
      return false;
    }
    if (!contentOperationIsStable(operationContext)) {
      preserveContentOperationChanges(operationContext, result.content);
      toast(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
      return false;
    }
    let loaded;
    try {
      loaded = await loadData({ operationContext });
    } catch {
      if (!contentOperationIsStable(operationContext)) {
        preserveContentOperationChanges(operationContext, result.content);
        toast(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
        return false;
      }
      toast('同步结果已返回，但列表刷新失败；请恢复并核对结果，不要重复提交', 'error');
      return true;
    }
    if (!loaded.applied) {
      preserveContentOperationChanges(operationContext, result.content);
      toast(CONTENT_CHANGED_DURING_SAVE_MESSAGE, 'error');
      return false;
    }
    toast(operation.publishMode === 'draft' ? '同步流程完成，请检查各平台的草稿或待核对结果' : '发布流程完成，请查看平台结果');
    switchView('publish');
    return true;
  } catch (error) {
    if (error?.apiCode === 'CONTENT_REVISION_CONFLICT' || (error?.statusCode === 409 && /文章.*更新|正文.*版本|重新加载最新版本/.test(error.message || ''))) {
      markContentCanonicalConflict(target);
      return false;
    }
    showPublishRecoveryError(error, target, operation.platforms[0]);
    if (error?.statusCode === 409) return false;
    toast(error.message, 'error');
    try {
      const loaded = await loadData({ operationContext });
      if (!loaded.applied) preserveContentOperationChanges(operationContext);
    } catch {
      // Preserve the original publish error when refresh also fails.
    }
    return false;
  } finally {
    endContentOperation(operationContext);
    if (finishBatchPublishOperation(state, operation.operationId)) setBatchPublishBusy(false);
  }
}

async function checkAuth(platform) {
  if (!platform || state.authChecking.has(platform)) return;
  const needsInteractive = INTERACTIVE_AUTH_PLATFORMS.has(platform);
  const interactive = needsInteractive
    ? window.confirm(`${PLATFORM_NAMES[platform] || platform} 登录状态检查会打开对应平台浏览器窗口。是否继续？`)
    : true;
  if (needsInteractive && !interactive) return;
  state.authChecking.add(platform);
  renderAuthPanels();
  try {
    const res = await request('/api/platform-auth', {
      method: 'POST',
      body: JSON.stringify({ platform, interactive }),
    });
    toast(`${platform}: ${res.platform.message}`);
    mergePlatformAuth(res.platform);
  } catch (error) {
    if (error.apiCode === 'LOGIN_SESSION_INVALID' || error.message.includes('重新点击登录') || error.message.includes('会话不存在') || error.message.includes('已过期')) {
      delete state.loginSessions[platform];
    }
    toast(error.message, 'error');
  } finally {
    state.authChecking.delete(platform);
    renderAuthPanels();
  }
}

function mergePlatformAuth(platform) {
  if (!state.data?.platforms || !platform?.id) return;
  const target = state.data.platforms.find(item => item.id === platform.id);
  if (target) Object.assign(target, platform);
  renderAuthPanels();
}

async function checkAllAuth(options = {}) {
  if (state.authCheckingAll || !state.data?.platforms?.length) return;
  state.authCheckingAll = true;
  const platformIds = state.data.platforms.filter(platform=>platform.auto_check_auth!==false).map(platform => platform.id);
  state.lastProgress = [`正在检查 ${platformIds.length} 个平台登录状态`, '每次最多并发检查 4 个平台'];
  renderAuthPanels();
  renderProgress(state.lastProgress);

  let done = 0;
  const queue = [...platformIds];
  const workerCount = Math.min(4, queue.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      const platform = queue.shift();
      state.authChecking.add(platform);
      renderAuthPanels();
      try {
        const res = await request('/api/platform-auth', {
          method: 'POST',
          body: JSON.stringify({ platform, interactive: !options.silent }),
        });
        mergePlatformAuth(res.platform);
        if (res.skippedInteractive) {
          state.lastProgress = [`已跳过 ${PLATFORM_NAMES[platform] || platform} 的无弹窗检查`, '需要打开浏览器的平台请单独点击“检查”'];
        }
      } catch (error) {
        if (!options.silent) toast(`${platform}: ${error.message}`, 'error');
      } finally {
        done += 1;
        state.authChecking.delete(platform);
        state.lastProgress = [`平台登录状态检查中：${done}/${platformIds.length}`, '检查完成后仍可手动单个平台自检'];
        renderAuthPanels();
        renderProgress(state.lastProgress);
      }
    }
  });

  await Promise.all(workers);
  state.authCheckingAll = false;
  const loggedIn = state.data.platforms.filter(platform => platform.id !== 'zip-download' && platform.auth_status === 'logged_in').length;
  state.lastProgress = [`平台登录状态检查完成：${loggedIn}/${platformIds.length} 已登录`];
  renderAuthPanels();
  renderProgress(state.lastProgress);
  toast(options.silent ? '已自动检查平台登录状态' : '平台登录状态已检查');
}

async function startLogin(platform) {
  if (state.loginStarting.has(platform) || state.loginFinishing.has(platform)) return;
  state.loginStarting.add(platform);
  renderAuthPanels();
  try {
    toast(`${platform}: 正在打开登录浏览器`);
    const res = await request('/api/platform-login/start', {
      method: 'POST',
      body: JSON.stringify({ platform }),
    });
    state.loginSessions[platform] = res.session.id;
    toast(res.message || `${platform}: 登录流程已启动`);
    renderAuthPanels();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    state.loginStarting.delete(platform);
    renderAuthPanels();
  }
}

async function finishLogin(platform) {
  const sessionId = state.loginSessions[platform];
  if (!sessionId) return toast('请先点击登录', 'error');
  if (state.loginFinishing.has(platform)) return;
  state.loginFinishing.add(platform);
  renderAuthPanels();
  try {
    toast(`${platform}: 正在导出登录 Cookie`);
    const res = await request('/api/platform-login/finish', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
    delete state.loginSessions[platform];
    toast(`${platform}: ${res.platform.message}`);
    await loadData();
  } catch (error) {
    if (error.apiCode === 'LOGIN_SESSION_INVALID' || error.message.includes('重新点击登录') || error.message.includes('会话不存在') || error.message.includes('已过期')) {
      delete state.loginSessions[platform];
      const record = state.data?.platforms?.find(item => item.id === platform);
      if (record) { record.auth_status = 'unknown'; record.message = '登录会话已失效，请重新连接'; }
    }
    toast(error.message, 'error');
  } finally {
    state.loginFinishing.delete(platform);
    renderAuthPanels();
  }
}

async function refreshPlatforms() {
  try {
    const res = await request('/api/platforms?refresh=1');
    toast(res.warning || '平台列表已刷新');
    await loadData();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function openPlatformSession(platform, url) {
  if (!platform) return toast('缺少平台 ID', 'error');
  try {
    await request('/api/platform-open', {
      method: 'POST',
      body: JSON.stringify({ platform, url }),
    });
    toast(`${platform}: 已用平台登录会话打开`);
  } catch (error) {
    toast(error.message, 'error');
  }
}

function isActionEventIsolated(target) {
  const element = target instanceof Element ? target : target?.parentElement;
  return Boolean(element?.closest('[data-user-editable], [data-imported-article], iframe[sandbox]'));
}

document.addEventListener('click', event => {
  if (isActionEventIsolated(event.target)) return;

  const nav = event.target.closest('[data-view]');
  if (nav) {
    void runContentTransition(() => switchView(nav.dataset.view));
    return;
  }

  const action = event.target.closest('[data-action]');
  if (!action) return;

  const { action: name, date, id, platform, url } = action.dataset;
  if (name === 'select-content-mode') { selectContentMode(action.dataset.contentMode); return; }
  if (name === 'toggle-content-library') { toggleContentLibrary(); return; }
  if (name === 'open-publish-recovery') { void openPublishRecovery({contentId:id,platform}); return; }
  if (name === 'close-publish-recovery') { closePublishRecovery(); return; }
  if (name === 'reload-recovery') { void loadPublishRecovery(); return; }
  if (name === 'restore-working-copy') { void restoreWorkingCopy(); return; }
  if (name === 'reopen-recovery-window') { void reopenRecoveryWindow(); return; }
  if (name === 'confirm-recovery-not-submitted') { void confirmRecoveryNotSubmitted(); return; }
  if (name === 'prepare-after-recovery') { prepareAfterRecovery(); return; }
  if (name === 'recovery-platform-login') { void goToRecoveryLogin(); return; }
  if (name === 'toggle-sidebar') {
    const collapsed = !document.body.classList.contains('sidebar-collapsed');
    applySidebarCollapsed(collapsed);
    setStoredSidebarCollapsed(collapsed);
    return;
  }
  if (name === 'reload') loadData();
  if (name === 'refresh-platforms') refreshPlatforms();
  if (name === 'go-publish') void runContentTransition(() => switchView('publish'));
  if (name === 'go-history') void runContentTransition(() => switchView('history'));
  if (name === 'open-plan-range') openPlanDialog();
  if (name === 'close-plan-dialog') $('#plan-dialog').close();
  if (name === 'create-plan-range') createPlanRange();
  if (name === 'open-import-dialog') openImportDialog();
  if (name === 'cancel-import') cancelImport();
  if (name === 'choose-import-file') $('#import-file-input').click();
  if (name === 'select-import-tab') setImportTab(action.dataset.importTab);
  if (name === 'submit-import') submitImport();
  if (name === 'start-topic-research') void startTopicResearch();
  if (name === 'refresh-topic-research') void loadTopicResearch();
  if (name === 'adopt-topic') void adoptTopic(action.dataset.cardId);
  if (name === 'shift-plan-range') shiftPlanRange(Number(action.dataset.days || 0));
  if (name === 'save-plan') savePlan(date);
  if (name === 'generate-topics') generateTopics(date || state.selectedDate);
  if (name === 'select-plan-date') {
    void runContentTransition(() => {
      state.selectedDate = date;
      switchView('plans');
    });
  }
  if (name === 'confirm-candidate') confirmCandidate(id);
  if (name === 'close-dialog') $('#candidate-dialog').close();
  if (name === 'close-layout-dialog') $('#layout-dialog').close();
  if (name === 'generate-content-from-date') generateContent(date);
  if (name === 'open-content' || name === 'select-content') {
    void runContentTransition(() => {
      state.selectedContentId = id;
      syncContentPageToSelected();
      applyContentPlatforms(getSelectedContent());
      switchView('content');
    });
  }
  if (name === 'layout-selected') layoutContent();
  if (name === 'layout-content') layoutContent(id);
  if (name === 'generate-wechat-layout') generateWechatLayout(id);
  if (name === 'random-wechat-template') chooseRandomWechatTemplate();
  if (name === 'save-content') void saveContent(id, { userInitiated: true });
  if (name === 'save-draft') saveDraft(id);
  if (name === 'publish-content' || name === 'publish-selected') publishContent(id);
  if (name === 'publish-selected-direct') publishContent(id, 'direct');
  if (name === 'select-preview-platform') selectPreviewPlatform(platform);
  if (name === 'retry-platform-preview') retryPlatformPreview(platform);
  if (name === 'select-preview-device') selectPreviewDevice(action.dataset.previewDevice);
  if (name === 'open-platform-draft') {
    openSinglePublishConfirmation({ contentId: id, platform, mode: 'draft' });
  }
  if (name === 'open-platform-direct') {
    openSinglePublishConfirmation({ contentId: id, platform, mode: 'direct' });
  }
  if (name === 'cancel-single-publish') cancelSinglePublish();
  if (name === 'confirm-single-publish') confirmSinglePlatformPublish();
  if (name === 'check-auth') checkAuth(platform);
  if (name === 'check-all-auth') checkAllAuth();
  if (name === 'start-login') startLogin(platform);
  if (name === 'finish-login') finishLogin(platform);
  if (name === 'open-platform-session') openPlatformSession(platform, url);
  if (name === 'history-page') {
    state.historyPage = Number(action.dataset.page || 1);
    renderHistory();
  }
  if (name === 'content-page') {
    void runContentTransition(() => {
      state.contentPage = Number(action.dataset.page || 1);
      renderContent();
    });
  }
});

document.addEventListener('change', event => {
  if (isActionEventIsolated(event.target)) return;

  const importFile = event.target.closest('#import-file-input');
  if (importFile) {
    readImportFile(importFile);
    return;
  }

  const previewPlatform = event.target.closest('[data-platform-preview-select]');
  if (previewPlatform) {
    selectPreviewPlatform(previewPlatform.value);
    return;
  }

  const wechatTemplate = event.target.closest('[data-wechat-template-select]');
  if (wechatTemplate) {
    if (state.contentOperationLocks.has(String(state.selectedContentId))) {
      wechatTemplate.value = state.selectedWechatTemplate;
      return;
    }
    state.selectedWechatTemplate = wechatTemplate.value;
    state.wechatTemplateChoices.set(state.selectedContentId, wechatTemplate.value);
    markContentDirty(state.selectedContentId);
    return;
  }

  const planStatus = event.target.closest('[data-plan-field="status"]');
  if (planStatus) {
    syncStatusSelectClass(planStatus);
    return;
  }

  const checkbox = event.target.closest('[data-platform-choice]');
  if (checkbox) {
    if (checkbox.checked) state.selectedPlatforms.add(checkbox.dataset.platformChoice);
    else state.selectedPlatforms.delete(checkbox.dataset.platformChoice);
    syncPublishSelectionUi();
    return;
  }

  const planRange = event.target.closest('[data-plan-range]');
  if (planRange) {
    if (planRange.dataset.planRange === 'start') state.planStartDate = planRange.value;
    if (planRange.dataset.planRange === 'end') state.planEndDate = planRange.value;
    renderPlans();
    return;
  }

  const historyFilter = event.target.closest('[data-history-filter]');
  if (historyFilter && historyFilter.dataset.historyFilter !== 'keyword') {
    state.historyFilters[historyFilter.dataset.historyFilter] = historyFilter.value;
    state.historyPage = 1;
    renderHistory();
  }
});

document.addEventListener('keydown', event => {
  if (isActionEventIsolated(event.target)) return;
  handleTablistKeydown(event);
});

document.addEventListener('input', event => {
  if (isActionEventIsolated(event.target)) return;

  const historyFilter = event.target.closest('[data-history-filter="keyword"]');
  if (historyFilter) {
    state.historyFilters.keyword = historyFilter.value;
    state.historyPage = 1;
    renderHistory();
    requestAnimationFrame(() => {
      const input = $('[data-history-filter="keyword"]');
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }
});

document.addEventListener('mousedown', event => {
  if (isActionEventIsolated(event.target)) return;
  const target = event.target.closest('button, .metric, .platform-card, .day-cell, .content-item, .platform-check');
  if (!target || target.disabled) return;

  const rect = target.getBoundingClientRect();
  const baseDiameter = Math.max(rect.width, rect.height);
  const diameter = Math.max(22, Math.min(baseDiameter * 0.48, 72));
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = `${diameter}px`;
  ripple.style.height = `${diameter}px`;
  ripple.style.left = `${event.clientX - rect.left - diameter / 2}px`;
  ripple.style.top = `${event.clientY - rect.top - diameter / 2}px`;

  const isDark = target.classList.contains('primary')
    || target.classList.contains('primary-mini');
  if (isDark) ripple.classList.add('light');

  target.querySelectorAll(':scope > .ripple').forEach(node => node.remove());
  target.appendChild(ripple);
  setTimeout(() => ripple.remove(), 650);
});

$('#platform-publish-dialog').addEventListener('cancel', handleSinglePublishDialogCancel);
$('#import-content-input').addEventListener('paste', beginPasteImport);
window.addEventListener('beforeunload', handleBeforeUnload);

loadData().catch(error => {
  document.body.innerHTML = `<div class="empty" style="margin:40px;">启动失败：${escapeHtml(error.message)}</div>`;
});

function scheduleDraftPreview(id) {
  clearTimeout(state.draftPreviewTimer);
  clearPlatformPreviews(String(id));
  state.draftPreviewTimer = setTimeout(() => {
    if (String(state.selectedContentId) !== String(id) || !state.dirtyContentIds.has(String(id))) return;
    void loadPlatformPreview(getSelectedContent(), state.activePreviewPlatform);
  }, 450);
}

async function readSelectedImportImages() {
  const files = [...($('#import-images-input')?.files || [])];
  if (files.length > 40 || files.reduce((n,f) => n + f.size, 0) > 24 * 1024 * 1024) throw new Error('最多40张配图、合计24 MiB');
  return Promise.all(files.map(file => {
    if (file.size > 8 * 1024 * 1024) throw new Error('单张配图不能超过8 MiB');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, relativePath: file.webkitRelativePath || file.name,
        dataBase64: String(reader.result).split(',')[1] || '' });
      reader.onerror = () => reject(new Error(`配图读取失败：${file.name}`));
      reader.readAsDataURL(file);
    });
  }));
}

async function submitFeishuImport() {
  const url = $('#import-feishu-url').value.trim();
  if (!url) return setImportFeedback('请粘贴飞书文档链接', 'error');
  state.importSubmitting = true;
  const submit = $('[data-action="submit-import"]'); submit.disabled = true; submit.textContent = '正在导出图文…';
  try {
    await runContentTransition(async () => {
      setImportFeedback('正在读取飞书文档、下载配图并导入本地，请稍候…');
      try {
        const result = await request('/api/content/import-feishu', { method: 'POST', body: JSON.stringify({ url }) });
        state.selectedContentId = result.content.id;
        $('#import-dialog').close(); resetImportDialog(); await loadData(); switchView('content');
        toast(`已导入《${result.content.title}》，${result.assetCount} 张配图`);
        if (result.warnings?.length) toast(result.warnings.join('；'), 'error');
      } catch (error) { setImportFeedback(error.message || '飞书导入失败', 'error'); }
    });
  } catch (error) { setImportFeedback(error.message || '飞书导入失败，未伪造内容', 'error'); }
  finally { state.importSubmitting = false; submit.disabled = false; submit.textContent = '导入并打开'; }
}

const TOPIC_PLATFORMS = ['weixin','woshipm','sspai','xiaohongshu','uisdc','douyin','zhihu','toutiao'];
function topicPlatformName(id) { return id === 'woshipm' ? '人人都是产品经理' : platformName(id); }
function topicResearchPanel() {
  if (!state.topicLoaded && !state.topicLoading) { state.topicLoaded = true; setTimeout(() => void loadTopicResearch(), 0); }
  const run = state.topicRun;
  const busy = state.topicLoading || ['collecting','analyzing'].includes(run?.status);
  const labels = { collecting:'采集来源中', analyzing:'共用 Skill 分析中', ready:'选题可供选择', blocked:'来源受限',
    failed:'采集失败', analysis_failed:'分析未完成，来源已保留', interrupted:'上次任务中断', insufficient_evidence:'证据不足，暂不出题' };
  const collection = run?.collection?.platforms || [];
  const statusNames = { ok:'已采集', ready:'已采集', success:'已采集', partial:'部分可用', needs_login:'需要登录',
    source_unavailable:'来源暂不可用', needs_sources:'缺少来源', blocked:'访问受限', unavailable:'暂不可用', error:'采集失败' };
  const selected = state.topicPlatforms || TOPIC_PLATFORMS;
  return `<section class="panel topic-research-panel" aria-label="常用平台选题雷达">
    <div class="panel-head"><div><h2>常用平台选题雷达</h2><p class="field-note">按平台收集内容线索，结合你的关注领域生成选题。各平台的来源和采集状态单独显示。</p></div>
    <span role="status">${escapeHtml(run ? labels[run.status] || run.status : '尚未采集')}</span></div>
    <label for="topic-keyword">关注领域</label><input id="topic-keyword" data-user-editable value="${escapeHtml(state.topicKeyword || 'AI工具、产品、效率工作流和职业实践')}" maxlength="200" ${busy?'disabled':''}>
    <div class="topic-platform-choices">${TOPIC_PLATFORMS.map(id=>`<label><input type="checkbox" data-topic-platform="${id}" ${selected.includes(id)?'checked':''} ${busy?'disabled':''}>${escapeHtml(topicPlatformName(id))}</label>`).join('')}</div>
    <details><summary>补充参考链接（可选）</summary><p class="field-note">每个平台一行一个链接。仅接受对应来源，不抓取任意网址或本机地址。</p>${TOPIC_PLATFORMS.map(id=>`<label>${escapeHtml(topicPlatformName(id))}<textarea data-topic-source="${id}" rows="2" data-user-editable ${busy?'disabled':''}>${escapeHtml(state.topicSourceUrls?.[id] || '')}</textarea></label>`).join('')}</details>
    <div class="toolbar"><button class="primary" data-action="start-topic-research" ${busy?'disabled':''}>${busy?'处理中…':'采集并分析选题'}</button><button class="secondary" data-action="refresh-topic-research">刷新状态</button></div>
    <p class="field-note">分析调用本机 Codex，会使用账号额度；不会改写原稿。网站需要登录时不会绕过限制。</p>
    ${run?.error?`<div class="preview-warning-box" role="alert">${escapeHtml(run.error)}</div>`:''}
    ${collection.length?`<div class="topic-source-status">${collection.map(p=>`<div><strong>${escapeHtml(topicPlatformName(p.id))}</strong> · ${escapeHtml(statusNames[p.status]||p.status)} · ${(p.items||[]).length} 条${p.reason?`<p>${escapeHtml(p.reason)}</p>`:''}</div>`).join('')}</div>`:''}
    ${run?.analysis?`<p>${escapeHtml(run.analysis.summary)}</p>`:''}
    <div class="topic-cards">${(run?.analysis?.cards||[]).map(card=>`<article class="topic-card"><h3>${escapeHtml(card.topic)}</h3><p><strong>读者问题：</strong>${escapeHtml(card.reader_problem)}</p><p><strong>切入点：</strong>${escapeHtml(card.angle)}</p><p><strong>为什么现在：</strong>${escapeHtml(card.why_now)}</p><p><strong>读者带走：</strong>${escapeHtml(card.reader_payoff)}</p><p class="field-note">适合 ${card.platforms.map(topicPlatformName).map(escapeHtml).join('、')} · 事实风险 ${escapeHtml(card.risk)}</p><ul>${card.missing_evidence.map(e=>`<li>${escapeHtml(e)}</li>`).join('')}</ul><div>${(run.signals||[]).filter(s=>card.evidence_ids.includes(s.id)).map(s=>`<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a>`).join('<br>')}</div><div class="toolbar"><input type="date" data-topic-adopt-date="${escapeHtml(card.id)}" value="${escapeHtml(state.data?.today||'')}"><button class="secondary" data-action="adopt-topic" data-card-id="${escapeHtml(card.id)}">采用到计划</button></div></article>`).join('')}</div>
    ${(run?.signals||[]).length?`<details><summary>查看本次 ${run.signals.length} 条来源线索</summary><ul>${run.signals.map(s=>`<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a><span class="field-note"> · ${escapeHtml(s.sourceKind)} · ${escapeHtml(s.publishedAt||'发布日期未确认')}</span></li>`).join('')}</ul></details>`:''}
    </section>`;
}
async function loadTopicResearch() {
  if (state.topicLoading) return;
  const requestVersion = ++state.topicRequestVersion;
  state.topicLoading = true;
  try { const result = await request('/api/topics/research'); if(requestVersion===state.topicRequestVersion) state.topicRun = result.run; }
  catch (error) { if(requestVersion===state.topicRequestVersion) toast(error.message || '选题状态读取失败', 'error'); }
  finally { if(requestVersion===state.topicRequestVersion){state.topicLoading = false; if (state.activeView==='plans') renderPlans();} }
  if(requestVersion!==state.topicRequestVersion) return;
  clearTimeout(state.topicPollTimer);
  if (['collecting','analyzing'].includes(state.topicRun?.status)) state.topicPollTimer=setTimeout(()=>void loadTopicResearch(),2500);
}
async function startTopicResearch() {
  if(state.topicLoading || ['collecting','analyzing'].includes(state.topicRun?.status)) return;
  const requestVersion=++state.topicRequestVersion;
  state.topicKeyword = $('#topic-keyword').value;
  state.topicPlatforms = $$('[data-topic-platform]:checked').map(el=>el.dataset.topicPlatform);
  state.topicSourceUrls = Object.fromEntries($$('[data-topic-source]').map(el=>[el.dataset.topicSource,el.value]));
  const sourceUrlsByPlatform=Object.fromEntries(Object.entries(state.topicSourceUrls).map(([id,text])=>[id,text.split(/\n/).map(s=>s.trim()).filter(Boolean)]).filter(([,urls])=>urls.length));
  state.topicLoading=true; renderPlans();
  try { const result=await request('/api/topics/research',{method:'POST',body:JSON.stringify({keyword:state.topicKeyword,platforms:state.topicPlatforms,sourceUrlsByPlatform})}); if(requestVersion===state.topicRequestVersion)state.topicRun=result.run; }
  catch(error){if(requestVersion===state.topicRequestVersion)toast(error.message||'选题任务启动失败','error');}
  finally {if(requestVersion===state.topicRequestVersion){state.topicLoading=false;renderPlans();void loadTopicResearch();}}
}
async function adoptTopic(cardId) {
  const date=$(`[data-topic-adopt-date="${CSS.escape(cardId)}"]`)?.value;
  try {await request('/api/topics/adopt',{method:'POST',body:JSON.stringify({runId:state.topicRun.id,cardId,date})});state.planStartDate=date;state.planEndDate=date;await loadData();toast('选题已加入计划，未生成或发布正文');}
  catch(error){toast(error.message||'采用失败','error');}
}

function distinctWechatTemplates(templates, selectedFilename) {
  const groups = new Map();
  for (const template of templates) {
    const key = template.label || template.filename;
    if (!groups.has(key) || template.filename === selectedFilename) groups.set(key, template);
  }
  return [...groups.values()];
}

function selectContentMode(mode) {
  if (!['edit', 'preview'].includes(mode)) return false;
  state.contentMode = mode;
  for (const tab of $$('[data-content-mode][role="tab"]')) {
    const active = tab.dataset.contentMode === mode;
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.setAttribute('tabindex', active ? '0' : '-1');
  }
  const editor = $('#content-editor-panel');
  const preview = $('#content-preview-panel');
  if (editor) editor.hidden = mode !== 'edit';
  if (preview) preview.hidden = mode !== 'preview';
  const workspace = $('#view-content .content-adaptation-workspace');
  if (workspace) workspace.dataset.contentMode = mode;
  if (mode === 'preview') void loadPlatformPreview(getSelectedContent(), state.activePreviewPlatform);
  return true;
}

function syncContentLibraryButton() {
  const library = $('#content-library');
  const button = $('#view-content [data-action="toggle-content-library"]');
  if (!library || !button) return;
  const shown = getComputedStyle(library).display !== 'none';
  button.setAttribute('aria-expanded', shown ? 'true' : 'false');
  button.textContent = `${shown ? '收起' : '展开'}文章列表（${state.data?.contents?.length || 0}）`;
}

function toggleContentLibrary() {
  const library = $('#content-library');
  const layout = $('#view-content .content-layout');
  if (!library || !layout) return;
  state.libraryVisibility = getComputedStyle(library).display === 'none' ? 'shown' : 'hidden';
  layout.dataset.libraryVisibility = state.libraryVisibility;
  syncContentLibraryButton();
}

window.addEventListener('resize', syncContentLibraryButton);

function recoveryTargetPlatform() {
  const selected=state.activeView==='publish' ? [...state.selectedPlatforms] : [];
  return (selected.length ? selected.includes(state.publishRecoveryError?.platform) ? state.publishRecoveryError.platform : selected[0] : null)
    || (state.activeView==='content' ? state.activePreviewPlatform : state.publishRecoveryError?.platform) || state.activePreviewPlatform || 'xiaohongshu';
}

function showPublishRecoveryError(error, contentId, platform) {
  state.publishRecoveryError = {contentId:String(contentId),platform:platform || recoveryTargetPlatform(),code:error?.apiCode || '',message:error?.message || '同步未完成'};
  renderRecoveryBanners();
  const button=$('#single-publish-recovery-button');if(button)button.hidden=false;
}

function renderRecoveryBanners() {
  if(!state.data)return;
  const id=String(state.selectedContentId || '');
  const platform=recoveryTargetPlatform();
  const job=state.data.jobs?.find(j=>String(j.content_id)===id && j.results?.some(r=>r.platform===platform));
  const result=job?.results?.find(r=>r.platform===platform);
  const conflict=state.contentCanonicalConflicts?.has(id);
  const error=state.publishRecoveryError?.contentId===id && state.publishRecoveryError.platform===platform ? state.publishRecoveryError : null;
  const needsRecovery=conflict || error || ['uncertain','failed','retry_allowed'].includes(result?.status);
  for(const host of $$('[data-publish-recovery-banner]')) {
    host.innerHTML=needsRecovery ? `<div class="recovery-banner" role="status"><div><strong>${conflict?'本地稿件需要恢复最新版本':escapeHtml(platformName(platform))+'：'+(result?.status==='retry_allowed'?'已人工确认可重新准备':'同步需要恢复或核对')}</strong><p>${conflict?'本页编辑仍保留。先保留副本并读取最新稿，不会直接覆盖任一版本。':'关闭窗口不等于没有保存或发布。可以恢复原窗口、查看已有草稿；结果未确认时不自动重发。'}</p></div><button class="secondary" data-action="open-publish-recovery" data-id="${escapeHtml(id)}" data-platform="${escapeHtml(platform)}">恢复工作</button></div>` : '';
  }
}

function currentDraftSnapshot(contentId) {
  const content=state.data?.contents?.find(c=>String(c.id)===String(contentId));
  if(!content)throw new Error('未找到当前稿件，请刷新工作台');
  return {title:$(`[data-content-title="${contentId}"]`)?.value ?? content.title,
    summary:$(`[data-content-summary="${contentId}"]`)?.value ?? content.summary ?? '',
    body:$(`[data-content-body="${contentId}"]`)?.innerHTML ?? content.body ?? '',
    template:state.wechatTemplateChoices?.get(contentId)
      || String(content.layout_html || '').match(/data-wechat-template="([^"]+)"/)?.[1] || '',
    updated_at:content.updated_at};
}

function recoveryDraftDiffers(local, saved) {
  const canonicalBody=html=>sanitizeClientCanonicalHtml(String(html || '')).trim();
  const savedTemplate=String(saved.layout_html || '').match(/data-wechat-template="([^"]+)"/)?.[1] || '';
  return local.title!==saved.title || String(local.summary || '')!==String(saved.summary || '')
    || canonicalBody(local.body)!==canonicalBody(saved.body)
    || Boolean(local.template && local.template!==savedTemplate);
}

async function openPublishRecovery({contentId,platform}={}) {
  if(state.recoveryBusy)return;
  const id=String(contentId || state.pendingSinglePublish?.contentId || state.selectedContentId || '');
  if(!id)return;
  if(state.singlePublishSubmitting || state.batchPublishSubmitting){toast('同步仍在执行，请等待当前操作返回','error');return;}
  const targetPlatform=platform || state.pendingSinglePublish?.platform || recoveryTargetPlatform();
  if($('#platform-publish-dialog')?.open)cancelSinglePublish();
  state.recoveryContext={contentId:id,platform:targetPlatform,data:null,feedback:'',backupId:null};
  const dialog=$('#publish-recovery-dialog');if(!dialog.open)dialog.showModal();
  await loadPublishRecovery();
}

function closePublishRecovery() {
  if(state.recoveryBusy)return false;
  state.recoveryRequestVersion++;state.recoveryContext=null;
  $('#publish-recovery-dialog')?.close();return true;
}

async function loadPublishRecovery() {
  const context=state.recoveryContext;if(!context)return;
  const version=++state.recoveryRequestVersion;context.loading=true;renderPublishRecovery();
  try {
    const response=await request(`/api/content/${encodeURIComponent(context.contentId)}/recovery?platform=${encodeURIComponent(context.platform)}`);
    if(state.recoveryContext!==context || version!==state.recoveryRequestVersion)return;
    context.data=response.recovery;context.loading=false;renderPublishRecovery();
  } catch(error) {
    if(state.recoveryContext!==context || version!==state.recoveryRequestVersion)return;
    context.loading=false;context.data=null;context.feedback=error.message;context.feedbackError=true;renderPublishRecovery();
  }
}

function renderPublishRecovery() {
  const context=state.recoveryContext,host=$('#publish-recovery-body');if(!context || !host)return;
  const data=context.data,job=data?.latestJob,result=job?.results?.find(r=>r.platform===context.platform);
  const local=state.data?.contents?.find(c=>String(c.id)===context.contentId);
  const needsRefresh=state.contentCanonicalConflicts?.has(context.contentId) || (data?.content && local?.updated_at!==data.content.updated_at);
  const session=context.sessionProblem || data?.session || {},sessionLabels={open:'原登录会话仍可连接，可找回标签页或重新打开窗口',closed:'平台浏览器已关闭，可沿原登录目录重新打开',missing:'未找到可恢复的登录会话，请先重新登录',mismatch:'浏览器身份不匹配，已停止连接，请重新登录',not_required:'此平台通过已保存的凭据连接；查看草稿仍需打开平台后台'};
  const definitive=['success','platform_draft'].includes(result?.status);
  const canPrepare=data && state.data.platforms.some(p=>p.id===context.platform) && !['uisdc','jianshu','netease'].includes(context.platform) && !needsRefresh && !['closed','missing','mismatch'].includes(session.state) && !definitive
    && !data.canConfirmNotSubmitted && (!result || ['failed','retry_allowed'].includes(result.status));
  const recoveryPlatforms=[...(state.data?.platforms || [])];if(!recoveryPlatforms.some(p=>p.id===context.platform))recoveryPlatforms.push({id:context.platform,name:platformName(context.platform)});
  host.innerHTML=`<label for="recovery-platform">需要恢复的平台</label><select id="recovery-platform" class="recovery-platform-select" data-recovery-platform>${sortLoginPlatforms(recoveryPlatforms).map(p=>`<option value="${escapeHtml(p.id)}" ${p.id===context.platform?'selected':''}>${escapeHtml(platformName(p.id))}${state.data.platforms.some(active=>active.id===p.id)?'':'（历史）'}</option>`).join('')}</select>
    ${!data ? `<p class="recovery-feedback">${context.loading?'正在读取稿件、窗口与上次同步状态…':escapeHtml(context.feedback || '读取未完成')}</p><button class="secondary" data-action="reload-recovery">重新读取状态</button>` : `
    <section class="recovery-section"><h3>1. 本地稿件</h3><p>${needsRefresh?'本页与保存的稿件版本不同。恢复时会先另存当前编辑，再读取最新稿。':'原稿保存在工作台；恢复平台窗口不会清空本页编辑。'}</p><button class="secondary" data-action="restore-working-copy">保留编辑并读取最新稿</button></section>
    <section class="recovery-section"><h3>2. 恢复平台窗口</h3><p>${escapeHtml(sessionLabels[session.state] || session.message || '窗口状态待确认')}</p><div class="recovery-actions">${['missing','mismatch'].includes(session.state)?'<button class="secondary" data-action="recovery-platform-login">前往平台登录</button>':`<button class="primary" data-action="reopen-recovery-window">${definitive?'查看已保存草稿 / 平台结果':session.state==='closed'?'重新打开平台窗口':'打开原窗口核对'}</button>`}</div><p>只打开或恢复窗口，不重新填稿、不点击发布。</p></section>
    <section class="recovery-section"><h3>3. 核对上次同步</h3><p>${result?escapeHtml(statusLabel(result.status)+'：'+(result.message || result.error || '请到平台核对')):'没有找到该稿件在此平台的同步记录。'}</p>
      ${data.canConfirmNotSubmitted?`<label class="recovery-confirm"><input type="checkbox" data-confirm-not-submitted><span>我已检查平台的草稿、审核中和已发布列表，确认这次内容未保存、未提交审核，也未发布。</span></label><button class="secondary" data-action="confirm-recovery-not-submitted" disabled>确认后允许重新准备</button><p>如果仍在处理中或无法判断，请不要勾选。这是人工核对声明，只解除本平台的重试限制，不会自动再次投递。</p>`:''}
      ${canPrepare?'<button class="secondary" data-action="prepare-after-recovery">重新准备（不发布）</button><p>进入草稿/编辑页准备流程，仍需你确认；不会直接公开发布。</p>':''}
      ${needsRefresh?'<p>请先恢复本地稿件版本，再决定是否重新准备。</p>':''}
      ${definitive?'<p>已有明确保存/发布结果，不再新建同一份内容。请使用上面的入口查看。</p>':''}
    </section><p class="recovery-feedback ${context.feedbackError?'error':''}" role="status">${escapeHtml(context.feedback || '')}</p>`}`;
  if(state.recoveryBusy || context.loading)host.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
}

async function restoreWorkingCopy() {
  const context=state.recoveryContext;if(!context || state.recoveryBusy)return;
  const operation=beginContentOperation(context.contentId);if(!operation){toast('稿件操作尚未结束，请稍候','error');return;}
  state.recoveryBusy=true;context.feedback='正在核对并保留本页编辑…';context.feedbackError=false;renderPublishRecovery();
  let createdBackup=false;
  try {
    const snapshot=currentDraftSnapshot(context.contentId);
    const response=await request(`/api/content/${encodeURIComponent(context.contentId)}/recovery?platform=${encodeURIComponent(context.platform)}`);
    if(!contentOperationIsStable(operation))throw new Error('本页编辑又发生变化，已保留原页面，请重新恢复');
    if(recoveryDraftDiffers(snapshot,response.recovery.content)) {
      const title=Array.from(snapshot.title || '').length<=192 ? snapshot.title+'（恢复副本）' : snapshot.title;
      const copy=await request('/api/content/import',{method:'POST',body:JSON.stringify({title,summary:snapshot.summary,body:snapshot.body,type:'恢复副本',filename:'recovery.html',format:'html'})});
      if(!copy.content?.id)throw new Error('恢复副本未确认保存，未载入新版本，本页编辑仍保留');
      context.backupId=copy.content.id;
      createdBackup=true;
      if(snapshot.template) {
        try {await request(`/api/content/${encodeURIComponent(copy.content.id)}/layout`,{method:'POST',body:JSON.stringify({template:snapshot.template,expectedUpdatedAt:copy.content.updated_at})});}
        catch{context.feedback='恢复副本正文已保存，模板需重新选择。';}
      }
    }
    const fresh=await request('/api/bootstrap');
    if(!contentOperationIsStable(operation))throw new Error('本页编辑又发生变化；已保存的恢复副本保留，请重新检查');
    if(!fresh.data?.contents?.some(c=>String(c.id)===context.contentId))throw new Error('原稿已不存在；本页和恢复副本均保留');
    state.workbenchCsrfToken=fresh.data.csrfToken || state.workbenchCsrfToken;
    state.data=fresh.data;state.contentCanonicalConflicts.delete(context.contentId);state.dirtyContentIds.delete(context.contentId);
    state.wechatTemplateChoices.delete(context.contentId);clearPlatformPreviews(context.contentId);state.publishRecoveryError=null;
    state.selectedContentId=context.contentId;syncContentPageToSelected();render();
    context.feedback=createdBackup?'已保留恢复副本并载入最新稿。原稿没有被覆盖。':'本页内容与保存稿一致，已同步最新版本，无需创建副本。';
    context.feedbackError=false;
  } catch(error){context.feedback=error.message;context.feedbackError=true;}
  finally {endContentOperation(operation);state.recoveryBusy=false;await loadPublishRecovery();}
}

async function reopenRecoveryWindow() {
  const context=state.recoveryContext;if(!context || state.recoveryBusy)return;
  const result=context.data?.latestJob?.results?.find(r=>r.platform===context.platform);
  state.recoveryBusy=true;context.feedback='正在恢复原平台窗口，不会重新投递…';context.feedbackError=false;renderPublishRecovery();
  try {const response=await request('/api/platform-open',{method:'POST',body:JSON.stringify({platform:context.platform,...(result?.url?{url:result.url}:{})})});context.sessionProblem=null;context.feedback=response.opened?.recoveryType==='reused'?'已回到原标签页，没有清空或重新填写内容。请核对草稿和发布结果。':response.opened?.recoveryType==='reopened'?'已沿原登录目录重开浏览器。未保存的页内编辑不保证恢复，请核对草稿/作品；没有重新投递。':'已在原会话打开核对页面，没有重新填稿或发布。';}
  catch(error){context.feedback=error.message;context.feedbackError=true;if(['SESSION_MISSING','SESSION_MISMATCH'].includes(error.apiCode))context.sessionProblem={state:error.apiCode==='SESSION_MISSING'?'missing':'mismatch'};}
  finally{state.recoveryBusy=false;await loadPublishRecovery();}
}

async function confirmRecoveryNotSubmitted() {
  const context=state.recoveryContext,checked=$('[data-confirm-not-submitted]')?.checked;
  if(!context?.data?.canConfirmNotSubmitted || !checked || state.recoveryBusy)return;
  const job=context.data.latestJob;state.recoveryBusy=true;context.feedback='正在记录人工核对声明…';context.feedbackError=false;renderPublishRecovery();
  try {
    await request(`/api/publish-jobs/${encodeURIComponent(job.id)}/recovery`,{method:'POST',body:JSON.stringify({platform:context.platform,decision:'confirmed_not_submitted',confirmation:true,expectedJobUpdatedAt:job.updated_at})});
    context.feedback='已记录你的确认，只解除该平台的重试限制，尚未重新准备或发布。';
    const history=await request('/api/history');state.data.jobs=history.jobs;state.publishRecoveryError=null;renderRecoveryBanners();renderPublish();renderHistory();renderRecoveryBanners();
  }catch(error){context.feedback=error.message;context.feedbackError=true;}
  finally{state.recoveryBusy=false;await loadPublishRecovery();}
}

function prepareAfterRecovery() {
  const context=state.recoveryContext;if(!context?.data || state.recoveryBusy)return;
  const result=context.data.latestJob?.results?.find(r=>r.platform===context.platform);
  const local=state.data?.contents?.find(c=>String(c.id)===context.contentId);
  if(!state.data.platforms.some(p=>p.id===context.platform) || ['uisdc','jianshu','netease'].includes(context.platform) || state.contentCanonicalConflicts?.has(context.contentId) || local?.updated_at!==context.data.content.updated_at
    || ['closed','missing','mismatch'].includes((context.sessionProblem || context.data.session)?.state)
    || context.data.canConfirmNotSubmitted || ['success','platform_draft','uncertain'].includes(result?.status))return;
  const {contentId,platform}=context;if(!closePublishRecovery())return;
  openSinglePublishConfirmation({contentId,platform,mode:'draft'});
}

async function goToRecoveryLogin() {
  const context=state.recoveryContext;if(!context || state.recoveryBusy)return;
  if(state.dirtyContentIds.has(context.contentId) || state.contentCanonicalConflicts.has(context.contentId)) {
    await restoreWorkingCopy();
    if(state.recoveryContext!==context || context.feedbackError)return;
  }
  if(closePublishRecovery())switchView('platforms');
}

document.addEventListener('change',event=>{
  if(event.target.matches('[data-recovery-platform]') && state.recoveryContext && !state.recoveryBusy){state.recoveryContext.platform=event.target.value;state.recoveryContext.data=null;state.recoveryContext.sessionProblem=null;state.recoveryContext.feedback='';void loadPublishRecovery();}
  if(event.target.matches('[data-confirm-not-submitted]')){const button=$('[data-action="confirm-recovery-not-submitted"]');if(button)button.disabled=!event.target.checked || state.recoveryBusy;}
});
$('#publish-recovery-dialog')?.addEventListener('cancel',event=>{event.preventDefault();closePublishRecovery();});

function platformCatalogGroups(platforms) {
  const groups=[{id:'general',name:'通用内容平台',platforms:[]},{id:'technical',name:'技术与知识平台',platforms:[]},{id:'tool',name:'本地工具',platforms:[]}];
  for(const platform of sortLoginPlatforms(platforms)) {
    const id=platform.catalog_group || (platform.id==='zip-download'?'tool':['juejin','csdn','yuque','cnblogs'].includes(platform.id)?'technical':'general');
    (groups.find(group=>group.id===id) || groups[0]).platforms.push(platform);
  }
  return groups.filter(group=>group.platforms.length);
}

function platformPickerHtml(platforms) {
  return `<div class="platform-picker">${platforms.map(platform=>{
    const manual=platform.delivery_mode==='manual' || ['uisdc','jianshu','netease'].includes(platform.id);
    const labels={manual:'手工写作 / 投稿',editor:'仅准备编辑器','draft-text':'仅纯文字草稿',draft:'同步平台草稿',export:'仅本地导出'};
    const label=platform.preparation_label || labels[platformPreparationMode(platform.id)];
    return `<label class="platform-check"><input type="checkbox" data-platform-choice="${escapeHtml(platform.id)}" ${!manual && state.selectedPlatforms.has(platform.id)?'checked':''} ${manual?'disabled title="请在内容中心打开该平台的手工写作/投稿入口"':''}>${platformAvatar(platform)}<span class="platform-check-copy"><span class="platform-check-name">${escapeHtml(platform.name)}</span><small>${escapeHtml(label)}</small></span></label>`;
  }).join('')}</div>`;
}

function platformPreparationMode(platform) {
  const record = state.data?.platforms?.find(item => item.id === platform);
  return record?.preparation_mode || (['uisdc','jianshu','netease'].includes(platform) ? 'manual'
    : ['xiaohongshu','toutiao','douban'].includes(platform) ? 'editor'
    : ['douyin','qiehao'].includes(platform) ? 'draft-text'
    : platform === 'zip-download' ? 'export' : 'draft');
}

function platformHandoffResult(contentId, platform) {
  const job = state.data?.jobs?.find(item => String(item.content_id) === String(contentId)
    && item.results?.some(result => result.platform === platform));
  const result = job?.results?.find(item => item.platform === platform);
  return result?.url && ['platform_draft','uncertain','success'].includes(result.status) ? result : null;
}
