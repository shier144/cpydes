<?php
/**
 * 公开分享页面
 * 通过 ?token=xxx 展示分享的文案内容，无需登录
 * 通过 ?drive=xxx 展示分享的网盘文件下载，无需登录
 * 调用 admin/api.php?action=getShare 获取数据
 */

// 安全地提取 token，仅允许字母数字及 _ - .
$token = '';
if (isset($_GET['token']) && is_string($_GET['token'])) {
    $token = preg_replace('/[^a-zA-Z0-9_\.\-]/', '', $_GET['token']);
}

// 安全地提取网盘分享 token
$driveToken = '';
if (isset($_GET['drive']) && is_string($_GET['drive'])) {
    $driveToken = preg_replace('/[^a-zA-Z0-9_\.\-]/', '', $_GET['drive']);
}

// 网盘文件分享：使用独立渲染流程
if ($driveToken !== ''):
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#007aff">
<meta name="color-scheme" content="light dark">
<title>文件分享</title>
<style>
:root { --bg:#fff; --card:#fff; --t1:#1a1a1a; --t2:#666; --t3:#999; --line:#f0f0f0; --pri:#333; --pri-bg:#f8f8f8; --ok:#07c160; --err:#ff4d4f; --warn:#faad14; }
@media (prefers-color-scheme:dark) { :root { --bg:#1a1a1a; --card:#222; --t1:#f0f0f0; --t2:#999; --t3:#666; --line:#333; --pri:#fff; --pri-bg:#2a2a2a; } }
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--t1);line-height:1.6;min-height:100vh;display:flex;align-items:center;justify-content:center}
.page{max-width:420px;width:100%;padding:24px}
.card{background:var(--card);border:1px solid var(--line);padding:40px 32px;text-align:center}
.icon{width:56px;height:56px;margin:0 auto 16px;border-radius:50%;background:var(--pri-bg);color:var(--pri);display:flex;align-items:center;justify-content:center}
.icon svg{width:26px;height:26px}
.title{font-size:18px;font-weight:600;margin-bottom:6px}
.desc{font-size:14px;color:var(--t2);margin-bottom:8px}
.meta{font-size:12px;color:var(--t3);margin-bottom:20px}
.input{width:100%;padding:12px 16px;border:1px solid var(--line);background:var(--bg);color:var(--t1);font-size:15px;font-family:inherit;outline:none;text-align:center;margin-bottom:12px}
.input:focus{border-color:var(--pri)}
.input.err{border-color:var(--err)}
.btn{width:100%;padding:12px;background:var(--pri);color:#fff;border:none;font-size:15px;font-weight:500;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:6px;margin-bottom:6px}
.btn:hover{opacity:.9}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn svg{width:15px;height:15px}
.err-msg{color:var(--err);font-size:13px;min-height:18px;margin-bottom:12px}
.state-icon{width:64px;height:64px;margin:0 auto 16px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.state-icon svg{width:32px;height:32px}
.state-icon.error{background:rgba(255,77,79,0.08);color:var(--err)}
.state-icon.warning{background:rgba(250,173,20,0.08);color:var(--warn)}
.state-title{font-size:18px;font-weight:600;margin-bottom:8px}
.state-desc{font-size:14px;color:var(--t2)}
.wm{text-align:center;padding-top:24px;color:var(--t3);font-size:12px}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
.input.err{animation:shake .4s ease}
</style>
</head>
<body>
<div class="page"><div id="app"></div></div>
<script>
(function(){
var TOKEN=<?php echo json_encode($driveToken); ?>;
var API='api.php';
var app=document.getElementById('app');
function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function fmtSize(b){if(!b)return'0 B';var u=['B','KB','MB','GB','TB'];var i=0;while(b>=1024&&i<u.length-1){b/=1024;i++}return(i===0?Math.round(b):b.toFixed(1))+' '+u[i]}

function renderInfo(info){
    var dlSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    app.innerHTML='<div class="card"><div class="icon">'+dlSvg+'</div><div class="title">'+esc(info.fileName)+'</div><div class="desc">文件大小: '+fmtSize(info.fileSize)+'</div><div class="meta">'+(info.expiresAt?'有效期至: '+esc(info.expiresAt):'永久有效')+(info.maxDownloads?' · 下载限制: '+info.downloadCount+'/'+info.maxDownloads:' · 已下载 '+info.downloadCount+' 次')+'</div>'+(info.hasPassword?'<form id="dl-form"><input type="password" class="input" id="dl-pwd" placeholder="请输入访问密码" autocomplete="off"><div class="err-msg" id="dl-err"></div><button type="submit" class="btn" id="dl-btn">'+dlSvg+'下载文件</button></form>':'<button type="button" class="btn" id="dl-btn-no-pw">'+dlSvg+'下载文件</button>')+'</div><div class="wm">由文案库数据网盘分享</div>';

    function doDownload(pwd){
        var body={token:TOKEN};
        if(pwd)body.password=pwd;
        var btn=document.getElementById('dl-btn')||document.getElementById('dl-btn-no-pw');
        if(btn){btn.disabled=true;btn.textContent='下载中...';}
        fetch(API+'?action=driveShareDownload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){
            if(!r.ok){if(btn){btn.disabled=false;btn.innerHTML=dlSvg+'下载文件';}return r.json().then(function(j){var e=document.getElementById('dl-err');if(e)e.textContent=j.error||'下载失败';}).catch(function(){});}
            var disposition=r.headers.get('Content-Disposition')||'';
            var fileName=info.fileName||'download';
            function parseFilename(disposition) {
                if (!disposition) return null;
                var m = disposition.match(/filename\*=UTF-8''([^;]+)/i);
                if (m) {
                    try { return decodeURIComponent(m[1]); } catch(e) {}
                }
                m = disposition.match(/filename="([^"]*)"/i);
                if (m) {
                    try { return decodeURIComponent(m[1]); } catch(e) { return m[1]; }
                }
                m = disposition.match(/filename=([^;]+)/i);
                if (m) {
                    try { return decodeURIComponent(m[1].trim()); } catch(e) { return m[1].trim(); }
                }
                return null;
            }
            var parsedName = parseFilename(disposition);
            if (parsedName) fileName = parsedName;
            return r.blob().then(function(blob){
                var url=URL.createObjectURL(blob);
                var a=document.createElement('a');
                a.href=url;a.download=fileName;a.click();
                setTimeout(function(){URL.revokeObjectURL(url);},5000);
                if(btn){btn.disabled=false;btn.innerHTML=dlSvg+'下载文件';}
            });
        }).catch(function(){if(btn){btn.disabled=false;btn.innerHTML=dlSvg+'下载文件';}var e=document.getElementById('dl-err');if(e)e.textContent='网络错误';});
    }

    var form=document.getElementById('dl-form');
    if(form){
        form.addEventListener('submit',function(e){
            e.preventDefault();
            var pwd=document.getElementById('dl-pwd').value.trim();
            if(!pwd){document.getElementById('dl-err').textContent='请输入密码';document.getElementById('dl-pwd').classList.add('err');return}
            doDownload(pwd);
        });
    }
    var btnNoPw=document.getElementById('dl-btn-no-pw');
    if(btnNoPw)btnNoPw.addEventListener('click',function(){doDownload();});
}

function renderError(title,desc){
    app.innerHTML='<div class="card" style="border:none;background:none;padding:40px 0"><div class="state-icon error"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="state-title">'+esc(title)+'</div><div class="state-desc">'+esc(desc)+'</div></div>';
}

fetch(API+'?action=driveShareInfo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN})}).then(function(r){return r.json()}).then(function(j){
    if(j.success)renderInfo(j);
    else renderError('无法访问',j.error||'分享不存在');
}).catch(function(){renderError('网络错误','请检查网络后重试')});
})();
</script>
</body>
</html>
<?php
// 网盘分享页面结束，退出脚本
exit;
endif;
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#007aff">
<meta name="color-scheme" content="light dark">
<title>分享内容</title>
<style>
:root {
    --bg: #ffffff;
    --card-bg: #ffffff;
    --text: #1a1a1a;
    --text-secondary: #666666;
    --text-tertiary: #999999;
    --border: #f0f0f0;
    --primary: #333333;
    --primary-bg: #f8f8f8;
    --success: #07c160;
    --warning: #faad14;
    --danger: #ff4d4f;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.03);
    --shadow: 0 1px 3px rgba(0,0,0,0.04);
    --shadow-lg: 0 2px 8px rgba(0,0,0,0.06);
    --radius: 0;
}

@media (prefers-color-scheme: dark) {
    :root {
        --bg: #1a1a1a;
        --card-bg: #222222;
        --text: #f0f0f0;
        --text-secondary: #999999;
        --text-tertiary: #666666;
        --border: #333333;
        --primary: #ffffff;
        --primary-bg: #2a2a2a;
    }
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

html {
    -webkit-text-size-adjust: 100%;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    min-height: 100vh;
}

.page {
    max-width: 960px;
    margin: 0 auto;
    padding: 40px 24px 60px;
    animation: pageFadeIn 0.25s ease;
}

@keyframes pageFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.header {
    display: flex;
    flex-direction: column;
    padding-bottom: 28px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 24px;
}

.header-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 12px;
}

.category-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 12px;
    background: var(--primary-bg);
    color: var(--primary);
    font-size: 12px;
    font-weight: 500;
}

.category-tag .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text);
}

.share-title {
    font-size: 22px;
    font-weight: 600;
    line-height: 1.45;
    color: var(--text);
    margin-bottom: 14px;
    word-break: break-word;
}

.header-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    color: var(--text-secondary);
    font-size: 13px;
}

.header-meta .meta-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.header-meta svg {
    width: 14px;
    height: 14px;
    opacity: 0.6;
}

.content-card {
    margin-bottom: 20px;
    min-width: 0;
}

.content-with-qr {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 32px;
    align-items: start;
}

.qr-sidebar {
    position: sticky;
    top: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 20px 16px;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    flex-shrink: 0;
    width: 180px;
}

.qr-sidebar .share-qr-wrap-sp {
    margin-bottom: 12px;
}

.btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 14px;
    border: 1px solid var(--border);
    background: var(--card-bg);
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    font-family: inherit;
}

.btn:hover {
    border-color: var(--primary);
    color: var(--primary);
}

.btn svg {
    width: 14px;
    height: 14px;
}

.btn.copied {
    border-color: var(--success);
    color: var(--success);
}

.content-body {
    font-size: 15px;
    line-height: 1.8;
    color: var(--text);
    word-break: break-word;
    overflow-wrap: break-word;
    contain: layout style;
}

.content-body img {
    max-width: 60%;
    max-height: 480px;
    object-fit: contain;
    height: auto;
    margin: 6px 0;
    display: block;
    background: var(--primary-bg);
    transition: opacity 0.3s ease;
}

.content-body img[data-src] {
    opacity: 0.6;
    min-height: 40px;
}

.content-body p {
    margin: 6px 0;
}

.content-body div {
    margin: 6px 0;
}

.content-body a {
    color: var(--primary);
    text-decoration: none;
}

.content-body a:hover {
    text-decoration: underline;
}

.content-body h1, .content-body h2, .content-body h3,
.content-body h4, .content-body h5, .content-body h6 {
    margin: 18px 0 10px;
    font-weight: 600;
    line-height: 1.4;
}

.content-body ul, .content-body ol {
    margin: 10px 0;
    padding-left: 24px;
}

.content-body blockquote {
    border-left: 2px solid var(--border);
    padding-left: 14px;
    margin: 12px 0;
    color: var(--text-secondary);
}

.content-body table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
}

.content-body td, .content-body th {
    border: 1px solid var(--border);
    padding: 8px 12px;
    text-align: left;
}

.content-body code {
    background: var(--primary-bg);
    padding: 2px 5px;
    font-size: 0.9em;
    font-family: "SF Mono", "Fira Code", Consolas, monospace;
}

.content-body pre {
    background: var(--primary-bg);
    padding: 14px;
    overflow-x: auto;
    margin: 12px 0;
}

.content-body pre code {
    background: none;
    padding: 0;
}

.share-qr-wrap-sp {
    background: #fff;
    padding: 10px;
    border-radius: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.06);
    border: 1px solid rgba(0,0,0,0.05);
}

.share-qr-img-sp {
    display: block;
    width: 132px;
    height: 132px;
    image-rendering: pixelated;
}

.share-qr-tip-sp {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px;
    color: var(--text-secondary);
    text-align: center;
    line-height: 1.5;
}

.share-qr-tip-sp svg {
    width: 13px;
    height: 13px;
    opacity: 0.6;
}

.watermark {
    text-align: center;
    padding: 32px 0 8px;
    color: var(--text-tertiary);
    font-size: 12px;
}

.watermark .wm-link {
    color: var(--text-secondary);
    text-decoration: none;
    cursor: pointer;
    transition: color 0.15s ease;
}

.watermark .wm-link:hover {
    color: var(--primary);
    text-decoration: underline;
}

.watermark .wm-divider {
    margin: 0 6px;
    opacity: 0.4;
}

.watermark svg {
    width: 12px;
    height: 12px;
    opacity: 0.4;
}

.state-container {
    max-width: 400px;
    margin: 80px auto;
    text-align: center;
    padding: 0 24px;
}

.state-icon {
    width: 64px;
    height: 64px;
    margin: 0 auto 16px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
}

.state-icon svg {
    width: 32px;
    height: 32px;
}

.state-icon.error {
    background: rgba(255,77,79,0.08);
    color: var(--danger);
}

.state-icon.warning {
    background: rgba(250,173,20,0.08);
    color: var(--warning);
}

.state-icon.info {
    background: rgba(0,0,0,0.04);
    color: var(--primary);
}

.state-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 8px;
}

.state-desc {
    font-size: 14px;
    color: var(--text-secondary);
    line-height: 1.6;
}

.password-card {
    background: var(--card-bg);
    padding: 40px 32px;
    margin: 60px auto 0;
    max-width: 400px;
    border: 1px solid var(--border);
    text-align: center;
}

.password-card .lock-icon {
    width: 56px;
    height: 56px;
    margin: 0 auto 16px;
    border-radius: 50%;
    background: var(--primary-bg);
    color: var(--primary);
    display: flex;
    align-items: center;
    justify-content: center;
}

.password-card .lock-icon svg {
    width: 26px;
    height: 26px;
}

.password-card h2 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 6px;
}

.password-card p {
    font-size: 14px;
    color: var(--text-secondary);
    margin-bottom: 20px;
}

.password-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.password-input {
    width: 100%;
    padding: 12px 16px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font-size: 15px;
    font-family: inherit;
    transition: border-color 0.15s ease;
    outline: none;
    text-align: center;
}

.password-input:focus {
    border-color: var(--primary);
}

.password-input.error {
    border-color: var(--danger);
    animation: shake 0.4s ease;
}

@keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-5px); }
    75% { transform: translateX(5px); }
}

.password-btn {
    width: 100%;
    padding: 12px;
    background: var(--primary);
    color: #fff;
    border: none;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s ease;
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
}

.password-btn:hover {
    opacity: 0.9;
}

.password-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.password-btn svg {
    width: 15px;
    height: 15px;
}

.password-error {
    color: var(--danger);
    font-size: 13px;
    min-height: 18px;
}

.skeleton {
    padding-bottom: 28px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 24px;
}

.skel-tag {
    width: 70px;
    height: 22px;
    background: var(--primary-bg);
    margin-bottom: 12px;
}

.skel-title {
    height: 26px;
    background: var(--primary-bg);
    margin-bottom: 12px;
    width: 70%;
}

.skel-meta {
    height: 14px;
    background: var(--primary-bg);
    width: 40%;
}

.skel-card {
    margin-top: 20px;
}

.skel-line {
    height: 14px;
    background: var(--primary-bg);
    margin-bottom: 12px;
}

.skel-line.short { width: 60%; }
.skel-line.medium { width: 80%; }

.lightbox {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.9);
    z-index: 9999;
    align-items: center;
    justify-content: center;
    cursor: zoom-out;
}

.lightbox.active {
    display: flex;
}

.lightbox img {
    max-width: 92%;
    max-height: 90vh;
    object-fit: contain;
}

.toast-container {
    position: fixed;
    top: 24px;
    right: 24px;
    z-index: 99999;
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: none;
}

.toast {
    background: white;
    border-radius: 10px;
    padding: 10px 14px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.1);
    border-left: 3px solid #007aff;
    font-size: 13px;
    color: #1f2937;
    max-width: 260px;
    pointer-events: auto;
    animation: toastIn 0.25s ease;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    will-change: transform, opacity;
    transform: translateZ(0);
}

.toast svg {
    display: inline-block;
    flex-shrink: 0;
}

.toast.toast-ok { border-left-color: #059669; }
.toast.toast-err { border-left-color: #dc2626; }
.toast.toast-warn { border-left-color: #d97706; }

@keyframes toastIn {
    from { opacity: 0; transform: translateX(20px); }
    to { opacity: 1; transform: translateX(0); }
}

/* ========== 分段功能 ========== */
.btn-segment {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 14px;
    border: 1px solid var(--border);
    background: var(--card-bg);
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    font-family: inherit;
}

.btn-segment:hover {
    border-color: var(--primary);
    color: var(--primary);
}

.btn-segment.active {
    background: rgba(0,122,255,0.08);
    border-color: #007aff;
    color: #005ecb;
}

.btn-segment svg {
    width: 14px;
    height: 14px;
}

.seg-count-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    margin-left: 2px;
    background: rgba(0,122,255,0.15);
    color: #007aff;
    font-size: 11px;
    font-weight: 700;
    border-radius: 9px;
    line-height: 1;
}

.btn-segment.active .seg-count-badge {
    background: #007aff;
    color: #fff;
}

.seg-info-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    margin-bottom: 14px;
    background: rgba(0,122,255,0.06);
    border: 1px solid rgba(0,122,255,0.2);
    color: #007aff;
    font-size: 13px;
}

.seg-info-banner svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
}

.seg-info-banner strong {
    font-weight: 700;
}

@media (prefers-color-scheme: dark) {
    .seg-count-badge {
        background: rgba(0,122,255,0.25);
        color: #7dd3fc;
    }
    .btn-segment.active .seg-count-badge {
        background: #007aff;
        color: #fff;
    }
    .seg-info-banner {
        background: rgba(0,122,255,0.12);
        border-color: rgba(0,122,255,0.3);
        color: #7dd3fc;
    }
    .btn-segment.active {
        background: rgba(0,122,255,0.15);
        color: #7dd3fc;
    }
}

.seg-cards-wrap {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.seg-card {
    border: 1px solid var(--border);
    background: var(--card-bg);
    overflow: hidden;
    contain: layout style paint;
    content-visibility: auto;
    contain-intrinsic-size: 200px;
}

.seg-card:hover {
    border-color: rgba(99,102,241,0.4);
}

.seg-card-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 12px;
    background: var(--primary-bg);
    border-bottom: 1px solid var(--border);
}

.seg-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 9px;
    background: rgba(0,122,255,0.12);
    color: #007aff;
    font-size: 12px;
    font-weight: 600;
    flex-shrink: 0;
}

@media (prefers-color-scheme: dark) {
    .seg-badge {
        background: rgba(99,102,241,0.2);
        color: #c7d2fe;
    }
    .seg-card-head {
        background: rgba(255,255,255,0.03);
    }
    .share-qr-wrap-sp {
        background: #fff;
        box-shadow: 0 2px 12px rgba(0,0,0,0.25);
        border-color: rgba(255,255,255,0.08);
    }
    .qr-sidebar {
        border-color: var(--border);
    }
}

.seg-meta {
    font-size: 12px;
    color: var(--text-tertiary);
    flex: 1;
}

.seg-copy-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border: 1px solid #007aff;
    background: #007aff;
    color: #fff;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
    font-family: inherit;
}

.seg-copy-btn:hover {
    background: #005ecb;
    border-color: #005ecb;
}

.seg-copy-btn:active {
    transform: scale(0.96);
}

.seg-copy-btn svg {
    width: 13px;
    height: 13px;
}

.seg-card-body {
    padding: 10px 14px;
    font-size: 15px;
    line-height: 1.6;
    color: var(--text);
    word-break: break-word;
    overflow-wrap: break-word;
}

.seg-card-body img {
    max-width: 55%;
    max-height: 360px;
    object-fit: contain;
    height: auto;
    margin: 6px 0;
    display: block;
    cursor: zoom-in;
    background: var(--primary-bg);
    transition: opacity 0.3s ease;
}

.seg-card-body img[data-src] {
    opacity: 0.6;
    min-height: 40px;
}

.seg-card-body p { margin: 3px 0; }
.seg-card-body div { margin: 3px 0; }

/* 相邻图片横排显示（连续多张 img 包装到 img-group） */
.img-group {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: flex-start;
    justify-content: flex-start;
    margin: 10px 0;
}
.img-group img {
    flex: 1 1 0;
    min-width: 0;
    max-width: calc(50% - 4px) !important;
    width: auto !important;
    height: auto !important;
    max-height: 480px;
    object-fit: contain;
    border-radius: 8px;
    margin: 0 !important;
    background: var(--primary-bg, #f3f4f6);
    transition: opacity 0.3s ease;
}
.img-group img[data-src] {
    opacity: 0.6;
    min-height: 80px;
}
/* 三张及以上时每张最多占 1/3 宽度 */
.img-group img + img + img {
    max-width: calc(33.333% - 6px);
}
.img-group img + img + img + img {
    max-width: calc(25% - 6px);
}

/* 手动分段符：主题色虚线 + 居中标签药丸，与分段 UI 风格一致 */
.content-body hr.segment-divider,
.share-content hr.segment-divider {
    border: none;
    border-top: 1.5px dashed #007aff;
    height: 0;
    margin: 6px 0;
    background: transparent;
    position: relative;
}
.content-body hr.segment-divider::after,
.share-content hr.segment-divider::after {
    content: '分段';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--bg);
    color: #007aff;
    border: 1px solid #007aff;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 10px;
    border-radius: 10px;
    letter-spacing: 1px;
    line-height: 1.4;
    white-space: nowrap;
    pointer-events: none;
}
@media (prefers-color-scheme: dark) {
    .content-body hr.segment-divider,
    .share-content hr.segment-divider {
        border-top-color: #818cf8;
    }
    .content-body hr.segment-divider::after,
    .share-content hr.segment-divider::after {
        color: #c7d2fe;
        border-color: #818cf8;
    }
}

/* 手动同段标记：分享页中仅保留内容显示，不显示边框样式（分段逻辑仍生效） */
.content-body div.segment-keep,
.share-content div.segment-keep,
.seg-card-body div.segment-keep {
    border: none;
    background: transparent;
    padding: 0;
    margin: 0;
}

.content-body div.segment-keep img,
.share-content div.segment-keep img,
.seg-card-body div.segment-keep img {
    margin: 3px 0;
}

/* 图片为 block 元素时，其后紧跟的 <br> 软换行会造成多出一行间距，统一隐藏 */
.content-body img + br,
.share-content img + br,
.seg-card-body img + br {
    display: none;
}

.content-body div.segment-keep p,
.share-content div.segment-keep p,
.seg-card-body div.segment-keep p {
    margin: 2px 0;
}

.content-body div.segment-keep div,
.share-content div.segment-keep div,
.seg-card-body div.segment-keep div {
    margin: 2px 0;
}

.content-body div.segment-keep .img-group,
.share-content div.segment-keep .img-group,
.seg-card-body div.segment-keep .img-group {
    margin: 4px 0;
}

.content-body div.segment-keep h1,
.content-body div.segment-keep h2,
.content-body div.segment-keep h3,
.content-body div.segment-keep h4,
.content-body div.segment-keep h5,
.content-body div.segment-keep h6,
.seg-card-body div.segment-keep h1,
.seg-card-body div.segment-keep h2,
.seg-card-body div.segment-keep h3,
.seg-card-body div.segment-keep h4,
.seg-card-body div.segment-keep h5,
.seg-card-body div.segment-keep h6 {
    margin: 6px 0 4px;
}

.content-body div.segment-keep ul,
.content-body div.segment-keep ol,
.seg-card-body div.segment-keep ul,
.seg-card-body div.segment-keep ol {
    margin: 4px 0;
    padding-left: 20px;
}

.content-body div.segment-keep blockquote,
.seg-card-body div.segment-keep blockquote {
    margin: 4px 0;
    padding-left: 10px;
}

@media (max-width: 768px) {
    .content-with-qr {
        grid-template-columns: 1fr;
        gap: 24px;
    }

    .qr-sidebar {
        position: static;
        width: 100%;
        flex-direction: row;
        justify-content: center;
        gap: 16px;
        padding: 16px;
    }

    .qr-sidebar .share-qr-wrap-sp {
        margin-bottom: 0;
    }

    .content-body img {
        max-width: 75%;
        max-height: 420px;
    }

    .seg-card-body img {
        max-width: 70%;
        max-height: 320px;
    }
}

@media (max-width: 640px) {
    .page {
        padding: 32px 16px 48px;
    }

    .share-title {
        font-size: 20px;
    }

    .header-meta {
        gap: 12px;
        font-size: 12px;
    }

    .state-container {
        margin: 48px auto;
    }

    .password-card {
        margin: 32px 12px 0;
        padding: 32px 24px;
    }

    .qr-sidebar {
        flex-direction: column;
    }

    .content-body img {
        max-width: 90%;
        max-height: 360px;
    }

    .seg-card-body img {
        max-width: 85%;
        max-height: 280px;
    }
}
</style>
</head>
<body>
<div id="app"></div>

<!-- 图片放大遮罩 -->
<div class="lightbox" id="lightbox">
    <img id="lightbox-img" src="" alt="预览大图">
</div>

<!-- 复制提示 -->
<div class="toast-container" id="toastContainer"></div>

<script>
(function() {
    'use strict';

    // ===== 配置 =====
    var TOKEN = <?php echo json_encode($token); ?>;
    var API_URL = 'admin/api.php';

    // ===== DOM 引用 =====
    var app = document.getElementById('app');
    var lightbox = document.getElementById('lightbox');
    var lightboxImg = document.getElementById('lightbox-img');

    // ===== 图标库（SVG） =====
    var icons = {
        clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
        eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
        calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
        copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
        check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
        unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>',
        alertTriangle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        alertCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
        xCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
        hourglass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12M6 22h12M6 2v6a6 6 0 0 0 12 0V2M6 22v-6a6 6 0 0 1 12 0v6"/></svg>',
        link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
        arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
        tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
        book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
        layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
        smartphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    // ===== XSS 过滤：清理 HTML =====
    var ALLOWED_TAGS = {
        'a': ['href', 'title', 'target', 'rel'],
        'abbr': [], 'b': [], 'blockquote': ['cite'],
        'br': [], 'caption': [], 'code': [],
        'del': [], 'div': ['class', 'style'],
        'dd': [], 'dl': [], 'dt': [],
        'em': [], 'figcaption': [], 'figure': [],
        'h1': ['style'], 'h2': ['style'], 'h3': ['style'],
        'h4': ['style'], 'h5': ['style'], 'h6': ['style'],
        'hr': ['class'], 'i': [], 'img': ['src', 'alt', 'title', 'width', 'height', 'style'],
        'ins': [], 'li': [], 'mark': [],
        'ol': ['start'], 'p': ['class', 'style'],
        'pre': [], 'q': ['cite'],
        's': [], 'small': [], 'span': ['class', 'style'],
        'strong': [], 'sub': [], 'sup': [],
        'table': ['class', 'style'],
        'tbody': [], 'td': ['colspan', 'rowspan', 'style'],
        'tfoot': [], 'th': ['colspan', 'rowspan', 'style'],
        'thead': [], 'tr': [],
        'u': [], 'ul': []
    };

    function sanitizeHTML(html) {
        if (!html || typeof html !== 'string') return '';
        try {
            var parser = new DOMParser();
            var doc = parser.parseFromString('<div id="__root">' + html + '</div>', 'text/html');
            var root = doc.getElementById('__root');
            if (!root) return '';
            cleanNode(root);
            return root.innerHTML;
        } catch (e) {
            // 降级：用正则做基础清理
            return html
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
                .replace(/<object[\s\S]*?<\/object>/gi, '')
                .replace(/<embed[\s\S]*?<\/embed>/gi, '')
                .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
                .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
                .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
                .replace(/javascript:/gi, '');
        }
    }

    function cleanNode(node) {
        var children = [];
        for (var i = 0; i < node.childNodes.length; i++) {
            children.push(node.childNodes[i]);
        }
        for (var j = 0; j < children.length; j++) {
            var child = children[j];
            if (child.nodeType === 1) {
                var tag = child.tagName.toLowerCase();
                if (!ALLOWED_TAGS.hasOwnProperty(tag)) {
                    // 非白名单标签：用其子节点替换自身（保留内容），但 script/iframe/style 直接删除
                    if (tag === 'script' || tag === 'iframe' || tag === 'object' || tag === 'embed' || tag === 'style' || tag === 'link' || tag === 'meta' || tag === 'form' || tag === 'input' || tag === 'button') {
                        child.parentNode.removeChild(child);
                    } else {
                        // 保留子内容，用 fragment 替换
                        var frag = node.ownerDocument.createDocumentFragment();
                        while (child.firstChild) {
                            frag.appendChild(child.firstChild);
                        }
                        child.parentNode.replaceChild(frag, child);
                    }
                } else {
                    // 清理属性
                    var allowed = ALLOWED_TAGS[tag];
                    var attrs = [];
                    for (var k = child.attributes.length - 1; k >= 0; k--) {
                        attrs.push(child.attributes[k]);
                    }
                    for (var a = 0; a < attrs.length; a++) {
                        var attrName = attrs[a].name.toLowerCase();
                        var attrVal = attrs[a].value;
                        // 移除所有 on* 事件属性
                        if (attrName.indexOf('on') === 0) {
                            child.removeAttribute(attrName);
                            continue;
                        }
                        // 检查 href/src 中的 javascript:
                        if ((attrName === 'href' || attrName === 'src') && /^\s*javascript:/i.test(attrVal)) {
                            child.removeAttribute(attrName);
                            continue;
                        }
                        // 非白名单属性
                        if (allowed.indexOf(attrName) === -1) {
                            child.removeAttribute(attrName);
                        }
                    }
                    // a 标签安全处理
                    if (tag === 'a') {
                        child.setAttribute('target', '_blank');
                        child.setAttribute('rel', 'noopener noreferrer');
                    }
                    // 递归清理子节点
                    cleanNode(child);
                }
            } else if (child.nodeType === 8) {
                // 移除注释节点
                child.parentNode.removeChild(child);
            }
        }
    }

    // ===== 日期格式化 =====
    function formatDate(dateStr) {
        if (!dateStr) return '未知';
        try {
            var d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            var now = new Date();
            var diff = (now - d) / 1000;
            if (diff < 60) return '刚刚';
            if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
            if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
            if (diff < 604800) return Math.floor(diff / 86400) + ' 天前';
            var y = d.getFullYear();
            var m = String(d.getMonth() + 1).padStart(2, '0');
            var day = String(d.getDate()).padStart(2, '0');
            var h = String(d.getHours()).padStart(2, '0');
            var min = String(d.getMinutes()).padStart(2, '0');
            return y + '-' + m + '-' + day + ' ' + h + ':' + min;
        } catch (e) {
            return dateStr;
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ===== API 调用 =====
    function fetchShare(password) {
        var url = API_URL + '?action=getShare&token=' + encodeURIComponent(TOKEN);
        var headers = { 'Accept': 'application/json' };
        if (password) {
            // 安全修复：通过自定义请求头传递密码，避免密码出现在 URL/日志/Referer 中
            headers['X-Share-Password'] = password;
        }
        return fetch(url, {
            method: 'GET',
            headers: headers
        }).then(function(res) {
            return res.json().then(function(data) {
                return data;
            }).catch(function() {
                return { success: false, error: 'parse_error', message: '服务器返回数据格式错误' };
            });
        }).catch(function() {
            return { success: false, error: 'network', message: '网络连接失败，请检查网络后重试' };
        });
    }

    // ===== 渲染：骨架屏 =====
    function renderSkeleton() {
        // 使用与正文相同的 .page 容器布局，避免骨架→正文切换时的布局抖动闪烁
        app.innerHTML =
            '<div class="page">' +
                '<div class="skeleton">' +
                    '<div class="skeleton-header">' +
                        '<div class="skel-tag"></div>' +
                        '<div class="skel-title"></div>' +
                        '<div class="skel-meta"></div>' +
                    '</div>' +
                    '<div class="skel-card">' +
                        '<div class="skel-line medium"></div>' +
                        '<div class="skel-line"></div>' +
                        '<div class="skel-line short"></div>' +
                        '<div class="skel-line"></div>' +
                        '<div class="skel-line medium"></div>' +
                    '</div>' +
                '</div>' +
            '</div>';
    }

    // ===== 渲染：错误状态 =====
    function renderError(type, message) {
        var icon, title, desc;
        switch (type) {
            case 'invalid':
            case 'parse_error':
            case 'network':
                icon = icons.link;
                title = '分享链接无效';
                desc = message || '该分享链接不存在或已被撤销，请确认链接是否正确';
                break;
            case 'expired':
                icon = icons.hourglass;
                title = '链接已过期';
                desc = message || '该分享链接已超过有效期，内容不再可访问';
                break;
            case 'view_limit':
                icon = icons.alertTriangle;
                title = '查看次数已达上限';
                desc = message || '该分享链接的查看次数已达上限，无法继续访问';
                break;
            case 'deleted':
                icon = icons.trash;
                title = '内容不存在';
                desc = message || '该分享的文案内容已被删除，无法查看';
                break;
            default:
                icon = icons.alertCircle;
                title = '加载失败';
                desc = message || '无法加载分享内容，请稍后重试';
        }
        app.innerHTML =
            '<div class="state-container">' +
                '<div class="state-icon ' + (type === 'expired' || type === 'view_limit' ? 'warning' : 'error') + '">' + icon + '</div>' +
                '<div class="state-title">' + escapeHtml(title) + '</div>' +
                '<div class="state-desc">' + escapeHtml(desc) + '</div>' +
            '</div>';
        document.title = title;
    }

    // ===== 渲染：密码表单 =====
    function renderPasswordForm(message) {
        document.title = '需要密码 - 分享内容';
        app.innerHTML =
            '<div class="password-card">' +
                '<div class="lock-icon">' + icons.lock + '</div>' +
                '<h2>需要访问密码</h2>' +
                '<p>该分享内容已加密，请输入密码查看</p>' +
                '<form class="password-form" id="pwd-form">' +
                    '<input type="password" class="password-input" id="pwd-input" placeholder="请输入访问密码" autocomplete="off" autocapitalize="off" autocorrect="off">' +
                    '<div class="password-error" id="pwd-error"></div>' +
                    '<button type="submit" class="password-btn" id="pwd-btn">' +
                        icons.unlock + '<span>验证并查看</span>' +
                    '</button>' +
                '</form>' +
            '</div>';

        var form = document.getElementById('pwd-form');
        var input = document.getElementById('pwd-input');
        var errorEl = document.getElementById('pwd-error');
        var btn = document.getElementById('pwd-btn');
        var btnText = btn.querySelector('span');

        if (message) {
            errorEl.textContent = message;
            input.classList.add('error');
        }

        setTimeout(function() { input.focus(); }, 100);

        form.addEventListener('submit', function(e) {
            e.preventDefault();
            var pwd = input.value.trim();
            if (!pwd) {
                errorEl.textContent = '请输入密码';
                input.classList.add('error');
                return;
            }
            errorEl.textContent = '';
            input.classList.remove('error');
            btn.disabled = true;
            btnText.textContent = '验证中...';

            fetchShare(pwd).then(function(res) {
                btn.disabled = false;
                btnText.textContent = '验证并查看';
                if (res && res.success && res.data) {
                    renderContent(res.data);
                } else if (res && res.needPassword) {
                    renderPasswordForm(res.message || '密码错误，请重新输入');
                } else if (res && res.error) {
                    if (res.error === 'invalid' || res.error === 'expired' || res.error === 'view_limit' || res.error === 'deleted') {
                        renderError(res.error, res.message);
                    } else {
                        renderPasswordForm(res.message || '密码错误，请重新输入');
                    }
                } else {
                    renderPasswordForm('密码错误，请重新输入');
                }
            });
        });

        input.addEventListener('input', function() {
            input.classList.remove('error');
            errorEl.textContent = '';
        });
    }

    // ===== 分段功能（内联实现，与前台 segment.js 算法一致）=====

    // 分段状态
    var segmentMode = false;
    var rawContent = '';      // 原始 HTML（已 sanitize）
    var segmentCache = [];    // 分段结果缓存（预计算元数据）

    /**
     * 智能拆分文案内容为段落数组
     * 策略（按优先级）：
     *   0. 手动同段标记 <div class="segment-keep">...</div> 整体作为一段（不拆分）
     *   1. 手动分段符 <hr class="segment-divider"> 强制切分
     *   2. StartFragment/EndFragment 标记
     *   3. 顶层块级元素
     *   4. 独立 <img>
     * 开启智能合并时（紧邻吸附规则）：相邻两段中至少有一段是图片则合并，
     *   实现"段落+配图"自动成组；标题段、segment-keep 段独立；
     *   段间存在空行/空段落（语义断点）时阻止向后合并
     * 返回：[{ html, safeHtml, charCount, imgCount, countLabel }]
     */
    function splitContentToSegments(html) {
        if (!html || !html.trim()) return [];

        // 优先级 1：手动分段符切分
        var dividerRegex = /<hr[^>]*class\s*=\s*["'][^"']*segment-divider[^"']*["'][^>]*>/gi;
        if (dividerRegex.test(html)) {
            dividerRegex.lastIndex = 0;
            var parts = [];
            var lastIdx = 0;
            var m;
            while ((m = dividerRegex.exec(html)) !== null) {
                if (m.index > lastIdx) parts.push(html.slice(lastIdx, m.index));
                lastIdx = m.index + m[0].length;
            }
            if (lastIdx < html.length) parts.push(html.slice(lastIdx));

            var collected = [];
            for (var p = 0; p < parts.length; p++) {
                var segs = splitContentToSegmentsInner(parts[p]);
                for (var q = 0; q < segs.length; q++) collected.push(segs[q]);
            }
            // 合并后再次去重相邻重复
            var deduped = [];
            for (var d = 0; d < collected.length; d++) {
                if (deduped.length === 0 || deduped[deduped.length - 1] !== collected[d]) {
                    deduped.push(collected[d]);
                }
            }
            // 包装为带元数据的对象
            return buildSegmentMeta(deduped);
        }

        return buildSegmentMeta(splitContentToSegmentsInner(html));
    }

    /**
     * 内部分段逻辑：按 StartFragment / 块级元素 / 独立图片切分 + 智能合并
     * 返回：HTML 字符串数组（不含元数据，由 buildSegmentMeta 包装）
     */
    function splitContentToSegmentsInner(html) {
        if (!html || !html.trim()) return [];
        var temp = document.createElement('div');
        temp.innerHTML = html;
        var segments = [];

        // 提取 StartFragment...EndFragment 之间的内容
        function extractFragments(htmlStr) {
            var res = [];
            var regex = /<!--\s*StartFragment\s*-->([\s\S]*?)<!--\s*EndFragment\s*-->/gi;
            var m;
            while ((m = regex.exec(htmlStr)) !== null) {
                var c = m[1].trim();
                if (c) res.push(c);
            }
            return res;
        }

        // 判断节点是否为空白段落（仅含 <br>、空白文本，且无图片）
        function isBlankSegment(el) {
            if (el.nodeType !== 1) return false;
            var tag = el.tagName;
            if (tag === 'BR') return true;
            if (tag === 'IMG') return false;
            if (el.querySelector('img')) return false;
            if (!el.textContent.trim()) return true;
            var txt = el.textContent.replace(/\u00a0/g, '').trim();
            return !txt;
        }

        // 遍历顶层子节点
        var children = Array.prototype.slice.call(temp.childNodes);
        for (var i = 0; i < children.length; i++) {
            var node = children[i];
            if (node.nodeType === 8) continue; // 注释节点跳过
            if (node.nodeType === 3) { // 文本节点
                var text = node.textContent.trim();
                if (text) segments.push(text);
                continue;
            }
            if (node.nodeType !== 1) continue; // 非元素节点跳过

            // segment-keep 容器：整体作为一段，不拆分内部结构
            if (node.tagName === 'DIV' && node.classList && node.classList.contains('segment-keep')) {
                segments.push(node.outerHTML);
                continue;
            }

            var inner = node.innerHTML || '';
            var hasFragments = inner.indexOf('StartFragment') !== -1;

            if (hasFragments) {
                var frags = extractFragments(inner);
                if (frags.length > 0) {
                    for (var f = 0; f < frags.length; f++) {
                        if (frags[f].trim()) segments.push(frags[f]);
                    }
                } else {
                    var stripped = inner.replace(/<!--\s*(Start|End)Fragment\s*-->/gi, '').trim();
                    if (stripped && !isBlankSegment(node)) segments.push(stripped);
                }
                continue;
            }

            // 无 Fragment 标记：整体作为一段（过滤空白）
            if (!isBlankSegment(node)) {
                segments.push(node.outerHTML);
            }
        }

        // 后处理：过滤空内容（纯文本为空且无图片）
        var cleaned = [];
        for (var s = 0; s < segments.length; s++) {
            var seg = segments[s];
            if (!seg || !seg.trim()) continue;
            var plain = stripHtml(seg).trim();
            var hasImg = /<img/i.test(seg);
            if (plain || hasImg) cleaned.push(seg);
        }

        // 去除相邻完全相同的段落
        var deduped = [];
        for (var d = 0; d < cleaned.length; d++) {
            if (deduped.length === 0 || deduped[deduped.length - 1] !== cleaned[d]) {
                deduped.push(cleaned[d]);
            }
        }

        // 智能合并：图文段紧邻吸附（文字+图片、图片+文字、图片+图片 自动成组）
        // 始终启用：所有合并规则都涉及图片，文字+文字不会合并，无副作用
        var afterMerge = mergeImageTextSegments(deduped);

        // 合并后再次去重
        var finalSegs = [];
        for (var e = 0; e < afterMerge.length; e++) {
            if (finalSegs.length === 0 || finalSegs[finalSegs.length - 1] !== afterMerge[e]) {
                finalSegs.push(afterMerge[e]);
            }
        }

        return finalSegs;
    }

    /**
     * 将 HTML 段落数组包装为带元数据的对象数组（供渲染使用）
     */
    function buildSegmentMeta(segs) {
        var result = [];
        for (var j = 0; j < segs.length; j++) {
            var segHtml = segs[j];
            var safeSeg = sanitizeHTML(segHtml);
            // 包装相邻图片为 img-group，让多图横排显示
            var wrappedSeg = wrapAdjacentImages(safeSeg);
            var lazySeg = makeImagesLazy(wrappedSeg);
            var plain2 = stripHtml(safeSeg).trim();
            var charCount = plain2 ? plain2.length : 0;
            var imgCount = (safeSeg.match(/<img/gi) || []).length;
            var countLabel = '';
            if (charCount > 0) {
                countLabel = imgCount > 0 ? charCount + ' 字 · ' + imgCount + ' 图' : charCount + ' 字';
            } else if (imgCount > 0) {
                countLabel = imgCount + ' 张图片';
            }
            result.push({
                html: segHtml,
                safeHtml: safeSeg,
                lazyHtml: lazySeg,
                charCount: charCount,
                imgCount: imgCount,
                countLabel: countLabel
            });
        }
        return result;
    }

    /**
     * 智能合并图文段（紧邻吸附规则）
     * 规则：
     *   - 连续的图片段 → 合并为一段（配套图组）
     *   - 图片段 + 紧邻的文字段（任意长度）→ 合并（图注/说明）
     *   - 文字段 + 紧邻的图片段 → 合并（段落配图）
     *   - mixed 段（已含图文）尾部无断点时 → 可向后吸收连续图片
     *   - 文字段 + 文字段 → 不合并（避免把无关段落合并在一起）
     *   - 标题段（h1-h6）→ 独立成段，不参与合并
     *   - segment-keep 段 → 独立，不参与合并
     *   - 段间存在语义断点（段尾 <br><br> / 空 <p></p> / 空 <div></div>，
     *     或下段开头有空行标记）→ 阻止向后合并，尊重用户排版意图
     */
    function mergeImageTextSegments(segments) {
        if (!segments || segments.length <= 1) return segments || [];

        var KEEP_REGEX = /<div[^>]*class\s*=\s*["'][^"']*segment-keep[^"']*["']/i;
        function isHeading(seg) { return /^<h[1-6]\b/i.test((seg || '').trim()); }
        function isKeepSegment(seg) { return KEEP_REGEX.test(seg || ''); }
        function hasTrailingBreak(seg) {
            var s = seg || '';
            return /<br\s*\/?>(\s|&nbsp;)*<br\s*\/?>\s*$/i.test(s)
                || /<p[^>]*>\s*(<br\s*\/?>)?\s*<\/p>\s*$/i.test(s)
                || /<div[^>]*>\s*(<br\s*\/?>)?\s*<\/div>\s*$/i.test(s);
        }
        function hasLeadingBreak(seg) {
            var s = (seg || '').replace(/^\s+/, '');
            return /^(\s|&nbsp;)*<br\s*\/?>(\s|&nbsp;)*<br\s*\/?>/i.test(s)
                || /^<p[^>]*>\s*(<br\s*\/?>)?\s*<\/p>/i.test(s)
                || /^<div[^>]*>\s*(<br\s*\/?>)?\s*<\/div>/i.test(s);
        }
        function getType(seg) {
            if (isKeepSegment(seg)) return 'keep';
            if (isHeading(seg)) return 'heading';
            var hasImg = /<img/i.test(seg);
            var plain = stripHtml(seg).trim();
            var hasText = plain.length > 0;
            if (hasImg && hasText) return 'mixed';
            if (hasImg) return 'image';
            if (hasText) return 'text';
            return 'empty';
        }
        function absorbFromImage(startIdx, prefix) {
            var merged = prefix;
            var hasTrailing = hasTrailingBreak(merged);
            var j = startIdx;

            // 循环吸收：图片 → 文字 → 图片 → 文字 → ...
            while (j < segments.length && !hasTrailing) {
                var seg = segments[j];
                var segType = getType(seg);

                // 1. 吸收连续图片或混合段（含图片的段）
                if ((segType === 'image' || segType === 'mixed') && !hasLeadingBreak(seg)) {
                    merged += seg;
                    j++;
                    hasTrailing = hasTrailingBreak(merged);
                    continue;
                }

                // 2. 吸收一段文字（任意长度）
                if (segType === 'text' && !hasLeadingBreak(seg)) {
                    merged += seg;
                    j++;
                    hasTrailing = hasTrailingBreak(merged);
                    // 继续循环，可能后面还有图片
                    continue;
                }

                // 其他类型或存在断点，停止吸收
                break;
            }

            return { merged: merged, nextIdx: j };
        }

        var result = [];
        var i = 0;
        while (i < segments.length) {
            var cur = segments[i];
            var curType = getType(cur);

            if (curType === 'keep' || curType === 'heading') {
                result.push(cur);
                i++;
                continue;
            }
            if (curType === 'image') {
                var r1 = absorbFromImage(i + 1, cur);
                result.push(r1.merged);
                i = r1.nextIdx;
                continue;
            }
            if (curType === 'text'
                && !hasTrailingBreak(cur)
                && i + 1 < segments.length
                && (getType(segments[i + 1]) === 'image' || getType(segments[i + 1]) === 'text' || getType(segments[i + 1]) === 'mixed')
                && !hasLeadingBreak(segments[i + 1])) {
                var r2 = absorbFromImage(i + 1, cur);
                result.push(r2.merged);
                i = r2.nextIdx;
                continue;
            }
            if (curType === 'mixed' && !hasTrailingBreak(cur)) {
                var merged = cur;
                var j = i + 1;
                while (j < segments.length
                       && getType(segments[j]) === 'image'
                       && !hasLeadingBreak(segments[j])
                       && !hasTrailingBreak(merged)) {
                    merged += segments[j];
                    j++;
                }
                result.push(merged);
                i = j;
                continue;
            }
            result.push(cur);
            i++;
        }
        return result;
    }

    /**
     * 构建分段视图 HTML（不写入 DOM，便于初始渲染时内联输出，避免二次渲染闪烁）
     */
    function buildSegmentViewHtml() {
        var segments = segmentCache;
        if (segments.length === 0) {
            return '<em style="color:var(--text-tertiary)">暂无可分段内容</em>';
        }

        // 仅多段时显示信息横幅；单段不显示（已通过按钮隐藏入口）
        var bannerHtml = segments.length > 1
            ? '<div class="seg-info-banner">' + icons.layers + '共 <strong>' + segments.length + '</strong> 段，可单独复制每段</div>'
            : '';

        var cardsHtml = '';
        for (var idx = 0; idx < segments.length; idx++) {
            var seg = segments[idx];
            cardsHtml +=
                '<div class="seg-card" data-seg-idx="' + idx + '">' +
                    '<div class="seg-card-head">' +
                        '<span class="seg-badge">段落 ' + (idx + 1) + '</span>' +
                        (seg.countLabel ? '<span class="seg-meta">' + escapeHtml(seg.countLabel) + '</span>' : '') +
                        '<button class="seg-copy-btn" data-copy-idx="' + idx + '">' + icons.copy + '复制本段</button>' +
                    '</div>' +
                    '<div class="seg-card-body">' + seg.lazyHtml + '</div>' +
                '</div>';
        }

        return bannerHtml + '<div class="seg-cards-wrap">' + cardsHtml + '</div>';
    }

    /**
     * 渲染分段视图（用于切换时重建）
     */
    function renderSegmentView() {
        var container = document.getElementById('segmentContainer');
        if (!container) return;
        container.innerHTML = buildSegmentViewHtml();
        initLazyLoad();
    }

    /**
     * 切换分段/全量视图
     */
    function toggleSegmentView() {
        segmentMode = !segmentMode;
        var contentBody = document.getElementById('content-body');
        var segmentContainer = document.getElementById('segmentContainer');
        var segBtn = document.getElementById('segmentToggleBtn');
        var copyBtn = document.getElementById('copy-btn');
        var copyBtnText = copyBtn ? copyBtn.querySelector('span') : null;

        if (segmentMode) {
            if (contentBody) contentBody.style.display = 'none';
            if (segmentContainer) {
                segmentContainer.style.display = '';
                // 仅在容器为空时才渲染（初始渲染已内联预构建，避免重复渲染闪烁）
                if (!segmentContainer.innerHTML.trim()) {
                    renderSegmentView();
                }
            }
            if (segBtn) segBtn.classList.add('active');
            if (copyBtnText) copyBtnText.textContent = '复制全部';
        } else {
            if (contentBody) contentBody.style.display = '';
            if (segmentContainer) segmentContainer.style.display = 'none';
            if (segBtn) segBtn.classList.remove('active');
            if (copyBtnText) copyBtnText.textContent = '复制内容';
        }
    }

    // ===== 渲染：内容 =====
    function renderContent(data) {
        document.title = (data.title || '分享内容') + ' - 分享内容';

        var title = data.title || '无标题';
        rawContent = sanitizeHTML(data.content || '');
        var categoryName = data.categoryName || (data.category && data.category.name) || '';
        var categoryColor = data.categoryColor || (data.category && data.category.color) || '#007aff';
        var createdAt = data.createdAt || '';
        var updatedAt = data.updatedAt || '';
        var expireAt = data.expireAt || null;
        var viewCount = data.viewCount != null ? data.viewCount : 0;
        var viewLimit = data.viewLimit || 0;
        var libraryName = data.libraryName || '文案库';
        var previewSegmentDefault = !!data.previewSegmentDefault;
        var pageUrl = window.location.href;

        // 预计算分段缓存
        segmentCache = splitContentToSegments(rawContent);
        // 根据后台配置初始化分段模式（仅多段内容才有分段意义）
        segmentMode = previewSegmentDefault && segmentCache.length > 1;

        // 内容图片懒加载版本（用于渲染）+ 相邻图片横排包装
        var lazyRawContent = makeImagesLazy(wrapAdjacentImages(rawContent));

        var updatedHtml = '';
        if (updatedAt && updatedAt !== createdAt) {
            updatedHtml = '<span class="meta-item">' + icons.edit + '更新于 ' + escapeHtml(formatDate(updatedAt)) + '</span>';
        }

        var categoryTagHtml = '';
        if (categoryName) {
            categoryTagHtml =
                '<span class="category-tag">' +
                    '<span class="dot" style="background:' + escapeHtml(categoryColor) + '"></span>' +
                    escapeHtml(categoryName) +
                '</span>';
        }

        // 分段按钮：仅当存在多段（>1）内容时才显示，并附带段数徽章
        var segToggleBtnHtml = segmentCache.length > 1
            ? '<button class="btn-segment" id="segmentToggleBtn" title="将文案拆分为 ' + segmentCache.length + ' 个段落，可单独复制每段">' + icons.layers + '<span>分段</span><span class="seg-count-badge">' + segmentCache.length + '</span></button>'
            : '';

        // 预构建分段视图 HTML，内联输出避免二次渲染闪烁
        var segmentViewHtml = segmentMode ? buildSegmentViewHtml() : '';

        app.innerHTML =
            '<div class="page">' +
                '<div class="header">' +
                    '<div class="header-inner">' +
                        '<div class="header-top">' +
                            categoryTagHtml +
                            '<div style="display:flex;gap:8px;">' +
                                segToggleBtnHtml +
                                '<button class="btn" id="copy-btn">' + icons.copy + '<span>' + (segmentMode ? '复制全部' : '复制内容') + '</span></button>' +
                            '</div>' +
                        '</div>' +
                        '<h1 class="share-title">' + escapeHtml(title) + '</h1>' +
                        '<div class="header-meta">' +
                            '<span class="meta-item">' + icons.clock + '创建于 ' + escapeHtml(formatDate(createdAt)) + '</span>' +
                            updatedHtml +
                            '<span class="meta-item">' + icons.eye + escapeHtml(String(viewCount)) + ' 次浏览</span>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="content-with-qr">' +
                    '<div class="content-card">' +
                        '<div class="content-body" id="content-body" style="' + (segmentMode ? 'display:none;' : '') + '">' + lazyRawContent + '</div>' +
                        '<div id="segmentContainer" style="' + (segmentMode ? '' : 'display:none;') + '">' + segmentViewHtml + '</div>' +
                    '</div>' +
                    '<div class="qr-sidebar">' +
                        '<div class="share-qr-wrap-sp">' +
                            '<img class="share-qr-img-sp" src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=8&data=' + encodeURIComponent(pageUrl) + '" alt="分享二维码">' +
                        '</div>' +
                        '<div class="share-qr-tip-sp">' +
                            icons.smartphone + '<span>手机扫码查看</span>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="watermark">' +
                    icons.book + '由 <a class="wm-link" href="./">Cpydes 文案库</a> 分享' +
                '</div>' +
            '</div>';

        // 如果默认分段模式，标记按钮激活态（分段 HTML 已内联预渲染）
        if (segmentMode) {
            var segBtn = document.getElementById('segmentToggleBtn');
            if (segBtn) segBtn.classList.add('active');
        }

        // 绑定分段切换按钮
        var segToggleBtn = document.getElementById('segmentToggleBtn');
        if (segToggleBtn) {
            segToggleBtn.addEventListener('click', toggleSegmentView);
        }

        // 绑定复制按钮
        var copyBtn = document.getElementById('copy-btn');
        copyBtn.addEventListener('click', function() {
            var html;
            if (segmentMode) {
                // 分段模式下复制全部（等价于原始内容）
                html = rawContent;
            } else {
                var contentBody = document.getElementById('content-body');
                html = contentBody.innerHTML;
            }
            var text = stripHtml(html).trim();
            if (!text && !/<img/i.test(html)) {
                showToast('没有可复制的内容');
                return;
            }
            copyRichContent(html, function(ok) {
                if (ok) {
                    var btnText = copyBtn.querySelector('span');
                    copyBtn.classList.add('copied');
                    btnText.textContent = '已复制';
                    showToast('已复制');
                    setTimeout(function() {
                        copyBtn.classList.remove('copied');
                        btnText.textContent = segmentMode ? '复制全部' : '复制内容';
                    }, 2000);
                } else {
                    showToast('复制失败，请手动选择复制');
                }
            });
        });

        // 绑定图片点击放大（事件委托已全局绑定）
        bindImageLightbox();

        // 初始化图片懒加载
        initLazyLoad();
    }

    // ===== 图片懒加载 =====
    var lazyImgObserver = null;

    function initLazyLoad() {
        if (!('IntersectionObserver' in window)) {
            // 降级：直接加载所有图片
            var imgs = document.querySelectorAll('img[data-src]');
            for (var i = 0; i < imgs.length; i++) {
                loadImg(imgs[i]);
            }
            return;
        }

        if (!lazyImgObserver) {
            lazyImgObserver = new IntersectionObserver(function(entries) {
                for (var i = 0; i < entries.length; i++) {
                    var entry = entries[i];
                    if (entry.isIntersecting) {
                        loadImg(entry.target);
                        lazyImgObserver.unobserve(entry.target);
                    }
                }
            }, {
                rootMargin: '200px 0px',
                threshold: 0.01
            });
        }

        // 观察所有带 data-src 的图片
        var imgs = document.querySelectorAll('img[data-src]');
        for (var j = 0; j < imgs.length; j++) {
            if (!imgs[j].getAttribute('data-lazy-observed')) {
                imgs[j].setAttribute('data-lazy-observed', '1');
                lazyImgObserver.observe(imgs[j]);
            }
        }
    }

    function loadImg(img) {
        var src = img.getAttribute('data-src');
        if (src) {
            img.onload = function() {
                img.style.opacity = '1';
                img.onload = null;
                img.onerror = null;
            };
            img.onerror = function() {
                img.style.opacity = '1';
                img.onload = null;
                img.onerror = null;
            };
            img.src = src;
            img.removeAttribute('data-src');
        }
    }

    // 将内容中的图片转换为懒加载格式
    function makeImagesLazy(html) {
        if (!html || typeof html !== 'string') return html;
        return html.replace(/<img([^>]*?)\s+src\s*=/gi, '<img$1 data-src=');
    }

    /**
     * 将 HTML 中相邻的 <img> 节点包装到 <div class="img-group"> 容器中
     * 让连续多张图片在 CSS 中以 flex 横排显示
     * 规则：
     *   - 仅当连续 ≥2 张 <img>（中间仅有空白文本或 <br>）才包装
     *   - 单图保持原样
     *   - 遇到非空文本节点或其他元素时，结束当前图片组
     */
    function wrapAdjacentImages(html) {
        if (!html || !html.trim()) return html || '';
        var temp = document.createElement('div');
        temp.innerHTML = html;

        var result = [];
        var imgBuffer = [];

        function flush() {
            if (imgBuffer.length === 0) return;
            if (imgBuffer.length === 1) {
                result.push(imgBuffer[0]);
            } else {
                result.push('<div class="img-group">' + imgBuffer.join('') + '</div>');
            }
            imgBuffer = [];
        }

        var children = Array.prototype.slice.call(temp.childNodes);
        for (var i = 0; i < children.length; i++) {
            var node = children[i];
            if (node.nodeType === 1 && node.tagName === 'IMG') {
                imgBuffer.push(node.outerHTML);
            } else if (node.nodeType === 1 && node.tagName === 'BR') {
                // <br> 不打破图片组，但也不计入（横排时忽略换行）
                continue;
            } else if (node.nodeType === 3) {
                // 纯空白文本节点不打破图片组
                if (!node.textContent.trim()) continue;
                // 非空文本：结束图片组，保留文本
                flush();
                result.push(node.textContent);
            } else if (node.nodeType === 1) {
                // 其他元素：结束图片组，保留元素
                flush();
                result.push(node.outerHTML);
            }
            // 注释节点等忽略
        }
        flush();

        return result.join('');
    }

    // ===== 图片点击放大（事件委托，只需绑定一次）=====
    function bindImageLightbox() {
        // 空实现 - 事件委托已在 init 中统一绑定
    }

    // 全局事件委托：图片点击放大
    app.addEventListener('click', function(e) {
        var target = e.target;
        if (target && target.tagName === 'IMG') {
            // 仅处理 content-body 和 seg-card-body 内的图片
            var inContent = target.closest('.content-body') || target.closest('.seg-card-body');
            if (inContent) {
                e.preventDefault();
                var dataSrc = target.getAttribute('data-src');
                var src = target.getAttribute('src') || target.currentSrc;
                var finalSrc = src && src.indexOf('data:') !== 0 ? src : dataSrc;
                if (finalSrc) {
                    // 如果图片还未加载，先加载再显示
                    if (dataSrc && (!src || src.indexOf('data:') === 0)) {
                        loadImg(target);
                    }
                    lightboxImg.src = finalSrc;
                    lightboxImg.alt = target.alt || '预览大图';
                    lightbox.classList.add('active');
                }
            }
        }

        // 分段复制按钮（事件委托）
        var copyBtn = target.closest('.seg-copy-btn');
        if (copyBtn) {
            e.preventDefault();
            e.stopPropagation();
            var idx = parseInt(copyBtn.getAttribute('data-copy-idx'), 10);
            if (isNaN(idx) || idx < 0 || idx >= segmentCache.length) return;
            var seg = segmentCache[idx];
            copyRichContent(seg.html, function(ok) {
                if (ok) {
                    var originalHtml = copyBtn.innerHTML;
                    copyBtn.innerHTML = icons.check + '已复制';
                    showToast('已复制');
                    setTimeout(function() {
                        copyBtn.innerHTML = originalHtml;
                    }, 2000);
                } else {
                    showToast('复制失败，请手动选择复制');
                }
            });
        }
    });

    lightbox.addEventListener('click', function() {
        lightbox.classList.remove('active');
        setTimeout(function() { lightboxImg.src = ''; }, 200);
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && lightbox.classList.contains('active')) {
            lightbox.classList.remove('active');
            setTimeout(function() { lightboxImg.src = ''; }, 200);
        }
    });

    // ===== 复制功能（与文库主应用一致，使用 execCommand + Selection 保证图片可复制）=====

    /**
     * 将 HTML 中图片的相对 src 转为绝对 URL
     */
    function convertImageUrlsToAbsolute(html) {
        var temp = document.createElement('div');
        temp.innerHTML = html;
        var imgs = temp.querySelectorAll('img');
        for (var i = 0; i < imgs.length; i++) {
            var rawSrc = imgs[i].getAttribute('src') || '';
            if (rawSrc && !rawSrc.startsWith('data:')) {
                try { imgs[i].src = new URL(rawSrc, location.href).href; } catch (e) {}
            }
        }
        return temp.innerHTML;
    }

    /**
     * 从 HTML 中剥离标签得到纯文本
     */
    function stripHtml(html) {
        var temp = document.createElement('div');
        temp.innerHTML = html;
        return (temp.textContent || temp.innerText || '').trim();
    }

    /**
     * 复制富文本（含图片）：与主应用 clipboard.js 同款实现
     */
    function copyRichContent(html, callback) {
        var absoluteHtml = convertImageUrlsToAbsolute(html);

        // 优先使用现代 Clipboard API
        if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
            try {
                var text = stripHtml(absoluteHtml);
                var blobHtml = new Blob([absoluteHtml], { type: 'text/html' });
                var blobText = new Blob([text], { type: 'text/plain' });
                var item = new ClipboardItem({
                    'text/html': blobHtml,
                    'text/plain': blobText
                });
                navigator.clipboard.write([item]).then(function() {
                    callback(true);
                }).catch(function() {
                    copyRichWithExecCommand(absoluteHtml, callback);
                });
            } catch (e) {
                copyRichWithExecCommand(absoluteHtml, callback);
            }
        } else {
            copyRichWithExecCommand(absoluteHtml, callback);
        }
    }

    /**
     * 传统 execCommand 复制富文本（兼容性最佳，主应用采用此方案）
     */
    function copyRichWithExecCommand(html, callback) {
        try {
            var div = document.createElement('div');
            div.innerHTML = html;
            div.style.position = 'fixed';
            div.style.top = '-9999px';
            div.style.left = '-9999px';
            div.style.zIndex = '-1000';
            div.style.opacity = '0';
            div.style.pointerEvents = 'none';
            document.body.appendChild(div);

            var selection = window.getSelection();
            var range = document.createRange();
            range.selectNodeContents(div);
            selection.removeAllRanges();
            selection.addRange(range);

            var successful = document.execCommand('copy');

            selection.removeAllRanges();
            document.body.removeChild(div);

            if (successful) {
                callback(true);
            } else {
                callback(false);
            }
        } catch (e) {
            callback(false);
        }
    }

    function copyText(text, callback) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() {
                callback(true);
            }).catch(function() {
                fallbackCopy(text, callback);
            });
        } else {
            fallbackCopy(text, callback);
        }
    }

    function fallbackCopy(text, callback) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.top = '-9999px';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            var ok = document.execCommand('copy');
            document.body.removeChild(ta);
            callback(ok);
        } catch (e) {
            callback(false);
        }
    }

    // ===== Toast 提示 =====
    var toastSvgCache = {
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M9 12l2 2 4-4"/></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/></svg>',
        warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 6v6"/><path d="M12 18h.01"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 14v-4"/><path d="M12 18h.01"/></svg>'
    };

    function showToast(msg, type) {
        var container = document.getElementById('toastContainer');
        if (!container) return;
        var t = type || 'info';
        var typeClass = t === 'success' ? 'toast-ok' : t === 'error' ? 'toast-err' : t === 'warning' ? 'toast-warn' : '';
        var svg = toastSvgCache[t] || toastSvgCache.info;

        var toast = document.createElement('div');
        toast.className = 'toast ' + typeClass;
        toast.innerHTML = '<span>' + svg + '</span><span>' + escapeHtml(msg) + '</span>';

        requestAnimationFrame(function() {
            container.appendChild(toast);
        });

        setTimeout(function() {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            setTimeout(function() {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3000);
    }

    // ===== 初始化 =====
    function init() {
        if (!TOKEN) {
            renderError('invalid', '缺少分享参数，请通过正确的分享链接访问');
            return;
        }
        renderSkeleton();
        fetchShare().then(function(res) {
            if (!res) {
                renderError('network', '服务器未返回数据，请稍后重试');
                return;
            }
            if (res.success && res.data) {
                renderContent(res.data);
            } else if (res.needPassword) {
                renderPasswordForm(res.message || '');
            } else if (res.error) {
                renderError(res.error, res.message);
            } else {
                renderError('invalid', res.message || '未知错误');
            }
        });
    }

    init();
})();
</script>
</body>
</html>
