'use strict';

/**
 * ShareHub — 局域网共享服务核心（纯 Node 实现，不依赖 Electron，可独立测试）
 *
 * 设计要点：
 *  - 单一 HTTP 端口承载多个共享会话：URL 形如 /s/<shareId>/
 *  - 每个共享：独立密码(可选)、只读/读写、有效期、限速、连接数上限、多根目录挂载
 *  - 会话认证：随机 token + HMAC 签名 Cookie，防篡改；登录失败 5 次锁定 5 分钟
 *  - 文件操作：目录浏览 / 下载(Range 续传) / 预览 / 上传(限速+临时文件) / 删除 / 新建文件夹
 *  - 安全：路径穿越防护、目录条目数上限、上传大小上限、响应头加固
 *  - 日志：内存环形缓冲 + 可选 JSONL 落盘
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const { createThrottleStream, pipeBodyWithLimit } = require('./throttle');
const { guessMime, canInline, isTextFile } = require('./mime');
const { highlight, tokensToHtml } = require('./highlight');
const {
  renderWelcome, renderError, renderExpired, renderLogin, renderListing,
  renderCodeView, renderShareList
} = require('./listing');

const SHARE_ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const MAX_LIST_ENTRIES = 2000;
const MAX_JSON_BODY = 1024 * 1024; // 1MB
const LOCK_THRESHOLD = 5;
const LOCK_MS = 5 * 60 * 1000;
const MAX_VIEW_SIZE = 2 * 1024 * 1024;   // 文本预览上限 2MB
const MAX_VIEW_LINES = 5000;             // 预览渲染行数上限

function makeShareId(len = 6) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += SHARE_ID_ALPHABET[bytes[i] % SHARE_ID_ALPHABET.length];
  return s;
}

function hmacSign(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (_) { return null; }
}

function fmtBytes(n) {
  if (n == null || n < 0) return '-';
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n, i = -1;
  do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
  return v.toFixed(v >= 100 ? 0 : 1) + ' ' + units[i];
}

/* ------------------------------------------------------------------ */
/* 共享配置规范化                                                       */
/* ------------------------------------------------------------------ */

function normalizeAlias(raw, used) {
  let a = String(raw || '').trim() || '共享目录';
  a = a.replace(/[\\/:*?"<>|]/g, '-');
  let base = a, k = 2;
  while (used.has(a.toLowerCase())) a = base + ' (' + k++ + ')';
  used.add(a.toLowerCase());
  return a;
}

function normalizeRoots(roots) {
  const list = Array.isArray(roots) ? roots : [roots];
  const used = new Set();
  const out = [];
  for (const item of list) {
    const dir = typeof item === 'string' ? item : item.dir;
    if (!dir) continue;
    let alias = typeof item === 'string' ? '' : item.alias;
    if (!alias) {
      const b = path.basename(dir.trim().replace(/[\\/]+$/, ''));
      alias = b || (dir.replace(/^[A-Za-z]:[\\/]?/, '') || '').split(/[\\/]/)[0] || dir;
      // 盘符根目录特殊处理：D:\ -> D盘
      if (/^[A-Za-z]:[\\/]?$/.test(dir.trim())) alias = dir.trim().replace(/[\\/]/g, '') + '盘';
    }
    out.push({ alias: normalizeAlias(alias, used), dir: path.resolve(dir.trim()) });
  }
  return out;
}

/**
 * 创建共享对象（含运行时状态）
 */
function createShare(cfg) {
  const roots = normalizeRoots(cfg.roots);
  if (!roots.length) throw new Error('至少需要一个共享目录');
  for (const r of roots) {
    let st = null;
    try { st = fs.statSync(r.dir); } catch (_) {}
    if (!st || !st.isDirectory()) throw new Error('目录不存在或不可访问：' + r.dir);
  }
  const now = Date.now();
  return {
    id: cfg.id || makeShareId(),
    name: String(cfg.name || '未命名共享').slice(0, 60),
    roots,
    readonly: !!cfg.readonly,
    password: String(cfg.password || ''),
    expiresAt: +cfg.expiresAt || 0,          // 0 = 永久
    speedLimitKBps: Math.max(0, +cfg.speedLimitKBps || 0),
    maxConnections: Math.max(0, +cfg.maxConnections || 0),
    uploadMaxMB: Math.max(0, +cfg.uploadMaxMB || 0),
    createdAt: cfg.createdAt || now,
    // ---- 运行时状态 ----
    running: false,
    connections: 0,
    sessions: new Map(),      // token -> {ip, time}
    loginFails: new Map(),    // ip -> {count, lockUntil}
    activeRes: new Set()
  };
}

/* ------------------------------------------------------------------ */
/* ShareHub                                                            */
/* ------------------------------------------------------------------ */

class ShareHub extends EventEmitter {
  /**
   * @param {object} opts
   *   port      监听端口（默认 8965）
   *   logDir    访问日志落盘目录（null 则不落盘）
   *   maxLogs   内存日志条数上限
   *   showShareList  根路径是否显示运行中的共享列表（默认 false）
   */
  constructor(opts = {}) {
    super();
    this.port = +opts.port || 8965;
    this.actualPort = null;
    this.logDir = opts.logDir || null;
    this.maxLogs = +opts.maxLogs || 1000;
    this.showShareList = !!opts.showShareList;
    this.logs = [];
    this.shares = new Map();     // id -> share
    this.server = null;
    this._listenPromise = null;
    this._secret = crypto.randomBytes(32); // 进程内会话签名密钥
    this._expireTimer = setInterval(() => this.checkExpired(), 15 * 1000);
    if (this._expireTimer.unref) this._expireTimer.unref();
  }

  /* ---------------- 共享管理 ---------------- */

  /**
   * 新建共享（同步返回 share 对象，含生成的 id；不自动启动）
   * @returns {object} share
   */
  addShare(cfg) {
    const share = createShare(cfg);
    if (this.shares.has(share.id)) throw new Error('共享 ID 冲突，请重试');
    this.shares.set(share.id, share);
    this.log({ share, action: 'create', detail: share.name });
    this.emit('state-changed');
    return share;
  }

  updateShare(id, patch) {
    const share = this.shares.get(id);
    if (!share) throw new Error('共享不存在');
    const wasRunning = share.running;
    if (wasRunning) this.stopShare(id);
    const merged = {
      id,
      name: patch.name !== undefined ? patch.name : share.name,
      roots: patch.roots !== undefined ? patch.roots : share.roots.map(r => ({ dir: r.dir, alias: r.alias })),
      readonly: patch.readonly !== undefined ? !!patch.readonly : share.readonly,
      password: patch.password !== undefined ? patch.password : share.password,
      expiresAt: patch.expiresAt !== undefined ? patch.expiresAt : share.expiresAt,
      speedLimitKBps: patch.speedLimitKBps !== undefined ? patch.speedLimitKBps : share.speedLimitKBps,
      maxConnections: patch.maxConnections !== undefined ? patch.maxConnections : share.maxConnections,
      uploadMaxMB: patch.uploadMaxMB !== undefined ? patch.uploadMaxMB : share.uploadMaxMB,
      createdAt: share.createdAt
    };
    const updated = createShare(merged);
    updated.createdAt = merged.createdAt;
    this.shares.set(id, updated);
    this.log({ share: updated, action: 'update', detail: updated.name });
    this.emit('state-changed');
    if (wasRunning) return this.startShare(id);
    return Promise.resolve(updated);
  }

  removeShare(id) {
    const share = this.shares.get(id);
    if (!share) return;
    if (share.running) this.stopShare(id);
    this.shares.delete(id);
    this.log({ share, action: 'remove', detail: share.name });
    this.emit('state-changed');
  }

  async startShare(id) {
    const share = this.shares.get(id);
    if (!share) throw new Error('共享不存在');
    if (share.expiresAt && Date.now() > share.expiresAt) {
      throw new Error('共享已过期，请先修改有效期');
    }
    if (!share.running) {
      await this._ensureListening();
      share.running = true;
      this.log({ share, action: 'start', detail: share.name });
      this.emit('share-started', share);
      this.emit('state-changed');
    }
    return share;
  }

  stopShare(id) {
    const share = this.shares.get(id);
    if (!share) return;
    if (share.running) {
      share.running = false;
      share.sessions.clear();
      share.loginFails.clear();
      for (const res of share.activeRes) { try { res.destroy(); } catch (_) {} }
      share.activeRes.clear();
      this.log({ share, action: 'stop', detail: share.name });
      this.emit('share-stopped', share);
      this.emit('state-changed');
    }
  }

  checkExpired() {
    const now = Date.now();
    for (const share of this.shares.values()) {
      if (share.running && share.expiresAt && now > share.expiresAt) {
        this.stopShare(share.id);
        this.log({ share, action: 'expired', detail: share.name });
        this.emit('share-expired', share);
      }
    }
  }

  async setPort(port) {
    const p = +port;
    if (!p || p < 1 || p > 65535) throw new Error('端口无效');
    if (p === this.port && this._listenPromise) return;
    if (this._listenPromise) await this._stopServer();
    this.port = p;
  }

  async shutdown() {
    clearInterval(this._expireTimer);
    for (const id of [...this.shares.keys()]) this.stopShare(id);
    if (this._listenPromise) await this._stopServer();
  }

  async _stopServer() {
    try { await this._listenPromise; } catch (_) {}
    this._listenPromise = null;
    if (this.server) {
      const srv = this.server;
      this.server = null;
      this.actualPort = null;
      await new Promise((resolve) => srv.close(() => resolve()));
    }
  }

  _ensureListening() {
    if (this._listenPromise) return this._listenPromise;
    this._listenPromise = new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => this._onRequest(req, res));
      srv.on('error', (err) => reject(err));
      srv.listen(this.port, '0.0.0.0', () => {
        this.actualPort = srv.address().port;
        resolve(this.actualPort);
      });
      this.server = srv;
    }).catch((err) => {
      this._listenPromise = null;
      this.server = null;
      throw err;
    });
    return this._listenPromise;
  }

  /* ---------------- 网络信息 ---------------- */

  getNetworkInterfaces() {
    const out = [];
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const a of ifaces[name] || []) {
        if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
      }
    }
    return out;
  }

  getShareUrls(shareId) {
    const port = this.actualPort || this.port;
    return this.getNetworkInterfaces()
      .map((n) => ({ ...n, url: 'http://' + n.address + ':' + port + '/s/' + shareId + '/' }));
  }

  /* ---------------- 日志 ---------------- */

  log(entry) {
    const e = {
      t: Date.now(),
      shareId: entry.share ? entry.share.id : (entry.shareId || ''),
      shareName: entry.share ? entry.share.name : (entry.shareName || ''),
      ip: entry.ip || '',
      action: entry.action || '',
      detail: String(entry.detail || '').slice(0, 200),
      ok: entry.ok !== false
    };
    this.logs.push(e);
    if (this.logs.length > this.maxLogs) this.logs.splice(0, this.logs.length - this.maxLogs);
    this.emit('log', e);
    if (this.logDir) {
      const d = new Date(e.t);
      const p2 = (x) => String(x).padStart(2, '0');
      const file = path.join(this.logDir, 'access-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '.jsonl');
      fs.appendFile(file, JSON.stringify(e) + '\n', () => {});
    }
  }

  getLogs(since = 0) {
    return since ? this.logs.filter((e) => e.t > since) : this.logs.slice();
  }

  /* ---------------- 请求处理 ---------------- */

  _onRequest(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const u = new URL(req.url, 'http://lan-share.local');
    const m = /^\/s\/([A-Za-z0-9]+)(\/.*)?$/.exec(u.pathname);
    if (!m) {
      if (this.showShareList) {
        const items = [...this.shares.values()]
          .filter((s) => s.running)
          .map((s) => ({ id: s.id, name: s.name, readonly: s.readonly, hasPassword: !!s.password }));
        this._sendHtml(res, 200, renderShareList({ hostname: os.hostname(), items }));
      } else {
        this._sendHtml(res, 200, renderWelcome());
      }
      return;
    }
    const share = this.shares.get(m[1]);
    if (!share || !share.running) {
      this._sendHtml(res, 404, renderError(404, '共享不存在或已停止', '该共享可能已被关闭、删除或尚未启动。'));
      return;
    }
    if (share.expiresAt && Date.now() > share.expiresAt) {
      // 请求命中过期：立即失效并停止共享（不等定时器）
      if (share.running) {
        this.stopShare(share.id);
        this.log({ share, action: 'expired', detail: share.name });
        this.emit('share-expired', share);
      }
      this._sendHtml(res, 410, renderExpired(share.name));
      return;
    }

    // 连接数限制（每共享活动请求计数）
    share.connections++;
    const onDone = () => { share.connections--; share.activeRes.delete(res); };
    res.on('close', onDone);
    share.activeRes.add(res);
    if (share.maxConnections > 0 && share.connections > share.maxConnections) {
      this.log({ share, ip: this._clientIp(req), action: 'limit', detail: '连接数达到上限 ' + share.maxConnections });
      this._sendHtml(res, 503, renderError(503, '连接数已达上限', '当前共享的并发连接数已达设定上限，请稍后再试。'));
      return;
    }

    const restRaw = m[2] || '/';
    const rest = safeDecode(restRaw);
    if (rest == null || rest.includes('\0')) {
      this._sendHtml(res, 400, renderError(400, '非法请求'));
      return;
    }

    const ip = this._clientIp(req);
    const q = u.searchParams;

    // 认证
    if (share.password) {
      const authed = this._checkSession(share, req);
      if (!authed) {
        if (req.method === 'POST' && (rest === '/login' || rest === '/')) {
          this._handleLogin(share, req, res, ip);
        } else {
          this._sendHtml(res, 401, renderLogin(share));
        }
        return;
      }
    }

    this._dispatch(share, rest, q, req, res, ip).catch((err) => {
      try {
        this._sendHtml(res, err.statusCode || 500, renderError(err.statusCode || 500, err.exposeMsg || '服务器内部错误', err.exposeMsg ? '' : String(err.message || err)));
      } catch (_) {}
    });
  }

  _clientIp(req) {
    return (req.socket && req.socket.remoteAddress) || '';
  }

  /* ---- 会话 ---- */

  _checkSession(share, req) {
    const cookies = req.headers.cookie || '';
    let token = null;
    for (const part of cookies.split(';')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      if (part.slice(0, i).trim() === 'ls_' + share.id) token = part.slice(i + 1).trim();
    }
    if (!token) return false;
    const dot = token.lastIndexOf('.');
    if (dot < 0) return false;
    const val = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expect = hmacSign(this._secret, share.id + '.' + val);
    const a = Buffer.from(sig), b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    return share.sessions.has(val);
  }

  _readBody(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) { reject(Object.assign(new Error('请求体过大'), { statusCode: 413 })); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  async _handleLogin(share, req, res, ip) {
    const body = await this._readBody(req, 64 * 1024).catch(() => null);
    if (!body) return;
    let password = '';
    try {
      const params = new URLSearchParams(body.toString('utf8'));
      password = params.get('password') || '';
    } catch (_) {}

    const fail = share.loginFails.get(ip);
    if (fail && fail.lockUntil > Date.now()) {
      const secs = Math.ceil((fail.lockUntil - Date.now()) / 1000);
      this._sendHtml(res, 429, renderLogin(share, '尝试次数过多，请稍后再试', secs));
      return;
    }

    const a = Buffer.from(String(password));
    const b = Buffer.from(share.password);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (ok) {
      share.loginFails.delete(ip);
      const token = crypto.randomBytes(16).toString('base64url');
      share.sessions.set(token, { ip, time: Date.now() });
      // 会话上限保护
      if (share.sessions.size > 500) {
        const firstKey = share.sessions.keys().next().value;
        share.sessions.delete(firstKey);
      }
      this.log({ share, ip, action: 'login', detail: '登录成功' });
      res.setHeader('Set-Cookie',
        'ls_' + share.id + '=' + token + '.' + hmacSign(this._secret, share.id + '.' + token) +
        '; Path=/s/' + share.id + '; HttpOnly; SameSite=Lax; Max-Age=2592000');
      res.statusCode = 302;
      res.setHeader('Location', '/s/' + share.id + '/');
      res.end();
    } else {
      const f = share.loginFails.get(ip) || { count: 0, lockUntil: 0 };
      f.count++;
      if (f.count >= LOCK_THRESHOLD) {
        f.lockUntil = Date.now() + LOCK_MS;
        f.count = 0;
        this.log({ share, ip, action: 'login-fail', detail: '密码错误次数过多，锁定 5 分钟', ok: false });
      } else {
        this.log({ share, ip, action: 'login-fail', detail: '密码错误 (' + f.count + ')', ok: false });
      }
      share.loginFails.set(ip, f);
      this._sendHtml(res, 401, renderLogin(share, '密码错误，请重试'));
    }
  }

  /* ---- 路径解析（含穿越防护） ---- */

  _resolvePath(share, rest) {
    const parts = rest.split('/').filter(Boolean);
    for (const seg of parts) {
      if (seg === '.' || seg === '..' || seg.includes('\\') || seg.includes('\0')) {
        throw Object.assign(new Error('非法路径'), { statusCode: 403, exposeMsg: '非法路径' });
      }
    }
    const multiRoot = share.roots.length > 1;
    if (multiRoot && parts.length === 0) {
      return { virtualRoot: true, parts, root: null, realPath: null, cwdRel: '/' };
    }
    let root, relParts;
    if (multiRoot) {
      root = share.roots.find((r) => r.alias === parts[0]);
      if (!root) throw Object.assign(new Error('目录不存在'), { statusCode: 404, exposeMsg: '目录不存在' });
      relParts = parts.slice(1);
    } else {
      root = share.roots[0];
      relParts = parts;
    }
    const realPath = path.resolve(root.dir, ...relParts);
    const normRoot = path.resolve(root.dir);
    if (realPath !== normRoot && !realPath.startsWith(normRoot + path.sep)) {
      throw Object.assign(new Error('非法路径'), { statusCode: 403, exposeMsg: '非法路径' });
    }
    const cwdRel = multiRoot
      ? '/' + [root.alias, ...relParts].join('/')
      : '/' + relParts.join('/');
    return { virtualRoot: false, parts, root, realPath, cwdRel, relParts };
  }

  /* ---- 主分发 ---- */

  async _dispatch(share, rest, q, req, res, ip) {
    const method = req.method;
    if (method !== 'GET' && method !== 'POST' && method !== 'HEAD') {
      this._sendHtml(res, 405, renderError(405, '不支持的请求方法'));
      return;
    }

    // 认证后的登录页跳转
    if (rest === '/login') {
      res.statusCode = 302;
      res.setHeader('Location', '/s/' + share.id + '/');
      res.end();
      return;
    }

    const target = q.get('path') || '';
    const targetDecoded = safeDecode(target);

    switch (true) {
      case (rest === '/' && method === 'GET'):
        await this._handleList(share, rest, res);
        return;
      case (rest === '/dl' && (method === 'GET' || method === 'HEAD')):
        await this._handleDownload(share, targetDecoded, req, res, ip, false);
        return;
      case (rest === '/raw' && (method === 'GET' || method === 'HEAD')):
        await this._handleDownload(share, targetDecoded, req, res, ip, true);
        return;
      case (rest === '/view' && method === 'GET'):
        await this._handleTextView(share, targetDecoded, req, res, ip);
        return;
      case (rest === '/up' && method === 'POST'):
        await this._handleUpload(share, targetDecoded, req, res, ip);
        return;
      case (rest === '/del' && method === 'POST'):
        await this._handleDelete(share, req, res, ip);
        return;
      case (rest === '/mkdir' && method === 'POST'):
        await this._handleMkdir(share, req, res, ip);
        return;
      default:
        // 尝试当作目录路径浏览 /s/<id>/sub/dir/
        if (method === 'GET') {
          await this._handleList(share, rest, res);
          return;
        }
        this._sendHtml(res, 404, renderError(404, '页面不存在'));
    }
  }

  /* ---- 目录列表 ---- */

  async _handleList(share, rest, res) {
    const r = this._resolvePath(share, rest);
    const multiRoot = share.roots.length > 1;
    let entries = [];
    let breadcrumb = [];

    if (r.virtualRoot) {
      entries = share.roots.map((root) => ({ n: root.alias, d: true, s: -1, t: null, rel: '/' + root.alias }));
    } else {
      let st;
      try { st = await fsp.stat(r.realPath); } catch (_) {}
      if (!st || !st.isDirectory()) {
        this._sendHtml(res, 404, renderError(404, '目录不存在', '共享目录下未找到该路径，可能已被移动或删除。'));
        return;
      }
      let names;
      try { names = await fsp.readdir(r.realPath, { withFileTypes: true }); } catch (err) {
        this._sendHtml(res, 500, renderError(500, '无法读取目录', err.code === 'EACCES' ? '没有权限读取该目录' : String(err.message)));
        return;
      }
      // 过滤无法访问的项 & 截断
      const list = [];
      for (const it of names) {
        if (list.length >= MAX_LIST_ENTRIES) break;
        if (it.name.startsWith('.')) continue; // 隐藏文件不展示
        list.push(it);
      }
      const relBase = r.cwdRel === '/' ? '' : r.cwdRel;
      for (const it of list) {
        const rel = (relBase ? relBase.replace(/\/+$/, '') : '') + '/' + it.name;
        if (it.isDirectory()) {
          entries.push({ n: it.name, d: true, s: -1, t: null, rel });
        } else if (it.isFile()) {
          let s = -1, t = null;
          try { const fst = await fsp.stat(path.join(r.realPath, it.name)); s = fst.size; t = fst.mtimeMs; } catch (_) {}
          entries.push({
            n: it.name, d: false, s, t, rel,
            inline: canInline(guessMime(it.name)),
            view: s >= 0 && s <= MAX_VIEW_SIZE && isTextFile(it.name)
          });
        }
        // 其余类型（符号链接等）跳过
      }
      // 面包屑
      if (multiRoot) {
        breadcrumb.push({ name: r.root.alias, href: '/s/' + share.id + '/' + encodeURIComponent(r.root.alias) + '/' });
        const relParts = r.relParts || [];
        let hrefBase = '/s/' + share.id + '/' + encodeURIComponent(r.root.alias);
        let acc = '';
        for (const p of relParts) {
          acc += '/' + p;
          breadcrumb.push({ name: p, href: hrefBase + acc + '/' });
        }
      } else {
        let acc = '';
        for (const p of r.relParts || []) {
          acc += '/' + p;
          breadcrumb.push({ name: p, href: '/s/' + share.id + acc + '/' });
        }
      }
    }

    this._sendHtml(res, 200, renderListing({
      shareId: share.id,
      base: '/s/' + share.id,
      shareName: share.name,
      readonly: share.readonly,
      expiresAt: share.expiresAt || 0,
      serverNow: Date.now(),
      pageLoadedAt: 0,
      multiRoot,
      cwdRel: r.virtualRoot ? '/' : r.cwdRel,
      breadcrumb,
      entries
    }));
  }

  /* ---- 下载 / 预览（支持 Range、限速） ---- */

  async _handleDownload(share, rel, req, res, ip, inline) {
    if (rel == null || rel === '' || rel === '/') {
      this._sendHtml(res, 400, renderError(400, '缺少文件路径'));
      return;
    }
    const r = this._resolvePath(share, rel);
    if (r.virtualRoot) {
      this._sendHtml(res, 400, renderError(400, '无法下载目录', '请进入目录后选择具体文件下载。'));
      return;
    }
    let st;
    try { st = await fsp.stat(r.realPath); } catch (_) {}
    if (!st || !st.isFile()) {
      this._sendHtml(res, 404, renderError(404, '文件不存在', '文件可能已被移动、重命名或删除。'));
      return;
    }

    const name = path.basename(r.realPath);
    const mime = guessMime(name);
    const headers = {
      'Content-Type': inline ? mime : (mime.startsWith('text/') ? 'application/octet-stream' : mime),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store'
    };
    const disposition = inline ? 'inline' : 'attachment';
    headers['Content-Disposition'] = disposition + '; filename*=UTF-8\'\'' + encodeURIComponent(name);

    this.log({ share, ip, action: inline ? 'preview' : 'download', detail: rel + ' (' + fmtBytes(st.size) + ')' });

    const rangeHeader = req.headers.range;
    if (rangeHeader && st.size > 0) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
      let start = 0, end = st.size - 1;
      if (m) {
        if (m[1] === '' && m[2] === '') { res.setHeader('Content-Range', 'bytes */' + st.size); this._sendHtml(res, 416, renderError(416, 'Range 无效')); return; }
        if (m[1] === '') { // 后缀范围 -N
          const suffix = parseInt(m[2], 10);
          start = Math.max(0, st.size - suffix);
        } else {
          start = parseInt(m[1], 10);
          if (m[2] !== '') end = Math.min(parseInt(m[2], 10), st.size - 1);
        }
      }
      if (isNaN(start) || isNaN(end) || start > end || start >= st.size) {
        res.setHeader('Content-Range', 'bytes */' + st.size);
        this._sendHtml(res, 416, renderError(416, 'Range 无效'));
        return;
      }
      headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + st.size;
      headers['Content-Length'] = String(end - start + 1);
      res.writeHead(206, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = fs.createReadStream(r.realPath, { start, end });
      this._pipeWithThrottle(share, stream, res);
      return;
    }

    headers['Content-Length'] = String(st.size);
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = fs.createReadStream(r.realPath);
    this._pipeWithThrottle(share, stream, res);
  }

  _pipeWithThrottle(share, stream, res) {
    const bps = share.speedLimitKBps > 0 ? share.speedLimitKBps * 1024 : 0;
    let out = stream;
    if (bps > 0) {
      const throttle = createThrottleStream(bps);
      throttle.on('error', () => { try { res.destroy(); } catch (_) {} });
      stream.pipe(throttle);
      out = throttle;
    }
    out.on('error', () => { try { res.destroy(); } catch (_) {} });
    res.on('close', () => { try { stream.destroy(); } catch (_) {} });
    out.pipe(res);
  }

  /* ---- 文本 / 代码预览 ---- */

  /**
   * 文本解码：BOM → UTF-8 严格 → GBK 回退 → Latin-1
   * @returns {{text: string, enc: string, binary: boolean}}
   */
  _decodeText(buf) {
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
      return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), enc: 'UTF-16LE', binary: false };
    }
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
      return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), enc: 'UTF-16BE', binary: false };
    }
    let body = buf;
    let enc = 'UTF-8';
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      body = buf.subarray(3);
    }
    if (body.includes(0)) {
      return { text: '', enc: '', binary: true };
    }
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), enc, binary: false };
    } catch (_) {}
    try {
      return { text: new TextDecoder('gbk').decode(body), enc: 'GBK', binary: false };
    } catch (_) {}
    return { text: body.toString('latin1'), enc: 'Latin-1', binary: false };
  }

  async _handleTextView(share, rel, req, res, ip) {
    const base = '/s/' + share.id;
    const dlUrl = base + '/dl?path=' + encodeURIComponent(rel || '');
    const tooLarge = (msg) => this._sendHtml(res, 200, renderError(200, msg, '可返回目录后使用「下载」获取文件。'));

    if (rel == null || rel === '' || rel === '/') {
      this._sendHtml(res, 400, renderError(400, '缺少文件路径'));
      return;
    }
    const r = this._resolvePath(share, rel);
    if (r.virtualRoot) {
      this._sendHtml(res, 400, renderError(400, '无法预览目录'));
      return;
    }
    if (!isTextFile(path.basename(r.realPath))) {
      tooLarge('该文件类型不支持在线预览');
      return;
    }
    let st;
    try { st = await fsp.stat(r.realPath); } catch (_) {}
    if (!st || !st.isFile()) {
      this._sendHtml(res, 404, renderError(404, '文件不存在'));
      return;
    }
    if (st.size > MAX_VIEW_SIZE) {
      this.log({ share, ip, action: 'preview-text', detail: rel + ' 过大未预览 (' + fmtBytes(st.size) + ')', ok: false });
      tooLarge('文件大小 ' + fmtBytes(st.size) + ' 超过预览上限 ' + fmtBytes(MAX_VIEW_SIZE));
      return;
    }

    let buf;
    try { buf = await fsp.readFile(r.realPath); } catch (err) {
      this._sendHtml(res, 500, renderError(500, '读取文件失败', err.code === 'EACCES' ? '没有读取权限' : String(err.message)));
      return;
    }
    const dec = this._decodeText(buf);
    if (dec.binary) {
      tooLarge('这是二进制文件，不支持文本预览');
      return;
    }

    const { lang, tokens } = highlight(path.basename(r.realPath), dec.text);
    const totalLines = dec.text.split('\n').length;
    const rendered = tokensToHtml(tokens, MAX_VIEW_LINES);
    const LANG_NAMES = {
      js: 'JavaScript', python: 'Python', html: 'HTML / XML', css: 'CSS', json: 'JSON',
      markdown: 'Markdown', clike: 'C / C++ / Java 等', go: 'Go', rust: 'Rust',
      shell: 'Shell / Batch', conf: '配置文件', sql: 'SQL', plain: '纯文本'
    };

    this.log({ share, ip, action: 'preview-text', detail: rel + ' (' + fmtBytes(st.size) + ')' });
    this._sendHtml(res, 200, renderCodeView({
      name: path.basename(r.realPath),
      sizeText: fmtBytes(st.size),
      enc: dec.enc,
      langText: LANG_NAMES[lang] || lang,
      html: rendered.html,
      truncated: rendered.truncated,
      linesShown: rendered.lines,
      linesTotal: totalLines,
      rawUrl: dlUrl
    }));
  }

  /* ---- 上传 ---- */

  async _handleUpload(share, rel, req, res, ip) {
    const fail = (code, msg) => {
      this._sendJson(res, code, { ok: false, error: msg });
    };
    if (share.readonly) { this.log({ share, ip, action: 'upload', detail: '只读共享拒绝上传 ' + (rel || ''), ok: false }); fail(403, '此共享为只读，禁止上传'); return; }
    if (rel == null || rel === '' || rel === '/') { fail(400, '缺少上传路径'); return; }

    const r = this._resolvePath(share, rel);
    if (r.virtualRoot) { fail(400, '上传位置无效'); return; }

    const clen = parseInt(req.headers['content-length'] || '0', 10);
    if (share.uploadMaxMB > 0 && clen > share.uploadMaxMB * 1024 * 1024) {
      fail(413, '文件超过上传大小限制（' + share.uploadMaxMB + ' MB）');
      req.destroy();
      return;
    }

    let parentSt;
    try { parentSt = await fsp.stat(r.realPath); } catch (_) {}
    // 目标是已存在文件 → 覆盖；否则其父目录必须存在
    let finalPath = r.realPath;
    if (!parentSt) {
      const parentDir = path.dirname(r.realPath);
      try { parentSt = await fsp.stat(parentDir); } catch (_) {}
      if (!parentSt || !parentSt.isDirectory()) { fail(404, '目标目录不存在'); return; }
    } else if (parentSt.isDirectory()) {
      // 以目录结尾 → 视为上传到该目录，需要 name 参数
      const nm = safeDecode(req.headers['x-file-name'] || '') || null;
      if (!nm) { fail(400, '缺少文件名（目标是目录时需提供 x-file-name 头）'); return; }
      if (nm === '.' || nm === '..' || nm.includes('\\') || nm.includes('/')) { fail(400, '文件名非法'); return; }
      finalPath = path.join(r.realPath, nm);
    }

    const tmpPath = finalPath + '.part-' + crypto.randomBytes(4).toString('hex');
    const bps = share.speedLimitKBps > 0 ? share.speedLimitKBps * 1024 : 0;
    const ws = fs.createWriteStream(tmpPath, { flags: 'w' });

    let received = 0;
    try {
      received = await pipeBodyWithLimit(req, ws, bps);
    } catch (err) {
      try { await fsp.unlink(tmpPath); } catch (_) {}
      this.log({ share, ip, action: 'upload', detail: '上传中断：' + rel, ok: false });
      // 连接已断，无法响应
      return;
    }

    try {
      await fsp.rename(tmpPath, finalPath);
    } catch (err) {
      try { await fsp.unlink(tmpPath); } catch (_) {}
      this.log({ share, ip, action: 'upload', detail: '上传失败：' + rel + ' (' + err.code + ')', ok: false });
      fail(500, '保存文件失败：' + (err.code === 'EACCES' ? '没有写入权限' : err.message));
      return;
    }
    this.log({ share, ip, action: 'upload', detail: rel + ' (' + fmtBytes(received) + ')' });
    this._sendJson(res, 200, { ok: true, size: received });
  }

  /* ---- 删除 ---- */

  async _handleDelete(share, req, res, ip) {
    if (share.readonly) { this._sendJson(res, 403, { ok: false, error: '此共享为只读，禁止删除' }); return; }
    let body;
    try { body = JSON.parse((await this._readBody(req, MAX_JSON_BODY)).toString('utf8') || '{}'); }
    catch (_) { this._sendJson(res, 400, { ok: false, error: '请求格式错误' }); return; }
    const paths = Array.isArray(body.paths) ? body.paths.slice(0, 100) : [];
    if (!paths.length) { this._sendJson(res, 400, { ok: false, error: '未指定要删除的路径' }); return; }

    const results = [];
    for (const p of paths) {
      const dec = safeDecode(String(p));
      let ok = false, msg = '';
      if (dec == null || dec === '' || dec === '/') {
        msg = '路径无效';
      } else {
        try {
          const r = this._resolvePath(share, dec);
          if (r.virtualRoot) { msg = '虚拟根目录不可删除'; }
          else {
            await fsp.rm(r.realPath, { recursive: true, force: false });
            ok = true;
            this.log({ share, ip, action: 'delete', detail: dec });
          }
        } catch (err) {
          msg = err.code === 'ENOENT' ? '不存在' : err.code === 'EACCES' || err.code === 'EPERM' ? '没有权限' : err.message;
          this.log({ share, ip, action: 'delete', detail: dec + ' 失败(' + msg + ')', ok: false });
        }
      }
      results.push({ path: p, ok, error: msg });
    }
    this._sendJson(res, 200, { ok: true, results });
  }

  /* ---- 新建文件夹 ---- */

  async _handleMkdir(share, req, res, ip) {
    if (share.readonly) { this._sendJson(res, 403, { ok: false, error: '此共享为只读，禁止新建文件夹' }); return; }
    let body;
    try { body = JSON.parse((await this._readBody(req, MAX_JSON_BODY)).toString('utf8') || '{}'); }
    catch (_) { this._sendJson(res, 400, { ok: false, error: '请求格式错误' }); return; }
    const dirPath = safeDecode(String(body.path || ''));
    const name = String(body.name || '').trim();
    if (dirPath == null || !name) { this._sendJson(res, 400, { ok: false, error: '参数不完整' }); return; }
    if (name === '.' || name === '..' || /[\\/:*?"<>|\0]/.test(name)) {
      this._sendJson(res, 400, { ok: false, error: '文件夹名称包含非法字符' });
      return;
    }
    try {
      const r = this._resolvePath(share, dirPath === '/' ? '/' + name : dirPath);
      if (r.virtualRoot) { this._sendJson(res, 400, { ok: false, error: '无效位置' }); return; }
      await fsp.mkdir(r.realPath, { recursive: false });
      this.log({ share, ip, action: 'mkdir', detail: r.cwdRel });
      this._sendJson(res, 200, { ok: true });
    } catch (err) {
      const msg = err.code === 'EEXIST' ? '同名文件夹已存在' : err.code === 'EACCES' ? '没有权限' : err.message;
      this.log({ share, ip, action: 'mkdir', detail: dirPath + '/' + name + ' 失败(' + msg + ')', ok: false });
      this._sendJson(res, 400, { ok: false, error: msg });
    }
  }

  /* ---- 响应工具 ---- */

  _sendHtml(res, status, html) {
    if (res.writableEnded || res.destroyed) return;
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(html);
  }

  _sendJson(res, status, obj) {
    if (res.writableEnded || res.destroyed) return;
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
  }
}

module.exports = { ShareHub, createShare, makeShareId, fmtBytes };
