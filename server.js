import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getSite, saveSite, insertVisit, insertEvent, insertInquiry } from './src/db.js';
import fs from 'node:fs';
import { getStats, getRanking, purgeOlderThan, INQ_STATUS, getInquiry } from './src/stats.js';
import { createTelegramBot } from './src/telegram.js';
import { renderSite, renderMaintenance, renderRobots, renderSitemap } from './src/render.js';
import { SITE_KEY, SUBJECTS, SUBJECT_NAME, TEXT_FIELDS, LIST_FIELDS, SUBJECT_FIELDS, STATUSES } from './src/defaults.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === 'production';
// 예: firstteacher.co.kr → 사이트: firstteacher.co.kr / www.firstteacher.co.kr, 어드민: admin.firstteacher.co.kr
const DOMAIN = (process.env.SITE_DOMAIN || '').toLowerCase().trim();

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  if (PROD) { console.error('[fatal] production 에서는 ADMIN_PASSWORD 환경변수가 필요합니다.'); process.exit(1); }
  ADMIN_PASSWORD = 'admin1234';
  console.warn('[warn] ADMIN_PASSWORD 미설정 → 개발용 비밀번호 admin1234 사용');
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('[warn] SESSION_SECRET 미설정 → 재시작 시 어드민 세션이 만료됩니다.');

// ───────────── 텔레그램 봇 (어드민 기능 + 알림) ─────────────
const bot = process.env.TELEGRAM_BOT_TOKEN
  ? createTelegramBot({ token: process.env.TELEGRAM_BOT_TOKEN, password: ADMIN_PASSWORD, apiBase: process.env.TELEGRAM_API_BASE, domain: DOMAIN, repoDir: __dirname })
  : null;
const kstNow = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback'); // Caddy/cloudflared 뒤에서 실제 IP 사용

app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' });
  next();
});

// ───────────── 호스트 → 내부 경로 매핑 ─────────────
// admin.도메인 → /admin/*  (로컬·도메인 미설정 시 /admin/ 경로로 접근)
app.use((req, res, next) => {
  if (!DOMAIN) return next();
  const host = (req.hostname || '').toLowerCase();
  if (host === 'admin.' + DOMAIN) {
    if (!req.url.startsWith('/api/') && !req.url.startsWith('/assets/') && req.path !== '/robots.txt') req.url = '/admin' + req.url;
  } else if (host === DOMAIN || host === 'www.' + DOMAIN) {
    if (req.path === '/admin' || req.path.startsWith('/admin/') || req.path.startsWith('/api/admin')) {
      return res.status(404).type('text').send('Not found'); // 어드민은 admin 서브도메인에서만
    }
  }
  next();
});

// 웹 어드민은 로컬(이 PC) 또는 admin 서브도메인(VPS) 에서만. Cloudflare 터널 경유 요청은 차단 → 원격 관리는 텔레그램 봇
app.use(['/admin', '/api/admin'], (req, res, next) => {
  if (req.get('cf-connecting-ip')) return res.status(404).type('text').send('Not found');
  next();
});

// ───────────── CORS: GitHub Pages(firstteacher.co.kr) → 공개 API (접속·이벤트·상담) 만 허용 ─────────────
const CORS_ORIGINS = new Set((process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean));
app.use(['/api/track', '/api/event', '/api/inquiry'], (req, res, next) => {
  const origin = req.get('origin');
  const ok = origin && CORS_ORIGINS.has(origin);
  if (ok) res.set({ 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' });
  if (req.method === 'OPTIONS') return res.sendStatus(ok ? 204 : 403);
  next();
});

app.use(express.json({ limit: '200kb' }));
app.use('/assets', express.static(path.join(__dirname, 'public/assets'), { maxAge: PROD ? '1h' : 0 }));

// ───────────── 유틸 ─────────────
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const SECURE = PROD ? '; Secure' : '';
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const isVid = (v) => /^[a-f0-9]{32}$/.test(v || '');

const buckets = new Map();
function rateLimit(name, max, windowMs) {
  return (req, res, next) => {
    const k = name + ':' + req.ip;
    const now = Date.now();
    let b = buckets.get(k);
    if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(k, b); }
    if (++b.n > max) return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60_000).unref();

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|curl|wget|python-requests|httpclient/i;
const isBot = (req) => BOT_RE.test(req.get('user-agent') || '');

function recordVisit(req, pathStr, referrer, vid) {
  const ua = clip(req.get('user-agent'), 400);
  try {
    insertVisit.run(SITE_KEY, clip(pathStr, 300), req.ip || '', ua, clip(referrer, 400), vid,
      /Mobi|Android|iPhone|iPad/i.test(ua) ? 1 : 0, BOT_RE.test(ua) ? 1 : 0);
    if (!BOT_RE.test(ua)) bot?.onVisit({ at: kstNow(), path: clip(pathStr, 300), mobile: /Mobi|Android|iPhone|iPad/i.test(ua), referrer: clip(referrer, 200) });
  } catch (e) { console.error('visit log failed', e); }
}

// ───────────── 공개: 사이트 ─────────────
const canonical = DOMAIN ? `https://${DOMAIN}/` : undefined;
let seoCfg = {};
try { seoCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'pages.config.json'), 'utf8')); } catch { /* 없음 */ }
const siteVerification = seoCfg.verification || {};

// 검색엔진: robots.txt (어드민 호스트는 전체 차단) + sitemap.xml + HTML 소유확인 파일
app.get('/robots.txt', (req, res) => {
  const isAdminHost = DOMAIN && (req.hostname || '').toLowerCase() === 'admin.' + DOMAIN;
  res.type('text').send(isAdminHost ? 'User-agent: *\nDisallow: /\n' : renderRobots(canonical));
});
app.get('/sitemap.xml', (req, res) => {
  if (!canonical) return res.status(404).end();
  res.type('application/xml').send(renderSitemap(canonical, getSite().updatedAt.slice(0, 10)));
});
for (const [name, body] of Object.entries(seoCfg.verificationFiles || {})) {
  if (/^[\w.-]+\.(html|txt|xml)$/.test(name)) app.get('/' + name, (req, res) => res.type(name.split('.').pop()).send(body));
}
app.get('/', (req, res) => {
  const site = getSite();
  let vid = cookies(req).vid;
  if (!isVid(vid)) {
    vid = crypto.randomBytes(16).toString('hex');
    res.append('Set-Cookie', `vid=${vid}; Max-Age=31536000; HttpOnly; Path=/; SameSite=Lax${SECURE}`);
  }
  recordVisit(req, req.originalUrl, req.get('referer'), vid);
  res.set('Cache-Control', 'no-store');
  if (site.status === 'maintenance') return res.status(503).type('html').send(renderMaintenance(site));
  res.type('html').send(renderSite(site, { canonical, verify: siteVerification }));
});
// 기존 과목별 주소 → 통합 페이지 해당 과목
for (const s of SUBJECTS) app.get([`/${s}`, `/${s}/`], (req, res) => res.redirect(301, `/#subject-${s}`));

app.use('/admin', express.static(path.join(__dirname, 'public/admin'), { maxAge: 0 }));

// ───────────── 공개 API: 접속 기록 (정적 호스팅용 비콘) ─────────────
app.post('/api/track', rateLimit('track', 120, 60_000), (req, res) => {
  const b = req.body || {};
  const origin = req.get('origin') || '';
  recordVisit(req, (origin ? origin.replace(/^https?:\/\//, '') : '') + clip(b.path, 250), b.referrer, isVid(b.vid) ? b.vid : crypto.randomBytes(16).toString('hex'));
  res.status(204).end();
});

// ───────────── 공개 API: 과목 노출·클릭 이벤트 ─────────────
app.post('/api/event', rateLimit('event', 300, 60_000), (req, res) => {
  const b = req.body || {};
  if (!['view', 'click'].includes(b.kind)) return res.status(400).json({ error: 'bad kind' });
  const subject = SUBJECTS.includes(b.subject) ? b.subject : null;
  if (b.kind === 'view' && !subject) return res.status(400).json({ error: 'bad subject' });
  if (isBot(req)) return res.status(204).end();
  // 같은 origin(서버 모드)은 페이지 조회와 같은 쿠키 ID 사용, 외부(GitHub Pages)는 localStorage ID
  const ck = cookies(req).vid;
  const vid = isVid(ck) ? ck : isVid(b.vid) ? b.vid : '';
  insertEvent.run(b.kind, subject, clip(b.label, 60), clip(b.href, 200), vid, req.ip || '');
  if (b.kind === 'click') bot?.onClick({ at: kstNow(), subject, label: clip(b.label, 60) });
  res.status(204).end();
});

// ───────────── 공개 API: 상담 신청 (같은 origin + CORS 허용 origin) ─────────────
app.post('/api/inquiry', rateLimit('inq', 5, 10 * 60_000), (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot
  if (getSite().status !== 'live') return res.status(400).json({ error: '현재 상담 접수가 중단되었습니다.' });
  const name = clip(b.name, 40);
  const phone = clip(b.phone, 20);
  if (!name) return res.status(400).json({ error: '이름을 입력해 주세요.' });
  if (!/^[0-9+\-() ]{8,20}$/.test(phone)) return res.status(400).json({ error: '연락처를 정확히 입력해 주세요.' });
  if (!b.agree) return res.status(400).json({ error: '개인정보 수집·이용에 동의해 주세요.' });
  const mode = ['방문수업', '화상수업'].includes(b.mode) ? b.mode : '';
  const r = insertInquiry.run(SITE_KEY, name, phone, clip(b.grade, 20), clip(b.subject, 80), clip(b.message, 1000), clip(b.school, 60), clip(b.address, 200), mode, req.ip || '');
  bot?.onInquiry(getInquiry(Number(r.lastInsertRowid)));
  res.json({ ok: true });
});

// ───────────── 어드민 인증 ─────────────
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
}
function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const SESSION_HOURS = 12;

app.post('/api/admin/login', rateLimit('login', 8, 15 * 60_000), (req, res) => {
  if (!crypto.timingSafeEqual(sha(req.body?.password ?? ''), sha(ADMIN_PASSWORD))) return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  const token = sign({ sub: 'admin', exp: Date.now() + SESSION_HOURS * 3600_000 });
  res.append('Set-Cookie', `adm=${token}; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; Path=/; SameSite=Strict${SECURE}`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  res.append('Set-Cookie', `adm=; Max-Age=0; HttpOnly; Path=/; SameSite=Strict${SECURE}`);
  res.json({ ok: true });
});

const admin = express.Router();
admin.use((req, res, next) => {
  if (!verify(cookies(req).adm)) return res.status(401).json({ error: '로그인이 필요합니다.' });
  // CSRF: 본문 있는 변경 요청은 JSON 만 (SameSite=Strict 와 병행). DELETE 는 폼으로 교차 전송 불가.
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ error: 'JSON 요청만 허용됩니다.' });
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api/admin', admin);

admin.get('/me', (req, res) => res.json({ ok: true, domain: DOMAIN, siteUrl: DOMAIN ? `https://${DOMAIN}/` : '/', subjects: SUBJECTS, subjectNames: SUBJECT_NAME }));

// ── 기간 통계 / 누적 과목 순위 (src/stats.js 공용)
admin.get('/stats', (req, res) => res.json(getStats(req.query.days, { bots: req.query.bots === '1', domain: DOMAIN })));
admin.get('/ranking', (req, res) => res.json(getRanking()));

// ── 접속 기록 (페이지 조회)
admin.get('/visits', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const where = []; const args = [];
  if (req.query.bots !== '1') where.push('bot = 0');
  if (req.query.q) { where.push('(ip LIKE ? OR ua LIKE ? OR referrer LIKE ? OR path LIKE ?)'); const q = `%${clip(req.query.q, 60)}%`; args.push(q, q, q, q); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM visits ${w}`).get(...args).n;
  const rows = db.prepare(`SELECT * FROM visits ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  // 각 방문자가 본·클릭한 과목 요약 (해당 방문 이후 30분 이내 이벤트)
  const evStmt = db.prepare(`SELECT kind, subject FROM events WHERE visitor = ? AND subject IS NOT NULL
    AND created_at BETWEEN ? AND datetime(?, '+30 minutes')`);
  for (const r of rows) {
    const ev = r.visitor ? evStmt.all(r.visitor, r.created_at, r.created_at) : [];
    r.viewed = [...new Set(ev.filter((e) => e.kind === 'view').map((e) => e.subject))];
    r.clicked = [...new Set(ev.filter((e) => e.kind === 'click').map((e) => e.subject))];
  }
  res.json({ total, rows });
});

// ── 클릭 기록
admin.get('/events', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const where = ["kind = 'click'"]; const args = [];
  if (SUBJECTS.includes(req.query.subject)) { where.push('subject = ?'); args.push(req.query.subject); }
  const w = 'WHERE ' + where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) n FROM events ${w}`).get(...args).n;
  const rows = db.prepare(`SELECT * FROM events ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  res.json({ total, rows });
});

admin.post('/visits/purge', (req, res) => res.json({ ok: true, deleted: purgeOlderThan(req.body?.olderThanDays) }));

// ── 상담 신청
admin.get('/inquiries', (req, res) => {
  const where = []; const args = [];
  if (INQ_STATUS.includes(req.query.status)) { where.push('status = ?'); args.push(req.query.status); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  res.json({ rows: db.prepare(`SELECT * FROM inquiries ${w} ORDER BY id DESC LIMIT 500`).all(...args) });
});
admin.patch('/inquiries/:id', (req, res) => {
  const { status, memo } = req.body || {};
  if (status !== undefined && !INQ_STATUS.includes(status)) return res.status(400).json({ error: '잘못된 상태값' });
  const cur = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '없는 항목' });
  db.prepare('UPDATE inquiries SET status = ?, memo = ? WHERE id = ?')
    .run(status ?? cur.status, memo !== undefined ? clip(memo, 1000) : cur.memo, req.params.id);
  res.json({ ok: true });
});
admin.delete('/inquiries/:id', (req, res) => {
  db.prepare('DELETE FROM inquiries WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── 사이트 관리
admin.get('/site', (req, res) => res.json({
  site: getSite(),
  fields: { text: TEXT_FIELDS, lists: LIST_FIELDS, subjectFields: [...SUBJECT_FIELDS], statuses: STATUSES, subjects: SUBJECTS, subjectNames: SUBJECT_NAME }
}));

admin.put('/site', (req, res) => {
  const cur = getSite();
  const b = req.body || {};
  const status = STATUSES.includes(b.status) ? b.status : cur.status;
  const data = {};
  for (const [f, max] of Object.entries(TEXT_FIELDS)) data[f] = clip(b[f] ?? cur[f], max);
  if (data.color && !/^#[0-9a-fA-F]{6}$/.test(data.color)) return res.status(400).json({ error: '색상은 #RRGGBB 형식이어야 합니다.' });
  if (data.kakao && !/^https?:\/\//.test(data.kakao)) return res.status(400).json({ error: '카카오톡 링크는 http(s):// 로 시작해야 합니다.' });
  if (!data.name) return res.status(400).json({ error: '사이트 이름은 필수입니다.' });
  for (const [list, keys] of Object.entries(LIST_FIELDS)) {
    const src = Array.isArray(b[list]) ? b[list] : cur[list] || [];
    data[list] = src.slice(0, 30).map((item) => Object.fromEntries(keys.map((k) => [k, clip(item?.[k], 400)])))
      .filter((item) => keys.some((k) => !SUBJECT_FIELDS.has(k) && item[k]));
    for (const item of data[list]) {
      for (const k of keys) if (SUBJECT_FIELDS.has(k) && !SUBJECTS.includes(item[k])) return res.status(400).json({ error: `${list}: 과목은 ${SUBJECTS.join('/')} 중 하나여야 합니다.` });
    }
  }
  const keys = data.subjects.map((s) => s.key);
  if (new Set(keys).size !== keys.length) return res.status(400).json({ error: '같은 과목이 중복되었습니다.' });
  saveSite(data, status);
  res.json({ ok: true, site: getSite() });
});

// ───────────── 404 / 에러 ─────────────
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((req, res) => res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>404</title><p style="font-family:sans-serif;padding:40px">페이지를 찾을 수 없습니다. <a href="/">처음으로</a></p>'));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '잘못된 JSON' });
  console.error(err);
  res.status(500).json({ error: '서버 오류' });
});

const server = app.listen(PORT, () => {
  bot?.start();
  console.log(`▶ http://localhost:${PORT}  (도메인: ${DOMAIN || '미설정 – 경로 모드'})`);
  console.log(DOMAIN ? `  사이트: https://${DOMAIN}/   어드민: https://admin.${DOMAIN}/` : '  사이트: /   어드민: /admin/');
});

const shutdown = () => { bot?.stop(); server.close(); setTimeout(() => process.exit(0), 300); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
