// 요구사항 명세서(REQUIREMENTS.md)의 각 항목을 실제 서버를 띄워 검증합니다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'test-password-1';
const ORIGIN = 'https://example-user.github.io';
let proc, dataDir, cookie = '';

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tutor-test-'));
  proc = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ADMIN_PASSWORD: PW, SESSION_SECRET: 'x'.repeat(64),
      SITE_DOMAIN: 'tutor.test', CORS_ORIGINS: ORIGIN, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});
after(() => { proc?.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} });

const get = (p, headers = {}) => fetch(BASE + p, { headers, redirect: 'manual' });
const json = (p, method, body, headers = {}) => fetch(BASE + p, {
  method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
});
const adm = (p, method = 'GET', body) => body !== undefined
  ? json('/api/admin' + p, method, body, { cookie })
  : fetch(BASE + '/api/admin' + p, { method, headers: { cookie } });

test('R-01 포털: 하위 사이트 3개 링크 노출', async () => {
  const html = await (await get('/')).text();
  for (const name of ['셈터 수학과외', '링고브릿지 영어과외', '코드멘토 코딩과외']) assert.ok(html.includes(name), name);
});

test('R-02 하위 사이트 3종: 각기 다른 디자인 테마로 렌더링', async () => {
  for (const [key, theme] of [['math', 'flat'], ['english', 'material'], ['coding', 'fluent']]) {
    const res = await get(`/${key}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes(`/assets/css/${theme}.css`), `${key} → ${theme}.css`);
    assert.ok(html.includes(`theme-${theme}`));
    for (const id of ['features', 'courses', 'tutors', 'faq', 'apply']) assert.ok(html.includes(`id="${id}"`), `${key} #${id}`);
  }
  assert.equal((await get('/math')).status, 301);
  for (const f of ['base', 'flat', 'material', 'fluent']) assert.equal((await get(`/assets/css/${f}.css`)).status, 200);
});

// fetch 는 Host 헤더를 덮어쓰므로 node:http 로 가상 호스트 요청
const hostGet = (host, p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p, headers: { host } }, (res) => {
    let body = ''; res.setEncoding('utf8');
    res.on('data', (c) => (body += c)); res.on('end', () => resolve({ status: res.statusCode, body }));
  }).on('error', reject);
});

test('R-03 서브도메인 라우팅 (admin./math./english./coding.)', async () => {
  assert.ok((await hostGet('math.tutor.test', '/')).body.includes('theme-flat'));
  assert.ok((await hostGet('english.tutor.test', '/')).body.includes('theme-material'));
  assert.ok((await hostGet('coding.tutor.test', '/')).body.includes('theme-fluent'));
  assert.ok((await hostGet('admin.tutor.test', '/')).body.includes('어드민 로그인'));
  assert.ok((await hostGet('admin.tutor.test', '/admin.js')).body.includes('loadDash'));
  assert.equal((await hostGet('math.tutor.test', '/assets/css/flat.css')).status, 200);
  assert.equal((await hostGet('math.tutor.test', '/api/admin/me')).status, 401);
  assert.ok((await hostGet('tutor.test', '/')).body.includes('https://math.tutor.test/'));
});

test('R-04 어드민 인증: 비로그인 401, 오답 401, 정답 로그인', async () => {
  assert.equal((await fetch(BASE + '/api/admin/stats')).status, 401);
  assert.equal((await json('/api/admin/login', 'POST', { password: 'wrong' })).status, 401);
  const ok = await json('/api/admin/login', 'POST', { password: PW });
  assert.equal(ok.status, 200);
  const sc = ok.headers.get('set-cookie');
  assert.match(sc, /adm=.*HttpOnly.*SameSite=Strict/);
  cookie = sc.split(';')[0];
  assert.equal((await adm('/me')).status, 200);
  // 위조 토큰 거부
  assert.equal((await fetch(BASE + '/api/admin/me', { headers: { cookie: cookie.slice(0, -3) + 'abc' } })).status, 401);
});

test('R-05 접속 기록: 사이트 방문 시 사이트·IP·UA·리퍼러 저장, 봇 구분', async () => {
  await get('/english/', { 'user-agent': 'Mozilla/5.0 (iPhone) Mobile', referer: 'https://search.naver.com/x' });
  await get('/english/', { 'user-agent': 'Googlebot/2.1' });
  const r = await (await adm('/visits?site=english')).json();
  const row = r.rows.find((x) => x.referrer.includes('naver'));
  assert.ok(row, 'naver 유입 기록');
  assert.equal(row.site, 'english');
  assert.equal(row.mobile, 1);
  assert.ok(row.ip);
  assert.ok(!r.rows.some((x) => x.bot), '기본 목록은 봇 제외');
  const withBots = await (await adm('/visits?site=english&bots=1')).json();
  assert.ok(withBots.rows.some((x) => x.bot === 1));
});

test('R-06 통계: 사이트별 PV/UV, 일별·시간대별, 유입 TOP', async () => {
  const s = await (await adm('/stats?days=7')).json();
  assert.deepEqual(s.sites, ['math', 'english', 'coding']);
  const en = s.perSite.find((x) => x.site === 'english');
  assert.ok(en.pv >= 1 && en.uv >= 1);
  assert.ok(s.daily.length >= 1);
  assert.ok(s.hourly.length >= 1);
  assert.ok(s.topReferrers.some((r) => r.host === 'search.naver.com'));
});

test('R-07 상담 신청: 검증 → 저장 → 어드민 상태/메모 관리 → 삭제', async () => {
  assert.equal((await json('/api/inquiry', 'POST', { site: 'math', name: '', phone: '010', agree: true })).status, 400);
  assert.equal((await json('/api/inquiry', 'POST', { site: 'math', name: '홍길동', phone: '010-1234-5678', agree: false })).status, 400);
  assert.equal((await json('/api/inquiry', 'POST', { site: 'nope', name: '홍길동', phone: '010-1234-5678', agree: true })).status, 400);
  const ok = await json('/api/inquiry', 'POST', { site: 'math', name: '홍길동', phone: '010-1234-5678', grade: '중학생', subject: '중등 내신 완성', message: '상담 원해요', agree: true });
  assert.equal(ok.status, 200);
  const list = await (await adm('/inquiries?site=math')).json();
  const it = list.rows.find((x) => x.name === '홍길동');
  assert.equal(it.status, 'new');
  assert.equal((await adm('/inquiries/' + it.id, 'PATCH', { status: 'contacted', memo: '내일 통화' })).status, 200);
  const after = (await (await adm('/inquiries?status=contacted')).json()).rows.find((x) => x.id === it.id);
  assert.equal(after.memo, '내일 통화');
  assert.equal((await adm('/inquiries/' + it.id, 'PATCH', { status: 'bogus' })).status, 400);
  assert.equal((await adm('/inquiries/' + it.id, 'DELETE')).status, 200);
});

test('R-08 사이트 관리: 콘텐츠 수정 즉시 반영 + XSS 이스케이프', async () => {
  const { sites } = await (await adm('/sites')).json();
  const cur = sites.find((s) => s.key === 'coding');
  const res = await adm('/sites/coding', 'PUT', { ...cur, notice: '테스트 공지 <script>alert(1)</script>', courses: [{ name: '신규 과정', target: '누구나', desc: 'd', price: '월 1원' }] });
  assert.equal(res.status, 200);
  const html = await (await get('/coding/')).text();
  assert.ok(html.includes('테스트 공지 &lt;script&gt;'));
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(html.includes('신규 과정'));
  assert.equal((await adm('/sites/coding', 'PUT', { ...cur, color: 'red' })).status, 400);
  assert.equal((await adm('/sites/coding', 'PUT', { ...cur, kakao: 'javascript:alert(1)' })).status, 400);
});

test('R-09 사이트 관리: 운영/점검/숨김 상태 전환', async () => {
  const { sites } = await (await adm('/sites')).json();
  const cur = sites.find((s) => s.key === 'english');
  await adm('/sites/english', 'PUT', { ...cur, status: 'maintenance' });
  const m = await get('/english/');
  assert.equal(m.status, 503);
  assert.ok((await m.text()).includes('점검'));
  assert.equal((await json('/api/inquiry', 'POST', { site: 'english', name: 'a', phone: '010-1111-2222', agree: true })).status, 400);
  await adm('/sites/english', 'PUT', { ...cur, status: 'hidden' });
  assert.equal((await get('/english/')).status, 404);
  assert.ok(!(await (await get('/')).text()).includes('링고브릿지'));
  await adm('/sites/english', 'PUT', { ...cur, status: 'live' });
  assert.equal((await get('/english/')).status, 200);
});

test('R-10 GitHub Pages 연동: CORS 허용 origin 만 통과, 방문 비콘 기록', async () => {
  const pre = await fetch(BASE + '/api/track', { method: 'OPTIONS', headers: { origin: ORIGIN } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
  const bad = await fetch(BASE + '/api/track', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  assert.equal(bad.status, 403);
  const vid = 'a'.repeat(32);
  const t = await json('/api/track', 'POST', { site: 'math', path: '/repo/math/', referrer: '', vid }, { origin: ORIGIN });
  assert.equal(t.status, 204);
  const r = await (await adm('/visits?site=math')).json();
  assert.ok(r.rows.some((x) => x.visitor === vid && x.path.includes('example-user.github.io')));
  // 어드민 API 는 CORS 미허용
  const a = await fetch(BASE + '/api/admin/stats', { headers: { origin: ORIGIN, cookie } });
  assert.equal(a.headers.get('access-control-allow-origin'), null);
});

test('R-11 보안: CSRF(비 JSON 변경요청 거부), 로그인 브루트포스 제한', async () => {
  const r = await fetch(BASE + '/api/admin/inquiries/1', { method: 'PATCH', headers: { cookie, 'content-type': 'text/plain' }, body: 'x' });
  assert.equal(r.status, 415);
  let last;
  for (let i = 0; i < 10; i++) last = await json('/api/admin/login', 'POST', { password: 'nope' });
  assert.equal(last.status, 429);
});

test('R-12 정적 빌드: dist 에 3개 사이트 + 상대 경로 자산', () => {
  execFileSync(process.execPath, ['scripts/build-static.js'], { cwd: root, env: { ...process.env, STATIC_API_BASE: 'https://api.tutor.test' } });
  for (const k of ['math', 'english', 'coding']) {
    const html = fs.readFileSync(path.join(root, 'dist', k, 'index.html'), 'utf8');
    assert.ok(html.includes('href="../assets/css/base.css"'));
    assert.ok(html.includes('data-api="https://api.tutor.test"'));
    assert.ok(html.includes('data-track="1"'));
  }
  const portal = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
  assert.ok(portal.includes('href="math/"') && portal.includes('href="assets/css/portal.css"'));
  assert.ok(fs.existsSync(path.join(root, 'dist', 'assets', 'js', 'site.js')));
});
