// GitHub Pages 용 정적 빌드: dist/{index.html, math/, english/, coding/, assets/}
//   node scripts/build-static.js            → src/defaults.js 콘텐츠 사용
//   node scripts/build-static.js --from-db  → 로컬 SQLite(어드민에서 수정한 내용) 사용
//   STATIC_API_BASE=https://api.example.com → 상담 신청·방문 기록을 해당 서버로 전송
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SITES, SITE_KEYS } from '../src/defaults.js';
import { renderSite, renderMaintenance, renderPortal } from '../src/render.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
// API 주소 우선순위: STATIC_API_BASE 환경변수 → pages.config.json (npm run tunnel 이 자동 갱신)
let fileCfg = {};
try { fileCfg = JSON.parse(fs.readFileSync(path.join(root, 'pages.config.json'), 'utf8')); } catch { /* 없음 */ }
const apiBase = (process.env.STATIC_API_BASE || fileCfg.apiBase || '').replace(/\/$/, '');

let sites;
if (process.argv.includes('--from-db')) {
  const { listSites } = await import('../src/db.js');
  sites = listSites();
} else {
  sites = SITE_KEYS.map((key) => ({ key, theme: DEFAULT_SITES[key].theme, status: DEFAULT_SITES[key].status, ...DEFAULT_SITES[key].data }));
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
// fs.cpSync 는 Windows 비ASCII 경로에서 크래시하는 Node 버그가 있어 직접 복사
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, e.name), b = path.join(dst, e.name);
    e.isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b);
  }
}
copyDir(path.join(root, 'public/assets'), path.join(out, 'assets'));

const visible = sites.filter((s) => s.status !== 'hidden');
for (const s of visible) {
  fs.mkdirSync(path.join(out, s.key), { recursive: true });
  const opts = { assetBase: '../assets', apiBase, track: true, static: true };
  const html = s.status === 'maintenance' ? renderMaintenance(s, opts) : renderSite(s, opts);
  fs.writeFileSync(path.join(out, s.key, 'index.html'), html);
}
fs.writeFileSync(path.join(out, 'index.html'), renderPortal(visible, (k) => `${k}/`, 'assets'));
fs.writeFileSync(path.join(out, '404.html'), '<!doctype html><meta charset="utf-8"><title>404</title><p style="font-family:sans-serif;padding:40px">페이지를 찾을 수 없습니다. <a href="./">처음으로</a></p>');
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`built ${visible.length} sites → dist/  (API: ${apiBase || '없음 – 미리보기 모드'})`);
