'use strict';

/**
 * 访问端页面模板（服务端渲染骨架 + 注入 JSON 数据，由内嵌 JS 渲染列表）
 * 全部内嵌 CSS/JS，零外部依赖，移动端适配
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON 注入 <script> 时的安全处理 */
function jsonForScript(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const BASE_CSS = `
:root{
  --bg:#f4f6fa; --card:#ffffff; --line:#e5e9f2; --txt:#2b3445; --sub:#7a8499;
  --pri:#2f6bff; --pri-dark:#2456d6; --pri-bg:#eef3ff;
  --ok:#18a058; --ok-bg:#e8f7ef; --warn:#c47d10; --warn-bg:#fdf1e2; --err:#e5545c; --err-bg:#fdecec;
  --hover:#f8faff; --rowline:#f0f3f8; --track:#e9edf5; --dropbg:rgba(47,107,255,.08);
  --toast-bg:#2b3445; --fab-shadow:0 2px 10px rgba(30,40,70,.15);
}
html.dark{
  --bg:#15171c; --card:#1e2127; --line:#2d313b; --txt:#e4e7ee; --sub:#8b93a5;
  --pri:#4a80ff; --pri-dark:#5f92ff; --pri-bg:#212b45;
  --ok:#31bd75; --ok-bg:#17301f; --warn:#e0a23c; --warn-bg:#332a15; --err:#e5545c; --err-bg:#36201f;
  --hover:#242831; --rowline:#262a33; --track:#2d313b; --dropbg:rgba(74,128,255,.12);
  --toast-bg:#3a4050; --fab-shadow:0 2px 10px rgba(0,0,0,.4);
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;
  background:var(--bg);color:var(--txt);min-height:100vh;display:flex;flex-direction:column;
  -webkit-text-size-adjust:100%;transition:background-color .2s ease,color .2s ease}
a{color:var(--pri);text-decoration:none}
.wrap{width:100%;max-width:960px;margin:0 auto;padding:16px;flex:1}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  box-shadow:0 1px 3px rgba(30,40,70,.05);padding:18px;margin-bottom:14px;transition:background-color .2s ease,border-color .2s ease}
.badge{display:inline-block;font-size:12px;padding:2px 9px;border-radius:20px;vertical-align:2px}
.badge.ro{background:var(--pri-bg);color:var(--pri)}
.badge.rw{background:var(--ok-bg);color:var(--ok)}
.badge.exp{background:var(--warn-bg);color:var(--warn)}
.badge.pw{background:var(--warn-bg);color:var(--warn)}
h1{font-size:19px;margin-bottom:6px;word-break:break-all}
.sub{color:var(--sub);font-size:13px}
.crumb{display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:14px;margin:14px 2px 10px;word-break:break-all}
.crumb a{color:var(--pri)}
.crumb .sep{color:var(--sub);opacity:.6}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--card);
  color:var(--txt);border-radius:9px;padding:8px 14px;font-size:14px;cursor:pointer;user-select:none;transition:.15s;font-family:inherit}
.btn:hover{border-color:var(--pri);color:var(--pri)}
.btn.primary{background:var(--pri);border-color:var(--pri);color:#fff}
.btn.primary:hover{background:var(--pri-dark);color:#fff}
.btn.danger{color:var(--err)}
.btn.danger:hover{border-color:var(--err)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.search{flex:1;min-width:140px;border:1px solid var(--line);border-radius:9px;padding:8px 12px;font-size:14px;outline:none;background:var(--bg);color:var(--txt);font-family:inherit}
.search:focus{border-color:var(--pri)}
table{width:100%;border-collapse:collapse;font-size:14px}
th{color:var(--sub);font-weight:500;text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);white-space:nowrap;user-select:none}
th.sortable{cursor:pointer}
th.sortable:hover{color:var(--pri)}
td{padding:10px;border-bottom:1px solid var(--rowline);vertical-align:middle}
tr.row:hover{background:var(--hover)}
.name{word-break:break-all}
.icon{margin-right:6px}
.size,.time{white-space:nowrap;color:var(--sub);font-size:13px}
.ops{white-space:nowrap}
.ops a,.ops button{margin-right:8px;font-size:13px}
.linkbtn{background:none;border:none;color:var(--pri);cursor:pointer;font-family:inherit;padding:0}
.linkbtn:hover{text-decoration:underline}
input[type=checkbox]{width:16px;height:16px;accent-color:var(--pri);cursor:pointer}
.empty{text-align:center;color:var(--sub);padding:40px 0}
.progress-wrap{display:none;margin-top:12px}
.progress-item{margin-bottom:8px;font-size:13px}
.progress-bar{height:8px;background:var(--track);border-radius:6px;overflow:hidden;margin-top:4px}
.progress-bar>div{height:100%;background:var(--pri);width:0%;transition:width .2s;border-radius:6px}
.progress-bar.done>div{background:var(--ok)}
.footer{text-align:center;color:var(--sub);opacity:.7;font-size:12px;padding:18px 0 26px}
.dropmask{position:fixed;inset:0;background:var(--dropbg);border:3px dashed var(--pri);
  display:none;align-items:center;justify-content:center;font-size:20px;color:var(--pri);z-index:99;pointer-events:none;border-radius:12px}
.toast{position:fixed;left:50%;bottom:36px;transform:translateX(-50%);background:var(--toast-bg);color:var(--txt);
  padding:10px 20px;border-radius:10px;font-size:14px;display:none;z-index:100;max-width:86vw;
  box-shadow:0 8px 24px rgba(0,0,0,.25)}
@media(max-width:640px){
  .time{display:none}
  th.time-col{display:none}
  .wrap{padding:10px}
  .card{padding:13px}
}
dialog{border:none;border-radius:14px;padding:22px;max-width:88vw}
dialog::backdrop{background:rgba(20,28,45,.4)}
.qrbox img{width:240px;height:240px}
.theme-fab{position:fixed;top:14px;right:14px;z-index:98;width:38px;height:38px;border-radius:50%;
  border:1px solid var(--line);background:var(--card);cursor:pointer;font-size:17px;color:var(--txt);
  display:flex;align-items:center;justify-content:center;box-shadow:var(--fab-shadow);
  transition:transform .2s ease,background-color .2s ease;padding:0}
.theme-fab:hover{transform:scale(1.1) rotate(15deg)}
`;

/** 主题初始化（head 同步执行，防闪烁）+ 记忆到 localStorage、无记录时跟随系统 */
const THEME_HEAD_SCRIPT = `
<script>
(function(){
  try{
    var t = localStorage.getItem('lanshare-theme');
    if(t === 'dark' || (!t && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)){
      document.documentElement.classList.add('dark');
    }
  }catch(e){}
})();
</script>`;

/** 主题切换按钮（固定右上角）+ 点击逻辑 */
const THEME_FAB_HTML = `
<button class="theme-fab" id="themeBtn" type="button" title="切换明暗主题">🌙</button>
<script>
(function(){
  var btn = document.getElementById('themeBtn');
  function cur(){ return document.documentElement.classList.contains('dark'); }
  function paint(){ btn.textContent = cur() ? '\\u2600\\uFE0F' : '\\uD83C\\uDF19';
    btn.title = cur() ? '\\u5207\\u6362\\u5230\\u6D45\\u8272\\u6A21\\u5F0F' : '\\u5207\\u6362\\u5230\\u6DF1\\u8272\\u6A21\\u5F0F'; }
  btn.addEventListener('click', function(){
    document.documentElement.classList.toggle('dark');
    try{ localStorage.setItem('lanshare-theme', cur() ? 'dark' : 'light'); }catch(e){}
    paint();
  });
  paint();
})();
</script>`;

const FAVICON = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%93%A1%3C/text%3E%3C/svg%3E">`;

/**
 * 通用页面壳
 */
function pageShell(title, bodyHtml, extraHead = '') {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
${FAVICON}
<style>${BASE_CSS}</style>
${THEME_HEAD_SCRIPT}
${extraHead}
</head>
<body>
<div class="wrap">
${bodyHtml}
</div>
${THEME_FAB_HTML}
<div class="dropmask" id="dropmask">松开鼠标上传文件到当前目录</div>
<div class="toast" id="toast"></div>
</body>
</html>`;
}

function renderWelcome() {
  return pageShell('LanShare', `
<div class="card" style="text-align:center;padding:48px 18px">
  <div style="font-size:44px">📡</div>
  <h1 style="margin-top:10px">LanShare 服务运行中</h1>
  <p class="sub" style="margin-top:8px">这是一台局域网设备上的 LanShare 文件共享服务。<br>请使用共享链接访问具体内容，链接形如 http://IP:端口/s/xxxxxx/</p>
</div>
<div class="footer">Powered by LanShare</div>`);
}

function renderError(status, msg, detail) {
  return pageShell(`错误 ${status}`, `
<div class="card" style="text-align:center;padding:48px 18px">
  <div style="font-size:44px">${status === 404 ? '🔍' : '⚠️'}</div>
  <h1 style="margin-top:10px">${esc(msg)}</h1>
  ${detail ? `<p class="sub" style="margin-top:8px">${esc(detail)}</p>` : ''}
</div>
<div class="footer">Powered by LanShare</div>`);
}

function renderExpired(shareName) {
  return pageShell('共享已过期', `
<div class="card" style="text-align:center;padding:48px 18px">
  <div style="font-size:44px">⏰</div>
  <h1 style="margin-top:10px">共享已过期</h1>
  <p class="sub" style="margin-top:8px">「${esc(shareName)}」已到达设定的有效期，访问已自动失效。<br>如仍需访问，请联系共享提供者重新开启。</p>
</div>
<div class="footer">Powered by LanShare</div>`);
}

function renderLogin(share, error, lockSeconds) {
  const errHtml = error
    ? `<p style="color:var(--err);font-size:14px;margin-top:12px">${esc(error)}</p>` : '';
  return pageShell(`访问「${share.name}」`, `
<div class="card" style="max-width:380px;margin:9vh auto 0;text-align:center;padding:34px 26px">
  <div style="font-size:42px">🔐</div>
  <h1 style="margin-top:10px">${esc(share.name)}</h1>
  <p class="sub" style="margin-top:6px">此共享受密码保护，请输入访问密码</p>
  <form method="POST" action="login" style="margin-top:20px;text-align:left">
    <input class="search" style="width:100%;background:var(--card);color:var(--txt)" type="password" name="password"
      placeholder="访问密码" autofocus autocomplete="current-password" required>
    <button class="btn primary" style="width:100%;justify-content:center;margin-top:14px" type="submit">进入共享</button>
  </form>
  ${errHtml}
  ${lockSeconds ? `<p class="sub" style="margin-top:10px">失败次数过多，请等待 ${lockSeconds} 秒后重试</p>` : ''}
</div>
<div class="footer">Powered by LanShare</div>`);
}

/**
 * 目录列表页
 * ctx: {shareId, base, shareName, readonly, expiresAt, multiRoot, cwdRel,
 *       entries:[{n,d,s,t}], breadcrumb:[{name, href}...], serverNow}
 */
function renderShareList(ctx) {
  const items = ctx.items.map((it) => `
    <a class="share-item" href="/s/${esc(it.id)}/">
      <span class="si-name">📁 ${esc(it.name)}</span>
      <span class="badge ${it.readonly ? 'ro' : 'rw'}">${it.readonly ? '只读' : '读写'}</span>
      ${it.hasPassword ? '<span class="badge pw">🔒 密码</span>' : ''}
      <span class="si-go">进入 →</span>
    </a>`).join('');
  return pageShell('共享列表', `
<div class="card">
  <h1>📡 ${esc(ctx.hostname)} 的共享列表</h1>
  <p class="sub">以下是该设备上正在运行的共享（共 ${ctx.items.length} 个）。带 🔒 的共享点击后需输入访问密码。</p>
</div>
${items ? `<div class="card share-list">${items}</div>` : '<div class="card"><div class="empty">当前没有正在运行的共享</div></div>'}
<div class="footer">Powered by LanShare · 文件仅通过局域网传输</div>`, `
<style>
.share-list{padding:8px}
.share-item{display:flex;align-items:center;gap:10px;padding:14px 14px;border-bottom:1px solid var(--line);color:var(--txt)}
.share-item:last-child{border-bottom:none}
.share-item:hover{background:#f8faff}
.si-name{flex:1;font-size:15px;font-weight:600}
.si-go{color:var(--pri);font-size:13px}
.badge.pw{background:#fdeef5;color:#c25087}
</style>`);
}

const CODE_CSS = `
.codepage{background:#1e1e1e;border-radius:12px;overflow:auto;margin-top:14px;max-height:72vh;font-size:13px}
.codebar{display:flex;gap:14px;padding:10px 16px;background:#252526;border-bottom:1px solid #333;color:#9da5b4;font-size:12px;position:sticky;top:0}
.codebar b{color:#e8e8e8;font-weight:600}
.codebar .sp{flex:1}
.codebar a,.codebar button{color:#4daafc;text-decoration:none;background:none;border:none;cursor:pointer;font-size:12px;padding:0;font-family:inherit}
pre.code{margin:0;padding:12px 0;font-family:Consolas,"JetBrains Mono","Cascadia Code",Menlo,monospace;line-height:1.55;color:#d4d4d4}
.cl{display:block}
.ln{display:inline-block;width:56px;padding-right:14px;text-align:right;color:#5a6070;user-select:none;flex-shrink:0}
.lc{display:inline-block;min-width:100%;padding-right:16px}
.wraplines .lc{white-space:pre-wrap;word-break:break-all;vertical-align:top}
.tk-kw{color:#569cd6}.tk-str{color:#ce9178}.tk-num{color:#b5cea8}
.tk-com{color:#6a9955;font-style:italic}.tk-fn{color:#dcdcaa}
.tk-tag{color:#4ec9b0}.tk-attr{color:#9cdcfe}.tk-pl{color:#d4d4d4}
`;

function renderCodeView(ctx) {
  return pageShell(ctx.name + ' - 预览', `
<div class="card" style="padding:14px 18px">
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <div style="flex:1;min-width:200px">
      <h1 style="font-size:16px">📄 ${esc(ctx.name)}</h1>
      <p class="sub">${esc(ctx.sizeText)} · ${esc(ctx.enc)} · ${esc(ctx.langText)}${ctx.truncated ? ' · <span style=\"color:var(--warn)\">仅显示前 ' + ctx.linesShown + ' 行</span>' : ''}</p>
    </div>
    <button class="btn small" id="btnCopy">复制内容</button>
    <a class="btn small primary" href="${esc(ctx.rawUrl)}" download="${esc(ctx.name)}">下载文件</a>
    <button class="btn small" id="btnWrap">自动换行</button>
  </div>
</div>
<div class="codepage" id="codepage">
  <div class="codebar"><span><b>${esc(ctx.name)}</b> · ${esc(ctx.linesTotal)} 行</span><span class="sp"></span><span>LanShare 代码预览</span></div>
  <pre class="code" id="code">${ctx.html}</pre>
</div>
<div class="footer">Powered by LanShare · 文件仅通过局域网传输</div>`, `
<style>${CODE_CSS}</style>
<script>
document.addEventListener('DOMContentLoaded', function(){
const VIEW = ${jsonForScript({ rawUrl: ctx.rawUrl, name: ctx.name })};
const cp = document.getElementById('codepage');
document.getElementById('btnWrap').addEventListener('click', function(){
  cp.classList.toggle('wraplines');
  this.textContent = cp.classList.contains('wraplines') ? '不换行' : '自动换行';
});
document.getElementById('btnCopy').addEventListener('click', async function(){
  try{
    const r = await fetch(VIEW.rawUrl);
    const t = await r.text();
    await navigator.clipboard.writeText(t);
    this.textContent = '已复制';
    setTimeout(()=>{ this.textContent = '复制内容'; }, 1800);
  }catch(e){ this.textContent = '复制失败'; setTimeout(()=>{ this.textContent = '复制内容'; }, 1800); }
});
});
</script>`);
}

function renderListing(ctx) {
  const ro = !!ctx.readonly;
  const body = `
<div class="card">
  <h1>📁 ${esc(ctx.shareName)}
    <span class="badge ${ro ? 'ro' : 'rw'}">${ro ? '只读' : '读写'}</span>
    <span class="badge exp" id="expireBadge" style="display:none"></span>
  </h1>
  <p class="sub">通过局域网共享 · 请勿上传违法违规内容</p>
</div>

<div class="crumb" id="crumb"></div>

<div class="toolbar">
  ${ro ? '' : `
  <button class="btn primary" id="btnUpload">⬆ 上传文件</button>
  <button class="btn" id="btnMkdir">📁 新建文件夹</button>
  <button class="btn danger" id="btnDel" disabled>🗑 删除所选</button>
  <input type="file" id="fileInput" multiple style="display:none">
  `}
  <input class="search" id="search" type="text" placeholder="🔍 搜索当前目录…">
</div>

<div class="card" style="padding:4px 10px">
  <table>
    <thead>
      <tr>
        ${ro ? '' : '<th style="width:34px"><input type="checkbox" id="selAll"></th>'}
        <th class="sortable" data-by="n">名称</th>
        <th class="sortable size" data-by="s" style="width:90px">大小</th>
        <th class="sortable time time-col" data-by="t" style="width:150px">修改时间</th>
        <th style="width:110px" class="ops"></th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <div class="empty" id="empty" style="display:none">此目录为空</div>
</div>

<div class="progress-wrap card" id="progressWrap">
  <div class="sub" style="margin-bottom:6px">正在上传…</div>
  <div id="progressList"></div>
</div>

<div class="footer">Powered by LanShare · 文件仅通过局域网传输</div>

<script>
const DATA = ${jsonForScript(ctx)};
</script>
<script>
(function(){
'use strict';
const $ = (s)=>document.querySelector(s);
const ro = DATA.readonly;
const enc = encodeURIComponent;
function esc(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtSize(n){
  if(n==null||n<0) return '-';
  if(n < 1024) return n + ' B';
  const units=['KB','MB','GB','TB'];
  let v=n, i=-1;
  do{ v/=1024; i++; }while(v>=1024 && i<units.length-1);
  return v.toFixed(v>=100?0:1)+' '+units[i];
}
function fmtTime(ms){
  if(!ms) return '-';
  const d=new Date(ms);
  const p=(x)=>String(x).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes());
}
function toast(msg, ok){
  const t=$('#toast');
  t.textContent=msg;
  t.style.background = ok===false ? '#c0392b' : '#2b3445';
  t.style.display='block';
  clearTimeout(t._timer);
  t._timer=setTimeout(()=>{t.style.display='none';}, 2600);
}

/* ---- 过期倒计时 ---- */
(function(){
  if(!DATA.expiresAt) return;
  const badge=$('#expireBadge');
  function tick(){
    const left = DATA.expiresAt - (DATA.serverNow + (Date.now() - DATA.pageLoadedAt));
    if(left<=0){ badge.textContent='已过期'; badge.style.display='inline-block'; return; }
    const s=Math.floor(left/1000);
    const txt = s>=86400 ? Math.floor(s/86400)+' 天后过期'
      : s>=3600 ? Math.floor(s/3600)+' 小时 ' + Math.floor(s%3600/60) + ' 分后过期'
      : s>=60 ? Math.floor(s/60)+' 分钟后过期' : s+' 秒后过期';
    badge.textContent=txt; badge.style.display='inline-block';
  }
  DATA.pageLoadedAt = Date.now();
  tick(); setInterval(tick, 30000);
})();

/* ---- 面包屑 ---- */
(function(){
  const c=$('#crumb');
  let html='<a href="'+DATA.base+'/">🏠 首页</a>';
  DATA.breadcrumb.forEach((b,i)=>{
    html += '<span class="sep">/</span>';
    const last = i===DATA.breadcrumb.length-1;
    html += last ? '<span>'+esc(b.name)+'</span>' : '<a href="'+b.href+'">'+esc(b.name)+'</a>';
  });
  c.innerHTML=html;
})();

/* ---- 列表渲染 / 排序 / 搜索 ---- */
let sortBy='n', asc=true, kw='';
function rowHtml(e){
  const href = e.d ? DATA.base + e.rel + '/' : DATA.base + '/dl?path=' + enc(e.rel);
  const rawHref = DATA.base + '/raw?path=' + enc(e.rel);
  const ico = e.d ? '📁' : iconByExt(e.n);
  let ops = '';
  if(!e.d){
    ops += '<a href="'+DATA.base+'/dl?path='+enc(e.rel)+'">下载</a>';
    const pv = e.view ? (DATA.base+'/view?path='+enc(e.rel)) : (e.inline ? (DATA.base+'/raw?path='+enc(e.rel)) : null);
    if(pv) ops += '<a href="'+pv+'" target="_blank">预览</a>';
  }
  if(!ro) ops += '<button class="linkbtn" data-del="'+esc(e.rel)+'" data-name="'+esc(e.n)+'">删除</button>';
  return '<tr class="row" data-n="'+esc(e.n.toLowerCase())+'">'
    + (ro?'':'<td><input type="checkbox" class="sel" data-rel="'+esc(e.rel)+'" data-dir="'+(e.d?1:0)+'"></td>')
    + '<td class="name"><span class="icon">'+ico+'</span>'+(e.d
        ? '<a href="'+href+'">'+esc(e.n)+'</a>'
        : '<a href="'+href+'" download="'+esc(e.n)+'">'+esc(e.n)+'</a>')+'</td>'
    + '<td class="size">'+(e.d?'-':fmtSize(e.s))+'</td>'
    + '<td class="time time-col">'+fmtTime(e.t)+'</td>'
    + '<td class="ops">'+ops+'</td></tr>';
}
function iconByExt(n){
  const ext=(n.match(/\\.[^.]+$/)||[''])[0].toLowerCase();
  if(['.jpg','.jpeg','.png','.gif','.webp','.bmp','.svg','.avif','.ico'].includes(ext)) return '🖼️';
  if(['.mp4','.mkv','.avi','.mov','.webm','.m4v','.flv','.ts'].includes(ext)) return '🎬';
  if(['.mp3','.wav','.flac','.m4a','.aac','.ogg','.opus','.ape'].includes(ext)) return '🎵';
  if(['.pdf'].includes(ext)) return '📕';
  if(['.doc','.docx','.wps','.rtf'].includes(ext)) return '📄';
  if(['.xls','.xlsx','.csv','.et'].includes(ext)) return '📊';
  if(['.ppt','.pptx'].includes(ext)) return '📽️';
  if(['.zip','.rar','.7z','.gz','.tar','.bz2','.xz'].includes(ext)) return '🗜️';
  if(['.exe','.msi','.apk','.dmg','.app','.bat','.sh'].includes(ext)) return '⚙️';
  if(['.txt','.md','.log','.json','.xml','.html','.css','.js','.py','.java','.c','.cpp','.h','.vue'].includes(ext)) return '📝';
  return '📄';
}
function visibleEntries(){
  let list = DATA.entries.filter(e=>!kw || e.n.toLowerCase().includes(kw));
  const dir=e=>e.d?0:1;
  list.sort((a,b)=>{
    let r = dir(a)-dir(b);
    if(r!==0) return r;
    if(sortBy==='s'){ r=(a.s||0)-(b.s||0); }
    else if(sortBy==='t'){ r=(a.t||0)-(b.t||0); }
    else { r=a.n.localeCompare(b.n,'zh-CN'); }
    return asc?r:-r;
  });
  return list;
}
function render(){
  const list=visibleEntries();
  $('#rows').innerHTML=list.map(rowHtml).join('');
  $('#empty').style.display = list.length?'none':'block';
  document.querySelectorAll('th.sortable').forEach(th=>{
    th.textContent = th.textContent.replace(/[▲▼]\\s*$/,'').trim()
      + (th.dataset.by===sortBy?(asc?' ▲':' ▼'):'');
  });
  updateDelBtn();
}
document.querySelectorAll('th.sortable').forEach(th=>{
  th.addEventListener('click',()=>{
    if(sortBy===th.dataset.by) asc=!asc; else {sortBy=th.dataset.by; asc=true;}
    render();
  });
});
$('#search').addEventListener('input',e=>{kw=e.target.value.trim().toLowerCase();render();});

/* ---- 选择与删除 ---- */
function updateDelBtn(){
  if(ro) return;
  const n=document.querySelectorAll('.sel:checked').length;
  const b=$('#btnDel');
  b.disabled = n===0;
  b.textContent = n? '🗑 删除所选('+n+')' : '🗑 删除所选';
}
document.addEventListener('change',e=>{
  if(e.target.classList.contains('sel')) updateDelBtn();
  if(e.target.id==='selAll'){
    document.querySelectorAll('.sel').forEach(c=>c.checked=e.target.checked);
    updateDelBtn();
  }
});
async function postJSON(url,obj){
  const r = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
  let j=null; try{ j=await r.json(); }catch(_){}
  if(!r.ok || !j || !j.ok) throw new Error((j&&j.error)||('HTTP '+r.status));
  return j;
}
$('#btnDel') && $('#btnDel').addEventListener('click', async ()=>{
  const items=[...document.querySelectorAll('.sel:checked')].map(c=>({rel:c.dataset.rel,dir:c.dataset.dir==='1'}));
  if(!items.length) return;
  const names=items.map(i=>i.rel.split('/').filter(Boolean).pop()).join('、');
  if(!confirm('确定删除以下内容？\\n'+names+'\\n\\n文件夹将连同其内容一并删除，此操作不可恢复！')) return;
  try{
    const j=await postJSON(DATA.base+'/del',{paths:items.map(i=>i.rel)});
    const okN=j.results.filter(r=>r.ok).length;
    const failN=j.results.length-okN;
    toast(failN? ('已删除 '+okN+' 项，'+failN+' 项失败') : ('已删除 '+okN+' 项'), !failN);
    setTimeout(()=>location.reload(), 600);
  }catch(err){ toast('删除失败：'+err.message,false); }
});
/* 行内删除按钮 */
document.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-del]');
  if(!btn) return;
  if(!confirm('确定删除「'+btn.dataset.name+'」？此操作不可恢复！')) return;
  try{
    await postJSON(DATA.base+'/del',{paths:[btn.dataset.del]});
    toast('已删除');
    setTimeout(()=>location.reload(), 500);
  }catch(err){ toast('删除失败：'+err.message,false); }
});

/* ---- 新建文件夹 ---- */
$('#btnMkdir') && $('#btnMkdir').addEventListener('click', async ()=>{
  const name=prompt('请输入新文件夹名称：');
  if(!name) return;
  if(/[\\\\/:*?"<>|]/.test(name) || name==='.' || name==='..'){ toast('名称包含非法字符',false); return; }
  try{
    await postJSON(DATA.base+'/mkdir',{path:DATA.cwdRel,name:name});
    toast('已创建');
    setTimeout(()=>location.reload(), 500);
  }catch(err){ toast('创建失败：'+err.message,false); }
});

/* ---- 上传 ---- */
const progressWrap=$('#progressWrap'), progressList=$('#progressList');
function setProgress(id,name,pct,done){
  let it=document.getElementById(id);
  if(!it){
    it=document.createElement('div');
    it.className='progress-item'; it.id=id;
    progressList.appendChild(it);
  }
  it.innerHTML='<div>'+esc(name)+' — '+(done?(pct>=100?'完成':'已取消'):(pct+'%'))+'</div>'
    +'<div class="progress-bar'+(done&&pct>=100?' done':'')+'"><div style="width:'+pct+'%"></div></div>';
}
function uploadFile(file, idx, onOneDone){
  const id='up'+idx;
  setProgress(id,file.name,0,false);
  const xhr=new XMLHttpRequest();
  const url=DATA.base+'/up?path='+enc(joinRel(DATA.cwdRel,file.name));
  xhr.open('POST',url);
  xhr.upload.onprogress=(ev)=>{ if(ev.lengthComputable) setProgress(id,file.name,Math.floor(ev.loaded/ev.total*100),false); };
  xhr.onload=()=>{
    let ok = xhr.status>=200 && xhr.status<300;
    if(ok){ setProgress(id,file.name,100,true); }
    else{
      let msg='HTTP '+xhr.status;
      try{ msg=JSON.parse(xhr.responseText).error||msg; }catch(_){}
      setProgress(id,file.name,0,true); 
      const el=document.getElementById(id); if(el) el.innerHTML='<div style="color:var(--err)">上传失败：'+esc(file.name)+' — '+esc(msg)+'</div>';
    }
    onOneDone(ok);
  };
  xhr.onerror=()=>{ setProgress(id,file.name,0,true); onOneDone(false); };
  xhr.send(file);
}
function joinRel(cwd,name){
  if(!cwd || cwd==='/') return '/'+name;
  return cwd.replace(/\\/+$/,'')+'/'+name;
}
function startUpload(files){
  if(!files.length) return;
  progressWrap.style.display='block';
  let doneCount=0, okCount=0;
  [...files].forEach((f,i)=>{
    uploadFile(f,i,(ok)=>{
      doneCount++; if(ok) okCount++;
      if(doneCount===files.length){
        toast('上传完成：成功 '+okCount+' 个，失败 '+(files.length-okCount)+' 个', okCount>0);
        setTimeout(()=>location.reload(), 900);
      }
    });
  });
}
$('#btnUpload') && $('#btnUpload').addEventListener('click',()=>$('#fileInput').click());
$('#fileInput') && $('#fileInput').addEventListener('change',e=>{ startUpload(e.target.files); e.target.value=''; });

/* ---- 拖拽上传 ---- */
if(!ro){
  let dragDepth=0;
  window.addEventListener('dragenter',e=>{ e.preventDefault(); dragDepth++; $('#dropmask').style.display='flex'; });
  window.addEventListener('dragleave',e=>{ e.preventDefault(); if(--dragDepth<=0){dragDepth=0;$('#dropmask').style.display='none';} });
  window.addEventListener('dragover',e=>e.preventDefault());
  window.addEventListener('drop',e=>{
    e.preventDefault(); dragDepth=0; $('#dropmask').style.display='none';
    if(e.dataTransfer && e.dataTransfer.files.length) startUpload(e.dataTransfer.files);
  });
}
render();
})();
</script>`;
  return pageShell(ctx.shareName, body);
}

module.exports = { pageShell, renderWelcome, renderError, renderExpired, renderLogin, renderListing, renderCodeView, renderShareList, esc };
