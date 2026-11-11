// NEIS 학교기본정보·학과정보 전체를 받아 src/schools.json 으로 저장 (필요할 때 수동 실행, 결과 파일을 커밋)
//   node --env-file=.env scripts/fetch-schools.js
// 형식: [학교명, 학교급, 시·도, 시·군·구, 학교코드, 설립구분, 남녀공학, 고교구분, 일반/전문계, 특목계열, 설립일, 관할교육지원청, 주소, 홈페이지, 주야, [학과...]]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = process.env.NEIS_API_KEY;
if (!KEY) { console.error('.env 에 NEIS_API_KEY 가 없습니다.'); process.exit(1); }
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/schools.json');
const SIZE = 1000;

async function page(service, pIndex, extra = {}) {
  const url = `https://open.neis.go.kr/hub/${service}?` + new URLSearchParams({ KEY, Type: 'json', pIndex: String(pIndex), pSize: String(SIZE), ...extra });
  for (let attempt = 1; ; attempt++) {
    try {
      const j = await (await fetch(url)).json();
      if (j.RESULT?.CODE === 'INFO-200') return { total: 0, rows: [] };
      if (!j[service]) throw new Error(`NEIS 응답 오류: ${j.RESULT?.CODE} ${j.RESULT?.MESSAGE}`);
      return { total: j[service][0].head[0].list_total_count, rows: j[service][1].row };
    } catch (e) {
      if (attempt >= 3) throw new Error(`${service} ${pIndex}쪽 실패: ${e.message}`); // 키가 든 URL 은 출력하지 않음
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}
async function all(service, extra) {
  const rows = [];
  let total = 0;
  for (let i = 1; ; i++) {
    const p = await page(service, i, extra);
    total = p.total;
    rows.push(...p.rows);
    if (p.rows.length < SIZE || rows.length >= total) break;
  }
  if (rows.length !== total) throw new Error(`${service}: 받은 수(${rows.length})가 전체(${total})와 다릅니다.`);
  return rows;
}

const schools = await all('schoolInfo');
const majors = new Map();
// 학과정보는 시·도교육청 코드가 필수
for (const office of new Set(schools.map((r) => r.ATPT_OFCDC_SC_CODE))) {
  for (const m of await all('schoolMajorinfo', { ATPT_OFCDC_SC_CODE: office })) {
    const name = (m.DDDEP_NM || '').trim();
    if (!name) continue;
    const key = office + m.SD_SCHUL_CODE;
    if (!majors.has(key)) majors.set(key, new Set());
    majors.get(key).add(name);
  }
}

const city = (addr) => {
  const t = String(addr || '').trim().split(/\s+/)[1] || '';
  return /[시군구]$/.test(t) ? t : '기타';
};
const clean = (v) => { const s = String(v ?? '').trim(); return !s || s === '해당없음' ? '' : s; };
const list = schools.map((r) => [
  r.SCHUL_NM.trim(), r.SCHUL_KND_SC_NM || '기타', r.LCTN_SC_NM || '기타', city(r.ORG_RDNMA), r.SD_SCHUL_CODE,
  clean(r.FOND_SC_NM), clean(r.COEDU_SC_NM), clean(r.HS_SC_NM), clean(r.HS_GNRL_BUSNS_SC_NM), clean(r.SPCLY_PURPS_HS_ORD_NM),
  clean(r.FOND_YMD), clean(r.JU_ORG_NM), clean(r.ORG_RDNMA), /^https?:\/\/[^\s]+$/i.test(clean(r.HMPG_ADRES)) ? clean(r.HMPG_ADRES) : '', clean(r.DGHT_SC_NM),
  [...(majors.get(r.ATPT_OFCDC_SC_CODE + r.SD_SCHUL_CODE) || [])]
]).sort((a, b) => a[2].localeCompare(b[2], 'ko') || a[3].localeCompare(b[3], 'ko') || a[0].localeCompare(b[0], 'ko'));

// 페이지 주소용 코드: 시·군·구 안에서 고유하게 (개교 예정 학교는 코드가 비어 있고, 같은 코드를 쓰는 과정도 있음)
const used = new Map();
for (const x of list) {
  const base = x[4].trim() || 'new';
  const k = x[2] + '/' + x[3] + '/' + base;
  const n = (used.get(k) || 0) + 1;
  used.set(k, n);
  x[4] = n === 1 ? base : `${base}-${n}`;
}
fs.writeFileSync(out, '[\n' + list.map((x) => JSON.stringify(x)).join(',\n') + '\n]\n');

const count = (i) => Object.entries(list.reduce((m, x) => ((m[x[i]] = (m[x[i]] || 0) + 1), m), {})).map(([k, v]) => `${k || '(없음)'} ${v}`).join(', ');
console.log(`저장 ${list.length}곳 → src/schools.json (${fs.statSync(out).size} bytes), 학과 정보 있는 학교 ${list.filter((x) => x[15].length).length}곳`);
for (const [i, n] of [[5, '설립'], [6, '공학'], [7, '고교구분'], [8, '일반전문'], [9, '특목계열'], [14, '주야']]) console.log(`${n}:`, count(i));
console.log('홈페이지 있음', list.filter((x) => x[13]).length, '설립일 있음', list.filter((x) => /^\d{8}$/.test(x[10])).length);
