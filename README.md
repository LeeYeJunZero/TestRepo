# 퍼스트티쳐 — 수학·영어·코딩 1:1 과외

| 구분 | 실서버 | GitHub Pages (검증용) | 로컬 |
|---|---|---|---|
| 사이트 | https://firstteacher.co.kr | https://leeyejunzero.github.io/TestRepo/ | http://localhost:3000/ |
| 어드민 | https://admin.firstteacher.co.kr | – (서버 필요) | http://localhost:3000/admin/ |

기능·지표 정의·검증 기준은 [REQUIREMENTS.md](REQUIREMENTS.md) 참고.

## 로컬 실행

```bash
npm install
npm run dev          # http://localhost:3000  (ADMIN_PASSWORD 미설정 시 admin1234)
npm test             # 요구사항 R-01 ~ R-14 자동 검증
```

설정은 `.env` (예시: [.env.example](.env.example)). SQLite 파일은 `data/app.db`.

## 구조

```
server.js                라우팅 · 접속/과목 이벤트 기록 · 공개/어드민 API
src/defaults.js          초기 콘텐츠 (과목·과정·선생님 등, 최초 실행 시 DB 시드)
src/db.js                SQLite 스키마 (sites / visits / events / inquiries)
src/render.js            페이지 렌더러 (서버 · 정적 빌드 공용)
public/assets            base.css + material.css, site.js (노출·클릭 추적, 상담 폼)
public/admin             어드민 SPA
scripts/build-static.js  GitHub Pages 정적 빌드 → dist/
scripts/tunnel.js        로컬 PC + Cloudflare 임시 터널 (Pages 접속 기록 수집)
deploy/                  Caddy, systemd, 서버 설치·업데이트 스크립트
```

## 배포 1단계 — GitHub Pages

`main` 에 push 하면 [.github/workflows/pages.yml](.github/workflows/pages.yml) 이 빌드·배포합니다.
상담 폼은 미리보기 모드이며, `npm run tunnel` 실행 중에는 접속 기록·과목 노출·클릭이 로컬 어드민에 쌓입니다.

```bash
npm run tunnel   # .env 에 12자 이상 ADMIN_PASSWORD 필요. Ctrl+C 로 종료
```

## firstteacher.co.kr 연결 — GitHub Pages (현재 방식, 서버 불필요)

1. **가비아 DNS**: My가비아 → 도메인 `firstteacher.co.kr` → **DNS 관리** → 기존 `@`·`www` 레코드(주차 페이지 등) 삭제 후 추가

   | 타입 | 호스트 | 값 | TTL |
   |---|---|---|---|
   | A | `@` | `185.199.108.153` | 600 |
   | A | `@` | `185.199.109.153` | 600 |
   | A | `@` | `185.199.110.153` | 600 |
   | A | `@` | `185.199.111.153` | 600 |
   | CNAME | `www` | `leeyejunzero.github.io.` | 600 |

   네임서버가 가비아 기본(`ns.gabia.co.kr` 등)이어야 위 레코드가 적용됩니다.
2. **GitHub**: 저장소 Settings → Pages → Custom domain 에 `firstteacher.co.kr` 입력 → Save → (DNS 확인 후) **Enforce HTTPS** 체크
3. 빌드 시 `dist/CNAME` 이 자동 생성되며 canonical 주소도 `https://firstteacher.co.kr/` 로 설정됩니다 ([pages.config.json](pages.config.json) 의 `customDomain`).

## 배포 2단계 — VPS + 가비아 DNS (firstteacher.co.kr)

> VPS 로 옮길 때는 위 GitHub Pages 레코드를 지우고 아래 A 레코드로 교체하세요.

1. **서버 준비**: Ubuntu 22.04/24.04 VPS, 인바운드 22·80·443 허용, 공인 IP 확인
2. **가비아 DNS**: [My가비아](https://my.gabia.com) → 서비스 관리 → 도메인 `firstteacher.co.kr` → **DNS 관리** → 레코드 수정

   | 타입 | 호스트 | 값 | TTL |
   |---|---|---|---|
   | A | `@` | 서버 공인 IP | 600 |
   | A | `www` | 서버 공인 IP | 600 |
   | A | `admin` | 서버 공인 IP | 600 |

   기존에 `@`·`www` 에 가비아 기본(주차) 레코드가 있으면 삭제 후 추가. 확인: `nslookup firstteacher.co.kr`
3. **서버 설치** (DNS 전파 후 — HTTPS 인증서 발급에 필요)
   ```bash
   curl -fsSLO https://raw.githubusercontent.com/LeeYeJunZero/TestRepo/main/deploy/setup-ubuntu.sh
   sudo bash setup-ubuntu.sh            # 기본값: firstteacher.co.kr, 이 저장소
   ```
   출력되는 어드민 비밀번호를 보관하세요 (`/opt/tutor-sites/.env`).
4. **검증**: REQUIREMENTS.md 의 M-05 ~ M-07
5. **업데이트**: `sudo bash /opt/tutor-sites/deploy/update.sh`

## 운영 메모

- 백업: `data/app.db` (`sqlite3 app.db ".backup backup.db"`)
- 접속 기록에 IP 가 저장됩니다. 개인정보처리방침에 수집 항목·보관 기간을 명시하고 주기적으로 정리하세요.
- 초기 콘텐츠(선생님, 수강료, 연락처 `010-0000-0000` 등)는 예시입니다. 공개 전 어드민 → 사이트 관리에서 실제 정보로 바꾸세요.
