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
  'douyin',
  'toutiao',
  'xiaohongshu',
  'qiehao',
  'zhihu',
  'juejin',
  'csdn',
  'weibo',
  'bilibili',
  'baijiahao',
  'yuque',
  'douban',
  'sohu',
  'xueqiu',
  'woshipm',
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
  ['partial_failed', '部分失败'],
  ['failed', '发布失败'],
  ['local_draft', '本地草稿'],
  ['running', '发布中'],
];
const EMPLOYEES = [
  { id: 'content-editor', name: '内容编辑员', role: '正文与配图整理', avatar: '编' },
  { id: 'layout-agent', name: '排版整理员', role: '模板排版适配', avatar: '排' },
  { id: 'publisher-agent', name: '发布协同员', role: '草稿同步发布', avatar: '发' },
];
const SIDEBAR_COLLAPSED_KEY = 'content-workbench.sidebarCollapsed';
const ACTIVE_EMPLOYEE_KEY = 'content-workbench.activeEmployeeId';

const state = {
  activeView: 'dashboard',
  data: null,
  activeEmployeeId: getStoredEmployeeId(),
  employeeMenuOpen: false,
  selectedDate: '',
  planStartDate: '',
  planEndDate: '',
  selectedContentId: '',
  contentPage: 1,
  contentPageSize: 8,
  dirtyContentIds: new Set(),
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

function getStoredEmployeeId() {
  try {
    const stored = localStorage.getItem(ACTIVE_EMPLOYEE_KEY);
    return EMPLOYEES.some(employee => employee.id === stored) ? stored : EMPLOYEES[0].id;
  } catch {
    return EMPLOYEES[0].id;
  }
}

function setStoredEmployeeId(id) {
  try {
    localStorage.setItem(ACTIVE_EMPLOYEE_KEY, id);
  } catch {
    // Ignore storage errors in restricted browser modes.
  }
}

function getActiveEmployee() {
  return EMPLOYEES.find(employee => employee.id === state.activeEmployeeId) || EMPLOYEES[0];
}

function renderEmployeeSelector() {
  const active = getActiveEmployee();
  const card = $('[data-action="toggle-employee-menu"]');
  if (card) {
    card.dataset.employeeId = active.id;
    card.setAttribute('aria-expanded', state.employeeMenuOpen ? 'true' : 'false');
    card.setAttribute('aria-label', `当前操控员工：${active.name}，点击选择员工`);
    card.setAttribute('title', `当前：${active.name}，点击选择员工`);
  }
  const picker = $('[data-employee-picker]');
  if (picker) picker.classList.toggle('open', state.employeeMenuOpen);
  const menu = $('[data-employee-menu]');
  if (menu) {
    menu.innerHTML = EMPLOYEES.map(employee => `
      <button
        class="employee-menu-item ${employee.id === active.id ? 'active' : ''}"
        type="button"
        data-action="select-employee"
        data-id="${escapeHtml(employee.id)}"
        role="menuitem"
      >
        <span class="employee-menu-avatar">${escapeHtml(employee.avatar)}</span>
        <span>
          <strong>${escapeHtml(employee.name)}</strong>
          <em>${escapeHtml(employee.role)}</em>
        </span>
      </button>
    `).join('');
  }
  const avatar = $('[data-employee-avatar]');
  const name = $('[data-employee-name]');
  const role = $('[data-employee-role]');
  if (avatar) avatar.textContent = active.avatar;
  if (name) name.textContent = active.name;
  if (role) role.textContent = active.role;
}

function setEmployeeMenuOpen(open) {
  state.employeeMenuOpen = Boolean(open);
  renderEmployeeSelector();
}

function selectEmployee(id) {
  const next = EMPLOYEES.find(employee => employee.id === id);
  if (!next) return;
  state.activeEmployeeId = next.id;
  setStoredEmployeeId(next.id);
  setEmployeeMenuOpen(false);
  toast(`已切换为 ${next.name}`);
}

function applySidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  const button = $('[data-action="toggle-sidebar"]');
  if (!button) return;
  button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  button.setAttribute('aria-label', collapsed ? '展开工作台' : '折叠工作台');
  button.setAttribute('title', collapsed ? '展开工作台' : '折叠工作台');
}

applySidebarCollapsed(getStoredSidebarCollapsed());
renderEmployeeSelector();

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
    const aRank = aPriority >= 0 ? aPriority : FORUM_PLATFORM_IDS.has(a.id) ? 1000 : 500;
    const bRank = bPriority >= 0 ? bPriority : FORUM_PLATFORM_IDS.has(b.id) ? 1000 : 500;
    if (aRank !== bRank) return aRank - bRank;
    return String(a.name || a.id).localeCompare(String(b.name || b.id), 'zh-CN');
  });
}

function platformName(id) {
  const platform = state.data?.platforms?.find(item => item.id === id);
  return platform?.name || PLATFORM_NAMES[id] || id;
}

function planStatusOptions(status) {
  const current = status || '待选题';
  const options = PLAN_STATUSES.includes(current) ? PLAN_STATUSES : [current, ...PLAN_STATUSES];
  return options.map(option => `<option value="${escapeHtml(option)}" ${option === current ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('');
}

function statusClass(status) {
  if (status === '已发布' || status === 'published' || status === 'success') return 'done';
  if (status === '草稿已保存' || status === 'local_draft') return 'draft';
  if (status === '正文已生成' || status === '选题已确认') return 'generated';
  if (status === '已排版') return 'layout';
  if (status === '部分失败' || status === 'partial_failed') return 'partial';
  if (status === '发布失败' || status === 'failed' || status === 'partial_failed') return 'failed';
  if (status === '待选题' || status === '待处理' || status === '待检查') return 'pending';
  return '';
}

function statusLabel(status) {
  const labels = {
    published: '发布成功',
    success: '发布成功',
    partial_failed: '部分失败',
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
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function loadData() {
  const res = await request('/api/bootstrap');
  state.data = res.data;
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
  if (!state.authAutoChecked && res.data.platforms?.length) {
    state.authAutoChecked = true;
    setTimeout(() => checkAllAuth({ silent: true }), 250);
  }
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
  state.selectedPlatforms = new Set(Array.isArray(content?.selected_platforms) ? content.selected_platforms : []);
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

function isHtmlString(value) {
  return /<(article|section|p|div|h[1-6]|img|figure|br|ul|ol|li|blockquote|strong|em)\b/i.test(String(value || ''));
}

function markdownToEditableHtml(markdown) {
  const lines = String(markdown || '').replace(/^\s*---[\s\S]*?---\s*/, '').split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${escapeHtml(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`);
    paragraph = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    const image = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      flush();
      blocks.push(`<figure><img src="${escapeHtml(normalizeImageSrc(image[2]))}" alt="${escapeHtml(image[1])}"></figure>`);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      flush();
      blocks.push(`<h3>${escapeHtml(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flush();
      blocks.push(`<h2>${escapeHtml(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith('# ')) {
      flush();
      blocks.push(`<h1>${escapeHtml(trimmed.slice(2))}</h1>`);
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks.join('\n') || '<p><br></p>';
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

function editableArticleHtml(content) {
  const body = String(content.body || '');
  const html = isHtmlString(body) ? body : markdownToEditableHtml(body);
  return `${html}${contentImagesHtml(content, html)}`;
}

function render() {
  if (!state.data) return;
  renderDashboard();
  renderPlans();
  renderContent();
  renderPublish();
  renderPlatformLogin();
  renderHistory();
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
        ${statePill(job.status === 'published' ? '已发布' : job.status === 'failed' ? '发布失败' : '发布中')}
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
  const checking = state.authChecking.has(platform.id);
  const loggedIn = platform.auth_status === 'logged_in';
  const loggedOut = platform.auth_status === 'logged_out';
  const pendingSession = Boolean(state.loginSessions[platform.id]);
  const starting = state.loginStarting.has(platform.id);
  const finishing = state.loginFinishing.has(platform.id);
  const loginLabel = pendingSession
    ? (finishing ? '导出中' : '完成登录')
    : (starting ? '打开中' : (loggedIn ? '重新登录' : '去登录'));
  const accountLabel = platformAccountLabel(platform);
  const statusClass = loggedIn ? 'logged-in' : loggedOut ? 'logged-out' : 'unknown';
  const cardClass = [
    checking ? 'checking' : '',
    statusClass,
  ].filter(Boolean).join(' ');
  const metaText = checking
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
      ? ''
      : `<button class="mini-btn login-mini needs-login" data-action="start-login" data-platform="${platform.id}" ${starting || checking ? 'disabled' : ''} title="${escapeHtml(loginLabel)}">${escapeHtml(loginLabel)}</button>`;
  return `
    <div class="platform-card ${cardClass}" data-platform-card="${platform.id}">
      <div class="platform-info">
        ${platformAvatar(platform)}
        <div class="platform-copy">
          <strong>${escapeHtml(platform.name)}</strong>
          <span class="platform-meta">${escapeHtml(metaText)}</span>
        </div>
      </div>
      <div class="platform-actions">
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
        <p>按日期范围编辑选题方向，支持批量新增多天计划，并直接从表格生成内容。</p>
      </div>
      <div class="toolbar">
        <button class="secondary" data-action="open-plan-range">新增计划</button>
        <button class="primary" data-action="go-history">发布历史</button>
      </div>
    </div>

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
    : `<button class="row-primary-action" data-action="generate-content-from-date" data-date="${plan.date}">生成内容</button>`;
  const menuActions = [
    `<button data-action="save-plan" data-date="${plan.date}">保存修改</button>`,
    `<button data-action="generate-topics" data-date="${plan.date}">启动选题</button>`,
  ];
  if (plan.content_id) {
    menuActions.push(`<button data-action="generate-content-from-date" data-date="${plan.date}">重新生成</button>`);
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

function renderContent() {
  const allContents = state.data.contents;
  const totalPages = Math.max(1, Math.ceil(allContents.length / state.contentPageSize));
  state.contentPage = Math.min(Math.max(1, state.contentPage), totalPages);
  const start = (state.contentPage - 1) * state.contentPageSize;
  const contents = allContents.slice(start, start + state.contentPageSize);
  const selected = allContents.find(content => content.id === state.selectedContentId) || null;
  $('#view-content').innerHTML = `
    <div class="section-head">
      <div>
        <h1>内容中心</h1>
        <p>先横向浏览文章，点击一篇后进入正文草稿编辑和排版预览。</p>
      </div>
    </div>

    <div class="content-layout content-layout-stacked">
      <div class="panel content-list-panel content-list-wide">
        <div class="panel-head compact-head">
          <div>
            <h2>文章列表</h2>
            <span>${allContents.length} 篇内容 · 横向滑动浏览</span>
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
          `).join('') : '<div class="empty">暂无内容，先从选题计划生成正文</div>'}
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
}

function contentDetail(content) {
  const isDirty = state.dirtyContentIds.has(String(content.id));
  return `
    <div class="content-detail-head">
      <div class="content-title-block">
        <h2>${escapeHtml(content.title)}</h2>
        <p>${escapeHtml(content.summary || '')}</p>
        <div class="content-status-row">
          ${statePill(content.status)}
          <span>${escapeHtml(content.type || '内容稿')}</span>
        </div>
      </div>
    </div>
    <div class="editor-workspace">
      <section class="preview-pane article-pane">
        <div class="preview-pane-head">
          <div>
            <h2>正文编辑</h2>
            <span>用户看到的是可编辑正文草稿，配图会直接显示</span>
          </div>
          <div class="editor-actions">
            <button class="secondary compact-action editor-save-action ${isDirty ? '' : 'is-hidden'}" data-action="save-content" data-id="${content.id}" data-save-content-button="${content.id}">保存正文</button>
            <button class="secondary compact-action" data-action="layout-content" data-id="${content.id}">排版预览</button>
            ${content.layout_html ? `<a class="secondary compact-action link-action" href="/content/${encodeURIComponent(content.id)}/preview.html" target="_blank" rel="noopener">打开HTML</a>` : ''}
            <button class="secondary compact-action" data-action="save-draft" data-id="${content.id}">保存到内容中心草稿</button>
          </div>
        </div>
        <div class="content-editor rich-content-editor" data-content-body="${content.id}" contenteditable="true" spellcheck="false">${editableArticleHtml(content)}</div>
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

function markdownPreview(markdown) {
  return escapeHtml(markdown)
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>')
    .replace(/<p><h/g, '<h')
    .replace(/<\/h1><\/p>/g, '</h1>')
    .replace(/<\/h2><\/p>/g, '</h2>');
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
          <iframe class="layout-preview-iframe" src="${previewUrl}" title="${escapeHtml(content?.title || '排版预览')}" loading="lazy"></iframe>
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
  const platforms = state.data.platforms;
  const jobs = state.data.jobs;
  $('#view-publish').innerHTML = `
    <div class="section-head">
      <div>
        <h1>发布中心</h1>
        <p>选择目标平台后，直接同步发布，并在下方查看各平台结果。</p>
      </div>
    </div>

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
            <span>即将发布正文预览</span>
            <div class="publish-rich-preview rich-content-editor" aria-label="即将发布正文预览">
              ${editableArticleHtml(content)}
            </div>
          </div>
        ` : '<div class="empty">暂无可发布内容</div>'}
      </div>
      <div class="panel">
        <h2>发布进度反馈</h2>
        <div id="publish-progress" class="publish-result">
          ${jobs.length ? jobResult(jobs[0]) : '<div class="empty">暂无发布记录</div>'}
        </div>
      </div>
    </div>

    <div class="panel publish-platform-panel">
      <h2>平台选择（当前 CLI 支持 ${platforms.length} 个）</h2>
      <div class="platform-picker">
        ${platforms.map(platform => `
          <label class="platform-check">
            <input type="checkbox" data-platform-choice="${platform.id}" ${state.selectedPlatforms.has(platform.id) ? 'checked' : ''}>
            ${platformAvatar(platform)}
            <span class="platform-check-name">${escapeHtml(platform.name)}</span>
          </label>
        `).join('')}
      </div>
      <div class="publish-bottom-actions">
        <span class="tag" data-selected-platform-count>已选择 ${state.selectedPlatforms.size} 个平台</span>
        <button class="primary publish-bottom-button" data-action="publish-selected" ${!content || state.selectedPlatforms.size === 0 ? 'disabled' : ''}>直接发布</button>
      </div>
    </div>
  `;
}

function sessionOpenButton(platform, url, label) {
  return `<button class="inline-link" data-action="open-platform-session" data-platform="${escapeHtml(platform)}" data-url="${escapeHtml(url)}">${escapeHtml(label)}</button>`;
}

function resultPlatformNode(result) {
  const name = platformName(result.platform);
  if (result.status === 'success' && result.url) {
    return `<button class="result-platform-link" data-action="open-platform-session" data-platform="${escapeHtml(result.platform)}" data-url="${escapeHtml(result.url)}" title="使用该平台登录会话打开">${escapeHtml(name)}</button>`;
  }
  return `<span class="result-platform-name">${escapeHtml(name)}</span>`;
}

function resultDetailNode(result) {
  const message = result.message || result.error || '未知原因';
  if (result.status === 'failed') {
    return `<span class="failure-help" data-tooltip="${escapeHtml(message)}" aria-label="${escapeHtml(message)}">!</span>`;
  }
  return '';
}

function jobResult(job) {
  if (!job?.results?.length) return '<span class="tag">无平台结果</span>';
  return job.results.map(result => `
    <div class="result-line compact-result ${result.status === 'failed' ? 'failed-result' : ''}">
      ${resultPlatformNode(result)}
      ${resultDetailNode(result)}
    </div>
  `).join('');
}

function historyResultChip(result) {
  const failed = result.status === 'failed';
  const message = result.message || result.error || '';
  const label = `${platformName(result.platform)} · ${statusLabel(result.status)}`;
  return `
    <span class="history-result-chip ${failed ? 'failed' : 'success'}" title="${escapeHtml(message || label)}">
      ${resultPlatformNode(result)}
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
  const platforms = state.data.platforms;
  const sortedPlatforms = sortLoginPlatforms(platforms);
  const loggedIn = platforms.filter(platform => platform.auth_status === 'logged_in').length;
  $('#view-platforms').innerHTML = `
    <div class="section-head">
      <div>
        <h1>平台登录</h1>
        <p>首次进入会自动做一次无弹窗检查，也可以在这里手动检查、登录或导出 Cookie。</p>
      </div>
      <div class="toolbar">
        <button class="secondary" data-action="refresh-platforms">刷新平台</button>
        <button class="primary" data-action="check-all-auth" ${state.authCheckingAll ? 'disabled' : ''}>
          ${state.authCheckingAll ? '检查中' : '全部检查'}
        </button>
      </div>
    </div>

    <div class="metrics compact-metrics">
      <div class="metric split-metric"><span>支持平台</span><strong>${platforms.length}</strong></div>
      <div class="metric split-metric"><span>已登录</span><strong data-auth-logged>${loggedIn}</strong></div>
      <div class="metric split-metric"><span>待检查</span><strong data-auth-unknown>${platforms.filter(platform => !platform.auth_status || platform.auth_status === 'unknown').length}</strong></div>
      <div class="metric split-metric"><span>检查中</span><strong data-auth-checking>${state.authChecking.size}</strong></div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2>登录状态</h2>
        <span class="tag">常用内容平台优先，论坛类靠后</span>
      </div>
      <div class="platform-grid" data-auth-grid>
        ${sortedPlatforms.map(platform => platformCard(platform)).join('')}
      </div>
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
    ...state.data.platforms.map(item => [item.id, item.name]),
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
  const loggedIn = platforms.filter(platform => platform.auth_status === 'logged_in').length;
  const unknown = platforms.filter(platform => !platform.auth_status || platform.auth_status === 'unknown').length;
  $$('[data-auth-grid]').forEach(grid => {
    grid.innerHTML = sortLoginPlatforms(platforms).map(platform => platformCard(platform)).join('');
  });
  $$('[data-auth-logged]').forEach(node => { node.textContent = loggedIn; });
  $$('[data-auth-unknown]').forEach(node => { node.textContent = unknown; });
  $$('[data-auth-checking]').forEach(node => { node.textContent = state.authChecking.size; });
  $$('[data-action="check-all-auth"]').forEach(button => {
    button.disabled = state.authCheckingAll;
    button.textContent = state.authCheckingAll ? '检查中' : '全部检查';
  });
}

function syncPublishSelectionUi() {
  const count = state.selectedPlatforms.size;
  $$('[data-selected-platform-count]').forEach(node => {
    node.textContent = `已选择 ${count} 个平台`;
  });
  $$('[data-action="publish-selected"]').forEach(button => {
    button.disabled = count === 0 || !getSelectedContent();
  });
}

function readSelectedPlatforms() {
  const choices = $$('[data-platform-choice]');
  if (choices.length) {
    state.selectedPlatforms = new Set(
      choices
        .filter(checkbox => checkbox.checked)
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
  const res = await request('/api/topics/generate', {
    method: 'POST',
    body: JSON.stringify({ date }),
  });
  openCandidates(date, res.candidates);
  await loadData();
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

async function saveContent(id, options = {}) {
  const target = id || state.selectedContentId;
  if (!target) return null;
  const editor = $(`[data-content-body="${target}"]`);
  const body = editor?.isContentEditable ? editor.innerHTML : editor?.value;
  const current = state.data.contents.find(content => content.id === target);
  const res = await request(`/api/content/${target}`, {
    method: 'POST',
    body: JSON.stringify({
      title: current?.title,
      summary: current?.summary,
      type: current?.type,
      body: body ?? current?.body ?? '',
    }),
  });
  state.selectedContentId = res.content.id;
  state.dirtyContentIds.delete(String(target));
  if (!options.silent) toast('正文已保存');
  await loadData();
  return res.content;
}

function markContentDirty(id) {
  if (!id) return;
  state.dirtyContentIds.add(String(id));
  $(`[data-save-content-button="${id}"]`)?.classList.remove('is-hidden');
}

async function layoutContent(id) {
  const target = id || state.selectedContentId;
  if (!target) return toast('请选择内容', 'error');
  if ($(`[data-content-body="${target}"]`)) await saveContent(target, { silent: true });
  const res = await request(`/api/content/${target}/layout`, { method: 'POST' });
  state.selectedContentId = res.content.id;
  await loadData();
  openLayoutDialog(getSelectedContent());
  toast('排版预览已生成');
}

async function saveDraft(id) {
  const target = id || state.selectedContentId;
  const selectedPlatforms = readSelectedPlatforms();
  if (!target) return toast('请选择内容', 'error');
  if ($(`[data-content-body="${target}"]`)) await saveContent(target, { silent: true });
  await request(`/api/content/${target}/save-draft`, {
    method: 'POST',
    body: JSON.stringify({ platforms: selectedPlatforms }),
  });
  toast('已保存到内容中心草稿');
  await loadData();
}

async function publishContent(id) {
  const target = id || state.selectedContentId;
  const selectedPlatforms = readSelectedPlatforms();
  if (!target) return toast('请选择内容', 'error');
  if (!state.selectedPlatforms.size) return toast('请选择至少一个发布平台', 'error');
  if ($(`[data-content-body="${target}"]`)) await saveContent(target, { silent: true });
  state.selectedPlatforms = new Set(selectedPlatforms);
  state.lastProgress = [`正在直接发布到 ${state.selectedPlatforms.size} 个平台`, '进入多平台直发流程'];
  renderProgress(state.lastProgress);
  try {
    await request('/api/publish', {
      method: 'POST',
      body: JSON.stringify({ contentId: target, platforms: [...state.selectedPlatforms], publishMode: 'direct' }),
    });
    toast('发布流程完成，请查看平台结果');
    await loadData();
    switchView('publish');
  } catch (error) {
    toast(error.message, 'error');
    await loadData();
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
    if (error.message.includes('重新点击登录') || error.message.includes('会话不存在') || error.message.includes('已过期')) {
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
  const platformIds = state.data.platforms.map(platform => platform.id);
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
  const loggedIn = state.data.platforms.filter(platform => platform.auth_status === 'logged_in').length;
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
    if (error.message.includes('重新点击登录') || error.message.includes('会话不存在') || error.message.includes('已过期')) {
      delete state.loginSessions[platform];
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

document.addEventListener('click', event => {
  const nav = event.target.closest('[data-view]');
  if (nav) {
    switchView(nav.dataset.view);
    return;
  }

  const action = event.target.closest('[data-action]');
  if (!action) {
    if (!event.target.closest('[data-employee-picker]') && state.employeeMenuOpen) {
      setEmployeeMenuOpen(false);
    }
    return;
  }

  const { action: name, date, id, platform, url } = action.dataset;
  if (!action.closest('[data-employee-picker]') && state.employeeMenuOpen) {
    setEmployeeMenuOpen(false);
  }
  if (name === 'toggle-sidebar') {
    const collapsed = !document.body.classList.contains('sidebar-collapsed');
    applySidebarCollapsed(collapsed);
    setStoredSidebarCollapsed(collapsed);
    return;
  }
  if (name === 'toggle-employee-menu') {
    setEmployeeMenuOpen(!state.employeeMenuOpen);
    return;
  }
  if (name === 'select-employee') {
    selectEmployee(id);
    return;
  }
  if (name === 'reload') loadData();
  if (name === 'refresh-platforms') refreshPlatforms();
  if (name === 'go-publish') switchView('publish');
  if (name === 'go-history') switchView('history');
  if (name === 'open-plan-range') openPlanDialog();
  if (name === 'close-plan-dialog') $('#plan-dialog').close();
  if (name === 'create-plan-range') createPlanRange();
  if (name === 'shift-plan-range') shiftPlanRange(Number(action.dataset.days || 0));
  if (name === 'save-plan') savePlan(date);
  if (name === 'generate-topics') generateTopics(date || state.selectedDate);
  if (name === 'select-plan-date') {
    state.selectedDate = date;
    switchView('plans');
  }
  if (name === 'confirm-candidate') confirmCandidate(id);
  if (name === 'close-dialog') $('#candidate-dialog').close();
  if (name === 'close-layout-dialog') $('#layout-dialog').close();
  if (name === 'generate-content-from-date') generateContent(date);
  if (name === 'open-content' || name === 'select-content') {
    state.selectedContentId = id;
    syncContentPageToSelected();
    applyContentPlatforms(getSelectedContent());
    switchView('content');
  }
  if (name === 'layout-selected') layoutContent();
  if (name === 'layout-content') layoutContent(id);
  if (name === 'save-content') saveContent(id);
  if (name === 'save-draft') saveDraft(id);
  if (name === 'publish-content' || name === 'publish-selected') publishContent(id);
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
    state.contentPage = Number(action.dataset.page || 1);
    renderContent();
  }
});

document.addEventListener('change', event => {
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

document.addEventListener('focusin', event => {
  const contentBody = event.target.closest('[data-content-body]');
  if (contentBody) markContentDirty(contentBody.dataset.contentBody);
});

document.addEventListener('input', event => {
  const contentBody = event.target.closest('[data-content-body]');
  if (contentBody) {
    markContentDirty(contentBody.dataset.contentBody);
    return;
  }

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

loadData().catch(error => {
  document.body.innerHTML = `<div class="empty" style="margin:40px;">启动失败：${escapeHtml(error.message)}</div>`;
});
