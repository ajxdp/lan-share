'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lanShare', {
  // 状态
  getState: () => ipcRenderer.invoke('state:get'),
  // 共享管理
  addShare: (cfg) => ipcRenderer.invoke('share:add', cfg),
  updateShare: (id, patch) => ipcRenderer.invoke('share:update', id, patch),
  removeShare: (id) => ipcRenderer.invoke('share:remove', id),
  startShare: (id) => ipcRenderer.invoke('share:start', id),
  stopShare: (id) => ipcRenderer.invoke('share:stop', id),
  makeQr: (url) => ipcRenderer.invoke('share:qrcode', url),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  // 设置
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  setAutostart: (v) => ipcRenderer.invoke('autostart:set', v),
  // 日志
  getLogs: (since) => ipcRenderer.invoke('logs:get', since || 0),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),
  openLogDir: () => ipcRenderer.invoke('logs:openDir'),
  // 其他
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  revealShare: (id) => ipcRenderer.invoke('app:revealShare', id),
  // 事件
  onStateChanged: (cb) => ipcRenderer.on('state-changed', () => cb()),
  onNotice: (cb) => ipcRenderer.on('notice', (_e, msg) => cb(msg)),
  onLog: (cb) => ipcRenderer.on('log', (_e, entry) => cb(entry))
});
