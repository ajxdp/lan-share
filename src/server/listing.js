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
  --pri:#2f6bff; --pri-dark:#2456d6; --ok:#18a058; --warn:#e6a23c; --err:#e5545c;
  --radius:12px;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;
  background:var(--bg);color:var(--txt);min-height:100vh;display:flex;flex-direction:column;-webkit-text-size-adjust:100%}
a{color:var(--pri);text-decoration:none}
.wrap{width:100%;max-width:960px;margin:0 auto;padding:16px;flex:1}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  box-shadow:0 1px 3px rgba(30,40,70,.05);padding:18px;margin-bottom:14px}
.badge{display:inline-block;font-size:12px;padding:2px 9px;border-radius:20px;vertical-align:2px}
.badge.ro{background:#eef2ff;color:#4c6ef5}
.badge.rw{background:#e8f7ef;color:#18a058}
.badge.exp{background:#fdf1e2;color:#c47d10}
h1{font-size:19px;margin-bottom:6px;word-break:break-all}
.sub{color:var(--sub);font-size:13px}
.crumb{display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:14px;margin:14px 2px 10px;word-break:break-all}
.crumb a{color:var(--pri)}
.crumb .sep{color:#b6bfd0}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--card);
  color:var(--txt);border-radius:9px;padding:8px 14px;font-size:14px;cursor:pointer;user-select:none;transition:.15s}
.btn:hover{border-color:var(--pri);color:var(--pri)}
.btn.primary{background:var(--pri);border-color:var(--pri);color:#fff}
.btn.primary:hover{background:var(--pri-dark)}
.btn.danger{color:var(--err)}
.btn.danger:hover{border-color:var(--err)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.search{flex:1;min-width:140px;border:1px solid var(--line);border-radius:9px;padding:8px 12px;font-size:14px;outline:none;background:var(--bg)}
.search:focus{border-color:var(--pri)}
table{width:100%;border-collapse:collapse;font-size:14px}
th{color:var(--sub);font-weight:500;text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);white-space:nowrap;user-select:none}
th.sortable{cursor:pointer}
th.sortable:hover{color:var(--pri)}
td{padding:10px;border-bottom:1px solid #f0f3f8;vertical-align:middle}
tr.row:hover{background:#f8faff}
.name{word-break:break-all}
.icon{margin-right:6px}
.size,.time{white-space:nowrap;color:var(--sub);font-size:13px}
.ops{white-space:nowrap}
.ops a,.ops button{margin-right:8px;font-size:13px}
input[type=checkbox]{width:16px;height:16px;accent-color:var(--pri);cursor:pointer}
.empty{text-align:center;color:var(--sub);padding:40px 0}
.progress-wrap{display:none;margin-top:12px}
.progress-item{margin-bottom:8px;font-size:13px}
.progress-bar{height:8px;background:#e9edf5;border-radius:6px;overflow:hidden;margin-top:4px}
.progress-bar>div{height:100%;background:var(--pri);width:0%;transition:width .2s;border-radius:6px}
.progress-bar.done>div{background:var(--ok)}
.footer{text-align:center;color:#aab3c5;font-size:12px;padding:18px 0 26px}
.dropmask{position:fixed;inset:0;background:rgba(47,107,255,.08);border:3px dashed var(--pri);
  display:none;align-items:center;justify-content:center;font-size:20px;color:var(--pri);z-index:99;pointer-events:none;border-radius:12px}
.toast{position:fixed;left:50%;bottom:36px;transform:translateX(-50%);background:#2b3445;color:#fff;
  padding:10px 20px;border-radius:10px;font-size:14px;display:none;z-index:100;max-width:86vw}
@media(max-width:640px){
  .time{display:none}
  th.time-col{display:none}
  .wrap{padding:10px}
  .card{padding:13px}
}
dialog{border:none;border-radius:14px;padding:22px;max-width:88vw}
dialog::backdrop{background:rgba(20,28,45,.4)}
.qrbox img{width:240px;height:240px}
`;

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
<style>${BASE_CSS}</style>
${extraHead}
</head>
<body>
<div class="wrap">
${bodyHtml}
</div>
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
    <input class="search" style="width:100%;background:#fff" type="password" name="password"
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
    if(e.inline) ops += '<a href="'+rawHref+'" target="_blank">预览</a>';
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
function relOf(e){ return e.rel; }
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

module.exports = { pageShell, renderWelcome, renderError, renderExpired, renderLogin, renderListing, esc };
