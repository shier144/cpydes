<?php
// 静态资源版本号：基于 filemtime 实现浏览器缓存破坏
function asset_v($path) {
    $f = __DIR__ . '/' . $path;
    return $path . '?v=' . (is_file($f) ? filemtime($f) : '1');
}
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cpydes - 文案库</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%236366f1' width='100' height='100' rx='20'/%3E%3Ctext x='50' y='65' font-size='50' text-anchor='middle' fill='white'%3E文%3C/text%3E%3C/svg%3E">
    <link rel="stylesheet" href="<?php echo asset_v('css/style.css'); ?>">
    <link rel="stylesheet" href="<?php echo asset_v('css/editor.css'); ?>">
    <script src="<?php echo asset_v('js/feather.min.js'); ?>" defer></script>
    <script src="<?php echo asset_v('js/shared-utils.js'); ?>" defer></script>
    <script>
        // 主题早期初始化（FOUC 防闪烁，必须在首次绘制前同步执行）
        // refreshFeatherIcons / escapeHtml / sanitizeColor 等工具由 shared-utils.js 提供
        (function() {
            try {
                var t = localStorage.getItem('cpydes_theme');
                if (t === 'dark') {
                    document.documentElement.classList.add('dark-mode');
                } else if (t !== 'light') {
                    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                        document.documentElement.classList.add('dark-mode');
                    }
                }
            } catch(e) {}
        })();
    </script>
</head>
<body class="app-loading">

<div class="app-container" id="appContainer">

<!-- Left Sidebar (分类导航) -->
<aside class="sidebar" id="sidebar">
    <div class="sidebar-header">
        <div class="sidebar-brand">
            <div class="sidebar-logo">
                <span class="logo-letter">C</span>
                <span class="logo-glow"></span>
            </div>
            <div>
                <div class="sidebar-title">Cpydes 文案库</div>
            </div>
        </div>
        <div class="sidebar-subtitle">云端存储 ·安全高效</div>
    </div>
    <div class="sidebar-search">
        <div class="sidebar-search-box">
            <span class="search-icon-xs"><i data-feather="search" style="width:12px;height:12px;"></i></span>
            <input type="text" id="catSearchInput" placeholder="搜索分类..." oninput="searchCategories(this.value)" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')">
        </div>
    </div>
    <nav class="cat-nav" id="catNav">
        <div class="cat-nav-all active" id="navAll" onclick="selectCatFromSidebar(null)" ondblclick="showAllItems()">
            <span class="nav-icon"><i data-feather="file-text" style="width:16px;height:16px;"></i></span>
            <span class="nav-label">全部文案</span>
            <span class="nav-badge" id="navAllCount">0</span>
        </div>
        <div class="cat-nav-favorites" id="navFavorites" onclick="selectCatFromSidebar('__favorites__')" ondblclick="showAllFavorites()">
            <span class="nav-icon"><i data-feather="star" style="width:16px;height:16px;"></i></span>
            <span class="nav-label">收藏夹</span>
            <span class="nav-badge" id="navFavCount">0</span>
        </div>
        <div id="catTreeContainer"></div>

        <div class="sub-cat-only-section" id="subCatOnlySection" style="display:none;">
            <div class="cat-nav-all" id="subCatNavAll" onclick="selectSubCatFromTopView(null)" ondblclick="showAllItems()">
                <span class="nav-icon"><i data-feather="file-text" style="width:16px;height:16px;"></i></span>
                <span class="nav-label">全部文案</span>
                <span class="nav-badge" id="subCatAllCount">0</span>
            </div>
            <div class="cat-nav-favorites" id="subCatNavFavorites" onclick="selectSubCatFromTopView('__favorites__')" ondblclick="showAllFavorites()">
                <span class="nav-icon"><i data-feather="star" style="width:16px;height:16px;"></i></span>
                <span class="nav-label">收藏夹</span>
                <span class="nav-badge" id="subCatFavCount">0</span>
            </div>
            <div id="subCatListContainer"></div>
            <div class="sidebar-empty" id="subCatEmpty" style="display:none;">
                <p>暂无子分类</p>
            </div>
        </div>

        <div class="sidebar-empty" id="sidebarEmpty" style="display:none;">
            <p>暂无分类</p>
            <small>点击下方按钮创建</small>
        </div>
    </nav>
    <div class="sidebar-footer">
        <button class="add-cat-btn" onclick="addCategoryQuick()">
            + 新建分类
        </button>
        <button class="add-cat-btn add-sub-cat-btn" onclick="addSubCatFromTopView()">
            + 新建子分类
        </button>
    </div>
</aside>

<div class="sidebar-overlay" id="sidebarOverlay" onclick="closeSidebar()"></div>

<div class="main-area">

<header class="app-header">
    <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
        <button class="mobile-menu-btn" onclick="toggleSidebar()"><i data-feather="menu" style="width:20px;height:20px;"></i></button>
        <div class="header-greeting" id="headerGreeting">
            <div class="greeting-text" id="greetingText">你好 <i data-feather="smile" style="width:16px;height:16px;vertical-align:-2px;"></i></div>
            <div class="greeting-sub" id="greetingSub">
                <span class="greeting-stat greeting-stat-total"><i data-feather="file-text"></i><span>共 <strong id="greetingTotal">0</strong> 条文案</span></span>
                <span class="greeting-stat greeting-stat-fav"><i data-feather="heart"></i><span><strong id="greetingFav">0</strong> 条收藏</span></span>
                <span class="greeting-quote" id="greetingQuote"></span>
            </div>
        </div>
    </div>
    <div class="app-actions">
        <button class="btn btn-primary" onclick="openModal()"><i data-feather="plus" style="width:14px;height:14px;"></i> 新增</button>
        <button class="btn btn-default" onclick="openGallery()"><i data-feather="image" style="width:14px;height:14px;"></i> 图片墙</button>
        <a class="btn btn-default ai-entry-btn" href="ai.html"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg> AI 助手</a>
        <button class="btn btn-default" id="libraryLockBtn" onclick="libraryLogout()" style="display:none;" title="注销登录"><i data-feather="log-out" style="width:14px;height:14px;"></i> 注销登录</button>
        <div class="theme-menu-wrap">
            <button class="theme-toggle" onclick="toggleThemeMenu()" title="外观设置" id="themeMenuBtn"><i data-feather="moon" style="width:18px;height:18px;"></i></button>
            <div class="theme-dropdown" id="themeDropdown" style="display:none;">
                <div class="theme-dropdown-section">
                    <div class="theme-dropdown-title">主题模式</div>
                    <div class="theme-option-row">
                        <div class="theme-option-item" data-theme="light" onclick="quickToggleTheme('light')">
                            <span class="theme-option-icon"><i data-feather="sun" style="width:16px;height:16px;"></i></span>
                            <span class="theme-option-label">亮色模式</span>
                        </div>
                        <div class="theme-option-item" data-theme="dark" onclick="quickToggleTheme('dark')">
                            <span class="theme-option-icon"><i data-feather="moon" style="width:16px;height:16px;"></i></span>
                            <span class="theme-option-label">暗色模式</span>
                        </div>
                    </div>
                </div>
                <div class="theme-dropdown-divider"></div>
                <div class="theme-dropdown-section">
                    <div class="theme-dropdown-title">菜单布局</div>
                    <div class="theme-option-row">
                        <div class="theme-option-item" data-layout="sidebar" onclick="quickToggleLayout('sidebar')">
                            <div class="theme-option-preview layout-preview-sidebar-sm">
                                <div class="lp-sidebar-sm"></div>
                                <div class="lp-main-sm"></div>
                            </div>
                            <span class="theme-option-label">侧边栏</span>
                        </div>
                        <div class="theme-option-item" data-layout="top-tabs" onclick="quickToggleLayout('top-tabs')">
                            <div class="theme-option-preview layout-preview-top-sm">
                                <div class="lp-top-sm"></div>
                                <div class="lp-bottom-sm"></div>
                            </div>
                            <span class="theme-option-label">顶部标签</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</header>

<main class="main-card">

    <div class="top-cat-bar" id="topCatBar" style="display:none;">
        <div class="top-cat-scroll" id="topCatScroll"></div>
        <button class="top-add-cat-btn" onclick="addCategoryQuick()" title="新增分类">+ 新增分类</button>
    </div>

    <div class="top-sub-cat-bar" id="topSubCatBar" style="display:none;">
        <div class="top-sub-cat-scroll" id="topSubCatScroll"></div>
    </div>

    <div class="toolbar-area">
        <div class="search-box">
            <span class="search-icon"><i data-feather="search" style="width:16px;height:16px;"></i></span>
            <input type="text" id="qInput" placeholder="搜索标题或内容..." oninput="doSearch()" autocomplete="one-time-code">
        </div>
        <span class="stat-text">共 <strong id="cntAll">0</strong> 条 · 显示 <strong id="cntShow">0</strong></span>
    </div>

    <div class="filter-bar">
        <div class="filter-row">
            <span class="filter-label">筛选</span>
            <div class="filter-tags" id="quickFilterTags">
                <button class="filter-tag active" data-filter="all" onclick="applyFilter(this,'all')">全部</button>
                <button class="filter-tag" data-filter="img" onclick="applyFilter(this,'img')"><i data-feather="image" style="width:12px;height:12px;"></i> 含图片</button>
                <button class="filter-tag" data-filter="favorites" onclick="applyFilter(this,'favorites')"><i data-feather="star" style="width:12px;height:12px;"></i> 已收藏</button>
                <button class="filter-tag" data-filter="recent" onclick="applyFilter(this,'recent')"><i data-feather="clock" style="width:12px;height:12px;"></i> 最近7天</button>
            </div>
        </div>
    </div>

    <div id="listArea">
        <table class="list-table" id="dataTable">
            <thead>
                <tr>
                    <th style="width:60px;min-width:60px">#</th>
                    <th style="width:50px;min-width:50px">收藏</th>
                    <th style="width:28%;min-width:180px">标题</th>
                    <th style="width:24%;min-width:160px">内容预览</th>
                    <th style="width:10%;min-width:90px">分类</th>
                    <th style="width:10%;min-width:80px">创建人</th>
                    <th style="width:9%;min-width:90px">更新时间</th>
                    <th style="width:10%;min-width:120px;text-align:right">操作</th>
                </tr>
            </thead>
            <tbody id="dataTableBody">
            </tbody>
            <tfoot id="dataTableDropZone" ondragover="handleDropZoneOver(event)" ondragleave="handleDropZoneLeave(event)" ondrop="handleDropZoneDrop(event)">
                <tr>
                    <td colspan="8">
                        <div class="drop-zone-area">拖到此处移至底部</div>
                    </td>
                </tr>
            </tfoot>
        </table>
    </div>

</main>

</div>

</div>

<div class="modal-overlay" id="modalOverlay">
    <div class="modal-backdrop"></div>
    <div class="modal-dialog">
        <div class="modal-head">
            <div class="modal-title" id="modalTitle">新增文案</div>
            <div class="modal-head-meta" id="modalHeadMeta"></div>
            <button class="modal-close" onclick="closeModal()"><i data-feather="x" style="width:18px;height:18px;"></i></button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label class="form-label">标题</label>
                <input type="text" class="form-input" id="titleInput" placeholder="输入标题..." autocomplete="off">
            </div>
            <div class="form-group">
                <label class="form-label">分类</label>
                <div class="cat-select-wrapper" id="catSelectWrapper">
                    <div class="cat-select-trigger" id="catSelectTrigger" onclick="toggleCatDropdown()">
                        <div class="cat-select-left">
                            <span class="cat-select-dot" id="catSelectDot" style="display:none"></span>
                            <span class="cat-select-text placeholder" id="catSelectText">选择分类...</span>
                        </div>
                        <span class="cat-select-arrow"><i data-feather="chevron-down" style="width:14px;height:14px;"></i></span>
                    </div>
                    <div class="cat-select-dropdown" id="catSelectDropdown">
                        <div class="cat-dropdown-head">
                            <div class="cat-dropdown-search">
                                <span class="search-icon-xs"><i data-feather="search" style="width:12px;height:12px;"></i></span>
                                <input type="text" id="catDropdownSearchInput" placeholder="搜索分类..." oninput="filterCatDropdown(this.value)" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')">
                            </div>
                        </div>
                        <div class="cat-dropdown-list" id="catDropdownList"></div>
                    </div>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">标签（逗号分隔，最多 20 个）</label>
                <input type="text" class="form-input" id="itemTags" placeholder="如: 营销, 通知, 公告" autocomplete="off">
            </div>
            <div class="form-group">
                <label class="form-label">内容（支持粘贴图片）</label>
                <div id="editorContainer"></div>
            </div>
        </div>
        <div class="modal-foot">
            <div class="modal-foot-meta" id="modalFootMeta"></div>
            <button class="btn btn-default" onclick="closeModal()">取消</button>
            <button class="btn btn-primary" onclick="saveItem()">保存</button>
        </div>
    </div>
</div>

<!-- Confirm Dialog -->
<div class="confirm-overlay" id="confirmOverlay">
    <div class="confirm-box">
        <div class="confirm-icon" id="confirmIcon"><i data-feather="alert-triangle" style="width:32px;height:32px;"></i></div>
        <div class="confirm-msg" id="confirmMsg"></div>
        <div class="confirm-actions">
            <button class="btn btn-default" onclick="closeConfirm(false)">取消</button>
            <button class="btn btn-primary" onclick="closeConfirm(true)">确定</button>
        </div>
    </div>
</div>

<!-- Input Dialog (自定义输入框) -->
<div class="input-dialog-overlay" id="inputDialogOverlay">
    <div class="input-dialog-backdrop" onclick="closeInputDialog(null)"></div>
    <div class="input-dialog-box">
        <div class="input-dialog-head">
            <div class="input-dialog-icon" id="inputDialogIcon"><i data-feather="edit-3" style="width:28px;height:28px;"></i></div>
            <div class="input-dialog-title" id="inputDialogTitle">请输入内容</div>
        </div>
        <div class="input-dialog-body">
            <input type="text" id="inputDialogInput" class="input-dialog-field" placeholder="请输入..." autocomplete="off">
        </div>
        <div class="input-dialog-foot">
            <button class="btn btn-default" onclick="closeInputDialog(null)">取消</button>
            <button class="btn btn-primary" onclick="submitInputDialog()">确定</button>
        </div>
    </div>
</div>

<!-- Dedup Confirm Dialog (查重富信息确认框) -->
<div class="dedup-confirm-overlay" id="dedupConfirmOverlay">
    <div class="dedup-confirm-box" id="dedupConfirmBox">
        <div class="dedup-confirm-head">
            <div class="dedup-confirm-icon" id="dedupConfirmIcon"><i data-feather="alert-triangle" style="width:28px;height:28px;"></i></div>
            <div class="dedup-confirm-title">检测到内容重复</div>
        </div>
        <div class="dedup-confirm-body">
            <div class="dedup-confirm-target">
                <span class="dedup-confirm-label">与现有文案：</span>
                <span class="dedup-confirm-link" id="dedupConfirmLink" title="该文案已存在于文案库"></span>
            </div>
            <div class="dedup-confirm-stats">
                <div class="dedup-stat-item">
                    <div class="dedup-stat-num" id="dedupConfirmSim">0%</div>
                    <div class="dedup-stat-name">重复率</div>
                </div>
                <div class="dedup-stat-item">
                    <div class="dedup-stat-num" id="dedupConfirmChars">0 字</div>
                    <div class="dedup-stat-name">重复字数</div>
                </div>
            </div>
            <div class="dedup-confirm-bar">
                <div class="dedup-confirm-bar-fill" id="dedupConfirmBarFill"></div>
            </div>
            <div class="dedup-confirm-snip" id="dedupConfirmSnip"></div>
            <div class="dedup-confirm-hint">建议先查看重复文案，确认是否仍需保存为新条目。</div>
        </div>
        <div class="dedup-confirm-actions">
            <button class="btn btn-default" onclick="closeDedupConfirm('cancel')">取消</button>
            <button class="btn btn-default" onclick="closeDedupConfirm('view')">查看该文案</button>
            <button class="btn btn-primary" onclick="closeDedupConfirm('save')">仍然保存</button>
        </div>
    </div>
</div>

<!-- Compare Overlay (文案对比视图 - 左右对比) -->
<div class="compare-overlay" id="compareOverlay">
    <div class="compare-backdrop" onclick="closeCompare()"></div>
    <div class="compare-dialog">
        <div class="compare-modal-head">
            <div class="compare-modal-title" id="compareModalTitle">文案对比</div>
            <button class="modal-close" onclick="closeCompare()"><i data-feather="x" style="width:18px;height:18px;"></i></button>
        </div>
        <div class="compare-modal-body" id="compareModalBody"></div>
        <div class="compare-modal-foot">
            <button class="btn btn-default" onclick="closeCompare()">关闭</button>
        </div>
    </div>
</div>

<!-- Library Access Auth Modal (文案库访问验证 - 账户密码登录/注册) -->
<div class="modal-overlay lib-auth-overlay" id="libraryAuthOverlay">
    <div class="modal-backdrop"></div>
    <div class="modal-dialog lib-auth-dialog">
        <div class="lib-auth-head">
            <div class="lib-auth-icon"><i data-feather="lock" style="width:36px;height:36px;"></i></div>
            <div class="lib-auth-title" id="libAuthTitle">文案库访问验证</div>
            <div class="lib-auth-sub" id="libAuthSub">请使用账户登录以查看文案库内容</div>
        </div>
        <div class="lib-auth-body">
            <!-- 账户密码登录模式 -->
            <div class="lib-auth-mode" id="libAuthModeAccount">
                <div class="lib-auth-form">
                    <div class="lib-auth-field">
                        <input type="text" id="libUsernameInput" class="form-input"
                               placeholder="请输入用户名..." autocomplete="username">
                    </div>
                    <div class="lib-auth-field">
                        <input type="password" id="libPasswordInput" class="form-input"
                               placeholder="请输入密码..." autocomplete="current-password"
                               onkeydown="if(event.key==='Enter')verifyUserLogin()">
                    </div>
                </div>
                <div class="lib-auth-error" id="libAuthAccountError" style="display:none;"></div>
                <button class="btn btn-primary lib-auth-submit" id="libAuthAccountSubmitBtn" onclick="verifyUserLogin()">登录</button>
                <div class="lib-auth-switch-link" id="libAuthRegisterLink">
                    还没有账户？<a href="javascript:void(0)" onclick="openRegisterForm()">立即注册</a>
                </div>
            </div>
            <!-- 账户注册模式 -->
            <div class="lib-auth-mode" id="libAuthModeRegister" style="display:none;">
                <div class="lib-auth-form">
                    <div class="lib-auth-field">
                        <input type="text" id="libRegUsernameInput" class="form-input"
                               placeholder="请设置用户名（2-50位）..." autocomplete="username">
                    </div>
                    <div class="lib-auth-field">
                        <input type="password" id="libRegPasswordInput" class="form-input"
                               placeholder="请设置密码（6-72位）..." autocomplete="new-password">
                    </div>
                    <div class="lib-auth-field">
                        <input type="password" id="libRegConfirmInput" class="form-input"
                               placeholder="请再次输入密码..." autocomplete="new-password"
                               onkeydown="if(event.key==='Enter')registerUser()">
                    </div>
                </div>
                <div class="lib-auth-error" id="libAuthRegisterError" style="display:none;"></div>
                <button class="btn btn-primary lib-auth-submit" id="libAuthRegisterSubmitBtn" onclick="registerUser()">注册</button>
                <div class="lib-auth-switch-link">
                    已有账户？<a href="javascript:void(0)" onclick="closeRegisterForm()">返回登录</a>
                </div>
            </div>
        </div>
        <div class="lib-auth-foot">
            <button class="btn btn-default" onclick="cancelLibraryAuth()">取消</button>
        </div>
    </div>
</div>

<!-- Library Access Gate (未验证时的占位遮罩) -->
<div class="lib-gate loading" id="libraryGate">
    <div class="lib-gate-icon" id="libGateIcon"><i data-feather="loader" style="width:48px;height:48px;"></i></div>
    <div class="lib-gate-text" id="libGateText">加载中...</div>
    <div class="lib-gate-sub" id="libGateSub">正在初始化</div>
    <button class="btn btn-primary" id="libGateBtn" style="display:none;" onclick="openLibraryAuth()"><i data-feather="key" style="width:14px;height:14px;"></i> 账户登录</button>
</div>

<div class="toast-container" id="toastContainer"></div>

<!-- Announcement Modal (弹窗公告) -->
<div class="ann-overlay" id="announcementOverlay">
    <div class="ann-backdrop" onclick="dismissAnnouncementBackdrop()"></div>
    <div class="ann-dialog" id="announcementDialog">
        <div class="ann-head">
            <div class="ann-icon-wrap" id="announcementIconWrap"><i data-feather="bell" style="width:22px;height:22px;"></i></div>
            <div class="ann-title" id="announcementTitle">公告</div>
            <button class="ann-close" id="announcementCloseBtn" onclick="dismissCurrentAnnouncement()" title="关闭"><i data-feather="x" style="width:18px;height:18px;"></i></button>
        </div>
        <div class="ann-body" id="announcementBody"></div>
        <div class="ann-foot" id="announcementFoot">
            <button class="btn btn-primary" onclick="dismissCurrentAnnouncement()">我知道了</button>
        </div>
        <div class="ann-pager" id="announcementPager" style="display:none;"></div>
    </div>
</div>

<!-- Preview Modal (快速预览) -->
<div class="preview-overlay" id="previewOverlay">
    <div class="preview-backdrop" onclick="closePreview()"></div>
    <div class="preview-dialog">
        <div class="preview-head">
            <div class="preview-title" id="previewTitle">预览</div>
            <div class="preview-meta" id="previewMeta"></div>
            <button class="preview-close" onclick="closePreview()"><i data-feather="x" style="width:18px;height:18px;"></i></button>
        </div>
        <div class="preview-body" id="previewBody"></div>
        <div class="preview-foot">
            <button class="btn btn-default" onclick="closePreview()">关闭</button>
            <button class="btn btn-segment-toggle" id="previewSegmentBtn" onclick="togglePreviewSegmentMode()" title="将文案拆分为多个段落，可单独复制每段"><i data-feather="layers" style="width:14px;height:14px;"></i> 分段</button>
            <button class="btn btn-primary" id="previewShareBtn"><i data-feather="share-2" style="width:14px;height:14px;"></i> 分享</button>
            <button class="btn btn-primary" id="previewCopyBtn"><i data-feather="copy" style="width:14px;height:14px;"></i> 复制内容</button>
            <button class="btn btn-primary" id="previewEditBtn"><i data-feather="edit-3" style="width:14px;height:14px;"></i> 编辑</button>
        </div>
    </div>
</div>

<!-- Share Dialog (分享文案) -->
<div class="share-overlay" id="shareOverlay">
    <div class="share-backdrop" onclick="closeShareDialog()"></div>
    <div class="share-box">
        <div class="share-head">
            <div class="share-head-icon"><i data-feather="share-2" style="width:24px;height:24px;"></i></div>
            <div class="share-head-title" id="shareDialogTitle">分享文案</div>
            <button class="share-close" onclick="closeShareDialog()"><i data-feather="x" style="width:18px;height:18px;"></i></button>
        </div>
        <div class="share-body" id="shareDialogBody"></div>
    </div>
</div>

<!-- Image Gallery Modal (图片墙) -->
<div class="gallery-overlay" id="galleryOverlay">
    <div class="gallery-backdrop" onclick="closeGallery()"></div>
    <div class="gallery-dialog">
        <div class="gallery-head">
            <div class="gallery-title" id="galleryTitle"><i data-feather="image" style="width:18px;height:18px;"></i> 图片墙</div>
            <span class="gallery-count" id="galleryCount"></span>
            <button class="gallery-close" onclick="closeGallery()"><i data-feather="x" style="width:18px;height:18px;"></i></button>
        </div>
        <div class="gallery-toolbar">
            <div class="gallery-search-box">
                <span class="search-icon-xs"><i data-feather="search" style="width:12px;height:12px;"></i></span>
                <input type="text" id="gallerySearch" placeholder="搜索图片标题..." oninput="searchGallery()" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')">
            </div>
            <select id="galleryCatFilter" onchange="filterGallery()">
                <option value="">全部分类</option>
            </select>
        </div>
        <div class="gallery-grid" id="galleryGrid"></div>
        <div class="gallery-empty" id="galleryEmpty" style="display:none;">
            <p>暂无图片</p>
        </div>
    </div>
</div>

<script src="<?php echo asset_v('js/modules/state.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/utils.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/dataService.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/dialogs.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/virtualList.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/renderer.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/layout.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/dedup.js'); ?>" defer></script>
<script>
    // 为统一编辑器配置前台上下文（必须在 editor.js 加载前设置）
    // 复用 dataService.js 中的 apiFetch（自动注入 CSRF）和 ensureCsrfToken
    window.EDITOR_CONTEXT = {
        imagePathPrefix: '',
        uploadUrl: 'api.php?action=uploadImage',
        proxyUrl: 'api.php?action=proxyImage',
        withCsrf: true,
        hasPermission: function (perm) {
            return (typeof hasPermission === 'function') ? hasPermission(perm) : true;
        },
        apiFetch: function (url, opts) {
            return (typeof apiFetch === 'function') ? apiFetch(url, opts) : fetch(url, opts);
        },
        ensureCsrf: function () {
            return (typeof ensureCsrfToken === 'function') ? ensureCsrfToken() : Promise.resolve(null);
        },
        showToast: function (msg, type) {
            if (typeof showToast === 'function') showToast(msg, type);
        }
    };
</script>
<script src="<?php echo asset_v('js/modules/editor.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/items.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/segment.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/preview.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/clipboard.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/navigation.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/categories.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/dragDrop.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/gallery.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/libraryAuth.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/announcement.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/share.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/modules/theme.js'); ?>" defer></script>
    <script src="<?php echo asset_v('js/modules/sync.js'); ?>" defer></script>
    <script src="<?php echo asset_v('js/app.js'); ?>" defer></script>

</body>
</html>