// ========== 实时同步轮询模块 ==========
// 职责：轻量轮询 getSyncVersion（仅 stat 文件 mtime），按变化类型增量刷新
// 策略：
//   - 开启：按配置间隔（默认 5s）轮询；编辑中（弹窗/拖拽）暂停刷新，关闭后下个周期自动补刷
//   - 关闭：降频为 30s 心跳，仅检测开关是否被重新开启
//   - 增量：仅 content/settings/announcements 变化时调用对应 refresh 函数，不全量拉取
// 依赖：appState（state.js）、refreshContent/refreshSettings/refreshAnnouncements（dataService.js）

(function () {
    const HEARTBEAT_INTERVAL = 30; // 关闭时降频心跳秒数，用于检测后台重新开启同步
    // 前台实际需要增量刷新的数据类型（shares/drive 前台无展示，仅跟踪版本不触发刷新）
    const REFRESH_TYPES = ['content', 'settings', 'announcements'];

    let _timer = null;
    let _running = false;
    let _inFlight = false;

    /**
     * 是否处于编辑暂停态：任一 Overlay 弹窗打开 或 拖拽进行中
     * 用 DOM 通用选择器覆盖所有弹窗（id 以 Overlay 结尾）+ .modal.show + .dragging
     */
    function isSyncPaused() {
        if (document.querySelector('[id$="Overlay"].show, .modal.show')) return true;
        if (document.querySelector('.dragging')) return true;
        return false;
    }

    /**
     * 执行一次版本轮询：拉取版本号 + 配置 → 对比变化 → 增量刷新
     */
    async function pollOnce() {
        if (_inFlight) return;
        _inFlight = true;
        try {
            const r = await fetch('api.php?action=getSyncVersion', { cache: 'no-cache' });
            if (!r.ok) return;
            const j = await r.json();
            if (!j.success || !j.version) return;

            // 动态更新同步配置（开关/间隔），后台改完后下个周期即生效
            const newConfig = { enabled: !!j.syncEnabled, interval: j.syncInterval || 5 };
            appState.setState('sync.config', newConfig);

            const prevVersion = appState.getState('sync.version');
            // 首次轮询：仅记录当前版本，不触发刷新（loadData 已加载最新数据）
            if (!prevVersion) {
                appState.setState('sync.version', j.version);
                return;
            }

            const paused = isSyncPaused();

            if (newConfig.enabled && !paused) {
                // 开启 + 未暂停：检测变化类型，增量刷新
                const changed = REFRESH_TYPES.filter(t => j.version[t] !== prevVersion[t]);
                // 先更新版本，避免刷新过程中又触发误判
                appState.setState('sync.version', j.version);
                if (changed.length > 0) {
                    await refreshChanged(changed);
                }
            } else {
                // 暂停中：不刷新、不更新版本（保留暂停前版本，关闭弹窗后能检测到期间变化）
                // 关闭状态：仅更新版本记录，不刷新
                if (paused) {
                    // 暂停中保留旧版本以便恢复后补刷
                } else {
                    appState.setState('sync.version', j.version);
                }
            }
        } catch (e) {
            console.error('同步轮询失败:', e);
        } finally {
            _inFlight = false;
        }
    }

    /**
     * 按变化类型依次调用对应增量刷新函数
     */
    async function refreshChanged(types) {
        for (const t of types) {
            try {
                if (t === 'content' && typeof refreshContent === 'function') await refreshContent();
                else if (t === 'settings' && typeof refreshSettings === 'function') await refreshSettings();
                else if (t === 'announcements' && typeof refreshAnnouncements === 'function') await refreshAnnouncements();
            } catch (e) {
                console.error('增量刷新 [' + t + '] 失败:', e);
            }
        }
    }

    /**
     * 调度下一次轮询：开启时按配置间隔，关闭时按心跳间隔
     */
    function scheduleNext() {
        if (!_running) return;
        const cfg = appState.getState('sync.config') || { enabled: false, interval: 5 };
        const delay = cfg.enabled ? (cfg.interval * 1000) : (HEARTBEAT_INTERVAL * 1000);
        _timer = setTimeout(async () => {
            await pollOnce();
            scheduleNext();
        }, delay);
    }

    /**
     * 启动同步轮询（幂等：重复调用安全）
     * 首次立即拉取版本号，随后按间隔调度
     */
    function startSyncLoop() {
        if (_running) return;
        _running = true;
        pollOnce().then(scheduleNext);
    }

    /**
     * 停止同步轮询
     */
    function stopSyncLoop() {
        _running = false;
        if (_timer) { clearTimeout(_timer); _timer = null; }
    }

    // 暴露到全局供 app.js 调用
    window.startSyncLoop = startSyncLoop;
    window.stopSyncLoop = stopSyncLoop;
    window.isSyncPaused = isSyncPaused;
})();
