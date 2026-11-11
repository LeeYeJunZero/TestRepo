// NEIS 학교기본정보 전체를 받아 src/schools.json 으로 저장 (필요할 때 수동 실행, 결과 파일을 커밋)
//   node --env-file=.env scripts/fetch-schools.js
// 형식: [학교명, 학교급, 시·도, 시·군·구]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = process.env.NEIS_API_KEY;
if (!KEY) { console.error('.env 에 NEIS_API_KEY 가 없습니다.'); process.exit(1); }
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/schools.json');
const SIZE = 1000;

async function page(pIndex) {
  const url = 'https://open.neis.go.kr/hub/schoolInfo?' + new URLSearchParams({ KEY, Type: 'json', pIndex: String(pIndex), pSize: String(SIZE) });
  for (let attempt = 1; ; attempt++) {
    try {
      const j = await (await fetch(url)).json();
      if (!j.schoolInfo) throw new Error(`NEIS 응답 오류: ${j.RESULT?.CODE} ${j.RESULT?.MESSAGE}`);
      return { total: j.schoolInfo[0].head[0].list_total_count, rows: j.schoolInfo[1].row };
    } catch (e) {
      if (attempt >= 3) throw new Error(`${pIndex}쪽 실패: ${e.message}`); // 키가 든 URL 은 출력하지 않음
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

const rows = [];
let total = 0;
for (let i = 1; ; i++) {
  const p = await page(i);
  total = p.total;
  rows.push(...p.rows);
  if (p.rows.length < SIZE || rows.length >= total) break;
}
if (rows.length !== total) { console.error(`받은 수(${rows.length})가 전체(${total})와 다릅니다. 저장하지 않습니다.`); process.exit(1); }

const city = (addr) => {
  const t = String(addr || '').trim().split(/\s+/)[1] || '';
  return /[시군구]$/.test(t) ? t : '기타';
};
const list = rows
  .map((r) => [r.SCHUL_NM.trim(), r.SCHUL_KND_SC_NM || '기타', r.LCTN_SC_NM || '기타', city(r.ORG_RDNMA)])
  .sort((a, b) => a[2].localeCompare(b[2], 'ko') || a[3].localeCompare(b[3], 'ko') || a[0].localeCompare(b[0], 'ko'));
fs.writeFileSync(out, '[\n' + list.map((x) => JSON.stringify(x)).join(',\n') + '\n]\n');

const count = (i) => Object.entries(list.reduce((m, x) => ((m[x[i]] = (m[x[i]] || 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(', ');
console.log(`저장 ${list.length}곳 → src/schools.json (${fs.statSync(out).size} bytes)`);
console.log('학교급:', count(1));
console.log('지역:', count(2));
