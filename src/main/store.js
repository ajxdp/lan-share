'use strict';

/**
 * 配置持久化（userData/config.json）
 * 密码仅做 Base64 混淆存储（防止明文肩窥），并非加密——本工具定位为可信局域网环境使用
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  settings: {
    port: 8965,
    autoRestore: true,    // 启动时自动恢复上次运行中的共享
    logToDisk: true,      // 访问日志写盘
    autostart: false,     // 开机自启（由主进程维护到系统登录项）
    showShareList: false, // 根路径显示运行中的共享列表
    theme: 'light'        // 主界面主题：light | dark
  },
  shares: []
};

function obfuscate(pw) {
  return Buffer.from(String(pw || ''), 'utf8').toString('base64');
}
function deobfuscate(s) {
  try { return Buffer.from(String(s || ''), 'base64').toString('utf8'); } catch (_) { return ''; }
}

class Store {
  constructor(userDataDir) {
    this.dir = userDataDir;
    this.file = path.join(userDataDir, 'config.json');
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = {
          settings: { ...DEFAULTS.settings, ...(raw.settings || {}) },
          shares: Array.isArray(raw.shares) ? raw.shares : []
        };
      }
    } catch (err) {
      // 配置损坏时备份并使用默认值
      try { fs.copyFileSync(this.file, this.file + '.broken-' + Date.now()); } catch (_) {}
      this.data = JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  get settings() { return this.data.settings; }

  setSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
    return this.data.settings;
  }

  /** 共享配置列表（含密码混淆） */
  get shares() { return this.data.shares; }

  /** 将运行时共享配置持久化（roots 保存用户原始输入） */
  upsertShare(cfg) {
    const rec = {
      id: cfg.id,
      name: cfg.name || '未命名共享',
      roots: cfg.roots,
      readonly: !!cfg.readonly,
      password: obfuscate(cfg.password || ''),
      expiresAt: +cfg.expiresAt || 0,
      speedLimitKBps: +cfg.speedLimitKBps || 0,
      maxConnections: +cfg.maxConnections || 0,
      uploadMaxMB: +cfg.uploadMaxMB || 0,
      createdAt: cfg.createdAt || Date.now(),
      lastRunning: !!cfg.lastRunning
    };
    const i = this.data.shares.findIndex((s) => s.id === rec.id);
    if (i >= 0) this.data.shares[i] = { ...this.data.shares[i], ...rec };
    else this.data.shares.push(rec);
    this.save();
    return rec;
  }

  markRunning(id, running) {
    const s = this.data.shares.find((x) => x.id === id);
    if (s) { s.lastRunning = !!running; this.save(); }
  }

  removeShare(id) {
    this.data.shares = this.data.shares.filter((s) => s.id !== id);
    this.save();
  }

  /** 恢复为可创建共享的原始配置 */
  toShareConfig(rec) {
    return {
      id: rec.id,
      name: rec.name,
      roots: rec.roots,
      readonly: rec.readonly,
      password: deobfuscate(rec.password),
      expiresAt: rec.expiresAt || 0,
      speedLimitKBps: rec.speedLimitKBps || 0,
      maxConnections: rec.maxConnections || 0,
      uploadMaxMB: rec.uploadMaxMB || 0,
      createdAt: rec.createdAt
    };
  }
}

module.exports = { Store };
