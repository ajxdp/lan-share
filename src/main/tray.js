'use strict';

/**
 * 系统托盘：常驻运行、快捷启停共享、开机自启、退出
 */

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');

let currentTray = null;
let hooks = { onShow: null, onQuit: null };

function trayIcon() {
  const p = path.join(__dirname, 'assets', 'tray.png');
  if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  return nativeImage.createEmpty();
}

/**
 * @param {object} model {shares:[{id,name,running,expired}]}
 * @param {object} hooks_ {onShow, onQuit}
 */
function createTray(model, hooks_) {
  hooks = hooks_ || hooks;
  currentTray = new Tray(trayIcon());
  currentTray.setToolTip('LanShare - 局域网文件共享');
  currentTray.on('double-click', () => hooks.onShow && hooks.onShow());
  refreshTrayMenu(currentTray, model);
  return currentTray;
}

function refreshTrayMenu(tray, model) {
  if (!tray || tray.isDestroyed()) return;
  currentTray = tray;

  const shareItems = (model.shares || []).map((s) => ({
    label: (s.running ? '⏹ 停止 ' : '▶ 启动 ') + s.name + (s.expired ? '（已过期）' : ''),
    enabled: !s.expired,
    click: () => {
      if (hooks.onToggleShare) hooks.onToggleShare(s.id, !s.running);
    }
  }));

  const template = [
    { label: '打开 LanShare 主窗口', click: () => hooks.onShow && hooks.onShow() },
    { type: 'separator' },
    ...(model.shares && model.shares.length
      ? [{ label: '共享会话', enabled: false }, ...shareItems]
      : [{ label: '暂无共享会话', enabled: false }]),
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath });
      }
    },
    { type: 'separator' },
    { label: '退出 LanShare', click: () => hooks.onQuit && hooks.onQuit() }
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

module.exports = { createTray, refreshTrayMenu };
