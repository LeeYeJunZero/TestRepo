// GitHub Pages 용 정적 빌드: dist/{index.html, assets/, math|english|coding/ (→ 통합 페이지로 이동)}
//   node scripts/build-static.js            → src/defaults.js 콘텐츠 사용
//   node scripts/build-static.js --from-db  → 로컬 SQLite(어드민에서 수정한 내용) 사용
// API 주소 우선순위: STATIC_API_BASE 환경변수 → pages.config.json (npm run tunnel 이 자동 갱신)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SITE, SITE_KEY, SUBJECTS } from '../src/defaults.js';
import { renderSite, renderMaintenance, renderRedirect, renderRobots, renderSitemap, renderSchoolsIndex, renderSchoolRegion, renderSchoolCity, renderSchoolDetail, renderLeadDialog, schoolCitiesOf, schoolKindKey, SCHOOL_KINDS, SCHOOL_REGIONS } from '../src/render.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// STATIC_OUT: 출력 폴더 변경, STATIC_SCHOOL_REGIONS: 학교 상세 페이지를 만들 시·도 slug 제한 (쉼표 구분, 개발용)
const out = process.env.STATIC_OUT || path.join(root, 'dist');
const detailRegions = (process.env.STATIC_SCHOOL_REGIONS || '').split(',').filter(Boolean);
let fileCfg = {};
try { fileCfg = JSON.parse(fs.readFileSync(path.join(root, 'pages.config.json'), 'utf8')); } catch { /* 없음 */ }
// (Actions 에서 미설정 변수는 빈 문자열이므로 || 사용)
const apiBase = (process.env.STATIC_API_BASE || fileCfg.apiBase || '').replace(/\/$/, '');

// 콘텐츠 우선순위: --from-db (로컬 DB) → site-content.json (텔레그램 /publish 가 커밋) → src/defaults.js
let site;
const contentFile = path.join(root, 'site-content.json');
if (process.argv.includes('--from-db')) {
  site = (await import('../src/db.js')).getSite();
} else if (fs.existsSync(contentFile)) {
  site = { key: SITE_KEY, theme: DEFAULT_SITE.theme, status: DEFAULT_SITE.status, ...JSON.parse(fs.readFileSync(contentFile, 'utf8')) };
} else {
  site = { key: SITE_KEY, theme: DEFAULT_SITE.theme, status: DEFAULT_SITE.status, ...DEFAULT_SITE.data };
}

// fs.cpSync 는 Windows 비ASCII 경로에서 크래시하는 Node 버그가 있어 직접 복사
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, e.name), b = path.join(dst, e.name);
    e.isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b);
  }
}
fs.rmSync(out, { recursive: true, force: true });
copyDir(path.join(root, 'public/assets'), path.join(out, 'assets'));

const domain = fileCfg.customDomain || '';
const canonical = domain ? `https://${domain}/` : undefined;

// 전국 학교 페이지 (src/schools.json 은 scripts/fetch-schools.js 로 갱신)
const schools = JSON.parse(fs.readFileSync(path.join(root, 'src/schools.json'), 'utf8'));
const unknown = [...new Set(schools.map((s) => s[2]))].filter((r) => !SCHOOL_REGIONS.some((x) => x.name === r));
if (unknown.length) throw new Error(`src/render.js 의 SCHOOL_REGIONS 에 없는 지역: ${unknown.join(', ')}`);
const schoolRegions = SCHOOL_REGIONS.map((r) => {
  const list = schools.filter((s) => s[2] === r.name);
  return { ...r, count: list.length, cities: schoolCitiesOf(r, list) };
});

// 배포마다 CSS·JS 주소가 달라지게 해서, 브라우저에 남은 옛 파일이 새 페이지에 적용되지 않게 함
const assetV = crypto.createHash('sha1').update(['css/base.css', 'css/material.css', 'js/site.js'].map((f) => fs.readFileSync(path.join(root, 'public/assets', f))).join('')).digest('hex').slice(0, 8);
const opts = { assetV, assetBase: 'assets', apiBase, track: true, static: true, canonical, verify: fileCfg.verification || {}, schoolRegions };
fs.writeFileSync(path.join(out, 'assets', 'lead-dialog.html'), renderLeadDialog(site));
fs.mkdirSync(path.join(out, 'schools'), { recursive: true });
fs.writeFileSync(path.join(out, 'schools', 'index.html'), renderSchoolsIndex(site, schoolRegions, schools.length, opts));
// 학교 이름 검색용 목록 (입력 시에만 내려받음): c = [시·도 slug, 표시 지역, 폴더], s = [학교명, 학교급 번호, c 번호, 학교코드]
const searchIndex = { c: [], s: [] };
const kindIndex = Object.fromEntries(SCHOOL_KINDS.map(([k], i) => [k, i]));
const schoolPaths = ['schools/'];
for (const r of schoolRegions) {
  const dir = path.join(out, 'schools', r.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), renderSchoolRegion(site, r, opts));
  schoolPaths.push(`schools/${r.slug}/`);
  for (const c of r.cities) {
    fs.mkdirSync(path.join(dir, c.path), { recursive: true });
    fs.writeFileSync(path.join(dir, c.path, 'index.html'), renderSchoolCity(site, r, c, opts));
    schoolPaths.push(`schools/${r.slug}/${c.path}/`);
    const ci = searchIndex.c.push([r.slug, c.label, c.path]) - 1;
    for (const s of c.schools) {
      searchIndex.s.push([s[0], kindIndex[schoolKindKey(s[1])], ci, s[4]]);
      if (detailRegions.length && !detailRegions.includes(r.slug)) continue;
      fs.mkdirSync(path.join(dir, c.path, s[4]), { recursive: true });
      fs.writeFileSync(path.join(dir, c.path, s[4], 'index.html'), renderSchoolDetail(site, r, c, s, opts));
      schoolPaths.push(`schools/${r.slug}/${c.path}/${s[4]}/`);
    }
  }
}
fs.writeFileSync(path.join(out, 'schools', 'search.json'), JSON.stringify(searchIndex));
fs.writeFileSync(path.join(out, 'index.html'), site.status === 'maintenance' ? renderMaintenance(site, opts) : renderSite(site, opts));
for (const s of SUBJECTS) {
  fs.mkdirSync(path.join(out, s), { recursive: true });
  fs.writeFileSync(path.join(out, s, 'index.html'), renderRedirect(`../#subject-${s}`));
}
fs.writeFileSync(path.join(out, '404.html'), '<!doctype html><meta charset="utf-8"><title>404</title><p style="font-family:sans-serif;padding:40px">페이지를 찾을 수 없습니다.</p>');
fs.writeFileSync(path.join(out, '.nojekyll'), '');
// 커스텀 도메인 (GitHub Pages Settings → Custom domain 과 같은 값)
if (domain) fs.writeFileSync(path.join(out, 'CNAME'), `${domain}\n`);
// 검색엔진: robots.txt + sitemap.xml
fs.writeFileSync(path.join(out, 'robots.txt'), renderRobots(canonical));
if (canonical) fs.writeFileSync(path.join(out, 'sitemap.xml'), renderSitemap(canonical, new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), schoolPaths));
// 검색엔진 HTML 파일 소유확인 (pages.config.json → verificationFiles: { "google1234.html": "내용" })
for (const [name, body] of Object.entries(fileCfg.verificationFiles || {})) {
  if (/^[\w.-]+\.(html|txt|xml)$/.test(name)) fs.writeFileSync(path.join(out, name), body);
}
console.log(`built ${site.name} → dist/  (접속 기록 API: ${apiBase || '없음'})`);
