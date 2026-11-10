// 통계·순위 조회 (웹 어드민 API 와 텔레그램 봇이 공용으로 사용)
import { db } from './db.js';
import { SUBJECTS } from './defaults.js';

const sinceExpr = (days) => `datetime('now','+9 hours','-${days - 1} days','start of day')`;
const TODAY = `datetime('now','+9 hours','start of day')`;
const ctr = (clicks, views) => (views ? Math.round((clicks / views) * 1000) / 10 : 0);

// 기간 통계 (페이지 조회 + 과목 노출·클릭)
export function getStats(daysIn, { bots = false, domain = '' } = {}) {
  const days = Math.min(Math.max(parseInt(daysIn) || 7, 1), 90);
  const since = sinceExpr(days);
  const botSql = bots ? '' : 'AND bot = 0';
  const totals = db.prepare(`SELECT COUNT(*) pv, COUNT(DISTINCT visitor) uv, SUM(mobile) mobile, SUM(created_at >= ${TODAY}) today_pv
    FROM visits WHERE created_at >= ${since} ${botSql}`).get();
  const dailyPv = db.prepare(`SELECT date(created_at) d, COUNT(*) n FROM visits WHERE created_at >= ${since} ${botSql} GROUP BY d`).all();
  const dailySubj = db.prepare(`SELECT date(created_at) d, subject, COUNT(*) n FROM events
    WHERE kind = 'view' AND created_at >= ${since} GROUP BY d, subject`).all();
  const hourly = db.prepare(`SELECT CAST(strftime('%H', created_at) AS INTEGER) h, COUNT(*) n FROM visits
    WHERE created_at >= ${since} ${botSql} GROUP BY h`).all();
  const subj = db.prepare(`SELECT subject, SUM(kind='view') views, SUM(kind='click') clicks FROM events
    WHERE created_at >= ${since} AND subject IS NOT NULL GROUP BY subject`).all();
  const referrers = db.prepare(`SELECT referrer, COUNT(*) n FROM visits
    WHERE created_at >= ${since} ${botSql} AND referrer <> '' GROUP BY referrer ORDER BY n DESC LIMIT 200`).all();
  const inqTotal = db.prepare(`SELECT COUNT(*) n FROM inquiries WHERE created_at >= ${since}`).get().n;
  const pendingAll = db.prepare(`SELECT COUNT(*) n FROM inquiries WHERE status='new'`).get().n;

  const refMap = {};
  for (const r of referrers) {
    let h; try { h = new URL(r.referrer).hostname; } catch { h = r.referrer; }
    if (domain && (h === domain || h.endsWith('.' + domain))) continue;
    if (/^(localhost|127\.0\.0\.1)$/.test(h) || h.endsWith('.github.io') || h.endsWith('.trycloudflare.com')) continue;
    refMap[h] = (refMap[h] || 0) + r.n;
  }
  const topReferrers = Object.entries(refMap).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([host, n]) => ({ host, n }));
  const subjects = SUBJECTS.map((s) => {
    const r = subj.find((x) => x.subject === s) || {};
    return { subject: s, views: r.views || 0, clicks: r.clicks || 0, ctr: ctr(r.clicks || 0, r.views || 0) };
  });
  return { days, totals, dailyPv, dailySubj, hourly, subjects, topReferrers, inqTotal, pendingAll };
}

// 누적 과목 순위 (전체 기간): 노출 · 클릭 · 클릭률(클릭 ÷ 노출) · 많이 클릭된 항목
export function getRanking() {
  const agg = db.prepare(`SELECT subject, SUM(kind='view') views, SUM(kind='click') clicks,
      COUNT(DISTINCT CASE WHEN kind='view' THEN visitor END) viewers, MAX(created_at) last_at
    FROM events WHERE subject IS NOT NULL GROUP BY subject`).all();
  const labels = db.prepare(`SELECT subject, label, COUNT(*) n FROM events WHERE kind='click' AND subject IS NOT NULL
    GROUP BY subject, label ORDER BY n DESC`).all();
  const page = db.prepare(`SELECT COUNT(*) pv, COUNT(DISTINCT visitor) uv FROM visits WHERE bot = 0`).get();
  const rows = SUBJECTS.map((s) => {
    const a = agg.find((x) => x.subject === s) || {};
    const views = a.views || 0, clicks = a.clicks || 0;
    return {
      subject: s, views, clicks, viewers: a.viewers || 0, lastAt: a.last_at || null, ctr: ctr(clicks, views),
      topClicks: labels.filter((x) => x.subject === s).slice(0, 5).map(({ label, n }) => ({ label, n }))
    };
  }).sort((a, b) => b.views - a.views || b.ctr - a.ctr);
  rows.forEach((r, i) => (r.rank = i + 1));
  const top = (k) => rows.reduce((a, b) => (b[k] > a[k] ? b : a), rows[0]);
  return {
    page, rows,
    mostViewed: rows[0].views ? rows[0].subject : null,
    mostClicked: top('clicks').clicks ? top('clicks').subject : null,
    bestCtr: top('ctr').ctr ? top('ctr').subject : null
  };
}

export const INQ_STATUS = ['new', 'contacted', 'enrolled', 'closed'];
export const INQ_LABEL = { new: '신규', contacted: '연락완료', enrolled: '등록', closed: '종료' };

export const recentVisits = (n) => db.prepare('SELECT * FROM visits WHERE bot = 0 ORDER BY id DESC LIMIT ?').all(n);
export const recentClicks = (n) => db.prepare("SELECT * FROM events WHERE kind = 'click' ORDER BY id DESC LIMIT ?").all(n);
export const getInquiry = (id) => db.prepare('SELECT * FROM inquiries WHERE id = ?').get(id);
export const listInquiries = (status, limit = 500) => (INQ_STATUS.includes(status)
  ? db.prepare('SELECT * FROM inquiries WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit)
  : db.prepare('SELECT * FROM inquiries ORDER BY id DESC LIMIT ?').all(limit));
export function setInquiry(id, { status, memo }) {
  const cur = getInquiry(id);
  if (!cur) return null;
  db.prepare('UPDATE inquiries SET status = ?, memo = ? WHERE id = ?').run(status ?? cur.status, memo ?? cur.memo, id);
  return getInquiry(id);
}
export const deleteInquiry = (id) => Number(db.prepare('DELETE FROM inquiries WHERE id = ?').run(id).changes);
export function purgeOlderThan(days) {
  const cut = `datetime('now','+9 hours','-${Math.max(parseInt(days) || 30, 1)} days')`;
  const r = db.prepare(`DELETE FROM visits WHERE created_at < ${cut}`).run();
  db.prepare(`DELETE FROM events WHERE created_at < ${cut}`).run();
  return Number(r.changes);
}
