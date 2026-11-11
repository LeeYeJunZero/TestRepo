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
const DOMAIN = 'firstteacher.test';
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/142 Test' };
let proc, dataDir, cookie = '';

// ── 텔레그램 API 모의 서버 ──
const TG_TOKEN = '123:TEST';
const tg = { calls: [], queue: [], nextId: 1 };
const tgServer = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', async () => {
    const method = req.url.split('/').pop();
    const params = body ? JSON.parse(body) : {};
    tg.calls.push({ method, params });
    let result = true;
    if (method === 'getMe') result = { id: 1, username: 'ft_test_bot' };
    if (method === 'sendMessage') result = { message_id: tg.nextId++ };
    if (method === 'getUpdates') {
      for (let i = 0; i < 10 && !tg.queue.length; i++) await new Promise((r) => setTimeout(r, 30));
      result = tg.queue.splice(0);
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, result }));
  });
});
let updId = 1;
const tgPush = (u) => tg.queue.push({ update_id: updId++, ...u });
const tgMsg = (chatId, text) => tgPush({ message: { message_id: 1, chat: { id: chatId }, text } });
const waitFor = async (pred, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const hit = tg.calls.find(pred); if (hit) return hit; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error('timeout waiting for telegram call');
};
const sent = (chatId, re) => (c) => c.method === 'sendMessage' && c.params.chat_id === chatId && re.test(c.params.text);

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-test-'));
  await new Promise((r) => tgServer.listen(0, '127.0.0.1', r));
  proc = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ADMIN_PASSWORD: PW, SESSION_SECRET: 'x'.repeat(64),
      SITE_DOMAIN: DOMAIN, CORS_ORIGINS: ORIGIN, NODE_ENV: 'test',
      TELEGRAM_BOT_TOKEN: TG_TOKEN, TELEGRAM_API_BASE: `http://127.0.0.1:${tgServer.address().port}`, TELEGRAM_CLICK_BATCH_MS: '150' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});
after(() => { tgServer.close(); tgServer.closeAllConnections?.(); proc?.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} });

const get = (p, headers = {}) => fetch(BASE + p, { headers: { ...UA, ...headers }, redirect: 'manual' });
const json = (p, method, body, headers = {}) => fetch(BASE + p, {
  method, headers: { 'Content-Type': 'application/json', ...UA, ...headers }, body: JSON.stringify(body)
});
const adm = (p, method = 'GET', body) => body !== undefined
  ? json('/api/admin' + p, method, body, { cookie })
  : fetch(BASE + '/api/admin' + p, { method, headers: { cookie } });
// fetch 는 Host 헤더를 덮어쓰므로 node:http 로 가상 호스트 요청
const hostGet = (host, p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p, headers: { host, ...UA } }, (res) => {
    let body = ''; res.setEncoding('utf8');
    res.on('data', (c) => (body += c)); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
  }).on('error', reject);
});

test('R-01 퍼스트티쳐 단일 페이지: 머티리얼 디자인 + 수학·영어·코딩 통합', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('<title>퍼스트티쳐'));
  assert.ok(html.includes('/assets/css/material.css') && html.includes('theme-material'));
  for (const id of ['subjects', 'features', 'courses', 'tutors', 'faq', 'apply']) assert.ok(html.includes(`id="${id}"`), `#${id}`);
  for (const s of ['math', 'english', 'coding']) {
    assert.ok(html.includes(`id="subject-${s}"`), `과목 블록 ${s}`);
    assert.ok(html.includes(`data-impression="${s}"`), `노출 추적 ${s}`);
  }
  for (const t of ['중등 내신 완성', '중·고등 내신·모의고사 영어', '파이썬 기초 → 심화']) assert.ok(html.includes(t));
  assert.equal((await get('/assets/css/material.css')).status, 200);
  for (const gone of ['flat', 'fluent', 'portal']) assert.equal((await get(`/assets/css/${gone}.css`)).status, 404);
});

test('R-17 신뢰 콘텐츠: 1:1 맞춤·무료 학습 30분·학부모 고민·내신·모의고사, 첫 방문 팝업', async () => {
  const html = await (await get('/')).text();
  for (const id of ['worries', 'trial', 'exams', 'leadDialog', 'leadForm']) assert.ok(html.includes(`id="${id}"`), `#${id}`);
  for (const t of ['1:1 맞춤 수업', '무료 학습 30분', '중등 내신', '고등 내신', '모의고사']) assert.ok(html.includes(t), t);
  for (const n of ['grade', 'mode', 'name', 'phone', 'school', 'address', 'message', 'agree']) assert.ok(html.includes(`name="${n}"`), n);
  assert.ok(html.includes('value="방문수업"') && html.includes('value="화상수업"'));
  assert.ok(!html.includes('상관없음'), '수업 방식은 방문·화상 두 가지');
  assert.ok(html.includes('보유 기간'), '수집 항목·목적·보유 기간 안내');
});

test('R-02 기존 과목별 주소 → 통합 페이지 과목 섹션으로 301', async () => {
  for (const s of ['math', 'english', 'coding']) {
    const r = await get(`/${s}/`);
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), `/#subject-${s}`);
  }
});

test('R-03 도메인 라우팅: 루트·www → 사이트, admin. → 어드민, 루트의 /admin 차단', async () => {
  assert.ok((await hostGet(DOMAIN, '/')).body.includes('퍼스트티쳐'));
  assert.ok((await hostGet('www.' + DOMAIN, '/')).body.includes('퍼스트티쳐'));
  assert.ok((await hostGet(DOMAIN, '/')).body.includes(`rel="canonical" href="https://${DOMAIN}/"`));
  assert.ok((await hostGet('admin.' + DOMAIN, '/')).body.includes('퍼스트티쳐 어드민'));
  assert.ok((await hostGet('admin.' + DOMAIN, '/admin.js')).body.includes('loadRanking'));
  assert.equal((await hostGet('admin.' + DOMAIN, '/assets/css/material.css')).status, 200);
  assert.equal((await hostGet(DOMAIN, '/admin/')).status, 404);
  assert.equal((await hostGet(DOMAIN, '/api/admin/me')).status, 404);
  assert.equal((await hostGet('admin.' + DOMAIN, '/api/admin/me')).status, 401);
});

test('R-04 어드민 인증: 비로그인 401, 오답 401, 정답 로그인, 위조 토큰 거부', async () => {
  assert.equal((await fetch(BASE + '/api/admin/stats')).status, 401);
  assert.equal((await json('/api/admin/login', 'POST', { password: 'wrong' })).status, 401);
  const ok = await json('/api/admin/login', 'POST', { password: PW });
  assert.equal(ok.status, 200);
  const sc = ok.headers.get('set-cookie');
  assert.match(sc, /adm=.*HttpOnly.*SameSite=Strict/);
  cookie = sc.split(';')[0];
  assert.equal((await adm('/me')).status, 200);
  assert.equal((await fetch(BASE + '/api/admin/me', { headers: { cookie: cookie.slice(0, -3) + 'abc' } })).status, 401);
});

test('R-05 접속 기록: 날짜·시각(시:분)·경로·IP·UA·리퍼러, 봇 구분', async () => {
  await get('/', { 'user-agent': 'Mozilla/5.0 (iPhone) Mobile', referer: 'https://search.naver.com/x' });
  await get('/', { 'user-agent': 'Googlebot/2.1' });
  const r = await (await adm('/visits')).json();
  const row = r.rows.find((x) => x.referrer.includes('naver'));
  assert.ok(row);
  assert.match(row.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(row.mobile, 1);
  assert.ok(row.ip);
  assert.ok(!r.rows.some((x) => x.bot));
  assert.ok((await (await adm('/visits?bots=1')).json()).rows.some((x) => x.bot === 1));
});

test('R-06 과목 이벤트: 노출(view)·클릭(click) 기록, 검증, 봇 무시', async () => {
  const vid = 'b'.repeat(32);
  const ev = (body, h) => json('/api/event', 'POST', { vid, ...body }, h);
  // 영어: 노출 3, 클릭 2 / 수학: 노출 2, 클릭 2 / 코딩: 노출 1, 클릭 0
  for (const s of ['english', 'english', 'english', 'math', 'math', 'coding']) assert.equal((await ev({ kind: 'view', subject: s })).status, 204);
  for (const [s, label] of [['english', '이 과정 상담하기'], ['english', '영어 과정 보기'], ['math', '이 과정 상담하기'], ['math', '이 과정 상담하기']]) {
    assert.equal((await ev({ kind: 'click', subject: s, label, href: '#apply' })).status, 204);
  }
  assert.equal((await ev({ kind: 'click', subject: '', label: 'FAQ' })).status, 204); // 과목 외 클릭(공통)
  assert.equal((await ev({ kind: 'view', subject: 'history' })).status, 400);
  assert.equal((await ev({ kind: 'hack', subject: 'math' })).status, 400);
  await ev({ kind: 'click', subject: 'coding', label: 'bot' }, { 'user-agent': 'HeadlessChrome' });
  const e = await (await adm('/events?subject=coding')).json();
  assert.equal(e.total, 0, '봇 클릭은 기록되지 않음');
});

test('R-07 누적 과목 순위: 노출 순 정렬, 클릭률 = 클릭 ÷ 노출, 최다/최고 표시', async () => {
  const r = await (await adm('/ranking')).json();
  assert.deepEqual(r.rows.map((x) => x.subject), ['english', 'math', 'coding']);
  assert.deepEqual(r.rows.map((x) => x.rank), [1, 2, 3]);
  const by = Object.fromEntries(r.rows.map((x) => [x.subject, x]));
  assert.equal(by.english.views, 3); assert.equal(by.english.clicks, 2); assert.equal(by.english.ctr, 66.7);
  assert.equal(by.math.views, 2); assert.equal(by.math.clicks, 2); assert.equal(by.math.ctr, 100);
  assert.equal(by.coding.ctr, 0);
  assert.equal(by.math.topClicks[0].label, '이 과정 상담하기');
  assert.equal(by.math.topClicks[0].n, 2);
  assert.equal(r.mostViewed, 'english');
  assert.equal(r.bestCtr, 'math');
  assert.ok(r.page.pv >= 1);
});

test('R-08 기간 통계 + 접속 기록에 본/클릭한 과목 요약', async () => {
  const s = await (await adm('/stats?days=7')).json();
  assert.ok(s.totals.pv >= 1);
  assert.equal(s.subjects.find((x) => x.subject === 'english').views, 3);
  assert.ok(s.dailySubj.length >= 1 && s.hourly.length >= 1);
  assert.ok(s.topReferrers.some((r) => r.host === 'search.naver.com'));
  // 방문자 b... 의 페이지 조회 → 같은 방문자 이벤트가 요약됨
  const vid = 'b'.repeat(32);
  await json('/api/track', 'POST', { path: '/', vid }, { origin: ORIGIN });
  await json('/api/event', 'POST', { kind: 'view', subject: 'coding', vid });
  const v = await (await adm('/visits?limit=5')).json();
  const row = v.rows.find((x) => x.visitor === vid);
  assert.ok(row.viewed.includes('coding'));
  // 서버 모드: 쿠키 vid 로 페이지 조회 ↔ 과목 이벤트가 연결됨 (body vid 가 달라도)
  const page = await get('/');
  const ck = page.headers.get('set-cookie').split(';')[0];
  await json('/api/event', 'POST', { kind: 'click', subject: 'math', label: 'x', vid: 'c'.repeat(32) }, { cookie: ck });
  const v2 = await (await adm('/visits?limit=3')).json();
  assert.ok(v2.rows.find((x) => x.visitor === ck.split('=')[1]).clicked.includes('math'));
  const clicks = await (await adm('/events')).json();
  assert.ok(clicks.rows.every((x) => x.kind === 'click'));
});

test('R-09 상담 신청: 검증 → 저장 → 상태/메모 → 삭제', async () => {
  assert.equal((await json('/api/inquiry', 'POST', { name: '', phone: '010', agree: true })).status, 400);
  assert.equal((await json('/api/inquiry', 'POST', { name: '홍길동', phone: '010-1234-5678', agree: false })).status, 400);
  const ok = await json('/api/inquiry', 'POST', { name: '홍길동', phone: '010-1234-5678', grade: '중학생', subject: '수학 · 중등 내신 완성', message: '상담', agree: true });
  assert.equal(ok.status, 200);
  const it = (await (await adm('/inquiries')).json()).rows.find((x) => x.name === '홍길동');
  assert.equal(it.subject, '수학 · 중등 내신 완성');
  assert.equal((await adm('/inquiries/' + it.id, 'PATCH', { status: 'contacted', memo: '내일 통화' })).status, 200);
  assert.equal((await (await adm('/inquiries?status=contacted')).json()).rows[0].memo, '내일 통화');
  assert.equal((await adm('/inquiries/' + it.id, 'DELETE')).status, 200);
});

test('R-10 사이트 관리: 콘텐츠·과목별 과정 수정 즉시 반영, XSS 이스케이프, 과목 검증', async () => {
  const { site } = await (await adm('/site')).json();
  const courses = [...site.courses, { subject: 'coding', name: '앱 개발 신규반', target: '고등', desc: 'd', price: '월 1원' }];
  const r = await adm('/site', 'PUT', { ...site, notice: '공지 <script>alert(1)</script>', courses });
  assert.equal(r.status, 200);
  const html = await (await get('/')).text();
  assert.ok(html.includes('공지 &lt;script&gt;'));
  assert.ok(!html.includes('<script>alert(1)'));
  const codingBlock = html.slice(html.indexOf('id="subject-coding"'));
  assert.ok(codingBlock.includes('앱 개발 신규반'));
  assert.equal((await adm('/site', 'PUT', { ...site, courses: [{ subject: 'history', name: 'x' }] })).status, 400);
  assert.equal((await adm('/site', 'PUT', { ...site, color: 'red' })).status, 400);
  assert.equal((await adm('/site', 'PUT', { ...site, kakao: 'javascript:alert(1)' })).status, 400);
  assert.equal((await adm('/site', 'PUT', { ...site, subjects: [site.subjects[0], site.subjects[0]] })).status, 400);
});

test('R-11 점검 모드: 503 안내 + 상담 접수 중단 → 복구', async () => {
  const { site } = await (await adm('/site')).json();
  await adm('/site', 'PUT', { ...site, status: 'maintenance' });
  const m = await get('/');
  assert.equal(m.status, 503);
  assert.ok((await m.text()).includes('점검'));
  assert.equal((await json('/api/inquiry', 'POST', { name: 'a', phone: '010-1111-2222', agree: true })).status, 400);
  await adm('/site', 'PUT', { ...site, status: 'live' });
  assert.equal((await get('/')).status, 200);
});

test('R-12 GitHub Pages 연동: track·event·inquiry CORS 허용(허용 origin 만), 어드민 API 비허용', async () => {
  for (const p of ['/api/track', '/api/event', '/api/inquiry']) {
    const pre = await fetch(BASE + p, { method: 'OPTIONS', headers: { origin: ORIGIN } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal((await fetch(BASE + p, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } })).status, 403);
  }
  const a = await fetch(BASE + '/api/admin/stats', { headers: { origin: ORIGIN, cookie } });
  assert.equal(a.headers.get('access-control-allow-origin'), null);
  const vid = 'a'.repeat(32);
  assert.equal((await json('/api/track', 'POST', { path: '/TestRepo/', vid }, { origin: ORIGIN })).status, 204);
  const r = await (await adm('/visits')).json();
  assert.ok(r.rows.some((x) => x.visitor === vid && x.path.includes('example-user.github.io')));
});

test('R-13 보안: CSRF(비 JSON 변경요청 거부), 로그인 시도 제한', async () => {
  const r = await fetch(BASE + '/api/admin/inquiries/1', { method: 'PATCH', headers: { cookie, 'content-type': 'text/plain' }, body: 'x' });
  assert.equal(r.status, 415);
  let last;
  for (let i = 0; i < 10; i++) last = await json('/api/admin/login', 'POST', { password: 'nope' });
  assert.equal(last.status, 429);
});

test('R-14 정적 빌드: dist/index.html 통합 페이지 + 기존 과목 주소 리다이렉트', () => {
  execFileSync(process.execPath, ['scripts/build-static.js'], { cwd: root, env: { ...process.env, STATIC_API_BASE: 'https://api.ft.test' } });
  const html = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
  assert.ok(html.includes('퍼스트티쳐'));
  assert.ok(html.includes('href="assets/css/material.css"'));
  assert.ok(html.includes('data-api="https://api.ft.test"') && html.includes('data-track="1"') && html.includes('data-static="1"'));
  for (const s of ['math', 'english', 'coding']) {
    assert.ok(fs.readFileSync(path.join(root, 'dist', s, 'index.html'), 'utf8').includes(`url=../#subject-${s}`));
  }
  assert.ok(fs.existsSync(path.join(root, 'dist', 'assets', 'js', 'site.js')));
});

test('R-15 검색엔진: robots·sitemap·canonical·OG·구조화 데이터·소유확인 메타', async () => {
  // 서버 모드 (도메인 설정)
  const robots = await hostGet(DOMAIN, '/robots.txt');
  assert.match(robots.body, /Allow: \//);
  assert.match(robots.body, new RegExp(`Sitemap: https://${DOMAIN}/sitemap.xml`));
  assert.match((await hostGet('admin.' + DOMAIN, '/robots.txt')).body, /Disallow: \//);
  const sm = await hostGet(DOMAIN, '/sitemap.xml');
  assert.equal(sm.status, 200);
  assert.match(sm.body, new RegExp(`<loc>https://${DOMAIN}/</loc>`));
  const html = (await hostGet(DOMAIN, '/')).body;
  assert.ok(html.includes(`<meta property="og:image" content="https://${DOMAIN}/assets/og.png">`));
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const org = blocks.find((b) => b['@type'] === 'EducationalOrganization');
  assert.equal(org.name, '퍼스트티쳐');
  assert.ok(org.hasOfferCatalog.itemListElement.length >= 9);
  assert.ok(!('telephone' in org), '예시 전화번호는 구조화 데이터에서 제외');
  assert.ok(blocks.some((b) => b['@type'] === 'FAQPage'));
  assert.equal((await get('/assets/og.png')).status, 200);
  // 소유확인 메타 + JSON-LD 의 </script> 탈출 방지
  const { renderSite } = await import('../src/render.js');
  const { DEFAULT_SITE } = await import('../src/defaults.js');
  const out = renderSite({ key: 'x', ...DEFAULT_SITE.data, heroSub: '</script><script>alert(1)</script>' },
    { canonical: 'https://a.test/', verify: { google: 'G-CODE', naver: 'N-CODE', bing: 'B-CODE' } });
  assert.ok(out.includes('<meta name="google-site-verification" content="G-CODE">'));
  assert.ok(out.includes('<meta name="naver-site-verification" content="N-CODE">'));
  assert.ok(out.includes('<meta name="msvalidate.01" content="B-CODE">'));
  assert.ok(!out.includes('</script><script>alert(1)'));
  // 정적 빌드
  execFileSync(process.execPath, ['scripts/build-static.js'], { cwd: root });
  const dist = (f) => fs.readFileSync(path.join(root, 'dist', f), 'utf8');
  assert.match(dist('robots.txt'), /Sitemap: https:\/\/firstteacher\.co\.kr\/sitemap\.xml/);
  assert.match(dist('sitemap.xml'), /<loc>https:\/\/firstteacher\.co\.kr\/<\/loc>/);
  assert.equal(dist('CNAME').trim(), 'firstteacher.co.kr');
  assert.ok(dist('index.html').includes('<link rel="canonical" href="https://firstteacher.co.kr/">'));
  assert.ok(dist('math/index.html').includes('noindex'));
  assert.ok(fs.existsSync(path.join(root, 'dist', 'assets', 'og.png')));
});

test('R-16 텔레그램 봇: 페어링·상담 알림·버튼 처리·클릭 묶음 알림·명령·권한', async () => {
  await waitFor((c) => c.method === 'getMe');
  assert.ok(tg.calls.some((c) => c.method === 'setMyCommands' && c.params.commands.some((x) => x.command === 'rank')));
  const ADMIN = 777, STRANGER = 999;
  // 미등록 채팅 거부
  tgMsg(STRANGER, '/rank');
  await waitFor(sent(STRANGER, /등록되지 않은 채팅/));
  // 잘못된 비밀번호 → 거부, 올바른 비밀번호 → 등록
  tgMsg(ADMIN, '/pair wrong');
  await waitFor(sent(ADMIN, /비밀번호가 올바르지 않습니다/));
  tgMsg(ADMIN, '/pair ' + PW);
  await waitFor(sent(ADMIN, /관리자로 등록/));
  // 상담 신청 → 즉시 알림 + 인라인 버튼
  const r = await json('/api/inquiry', 'POST', { name: '김알림', phone: '010-5555-6666', grade: '고등학생', subject: '코딩 · 웹 개발 포트폴리오', message: '주말 가능?', agree: true }, { origin: ORIGIN });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  const note = await waitFor(sent(ADMIN, /김알림/));
  assert.match(note.params.text, /상담 신청 #\d+/);
  assert.match(note.params.text, /010-5555-6666/);
  const btn = note.params.reply_markup.inline_keyboard[0].find((b) => b.text.includes('연락완료'));
  const id = Number(btn.callback_data.split(':')[1]);
  // 버튼: 연락완료 → DB 반영 + 메시지 수정
  tgPush({ callback_query: { id: 'cb1', data: btn.callback_data, message: { message_id: note.params.message_id || 1, chat: { id: ADMIN } } } });
  await waitFor((c) => c.method === 'answerCallbackQuery' && c.params.callback_query_id === 'cb1');
  await waitFor((c) => c.method === 'editMessageText' && /연락완료/.test(c.params.text));
  const inq = (await (await adm('/inquiries')).json()).rows.find((x) => x.id === id);
  assert.equal(inq.status, 'contacted');
  // 클릭 2건 → 묶음 알림 1건
  await json('/api/event', 'POST', { kind: 'click', subject: 'english', label: '영어 과정 보기' });
  await json('/api/event', 'POST', { kind: 'click', subject: 'coding', label: '이 과정 상담하기' });
  const batch = await waitFor(sent(ADMIN, /클릭 2건/));
  assert.match(batch.params.text, /영어 · 영어 과정 보기/);
  assert.match(batch.params.text, /코딩 · 이 과정 상담하기/);
  // 명령
  tgMsg(ADMIN, '/rank');
  await waitFor(sent(ADMIN, /누적 과목 순위/));
  tgMsg(ADMIN, '/stats 7');
  await waitFor(sent(ADMIN, /통계 \(최근 7일\)/));
  tgMsg(ADMIN, '/clicks 5');
  await waitFor(sent(ADMIN, /최근 클릭/));
  tgMsg(ADMIN, '/notice 텔레그램 공지 테스트');
  await waitFor(sent(ADMIN, /공지 변경: 텔레그램 공지 테스트/));
  assert.ok((await (await get('/')).text()).includes('텔레그램 공지 테스트'));
  // 알림 끄기 → 클릭 알림 없음
  tgPush({ callback_query: { id: 'cb2', data: 'notify:click', message: { message_id: 5, chat: { id: ADMIN } } } });
  await waitFor((c) => c.method === 'answerCallbackQuery' && c.params.callback_query_id === 'cb2');
  const before = tg.calls.length;
  await json('/api/event', 'POST', { kind: 'click', subject: 'math', label: 'off 테스트' });
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(!tg.calls.slice(before).some((c) => c.method === 'sendMessage' && /off 테스트/.test(c.params.text)));
  // 터널(Cloudflare) 경유 웹 어드민 차단
  assert.equal((await fetch(BASE + '/api/admin/me', { headers: { cookie, 'cf-connecting-ip': '1.2.3.4' } })).status, 404);
  assert.equal((await fetch(BASE + '/admin/', { headers: { 'cf-connecting-ip': '1.2.3.4' } })).status, 404);
});
