// 로컬 PC 서버를 Cloudflare 임시 터널로 공개하고, GitHub Pages 사이트가 접속 기록을 이 서버로 보내도록 설정합니다.
//   npm run tunnel            → 서버 + 터널 시작, pages.config.json 갱신 후 git push (Pages 자동 재배포)
//   npm run tunnel -- --no-push → push 생략 (주소만 확인)
// 종료: Ctrl+C (터널을 닫으면 GitHub Pages 의 접속 기록 수집도 멈춥니다)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CFG = path.join(root, 'pages.config.json');
const PORT = Number(process.env.PORT || 3000);
const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
const pagesOrigin = cfg.pagesOrigin;
const noPush = process.argv.includes('--no-push');

// 터널을 열면 어드민이 인터넷에 노출되므로 기본 비밀번호 금지
const pw = process.env.ADMIN_PASSWORD || '';
if (pw.length < 12 || pw === 'admin1234') {
  console.error('✖ .env 에 12자 이상의 ADMIN_PASSWORD 를 설정하세요 (터널 사용 시 어드민이 외부에 공개됩니다).');
  process.exit(1);
}
const exe = ['tools/cloudflared.exe', 'tools/cloudflared'].map((p) => path.join(root, p)).find(fs.existsSync) || 'cloudflared';

const children = [];
const shutdown = () => { for (const c of children) try { c.kill(); } catch {} process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

// 1) 서버
const server = spawn(process.execPath, ['server.js'], {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', CORS_ORIGINS: pagesOrigin, SITE_DOMAIN: '' }
});
children.push(server);
server.on('exit', (c) => { console.error(`서버 종료 (code ${c})`); shutdown(); });

// 2) 터널
const tunnel = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { cwd: root });
children.push(tunnel);
tunnel.on('exit', (c) => { console.error(`터널 종료 (code ${c})`); shutdown(); });

const url = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('터널 주소를 받지 못했습니다 (60초 초과)')), 60_000);
  const onData = (d) => {
    const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) { clearTimeout(t); resolve(m[0]); }
  };
  tunnel.stdout.on('data', onData); tunnel.stderr.on('data', onData);
}).catch((e) => { console.error('✖', e.message); shutdown(); });

// 3) 외부에서 접속 가능해질 때까지 대기
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(url + '/', { signal: AbortSignal.timeout(5000) })).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 1500));
}

console.log(`\n✔ 터널 주소 : ${url}`);
console.log(`  어드민     : ${url}/admin/   (로컬: http://localhost:${PORT}/admin/)`);
console.log(`  수집 대상  : ${pagesOrigin.split(',').join(' , ')}`);

// 4) pages.config.json 갱신 → push → GitHub Actions 가 Pages 재배포
if (cfg.apiBase !== url) {
  cfg.apiBase = url;
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
  if (noPush) {
    console.log('  --no-push: pages.config.json 만 갱신했습니다.');
  } else {
    try {
      const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'pipe' }).toString();
      git('add', 'pages.config.json');
      git('commit', '-m', `Pages 접속 기록 수집 주소 갱신: ${url}`, '--', 'pages.config.json');
      git('push', 'origin', 'HEAD');
      console.log('  ✔ pages.config.json push 완료 → 1~2분 후 GitHub Pages 에 반영됩니다.');
    } catch (e) {
      console.error('  ✖ git push 실패:', (e.stderr || e.message).toString().trim());
    }
  }
} else {
  console.log('  주소 변경 없음 (push 생략)');
}
console.log('\n종료하려면 Ctrl+C\n');
