'use strict';

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.xml': 'text/xml; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
  '.zip': 'application/zip',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.apk': 'application/vnd.android.package-archive',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.msi': 'application/x-msdownload',
  '.dmg': 'application/x-apple-diskimage'
};

const INLINE_TYPES = new Set([
  'image/', 'video/', 'audio/',
  'application/pdf'
]);

function guessMime(name) {
  const i = name.lastIndexOf('.');
  if (i < 0) return 'application/octet-stream';
  return MIME_MAP[name.slice(i).toLowerCase()] || 'application/octet-stream';
}

function canInline(mime) {
  return [...INLINE_TYPES].some((p) => mime.startsWith(p));
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

/** 可用代码/文本预览页打开的扩展名 */
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'log', 'json', 'jsonc', 'xml', 'html', 'htm', 'xhtml', 'vue', 'svg',
  'css', 'scss', 'less', 'styl', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx',
  'py', 'pyw', 'java', 'kt', 'kts', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hxx', 'cs', 'swift',
  'php', 'dart', 'scala', 'go', 'rs', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'psm1',
  'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg', 'env', 'properties', 'sql',
  'csv', 'tsv', 'rb', 'pl', 'lua', 'r', 'gradle', 'groovy', 'sbt', 'cmake', 'dockerfile',
  'gitignore', 'gitattributes', 'editorconfig', 'npmrc', 'babelrc', 'prettierrc', 'htaccess'
]);

/** 常见无扩展名文本文件 */
const TEXT_NAMES = new Set([
  'makefile', 'dockerfile', 'license', 'licence', 'readme', 'changelog', 'notice', 'authors',
  'cmakelists.txt', 'vagrantfile', 'rakefile', 'gemfile', 'procfile'
]);

function isTextFile(name) {
  const lower = String(name || '').toLowerCase();
  if (TEXT_NAMES.has(lower)) return true;
  const m = /\.([a-z0-9]+)$/i.exec(lower);
  return m ? TEXT_EXTS.has(m[1]) : false;
}

module.exports = { guessMime, canInline, extOf, isTextFile, MIME_MAP };
