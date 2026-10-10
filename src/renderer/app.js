'use strict';

/* LanShare 渲染进程逻辑 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let state = null;          // 主进程全量状态
let formRoots = [];        // 新建/编辑表单中的目录 [{dir, alias}]
let editId = null;         // 编辑中的共享 id
let logsCache = [];
let pollTimer = null;

/* ---------------- 主题（明暗切换，偏好持久化到主进程） ---------------- */

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  $('#btnTheme').textContent = dark ? '☀️' : '🌙';
  $('#btnTheme').title = dark ? '切换到浅色模式' : '切换到深色模式';
}

function initTheme() {
  // boot 时同步执行：首帧即为正确主题，无闪白
  applyTheme(state && state.settings.theme === 'dark');
}

function toggleTheme() {
  const dark = !document.documentElement.classList.contains('dark');
  applyTheme(dark);
  window.lanShare.saveSettings({ theme: dark ? 'dark' : 'light' }).then((s) => { state = s; }).catch(() => {});
}

/* ---------------- 工具 ---------------- */

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 2600);
}

function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtDuration(ms) {
  if (ms <= 0) return '已过期';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + ' 秒';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' 分钟';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时 ' + (m % 60) + ' 分';
  const d = Math.floor(h / 24);
  return d + ' 天 ' + (h % 24) + ' 小时';
}

async function copyText(txt) {
  try {
    await navigator.clipboard.writeText(txt);
    toast('已复制到剪贴板');
  } catch (_) {
    // 降级
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
    toast('已复制到剪贴板');
  }
}

const ACTION_MAP = {
  visit: '访问', browse: '浏览', download: '下载', preview: '预览', upload: '上传',
  delete: '删除', mkdir: '新建目录', login: '登录', 'login-fail': '登录失败',
  limit: '限流', create: '创建共享', update: '修改共享', remove: '删除共享',
  start: '启动共享', stop: '停止共享', expired: '共享过期'
};

/* ---------------- 状态加载与渲染 ---------------- */

async function refresh() {
  try {
    state = await window.lanShare.getState();
    renderTop();
    renderShares();
    renderSettings();
  } catch (err) {
    console.error(err);
  }
}

function renderTop() {
  $('#ver').textContent = 'v' + (state.version || '');
  $('#ver2').textContent = 'v' + (state.version || '');
  $('#portText').textContent = state.port;
  const running = state.shares.some((s) => s.running);
  $('#serverDot').className = 'dot ' + (running ? 'on' : 'off');
  $('#serverText').textContent = running
    ? `共享服务运行中（${state.shares.filter((s) => s.running).length} 个共享）`
    : '共享服务未启动';
}

function rootDisplay(roots) {
  return roots.map((r) => (roots.length > 1 ? `[${r.alias}] ` : '') + r.dir).join('　+　');
}

function renderShares() {
  const list = $('#shareList');
  if (!state.shares.length) {
    list.innerHTML = `<div class="card"><div class="empty">还没有共享会话。<br>添加一个文件夹，一键共享给局域网内的其他设备。</div></div>`;
    return;
  }
  list.innerHTML = state.shares.map((s) => {
    const expired = s.expiresAt && Date.now() > s.expiresAt;
    const statusBadge = expired
      ? '<span class="badge exp">已过期</span>'
      : s.running
        ? '<span class="badge run">运行中 · ' + s.connections + ' 连接</span>'
        : '<span class="badge stop">已停止</span>';
    const roBadge = s.readonly ? '<span class="badge ro">只读</span>' : '<span class="badge rw">读写</span>';
    const pwBadge = s.hasPassword ? '<span class="badge pw">🔒 密码</span>' : '';
    const expireText = s.expiresAt
      ? (expired ? '已于 ' + fmtTime(s.expiresAt) + ' 过期' : '剩余 ' + fmtDuration(s.expiresAt - Date.now()))
      : '永久有效';

    const urlsHtml = s.running
      ? (s.urls.length
        ? s.urls.map((u) => `
          <div class="url-row">
            <span class="iface">${escHtml(u.name)}</span>
            <a href="${escHtml(u.url)}" data-url="${escHtml(u.url)}">${escHtml(u.url)}</a>
            <button class="btn small ghost" data-copy="${escHtml(u.url)}">复制</button>
          </div>`).join('')
        : '<div class="hint">未检测到局域网网卡 IP，请检查网络连接。</div>')
      : '';

    return `
    <div class="share-card" data-id="${s.id}">
      <div class="share-head">
        <div style="flex:1;min-width:0">
          <div class="share-title">📁 ${escHtml(s.name)} ${statusBadge} ${roBadge} ${pwBadge}</div>
          <div class="share-paths">${escHtml(rootDisplay(s.roots))}</div>
          <div class="share-meta">
            <span>有效期：<b>${expireText}</b></span>
            <span>限速：<b>${s.speedLimitKBps ? s.speedLimitKBps + ' KB/s' : '不限'}</b></span>
            <span>连接上限：<b>${s.maxConnections ? s.maxConnections : '不限'}</b></span>
            <span>上传上限：<b>${s.uploadMaxMB ? s.uploadMaxMB + ' MB' : '不限'}</b></span>
          </div>
        </div>
      </div>
      ${urlsHtml ? '<div class="share-urls">' + urlsHtml + '</div>' : ''}
      <div class="share-actions">
        ${expired
          ? '<button class="btn small" data-act="edit">修改有效期</button>'
          : s.running
            ? '<button class="btn small danger" data-act="stop">⏹ 停止共享</button>'
            : '<button class="btn small primary" data-act="start">▶ 启动共享</button>'}
        ${s.running ? '<button class="btn small" data-act="qr">📱 二维码</button>' : ''}
        <button class="btn small" data-act="edit">编辑</button>
        <button class="btn small" data-act="reveal">打开目录</button>
        <button class="btn small danger" data-act="remove">删除</button>
      </div>
    </div>`;
  }).join('');
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------------- 表单 ---------------- */

function renderRootList() {
  const box = $('#rootList');
  if (!formRoots.length) {
    box.innerHTML = '<div class="empty-roots">尚未选择目录，点击下方按钮添加（可选择整个磁盘）</div>';
    return;
  }
  box.innerHTML = formRoots.map((r, i) => `
    <div class="root-item">
      <span>📁</span>
      <span class="dir" title="${escHtml(r.dir)}">${escHtml(r.dir)}</span>
      <span class="hint-inline">显示为</span>
      <input class="alias-input" data-idx="${i}" placeholder="别名" value="${escHtml(r.alias || '')}">
      <span class="rm" data-rm="${i}" title="移除">✕</span>
    </div>`).join('');
}

function resetForm() {
  editId = null;
  formRoots = [];
  $('#formTitle').textContent = '新建共享';
  $('#btnSubmit').textContent = '创建并启动共享';
  $('#btnCancelEdit').hidden = true;
  $('#fName').value = '';
  $('#fPassword').value = '';
  $('#fExpire').value = '0';
  $('#fSpeed').value = '0';
  $('#fConn').value = '0';
  $('#fUploadMax').value = '0';
  $$('input[name=fRo]').forEach((r) => { r.checked = r.value === 'ro'; });
  renderRootList();
}

async function fillFormForEdit(id) {
  const s = state.shares.find((x) => x.id === id);
  if (!s) return;
  editId = id;
  formRoots = s.roots.map((r) => ({ dir: r.dir, alias: r.alias }));
  $('#formTitle').textContent = '编辑共享：' + s.name;
  $('#btnSubmit').textContent = '保存修改';
  $('#btnCancelEdit').hidden = false;
  $('#fName').value = s.name;
  $('#fPassword').value = s.hasPassword ? s.password : '';
  $('#fSpeed').value = s.speedLimitKBps;
  $('#fConn').value = s.maxConnections;
  $('#fUploadMax').value = s.uploadMaxMB;
  $$('input[name=fRo]').forEach((r) => { r.checked = (r.value === 'rw') === !s.readonly; });
  // 清理上次编辑遗留的自定义剩余时长选项，避免下拉框无限增长
  const PRESETS = ['0', '30', '60', '360', '1440', '4320', '10080'];
  [...$('#fExpire').options].forEach((o) => { if (!PRESETS.includes(o.value)) o.remove(); });
  // 有效期：剩余分钟（已过期/永久 → 默认 1 天 / 永久）
  if (!s.expiresAt) $('#fExpire').value = '0';
  else if (Date.now() > s.expiresAt) $('#fExpire').value = '1440';
  else {
    const mins = Math.max(1, Math.round((s.expiresAt - Date.now()) / 60000));
    const opts = [...$('#fExpire').options].map((o) => +o.value);
    if (opts.includes(mins)) $('#fExpire').value = String(mins);
    else {
      const opt = document.createElement('option');
      opt.value = String(mins); opt.textContent = '剩余 ' + fmtDuration(s.expiresAt - Date.now());
      $('#fExpire').appendChild(opt);
      $('#fExpire').value = String(mins);
    }
  }
  renderRootList();
  $('#formCard').scrollIntoView({ behavior: 'smooth' });
}

async function submitForm() {
  if (!formRoots.length) { toast('请先选择要共享的文件夹', true); return; }
  const name = $('#fName').value.trim() || '我的共享';
  const roRadio = [...$$('input[name=fRo]')].find((r) => r.checked);
  const readonly = roRadio ? roRadio.value === 'ro' : true;
  const password = $('#fPassword').value;
  const expireMin = +$('#fExpire').value || 0;
  const cfg = {
    name,
    roots: formRoots,
    readonly,
    password,
    expiresAt: expireMin ? Date.now() + expireMin * 60000 : 0,
    speedLimitKBps: Math.max(0, +$('#fSpeed').value || 0),
    maxConnections: Math.max(0, Math.floor(+$('#fConn').value || 0)),
    uploadMaxMB: Math.max(0, Math.floor(+$('#fUploadMax').value || 0))
  };
  try {
    if (editId) {
      state = await window.lanShare.updateShare(editId, cfg);
      toast('共享已更新');
    } else {
      state = await window.lanShare.addShare({ ...cfg, start: true });
      toast('共享已创建并启动');
    }
    resetForm();
    renderTop();
    renderShares();
  } catch (err) {
    toast('操作失败：' + (err.message || err), true);
  }
}

/* ---------------- 二维码 ---------------- */

let qrUrls = [], qrIndex = 0;

async function openQr(share) {
  if (!share.urls.length) { toast('没有可用的局域网地址', true); return; }
  qrUrls = share.urls;
  qrIndex = 0;
  $('#qrTitle').textContent = '扫码访问「' + share.name + '」';
  renderQrIps();
  await updateQr();
  $('#qrDialog').showModal();
}

function renderQrIps() {
  $('#qrIps').innerHTML = qrUrls.map((u, i) =>
    `<button data-i="${i}" class="${i === qrIndex ? 'active' : ''}">${escHtml(u.address)}</button>`).join('');
}

async function updateQr() {
  const u = qrUrls[qrIndex];
  $('#qrUrl').value = u.url;
  $('#qrImg').src = await window.lanShare.makeQr(u.url);
}

/* ---------------- 日志 ---------------- */

const LOG_PAGE = 200;

async function loadLogs() {
  logsCache = await window.lanShare.getLogs(0) || [];
  renderLogs();
}

function renderLogs() {
  const body = $('#logBody');
  const rows = logsCache.slice(-LOG_PAGE).reverse();
  $('#logEmpty').style.display = rows.length ? 'none' : 'block';
  body.innerHTML = rows.map((e) => `
    <tr>
      <td>${fmtTime(e.t)}</td>
      <td>${escHtml(e.shareName || e.shareId || '-')}</td>
      <td>${escHtml((e.ip || '').replace('::ffff:', '').replace('::1', '127.0.0.1'))}</td>
      <td><span class="log-act ${e.ok ? (['login-fail', 'limit', 'delete', 'upload'].includes(e.action) ? 'info' : 'ok') : 'fail'}">${ACTION_MAP[e.action] || escHtml(e.action)}</span></td>
      <td class="detail">${escHtml(e.detail || '')}</td>
    </tr>`).join('');
}

/* ---------------- 设置 ---------------- */

function renderSettings() {
  if (!state) return;
  if (document.activeElement !== $('#sPort')) $('#sPort').value = state.settings.port;
  $('#sAutoRestore').checked = !!state.settings.autoRestore;
  $('#sLogToDisk').checked = !!state.settings.logToDisk;
  $('#sShowList').checked = !!state.settings.showShareList;
}

async function initAutostart() {
  try {
    const v = await window.lanShare.getAutostart();
    $('#sAutostart').checked = !!v;
    $('#autostartHint').textContent = state && !state.isPackaged ? '（开发模式运行，打包安装后生效更可靠）' : '';
  } catch (_) {}
}

/* ---------------- 事件绑定 ---------------- */

function bind() {
  // 标签页
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    ['shares', 'logs', 'settings'].forEach((n) => {
      $('#tab-' + n).hidden = n !== t.dataset.tab;
    });
    if (t.dataset.tab === 'logs') loadLogs();
    if (t.dataset.tab === 'settings') initAutostart();
  }));

  // 表单
  $('#btnAddRoot').addEventListener('click', async () => {
    const dir = await window.lanShare.pickFolder();
    if (!dir) return;
    if (formRoots.some((r) => r.dir.toLowerCase() === dir.toLowerCase())) {
      toast('该目录已在列表中', true); return;
    }
    const alias = dir.split(/[\\/]/).filter(Boolean).pop() || dir;
    formRoots.push({ dir, alias: /[A-Za-z]:/.test(alias) ? alias.toUpperCase().replace(/[\\/]/g, '') + '盘' : alias });
    renderRootList();
  });
  $('#rootList').addEventListener('input', (e) => {
    if (e.target.classList.contains('alias-input')) {
      formRoots[+e.target.dataset.idx].alias = e.target.value;
    }
  });
  $('#rootList').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { formRoots.splice(+rm.dataset.rm, 1); renderRootList(); }
  });
  $('#btnSubmit').addEventListener('click', submitForm);
  $('#btnReset').addEventListener('click', resetForm);
  $('#btnCancelEdit').addEventListener('click', resetForm);

  // 共享卡片（事件委托）
  $('#shareList').addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) { copyText(copyBtn.dataset.copy); return; }
    const link = e.target.closest('a[data-url]');
    if (link) { e.preventDefault(); window.lanShare.openExternal(link.dataset.url); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.share-card').dataset.id;
    const share = state.shares.find((s) => s.id === id);
    const act = btn.dataset.act;
    try {
      if (act === 'start') {
        const r = await window.lanShare.startShare(id);
        if (!r.ok) toast('启动失败：' + r.error, true);
        state = r.state; renderTop(); renderShares();
      } else if (act === 'stop') {
        state = await window.lanShare.stopShare(id);
        renderTop(); renderShares();
      } else if (act === 'qr') {
        await openQr(share);
      } else if (act === 'edit') {
        await fillFormForEdit(id);
      } else if (act === 'remove') {
        if (!confirm('确定删除共享「' + share.name + '」？\n（仅停止共享服务，不会删除磁盘文件）')) return;
        state = await window.lanShare.removeShare(id);
        toast('已删除共享');
        renderTop(); renderShares();
      } else if (act === 'reveal') {
        window.lanShare.revealShare(id);
      }
    } catch (err) {
      toast('操作失败：' + (err.message || err), true);
    }
  });

  // 二维码弹窗
  $('#qrIps').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    qrIndex = +b.dataset.i;
    renderQrIps();
    await updateQr();
  });
  $('#qrCopy').addEventListener('click', () => copyText($('#qrUrl').value));
  $('#qrClose').addEventListener('click', () => $('#qrDialog').close());

  // 日志
  $('#btnLogRefresh').addEventListener('click', loadLogs);
  $('#btnLogClear').addEventListener('click', () => { logsCache = []; renderLogs(); toast('已清空显示（磁盘日志不受影响）'); });
  $('#btnLogOpen').addEventListener('click', async () => {
    const ok = await window.lanShare.openLogDir();
    if (!ok) toast('日志写盘未开启，请先在设置中开启', true);
  });
  $('#btnLogExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(logsCache, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lanshare-logs-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // 设置
  $('#btnSavePort').addEventListener('click', async () => {
    const port = +$('#sPort').value;
    if (!port || port < 1024 || port > 65535) { toast('端口范围 1024 - 65535', true); return; }
    state = await window.lanShare.saveSettings({ port });
    toast('端口已保存为 ' + port + '，重启共享后生效');
    renderTop();
  });
  $('#btnSaveSettings').addEventListener('click', async () => {
    state = await window.lanShare.saveSettings({
      autoRestore: $('#sAutoRestore').checked,
      logToDisk: $('#sLogToDisk').checked,
      showShareList: $('#sShowList').checked
    });
    toast('设置已保存');
  });
  $('#sAutostart').addEventListener('change', async (e) => {
    const ok = await window.lanShare.setAutostart(e.target.checked);
    toast(ok ? '已开启开机自启' : '已关闭开机自启');
    e.target.checked = !!ok;
  });
  $('#repoLink').addEventListener('click', (e) => {
    e.preventDefault();
    window.lanShare.openExternal('https://github.com/ajxdp/lan-share');
  });

  // 主题
  $('#btnTheme').addEventListener('click', toggleTheme);

  // 主进程事件
  window.lanShare.onStateChanged(() => refresh());
  window.lanShare.onNotice((msg) => toast(msg));
  window.lanShare.onLog((entry) => {
    // 日志页可见时实时追加（无需手动刷新）
    if (!$('#tab-logs').hidden) {
      logsCache.push(entry);
      renderLogs();
    }
  });
}

/* ---------------- 启动 ---------------- */

async function boot() {
  // 主题尽快应用（state 未就绪时先按上次偏好/系统偏好猜测，state 到达后校正）
  applyTheme(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  bind();
  resetForm();
  await refresh();
  initTheme();
  await initAutostart();
  pollTimer = setInterval(refresh, 5000); // 轻量轮询保持连接数/状态新鲜
}

boot();
