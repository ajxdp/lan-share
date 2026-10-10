'use strict';

/**
 * LanShare 主进程：窗口 / 托盘 / IPC / 共享服务生命周期
 */

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { Store } = require('./store');
const { ShareHub } = require('../server/hub');

let win = null;
let tray = null;
let hub = null;
let store = null;
let quitting = false;
let demoMode = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
  app.whenReady().then(init);
}

/* ------------------------------------------------------------------ */

async function init() {
  demoMode = process.argv.includes('--demo');
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  store = new Store(userData);

  const settings = store.settings;
  hub = new ShareHub({
    port: settings.port,
    logDir: settings.logToDisk ? path.join(userData, 'logs') : null,
    showShareList: !!settings.showShareList
  });

  // hub 事件 → 渲染进程 / 托盘
  hub.on('state-changed', () => {
    if (win && !win.isDestroyed()) win.webContents.send('state-changed');
    if (tray) require('./tray').refreshTrayMenu(tray, buildTrayModel());
    persistRunningState();
  });
  hub.on('share-expired', (share) => {
    notify('共享已过期', '「' + share.name + '」已到达有效期，共享自动停止。');
    store.markRunning(share.id, false);
  });
  hub.on('log', (entry) => {
    // 实时转发日志给渲染进程（日志页自动追加）
    if (win && !win.isDestroyed()) win.webContents.send('log', entry);
  });

  registerIpc();
  createWindow();
  tray = require('./tray').createTray(buildTrayModel(), {
    onShow: showMainWindow,
    onQuit: () => app.quit(),
    onToggleShare: async (id, wantStart) => {
      try {
        if (wantStart) await startShareSafe(id);
        else hub.stopShare(id);
      } catch (err) {
        notify('操作失败', String(err.message || err));
      }
    }
  });

  await restoreShares();

  if (demoMode) await setupDemoShares();
}

function buildTrayModel() {
  return {
    shares: hub ? [...hub.shares.values()].map((s) => ({
      id: s.id,
      name: s.name,
      running: s.running,
      expired: !!(s.expiresAt && Date.now() > s.expiresAt)
    })) : []
  };
}

async function restoreShares() {
  if (!store.settings.autoRestore) return;
  for (const rec of store.shares) {
    if (!rec.lastRunning) continue;
    // 已过期的不恢复
    if (rec.expiresAt && Date.now() > rec.expiresAt) continue;
    try {
      const share = hub.addShare(store.toShareConfig(rec));
      // 历史版本 bug 可能产生无 id 的配置记录；恢复时把新生成的 id 回写
      if (share.id !== rec.id) {
        store.removeShare(rec.id);
        store.upsertShare({ ...share, lastRunning: true });
      }
      await startShareSafe(share.id);
    } catch (err) {
      // 目录不存在等情况：跳过该共享
      console.warn('[restore] 恢复共享失败:', rec.name, err.message);
    }
  }
}

/** 启动共享；端口被占用时自动 +1 重试 */
async function startShareSafe(id) {
  for (let i = 0; i < 10; i++) {
    try {
      await hub.startShare(id);
      return hub.actualPort || hub.port;
    } catch (err) {
      if (err && err.code === 'EADDRINUSE') {
        const next = hub.port + 1;
        await hub.setPort(next);
        store.setSettings({ port: next });
        notify('端口被占用', '默认端口不可用，已自动改用端口 ' + next + '。');
        continue;
      }
      throw err;
    }
  }
  throw new Error('无法找到可用端口（连续 10 次被占用）');
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function serializeShare(s) {
  const urls = s.running ? hub.getShareUrls(s.id) : [];
  return {
    id: s.id,
    name: s.name,
    roots: s.roots.map((r) => ({ alias: r.alias, dir: r.dir })),
    readonly: s.readonly,
    password: s.password,
    hasPassword: !!s.password,
    expiresAt: s.expiresAt || 0,
    speedLimitKBps: s.speedLimitKBps,
    maxConnections: s.maxConnections,
    uploadMaxMB: s.uploadMaxMB,
    createdAt: s.createdAt,
    running: s.running,
    connections: s.connections,
    urls
  };
}

function fullState() {
  return {
    version: app.getVersion(),
    demo: demoMode,
    settings: store.settings,
    port: hub.actualPort || hub.port,
    isPackaged: app.isPackaged,
    shares: [...hub.shares.values()].map(serializeShare),
    ifaces: hub.getNetworkInterfaces(),
    logDir: hub.logDir
  };
}

function registerIpc() {
  ipcMain.handle('state:get', () => fullState());

  ipcMain.handle('share:add', async (_e, cfg) => {
    const share = hub.addShare({
      id: cfg.id,
      name: cfg.name,
      roots: cfg.roots,
      readonly: cfg.readonly,
      password: cfg.password || '',
      expiresAt: +cfg.expiresAt || 0,
      speedLimitKBps: +cfg.speedLimitKBps || 0,
      maxConnections: +cfg.maxConnections || 0,
      uploadMaxMB: +cfg.uploadMaxMB || 0
    });
    store.upsertShare({ ...cfg, id: share.id, lastRunning: !!cfg.start });
    if (cfg.start !== false) await startShareSafe(share.id);
    return fullState();
  });

  ipcMain.handle('share:update', async (_e, id, patch) => {
    const rec = { ...patch, id };
    await hub.updateShare(id, {
      name: patch.name,
      roots: patch.roots,
      readonly: patch.readonly,
      password: patch.password,
      expiresAt: patch.expiresAt,
      speedLimitKBps: patch.speedLimitKBps,
      maxConnections: patch.maxConnections,
      uploadMaxMB: patch.uploadMaxMB
    });
    const s = hub.shares.get(id);
    store.upsertShare({ ...rec, id, lastRunning: s ? s.running : false });
    return fullState();
  });

  ipcMain.handle('share:remove', (_e, id) => {
    hub.removeShare(id);
    store.removeShare(id);
    return fullState();
  });

  ipcMain.handle('share:start', async (_e, id) => {
    try {
      await startShareSafe(id);
      return { ok: true, state: fullState() };
    } catch (err) {
      return { ok: false, error: err.message, state: fullState() };
    }
  });

  ipcMain.handle('share:stop', (_e, id) => {
    hub.stopShare(id);
    return fullState();
  });

  ipcMain.handle('share:qrcode', async (_e, url) => {
    const QRCode = require('qrcode');
    return QRCode.toDataURL(url, { width: 480, margin: 1, errorCorrectionLevel: 'M' });
  });

  ipcMain.handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择要共享的文件夹（可选择磁盘根目录）',
      properties: ['openDirectory', 'dontAddToRecent']
    });
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths[0];
  });

  ipcMain.handle('settings:save', (_e, patch) => {
    const settings = store.setSettings(patch);
    if (patch.logToDisk !== undefined) {
      hub.logDir = settings.logToDisk ? path.join(app.getPath('userData'), 'logs') : null;
      if (hub.logDir) fs.mkdirSync(hub.logDir, { recursive: true });
    }
    if (patch.showShareList !== undefined) {
      hub.showShareList = !!settings.showShareList;
    }
    if (patch.theme !== undefined) {
      // 窗口背景色跟随主题，避免切换时闪白
      if (win && !win.isDestroyed()) {
        win.setBackgroundColor(settings.theme === 'dark' ? '#15171c' : '#f4f6fa');
      }
    }
    return fullState();
  });

  ipcMain.handle('autostart:get', () => {
    const s = app.getLoginItemSettings();
    return s.openAtLogin;
  });

  ipcMain.handle('autostart:set', (_e, v) => {
    // 单文件 portable 版每次解压路径不同，登录项会指向临时目录而失效
    if (v && process.env.PORTABLE_EXECUTABLE_DIR) {
      notify('单文件版不支持开机自启', '单文件版每次运行的解压路径不同，开机自启会失效。如需开机自启请使用安装版（Setup）。');
      store.setSettings({ autostart: false });
      return false;
    }
    app.setLoginItemSettings({ openAtLogin: !!v, path: process.execPath });
    store.setSettings({ autostart: !!v });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('logs:get', (_e, since) => hub.getLogs(since || 0));
  ipcMain.handle('logs:clear', () => { hub.logs = []; return true; });
  ipcMain.handle('logs:openDir', async () => {
    if (!hub.logDir) return false;
    fs.mkdirSync(hub.logDir, { recursive: true });
    await shell.openPath(hub.logDir);
    return true;
  });

  ipcMain.handle('app:openExternal', (_e, url) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('app:revealShare', (_e, id) => {
    const s = hub.shares.get(id);
    if (s && s.roots.length) shell.openPath(s.roots[0].dir);
  });
}

/* ------------------------------------------------------------------ */
/* 窗口 / 托盘支撑                                                      */
/* ------------------------------------------------------------------ */

function createWindow() {
  const dark = store && store.settings.theme === 'dark';
  win = new BrowserWindow({
    width: 1040,
    height: 740,
    minWidth: 880,
    minHeight: 580,
    title: 'LanShare - 局域网文件共享',
    icon: path.join(__dirname, '../../build/icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: dark ? '#15171c' : '#f4f6fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  try { require('electron').Menu.setApplicationMenu(null); } catch (_) {}
  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  // 关闭 → 隐藏到托盘（真正退出走托盘菜单）
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
}

function showMainWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function notify(title, body) {
  try {
    const { Notification } = require('electron');
    if (Notification.isSupported()) new Notification({ title, body, icon: path.join(__dirname, 'assets/tray.png') }).show();
  } catch (_) {}
}

function persistRunningState() {
  for (const s of hub.shares.values()) store.markRunning(s.id, s.running);
}

/* ------------------------------------------------------------------ */
/* 演示模式（--demo）：用于无 GUI 自动化验证                             */
/* ------------------------------------------------------------------ */

async function setupDemoShares() {
  const os = require('os');
  const dir = path.join(os.tmpdir(), 'lanshare-demo-' + Date.now());
  fs.mkdirSync(path.join(dir, '资料'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'readme.txt'), 'LanShare 演示共享\n' + new Date().toISOString());
  fs.writeFileSync(path.join(dir, '资料', 'demo.pdf.txt'), '演示子目录文件');
  await hub.addShare({ name: '演示-读写共享', roots: [dir], readonly: false });
  await hub.addShare({ name: '演示-密码共享', roots: [dir], password: '1234', readonly: true });
  for (const id of hub.shares.keys()) {
    try { await startShareSafe(id); } catch (e) { console.error('demo start fail', e); }
  }
  console.log('[DEMO] shares ready at port', hub.actualPort || hub.port);
  console.log('[DEMO] ' + JSON.stringify([...hub.shares.keys()]));
  // 落盘共享 ID 供自动化测试读取
  try {
    fs.writeFileSync(path.join(dir, 'demo-info.json'), JSON.stringify({
      port: hub.actualPort || hub.port,
      ids: [...hub.shares.keys()],
      dir
    }, null, 2));
  } catch (_) {}
}

/* ------------------------------------------------------------------ */

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {
  // 托盘常驻：不随窗口关闭退出（macOS/Windows 行为一致）
});
app.on('activate', () => showMainWindow());
app.on('quit', async () => {
  try { if (hub) await hub.shutdown(); } catch (_) {}
});
