/* Cpydes 管理后台 —— 由 admin.js 机械拆分（admin-system.js），依赖 admin-core.js 先加载 */
'use strict';

/* ========== 仪表盘 ========== */

// 异步获取图片存储大小
let _imageTotalSizeText = '';
async function loadImageSize() {
    if (_imageTotalSizeText) return _imageTotalSizeText;
    try {
        const r = await adminApiFetch('scanImages');
        const j = await r.json();
        if (j.success && j.totalSizeText) {
            _imageTotalSizeText = j.totalSizeText;
        }
    } catch (e) { console.error(e); }
    return _imageTotalSizeText;
}

// 异步获取访问量统计（今日 + 近 7 天，按页面聚合）
async function loadPageViewsStats() {
    try {
        const r = await adminApiFetch('getPageViewsStats?days=7');
        const j = await r.json();
        if (j.success) return j;
    } catch (e) { console.error(e); }
    return null;
}

// 渲染访问量统计面板：按页面展示近 7 天 PV 分布（横向条形图，复用 .rank-* 样式）
function renderPageViewsChart(stats) {
    if (!stats || !Array.isArray(stats.rows) || stats.rows.length === 0) {
        return '<div class="empty-state"><div class="empty-icon"><i data-feather="inbox" style="width:48px;height:48px;"></i></div><div class="empty-text">暂无访问数据</div></div>';
    }
    const rows = stats.rows.slice(0, 8); // Top 8 页面
    const maxTotal = Math.max(...rows.map(r => r.total), 1);
    const totalAll = rows.reduce((s, r) => s + r.total, 0);
    const bars = rows.map(r => {
        const pct = Math.max((r.total / maxTotal) * 100, 2);
        return `
            <div class="rank-item">
                <span class="rank-label" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</span>
                <div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%;"></div></div>
                <span class="rank-val">${r.total}</span>
            </div>
        `;
    }).join('');
    return `
        <div>${bars}</div>
        <div class="chart-foot">近 7 天合计 <strong>${totalAll}</strong> 次访问</div>
    `;
}

/**
 * 计算 SVG 饼图扇形路径
 * @param {number} cx 圆心x
 * @param {number} cy 圆心y
 * @param {number} r 半径
 * @param {number} startAngle 起始角度(弧度)
 * @param {number} endAngle 结束角度(弧度)
 */
function pieSlice(cx, cy, r, startAngle, endAngle) {
    const clampedEnd = Math.min(endAngle, startAngle + 2 * Math.PI - 0.001);
    if (clampedEnd - startAngle < 0.001) return '';
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(clampedEnd);
    const y2 = cy + r * Math.sin(clampedEnd);
    const largeArc = (clampedEnd - startAngle) > Math.PI ? 1 : 0;
    return `M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${largeArc},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
}

/**
 * 渲染分类饼图
 */
function renderPieChart(topCats, total) {
    if (topCats.length === 0) return '<div class="empty-state"><div class="empty-icon"><i data-feather="inbox" style="width:48px;height:48px;"></i></div><div class="empty-text">暂无数据</div></div>';
    const cx = 70, cy = 70, r = 58;
    let angle = -Math.PI / 2;
    let slices = '';
    const colors = topCats.map(c => sanitizeColor(c.color) || '#6366f1');

    topCats.forEach((cat, i) => {
        const sweep = (cat.count / total) * 2 * Math.PI;
        const path = pieSlice(cx, cy, r, angle, angle + sweep);
        slices += `<path d="${path}" fill="${colors[i]}" class="pie-slice-stroke" stroke-width="2"/>`;
        angle += sweep;
    });

    // 中间圆形成环形效果
    const centerCircle = `<circle cx="${cx}" cy="${cy}" r="32" class="pie-center-circle"/>`;
    const centerText = `<text x="${cx}" y="${cy - 2}" class="pie-center-text" text-anchor="middle">${total}</text>
                        <text x="${cx}" y="${cy + 12}" class="pie-center-label" text-anchor="middle">总计</text>`;

    const pieInfo = topCats.map((c, i) => {
        const pct = total ? (c.count / total * 100).toFixed(1) : 0;
        return `
            <div class="pie-info-item">
                <span class="pie-info-name"><span class="dot" style="background:${colors[i]}"></span>${escapeHtml(c.name)}</span>
                <span><span class="pie-info-val">${c.count}</span><span class="pie-info-pct">${pct}%</span></span>
            </div>`;
    }).join('');

    return `
        <div class="pie-chart">
            <svg class="pie-svg" viewBox="0 0 140 140">${slices}${centerCircle}${centerText}</svg>
            <div class="pie-info">${pieInfo}</div>
        </div>`;
}

/**
 * 渲染近7天趋势柱状图
 */
function renderTrendChart(items) {
    if (items.length === 0) return '<div class="empty-state"><div class="empty-icon"><i data-feather="inbox" style="width:48px;height:48px;"></i></div><div class="empty-text">暂无数据</div></div>';

    const days = [];
    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const now = new Date();
    const dayKeySet = new Set();
    
    // 预计算7天的日期key
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        days.push({ key, label: dayNames[d.getDay()], date: d.getDate() });
        dayKeySet.add(key);
    }

    // Single pass: bucket items by date key
    const countMap = Object.create(null);
    for (const k of dayKeySet) countMap[k] = 0;
    
    // 缓存日期格式化结果，避免重复创建Date对象
    const dateKeyCache = new Map();
    for (const it of items) {
        const dateStr = it.createdAt || it.updatedAt;
        if (!dateStr) continue;
        
        // 尝试从缓存获取
        let key = dateKeyCache.get(dateStr);
        if (!key) {
            const t = new Date(dateStr);
            if (isNaN(t.getTime())) continue;
            key = t.getFullYear() + '-' + String(t.getMonth()+1).padStart(2,'0') + '-' + String(t.getDate()).padStart(2,'0');
            dateKeyCache.set(dateStr, key);
        }
        
        if (countMap[key] !== undefined) countMap[key]++;
    }
    
    const counts = days.map(d => countMap[d.key]);
    const maxVal = Math.max(...counts, 1);
    const bars = counts.map((c, i) => `
        <div class="bar-col">
            <div class="bar-val">${c}</div>
            <div class="bar-fill" style="height:${Math.max((c / maxVal) * 90, 4)}px;${i === 6 ? 'background:linear-gradient(180deg, #34d399, var(--ok));' : ''}"></div>
            <div class="bar-label">${days[i].label}<br>${days[i].date}号</div>
        </div>
    `).join('');

    return `
        <div class="bar-chart">${bars}</div>
        <div style="text-align:center;margin-top:10px;font-size:11.5px;color:var(--t3);"><i data-feather="calendar" style="width:11px;height:11px;vertical-align:middle;"></i> 近7天新增文案趋势（今日绿色高亮）</div>`;
}

/**
 * 渲染图片存储使用条形图
 */
function renderStorageChart(imgCount, data) {
    if (imgCount === 0) return '<div class="empty-state"><div class="empty-icon"><i data-feather="image" style="width:48px;height:48px;"></i></div><div class="empty-text">暂无图片数据</div></div>';

    // 预编译正则表达式
    const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
    
    // 按分类统计图片数量
    const imgByCat = {};
    for (const it of data.items) {
        if (!it.content || !it.categoryId) continue;
        
        // 使用 matchAll 替代 match，避免创建不必要的数组
        let matchCount = 0;
        let match;
        imgRegex.lastIndex = 0; // 重置正则状态
        while ((match = imgRegex.exec(it.content)) !== null) {
            matchCount++;
        }
        
        if (matchCount > 0) {
            imgByCat[it.categoryId] = (imgByCat[it.categoryId] || 0) + matchCount;
        }
    }

    const catImgs = Object.entries(imgByCat)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([cid, cnt]) => {
            const cat = findCategoryById(cid);
            return { name: cat ? cat.name : '未分类', count: cnt, color: cat ? (sanitizeColor(cat.color) || '#6366f1') : '#9ca3af' };
        });

    const maxImg = catImgs.length ? catImgs[0].count : 1;
    const bars = catImgs.map(c => `
        <div class="bar-col">
            <div class="bar-val">${c.count}</div>
            <div class="bar-fill" style="height:${Math.max((c.count / maxImg) * 90, 4)}px;background:${c.color};"></div>
            <div class="bar-label" title="${escapeHtml(c.name)}">${escapeHtml(c.name.length > 4 ? c.name.substring(0,4)+'…' : c.name)}</div>
        </div>
    `).join('');

    return `
        <div class="bar-chart">${bars}</div>
        <div style="text-align:center;margin-top:10px;font-size:11.5px;color:var(--t3);"><i data-feather="bar-chart-2" style="width:11px;height:11px;vertical-align:middle;"></i> 各分类图片数量分布</div>`;
}

function renderDashboard() {
    const data = AdminState.data;
    const itemCount = data.items.length;
    const catCount = data.categories.length;
    const subCatCount = data.categories.reduce((s, c) => s + (c.children ? c.children.length : 0), 0);
    const imgCount = countImagesInItems(data.items);

    // 最近 7 天新增
    const sevenAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const recentCount = data.items.filter(i => {
        const t = new Date(i.createdAt || i.updatedAt || 0).getTime();
        return t >= sevenAgo;
    }).length;

    // 分类分布 Top 5
    const catDist = {};
    data.items.forEach(it => {
        const cid = it.categoryId;
        if (cid) catDist[cid] = (catDist[cid] || 0) + 1;
    });
    const topCats = Object.entries(catDist)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([cid, cnt]) => {
            const cat = findCategoryById(cid);
            return { name: cat ? cat.name : '未知', count: cnt, color: cat ? (sanitizeColor(cat.color) || '#6366f1') : '#6366f1' };
        });
    const maxCat = topCats.length ? topCats[0].count : 1;

    // 最近 5 条
    const recent = [...data.items]
        .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
        .slice(0, 5);

    const html = `
    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-head">
                <div class="stat-label">文案总数</div>
                <div class="stat-icon"><i data-feather="file-text"></i></div>
            </div>
            <div class="stat-value">${itemCount}</div>
            <div class="stat-foot">最近 7 天新增 ${recentCount} 条</div>
        </div>
        <div class="stat-card stat-ok">
            <div class="stat-head">
                <div class="stat-label">分类总数</div>
                <div class="stat-icon"><i data-feather="folder"></i></div>
            </div>
            <div class="stat-value">${catCount}</div>
            <div class="stat-foot">含 ${subCatCount} 个子分类</div>
        </div>
        <div class="stat-card stat-warn" id="statCardPageViews" style="display:none;">
            <div class="stat-head">
                <div class="stat-label">访问量</div>
                <div class="stat-icon"><i data-feather="eye"></i></div>
            </div>
            <div class="stat-value" id="pageViewsValue" style="font-size:22px;">-</div>
            <div class="stat-foot" id="pageViewsFoot">近 7 天页面访问</div>
        </div>
        <div class="stat-card stat-info">
            <div class="stat-head">
                <div class="stat-label">图片数量</div>
                <div class="stat-icon"><i data-feather="image"></i></div>
            </div>
            <div class="stat-value">${imgCount}</div>
            <div class="stat-foot">嵌入于文案记录</div>
        </div>
        <div class="stat-card stat-warn" id="statCardStorage" style="display:none;">
            <div class="stat-head">
                <div class="stat-label">图片存储</div>
                <div class="stat-icon"><i data-feather="hard-drive"></i></div>
            </div>
            <div class="stat-value" id="storageValue" style="font-size:22px;">-</div>
            <div class="stat-foot" id="storageFoot">img/ 目录总占用</div>
        </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div class="panel">
            <div class="panel-head">
                <div class="panel-title"><i data-feather="pie-chart" style="width:16px;height:16px;"></i> 分类分布</div>
            </div>
            <div class="panel-body">
                ${renderPieChart(topCats, itemCount)}
            </div>
        </div>
        <div class="panel">
            <div class="panel-head">
                <div class="panel-title"><i data-feather="trending-up" style="width:16px;height:16px;"></i> 近7天趋势</div>
            </div>
            <div class="panel-body">
                ${renderTrendChart(data.items)}
            </div>
        </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div class="panel">
            <div class="panel-head">
                <div class="panel-title"><i data-feather="bar-chart" style="width:16px;height:16px;"></i> 访问量统计</div>
            </div>
            <div class="panel-body" id="pageViewsPanel">
                <div class="loading-state"><div class="spinner"></div>加载访问数据...</div>
            </div>
        </div>
        <div class="panel">
            <div class="panel-head">
                <div class="panel-title"><i data-feather="image" style="width:16px;height:16px;"></i> 图片分布</div>
            </div>
            <div class="panel-body">
                ${renderStorageChart(imgCount, data)}
            </div>
        </div>
    </div>

    <div class="panel">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="clock" style="width:16px;height:16px;"></i> 最近更新</div>
            <button class="btn btn-default btn-sm" onclick="switchView('content')">查看全部</button>
        </div>
        <div class="panel-body no-pad">
            ${recent.length === 0 ? '<div class="empty-state"><div class="empty-icon"><i data-feather="inbox" style="width:48px;height:48px;"></i></div><div class="empty-text">暂无文案</div></div>' :
                '<table class="data-table"><tbody>' +
                recent.map(it => `
                    <tr>
                        <td class="cell-title">${escapeHtml(truncate(it.title || '(无标题)', 30))}</td>
                        <td class="cell-time">${formatDate(it.updatedAt || it.createdAt)}</td>
                    </tr>
                `).join('') +
                '</tbody></table>'
            }
        </div>
    </div>
    `;
    document.getElementById('adminContent').innerHTML = html;
    refreshFeatherIcons();

    // 异步加载图片存储大小
    const loadStorage = async () => {
        const sizeText = await loadImageSize();
        if (!sizeText) return;
        const card = document.getElementById('statCardStorage');
        const val = document.getElementById('storageValue');
        if (card) { card.style.display = ''; }
        if (val) { val.textContent = sizeText; }
    };
    loadStorage();

    // 异步加载访问量统计（需 view.onlineUsers 权限）
    const loadPageViews = async () => {
        if (!hasPermission('view.onlineUsers')) return;
        const stats = await loadPageViewsStats();
        if (!stats) return;
        // 统计卡片：今日总访问 + 7 天合计
        const today = (stats.dates && stats.dates.length) ? stats.dates[stats.dates.length - 1] : null;
        let todayTotal = 0;
        let weekTotal = 0;
        if (Array.isArray(stats.rows)) {
            stats.rows.forEach(r => {
                weekTotal += r.total || 0;
                if (today && Array.isArray(r.days)) {
                    const d = r.days.find(x => x.date === today);
                    if (d) todayTotal += d.count || 0;
                }
            });
        }
        const card = document.getElementById('statCardPageViews');
        const val = document.getElementById('pageViewsValue');
        const foot = document.getElementById('pageViewsFoot');
        if (card) { card.style.display = ''; }
        if (val) { val.textContent = String(weekTotal); }
        if (foot) { foot.textContent = '今日 ' + todayTotal + ' · 近 7 天'; }
        // 面板：按页面展示 PV 分布
        const panel = document.getElementById('pageViewsPanel');
        if (panel) {
            panel.innerHTML = renderPageViewsChart(stats);
            refreshFeatherIcons();
        }
    };
    loadPageViews();
}

const _imgCountRegex = /<img[^>]+src=["']([^"']+)["']/gi;

function countImagesInItems(items) {
    let n = 0;
    for (const it of items) {
        if (!it.content) continue;
        _imgCountRegex.lastIndex = 0;
        while (_imgCountRegex.exec(it.content) !== null) {
            n++;
        }
    }
    return n;
}


/* ========== 基础设置（合并：外观 / 访问保护 / 用户注册 / 访客权限） ========== */
const BASIC_SETTINGS_TABS = [
    { id: 'appearance',   label: '外观',     icon: 'layout',         perm: 'view.appearance' },
    { id: 'protection',  label: '访问保护', icon: 'lock',           perm: 'view.access' },
    { id: 'register',    label: '用户注册', icon: 'user-plus',      perm: 'view.access' },
    { id: 'guest',       label: '访客权限', icon: 'users',          perm: 'view.access' },
    { id: 'copyReminder', label: '复制提醒', icon: 'alert-circle',  perm: 'view.access' },
    { id: 'sync',        label: '实时同步', icon: 'refresh-cw',     perm: 'view.access' },
];

async function renderBasicSettings(targetContainer, tab) {
    const c = targetContainer || document.getElementById('adminContent');

    // 默认 Tab：按权限选择第一个可见 Tab
    if (!tab || !BASIC_SETTINGS_TABS.find(t => t.id === tab && hasPermission(t.perm))) {
        const first = BASIC_SETTINGS_TABS.find(t => hasPermission(t.perm));
        tab = first ? first.id : '';
    }
    AdminState.basicSettingsTab = tab;

    // 权限校验：无任何子 Tab 权限则提示
    if (!tab) {
        c.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-feather="alert-triangle" style="width:48px;height:48px;"></i></div><div class="empty-text">权限不足，无法访问基础设置</div></div>`;
        refreshFeatherIcons();
        return;
    }

    // 渲染外壳：顶部 Tab 栏 + 内容容器
    const tabsHtml = BASIC_SETTINGS_TABS.map(t => {
        if (!hasPermission(t.perm)) return '';
        const active = t.id === tab ? 'active' : '';
        return `<button class="adm-tab-btn ${active}" onclick="switchBasicSettingsTab('${t.id}')"><i data-feather="${t.icon}"></i> ${t.label}</button>`;
    }).join('');

    c.innerHTML = `
    <div class="adm-tabs-shell">
        <div class="adm-tabs-bar">${tabsHtml}</div>
        <div class="adm-tab-body" id="basicSettingsBody"><div class="loading-state"><div class="spinner"></div>加载中...</div></div>
    </div>`;
    refreshFeatherIcons();

    const body = document.getElementById('basicSettingsBody');
    if (!body) return;

    // 按 Tab 渲染对应内容
    if (tab === 'appearance') {
        await renderAppearance(body);
    } else if (tab === 'protection') {
        // 访问保护只渲染"文案库访问保护"面板（不含访客权限和用户注册）
        await renderAccessProtectionPanel(body);
    } else if (tab === 'register') {
        // 用户注册只渲染"用户注册"面板
        await renderRegisterPanel(body);
    } else if (tab === 'guest') {
        // 访客权限只渲染"访客权限配置"面板
        await renderGuestPermPanel(body);
    } else if (tab === 'copyReminder') {
        // 复制文案时效提醒配置面板
        await renderCopyReminderPanel(body);
    } else if (tab === 'sync') {
        // 实时同步配置面板
        await renderSyncPanel(body);
    }
}

function switchBasicSettingsTab(tab) {
    renderBasicSettings(null, tab);
}

/* ========== 复制文案时效提醒配置面板 ========== */
const COPY_REMINDER_DEFAULTS = {
    enabled: false,
    strategy: 'aged',
    thresholdDays: 30,
    message: '此文案可能因活动过期或内容变更而失效，使用前请核对并按需修改。',
    displayMode: 'toast',
    duration: 5000,
    showUpdatedAt: true,
    textColor: '',
    fontSize: 0,
};

async function renderCopyReminderPanel(container) {
    const c = container || document.getElementById('adminContent');
    c.innerHTML = '<div class="loading-state"><div class="spinner"></div>加载复制提醒设置...</div>';
    let cfg;
    try {
        const r = await adminApiFetch('getLibrarySettings');
        if (r.status === 401) { showToast('会话已过期，请重新登录', 'error'); setTimeout(() => location.reload(), 1500); return; }
        const j = await r.json();
        if (!j.success) { c.innerHTML = `<div class="empty-state"><div class="empty-text">${escapeHtml(j.error || '加载失败')}</div></div>`; return; }
        cfg = j.copyReminder || Object.assign({}, COPY_REMINDER_DEFAULTS);
    } catch (e) {
        c.innerHTML = '<div class="empty-state"><div class="empty-text">网络错误</div></div>';
        return;
    }
    AdminState.copyReminderConfig = cfg;
    AdminState.copyReminderDraftConfig = Object.assign({}, cfg);
    // 同步到全局，供编辑器（UnifiedEditor.computeItemMetaInfo）计算文案失效提示
    window.COPY_REMINDER = cfg;

    const canManage = hasPermission('settings.manage');
    const disabledAttr = canManage ? '' : 'disabled';

    const strategyOptions = [
        { value: 'always', label: '始终提醒（每次复制都提醒）' },
        { value: 'aged', label: '按文案时效提醒（超过阈值才提醒）' },
    ];
    const displayOptions = [
        { value: 'toast', label: 'Toast 提示条' },
        { value: 'modal', label: '弹窗确认（需点确定）' },
    ];

    c.innerHTML = `
    <div class="panel">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="alert-circle" style="width:16px;height:16px;"></i> 复制文案时效提醒</div>
            <label class="access-switch">
                <input type="checkbox" id="copyReminderEnabled" ${cfg.enabled ? 'checked' : ''} onchange="onCopyReminderCfgChange('enabled', this.checked)" ${disabledAttr}>
                <span class="access-switch-slider"></span>
            </label>
        </div>
        <div class="panel-body">
            <div class="access-status-row" style="margin-bottom:20px;">
                <span class="badge ${cfg.enabled ? 'badge-ok' : 'badge-err'}">${cfg.enabled ? '已开启' : '已关闭'}</span>
                <span style="font-size:13px;color:var(--t3);margin-left:8px;">复制文案时按策略追加时效提醒，提示用户核对活动过期/内容变更后再使用</span>
            </div>

            <div class="dedup-config-form">
                <div class="dedup-config-row" style="flex-direction:column;align-items:stretch;gap:8px;">
                    <div class="access-info">
                        <div class="access-title">触发策略</div>
                        <div class="access-desc">控制什么情况下复制时触发提醒</div>
                    </div>
                    <select id="copyReminderStrategy" class="form-select" onchange="onCopyReminderCfgChange('strategy', this.value)" ${disabledAttr}>
                        ${strategyOptions.map(o => `<option value="${o.value}" ${cfg.strategy === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
                    </select>
                </div>

                <div class="dedup-slider-row" id="copyReminderThresholdRow" style="${cfg.strategy === 'aged' ? '' : 'display:none;'}">
                    <div class="dedup-slider-label">
                        <span>时效阈值（天）</span>
                        <span class="dedup-slider-val" id="copyReminderThresholdVal">${cfg.thresholdDays}</span>
                    </div>
                    <input type="range" class="dedup-slider" min="1" max="365" step="1" value="${cfg.thresholdDays}" oninput="onCopyReminderCfgChange('thresholdDays', Number(this.value))" ${disabledAttr}>
                    <div class="dedup-slider-hint">文案「最后更新时间」距今天数超过此值才触发提醒。1=昨天及更早，30=约一个月前</div>
                </div>

                <div class="dedup-config-row" style="flex-direction:column;align-items:stretch;gap:8px;">
                    <div class="access-info">
                        <div class="access-title">提醒文案</div>
                        <div class="access-desc">展示给复制者的提示语（最长 200 字）</div>
                    </div>
                    <textarea id="copyReminderMessage" class="form-input" rows="3" maxlength="200" placeholder="如：此文案可能因活动过期或内容变更而失效，使用前请核对并按需修改。" oninput="onCopyReminderCfgChange('message', this.value)" ${disabledAttr}>${escapeHtml(cfg.message)}</textarea>
                </div>

                <div class="dedup-config-row" style="flex-direction:column;align-items:stretch;gap:8px;">
                    <div class="access-info">
                        <div class="access-title">展示方式</div>
                        <div class="access-desc">Toast 为右上角提示条；弹窗需用户点确定关闭</div>
                    </div>
                    <select id="copyReminderDisplayMode" class="form-select" onchange="onCopyReminderCfgChange('displayMode', this.value)" ${disabledAttr}>
                        ${displayOptions.map(o => `<option value="${o.value}" ${cfg.displayMode === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
                    </select>
                </div>

                <div class="dedup-slider-row" id="copyReminderDurationRow" style="${cfg.displayMode === 'toast' ? '' : 'display:none;'}">
                    <div class="dedup-slider-label">
                        <span>Toast 停留时长（秒）</span>
                        <span class="dedup-slider-val" id="copyReminderDurationVal">${(cfg.duration / 1000).toFixed(1)}</span>
                    </div>
                    <input type="range" class="dedup-slider" min="2" max="60" step="1" value="${(cfg.duration / 1000)}" oninput="onCopyReminderCfgChange('duration', Math.round(Number(this.value) * 1000))" ${disabledAttr}>
                    <div class="dedup-slider-hint">Toast 提示条自动消失的等待时间（2-60 秒）</div>
                </div>

                <div class="dedup-config-row">
                    <div class="access-info">
                        <div class="access-title">显示文案最后更新时间</div>
                        <div class="access-desc">在提醒文案后附「（最后更新：YYYY-MM-DD）」便于复制者核对</div>
                    </div>
                    <label class="access-switch">
                        <input type="checkbox" id="copyReminderShowUpdatedAt" ${cfg.showUpdatedAt ? 'checked' : ''} onchange="onCopyReminderCfgChange('showUpdatedAt', this.checked)" ${disabledAttr}>
                        <span class="access-switch-slider"></span>
                    </label>
                </div>

                <div class="dedup-config-row" style="flex-direction:column;align-items:stretch;gap:10px;">
                    <div class="access-info">
                        <div class="access-title">提示文字颜色与字号</div>
                        <div class="access-desc">颜色留空 = 跟随系统默认；颜色仅支持 #hex 与 rgb() 格式，字号范围 11-24px（0 = 跟随默认）</div>
                    </div>
                    <div class="copy-reminder-style-row" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                        <label style="font-size:13px;color:var(--t2);">颜色</label>
                        <input type="color" id="copyReminderTextColorPicker" value="${/^(#[0-9a-fA-F]{6})$/.test(cfg.textColor) ? cfg.textColor : '#cccccc'}" onchange="onCopyReminderTextColorPickerChange(this.value)" ${disabledAttr} style="width:40px;height:30px;border:1px solid var(--border);border-radius:6px;background:transparent;cursor:pointer;">
                        <input type="text" id="copyReminderTextColor" class="form-input" value="${escapeAttr(cfg.textColor || '')}" placeholder="如 #d97706 或 rgba(217,119,6,1)" oninput="onCopyReminderCfgChange('textColor', this.value)" ${disabledAttr} style="width:220px;">
                        <button type="button" class="btn btn-default" onclick="clearCopyReminderTextColor()" ${disabledAttr} style="padding:6px 10px;font-size:12px;">清空</button>
                        <span id="copyReminderColorStatus" style="font-size:12px;color:var(--t3);">${cfg.textColor ? '' : '（当前未设置颜色，使用默认）'}</span>
                    </div>
                    <div class="dedup-slider-row" style="margin:0;">
                        <div class="dedup-slider-label">
                            <span>字号（0 = 跟随默认）</span>
                            <span class="dedup-slider-val" id="copyReminderFontSizeVal">${cfg.fontSize}</span>
                        </div>
                        <input type="range" class="dedup-slider" min="0" max="24" step="1" value="${cfg.fontSize}" oninput="onCopyReminderCfgChange('fontSize', Number(this.value))" ${disabledAttr}>
                        <div class="dedup-slider-hint">推荐 13-16px；过大会撑爆 toast 容器，过小不易阅读</div>
                    </div>
                </div>

                <div class="dedup-config-actions">
                    ${canManage ? '<button class="btn btn-primary" onclick="saveCopyReminderConfig()"><i data-feather="save" style="width:14px;height:14px;"></i> 保存策略</button>' : ''}
                    ${canManage ? '<button class="btn btn-default" onclick="resetCopyReminderConfig()"><i data-feather="rotate-ccw" style="width:14px;height:14px;"></i> 恢复默认</button>' : ''}
                    ${!canManage ? '<span style="color:var(--t3);font-size:12px;"><i data-feather="lock" style="width:12px;height:12px;vertical-align:middle;"></i> 无权限修改复制提醒策略</span>' : ''}
                    <span class="dedup-config-status" id="copyReminderCfgStatus"></span>
                </div>
            </div>
        </div>
    </div>`;
    refreshFeatherIcons();
}

function onCopyReminderCfgChange(field, value) {
    if (!AdminState.copyReminderDraftConfig) AdminState.copyReminderDraftConfig = Object.assign({}, COPY_REMINDER_DEFAULTS);
    AdminState.copyReminderDraftConfig[field] = value;

    // 即时反映联动 UI
    if (field === 'strategy') {
        const row = document.getElementById('copyReminderThresholdRow');
        if (row) row.style.display = value === 'aged' ? '' : 'none';
    }
    if (field === 'displayMode') {
        const row = document.getElementById('copyReminderDurationRow');
        if (row) row.style.display = value === 'toast' ? '' : 'none';
    }
    if (field === 'thresholdDays') {
        const el = document.getElementById('copyReminderThresholdVal');
        if (el) el.textContent = value;
    }
    if (field === 'duration') {
        const el = document.getElementById('copyReminderDurationVal');
        if (el) el.textContent = (value / 1000).toFixed(1);
    }
    if (field === 'fontSize') {
        const el = document.getElementById('copyReminderFontSizeVal');
        if (el) el.textContent = value;
    }
    if (field === 'textColor') {
        // 文本框输入时同步颜色选择器（仅 #RRGGBB 6 位 hex 才同步，否则保持选择器原值）
        const picker = document.getElementById('copyReminderTextColorPicker');
        if (picker && /^#[0-9a-fA-F]{6}$/.test(value)) picker.value = value;
        // 同步"未设置颜色"状态提示
        const statusEl = document.getElementById('copyReminderColorStatus');
        if (statusEl) statusEl.textContent = value ? '' : '（当前未设置颜色，使用默认）';
    }
}

// 颜色选择器联动文本框（6 位 hex 才能写入文本框）
function onCopyReminderTextColorPickerChange(value) {
    const textInput = document.getElementById('copyReminderTextColor');
    if (textInput) textInput.value = value;
    onCopyReminderCfgChange('textColor', value);
}

// 清空颜色：文本框、选择器、draft 三方同步，并恢复"未设置"状态提示
function clearCopyReminderTextColor() {
    const textInput = document.getElementById('copyReminderTextColor');
    const picker = document.getElementById('copyReminderTextColorPicker');
    if (textInput) textInput.value = '';
    if (picker) picker.value = '#cccccc';
    onCopyReminderCfgChange('textColor', '');
}

async function saveCopyReminderConfig() {
    if (!hasPermission('settings.manage')) { showToast('无修改复制提醒配置权限', 'error'); return; }
    const draft = AdminState.copyReminderDraftConfig || AdminState.copyReminderConfig || {};
    const cfg = {
        enabled: !!draft.enabled,
        strategy: draft.strategy === 'always' ? 'always' : 'aged',
        thresholdDays: Number(draft.thresholdDays) || 30,
        message: (typeof draft.message === 'string' ? draft.message : '').trim() || COPY_REMINDER_DEFAULTS.message,
        displayMode: draft.displayMode === 'modal' ? 'modal' : 'toast',
        duration: Number(draft.duration) || 5000,
        showUpdatedAt: !!draft.showUpdatedAt,
        textColor: (typeof draft.textColor === 'string' ? draft.textColor.trim() : ''),
        fontSize: Number(draft.fontSize) || 0,
    };
    try {
        const r = await adminApiFetch('updateCopyReminderConfig', {
            method: 'POST',
            body: JSON.stringify({ config: cfg }),
        });
        if (r.status === 401) {
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        const j = await r.json();
        if (j.success) {
            AdminState.copyReminderConfig = j.config;
            AdminState.copyReminderDraftConfig = Object.assign({}, j.config);
            const status = document.getElementById('copyReminderCfgStatus');
            if (status) status.textContent = '✓ 已保存';
            showToast('复制提醒策略已保存', 'success');
        } else {
            showToast(j.error || '保存失败', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('网络错误', 'error');
    }
}

function resetCopyReminderConfig() {
    AdminState.copyReminderDraftConfig = Object.assign({}, COPY_REMINDER_DEFAULTS);
    if (!AdminState.copyReminderConfig) AdminState.copyReminderConfig = Object.assign({}, COPY_REMINDER_DEFAULTS);
    const status = document.getElementById('copyReminderCfgStatus');
    if (status) status.textContent = '已恢复默认值（需点击保存生效）';
    renderCopyReminderPanel(document.getElementById('basicSettingsBody'));
}

/* ========== 实时同步配置面板 ========== */
const SYNC_DEFAULTS = { enabled: false, interval: 5 };

async function renderSyncPanel(container) {
    const c = container || document.getElementById('adminContent');
    c.innerHTML = '<div class="loading-state"><div class="spinner"></div>加载实时同步设置...</div>';
    let cfg;
    try {
        const r = await adminApiFetch('getLibrarySettings');
        if (r.status === 401) { showToast('会话已过期，请重新登录', 'error'); setTimeout(() => location.reload(), 1500); return; }
        const j = await r.json();
        if (!j.success) { c.innerHTML = `<div class="empty-state"><div class="empty-text">${escapeHtml(j.error || '加载失败')}</div></div>`; return; }
        cfg = (j.sync && typeof j.sync === 'object') ? j.sync : Object.assign({}, SYNC_DEFAULTS);
    } catch (e) {
        c.innerHTML = '<div class="empty-state"><div class="empty-text">网络错误</div></div>';
        return;
    }
    AdminState.syncConfig = Object.assign({}, cfg);
    AdminState.syncDraftConfig = Object.assign({}, cfg);

    const canManage = hasPermission('settings.manage');
    const disabledAttr = canManage ? '' : 'disabled';

    c.innerHTML = `
    <div class="panel">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="refresh-cw" style="width:16px;height:16px;"></i> 实时数据同步</div>
            <label class="access-switch">
                <input type="checkbox" id="syncEnabled" ${cfg.enabled ? 'checked' : ''} onchange="onSyncCfgChange('enabled', this.checked)" ${disabledAttr}>
                <span class="access-switch-slider"></span>
            </label>
        </div>
        <div class="panel-body">
            <div class="access-status-row" style="margin-bottom:20px;">
                <span class="badge ${cfg.enabled ? 'badge-ok' : 'badge-err'}" id="syncStatusBadge">${cfg.enabled ? '已开启' : '已关闭'}</span>
                <span style="font-size:13px;color:var(--t3);margin-left:8px;">开启后，所有客户端按间隔轮询数据版本，检测到分类/文案/设置/公告变化时自动增量刷新</span>
            </div>

            <div class="form-row" style="margin-bottom:16px;">
                <label class="form-label">轮询间隔（秒）</label>
                <div style="display:flex;align-items:center;gap:10px;">
                    <input type="number" id="syncInterval" class="form-input" min="2" max="300" step="1" value="${cfg.interval}" onchange="onSyncCfgChange('interval', this.value)" ${disabledAttr} style="width:120px;">
                    <span style="font-size:13px;color:var(--t3);">范围 2~300 秒，默认 5 秒（值越小越实时，服务器压力越大）</span>
                </div>
            </div>

            <div style="margin-top:8px;padding:12px 14px;background:var(--bg-soft);border-radius:8px;font-size:13px;color:var(--t3);line-height:1.7;">
                <div><strong style="color:var(--t1);">工作原理</strong>：以各数据文件的修改时间作为版本号，轮询接口仅 stat 5 个文件（超轻量）；检测到变化时仅拉取对应数据类型，非全量拉取。</div>
                <div style="margin-top:6px;"><strong style="color:var(--t1);">编辑保护</strong>：用户打开编辑弹窗或拖拽排序时自动暂停刷新，关闭后下个周期补刷，避免覆盖未保存内容。</div>
                <div style="margin-top:6px;"><strong style="color:var(--t1);">关闭时</strong>：降频为 30 秒心跳，仅检测是否被重新开启，不刷新数据。</div>
            </div>

            <div style="margin-top:18px;display:flex;align-items:center;gap:12px;">
                ${canManage ? '<button class="btn btn-primary" onclick="saveSyncSettings()"><i data-feather="save" style="width:14px;height:14px;"></i> 保存配置</button>' : ''}
                <span class="dedup-config-status" id="syncCfgStatus"></span>
            </div>
        </div>
    </div>`;
    refreshFeatherIcons();
}

function onSyncCfgChange(field, value) {
    if (!AdminState.syncDraftConfig) AdminState.syncDraftConfig = Object.assign({}, SYNC_DEFAULTS);
    if (field === 'enabled') {
        AdminState.syncDraftConfig.enabled = !!value;
        // 更新开关旁的状态徽标
        const badge = document.getElementById('syncStatusBadge');
        if (badge) {
            badge.textContent = !!value ? '已开启' : '已关闭';
            badge.className = 'badge ' + (!!value ? 'badge-ok' : 'badge-err');
        }
    } else if (field === 'interval') {
        let n = parseInt(value, 10);
        if (isNaN(n)) n = 5;
        if (n < 2) n = 2;
        if (n > 300) n = 300;
        AdminState.syncDraftConfig.interval = n;
        const input = document.getElementById('syncInterval');
        if (input && parseInt(input.value, 10) !== n) input.value = n;
    }
    const status = document.getElementById('syncCfgStatus');
    if (status) {
        status.textContent = '已修改，点击「保存配置」生效';
        status.className = 'dedup-config-status changed';
    }
}

async function saveSyncSettings() {
    if (!hasPermission('settings.manage')) { showToast('无修改实时同步配置权限', 'error'); return; }
    const draft = AdminState.syncDraftConfig || AdminState.syncConfig || SYNC_DEFAULTS;
    const cfg = {
        enabled: !!draft.enabled,
        interval: Number(draft.interval) || 5,
    };
    try {
        const r = await adminApiFetch('updateSyncSettings', {
            method: 'POST',
            body: JSON.stringify({ enabled: cfg.enabled, interval: cfg.interval }),
        });
        if (r.status === 401) {
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        const j = await r.json();
        if (j.success) {
            AdminState.syncConfig = j.config;
            AdminState.syncDraftConfig = Object.assign({}, j.config);
            const status = document.getElementById('syncCfgStatus');
            if (status) {
                status.textContent = '✓ 已保存';
                status.className = 'dedup-config-status saved';
            }
            showToast('实时同步配置已保存', 'success');
        } else {
            showToast(j.error || '保存失败', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('网络错误', 'error');
    }
}

/* 访问保护面板（从 renderAccessControl 抽出，仅渲染文案库访问保护部分） */
async function renderAccessProtectionPanel(container) {
    const c = container || document.getElementById('adminContent');
    c.innerHTML = '<div class="loading-state"><div class="spinner"></div>加载访问保护设置...</div>';
    let status;
    try {
        const r = await adminApiFetch('getLibrarySettings');
        if (r.status === 401) { showToast('会话已过期，请重新登录', 'error'); setTimeout(() => location.reload(), 1500); return; }
        const j = await r.json();
        if (!j.success) { c.innerHTML = `<div class="empty-state"><div class="empty-text">${escapeHtml(j.error || '加载失败')}</div></div>`; return; }
        status = j;
    } catch (e) {
        c.innerHTML = '<div class="empty-state"><div class="empty-text">网络错误</div></div>';
        return;
    }
    const enabled = !!status.protectionEnabled;
    const allowGuest = !!status.allowGuestAccess;
    const authTimeout = Number.isFinite(status.authTimeout) ? status.authTimeout : 7200;
    const canManage = hasPermission('access.manage');

    const timeoutOptions = [
        { value: 1800, label: '30 分钟' }, { value: 3600, label: '1 小时' },
        { value: 7200, label: '2 小时' }, { value: 14400, label: '4 小时' },
        { value: 28800, label: '8 小时' }, { value: 86400, label: '24 小时' },
        { value: 0, label: '永不超时（直到关闭浏览器）' },
    ];
    const timeoutSelected = (v) => (Number(v) === authTimeout ? 'selected' : '');
    const timeoutDesc = authTimeout === 0
        ? '当前：永不超时（用户登录后，会话持续有效直到关闭浏览器）'
        : `当前：用户登录后，${formatTimeoutLabel(authTimeout)} 内无需重复登录`;

    c.innerHTML = `
    <div class="panel">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="lock" style="width:16px;height:16px;"></i> 文案库访问保护</div>
            <label class="access-switch">
                <input type="checkbox" id="libProtectionToggle" ${enabled ? 'checked' : ''} onchange="toggleLibraryProtection(this.checked)" ${!canManage ? 'disabled' : ''}>
                <span class="access-switch-slider"></span>
            </label>
        </div>
        <div class="panel-body">
            <div class="access-status-row" style="margin-bottom:${enabled ? '20px' : '0'};">
                <span class="badge ${enabled ? 'badge-ok' : 'badge-err'}">${enabled ? '已开启' : '已关闭'}</span>
                <span style="font-size:13px;color:var(--t3);margin-left:8px;">${enabled ? '用户需账户登录后才能访问文案库' : '任何人无需登录即可访问，按访客权限控制功能'}</span>
            </div>
            <div class="access-timeout-form" id="authTimeoutSection" style="${enabled ? '' : 'display:none;'}">
                <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label">单次登录有效期</label>
                    <div class="access-timeout-row">
                        <select id="libAuthTimeout" class="form-select" onchange="onLibraryTimeoutChange(this.value)">
                            ${timeoutOptions.map(opt => `<option value="${opt.value}" ${timeoutSelected(opt.value)}>${opt.label}</option>`).join('')}
                            ${timeoutOptions.some(opt => Number(opt.value) === authTimeout) ? '' : `<option value="${authTimeout}" selected>自定义（${formatTimeoutLabel(authTimeout)}）</option>`}
                        </select>
                        ${canManage ? '<button class="btn btn-primary" onclick="saveLibraryTimeout()">保存</button>' : ''}
                    </div>
                    <div class="access-timeout-desc" id="libTimeoutDesc">${escapeHtml(timeoutDesc)}</div>
                </div>
            </div>
            <div class="access-allow-guest-form" id="allowGuestSection" style="${enabled ? '' : 'display:none;'}">
                <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label">允许访客访问</label>
                    <div class="access-allow-guest-row">
                        <label class="access-switch">
                            <input type="checkbox" id="allowGuestToggle" ${allowGuest ? 'checked' : ''} onchange="toggleAllowGuestAccess(this.checked)" ${!canManage ? 'disabled' : ''}>
                            <span class="access-switch-slider"></span>
                        </label>
                        <span style="font-size:13px;color:var(--t3);margin-left:8px;">${allowGuest ? '已开启：未登录用户可按访客权限访问' : '已关闭：未登录用户无法访问'}</span>
                    </div>
                    <div class="access-allow-guest-desc" style="margin-top:8px;font-size:12px;color:var(--t3);line-height:1.6;">
                        开启后，未登录用户可以按照「访客权限」中设置的权限访问文案库，无需强制登录。关闭则未登录用户必须登录才能访问。
                    </div>
                </div>
            </div>
        </div>
    </div>`;
    refreshFeatherIcons();
}

/* 用户注册面板（从 renderAccessControl 抽出） */
async function renderRegisterPanel(container) {
    const c = container || document.getElementById('adminContent');
    c.innerHTML = '<div class="loading-state"><div class="spinner"></div>加载注册设置...</div>';
    let status;
    try {
        const r = await adminApiFetch('getLibrarySettings');
        if (r.status === 401) { showToast('会话已过期，请重新登录', 'error'); setTimeout(() => location.reload(), 1500); return; }
        const j = await r.json();
        if (!j.success) { c.innerHTML = `<div class="empty-state"><div class="empty-text">${escapeHtml(j.error || '加载失败')}</div></div>`; return; }
        status = j;
    } catch (e) {
        c.innerHTML = '<div class="empty-state"><div class="empty-text">网络错误</div></div>';
        return;
    }
    const registrationEnabled = !!status.registrationEnabled;
    const defaultRegisterRole = status.defaultRegisterRole || 'role_viewer';
    const registerRoles = Array.isArray(status.registerRoles) ? status.registerRoles : [
        { id: 'role_editor', name: '编辑员' }, { id: 'role_viewer', name: '访客' }
    ];
    const canManage = hasPermission('access.manage');

    c.innerHTML = `
    <div class="panel">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="user-plus" style="width:16px;height:16px;"></i> 用户注册</div>
            <label class="access-switch">
                <input type="checkbox" id="registrationToggle" ${registrationEnabled ? 'checked' : ''} onchange="toggleRegistrationEnabled(this.checked)" ${!canManage ? 'disabled' : ''}>
                <span class="access-switch-slider"></span>
            </label>
        </div>
        <div class="panel-body">
            <div class="access-status-row" style="margin-bottom:16px;">
                <span class="badge ${registrationEnabled ? 'badge-ok' : 'badge-err'}">${registrationEnabled ? '已开启' : '已关闭'}</span>
                <span style="font-size:13px;color:var(--t3);margin-left:8px;">${registrationEnabled ? '未登录用户可在登录弹窗中自主注册账户' : '前台登录弹窗不显示注册入口，仅管理员可创建用户'}</span>
            </div>
            <div class="form-group" style="margin-bottom:0;${registrationEnabled ? '' : 'opacity:0.5;pointer-events:none;'}">
                <label class="form-label">注册后默认身份</label>
                <div class="access-timeout-row">
                    <select id="defaultRegisterRoleSelect" class="form-select" onchange="onDefaultRegisterRoleChange(this.value)" ${!canManage ? 'disabled' : ''}>
                        ${registerRoles.map(r => `<option value="${escapeHtml(r.id)}" ${r.id === defaultRegisterRole ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}
                    </select>
                    ${canManage ? '<button class="btn btn-primary" onclick="saveDefaultRegisterRole()">保存</button>' : ''}
                </div>
                <div class="access-timeout-desc" id="defaultRegisterRoleDesc" style="margin-top:6px;">${escapeHtml(getDefaultRegisterRoleDesc(defaultRegisterRole, registerRoles))}</div>
                <div style="margin-top:8px;font-size:12px;color:var(--t3);line-height:1.6;">
                    新用户通过前台注册成功后，自动赋予此角色对应的权限。超级管理员角色不能作为注册默认身份。
                </div>
            </div>
        </div>
    </div>`;
    refreshFeatherIcons();
}

/* 访客权限面板（从 renderAccessControl 抽出） */
async function renderGuestPermPanel(container) {
    const c = container || document.getElementById('adminContent');
    c.innerHTML = '<div class="loading-state"><div class="spinner"></div>加载访客权限...</div>';
    let status;
    try {
        const r = await adminApiFetch('getLibrarySettings');
        if (r.status === 401) { showToast('会话已过期，请重新登录', 'error'); setTimeout(() => location.reload(), 1500); return; }
        const j = await r.json();
        if (!j.success) { c.innerHTML = `<div class="empty-state"><div class="empty-text">${escapeHtml(j.error || '加载失败')}</div></div>`; return; }
        status = j;
    } catch (e) {
        c.innerHTML = '<div class="empty-state"><div class="empty-text">网络错误</div></div>';
        return;
    }
    const enabled = !!status.protectionEnabled;
    const allowGuest = !!status.allowGuestAccess;
    const canManage = hasPermission('access.manage');
    const guestPermissions = Array.isArray(status.guestPermissions) ? status.guestPermissions : [];

    const guestPermGroups = [
        { title: '内容权限', icon: 'file-text', items: [
            { id: 'content.create', name: '新建文案', desc: '允许创建新的文案条目' },
            { id: 'content.edit', name: '编辑文案', desc: '允许修改已有文案内容' },
            { id: 'content.delete', name: '删除文案', desc: '允许删除文案条目' },
            { id: 'content.sort', name: '排序文案', desc: '允许拖拽调整文案顺序' },
            { id: 'content.share', name: '分享文案', desc: '允许创建和管理分享链接' },
        ]},
        { title: '分类权限', icon: 'folder', items: [
            { id: 'categories.manage', name: '管理分类', desc: '允许新增、编辑、删除分类' },
        ]},
        { title: '图片权限', icon: 'image', items: [
            { id: 'images.upload', name: '上传图片', desc: '允许上传图片到文案库' },
            { id: 'images.delete', name: '删除图片', desc: '允许删除文案中的图片' },
        ]},
        { title: 'AI 功能', icon: 'cpu', items: [
            { id: 'ai.use', name: '使用 AI', desc: '允许使用 AI 生成图片和视频' },
        ]},
        { title: '数据盘权限', icon: 'hard-drive', items: [
            { id: 'drive.view', name: '查看文件', desc: '允许浏览数据盘文件' },
            { id: 'drive.upload', name: '上传文件', desc: '允许上传文件到数据盘' },
            { id: 'drive.delete', name: '删除文件', desc: '允许删除数据盘文件' },
            { id: 'drive.rename', name: '重命名文件', desc: '允许重命名文件和文件夹' },
            { id: 'drive.move', name: '移动文件', desc: '允许移动文件到不同文件夹' },
            { id: 'drive.folder', name: '新建文件夹', desc: '允许创建新的文件夹' },
            { id: 'drive.share', name: '分享文件', desc: '允许创建和管理文件分享链接' },
        ]},
    ];
    const guestPermChecked = (permId) => guestPermissions.includes(permId) ? 'checked' : '';

    c.innerHTML = `
    <div class="panel" id="guestPermPanel" style="${!enabled || (enabled && allowGuest) ? '' : 'opacity:0.5;pointer-events:none;'}">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="users" style="width:16px;height:16px;"></i> 访客权限配置</div>
            <div class="panel-head-actions">
                <button class="btn btn-default btn-sm" onclick="setAllGuestPerms(true)" ${!canManage ? 'disabled' : ''}>全选</button>
                <button class="btn btn-default btn-sm" onclick="setAllGuestPerms(false)" ${!canManage ? 'disabled' : ''}>清空</button>
                ${canManage ? '<button class="btn btn-primary btn-sm" id="saveGuestPermBtn" onclick="saveGuestPermissions()">保存</button>' : ''}
            </div>
        </div>
        <div class="panel-body">
            <div class="access-pwd-hint" style="margin-bottom:16px;">
                访问保护<strong>关闭</strong>时生效，或访问保护<strong>开启</strong>且<strong>允许访客访问</strong>时生效，控制未登录访客可使用的功能。开启访问保护且不允许访客访问时，此项不生效，按账户角色权限控制。
            </div>
            <div class="guest-perm-groups">
                ${guestPermGroups.map(group => `
                    <div class="guest-perm-group">
                        <div class="guest-perm-group-head">
                            <i data-feather="${group.icon}" style="width:14px;height:14px;"></i>
                            <span>${group.title}</span>
                            <label class="guest-perm-group-toggle">
                                <input type="checkbox" onchange="toggleGuestPermGroup(this, '${group.items.map(i=>i.id).join(',')}')"
                                    ${group.items.every(i => guestPermissions.includes(i.id)) ? 'checked' : ''}
                                    ${!canManage ? 'disabled' : ''}>
                                <span>全选</span>
                            </label>
                        </div>
                        <div class="guest-perm-list">
                            ${group.items.map(item => `
                                <label class="guest-perm-item">
                                    <input type="checkbox" class="guest-perm-checkbox" data-perm="${item.id}"
                                        ${guestPermChecked(item.id)}
                                        ${!canManage ? 'disabled' : ''}>
                                    <div class="guest-perm-info">
                                        <div class="guest-perm-name">${item.name}</div>
                                        <div class="guest-perm-desc">${item.desc}</div>
                                    </div>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    </div>`;
    refreshFeatherIcons();
}

/* ========== 访问控制（保留兼容旧入口，整体渲染所有访问控制面板） ========== */
async function renderAccessControl(targetContainer) {
    const c = targetContainer || document.getElementById('adminContent');
    c.innerHTML = '<div class="loading-state"><div class="spinner"></div>加载访问控制设置...</div>';

    let status;
    try {
        const r = await adminApiFetch('getLibrarySettings');
        if (r.status === 401) {
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        const j = await r.json();
        if (!j.success) {
            c.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-feather="alert-triangle" style="width:48px;height:48px;"></i></div><div class="empty-text">${escapeHtml(j.error || '加载失败')}</div></div>`;
            return;
        }
        status = j;
    } catch (e) {
        c.innerHTML = '<div class="empty-state"><div class="empty-icon"><i data-feather="alert-triangle" style="width:48px;height:48px;"></i></div><div class="empty-text">网络错误</div></div>';
        return;
    }

    const enabled = !!status.protectionEnabled;
    const allowGuest = !!status.allowGuestAccess;
    const authTimeout = Number.isFinite(status.authTimeout) ? status.authTimeout : 7200;
    const canManage = hasPermission('access.manage');
    const guestPermissions = Array.isArray(status.guestPermissions) ? status.guestPermissions : [];
    const registrationEnabled = !!status.registrationEnabled;
    const defaultRegisterRole = status.defaultRegisterRole || 'role_viewer';
    const registerRoles = Array.isArray(status.registerRoles) ? status.registerRoles : [
        { id: 'role_editor', name: '编辑员' },
        { id: 'role_viewer', name: '访客' }
    ];

    // 访客权限分组定义
    const guestPermGroups = [
        {
            title: '内容权限',
            icon: 'file-text',
            items: [
                { id: 'content.create', name: '新建文案', desc: '允许创建新的文案条目' },
                { id: 'content.edit', name: '编辑文案', desc: '允许修改已有文案内容' },
                { id: 'content.delete', name: '删除文案', desc: '允许删除文案条目' },
                { id: 'content.sort', name: '排序文案', desc: '允许拖拽调整文案顺序' },
                { id: 'content.share', name: '分享文案', desc: '允许创建和管理分享链接' },
            ]
        },
        {
            title: '分类权限',
            icon: 'folder',
            items: [
                { id: 'categories.manage', name: '管理分类', desc: '允许新增、编辑、删除分类' },
            ]
        },
        {
            title: '图片权限',
            icon: 'image',
            items: [
                { id: 'images.upload', name: '上传图片', desc: '允许上传图片到文案库' },
                { id: 'images.delete', name: '删除图片', desc: '允许删除文案中的图片' },
            ]
        },
        {
            title: 'AI 功能',
            icon: 'cpu',
            items: [
                { id: 'ai.use', name: '使用 AI', desc: '允许使用 AI 生成图片和视频' },
            ]
        },
        {
            title: '数据盘权限',
            icon: 'hard-drive',
            items: [
                { id: 'drive.view', name: '查看文件', desc: '允许浏览数据盘文件' },
                { id: 'drive.upload', name: '上传文件', desc: '允许上传文件到数据盘' },
                { id: 'drive.delete', name: '删除文件', desc: '允许删除数据盘文件' },
                { id: 'drive.rename', name: '重命名文件', desc: '允许重命名文件和文件夹' },
                { id: 'drive.move', name: '移动文件', desc: '允许移动文件到不同文件夹' },
                { id: 'drive.folder', name: '新建文件夹', desc: '允许创建新的文件夹' },
                { id: 'drive.share', name: '分享文件', desc: '允许创建和管理文件分享链接' },
            ]
        },
    ];

    const guestPermChecked = (permId) => guestPermissions.includes(permId) ? 'checked' : '';

    // 超时选项（秒）：0=永不超时；其余为常用预设
    const timeoutOptions = [
        { value: 1800, label: '30 分钟' },
        { value: 3600, label: '1 小时' },
        { value: 7200, label: '2 小时' },
        { value: 14400, label: '4 小时' },
        { value: 28800, label: '8 小时' },
        { value: 86400, label: '24 小时' },
        { value: 0, label: '永不超时（直到关闭浏览器）' },
    ];
    const timeoutSelected = (v) => (Number(v) === authTimeout ? 'selected' : '');
    const timeoutDesc = authTimeout === 0
        ? '当前：永不超时（用户登录后，会话持续有效直到关闭浏览器）'
        : `当前：用户登录后，${formatTimeoutLabel(authTimeout)} 内无需重复登录`;

    const html = `
    <div class="panel">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="lock" style="width:16px;height:16px;"></i> 文案库访问保护</div>
            <label class="access-switch">
                <input type="checkbox" id="libProtectionToggle" ${enabled ? 'checked' : ''} onchange="toggleLibraryProtection(this.checked)" ${!canManage ? 'disabled' : ''}>
                <span class="access-switch-slider"></span>
            </label>
        </div>
        <div class="panel-body">
            <div class="access-status-row" style="margin-bottom:${enabled ? '20px' : '0'};">
                <span class="badge ${enabled ? 'badge-ok' : 'badge-err'}">${enabled ? '已开启' : '已关闭'}</span>
                <span style="font-size:13px;color:var(--t3);margin-left:8px;">${enabled ? '用户需账户登录后才能访问文案库' : '任何人无需登录即可访问，按下方访客权限控制功能'}</span>
            </div>

            <div class="access-timeout-form" id="authTimeoutSection" style="${enabled ? '' : 'display:none;'}">
                <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label">单次登录有效期</label>
                    <div class="access-timeout-row">
                        <select id="libAuthTimeout" class="form-select" onchange="onLibraryTimeoutChange(this.value)">
                            ${timeoutOptions.map(opt => `<option value="${opt.value}" ${timeoutSelected(opt.value)}>${opt.label}</option>`).join('')}
                            ${timeoutOptions.some(opt => Number(opt.value) === authTimeout) ? '' : `<option value="${authTimeout}" selected>自定义（${formatTimeoutLabel(authTimeout)}）</option>`}
                        </select>
                        ${canManage ? '<button class="btn btn-primary" onclick="saveLibraryTimeout()">保存</button>' : ''}
                    </div>
                    <div class="access-timeout-desc" id="libTimeoutDesc">${escapeHtml(timeoutDesc)}</div>
                </div>
            </div>

            <div class="access-allow-guest-form" id="allowGuestSection" style="${enabled ? '' : 'display:none;'}">
                <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label">允许访客访问</label>
                    <div class="access-allow-guest-row">
                        <label class="access-switch">
                            <input type="checkbox" id="allowGuestToggle" ${allowGuest ? 'checked' : ''} onchange="toggleAllowGuestAccess(this.checked)" ${!canManage ? 'disabled' : ''}>
                            <span class="access-switch-slider"></span>
                        </label>
                        <span style="font-size:13px;color:var(--t3);margin-left:8px;">${allowGuest ? '已开启：未登录用户可按访客权限访问' : '已关闭：未登录用户无法访问'}</span>
                    </div>
                    <div class="access-allow-guest-desc" style="margin-top:8px;font-size:12px;color:var(--t3);line-height:1.6;">
                        开启后，未登录用户可以按照下方「访客权限配置」中设置的权限访问文案库，无需强制登录。关闭则未登录用户必须登录才能访问。
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="panel">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="user-plus" style="width:16px;height:16px;"></i> 用户注册</div>
            <label class="access-switch">
                <input type="checkbox" id="registrationToggle" ${registrationEnabled ? 'checked' : ''} onchange="toggleRegistrationEnabled(this.checked)" ${!canManage ? 'disabled' : ''}>
                <span class="access-switch-slider"></span>
            </label>
        </div>
        <div class="panel-body">
            <div class="access-status-row" style="margin-bottom:16px;">
                <span class="badge ${registrationEnabled ? 'badge-ok' : 'badge-err'}">${registrationEnabled ? '已开启' : '已关闭'}</span>
                <span style="font-size:13px;color:var(--t3);margin-left:8px;">${registrationEnabled ? '未登录用户可在登录弹窗中自主注册账户' : '前台登录弹窗不显示注册入口，仅管理员可创建用户'}</span>
            </div>
            <div class="form-group" style="margin-bottom:0;${registrationEnabled ? '' : 'opacity:0.5;pointer-events:none;'}">
                <label class="form-label">注册后默认身份</label>
                <div class="access-timeout-row">
                    <select id="defaultRegisterRoleSelect" class="form-select" onchange="onDefaultRegisterRoleChange(this.value)" ${!canManage ? 'disabled' : ''}>
                        ${registerRoles.map(r => `<option value="${escapeHtml(r.id)}" ${r.id === defaultRegisterRole ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}
                    </select>
                    ${canManage ? '<button class="btn btn-primary" onclick="saveDefaultRegisterRole()">保存</button>' : ''}
                </div>
                <div class="access-timeout-desc" id="defaultRegisterRoleDesc" style="margin-top:6px;">${escapeHtml(getDefaultRegisterRoleDesc(defaultRegisterRole, registerRoles))}</div>
                <div style="margin-top:8px;font-size:12px;color:var(--t3);line-height:1.6;">
                    新用户通过前台注册成功后，自动赋予此角色对应的权限。超级管理员角色不能作为注册默认身份。
                </div>
            </div>
        </div>
    </div>

    <div class="panel" id="guestPermPanel" style="${!enabled || (enabled && allowGuest) ? '' : 'opacity:0.5;pointer-events:none;'}">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="users" style="width:16px;height:16px;"></i> 访客权限配置</div>
            <div class="panel-head-actions">
                <button class="btn btn-default btn-sm" onclick="setAllGuestPerms(true)" ${!canManage ? 'disabled' : ''}>全选</button>
                <button class="btn btn-default btn-sm" onclick="setAllGuestPerms(false)" ${!canManage ? 'disabled' : ''}>清空</button>
                ${canManage ? '<button class="btn btn-primary btn-sm" id="saveGuestPermBtn" onclick="saveGuestPermissions()">保存</button>' : ''}
            </div>
        </div>
        <div class="panel-body">
            <div class="access-pwd-hint" style="margin-bottom:16px;">
                访问保护<strong>关闭</strong>时生效，或访问保护<strong>开启</strong>且<strong>允许访客访问</strong>时生效，控制未登录访客可使用的功能。开启访问保护且不允许访客访问时，此项不生效，按账户角色权限控制。
            </div>
            <div class="guest-perm-groups">
                ${guestPermGroups.map(group => `
                    <div class="guest-perm-group">
                        <div class="guest-perm-group-head">
                            <i data-feather="${group.icon}" style="width:14px;height:14px;"></i>
                            <span>${group.title}</span>
                            <label class="guest-perm-group-toggle">
                                <input type="checkbox" onchange="toggleGuestPermGroup(this, '${group.items.map(i=>i.id).join(',')}')"
                                    ${group.items.every(i => guestPermissions.includes(i.id)) ? 'checked' : ''}
                                    ${!canManage ? 'disabled' : ''}>
                                <span>全选</span>
                            </label>
                        </div>
                        <div class="guest-perm-list">
                            ${group.items.map(item => `
                                <label class="guest-perm-item">
                                    <input type="checkbox" class="guest-perm-checkbox" data-perm="${item.id}"
                                        ${guestPermChecked(item.id)}
                                        ${!canManage ? 'disabled' : ''}>
                                    <div class="guest-perm-info">
                                        <div class="guest-perm-name">${item.name}</div>
                                        <div class="guest-perm-desc">${item.desc}</div>
                                    </div>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    </div>
    `;
    c.innerHTML = html;
    refreshFeatherIcons();
}

/**
 * 将秒数格式化为人类可读的有效期描述
 * @param {number} seconds
 * @returns {string}
 */
function formatTimeoutLabel(seconds) {
    seconds = Number(seconds);
    if (!Number.isFinite(seconds) || seconds < 0) return '2 小时';
    if (seconds === 0) return '永不超时';
    if (seconds < 60) return `${seconds} 秒`;
    if (seconds < 3600) {
        const m = Math.round(seconds / 60);
        return `${m} 分钟`;
    }
    if (seconds < 86400) {
        const h = Math.round(seconds / 3600);
        return `${h} 小时`;
    }
    const d = Math.round(seconds / 86400);
    return `${d} 天`;
}

/**
 * 下拉框变化时实时更新描述文案（保存前预览）
 */
function onLibraryTimeoutChange(value) {
    const desc = document.getElementById('libTimeoutDesc');
    if (!desc) return;
    const sec = Number(value);
    const text = sec === 0
        ? '当前：永不超时（用户通过密码验证后，会话持续有效直到关闭浏览器）'
        : `当前：用户通过密码验证后，${formatTimeoutLabel(sec)} 内无需重复输入`;
    desc.textContent = text;
}

/**
 * 保存单次访问有效期
 */
async function saveLibraryTimeout() {
    if (!hasPermission('access.manage')) { showToast('无管理访问控制权限', 'error'); return; }
    const sel = document.getElementById('libAuthTimeout');
    if (!sel) return;
    const timeout = Number(sel.value);
    if (!Number.isFinite(timeout) || timeout < 0) {
        showToast('无效的有效期', 'error');
        return;
    }

    const ok = await showConfirm(`确定要将单次访问有效期设置为「${formatTimeoutLabel(timeout)}」吗？`, 'clock');
    if (!ok) return;

    try {
        const r = await adminApiFetch('updateLibraryTimeout', {
            method: 'POST',
            body: JSON.stringify({ timeout }),
        });
        if (r.status === 401) {
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        const j = await r.json();
        if (j.success) {
            showToast(`已设置单次访问有效期为「${formatTimeoutLabel(timeout)}」`, 'success');
        } else {
            showToast(j.error || '保存失败', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('网络错误', 'error');
    }
}

/* ========== 外观设置（菜单布局） ========== */
async function renderAppearance(targetContainer) {
    const c = targetContainer || document.getElementById('basicSettingsBody') || document.getElementById('adminContent');
    c.innerHTML = '<div class="loading-state"><div class="spinner"></div>加载外观设置...</div>';

    let status;
    try {
        const r = await adminApiFetch('getLibrarySettings');
        if (r.status === 401) {
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        const j = await r.json();
        if (!j.success) {
            c.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-feather="alert-triangle" style="width:48px;height:48px;"></i></div><div class="empty-text">${escapeHtml(j.error || '加载失败')}</div></div>`;
            return;
        }
        status = j;
    } catch (e) {
        c.innerHTML = '<div class="empty-state"><div class="empty-icon"><i data-feather="alert-triangle" style="width:48px;height:48px;"></i></div><div class="empty-text">网络错误</div></div>';
        return;
    }

    const currentLayout = status.layout === 'top-tabs' ? 'top-tabs' : 'sidebar';
    const canManage = hasPermission('appearance.manage');
    const previewSegmentDefault = !!status.previewSegmentDefault;
    const greetingQuotes = Array.isArray(status.greetingQuotes) ? status.greetingQuotes : [];

    const layouts = [
        {
            id: 'sidebar',
            name: '侧边栏布局',
            desc: '分类以左侧树形菜单展示，适合层级较多、需要常驻可见的场景',
            preview: 'sidebar',
        },
        {
            id: 'top-tabs',
            name: '顶部标签布局',
            desc: '一级分类作为顶部标签，二级分类作为左侧子列表，适合一级分类较少的场景',
            preview: 'top-tabs',
        },
    ];

    const layoutCards = layouts.map(l => `
        <div class="layout-card ${currentLayout === l.id ? 'active' : ''}" data-layout="${l.id}" onclick="${canManage ? `selectAdminLayout('${l.id}')` : ''}">
            <div class="layout-card-preview layout-preview-${l.preview}">
                ${renderLayoutPreview(l.preview)}
            </div>
            <div class="layout-card-info">
                <div class="layout-card-name">
                    <span>${escapeHtml(l.name)}</span>
                    ${currentLayout === l.id ? '<span class="badge badge-ok">当前</span>' : ''}
                </div>
                <div class="layout-card-desc">${escapeHtml(l.desc)}</div>
            </div>
            <div class="layout-card-radio">
                <input type="radio" name="adminLayout" value="${l.id}" ${currentLayout === l.id ? 'checked' : ''} ${!canManage ? 'disabled' : ''}>
            </div>
        </div>
    `).join('');

    const html = `
    <div class="panel">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="layout" style="width:16px;height:16px;"></i> 菜单布局样式</div>
        </div>
        <div class="panel-body">
            <div class="appearance-intro">
                选择文案库前台的默认菜单布局，作为所有用户首次访问时的默认样式。
                用户在前台可自行切换布局（保存在浏览器本地）；<strong>修改此处默认布局后，所有用户下次访问将重置为新默认值</strong>，用户仍可再次自行切换。
            </div>
            <div class="layout-card-list">
                ${layoutCards}
            </div>
            <div class="appearance-actions">
                ${canManage ? `<button class="btn btn-primary" id="saveLayoutBtn" onclick="saveAdminLayout()" disabled>
                    <i data-feather="save" style="width:14px;height:14px;"></i> 保存布局设置
                </button>` : '<span style="color:var(--t3);font-size:12px;"><i data-feather="lock" style="width:12px;height:12px;vertical-align:middle;"></i> 无权限修改外观设置</span>'}
                <span class="appearance-status" id="appearanceStatus"></span>
            </div>
            <div class="access-pwd-hint">
                • 侧边栏布局：左侧树形菜单，支持分类搜索、收藏夹快捷入口，适合大量分类管理<br>
                • 顶部标签布局：顶部一级分类标签 + 左侧二级子分类列表，视觉简洁<br>
                • 用户在前台可自行切换布局，个人偏好保存在浏览器 localStorage 中<br>
                • 修改默认布局后，所有用户下次访问将应用新默认布局（重置其本地偏好）
            </div>
        </div>
    </div>

    <div class="panel">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="layers" style="width:16px;height:16px;"></i> 预览分段展示</div>
        </div>
        <div class="panel-body">
            <div class="dedup-config-form">
                <div class="dedup-config-row">
                    <div class="access-info">
                        <div class="access-title">默认以分段模式展示文案</div>
                        <div class="access-desc">开启后，用户在前台点击文案预览时，默认进入分段视图（按段落拆分为卡片，可单独复制每段）；关闭则默认展示完整内容，用户仍可手动点击「分段」按钮切换</div>
                    </div>
                    <label class="access-switch">
                        <input type="checkbox" id="previewSegmentDefaultToggle" ${previewSegmentDefault ? 'checked' : ''} onchange="onPreviewSegmentDefaultChange(this.checked)" ${!canManage ? 'disabled' : ''}>
                        <span class="access-switch-slider"></span>
                    </label>
                </div>
                <div class="dedup-config-actions">
                    <span class="dedup-config-status" id="previewSegmentStatus"></span>
                </div>
                <div class="access-pwd-hint">
                    • 开启：预览弹窗默认分段展示，适合销售话术等需要逐段发送的场景<br>
                    • 关闭：预览弹窗默认展示完整文案（保留原有行为）<br>
                    • 无论开启或关闭，用户均可在预览弹窗底部点击「分段」按钮手动切换
                </div>
            </div>
        </div>
    </div>

    <div class="panel">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="message-circle" style="width:16px;height:16px;"></i> 前台问候语录</div>
        </div>
        <div class="panel-body">
            <div class="appearance-intro">
                自定义文案库前台顶栏问候区展示的小语录，每行一条，每次刷新随机显示一条。
                <strong>留空则使用系统内置的分时段语录</strong>（早中晚各不相同）。
            </div>
            <textarea id="greetingQuotesInput" class="form-input" rows="14" ${!canManage ? 'disabled' : ''}
                placeholder="每行一条语录，例如：&#10;专注一小时，胜过忙碌一整天&#10;好文案是改出来的，动手吧"
                style="width:100%;resize:vertical;font-size:13px;line-height:1.8;min-height:280px;"
                oninput="onGreetingQuotesInput()">${escapeHtml(greetingQuotes.join('\n'))}</textarea>
            <div class="appearance-actions">
                ${canManage ? `<button class="btn btn-primary" id="saveGreetingQuotesBtn" onclick="saveGreetingQuotes()" disabled>
                    <i data-feather="save" style="width:14px;height:14px;"></i> 保存问候语录
                </button>` : '<span style="color:var(--t3);font-size:12px;"><i data-feather="lock" style="width:12px;height:12px;vertical-align:middle;"></i> 无权限修改外观设置</span>'}
                <span class="appearance-status" id="greetingQuotesStatus"></span>
            </div>
            <div class="access-pwd-hint">
                • 每行一条，空行自动忽略；单条最长 60 字，最多 50 条<br>
                • 保存后前台用户刷新页面即可看到新语录<br>
                • 清空全部内容并保存 = 恢复系统内置的分时段语录
            </div>
        </div>
    </div>
    `;
    c.innerHTML = html;
    refreshFeatherIcons();
}

/**
 * 分段默认展示开关变更：立即保存
 */
async function onPreviewSegmentDefaultChange(enabled) {
    if (!hasPermission('appearance.manage')) {
        showToast('无管理外观设置权限', 'error');
        // 还原开关状态
        const toggle = document.getElementById('previewSegmentDefaultToggle');
        if (toggle) toggle.checked = !enabled;
        return;
    }
    try {
        const r = await adminApiFetch('updatePreviewSegmentDefault', {
            method: 'POST',
            body: JSON.stringify({ enabled: !!enabled }),
        });
        if (r.status === 401) {
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        const j = await r.json();
        if (j.success) {
            showToast(`已${enabled ? '开启' : '关闭'}默认分段展示`, 'success');
            const statusEl = document.getElementById('previewSegmentStatus');
            if (statusEl) {
                statusEl.textContent = '✓ 已保存';
                statusEl.className = 'dedup-config-status saved';
            }
        } else {
            showToast(j.error || '保存失败', 'error');
            // 还原开关状态
            const toggle = document.getElementById('previewSegmentDefaultToggle');
            if (toggle) toggle.checked = !enabled;
        }
    } catch (e) {
        console.error(e);
        showToast('网络错误', 'error');
        const toggle = document.getElementById('previewSegmentDefaultToggle');
        if (toggle) toggle.checked = !enabled;
    }
}

/**
 * 问候语录输入变更：启用保存按钮
 */
function onGreetingQuotesInput() {
    const saveBtn = document.getElementById('saveGreetingQuotesBtn');
    if (saveBtn) saveBtn.disabled = false;
    const statusEl = document.getElementById('greetingQuotesStatus');
    if (statusEl) {
        statusEl.textContent = '已修改，点击「保存问候语录」生效';
        statusEl.className = 'appearance-status changed';
    }
}

/**
 * 保存前台问候语录到后端
 */
async function saveGreetingQuotes() {
    if (!hasPermission('appearance.manage')) { showToast('无管理外观设置权限', 'error'); return; }
    const input = document.getElementById('greetingQuotesInput');
    if (!input) return;
    const quotes = input.value.split('\n').map(s => s.trim()).filter(s => s !== '');
    if (quotes.length > 50) {
        showToast('语录最多 50 条，请精简后再保存', 'error');
        return;
    }
    if (quotes.some(q => q.length > 60)) {
        showToast('单条语录最长 60 字，超长部分将被截断', 'info');
    }
    try {
        const r = await adminApiFetch('updateGreetingQuotes', {
            method: 'POST',
            body: JSON.stringify({ quotes }),
        });
        if (r.status === 401) {
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        const j = await r.json();
        if (j.success) {
            const saved = Array.isArray(j.greetingQuotes) ? j.greetingQuotes : quotes;
            showToast(saved.length > 0 ? `已保存 ${saved.length} 条问候语录` : '已清空，恢复系统内置语录', 'success');
            input.value = saved.join('\n');
            const saveBtn = document.getElementById('saveGreetingQuotesBtn');
            if (saveBtn) saveBtn.disabled = true;
            const statusEl = document.getElementById('greetingQuotesStatus');
            if (statusEl) {
                statusEl.textContent = '已保存';
                statusEl.className = 'appearance-status saved';
            }
        } else {
            showToast(j.error || '保存失败', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('网络错误', 'error');
    }
}

/**
 * 渲染布局预览图（纯 CSS 缩略图）
 */
function renderLayoutPreview(type) {
    if (type === 'sidebar') {
        return `
            <div class="lp-window">
                <div class="lp-sidebar">
                    <div class="lp-line lp-w"></div>
                    <div class="lp-line"></div>
                    <div class="lp-line"></div>
                    <div class="lp-line lp-active"></div>
                    <div class="lp-line"></div>
                    <div class="lp-line lp-w"></div>
                    <div class="lp-line"></div>
                </div>
                <div class="lp-main">
                    <div class="lp-line lp-w"></div>
                    <div class="lp-grid"></div>
                </div>
            </div>
        `;
    }
    // top-tabs
    return `
        <div class="lp-window">
            <div class="lp-tabs">
                <div class="lp-tab lp-active"></div>
                <div class="lp-tab"></div>
                <div class="lp-tab"></div>
                <div class="lp-tab"></div>
            </div>
            <div class="lp-body">
                <div class="lp-sublist">
                    <div class="lp-line lp-w"></div>
                    <div class="lp-line lp-active"></div>
                    <div class="lp-line"></div>
                    <div class="lp-line"></div>
                </div>
                <div class="lp-main">
                    <div class="lp-line lp-w"></div>
                    <div class="lp-grid"></div>
                </div>
            </div>
        </div>
    `;
}

/**
 * 在外观视图中选择布局（仅 UI 高亮，未保存）
 */
function selectAdminLayout(layoutId) {
    document.querySelectorAll('.layout-card').forEach(card => {
        const isActive = card.dataset.layout === layoutId;
        card.classList.toggle('active', isActive);
        const radio = card.querySelector('input[type="radio"]');
        if (radio) radio.checked = isActive;
    });
    // 启用保存按钮
    const saveBtn = document.getElementById('saveLayoutBtn');
    if (saveBtn) saveBtn.disabled = false;
    // 状态提示
    const statusEl = document.getElementById('appearanceStatus');
    if (statusEl) {
        statusEl.textContent = '已选择，点击「保存布局设置」生效';
        statusEl.className = 'appearance-status changed';
    }
}

/**
 * 获取当前 UI 选中的布局
 */
function getSelectedAdminLayout() {
    const checked = document.querySelector('.layout-card input[type="radio"]:checked');
    return checked ? checked.value : null;
}

/**
 * 保存默认菜单布局到后端
 */
async function saveAdminLayout() {
    if (!hasPermission('appearance.manage')) { showToast('无管理外观设置权限', 'error'); return; }
    const layout = getSelectedAdminLayout();
    if (!layout) {
        showToast('请先选择一个布局', 'error');
        return;
    }
    if (!['sidebar', 'top-tabs'].includes(layout)) {
        showToast('无效的布局类型', 'error');
        return;
    }

    const ok = await showConfirm(`确定将默认菜单布局设置为「${layout === 'sidebar' ? '侧边栏布局' : '顶部标签布局'}」吗？`, 'layout');
    if (!ok) return;

    try {
        const r = await adminApiFetch('updateLayout', {
            method: 'POST',
            body: JSON.stringify({ layout }),
        });
        if (r.status === 401) {
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        const j = await r.json();
        if (j.success) {
            showToast(`已设置默认布局为「${layout === 'sidebar' ? '侧边栏布局' : '顶部标签布局'}」`, 'success');
            // 更新当前标记
            document.querySelectorAll('.layout-card').forEach(card => {
                const nameEl = card.querySelector('.layout-card-name');
                if (!nameEl) return;
                const existingBadge = nameEl.querySelector('.badge');
                if (existingBadge) existingBadge.remove();
                if (card.dataset.layout === layout) {
                    const badge = document.createElement('span');
                    badge.className = 'badge badge-ok';
                    badge.textContent = '当前';
                    nameEl.appendChild(badge);
                }
            });
            const saveBtn = document.getElementById('saveLayoutBtn');
            if (saveBtn) saveBtn.disabled = true;
            const statusEl = document.getElementById('appearanceStatus');
            if (statusEl) {
                statusEl.textContent = '已保存';
                statusEl.className = 'appearance-status saved';
            }
        } else {
            showToast(j.error || '保存失败', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('网络错误', 'error');
    }
}

async function toggleLibraryProtection(enabled) {
    if (!hasPermission('access.manage')) { showToast('无管理访问控制权限', 'error'); return; }
    try {
        const r = await adminApiFetch('updateLibraryProtection', {
            method: 'POST',
            body: JSON.stringify({ enabled }),
        });
        if (r.status === 401) {
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        const j = await r.json();
        if (j.success) {
            showToast(enabled ? '已开启文案库访问保护' : '已关闭文案库访问保护', 'success');
            // 更新状态徽章
            const statusRow = document.querySelector('.access-status-row');
            if (statusRow) {
                statusRow.style.marginBottom = enabled ? '20px' : '0';
                statusRow.innerHTML = `
                    <span class="badge ${j.protectionEnabled ? 'badge-ok' : 'badge-err'}">${j.protectionEnabled ? '已开启' : '已关闭'}</span>
                    <span style="font-size:13px;color:var(--t3);margin-left:8px;">${j.protectionEnabled ? '用户需账户登录后才能访问文案库' : '任何人无需登录即可访问，按下方访客权限控制功能'}</span>
                `;
            }
            // 切换有效期区块显示
            const timeoutSection = document.getElementById('authTimeoutSection');
            if (timeoutSection) timeoutSection.style.display = j.protectionEnabled ? '' : 'none';
            // 切换允许访客访问区块显示
            const allowGuestSection = document.getElementById('allowGuestSection');
            if (allowGuestSection) allowGuestSection.style.display = j.protectionEnabled ? '' : 'none';
            // 切换访客权限面板状态
            const guestPanel = document.getElementById('guestPermPanel');
            if (guestPanel) {
                // 保护关闭时启用;保护开启时,如果允许访客访问则启用,否则禁用
                const allowGuestToggle = document.getElementById('allowGuestToggle');
                const isAllowGuest = allowGuestToggle ? allowGuestToggle.checked : false;
                const shouldDisable = j.protectionEnabled && !isAllowGuest;
                guestPanel.style.opacity = shouldDisable ? '0.5' : '';
                guestPanel.style.pointerEvents = shouldDisable ? 'none' : '';
            }
        } else {
            showToast(j.error || '操作失败', 'error');
            // 回滚开关
            const toggle = document.getElementById('libProtectionToggle');
            if (toggle) toggle.checked = !enabled;
        }
    } catch (e) {
        console.error(e);
        showToast('网络错误', 'error');
        const toggle = document.getElementById('libProtectionToggle');
        if (toggle) toggle.checked = !enabled;
    }
}

/**
 * 切换允许访客访问开关
 */
async function toggleAllowGuestAccess(allowGuest) {
    if (!hasPermission('access.manage')) { showToast('无管理访问控制权限', 'error'); return; }
    try {
        const r = await adminApiFetch('updateAllowGuestAccess', {
            method: 'POST',
            body: JSON.stringify({ allowGuest }),
        });
        if (r.status === 401) {
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        const j = await r.json();
        if (j.success) {
            showToast(allowGuest ? '已开启允许访客访问' : '已关闭允许访客访问', 'success');
            // 更新访客权限面板状态
            const guestPanel = document.getElementById('guestPermPanel');
            if (guestPanel) {
                guestPanel.style.opacity = allowGuest ? '' : '0.5';
                guestPanel.style.pointerEvents = allowGuest ? '' : 'none';
            }
        } else {
            showToast(j.error || '操作失败', 'error');
            // 回滚开关
            const toggle = document.getElementById('allowGuestToggle');
            if (toggle) toggle.checked = !allowGuest;
        }
    } catch (e) {
        console.error(e);
        showToast('网络错误', 'error');
        const toggle = document.getElementById('allowGuestToggle');
        if (toggle) toggle.checked = !allowGuest;
    }
}

/**
 * 根据角色 ID 从 registerRoles 列表中查找角色名
 */
function getDefaultRegisterRoleDesc(roleId, roles) {
    if (!Array.isArray(roles)) return '';
    const r = roles.find(x => x.id === roleId);
    return r ? ('当前：' + r.name + '（注册后获得此角色权限）') : '';
}

/**
 * 注册默认角色下拉框变化时实时更新描述（保存前预览）
 */
function onDefaultRegisterRoleChange(value) {
    const desc = document.getElementById('defaultRegisterRoleDesc');
    if (!desc) return;
    const sel = document.getElementById('defaultRegisterRoleSelect');
    if (!sel) return;
    const selected = sel.options[sel.selectedIndex];
    const name = selected ? selected.textContent : value;
    desc.textContent = '当前：' + name + '（注册后获得此角色权限）';
}

/**
 * 切换用户注册开关
 */
async function toggleRegistrationEnabled(enabled) {
    if (!hasPermission('access.manage')) { showToast('无管理访问控制权限', 'error'); return; }
    const ok = await showConfirm(`确定要${enabled ? '开启' : '关闭'}用户自主注册吗？`, 'user-plus');
    if (!ok) {
        const toggle = document.getElementById('registrationToggle');
        if (toggle) toggle.checked = !enabled;
        return;
    }
    try {
        const r = await adminApiFetch('updateRegistrationEnabled', {
            method: 'POST',
            body: JSON.stringify({ enabled }),
        });
        if (r.status === 401) {
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        const j = await r.json();
        if (j.success) {
            showToast(enabled ? '已开启用户注册' : '已关闭用户注册', 'success');
            // 手动更新 UI，避免重新渲染闪烁
            const badge = document.querySelector('#registrationToggle').closest('.panel').querySelector('.access-status-row .badge');
            if (badge) {
                badge.className = 'badge ' + (enabled ? 'badge-ok' : 'badge-err');
                badge.textContent = enabled ? '已开启' : '已关闭';
            }
            const statusText = document.querySelector('#registrationToggle').closest('.panel').querySelector('.access-status-row span:last-child');
            if (statusText) {
                statusText.textContent = enabled ? '未登录用户可在登录弹窗中自主注册账户' : '前台登录弹窗不显示注册入口，仅管理员可创建用户';
            }
            const roleGroup = document.getElementById('defaultRegisterRoleSelect');
            if (roleGroup) {
                const formGroup = roleGroup.closest('.form-group');
                if (formGroup) {
                    formGroup.style.opacity = enabled ? '' : '0.5';
                    formGroup.style.pointerEvents = enabled ? '' : 'none';
                }
            }
        } else {
            showToast(j.error || '操作失败', 'error');
            const toggle = document.getElementById('registrationToggle');
            if (toggle) toggle.checked = !enabled;
        }
    } catch (e) {
        console.error(e);
        showToast('网络错误', 'error');
        const toggle = document.getElementById('registrationToggle');
        if (toggle) toggle.checked = !enabled;
    }
}

/**
 * 保存注册默认角色
 */
async function saveDefaultRegisterRole() {
    if (!hasPermission('access.manage')) { showToast('无管理访问控制权限', 'error'); return; }
    const sel = document.getElementById('defaultRegisterRoleSelect');
    if (!sel) return;
    const role = sel.value;
    const roleName = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : role;

    const ok = await showConfirm(`确定将注册默认身份设置为「${roleName}」吗？`, 'user-plus');
    if (!ok) return;

    try {
        const r = await adminApiFetch('updateDefaultRegisterRole', {
            method: 'POST',
            body: JSON.stringify({ role }),
        });
        if (r.status === 401) {
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        const j = await r.json();
        if (j.success) {
            showToast(`已设置注册默认身份为「${roleName}」`, 'success');
        } else {
            showToast(j.error || '保存失败', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('网络错误', 'error');
    }
}

/**
 * 一键全选/清空所有访客权限
 */
function setAllGuestPerms(checked) {
    document.querySelectorAll('.guest-perm-checkbox').forEach(cb => {
        if (!cb.disabled) cb.checked = checked;
    });
    // 同步各组的全选状态
    document.querySelectorAll('.guest-perm-group-toggle input').forEach(cb => {
        if (!cb.disabled) cb.checked = checked;
    });
}

/**
 * 全选/取消全选某个权限组
 */
function toggleGuestPermGroup(checkbox, permIdsStr) {
    const permIds = permIdsStr.split(',');
    const checked = checkbox.checked;
    permIds.forEach(permId => {
        const cb = document.querySelector(`.guest-perm-checkbox[data-perm="${permId}"]`);
        if (cb) cb.checked = checked;
    });
}

/**
 * 保存访客权限配置
 */
async function saveGuestPermissions() {
    if (!hasPermission('access.manage')) { showToast('无管理访问控制权限', 'error'); return; }
    const checkboxes = document.querySelectorAll('.guest-perm-checkbox');
    const permissions = [];
    checkboxes.forEach(cb => {
        if (cb.checked) {
            permissions.push(cb.dataset.perm);
        }
    });

    const btn = document.getElementById('saveGuestPermBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '保存中...';
    }

    try {
        const r = await adminApiFetch('updateGuestPermissions', {
            method: 'POST',
            body: JSON.stringify({ permissions }),
        });
        if (r.status === 401) {
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        const j = await r.json();
        if (j.success) {
            showToast('已保存访客权限配置', 'success');
        } else {
            showToast(j.error || '保存失败', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('网络错误', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '保存权限配置';
        }
    }
}

/* ========== 系统监控（合并：服务器监控 + 操作审计） ========== */
const SYSTEM_MONITOR_TABS = [
    { id: 'server', label: '服务器监控', icon: 'activity', perm: 'view.serverMonitor' },
    { id: 'audit',  label: '操作审计',   icon: 'shield',   perm: 'view.auditLog' },
];

async function renderSystemMonitorPage(targetContainer, tab) {
    const c = targetContainer || document.getElementById('adminContent');

    if (!tab || !SYSTEM_MONITOR_TABS.find(t => t.id === tab && hasPermission(t.perm))) {
        const first = SYSTEM_MONITOR_TABS.find(t => hasPermission(t.perm));
        tab = first ? first.id : '';
    }
    AdminState.systemMonitorTab = tab;

    if (!tab) {
        c.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-feather="alert-triangle" style="width:48px;height:48px;"></i></div><div class="empty-text">权限不足，无法访问系统监控</div></div>`;
        refreshFeatherIcons();
        return;
    }

    const tabsHtml = SYSTEM_MONITOR_TABS.map(t => {
        if (!hasPermission(t.perm)) return '';
        const active = t.id === tab ? 'active' : '';
        return `<button class="adm-tab-btn ${active}" onclick="switchSystemMonitorTab('${t.id}')"><i data-feather="${t.icon}"></i> ${t.label}</button>`;
    }).join('');

    c.innerHTML = `
    <div class="adm-tabs-shell">
        <div class="adm-tabs-bar">${tabsHtml}</div>
        <div class="adm-tab-body" id="systemMonitorBody"><div class="loading-state"><div class="spinner"></div>加载中...</div></div>
    </div>`;
    refreshFeatherIcons();

    const body = document.getElementById('systemMonitorBody');
    if (!body) return;

    if (tab === 'server') {
        await renderServerMonitor(body);
    } else if (tab === 'audit') {
        await renderAuditLog(body);
    }
}

function switchSystemMonitorTab(tab) {
    renderSystemMonitorPage(null, tab);
}

/* ========== 系统信息 ========== */
async function renderSystem() {
    const c = document.getElementById('adminContent');
    c.innerHTML = '<div class="loading-state"><div class="spinner"></div>获取系统信息...</div>';

    let info;
    try {
        const r = await adminApiFetch('systemInfo');
        if (r.status === 401) {
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        const j = await r.json();
        if (!j.success) {
            c.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-feather="alert-triangle" style="width:48px;height:48px;"></i></div><div class="empty-text">${escapeHtml(j.error || '获取失败')}</div></div>`;
            return;
        }
        info = j.info;
    } catch (e) {
        c.innerHTML = '<div class="empty-state"><div class="empty-icon"><i data-feather="alert-triangle" style="width:48px;height:48px;"></i></div><div class="empty-text">网络错误</div></div>';
        return;
    }

    const extBadges = Object.entries(info.extensions).map(([name, loaded]) =>
        `<span class="badge ${loaded ? 'badge-ok' : 'badge-err'}" style="font-size:11px;">${name} ${loaded ? '<i data-feather="check" style="width:10px;height:10px;vertical-align:middle;"></i>' : '<i data-feather="x" style="width:10px;height:10px;vertical-align:middle;"></i>'}</span>`
    ).join(' ');

    const diskUsedPercent = info.diskUsedPercent != null ? info.diskUsedPercent : 0;
    const diskBarClass = diskUsedPercent > 90 ? 'progress-err' : diskUsedPercent > 70 ? 'progress-warn' : 'progress-ok';

    const html = `
    <div class="panel">
        <div class="panel-head"><div class="panel-title"><i data-feather="package" style="width:16px;height:16px;"></i> 数据统计</div></div>
        <div class="panel-body">
            <div class="info-grid">
                <div class="info-card"><div class="info-card-label">文案数量</div><div class="info-card-value">${info.itemCount}</div></div>
                <div class="info-card"><div class="info-card-label">一级分类</div><div class="info-card-value">${info.catCount}</div></div>
                <div class="info-card"><div class="info-card-label">子分类</div><div class="info-card-value">${info.subCatCount}</div></div>
                <div class="info-card"><div class="info-card-label">图片数量</div><div class="info-card-value">${info.imageCount}</div></div>
                <div class="info-card"><div class="info-card-label">数据文件大小</div><div class="info-card-value">${escapeHtml(info.dataSizeText)}</div></div>
                <div class="info-card"><div class="info-card-label">图片目录占用</div><div class="info-card-value">${escapeHtml(info.imageTotalSizeText)}</div></div>
                <div class="info-card"><div class="info-card-label">数据最后更新</div><div class="info-card-value">${escapeHtml(info.dataMtimeText)}</div></div>
                <div class="info-card"><div class="info-card-label">数据文件路径</div><div class="info-card-value code">data/copywriting.json</div></div>
            </div>
        </div>
    </div>

    <div class="panel">
        <div class="panel-head"><div class="panel-title"><i data-feather="monitor" style="width:16px;height:16px;"></i> 服务器环境</div></div>
        <div class="panel-body">
            <div class="info-grid">
                <div class="info-card"><div class="info-card-label">PHP 版本</div><div class="info-card-value code">${escapeHtml(info.phpVersion)}</div></div>
                <div class="info-card"><div class="info-card-label">服务器软件</div><div class="info-card-value code">${escapeHtml(info.serverSoftware)}</div></div>
                <div class="info-card"><div class="info-card-label">操作系统</div><div class="info-card-value">${escapeHtml(info.serverOS)}</div></div>
                <div class="info-card"><div class="info-card-label">PHP SAPI</div><div class="info-card-value code">${escapeHtml(info.sapi)}</div></div>
                <div class="info-card"><div class="info-card-label">时区</div><div class="info-card-value">${escapeHtml(info.timezone)}</div></div>
                <div class="info-card"><div class="info-card-label">已加载扩展</div><div class="info-card-value" style="font-size:12px;">${extBadges}</div></div>
            </div>
        </div>
    </div>

    <div class="panel">
        <div class="panel-head"><div class="panel-title"><i data-feather="hard-drive" style="width:16px;height:16px;"></i> 磁盘空间</div></div>
        <div class="panel-body">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px;">
                <span style="color:var(--t2);">已使用 <strong style="color:var(--t1);">${diskUsedPercent}%</strong></span>
                <span style="color:var(--t3);">可用 ${escapeHtml(info.diskFreeText)} / 总计 ${escapeHtml(info.diskTotalText)}</span>
            </div>
            <div class="progress"><div class="progress-bar ${diskBarClass}" style="width:${diskUsedPercent}%;"></div></div>
        </div>
    </div>

    <div class="panel">
        <div class="panel-head"><div class="panel-title"><i data-feather="shield" style="width:16px;height:16px;"></i> 安全状态</div></div>
        <div class="panel-body">
            <div class="info-grid">
                <div class="info-card">
                    <div class="info-card-label">密码来源</div>
                    <div class="info-card-value"><span class="badge ${info.pwdSource === '未设置' ? 'badge-err' : 'badge-ok'}">${escapeHtml(info.pwdSource)}</span></div>
                </div>
                <div class="info-card">
                    <div class="info-card-label">CSRF 防护</div>
                    <div class="info-card-value"><span class="badge ${info.csrfToken ? 'badge-ok' : 'badge-err'}">${info.csrfToken ? '已启用' : '未启用'}</span></div>
                </div>
                <div class="info-card">
                    <div class="info-card-label">登录限流</div>
                    <div class="info-card-value"><span class="badge badge-ok">5次/15分钟</span></div>
                </div>
                <div class="info-card">
                    <div class="info-card-label">会话超时</div>
                    <div class="info-card-value"><span class="badge badge-info">30 分钟</span></div>
                </div>
                <div class="info-card">
                    <div class="info-card-label">文件上传限制</div>
                    <div class="info-card-value"><span class="badge badge-info">10MB · 图片白名单</span></div>
                </div>
                <div class="info-card">
                    <div class="info-card-label">路径穿越防护</div>
                    <div class="info-card-value"><span class="badge badge-ok">已启用</span></div>
                </div>
                <div class="info-card">
                    <div class="info-card-label">Session 名称</div>
                    <div class="info-card-value code">${escapeHtml(info.sessionName)}</div>
                </div>
            </div>
        </div>
    </div>

    <div class="panel">
        <div class="panel-head"><div class="panel-title"><i data-feather="info" style="width:16px;height:16px;"></i> 关于</div></div>
        <div class="panel-body">
            <div class="info-grid">
                <div class="info-card"><div class="info-card-label">系统名称</div><div class="info-card-value">Cpydes 文案库</div></div>
                <div class="info-card"><div class="info-card-label">版本</div><div class="info-card-value">v1.2.0</div></div>
                <div class="info-card"><div class="info-card-label">后台路径</div><div class="info-card-value code">admin/</div></div>
                <div class="info-card"><div class="info-card-label">前台 API</div><div class="info-card-value code">api.php</div></div>
                <div class="info-card"><div class="info-card-label">后台 API</div><div class="info-card-value code">admin/api.php</div></div>
            </div>
            <div class="security-tip">
                <strong class="security-tip-title"><i data-feather="zap" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;"></i> 安全建议：</strong><br>
                1. 修改默认管理密码（默认 admin）<br>
                2. 生产环境启用 HTTPS<br>
                3. 定期使用"导出全站备份"功能备份数据<br>
                4. 如需更高安全性，可在 Web 服务器层为 admin/ 目录增加 IP 白名单或 .htpasswd
            </div>
        </div>
    </div>
    `;
    c.innerHTML = html;
    refreshFeatherIcons();
}


/* ========== 服务器监控 ========== */
let _serverMonitorTimer = null;
let _serverMonitorAutoRefresh = true;

async function renderServerMonitor(targetContainer) {
    const c = targetContainer || document.getElementById('systemMonitorBody') || document.getElementById('adminContent');
    _serverMonitorAutoRefresh = true;
    c.innerHTML = `
    <div class="panel">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="activity" style="width:16px;height:16px;"></i> 服务器资源监控</div>
            <div class="sm-toolbar">
                <label class="sm-autorefresh">
                    <input type="checkbox" id="smAutoRefresh" checked onchange="toggleSmAutoRefresh(this.checked)">
                    <span>自动刷新</span>
                </label>
                <select id="smInterval" class="form-select" onchange="restartSmTimer()" style="width:90px;">
                    <option value="2000">2 秒</option>
                    <option value="5000" selected>5 秒</option>
                    <option value="10000">10 秒</option>
                    <option value="30000">30 秒</option>
                </select>
                <button class="btn btn-default btn-sm" onclick="loadServerStats()"><i data-feather="refresh-cw" style="width:13px;height:13px;"></i> 立即刷新</button>
            </div>
        </div>
        <div class="panel-body" id="smStatsBody">
            <div class="loading-state"><div class="spinner"></div>加载服务器信息...</div>
        </div>
    </div>`;
    refreshFeatherIcons();
    await loadServerStats();
    restartSmTimer();
}

function toggleSmAutoRefresh(checked) {
    _serverMonitorAutoRefresh = checked;
    if (checked) {
        restartSmTimer();
    } else {
        if (_serverMonitorTimer) { clearInterval(_serverMonitorTimer); _serverMonitorTimer = null; }
    }
}

function restartSmTimer() {
    if (_serverMonitorTimer) { clearInterval(_serverMonitorTimer); _serverMonitorTimer = null; }
    if (!_serverMonitorAutoRefresh) return;
    if (AdminState.currentView !== 'serverMonitor') return;
    const sel = document.getElementById('smInterval');
    const interval = sel ? parseInt(sel.value, 10) || 5000 : 5000;
    _serverMonitorTimer = setInterval(() => {
        if (AdminState.currentView !== 'serverMonitor') {
            clearInterval(_serverMonitorTimer);
            _serverMonitorTimer = null;
            return;
        }
        loadServerStats();
    }, interval);
}

async function loadServerStats() {
    const body = document.getElementById('smStatsBody');
    if (!body) return;
    try {
        const r = await adminApiFetch('getServerStats');
        if (r.status === 401) { showToast('会话已过期', 'error'); setTimeout(() => location.reload(), 1500); return; }
        const j = await r.json();
        if (!j.success) {
            body.innerHTML = `<div class="empty-state"><div class="empty-text">${escapeHtml(j.error || '获取失败')}</div></div>`;
            return;
        }
        const s = j.stats;
        renderServerStatsHtml(body, s);
    } catch (e) {
        console.error(e);
        body.innerHTML = '<div class="empty-state"><div class="empty-text">网络错误</div></div>';
    }
}

function renderServerStatsHtml(body, s) {
    const php = s.php || {};
    const disk = s.disk || {};
    const mem = s.memory || {};
    const load = s.load || {};
    const cpu = s.cpu || {};
    const server = s.server || {};

    // 进度条颜色判定
    const barColor = (pct) => pct == null ? 'progress-neutral' : (pct > 90 ? 'progress-err' : pct > 70 ? 'progress-warn' : 'progress-ok');

    const phpMemUsagePct = php.memoryUsedPercent;
    const phpMemPeakPct = php.memoryPeakPercent;
    const diskPct = disk.usedPercent;
    const memPct = mem.usedPercent;

    const cpuBlock = cpu.available ? `
        <div class="info-card sm-card">
            <div class="info-card-label"><i data-feather="cpu" style="width:14px;height:14px;vertical-align:-2px;"></i> CPU</div>
            <div class="info-card-value">${escapeHtml(cpu.modelName || '-')}</div>
            <div class="sm-card-sub">核心数: <strong>${cpu.cores}</strong></div>
        </div>` : `
        <div class="info-card sm-card">
            <div class="info-card-label"><i data-feather="cpu" style="width:14px;height:14px;vertical-align:-2px;"></i> CPU</div>
            <div class="info-card-value sm-muted">当前环境不可用</div>
            <div class="sm-card-sub">PHP_OS: ${escapeHtml(server.os || '-')}</div>
        </div>`;

    const loadBlock = load.available ? (load.type === 'cpuUsage' ? `
        <div class="info-card sm-card">
            <div class="info-card-label"><i data-feather="trending-up" style="width:14px;height:14px;vertical-align:-2px;"></i> CPU 使用率</div>
            <div class="sm-mem-stats">
                <div class="sm-mem-row"><span>当前</span><strong>${load.cpuUsage}%</strong></div>
            </div>
            <div class="progress sm-progress">
                <div class="progress-bar ${barColor(load.cpuUsage)}" style="width:${load.cpuUsage}%;"></div>
            </div>
        </div>` : `
        <div class="info-card sm-card">
            <div class="info-card-label"><i data-feather="trending-up" style="width:14px;height:14px;vertical-align:-2px;"></i> 系统负载</div>
            <div class="sm-load-row"><span>1分钟</span><strong>${load.load1}</strong></div>
            <div class="sm-load-row"><span>5分钟</span><strong>${load.load5}</strong></div>
            <div class="sm-load-row"><span>15分钟</span><strong>${load.load15}</strong></div>
        </div>`) : `
        <div class="info-card sm-card">
            <div class="info-card-label"><i data-feather="trending-up" style="width:14px;height:14px;vertical-align:-2px;"></i> 系统负载</div>
            <div class="info-card-value sm-muted">不可用</div>
            <div class="sm-card-sub">当前环境不支持</div>
        </div>`;

    const memBlock = mem.available ? `
        <div class="info-card sm-card">
            <div class="info-card-label"><i data-feather="server" style="width:14px;height:14px;vertical-align:-2px;"></i> 系统内存</div>
            <div class="sm-mem-stats">
                <div class="sm-mem-row">
                    <span>总量</span><strong>${escapeHtml(mem.totalText)}</strong>
                </div>
                <div class="sm-mem-row">
                    <span>已用</span><strong>${escapeHtml(mem.usedText)} (${memPct}%)</strong>
                </div>
                <div class="sm-mem-row">
                    <span>可用</span><strong>${escapeHtml(mem.availableText)}</strong>
                </div>
            </div>
            <div class="progress sm-progress">
                <div class="progress-bar ${barColor(memPct)}" style="width:${memPct}%;"></div>
            </div>
            ${mem.cached != null && mem.buffers != null ? `<div class="sm-card-sub">缓存: ${escapeHtml(formatBytesLocal(mem.cached))} · 缓冲: ${escapeHtml(formatBytesLocal(mem.buffers))}</div>` : ''}
        </div>` : `
        <div class="info-card sm-card">
            <div class="info-card-label"><i data-feather="server" style="width:14px;height:14px;vertical-align:-2px;"></i> 系统内存</div>
            <div class="sm-mem-stats">
                <div class="sm-mem-row">
                    <span>PHP 限制</span><strong>${escapeHtml(php.memoryLimitText || '-')}</strong>
                </div>
                <div class="sm-mem-row">
                    <span>已用</span><strong>${escapeHtml(php.memoryUsageText || '-')} (${phpMemUsagePct || 0}%)</strong>
                </div>
                <div class="sm-mem-row">
                    <span>峰值</span><strong>${escapeHtml(php.memoryPeakText || '-')} (${phpMemPeakPct || 0}%)</strong>
                </div>
            </div>
            <div class="progress sm-progress">
                <div class="progress-bar ${barColor(phpMemUsagePct)}" style="width:${phpMemUsagePct || 0}%;"></div>
            </div>
            <div class="sm-card-sub">系统内存受 open_basedir 限制，显示 PHP 进程内存</div>
        </div>`;

    body.innerHTML = `
    <div class="info-grid sm-grid">
        ${cpuBlock}
        ${loadBlock}
        <div class="info-card sm-card">
            <div class="info-card-label"><i data-feather="hard-drive" style="width:14px;height:14px;vertical-align:-2px;"></i> 磁盘空间</div>
            <div class="sm-mem-stats">
                <div class="sm-mem-row"><span>总量</span><strong>${escapeHtml(disk.totalText)}</strong></div>
                <div class="sm-mem-row"><span>已用</span><strong>${escapeHtml(disk.usedText)} (${diskPct}%)</strong></div>
                <div class="sm-mem-row"><span>可用</span><strong>${escapeHtml(disk.freeText)}</strong></div>
            </div>
            <div class="progress sm-progress">
                <div class="progress-bar ${barColor(diskPct)}" style="width:${diskPct}%;"></div>
            </div>
        </div>
        ${memBlock}
    </div>

    <div class="panel-sub-section">
        <div class="panel-sub-title"><i data-feather="code" style="width:14px;height:14px;vertical-align:-2px;"></i> PHP 运行时</div>
        <div class="info-grid sm-grid">
            <div class="info-card sm-card">
                <div class="info-card-label">PHP 版本</div>
                <div class="info-card-value code">${escapeHtml(php.version)}</div>
                <div class="sm-card-sub">SAPI: ${escapeHtml(php.sapi)}</div>
            </div>
            <div class="info-card sm-card">
                <div class="info-card-label">内存使用</div>
                <div class="info-card-value">${escapeHtml(php.memoryUsageText)} / ${escapeHtml(php.memoryLimitText)}</div>
                <div class="progress sm-progress-mini">
                    <div class="progress-bar ${barColor(phpMemUsagePct)}" style="width:${phpMemUsagePct || 0}%;"></div>
                </div>
                <div class="sm-card-sub">峰值: ${escapeHtml(php.memoryPeakText)} (${phpMemPeakPct || 0}%)</div>
            </div>
            <div class="info-card sm-card">
                <div class="info-card-label">OPcache</div>
                <div class="info-card-value">
                    <span class="badge ${php.opcacheEnabled ? 'badge-ok' : 'badge-err'}">${php.opcacheEnabled ? '已启用' : '未启用'}</span>
                </div>
                ${php.opcacheEnabled ? `<div class="sm-card-sub">内存: ${escapeHtml(php.opcacheMemoryUsage || '-')} · 命中率: ${php.opcacheHitRate != null ? php.opcacheHitRate + '%' : '-'}</div>` : '<div class="sm-card-sub">未启用 OPcache</div>'}
            </div>
            <div class="info-card sm-card">
                <div class="info-card-label">最大执行时间</div>
                <div class="info-card-value code">${escapeHtml(String(php.maxExecutionTime))} 秒</div>
            </div>
            <div class="info-card sm-card">
                <div class="info-card-label">上传大小限制</div>
                <div class="info-card-value code">${escapeHtml(php.uploadMaxFilesize)}</div>
                <div class="sm-card-sub">POST: ${escapeHtml(php.postMaxSize)}</div>
            </div>
        </div>
    </div>

    <div class="panel-sub-section">
        <div class="panel-sub-title"><i data-feather="server" style="width:14px;height:14px;vertical-align:-2px;"></i> 服务器信息</div>
        <div class="info-grid sm-grid">
            <div class="info-card sm-card">
                <div class="info-card-label">主机名</div>
                <div class="info-card-value">${escapeHtml(server.hostname)}</div>
            </div>
            <div class="info-card sm-card">
                <div class="info-card-label">操作系统</div>
                <div class="info-card-value">${escapeHtml(server.os)} (${escapeHtml(server.osFamily)})</div>
            </div>
            <div class="info-card sm-card">
                <div class="info-card-label">时区</div>
                <div class="info-card-value">${escapeHtml(server.timezone)}</div>
            </div>
            <div class="info-card sm-card">
                <div class="info-card-label">服务器时间</div>
                <div class="info-card-value sm-time" id="smServerTime">${escapeHtml(server.time)}</div>
            </div>
        </div>
    </div>`;
    refreshFeatherIcons();
}

function formatBytesLocal(bytes) {
    if (bytes == null || isNaN(bytes)) return '-';
    if (bytes < 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0; let b = bytes;
    while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
    return (i === 0 ? Math.round(b) : b.toFixed(1)) + ' ' + units[i];
}


/* ========== 使用统计 ========== */
async function renderUsageStats(targetContainer) {
    const c = targetContainer || document.getElementById('statsAnalysisBody') || document.getElementById('adminContent');
    c.innerHTML = '<div class="loading-state"><div class="spinner"></div>加载统计数据...</div>';
    try {
        const [r, roles] = await Promise.all([
            adminApiFetch('getUsageStats'),
            getRolesList()
        ]);
        if (r.status === 401) { showToast('会话已过期', 'error'); setTimeout(() => location.reload(), 1500); return; }
        const j = await r.json();
        if (!j.success) { c.innerHTML = `<div class="empty-state"><div class="empty-text">${escapeHtml(j.error || '加载失败')}</div></div>`; return; }

        const ov = j.overview || {};
        const dailyActive = j.dailyActive || [];
        const hourlyDist = j.hourlyDistribution || Array(24).fill(0);
        const actionDist = j.actionDistribution || {};
        const topUsers = j.topUsers || [];
        const userStats = j.userStats || [];
        const weeklyCmp = j.weeklyComparison || [];
        const monthlyCmp = j.monthlyComparison || [];

        // 概览卡片
        const statsCards = [
            { icon: 'users', label: '总用户', value: ov.totalUsers || 0 },
            { icon: 'user-check', label: '活跃用户', value: ov.activeUsers || 0 },
            { icon: 'wifi', label: '当前在线', value: ov.onlineNow || 0 },
            { icon: 'log-in', label: '7天登录', value: ov.totalLogins7d || 0 },
            { icon: 'trending-up', label: '30天登录', value: ov.totalLogins30d || 0 },
            { icon: 'bar-chart-2', label: '峰值并发', value: (ov.peakConcurrent || 0) + (ov.peakConcurrentTime ? ` (${formatDate(ov.peakConcurrentTime)})` : '') },
        ];

        // 日活趋势柱状图
        const maxDaily = Math.max(1, ...dailyActive.map(d => d.count));
        const dailyChart = dailyActive.map(d => `
            <div class="bar-col"><div class="bar-fill" style="height:${(d.count/maxDaily)*100}%"></div><div class="bar-val">${d.count}</div><div class="bar-label">${d.date.slice(5)}</div></div>
        `).join('');

        // 24小时分布图
        const maxHourly = Math.max(1, ...hourlyDist);
        const hourlyChart = hourlyDist.map((v, i) => `
            <div class="bar-col"><div class="bar-fill" style="height:${(v/maxHourly)*100}%"></div><div class="bar-label">${i}</div></div>
        `).join('');

        // 操作类型分布（简单水平条）
        const actionEntries = Object.entries(actionDist).slice(0, 8);
        const maxAction = Math.max(1, ...actionEntries.map(e => e[1]));
        const actionChart = actionEntries.map(([action, count]) => `
            <div class="rank-item"><span class="rank-label">${escapeHtml(ACTION_LABELS[action] || action)}</span><div class="rank-bar"><div class="rank-bar-fill" style="width:${(count/maxAction)*100}%"></div></div><span class="rank-val">${count}</span></div>
        `).join('');

        // 用户活跃排行
        const maxUserAction = Math.max(1, ...topUsers.map(u => u.actionCount));
        const userRankChart = topUsers.slice(0, 5).map(u => `
            <div class="rank-item"><span class="rank-label">${escapeHtml(u.username)}</span><div class="rank-bar"><div class="rank-bar-fill" style="width:${(u.actionCount/maxUserAction)*100}%"></div></div><span class="rank-val">${u.actionCount}</span></div>
        `).join('');

        // 周/月对比图（分组柱状图，三个指标：操作数/登录数/活跃用户）
        const weeklyChart = buildComparisonChart(weeklyCmp);
        const monthlyChart = buildComparisonChart(monthlyCmp);

        // 用户统计表
        const statusLabels = { active: '正常', disabled: '已禁用', banned: '已封禁' };
        const userStatsRows = userStats.map(u => {
            const roleDisplay = getRoleName(u.role, roles);
            return `
            <tr>
                <td>${escapeHtml(u.username)}</td>
                <td><span class="user-role-badge">${escapeHtml(roleDisplay)}</span></td>
                <td><span class="status-indicator status-${u.status || 'active'}"></span>${statusLabels[u.status] || u.status || '正常'}</td>
                <td>${u.loginCount || 0}</td>
                <td>${u.actionCount7d || 0}</td>
                <td>${formatDate(u.lastLogin)}</td>
            </tr>
        `;
        }).join('');

        c.innerHTML = `
        <div class="stats-toolbar">
            <div class="stats-toolbar-title">使用统计概览</div>
            <div class="stats-toolbar-actions">
                ${hasPermission('stats.export') ? `<button class="btn btn-default btn-sm" onclick="exportUsageStats('csv')"><i data-feather="download" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"></i>导出 CSV</button>
                <button class="btn btn-default btn-sm" onclick="exportUsageStats('json')"><i data-feather="download" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"></i>导出 JSON</button>` : ''}
            </div>
        </div>
        <div class="stats-grid" style="margin-bottom:20px">
            ${statsCards.map(s => `<div class="stat-card"><div class="stat-icon"><i data-feather="${s.icon}" style="width:20px;height:20px;"></i></div><div class="stat-value">${s.value}</div><div class="stat-name">${s.label}</div></div>`).join('')}
        </div>
        <div class="panel" style="margin-bottom:20px">
            <div class="panel-head"><div class="panel-title">近4周对比</div><div class="cmp-legend"><span class="cmp-legend-item"><span class="cmp-dot s-actions"></span>操作数</span><span class="cmp-legend-item"><span class="cmp-dot s-logins"></span>登录数</span><span class="cmp-legend-item"><span class="cmp-dot s-users"></span>活跃用户</span></div></div>
            <div class="panel-body"><div class="cmp-chart">${weeklyChart}</div></div>
        </div>
        <div class="panel" style="margin-bottom:20px">
            <div class="panel-head"><div class="panel-title">近6个月对比</div><div class="cmp-legend"><span class="cmp-legend-item"><span class="cmp-dot s-actions"></span>操作数</span><span class="cmp-legend-item"><span class="cmp-dot s-logins"></span>登录数</span><span class="cmp-legend-item"><span class="cmp-dot s-users"></span>活跃用户</span></div></div>
            <div class="panel-body"><div class="cmp-chart">${monthlyChart}</div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
            <div class="panel"><div class="panel-head"><div class="panel-title">近7天日活趋势</div></div><div class="panel-body"><div class="bar-chart">${dailyChart}</div></div></div>
            <div class="panel"><div class="panel-head"><div class="panel-title">24小时操作分布</div></div><div class="panel-body"><div class="bar-chart hourly-chart">${hourlyChart}</div></div></div>
            <div class="panel"><div class="panel-head"><div class="panel-title">操作类型分布</div></div><div class="panel-body">${actionChart || '<div style="text-align:center;color:var(--t3);padding:20px">暂无数据</div>'}</div></div>
            <div class="panel"><div class="panel-head"><div class="panel-title">用户活跃排行</div></div><div class="panel-body">${userRankChart || '<div style="text-align:center;color:var(--t3);padding:20px">暂无数据</div>'}</div></div>
        </div>
        <div class="panel">
            <div class="panel-head"><div class="panel-title">用户统计明细</div></div>
            <div class="panel-body">
                <table class="user-table">
                    <thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>登录次数</th><th>7天操作数</th><th>最近登录</th></tr></thead>
                    <tbody>${userStatsRows}</tbody>
                </table>
            </div>
        </div>`;
        refreshFeatherIcons();
    } catch (e) {
        console.error(e);
        c.innerHTML = '<div class="empty-state"><div class="empty-text">网络错误</div></div>';
    }
}

// 构建周/月对比分组柱状图
function buildComparisonChart(data) {
    if (!data || !data.length) return '<div style="text-align:center;color:var(--t3);padding:20px">暂无数据</div>';
    const maxVal = Math.max(1, ...data.map(d => Math.max(d.actions || 0, d.logins || 0, d.uniqueUsers || 0)));
    return data.map(d => {
        const a = d.actions || 0, l = d.logins || 0, u = d.uniqueUsers || 0;
        return `<div class="cmp-group">
            <div class="cmp-bars">
                <div class="cmp-bar s-actions" style="height:${(a/maxVal)*100}%" title="操作数: ${a}"></div>
                <div class="cmp-bar s-logins" style="height:${(l/maxVal)*100}%" title="登录数: ${l}"></div>
                <div class="cmp-bar s-users" style="height:${(u/maxVal)*100}%" title="活跃用户: ${u}"></div>
            </div>
            <div class="cmp-label">${escapeHtml(d.label || '')}</div>
        </div>`;
    }).join('');
}

// 导出使用统计（CSV / JSON）
function exportUsageStats(format) {
    if (!hasPermission('view.usageStats')) { showToast('无导出使用统计权限', 'error'); return; }
    const url = 'api.php?action=exportUsageStats&format=' + encodeURIComponent(format);
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    setTimeout(() => { iframe.remove(); }, 60000);
    showToast('已开始下载使用统计 (' + format.toUpperCase() + ')', 'success');
}


