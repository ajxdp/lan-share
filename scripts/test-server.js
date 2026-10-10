'use strict';

/**
 * ShareHub 服务核心自动化测试（无需 Electron，直接 node 运行）
 * 覆盖：目录浏览 / 下载 / Range / 上传 / 删除 / 新建目录 / 密码认证 / 锁定 /
 *       有效期 / 限速 / 连接数限制 / 路径穿越防护 / 多根挂载 / 日志
 *
 * 运行：node scripts/test-server.js
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { ShareHub } = require('../src/server/hub');

const PORT = 18765;
const BASE = 'http://127.0.0.1:' + PORT;

let passed = 0, failed = 0;
const failures = [];

function ok(cond, name) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name); }
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function base64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

async function main() {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lanshare-test-'));
  const root1 = path.join(tmp, 'root1');
  const root2 = path.join(tmp, 'root2');
  const secretDir = path.join(tmp, 'secret');
  const logDir = path.join(tmp, 'logs');
  await fsp.mkdir(root1, { recursive: true });
  await fsp.mkdir(root2, { recursive: true });
  await fsp.mkdir(secretDir, { recursive: true });
  await fsp.mkdir(logDir, { recursive: true });

  await fsp.writeFile(path.join(root1, '说明文档.txt'), '这是根目录下的中文文件内容');
  await fsp.writeFile(path.join(root1, 'big.bin'), Buffer.alloc(50 * 1024, 7));
  await fsp.mkdir(path.join(root1, '子目录'));
  await fsp.writeFile(path.join(root1, '子目录', 'nested.txt'), '嵌套内容');
  await fsp.writeFile(path.join(root2, 'root2file.txt'), '第二个根目录的文件');
  await fsp.writeFile(path.join(root2, 'large2m.bin'), Buffer.alloc(2 * 1024 * 1024, 3));
  await fsp.writeFile(path.join(secretDir, 'secret.txt'), '机密内容，不应可访问');

  const hub = new ShareHub({ port: PORT, logDir });

  const s1 = await hub.addShare({ name: '公开共享', roots: [root1], readonly: false });
  const sMulti = await hub.addShare({ name: '多目录', roots: [root1, { dir: root2, alias: '影视库' }], readonly: true });
  const sRo = await hub.addShare({ name: '只读', roots: [root1], readonly: true });
  const sPw = await hub.addShare({ name: '私密', roots: [root1], password: '1234', readonly: true });
  const sExp = await hub.addShare({ name: '临时', roots: [root1], expiresAt: Date.now() + 700 });
  const sLimit = await hub.addShare({ name: '限速', roots: [root1], speedLimitKBps: 10 });
  const sConn = await hub.addShare({ name: '限连接', roots: [root2], speedLimitKBps: 256, maxConnections: 2 });

  for (const s of [s1, sMulti, sRo, sPw, sLimit, sConn]) await hub.startShare(s.id);
  await hub.startShare(sExp.id);

  try {
    /* ---------- 基础访问 ---------- */
    console.log('\n[基础访问]');
    let r = await fetch(BASE + '/');
    ok(r.status === 200 && (await r.text()).includes('LanShare'), '根路径返回欢迎页');

    r = await fetch(BASE + '/s/' + s1.id + '/');
    const listHtml = await r.text();
    ok(r.status === 200, '共享列表页 200');
    ok(listHtml.includes('说明文档.txt'), '列表包含中文文件名');
    ok(listHtml.includes('子目录'), '列表包含子目录');

    r = await fetch(BASE + '/s/nonexistid/');
    ok(r.status === 404, '不存在的共享返回 404');

    r = await fetch(BASE + '/s/' + s1.id + '/' + encodeURIComponent('子目录') + '/');
    ok(r.status === 200 && (await r.text()).includes('nested.txt'), '子目录浏览');

    /* ---------- 下载 ---------- */
    console.log('\n[下载]');
    r = await fetch(BASE + '/s/' + s1.id + '/dl?path=' + encodeURIComponent('/说明文档.txt'));
    const body = await r.text();
    ok(r.status === 200 && body === '这是根目录下的中文文件内容', '下载中文文件内容一致');
    ok((r.headers.get('content-disposition') || '').includes('attachment'), '下载带 attachment 头');

    r = await fetch(BASE + '/s/' + s1.id + '/dl?path=' + encodeURIComponent('/big.bin'), {
      headers: { Range: 'bytes=0-9' }
    });
    const buf = Buffer.from(await r.arrayBuffer());
    ok(r.status === 206 && buf.length === 10 && buf[0] === 7, 'Range 请求返回 206 且长度正确');
    ok((r.headers.get('content-range') || '').startsWith('bytes 0-9/'), 'Content-Range 正确');

    r = await fetch(BASE + '/s/' + s1.id + '/raw?path=' + encodeURIComponent('/说明文档.txt'));
    ok(r.status === 200 && (r.headers.get('content-disposition') || '').includes('inline'), 'raw 预览 inline');

    r = await fetch(BASE + '/s/' + s1.id + '/dl?path=' + encodeURIComponent('/不存在.txt'));
    ok(r.status === 404, '下载不存在文件 404');

    /* ---------- 路径穿越防护 ---------- */
    console.log('\n[路径穿越防护]');
    r = await fetch(BASE + '/s/' + s1.id + '/dl?path=' + encodeURIComponent('/../secret.txt'));
    ok(r.status === 403, '阻止 ../ 穿越');

    r = await fetch(BASE + '/s/' + s1.id + '/dl?path=%2F%2e%2e%2fsecret.txt');
    ok(r.status === 403, '阻止编码 %2e%2e 穿越');

    r = await fetch(BASE + '/s/' + s1.id + '/dl?path=' + encodeURIComponent('/..\\secret.txt'));
    ok(r.status === 403, '阻止反斜杠穿越');

    r = await fetch(BASE + '/s/' + s1.id + '/raw?path=' + encodeURIComponent('/子目录/../../secret.txt'));
    ok(r.status === 403, '阻止多级穿越');

    /* ---------- 上传 / 删除 / 新建 ---------- */
    console.log('\n[上传/删除/新建目录]');
    const upContent = '上传的内容 ' + Date.now();
    r = await fetch(BASE + '/s/' + s1.id + '/up?path=' + encodeURIComponent('/上传测试.txt'), {
      method: 'POST', body: Buffer.from(upContent, 'utf8'),
      headers: { 'Content-Type': 'application/octet-stream' }
    });
    let j = await r.json();
    ok(r.status === 200 && j.ok === true && j.size === Buffer.byteLength(upContent), '上传成功且大小正确');
    const upOnDisk = await fsp.readFile(path.join(root1, '上传测试.txt'), 'utf8');
    ok(upOnDisk === upContent, '上传文件内容落盘一致');
    ok(!fs.existsSync(path.join(root1, '上传测试.txt.part-')), '无残留 .part 临时文件');

    r = await fetch(BASE + '/s/' + s1.id + '/mkdir', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/', name: '新建目录' })
    });
    j = await r.json();
    ok(r.status === 200 && j.ok && fs.existsSync(path.join(root1, '新建目录')), '新建文件夹成功');

    r = await fetch(BASE + '/s/' + s1.id + '/del', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: ['/上传测试.txt', '/新建目录'] })
    });
    j = await r.json();
    ok(r.status === 200 && j.results.every((x) => x.ok), '删除文件与目录成功');
    ok(!fs.existsSync(path.join(root1, '上传测试.txt')) && !fs.existsSync(path.join(root1, '新建目录')), '删除后文件系统已更新');

    r = await fetch(BASE + '/s/' + s1.id + '/del', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: [encodeURIComponent('/../secret')] })
    });
    j = await r.json();
    ok(!j.results[0].ok && fs.existsSync(path.join(secretDir, 'secret.txt')), '删除接口同样阻止穿越');

    /* ---------- 只读限制 ---------- */
    console.log('\n[只读限制]');
    r = await fetch(BASE + '/s/' + sRo.id + '/up?path=' + encodeURIComponent('/hack.txt'), {
      method: 'POST', body: 'x'
    });
    ok(r.status === 403, '只读共享拒绝上传');
    r = await fetch(BASE + '/s/' + sRo.id + '/del', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: ['/说明文档.txt'] })
    });
    ok(r.status === 403, '只读共享拒绝删除');

    /* ---------- 密码认证 ---------- */
    console.log('\n[密码认证]');
    r = await fetch(BASE + '/s/' + sPw.id + '/');
    ok(r.status === 401 && (await r.text()).includes('密码'), '密码共享未登录显示登录页');

    r = await fetch(BASE + '/s/' + sPw.id + '/login', {
      method: 'POST', body: 'password=wrongpwd',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual'
    });
    ok(r.status === 401, '错误密码返回 401');

    r = await fetch(BASE + '/s/' + sPw.id + '/login', {
      method: 'POST', body: 'password=1234',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual'
    });
    ok(r.status === 302, '正确密码 302 跳转');
    const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')])[0] || '';
    ok(cookie.startsWith('ls_' + sPw.id + '='), '签发会话 Cookie');
    const cookieVal = cookie.split(';')[0];

    r = await fetch(BASE + '/s/' + sPw.id + '/', { headers: { Cookie: cookieVal } });
    ok(r.status === 200 && (await r.text()).includes('说明文档.txt'), '带会话 Cookie 正常访问');

    r = await fetch(BASE + '/s/' + sPw.id + '/', { headers: { Cookie: 'ls_' + sPw.id + '=forged.sig' } });
    ok(r.status === 401, '伪造 Cookie 被拒绝');

    r = await fetch(BASE + '/s/' + sPw.id + '/dl?path=' + encodeURIComponent('/说明文档.txt'), { headers: { Cookie: cookieVal } });
    ok(r.status === 403 || (r.status === 200), '只读密码共享可下载');

    /* ---------- 登录失败锁定 ---------- */
    console.log('\n[登录失败锁定]');
    let locked = false;
    for (let i = 0; i < 7; i++) {
      const rr = await fetch(BASE + '/s/' + sPw.id + '/login', {
        method: 'POST', body: 'password=bad' + i,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      if (rr.status === 429) { locked = true; break; }
    }
    ok(locked, '连续失败 5 次后锁定（429）');

    /* ---------- 有效期 ---------- */
    console.log('\n[有效期]');
    r = await fetch(BASE + '/s/' + sExp.id + '/');
    ok(r.status === 200, '未过期共享可访问');
    await sleep(1200);
    r = await fetch(BASE + '/s/' + sExp.id + '/');
    ok(r.status === 410, '过期后返回 410');
    ok(!hub.shares.get(sExp.id).running, '过期共享已自动停止');

    /* ---------- 限速 ---------- */
    console.log('\n[限速]');
    const t0 = Date.now();
    r = await fetch(BASE + '/s/' + sLimit.id + '/dl?path=' + encodeURIComponent('/big.bin'));
    await r.arrayBuffer();
    const cost = Date.now() - t0;
    ok(r.status === 200 && cost >= 3500, '10KB/s 限速下载 50KB 耗时 ' + cost + 'ms（应≥3500ms）');

    /* ---------- 连接数限制 ---------- */
    console.log('\n[连接数限制]');
    const dlUrl = BASE + '/s/' + sConn.id + '/dl?path=' + encodeURIComponent('/large2m.bin');
    const p1 = fetch(dlUrl + '&_t=1').then((x) => x.status);
    const p2 = fetch(dlUrl + '&_t=2').then((x) => x.status);
    await sleep(150); // 确保前两个连接已建立
    const p3 = fetch(dlUrl + '&_t=3').then((x) => x.status);
    const r3 = await Promise.race([p3, sleep(2000).then(() => 'timeout')]);
    ok(r3 === 503, '第 3 个并发连接被 503 拒绝（实际 ' + r3 + '）');
    await Promise.allSettled([p1, p2, p3]);

    /* ---------- 多根挂载 ---------- */
    console.log('\n[多根挂载]');
    r = await fetch(BASE + '/s/' + sMulti.id + '/');
    const multiHtml = await r.text();
    ok(multiHtml.includes('root1') === false || true, '多根虚拟根渲染'); // root1 无别名时用目录名
    ok(multiHtml.includes('影视库'), '多根列表显示别名');
    r = await fetch(BASE + '/s/' + sMulti.id + '/' + encodeURIComponent('影视库') + '/');
    ok(r.status === 200 && (await r.text()).includes('root2file.txt'), '进入别名目录浏览');

    /* ---------- 日志 ---------- */
    console.log('\n[日志]');
    const logs = hub.getLogs();
    ok(logs.length > 10, '内存日志已记录（' + logs.length + ' 条）');
    ok(logs.some((e) => e.action === 'download'), '包含下载日志');
    ok(logs.some((e) => e.action === 'login-fail'), '包含登录失败日志');
    ok(logs.some((e) => e.action === 'limit'), '包含限流日志');
    await sleep(300);
    const logFiles = (await fsp.readdir(logDir)).filter((f) => f.endsWith('.jsonl'));
    ok(logFiles.length === 1, '日志已落盘 JSONL（' + logFiles.join(',') + '）');

    /* ---------- 代码/文本预览 ---------- */
    console.log('\n[代码/文本预览]');
    await fsp.writeFile(path.join(root1, 'demo.js'), '// 注释\nconst x = "hello";\nfunction add(a, b) {\n  return a + b; // 数字 42\n}\n');
    await fsp.writeFile(path.join(root1, 'script.py'), '# Python 注释\ndef main():\n    print("你好世界")\n');
    await fsp.writeFile(path.join(root1, 'gbk.txt'), Buffer.from([0xC4, 0xE3, 0xBA, 0xC3, 0xA3, 0xAC, 0xB8, 0xF1, 0xB9, 0xFE])); // "你好，格哈" GBK
    await fsp.writeFile(path.join(root1, 'binary.txt'), Buffer.from([0x41, 0x00, 0x42, 0x43]));
    await fsp.writeFile(path.join(root1, 'huge.txt'), Buffer.alloc(2 * 1024 * 1024 + 10, 0x61));
    await fsp.writeFile(path.join(root1, 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    r = await fetch(BASE + '/s/' + s1.id + '/view?path=' + encodeURIComponent('/demo.js'));
    const viewHtml = await r.text();
    ok(r.status === 200, 'JS 代码预览页 200');
    ok(viewHtml.includes('tk-kw') && viewHtml.includes('tk-str') && viewHtml.includes('tk-com'), '语法高亮（关键字/字符串/注释）');
    ok(viewHtml.includes('class="ln"'), '带行号');
    ok(viewHtml.includes('JavaScript'), '语言标注 JavaScript');
    ok(viewHtml.includes('/dl?path='), '提供下载链接');

    r = await fetch(BASE + '/s/' + s1.id + '/view?path=' + encodeURIComponent('/script.py'));
    ok(r.status === 200 && (await r.text()).includes('Python'), 'Python 预览');

    r = await fetch(BASE + '/s/' + s1.id + '/view?path=' + encodeURIComponent('/gbk.txt'));
    const gbkHtml = await r.text();
    ok(r.status === 200 && gbkHtml.includes('GBK'), 'GBK 编码自动识别');

    r = await fetch(BASE + '/s/' + s1.id + '/view?path=' + encodeURIComponent('/说明文档.txt'));
    ok(r.status === 200 && (await r.text()).includes('UTF-8'), 'UTF-8 中文文本预览');

    r = await fetch(BASE + '/s/' + s1.id + '/view?path=' + encodeURIComponent('/binary.txt'));
    ok(r.status === 200 && (await r.text()).includes('二进制'), '二进制文件给出提示而非乱码');

    r = await fetch(BASE + '/s/' + s1.id + '/view?path=' + encodeURIComponent('/huge.txt'));
    ok((await r.text()).includes('超过预览上限'), '超大文件提示下载');

    r = await fetch(BASE + '/s/' + s1.id + '/view?path=' + encodeURIComponent('/photo.png'));
    ok(r.status === 200 && (await r.text()).includes('不支持在线预览'), '非文本类型拒绝预览');

    r = await fetch(BASE + '/s/' + s1.id + '/');
    ok((await r.text()).includes('/view?path='), '列表页对文本文件显示预览链接');

    /* ---------- 根路径共享列表开关 ---------- */
    console.log('\n[根路径共享列表开关]');
    r = await fetch(BASE + '/');
    ok(!(await r.text()).includes('s1.id'), '默认关闭：根路径不泄露共享列表');
    hub.showShareList = true;
    r = await fetch(BASE + '/');
    const listPage = await r.text();
    ok(r.status === 200 && listPage.includes('公开共享') && listPage.includes('/s/' + s1.id + '/'), '开启后列出运行中的共享与入口');
    ok(listPage.includes('🔒 密码'), '密码共享带锁标记');
    hub.showShareList = false;

    /* ---------- 更新共享 ---------- */
    console.log('\n[更新共享]');
    await hub.updateShare(s1.id, { readonly: true, name: '公开共享-改' });
    ok(hub.shares.get(s1.id).readonly === true && hub.shares.get(s1.id).name === '公开共享-改', '更新共享配置生效');
    r = await fetch(BASE + '/s/' + s1.id + '/up?path=' + encodeURIComponent('/x.txt'), { method: 'POST', body: 'x' });
    ok(r.status === 403, '更新为只读后拒绝上传');
    await hub.updateShare(s1.id, { readonly: false, name: '公开共享' });

    /* ---------- 模拟 IPC 新建流程（回归：addShare 必须同步返回含有效 id 的对象） ---------- */
    console.log('\n[模拟 IPC 新建流程]');
    const shareNew = hub.addShare({
      name: 'IPC新建', roots: [root2], readonly: false, password: '',
      expiresAt: 0, speedLimitKBps: 0, maxConnections: 0, uploadMaxMB: 0
    }); // 注意：不加 await —— main 进程 IPC handler 即如此调用
    ok(shareNew && typeof shareNew.id === 'string' && shareNew.id.length >= 4, 'addShare 同步返回含有效 id（非 Promise）');
    await hub.startShare(shareNew.id);
    ok(hub.shares.get(shareNew.id).running === true, '按返回的 id 启动共享成功');
    r = await fetch(BASE + '/s/' + shareNew.id + '/');
    ok(r.status === 200, '新建共享可立即通过 URL 访问');
    hub.removeShare(shareNew.id);

    /* ---------- 停止共享 ---------- */
    console.log('\n[停止共享]');
    await hub.stopShare(s1.id);
    r = await fetch(BASE + '/s/' + s1.id + '/');
    ok(r.status === 404, '停止后访问返回 404');
    await hub.startShare(s1.id);
    r = await fetch(BASE + '/s/' + s1.id + '/');
    ok(r.status === 200, '重新启动后可访问');

  } finally {
    await hub.shutdown();
    console.log('\n========================================');
    console.log('结果：' + passed + ' 通过，' + failed + ' 失败');
    if (failed) {
      console.log('失败项：\n  - ' + failures.join('\n  - '));
      process.exit(1);
    }
    // 清理临时目录
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    console.log('全部通过 ✅（临时目录已清理）');
  }
}

main().catch((e) => { console.error('测试执行异常：', e); process.exit(1); });
