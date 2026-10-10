'use strict';

/**
 * 轻量语法高亮引擎（零依赖，供访问端代码预览使用）
 * 设计：逐字符状态机 tokenizer，支持 C-like / Python / Shell / HTML / CSS / JSON / Markdown / SQL / 配置文件
 * 输出：<span class="tk-xxx">…</span> 序列（文本已 HTML 转义），配合深色主题 CSS 渲染
 */

const LANG_KEYWORDS = {
  js: new Set(('break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return static super switch this throw try typeof var void while with yield async await of true false null undefined NaN Infinity from as get set').split(' ')),
  clike: new Set(('break case catch class const continue default do else enum extends final finally for goto if implements import in instanceof interface new package private protected public return static super switch this throw try typeof var void while true false null abstract native synchronized transient volatile strictfp assert boolean byte char double float int long short struct union sizeof namespace using template typename virtual operator public private protected constexpr noexcept inline explicit').split(' ')),
  python: new Set(('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case self').split(' ')),
  shell: new Set(('if then else elif fi for while until do done case esac function return in select time coproc break continue exit local export readonly declare typeset unset shift eval exec source trap set echo cd ls rm cp mv mkdir rmdir grep sed awk cat chmod chown sudo apt yum brew git npm node python pip curl wget tar zip kill ps sleep test printf read').split(' ')),
  sql: new Set(('SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE DATABASE INDEX VIEW DROP ALTER ADD JOIN INNER LEFT RIGHT OUTER ON GROUP BY ORDER HAVING LIMIT OFFSET UNION ALL DISTINCT AS AND OR NOT NULL IS IN LIKE BETWEEN EXISTS CASE WHEN THEN ELSE END PRIMARY KEY FOREIGN REFERENCES DEFAULT AUTO_INCREMENT COMMIT ROLLBACK BEGIN TRANSACTION GRANT REVOKE TRUNCATE DESC ASC COUNT SUM AVG MIN MAX').split(' ')),
  go: new Set(('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false make new len cap append copy delete panic recover').split(' ')),
  rust: new Set(('as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 usize isize f32 f64 bool char str String Vec Some None Ok Err').split(' '))
};

const EXT_LANG = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js',
  py: 'python', pyw: 'python',
  html: 'html', htm: 'html', vue: 'html', xml: 'html', svg: 'html', xhtml: 'html',
  css: 'css', scss: 'css', less: 'css',
  json: 'json', jsonc: 'json',
  md: 'markdown', markdown: 'markdown',
  java: 'clike', kt: 'clike', kts: 'clike', c: 'clike', h: 'clike', cpp: 'clike', cc: 'clike',
  hpp: 'clike', hxx: 'clike', cs: 'clike', swift: 'clike', php: 'clike', dart: 'clike', scala: 'clike',
  go: 'go', rs: 'rust',
  sh: 'shell', bash: 'shell', zsh: 'shell', bat: 'shell', cmd: 'shell', ps1: 'shell',
  yml: 'conf', yaml: 'conf', toml: 'conf', ini: 'conf', conf: 'conf', cfg: 'conf', env: 'conf', properties: 'conf',
  sql: 'sql'
};

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function langOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? (EXT_LANG[m[1].toLowerCase()] || 'plain') : 'plain';
}

/**
 * 通用扫描器：C-like / Python / Shell / Go / Rust / SQL / Conf
 */
function tokenizeGeneric(code, lang) {
  const kw = lang === 'go' || lang === 'rust' ? LANG_KEYWORDS[lang]
    : lang === 'python' ? LANG_KEYWORDS.python
    : lang === 'shell' ? LANG_KEYWORDS.shell
    : lang === 'sql' ? LANG_KEYWORDS.sql
    : lang === 'js' ? LANG_KEYWORDS.js
    : LANG_KEYWORDS.clike;

  const lineComment = lang === 'python' || lang === 'shell' || lang === 'conf' ? '#'
    : lang === 'sql' ? '--' : '//';
  const hasBlockComment = !(lang === 'python' || lang === 'shell' || lang === 'conf');
  const tripleQuote = lang === 'python';
  const hashStr = lang === 'conf'; // ini/toml: key = value

  const out = [];
  const push = (type, text) => { if (text) out.push({ type, text }); };
  let i = 0;
  const n = code.length;

  while (i < n) {
    const ch = code[i];
    const two = code.substr(i, 2);

    // 行注释
    if (lineComment && two === lineComment) {
      let j = code.indexOf('\n', i);
      if (j < 0) j = n;
      push('com', code.slice(i, j));
      i = j;
      continue;
    }
    // 块注释
    if (hasBlockComment && two === '/*') {
      let j = code.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      push('com', code.slice(i, j));
      i = j;
      continue;
    }
    // Python 三引号字符串
    if (tripleQuote && (code.startsWith('"""', i) || code.startsWith("'''", i))) {
      const q = code.substr(i, 3);
      let j = code.indexOf(q, i + 3);
      j = j < 0 ? n : j + 3;
      push('str', code.slice(i, j));
      i = j;
      continue;
    }
    // 字符串
    if (ch === '"' || ch === "'" || (lang === 'js' && ch === '`')) {
      let j = i + 1;
      while (j < n) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === ch) { j++; break; }
        if (code[j] === '\n' && ch !== '`') break; // 单行字符串遇到换行终止
        j++;
      }
      push('str', code.slice(i, j));
      i = j;
      continue;
    }
    // 数字
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(code[i + 1] || ''))) {
      let j = i;
      while (j < n && /[0-9a-fA-FxXoObB._eE+-]/.test(code[j])) {
        // 防止把 e+/e- 后面不是数字的情况吞进来
        if ((code[j] === '+' || code[j] === '-') && !/[eE]/.test(code[j - 1] || '')) break;
        if (/[+-]/.test(code[j]) && !/[eE]/.test(code[j - 1] || '')) break;
        j++;
      }
      push('num', code.slice(i, j));
      i = j;
      continue;
    }
    // 标识符 / 关键字
    if (/[A-Za-z_$@#]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(code[j])) j++;
      const word = code.slice(i, j);
      if (kw.has(word)) push('kw', word);
      else if (code[j] === '(' && !lang.includes('-')) push('fn', word);
      else push('pl', word);
      i = j;
      continue;
    }
    // 空白与其他
    if (/\s/.test(ch)) {
      let j = i;
      while (j < n && /\s/.test(code[j])) j++;
      push('pl', code.slice(i, j));
      i = j;
    } else {
      let j = i + 1;
      // 连续标点合并
      while (j < n && !/[A-Za-z0-9_$\s'"`#\/]/.test(code[j])) j++;
      push('pl', code.slice(i, Math.max(j, i + 1)));
      i = Math.max(j, i + 1);
    }
  }
  return out;
}

/** HTML / XML / Vue：text 与 tag 双状态 */
function tokenizeHtml(code) {
  const out = [];
  const push = (type, text) => { if (text) out.push({ type, text }); };
  let i = 0;
  const n = code.length;
  while (i < n) {
    if (code.startsWith('<!--', i)) {
      let j = code.indexOf('-->', i);
      j = j < 0 ? n : j + 3;
      push('com', code.slice(i, j));
      i = j;
      continue;
    }
    if (code[i] === '<') {
      // 标签开始
      let j = i + 1;
      push('pl', '<');
      i++;
      if (code[i] === '/') { push('tag', '/'); i++; j = i; }
      // 标签名
      let name = '';
      while (i < n && /[A-Za-z0-9_-]/.test(code[i])) { name += code[i]; i++; }
      if (name) push('tag', name);
      // 属性区
      while (i < n && code[i] !== '>') {
        if (code.startsWith('<!--', i)) {
          let k = code.indexOf('-->', i);
          k = k < 0 ? n : k + 3;
          push('com', code.slice(i, k));
          i = k;
          continue;
        }
        if (code[i] === '"' || code[i] === "'") {
          const q = code[i];
          let k = i + 1;
          while (k < n && code[k] !== q) k++;
          k = Math.min(k + 1, n);
          push('str', code.slice(i, k));
          i = k;
          continue;
        }
        if (/[A-Za-z_@:-]/.test(code[i])) {
          let k = i;
          while (k < n && /[A-Za-z0-9_@:.\-]/.test(code[k])) k++;
          push('attr', code.slice(i, k));
          i = k;
          continue;
        }
        push('pl', code[i]);
        i++;
      }
      if (code[i] === '>') { push('tag', '>'); i++; }
      continue;
    }
    // 文本节点
    let j = code.indexOf('<', i);
    if (j < 0) j = n;
    push('pl', code.slice(i, j));
    i = j;
  }
  return out;
}

/** CSS：注释 / 字符串 / at-rule / 数字与颜色 / 属性名 */
function tokenizeCss(code) {
  const out = [];
  const push = (type, text) => { if (text) out.push({ type, text }); };
  let i = 0;
  const n = code.length;
  while (i < n) {
    if (code.startsWith('/*', i)) {
      let j = code.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      push('com', code.slice(i, j));
      i = j;
      continue;
    }
    const ch = code[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && code[j] !== ch) { if (code[j] === '\\') j++; j++; }
      j = Math.min(j + 1, n);
      push('str', code.slice(i, j));
      i = j;
      continue;
    }
    if (ch === '@') {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9-]/.test(code[j])) j++;
      push('kw', code.slice(i, j));
      i = j;
      continue;
    }
    if (ch === '#' && /[0-9a-fA-F]/.test(code[i + 1] || '')) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-F]/.test(code[j])) j++;
      push('num', code.slice(i, j));
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(code[i + 1] || ''))) {
      let j = i;
      while (j < n && /[0-9.]/.test(code[j])) j++;
      while (j < n && /[a-z%]/.test(code[j])) j++; // 单位 px/em/%
      push('num', code.slice(i, j));
      i = j;
      continue;
    }
    if (/[A-Za-z_-]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_-]/.test(code[j])) j++;
      // 后跟冒号 → 属性名
      let k = j;
      while (k < n && /\s/.test(code[k])) k++;
      push(code[k] === ':' ? 'attr' : 'pl', code.slice(i, j));
      i = j;
      continue;
    }
    if (/\s/.test(ch)) {
      let j = i;
      while (j < n && /\s/.test(code[j])) j++;
      push('pl', code.slice(i, j));
      i = j;
      continue;
    }
    push('pl', ch);
    i++;
  }
  return out;
}

/** JSON：键 / 字符串 / 数字 / 字面量 */
function tokenizeJson(code) {
  const out = [];
  const push = (type, text) => { if (text) out.push({ type, text }); };
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(true|false|null)|(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)|([\s\S])/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (m[1] !== undefined) {
      push(m[2] ? 'attr' : 'str', m[1]);
      if (m[2]) push('pl', m[2]);
    } else if (m[3] !== undefined) push('kw', m[3]);
    else if (m[4] !== undefined) push('num', m[4]);
    else push('pl', m[5]);
  }
  return out;
}

/** Markdown：行级（标题/围栏/引用/列表）+ 行内（粗体/行内码/链接） */
function tokenizeMarkdown(code) {
  const out = [];
  const push = (type, text) => { if (text) out.push({ type, text }); };
  const lines = code.split('\n');
  let inFence = false;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const tail = li < lines.length - 1 ? '\n' : '';
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      push(inFence ? 'com' : 'kw', line + tail);
      continue;
    }
    if (inFence) { push('str', line + tail); continue; }
    if (/^#{1,6}\s/.test(line)) { push('kw', line + tail); continue; }
    if (/^\s*>/.test(line)) { push('com', line + tail); continue; }
    // 行内元素
    const parts = line.split(/(`[^`]*`|\*\*[^*]+\*\*|\[[^\]]*\]\([^)]*\))/g);
    for (let p = 0; p < parts.length; p++) {
      const seg = parts[p];
      if (!seg) continue;
      if (/^`[^`]*`$/.test(seg)) push('str', seg);
      else if (/^\*\*[^*]+\*\*$/.test(seg)) push('kw', seg);
      else if (/^\[[^\]]*\]\([^)]*\)$/.test(seg)) push('attr', seg);
      else push('pl', seg + (p === parts.length - 1 ? tail : ''));
    }
    if (parts.length === 1 && !parts[0]) push('pl', tail);
  }
  return out;
}

/**
 * 高亮主入口
 * @returns {{lang: string, tokens: Array<{type:string,text:string}>}}
 */
function highlight(name, code) {
  const lang = langOf(name);
  let tokens;
  switch (lang) {
    case 'html': tokens = tokenizeHtml(code); break;
    case 'css': tokens = tokenizeCss(code); break;
    case 'json': tokens = tokenizeJson(code); break;
    case 'markdown': tokens = tokenizeMarkdown(code); break;
    default: tokens = tokenizeGeneric(code, lang);
  }
  return { lang, tokens };
}

/** tokens → 带行号的 HTML（深色主题 class：tk-<type>） */
function tokensToHtml(tokens, maxLines) {
  let html = '';
  let line = 1;
  let lineOpen = false;
  const openLine = () => { html += '<span class="cl"><span class="ln">' + line + '</span><span class="lc">'; lineOpen = true; };
  const closeLine = () => { if (lineOpen) { html += '</span></span>'; lineOpen = false; } };

  openLine();
  for (const t of tokens) {
    const segs = t.text.split('\n');
    for (let s = 0; s < segs.length; s++) {
      if (s > 0) {
        closeLine();
        line++;
        if (line > maxLines) return { html, truncated: true, lines: maxLines };
        openLine();
      }
      if (segs[s]) html += '<span class="tk-' + t.type + '">' + esc(segs[s]) + '</span>';
    }
  }
  closeLine();
  return { html, truncated: false, lines: line };
}

module.exports = { highlight, tokensToHtml, langOf, esc };
