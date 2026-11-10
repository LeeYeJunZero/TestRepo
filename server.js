import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getSite, listSites, saveSite, insertVisit, insertClick, insertInquiry } from './src/db.js';
import { renderSite, renderMaintenance, renderPortal } from './src/render.js';
import { SITE_KEYS, TEXT_FIELDS, LIST_FIELDS, STATUSES } from './src/defaults.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === 'production';
const DOMAIN = (process.env.SITE_DOMAIN || '').toLowerCase().trim();

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  if (PROD) { console.error('[fatal] production 에서는 ADMIN_PASSWORD 환경변수가 필요합니다.'); process.exit(1); }
  ADMIN_PASSWORD = 'admin1234';
  console.warn('[warn] ADMIN_PASSWORD 미설정 → 개발용 비밀번호 admin1234 사용');
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('[warn] SESSION_SECRET 미설정 → 재시작 시 어드민 세션이 만료됩니다.');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback'); // Caddy/Nginx 뒤에서 실제 IP 사용

// ───────────── 공통 헤더 ─────────────
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN'
  });
  next();
});

// ───────────── 서브도메인 → 내부 경로 매핑 ─────────────
// admin.도메인 → /admin/*, math.도메인 → /math/* ... (로컬에서는 /math/ 처럼 경로로 접근)
const SUBS = new Set([...SITE_KEYS, 'admin']);
app.use((req, res, next) => {
  if (!DOMAIN) return next();
  const host = (req.hostname || '').toLowerCase();
  if (!host.endsWith('.' + DOMAIN)) return next();
  const sub = host.slice(0, -(DOMAIN.length + 1));
  if (SUBS.has(sub) && !req.url.startsWith('/api/') && !req.url.startsWith('/assets/')) {
    req.url = '/' + sub + req.url;
  }
  next();
});

// ───────────── CORS: GitHub Pages 등 외부 정적 사이트 → 방문 비콘만 허용 ─────────────
const CORS_ORIGINS = new Set((process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean));
app.use(['/api/track', '/api/click'], (req, res, next) => {
  const origin = req.get('origin');
  if (origin && CORS_ORIGINS.has(origin)) {
    res.set({ 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' });
  }
  if (req.method === 'OPTIONS') return res.sendStatus(origin && CORS_ORIGINS.has(origin) ? 204 : 403);
  next();
});

app.use(express.json({ limit: '200kb' }));
app.use('/assets', express.static(path.join(__dirname, 'public/assets'), { maxAge: PROD ? '1d' : 0 }));

// ───────────── 유틸 ─────────────
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const cookieFlags = `Path=/; SameSite=Lax${PROD ? '; Secure' : ''}`;
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);

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
function recordVisit(req, site, pathStr, referrer, vid) {
  const ua = clip(req.get('user-agent'), 400);
  try {
    insertVisit.run(site, clip(pathStr, 300), req.ip || '', ua, clip(referrer, 400), vid,
      /Mobi|Android|iPhone|iPad/i.test(ua) ? 1 : 0, BOT_RE.test(ua) ? 1 : 0);
  } catch (e) { console.error('visit log failed', e); }
}
function logVisit(req, res, site) {
  let vid = cookies(req).vid;
  if (!/^[a-f0-9]{32}$/.test(vid || '')) {
    vid = crypto.randomBytes(16).toString('hex');
    res.append('Set-Cookie', `vid=${vid}; Max-Age=31536000; HttpOnly; ${cookieFlags}`);
  }
  recordVisit(req, site, req.originalUrl, req.get('referer'), vid);
}

const siteLink = (key) => (DOMAIN ? `https://${key}.${DOMAIN}/` : `/${key}/`);

// ───────────── 공개: 포털 & 하위 사이트 ─────────────
app.get('/', (req, res) => {
  const sites = listSites().filter((s) => s.status !== 'hidden');
  res.type('html').send(renderPortal(sites, siteLink));
});

// 어드민 정적 파일 (/admin/ → index.html)
app.use('/admin', express.static(path.join(__dirname, 'public/admin'), { maxAge: 0 }));

app.get('/:key', (req, res, next) => {
  const key = req.params.key;
  if (!SITE_KEYS.includes(key)) return next();
  if (!req.path.endsWith('/')) return res.redirect(301, `/${key}/`);
  const site = getSite(key);
  if (!site || site.status === 'hidden') return next();
  logVisit(req, res, key);
  res.set('Cache-Control', 'no-store');
  if (site.status === 'maintenance') return res.status(503).type('html').send(renderMaintenance(site));
  res.type('html').send(renderSite(site));
});

// ───────────── 공개 API: 방문 비콘 (정적 호스팅용) ─────────────
app.post('/api/track', rateLimit('track', 120, 60_000), (req, res) => {
  const b = req.body || {};
  if (!SITE_KEYS.includes(b.site)) return res.status(400).json({ error: 'bad site' });
  const vid = /^[a-f0-9]{32}$/.test(b.vid || '') ? b.vid : crypto.randomBytes(16).toString('hex');
  const origin = req.get('origin') || '';
  recordVisit(req, b.site, (origin ? origin.replace(/^https?:\/\//, '') : '') + clip(b.path, 250), b.referrer, vid);
  res.status(204).end();
});

// ───────────── 공개 API: 클릭 이벤트 (서버 모드·정적 모드 공통) ─────────────
app.post('/api/click', rateLimit('click', 300, 60_000), (req, res) => {
  const b = req.body || {};
  if (!SITE_KEYS.includes(b.site)) return res.status(400).json({ error: 'bad site' });
  if (BOT_RE.test(req.get('user-agent') || '')) return res.status(204).end();
  const vid = /^[a-f0-9]{32}$/.test(b.vid || '') ? b.vid : (cookies(req).vid || '');
  insertClick.run(b.site, clip(b.label, 60), clip(b.href, 200), vid, req.ip || '');
  res.status(204).end();
});

// ───────────── 공개 API: 상담 신청 ─────────────
app.post('/api/inquiry', rateLimit('inq', 5, 10 * 60_000), (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot
  const site = String(b.site || '');
  const s = getSite(site);
  if (!s || s.status !== 'live') return res.status(400).json({ error: '잘못된 요청입니다.' });
  const name = clip(b.name, 40);
  const phone = clip(b.phone, 20);
  if (!name) return res.status(400).json({ error: '이름을 입력해 주세요.' });
  if (!/^[0-9+\-() ]{8,20}$/.test(phone)) return res.status(400).json({ error: '연락처를 정확히 입력해 주세요.' });
  if (!b.agree) return res.status(400).json({ error: '개인정보 수집·이용에 동의해 주세요.' });
  insertInquiry.run(site, name, phone, clip(b.grade, 20), clip(b.subject, 60), clip(b.message, 1000), req.ip || '');
  res.json({ ok: true });
});

// ───────────── 어드민 인증 ─────────────
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const SESSION_HOURS = 12;

app.post('/api/admin/login', rateLimit('login', 8, 15 * 60_000), (req, res) => {
  const ok = crypto.timingSafeEqual(sha(req.body?.password ?? ''), sha(ADMIN_PASSWORD));
  if (!ok) return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  const token = sign({ sub: 'admin', exp: Date.now() + SESSION_HOURS * 3600_000 });
  res.append('Set-Cookie', `adm=${token}; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; Path=/; SameSite=Strict${PROD ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  res.append('Set-Cookie', `adm=; Max-Age=0; HttpOnly; Path=/; SameSite=Strict${PROD ? '; Secure' : ''}`);
  res.json({ ok: true });
});

const admin = express.Router();
admin.use((req, res, next) => {
  if (!verify(cookies(req).adm)) return res.status(401).json({ error: '로그인이 필요합니다.' });
  // CSRF 방어: 본문이 있는 변경 요청은 JSON 만 허용 (SameSite=Strict 쿠키와 병행).
  // DELETE 는 HTML 폼으로 교차 사이트 전송이 불가능하므로 본문 없이 허용.
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ error: 'JSON 요청만 허용됩니다.' });
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api/admin', admin);

admin.get('/me', (req, res) => res.json({ ok: true, domain: DOMAIN, links: Object.fromEntries(SITE_KEYS.map((k) => [k, siteLink(k)])) }));

// ── 통계
admin.get('/stats', (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 90);
  const since = `datetime('now','+9 hours','-${days - 1} days','start of day')`;
  const today = `datetime('now','+9 hours','start of day')`;
  const bots = req.query.bots === '1' ? '' : 'AND bot = 0';

  const perSite = db.prepare(`
    SELECT site, COUNT(*) pv, COUNT(DISTINCT visitor) uv, SUM(mobile) mobile,
           SUM(created_at >= ${today}) today_pv
    FROM visits WHERE created_at >= ${since} ${bots} GROUP BY site`).all();
  const daily = db.prepare(`
    SELECT date(created_at) d, site, COUNT(*) pv FROM visits
    WHERE created_at >= ${since} ${bots} GROUP BY d, site ORDER BY d`).all();
  const referrers = db.prepare(`
    SELECT referrer, COUNT(*) n FROM visits
    WHERE created_at >= ${since} ${bots} AND referrer <> '' GROUP BY referrer ORDER BY n DESC LIMIT 200`).all();
  const hourly = db.prepare(`
    SELECT CAST(strftime('%H', created_at) AS INTEGER) h, COUNT(*) n FROM visits
    WHERE created_at >= ${since} ${bots} GROUP BY h`).all();
  const inq = db.prepare(`
    SELECT site, COUNT(*) total, SUM(status='new') pending FROM inquiries
    WHERE created_at >= ${since} GROUP BY site`).all();
  const pendingAll = db.prepare(`SELECT COUNT(*) n FROM inquiries WHERE status='new'`).get().n;

  // 리퍼러는 도메인 단위로 묶기 (자기 사이트 제외)
  const refMap = {};
  for (const r of referrers) {
    let h; try { h = new URL(r.referrer).hostname; } catch { h = r.referrer; }
    if (DOMAIN && (h === DOMAIN || h.endsWith('.' + DOMAIN))) continue;
    if (!DOMAIN && /^(localhost|127\.0\.0\.1)$/.test(h)) continue;
    refMap[h] = (refMap[h] || 0) + r.n;
  }
  const topReferrers = Object.entries(refMap).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([host, n]) => ({ host, n }));

  res.json({ days, sites: SITE_KEYS, perSite, daily, hourly, topReferrers, inquiries: inq, pendingAll });
});

// ── 접속 기록
admin.get('/visits', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const where = []; const args = [];
  if (SITE_KEYS.includes(req.query.site)) { where.push('site = ?'); args.push(req.query.site); }
  if (req.query.bots !== '1') where.push('bot = 0');
  if (req.query.q) { where.push('(ip LIKE ? OR ua LIKE ? OR referrer LIKE ?)'); const q = `%${clip(req.query.q, 60)}%`; args.push(q, q, q); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM visits ${w}`).get(...args).n;
  const rows = db.prepare(`SELECT * FROM visits ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  res.json({ total, rows });
});
admin.post('/visits/purge', (req, res) => {
  const days = Math.max(parseInt(req.body?.olderThanDays) || 0, 1);
  const cut = `datetime('now','+9 hours','-${days} days')`;
  const r = db.prepare(`DELETE FROM visits WHERE created_at < ${cut}`).run();
  db.prepare(`DELETE FROM clicks WHERE created_at < ${cut}`).run();
  res.json({ ok: true, deleted: Number(r.changes) });
});

// ── 누적 순위: 사이트별 조회수 · 방문자 · 클릭 수 · 클릭률(클릭 ÷ 조회수)
admin.get('/ranking', (req, res) => {
  const views = db.prepare(`SELECT site, COUNT(*) pv, COUNT(DISTINCT visitor) uv, MIN(created_at) first_at, MAX(created_at) last_at
    FROM visits WHERE bot = 0 GROUP BY site`).all();
  const clicks = db.prepare(`SELECT site, COUNT(*) clicks, COUNT(DISTINCT visitor) clickers FROM clicks GROUP BY site`).all();
  const labels = db.prepare(`SELECT site, label, COUNT(*) n FROM clicks GROUP BY site, label ORDER BY n DESC`).all();
  const rows = SITE_KEYS.map((site) => {
    const v = views.find((x) => x.site === site) || {};
    const c = clicks.find((x) => x.site === site) || {};
    const pv = v.pv || 0, cl = c.clicks || 0;
    return {
      site, pv, uv: v.uv || 0, clicks: cl, clickers: c.clickers || 0,
      ctr: pv ? Math.round((cl / pv) * 1000) / 10 : 0,
      firstAt: v.first_at || null, lastAt: v.last_at || null,
      topClicks: labels.filter((x) => x.site === site).slice(0, 5).map(({ label, n }) => ({ label, n }))
    };
  }).sort((a, b) => b.pv - a.pv || b.ctr - a.ctr);
  rows.forEach((r, i) => (r.rank = i + 1));
  const best = (k) => rows.reduce((a, b) => (b[k] > a[k] ? b : a), rows[0]);
  res.json({ rows, mostViewed: rows[0]?.pv ? rows[0].site : null, bestCtr: best('ctr')?.ctr ? best('ctr').site : null });
});

// ── 상담 신청
const INQ_STATUS = ['new', 'contacted', 'enrolled', 'closed'];
admin.get('/inquiries', (req, res) => {
  const where = []; const args = [];
  if (SITE_KEYS.includes(req.query.site)) { where.push('site = ?'); args.push(req.query.site); }
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
admin.get('/sites', (req, res) => res.json({ sites: listSites(), fields: { text: TEXT_FIELDS, lists: LIST_FIELDS, statuses: STATUSES } }));

admin.put('/sites/:key', (req, res) => {
  const key = req.params.key;
  const cur = getSite(key);
  if (!cur) return res.status(404).json({ error: '없는 사이트' });
  const b = req.body || {};
  const status = STATUSES.includes(b.status) ? b.status : cur.status;
  const data = {};
  for (const [f, max] of Object.entries(TEXT_FIELDS)) data[f] = clip(b[f] ?? cur[f], max);
  if (data.color && !/^#[0-9a-fA-F]{6}$/.test(data.color)) return res.status(400).json({ error: '색상은 #RRGGBB 형식이어야 합니다.' });
  if (data.kakao && !/^https?:\/\//.test(data.kakao)) return res.status(400).json({ error: '카카오톡 링크는 http(s):// 로 시작해야 합니다.' });
  if (!data.name) return res.status(400).json({ error: '사이트 이름은 필수입니다.' });
  for (const [list, keys] of Object.entries(LIST_FIELDS)) {
    const src = Array.isArray(b[list]) ? b[list] : cur[list] || [];
    data[list] = src.slice(0, 20).map((item) => Object.fromEntries(keys.map((k) => [k, clip(item?.[k], 400)])))
      .filter((item) => keys.some((k) => item[k]));
  }
  saveSite(key, data, status);
  res.json({ ok: true, site: getSite(key) });
});

// ───────────── 404 / 에러 ─────────────
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((req, res) => res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>404</title><p style="font-family:sans-serif;padding:40px">페이지를 찾을 수 없습니다.</p>'));
app.use((err, req, res, next) => {
  console.error(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '잘못된 JSON' });
  res.status(500).json({ error: '서버 오류' });
});

app.listen(PORT, () => {
  console.log(`▶ http://localhost:${PORT}  (도메인: ${DOMAIN || '미설정 – 경로 모드'})`);
  if (!DOMAIN) console.log(`  사이트: ${SITE_KEYS.map((k) => `/${k}/`).join(' ')}   어드민: /admin/`);
});
