# 과외 사이트 3종 + 어드민

| 사이트 | 디자인 | 로컬 경로 | 실서버 |
|---|---|---|---|
| 셈터 수학과외 | 플랫 | `/math/` | `https://math.도메인` |
| 링고브릿지 영어과외 | 머티리얼 | `/english/` | `https://english.도메인` |
| 코드멘토 코딩과외 | 플루언트 | `/coding/` | `https://coding.도메인` |
| 어드민 | – | `/admin/` | `https://admin.도메인` |
| 포털 | – | `/` | `https://도메인` |

기능·검증 기준은 [REQUIREMENTS.md](REQUIREMENTS.md) 참고.

## 로컬 실행

```bash
npm install
npm run dev          # http://localhost:3000  (어드민 비밀번호: admin1234)
npm test             # 요구사항 R-01 ~ R-12 자동 검증
```

설정은 `.env` (예시: [.env.example](.env.example)). SQLite 파일은 `data/app.db`.

## 구조

```
server.js              라우팅 · 접속 기록 · 공개/어드민 API
src/defaults.js        3개 사이트 초기 콘텐츠 (최초 실행 시 DB 시드)
src/db.js              SQLite 스키마 (sites / visits / inquiries)
src/render.js          사이트 HTML 렌더러 (서버 · 정적 빌드 공용)
public/assets/css      base + flat / material / fluent 테마
public/assets/js       site.js (메뉴, 리플, Reveal, 상담 폼, 방문 비콘)
public/admin           어드민 SPA
scripts/build-static.js  GitHub Pages 용 정적 빌드 → dist/
deploy/                Caddy, systemd, 서버 설치 스크립트
```

## 배포 1단계 — GitHub Pages

`main` 브랜치에 push 하면 [.github/workflows/pages.yml](.github/workflows/pages.yml) 이 `dist/` 를 빌드해 배포합니다.
`https://<계정>.github.io/<저장소>/` 에서 포털과 3개 사이트를 확인합니다.

- 저장소 Settings → Pages → Source: **GitHub Actions**
- 실서버(API)가 준비되면 Settings → Secrets and variables → Actions → **Variables** 에
  `STATIC_API_BASE=https://admin.도메인` 을 추가하고, 서버 `.env` 의 `CORS_ORIGINS=https://<계정>.github.io` 를 설정하면
  GitHub Pages 사이트의 접속 기록·클릭도 어드민에 쌓입니다. (상담 폼은 항상 미리보기 모드)
- 어드민 페이지는 서버·DB가 필요하므로 GitHub Pages 에는 배포되지 않습니다.

### 로컬 PC 로 GitHub Pages 접속 기록 보기 (터널)

GitHub Pages 는 정적 호스팅이라 접속 기록을 받을 서버가 없습니다. 로컬 PC 서버를 Cloudflare 임시 터널로 열어 수집합니다.

```bash
# 최초 1회: tools/cloudflared.exe 설치 (https://github.com/cloudflare/cloudflared/releases)
#           .env 에 12자 이상 ADMIN_PASSWORD 설정
npm run tunnel
```

1. 로컬 서버 + 터널 시작 → `https://xxxx.trycloudflare.com` 주소 발급
2. `pages.config.json` 의 `apiBase` 갱신 후 자동 push → 1~2분 뒤 Pages 재배포
3. GitHub Pages 방문·클릭이 로컬 어드민(`http://localhost:3000/admin/`)에 기록됨

- PC 가 켜져 있고 터널이 실행 중일 때만 수집됩니다.
- 임시 터널 주소는 실행할 때마다 바뀌므로, 재실행 시 자동으로 다시 push 됩니다.
- GitHub Pages 의 상담 폼은 항상 미리보기 모드입니다 (접속 기록·클릭만 수집).

## 배포 2단계 — 실서버 + 가비아 DNS

1. **서버 준비**: Ubuntu 22.04/24.04 VPS (가비아 클라우드, AWS Lightsail 등), 80·443 포트 개방, 공인 IP 확인
2. **가비아 DNS 설정**: [My가비아](https://my.gabia.com) → 서비스 관리 → 도메인 → **DNS 관리** → 레코드 수정

   | 타입 | 호스트 | 값 | TTL |
   |---|---|---|---|
   | A | `@` | 서버 공인 IP | 600 |
   | A | `www` | 서버 공인 IP | 600 |
   | A | `admin` | 서버 공인 IP | 600 |
   | A | `math` | 서버 공인 IP | 600 |
   | A | `english` | 서버 공인 IP | 600 |
   | A | `coding` | 서버 공인 IP | 600 |

   전파 확인: `nslookup math.도메인` 이 서버 IP 를 반환하면 다음 단계로.
3. **서버 설치** (DNS 전파 후 실행해야 HTTPS 인증서가 발급됩니다)
   ```bash
   curl -fsSLO https://raw.githubusercontent.com/<계정>/<저장소>/main/deploy/setup-ubuntu.sh
   sudo bash setup-ubuntu.sh 도메인.com https://github.com/<계정>/<저장소>.git
   ```
   출력되는 어드민 비밀번호를 보관하세요.
4. **검증**: REQUIREMENTS.md 의 M-05 ~ M-07 수행
5. **업데이트**: `sudo bash /opt/tutor-sites/deploy/update.sh`

## 운영 메모

- 백업: `data/app.db` (WAL 모드 — `sqlite3 app.db ".backup backup.db"` 권장)
- 접속 기록에는 IP 가 저장됩니다. 개인정보처리방침에 수집 항목·보관 기간을 명시하고, 어드민의 "30일 이전 기록 삭제"로 주기적으로 정리하세요.
- 초기 콘텐츠(선생님 소개, 수강료, 연락처 `010-0000-0000` 등)는 예시입니다. 공개 전 어드민 → 사이트 관리에서 실제 정보로 바꾸세요.
