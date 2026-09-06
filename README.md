# 创作者工作台 · Multimedia Publisher

一个在本机运行的多平台内容工作台：导入一份文章，预览不同平台的格式，整理图片与表格，同步草稿，再由作者确认最终发表。

**工作台不自动公开文章，不自动群发通知。** 保存草稿、准备编辑器、提交审核和正式发表是不同状态；没有可靠回执时保留“待核对”，不会盲目重复提交。

项目基于原有 WEIBOT 代码持续改造，保留 [GPLv3 许可证](LICENSE)。公开版本和本机可选能力的区别见 [公开版本说明](docs/public-release.md)。

## 快速开始

建议使用 Node.js 24 LTS（最低22.5），以及本机 Google Chrome。

```bash
git clone https://github.com/huazihe/multimedia-publisher.git
cd multimedia-publisher
npx -y pnpm@9.15.9 install --frozen-lockfile
npm run dashboard
```

打开 <http://127.0.0.1:18810/>。首次运行需要为目标平台使用你自己的账号登录；仓库不附带 Cookie、账号、文章和数据库。

图片校验与表格转图使用 Playwright。本机已有 Google Chrome 时可直接使用；无 Chrome 的环境可安装 Playwright Chromium：

```bash
npx playwright install chromium
```

macOS 已作为本地实测环境；其他系统需要按实际路径配置浏览器及可选 CLI，不能将构建通过视为全部平台实号可用。

## 发布边界

| 工作台操作 | 实际含义 |
|---|---|
| 同步平台草稿 | 写入平台草稿箱，等待你核对并发表 |
| 准备平台编辑器 | 填入内容，不冒充云端草稿已经保存 |
| 检查草稿并发表 | 打开对应平台稿件，最终发表由你在平台确认 |
| 手工写作／投稿 | 只提供官方入口，不自动上传或提交 |
| 本地导出 | 生成文件，不发表到任何网站 |

公开版的小红书自动化实现未提供，安装时使用手工入口；不会覆盖已有本机可选实现。抖音和企鹅号目前仅支持纯文字草稿。其他平台是否可用还取决于登录、平台规则与接口变化，详见 [能力矩阵](docs/platform-capabilities.md)。

公众号“不群发通知”的发表仍会公开到账号主页；最终发表、通知开关、原创等设置需要在平台检查。

旧的 Chrome 插件兼容层、MCP bridge 和 extension 包已经移除。当前发布链路只走独立 Node/CDP runtime。

新开会话或接手开发前，请先阅读 [WEIBOT_项目同步文档.md](WEIBOT_项目同步文档.md)，里面记录当前平台状态、登录态机制、已知问题和验证命令。

## 项目结构

创作者工作台的目标、功能范围、验收与限制见 [需求与实现路径](docs/creator-workbench-requirements.md)。工作台默认从内容中心开始，支持飞书链接导出 Markdown 和原图后导入、本地 Markdown 配图导入、未保存内容的实时预览和平台派生表格图片。工作台采用中性界面，平台图标保留品牌原色。

选题计划内的“常用平台选题雷达”支持公众号、人人都是产品经理、少数派、小红书、优设、抖音、知乎、今日头条，用真实采集资料和项目内 [共用选题 Skill](skills/platform-topic-scout/SKILL.md) 分析，采用后才写入计划。公众号多源雷达、少数派首页信号都不冒充全站热榜；采集受限时明确展示，模型不可用时保留资料，不返回示例。

内容中心采用“编辑正文 / 平台预览”单画布Tab；导航和文章列表可收起。40个公众号模板文件按实际样式命名，下拉框合并为26种风格，保留原关联。真实投递能力及未验收项见[平台能力矩阵](docs/platform-capabilities.md)。

发布与连接列表采用通用文章目录：16个通用平台、4个可折叠的技术/知识平台、1个本地导出工具。新增简书和网易号手工入口；工业/B2B等垂直入口退出常用列表但保留历史兼容。目录配置位于`publisher-dashboard/platform-catalog.js`，不通过删除数据库或凭据实现筛选。

可选依赖：飞书导入使用本机 `lark-cli` 的个人 user 授权（可配置 `PUBLISHER_LARK_CLI` 和 `PUBLISHER_FEISHU_PROFILE`）；选题分析使用本机 `codex` 和账号额度。缺少这些工具不妨碍先使用本地文件导入和平台预览。不会自动安装全局依赖或修改登录权限。安全静态 CSS 会内联到公众号内容，外部样式、资源型 CSS 和动画不保留。

```text
WEIBOT/
  packages/
    core/          平台适配器、Node runtime、发布引擎
    cli/           weibot 命令行入口
  publisher-dashboard/  单机可视化面板
  skills/         独立平台发布与内容处理 skills 文档
    weixin-layout/         微信公众号文章排版 Skill
```

## 常用命令

```bash
npm run dashboard
npm run build
npx -y pnpm@9.15.9 --filter @weibot/cli build
node packages/cli/dist/index.js platforms
```

登录平台：

```bash
node packages/cli/dist/index.js login zhihu
node packages/cli/dist/index.js auth zhihu
```

发布到平台草稿：

```bash
node packages/cli/dist/index.js sync article.md -p zhihu,juejin
```

## 环境变量

```text
WEIBOT_COOKIE_FILE       Cookie JSON 文件路径
WEIBOT_STORAGE_DIR       Node runtime 持久化目录
WEIBOT_DOWNLOAD_DIR      本地导出目录
WEIBOT_DOUYIN_CDP_PORT   抖音登录浏览器 DevTools 端口
WEIBOT_TOUTIAO_CDP_PORT  头条登录浏览器 DevTools 端口
WEIBOT_XIAOHONGSHU_CDP_PORT  小红书登录浏览器 DevTools 端口
WEIBOT_QIEHAO_CDP_PORT   企鹅号登录浏览器 DevTools 端口
```

## 验证

```bash
npm --prefix publisher-dashboard test
npm run typecheck
npm test
```

公众号文章排版 Skill：

```bash
python3 skills/weixin-layout/scripts/pick_layout.py --json --seed 20260722
```
