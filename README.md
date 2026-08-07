# Cpydes 文案库

基于 PHP + 原生 JavaScript 的单页文案库应用，无构建系统、无包管理器，文件直发部署。支持文案分类管理、富文本编辑、图片墙、AI 对话/图片/视频生成、分享链接、网盘、公告、用户权限、实时同步等完整能力。

## 技术栈

- 后端：PHP 5.3+（推荐 7.x+），JSON 文件持久化，无数据库
- 前端：原生 JavaScript（ES5/ES6 混用，IIFE 模块），Feather 图标，Prism 语法高亮
- Web 服务器：Apache（推荐，依赖 .htaccess）/ Nginx + PHP-FPM
- AI：兼容 OpenAI 协议的模型服务（聊天 / 图片 / 视频）

## 目录结构

```
/
├── index.php              前端单页入口
├── ai.html                AI 聊天独立页
├── share.php              分享落地页
├── api.php                前端 API 入口（~45 个 action）
├── admin/
│   ├── index.php          后台管理单页入口
│   ├── api.php            后台 API 入口（100+ 个 action）
│   ├── css/admin.css      后台样式
│   └── js/                后台模块（admin-core/content/images/users/system/drive/ai/announcements）
├── lib/                   前后端共享 PHP 库
│   ├── json_store.php     JSON 原子读写 + 文件锁
│   ├── helpers.php        通用工具（mb_* polyfill、SVG 清洗、token 生成）
│   ├── auth.php           认证与权限（cpydes_user_has_permission）
│   ├── settings.php       文案库配置 + 访问密码限流 + 访客权限
│   ├── shares.php         分享与收藏数据
│   ├── announcements.php  弹窗公告存储
│   ├── ai.php             AI 任务管理（聊天/图片/视频）
│   └── sync.php           实时同步版本与配置
├── admin/lib/             后台专属 PHP 库
│   ├── data.php           后台数据读写 + 图片扫描
│   ├── drive.php          网盘数据
│   ├── users.php          用户/活动日志/审计
│   └── backup.php         备份/恢复
├── js/
│   ├── app.js             前端主入口
│   ├── shared-utils.js    前后台通用工具（escapeHtml/sanitizeColor 等）
│   ├── feather.min.js     图标库
│   ├── prism/             语法高亮
│   └── modules/           前端业务模块（详见下文）
├── css/                   前端样式（style / editor / ai-chat）
├── data/                  JSON 数据 + 锁文件（运行时生成）
├── img/                   用户上传图片（运行时生成）
├── ai-output/             AI 生成内容（公开访问）
├── backups/               备份文件（禁止访问）
└── .htaccess              安全规则 + 重写 + GZIP
```

## 前端模块（js/modules/）

**状态与数据层**
- [state.js](file:///c:/Users/xiao/Music/1111/123/js/modules/state.js) — 全局 appState 状态管理 + 权限检查 hasPermission + 收藏管理
- [dataService.js](file:///c:/Users/xiao/Music/1111/123/js/modules/dataService.js) — API 请求封装、loadData、增量刷新（refreshContent/refreshSettings/refreshAnnouncements）、索引构建
- [sync.js](file:///c:/Users/xiao/Music/1111/123/js/modules/sync.js) — 实时同步轮询（mtime 版本对比、编辑中暂停、关闭时 30s 心跳）
- [utils.js](file:///c:/Users/xiao/Music/1111/123/js/modules/utils.js) — 防抖、DOM 查询缓存等通用工具

**UI 交互层**
- [dialogs.js](file:///c:/Users/xiao/Music/1111/123/js/modules/dialogs.js) — Toast 通知、confirm、input、查重确认框
- [virtualList.js](file:///c:/Users/xiao/Music/1111/123/js/modules/virtualList.js) — 虚拟滚动（>200 条启用可见区 + 10 行缓冲）
- [renderer.js](file:///c:/Users/xiao/Music/1111/123/js/modules/renderer.js) — 渲染层（行渲染、搜索高亮、分类计数缓存）
- [layout.js](file:///c:/Users/xiao/Music/1111/123/js/modules/layout.js) — 布局切换（top-tabs 等，本地存储 + 后台版本号检测）
- [theme.js](file:///c:/Users/xiao/Music/1111/123/js/modules/theme.js) — 明暗主题切换
- [navigation.js](file:///c:/Users/xiao/Music/1111/123/js/modules/navigation.js) — 浏览器自动填充三重防护

**业务功能层**
- [editor.js](file:///c:/Users/xiao/Music/1111/123/js/modules/editor.js) — 前后台共用富文本编辑器
- [items.js](file:///c:/Users/xiao/Music/1111/123/js/modules/items.js) — 文案 CRUD
- [segment.js](file:///c:/Users/xiao/Music/1111/123/js/modules/segment.js) — 文案智能分段（手动标记 / Word 粘贴 / 块级元素 / 独立 img）
- [preview.js](file:///c:/Users/xiao/Music/1111/123/js/modules/preview.js) — 快速预览
- [clipboard.js](file:///c:/Users/xiao/Music/1111/123/js/modules/clipboard.js) — 富文本复制（text/html + text/plain + execCommand fallback）
- [categories.js](file:///c:/Users/xiao/Music/1111/123/js/modules/categories.js) — 分类管理
- [dragDrop.js](file:///c:/Users/xiao/Music/1111/123/js/modules/dragDrop.js) — 拖拽排序（L1/L2 分类 + 文案）
- [gallery.js](file:///c:/Users/xiao/Music/1111/123/js/modules/gallery.js) — 图片墙模式
- [dedup.js](file:///c:/Users/xiao/Music/1111/123/js/modules/dedup.js) — N-gram 文案查重
- [libraryAuth.js](file:///c:/Users/xiao/Music/1111/123/js/modules/libraryAuth.js) — 文案库访问密码保护
- [announcement.js](file:///c:/Users/xiao/Music/1111/123/js/modules/announcement.js) — 弹窗公告（未读过滤、已读 localStorage）
- [share.js](file:///c:/Users/xiao/Music/1111/123/js/modules/share.js) — 文案分享链接

**AI 模块**
- [aiShared.js](file:///c:/Users/xiao/Music/1111/123/js/modules/aiShared.js) — 共享状态容器
- [aiInit.js](file:///c:/Users/xiao/Music/1111/123/js/modules/aiInit.js) — 初始化与模型管理
- [aiChatCore.js](file:///c:/Users/xiao/Music/1111/123/js/modules/aiChatCore.js) — 聊天核心（SSE 流式）
- [aiMarkdown.js](file:///c:/Users/xiao/Music/1111/123/js/modules/aiMarkdown.js) — Markdown 渲染
- [aiMediaGen.js](file:///c:/Users/xiao/Music/1111/123/js/modules/aiMediaGen.js) — 图片/视频生成
- [aiUi.js](file:///c:/Users/xiao/Music/1111/123/js/modules/aiUi.js) — UI 工具（toast、轮询、欢迎页）

前端模块加载顺序见 [index.php](file:///c:/Users/xiao/Music/1111/123/index.php)：`feather → shared-utils → state → utils → dataService → dialogs → virtualList → renderer → layout → dedup → editor → items → segment → preview → clipboard → navigation → categories → dragDrop → gallery → libraryAuth → announcement → share → theme → sync → app.js`。

## 核心架构

### 数据流

1. 前端 `app.js` 启动 → `checkLibraryAccess()` 校验访问保护 → `loadData()` 调 `api.php?action=getAll` 拉取全量数据
2. 用户操作（增删改）→ `apiFetch` POST 到 `api.php` → 写入 `data/copywriting.json` → 重建索引并重新渲染
3. 后台改动 → 写入对应 JSON 文件 → 实时同步通过 mtime 版本号传播到所有客户端

### 实时同步（新增）

采用**轻量级版本轮询 + 增量拉取**方案，兼容 PHP-FPM 无常驻进程的限制：

- 服务端以各数据文件的 `filemtime` 作为版本号（写盘即变更，零埋点）
- [lib/sync.php](file:///c:/Users/xiao/Music/1111/123/lib/sync.php) 提供 `cpydes_get_sync_version()`（stat 5 个文件）和 `cpydes_get_sync_config()`（读 `library_settings.sync`）
- 前端 [js/modules/sync.js](file:///c:/Users/xiao/Music/1111/123/js/modules/sync.js) 按配置间隔轮询 `getSyncVersion`，对比 mtime 变化后调用 `getData?type=content|settings|announcements` 仅拉取变化的数据类型

**同步策略**：

| 场景 | 行为 |
|------|------|
| 后台开启 | 按配置间隔（默认 5s，范围 2~300s）轮询 |
| 编辑弹窗打开 / 拖拽中 | 暂停刷新，关闭后下个周期补刷，避免覆盖未保存内容 |
| 后台关闭 | 降频为 30s 心跳，仅检测是否被重新开启 |
| 修改间隔 / 开关 | 通过 `getSyncVersion` 响应动态生效，无需刷新页面 |

**同步范围**：content（分类+文案）、settings（系统设置）、announcements（公告）会触发增量刷新；shares 与 drive 版本号同样跟踪，前台无展示故不触发刷新。

后台开关位置：管理后台 → 基础设置 → 实时同步 Tab（`settings.manage` 权限）。

### 编辑器元数据布局

文本编辑器弹窗的元数据展示位置：
- 标题栏右侧：`共 XX 字` + `最后更新：YYYY-MM-DD HH:MM`
- 底部按钮栏左侧：时效到期警告（如有配置 copyReminder）

## API 入口

### api.php（前端）

主要 action 分组：
- 认证：`verifySettingsPassword` / `libraryLogout` / `verifyUserLogin` / `registerUser`
- 文案 CRUD：`getAll` / `saveItem` / `deleteItem` / `saveCategories` / `saveItemsOrder` / `clearAll`
- 图片：`uploadImage` / `deleteImages`
- 导入导出：`export` / `import` / `fullExport` / `fullImport`
- 分享与收藏：`createShare` / `deleteShare` / `listShares` / `saveFavorites`
- 公告：`getActiveAnnouncements`
- 实时同步（新增）：`getSyncVersion` / `getData`
- AI：`aiChat`（SSE）/ `aiGenerateImage` / `aiVideoCreate` / `aiImageStatus` / `aiVideoStatus` / `aiTaskList` / `aiCancelTask` / `testAiModel` / `saveAiSettings` / `getAiSettings`

所有写操作走 POST + CSRF 校验；`getSyncVersion` / `getData` / `getActiveAnnouncements` 等读操作走 GET（CSRF 豁免）。所有响应分支以 `exit` 结束防止输出混合。

### admin/api.php（后台）

100+ 个 action，覆盖：用户/角色 CRUD、网盘文件操作、备份管理、公告 CRUD、统计、审计日志、系统配置（含 `updateSyncSettings`）、批量操作等。

## 数据文件（data/）

| 文件 | 内容 |
|------|------|
| `copywriting.json` | 主业务数据（categories + items） |
| `library_settings.json` | 系统配置（layout / libraryPasswordEnabled / libraryAuthTimeout / dedup / sync / allowGuestAccess / registrationEnabled / defaultRegisterRole / guestPermissions / copyReminder） |
| `ai-config.json` | AI 模型配置（models / systemPrompt / defaultModel / defaultImageModel / defaultVideoModel / modelDetections） |
| `users.json` | 用户账号 |
| `roles.json` | 角色定义（role_admin=*, role_editor, role_viewer） |
| `shares.json` | 分享链接元数据 |
| `favorites.json` | 用户收藏（按 userId 隔离） |
| `drive.json` | 网盘数据（files 树 + shares + settings） |
| `announcements.json` | 弹窗公告 |
| `audit_log.json` | 审计日志 |
| `user_activity.json` | 用户活动日志 |
| `user_online.json` | 在线会话跟踪 |
| `page_views.json` | 页面访问统计 |
| `tasks/` | AI 任务状态目录（每个任务一个 .json + .lock） |
| `.pwd_hash` / `.lib_pwd_hash` | 后台密码 / 文案库访问密码哈希 |
| `*.lock` | 排他锁文件 |

## 权限体系

权限键命名约定：`模块.动作`（如 `content.create`、`drive.upload`、`ai.use`）。

**角色**（[data/roles.json](file:///c:/Users/xiao/Music/1111/123/data/roles.json)）：
- `role_admin` — 直通 `*`，所有权限
- `role_editor` — 内容编辑类权限
- `role_viewer` — 只读

**访客权限**（保护关闭时生效）：`library_settings.guestPermissions` 数组控制未登录用户可执行的操作，分组包括：
- content：create / edit / delete / sort / share
- categories：manage
- images：upload / delete
- ai：use
- drive：view / upload / delete / rename / move / folder / share

**危险操作**要求更严格权限：
- `clearAllShares` → `shares.manage`
- `clearAllDriveShares` → `drive.manage`
- `clearAll` → `content.delete`

前端 [state.js](file:///c:/Users/xiao/Music/1111/123/js/modules/state.js) 的 `hasPermission()` 与后端 [lib/auth.php](file:///c:/Users/xiao/Music/1111/123/lib/auth.php) 的 `cpydes_user_has_permission()` / [lib/settings.php](file:///c:/Users/xiao/Music/1111/123/lib/settings.php) 的 `guestHasPermission()` 保持一致逻辑。

## AI 功能

- 聊天：SSE 流式响应，兼容 OpenAI 协议
- 图片生成：异步任务 + 状态轮询
- 视频生成：异步任务 + 状态轮询（优先本地任务文件状态，避免直查 AI 服务）

**安全约束**：
- `max_tokens` ≤ 65536
- 任务状态更新合并非空字段防丢失（`saveTaskStatus` 保留 prompt/modelId/imageUrl/size/n/modelName 等关键字段）
- 过期任务 7200s 自动清理
- AI 入口需 `ai.use` 权限 + 登录（文案库保护开启时）

模型配置见 [data/ai-config.json](file:///c:/Users/xiao/Music/1111/123/data/ai-config.json)，AI 输出存于 [ai-output/](file:///c:/Users/xiao/Music/1111/123/ai-output)（公开访问）。

## 备份机制

- [admin/lib/backup.php](file:///c:/Users/xiao/Music/1111/123/admin/lib/backup.php) 管理备份/恢复
- 备份文件命名：`backup_YYYYMMDD_HHMMSS_xxxx.json`
- 备份内容：categories + items + settings + 可选 images（base64）
- 元数据：itemCount / categoryCount / imageCount / hasImages / createdBy / note
- `listServerBackups` 仅读头部 4096 字节提取元数据，避免大文件占内存
- 备份目录 [backups/](file:///c:/Users/xiao/Music/1111/123/backups) 通过 .htaccess 禁止 HTTP 访问

## 部署

### 环境要求

- PHP 5.3+（推荐 7.x+）
- Apache（推荐，依赖 .htaccess）或 Nginx + PHP-FPM
- `data/` / `img/` / `backups/` / `ai-output/` 目录需可写权限

### 部署步骤

1. 上传全部文件至 Web 服务器根目录或子目录
2. 确保 `data/` / `img/` / `backups/` / `ai-output/` 可写
3. 首次访问触发后台密码设置流程（或通过环境变量 `SETTINGS_PASSWORD` 预置）
4. 可选：通过环境变量 `APP_TIMEZONE` 配置时区（默认 `Asia/Shanghai`）

### 安全规则（.htaccess）

- 保护 `.json` / `.lock` / `.tmp` / `.pwd_hash` 等敏感文件
- 安全头：`X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy` / HSTS
- HTTPS 强制跳转（localhost 除外）
- GZIP 压缩，`aiVideoCreate` / `aiGenerateImage` 接口 no-gzip 例外（防 `ERR_CONTENT_LENGTH_MISMATCH`）
- `Options -Indexes` 禁止目录列表

## 开发约定

- API action 命名：camelCase（如 `saveItemsOrder` / `clearAllShares` / `updateSyncSettings`）
- 危险操作（清空分享、清空数据等）使用双重确认对话框
- Toast 通知：右上角堆叠、淡入/上滑动画、3 秒自动消失、按类型着色
- 复制操作：成功统一提示 `已复制`，失败提示 `复制失败，请手动复制`
- 标题截断：列表与图片卡片视图统一 `substring(0, 26)`
- 列表渲染双策略：≤200 条用 CSS `content-visibility: auto`；>200 条用 JS 虚拟滚动
- 共享 JS 工具（escapeHtml / escapeAttr / sanitizeColor / refreshFeatherIcons）集中于 [js/shared-utils.js](file:///c:/Users/xiao/Music/1111/123/js/shared-utils.js)，head 中 defer 加载，业务模块不得重复定义
- 主题 FOUC 防护 IIFE 必须内联在 `<head>`（同步执行），不可移至 defer 外部脚本
- AI 静态入口按钮用 `<i data-feather="sparkles">`；动态创建的 bot 头像用内联 SVG 避免 refreshFeatherIcons 调用
- CSS transition 避免使用 `all`，改用具体属性（transform / background-color / border-color / color / box-shadow）减少布局/绘制抖动
- 所有 API 响应分支必须以 `exit` 结束
- 登出接口需 CSRF 校验；心跳接口豁免 CSRF
- 文件下载的 `Content-Disposition` 同时包含 `filename=` 和 `filename*=UTF-8''` 以兼容非 ASCII 文件名
