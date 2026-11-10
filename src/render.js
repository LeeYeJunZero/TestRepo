const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const br = (v) => esc(v).replace(/\n/g, '<br>');

const FONT = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">';

function head(site, title, A = '/assets') {
  const color = /^#[0-9a-fA-F]{6}$/.test(site.color || '') ? site.color : '';
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(site.heroSub)}">
<meta property="og:title" content="${esc(site.name)}">
<meta property="og:description" content="${esc(site.tagline)}">
<meta name="theme-color" content="${esc(color || '#ffffff')}">
${FONT}
<link rel="stylesheet" href="${A}/css/base.css">
<link rel="stylesheet" href="${A}/css/${esc(site.theme)}.css">
${color ? `<style>:root{--primary:${color}}</style>` : ''}
</head>`;
}

const GRADES = ['초등학생', '중학생', '고등학생', '대학생·성인', '기타'];

// opts.assetBase: 정적 파일 경로 (서버: /assets, GitHub Pages: ../assets)
// opts.apiBase  : 상담/방문기록 API 서버 (서버 모드는 같은 origin → '')
// opts.track    : 브라우저에서 방문 비콘 전송 여부 (서버 모드는 서버에서 직접 기록하므로 false)
export function renderSite(site, opts = {}) {
  const A = opts.assetBase ?? '/assets';
  const api = opts.apiBase ?? '';
  const track = opts.track ? '1' : '0';
  const f = site.features || [];
  const c = site.courses || [];
  const t = site.tutors || [];
  const q = site.faqs || [];

  return `${head(site, `${site.name} | ${site.tagline}`, A)}
<body class="theme-${esc(site.theme)}" data-site="${esc(site.key)}" data-api="${esc(api)}" data-track="${track}" data-static="${opts.static ? '1' : '0'}">
${site.notice ? `<div class="notice" role="status"><div class="wrap">${esc(site.notice)}</div></div>` : ''}
<header class="nav">
  <div class="wrap nav-inner">
    <a class="brand" href="./"><span class="brand-mark">${esc(site.heroSymbol)}</span><span>${esc(site.name)}</span></a>
    <button class="nav-toggle" type="button" aria-label="메뉴 열기" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
    <nav class="nav-links" aria-label="주요 메뉴">
      <a href="#features">특징</a>
      <a href="#courses">수업 과정</a>
      <a href="#tutors">선생님</a>
      <a href="#faq">FAQ</a>
      <a class="btn btn-primary" href="#apply">상담 신청</a>
    </nav>
  </div>
</header>

<main>
  <section class="hero">
    <div class="wrap hero-inner">
      <div class="hero-text">
        <span class="eyebrow">${esc(site.tagline)}</span>
        <h1>${br(site.heroTitle)}</h1>
        <p class="lead">${esc(site.heroSub)}</p>
        <div class="hero-actions">
          <a class="btn btn-primary btn-lg" href="#apply">무료 상담 신청</a>
          <a class="btn btn-ghost btn-lg" href="#courses">수업 과정 보기</a>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="art-shape s1"></div><div class="art-shape s2"></div><div class="art-shape s3"></div>
        <div class="art-symbol">${esc(site.heroSymbol)}</div>
      </div>
    </div>
  </section>

  ${f.length ? `<section id="features" class="section">
    <div class="wrap">
      <h2 class="section-title">왜 ${esc(site.name)}인가요?</h2>
      <div class="grid grid-4">
        ${f.map((x) => `<article class="card feature">
          <div class="feature-icon">${esc(x.icon)}</div>
          <h3>${esc(x.title)}</h3>
          <p>${esc(x.desc)}</p>
        </article>`).join('')}
      </div>
    </div>
  </section>` : ''}

  ${c.length ? `<section id="courses" class="section section-alt">
    <div class="wrap">
      <h2 class="section-title">수업 과정</h2>
      <div class="grid grid-3">
        ${c.map((x) => `<article class="card course">
          <span class="chip">${esc(x.target)}</span>
          <h3>${esc(x.name)}</h3>
          <p>${esc(x.desc)}</p>
          <div class="price">${esc(x.price)}</div>
          <a class="btn btn-outline" href="#apply" data-subject="${esc(x.name)}">이 과정 상담하기</a>
        </article>`).join('')}
      </div>
    </div>
  </section>` : ''}

  ${t.length ? `<section id="tutors" class="section">
    <div class="wrap">
      <h2 class="section-title">선생님 소개</h2>
      <div class="grid grid-2">
        ${t.map((x) => `<article class="card tutor">
          <div class="avatar">${esc((x.name || '?').trim().charAt(0))}</div>
          <div>
            <h3>${esc(x.name)} <small>${esc(x.role)}</small></h3>
            <p>${esc(x.bio)}</p>
          </div>
        </article>`).join('')}
      </div>
    </div>
  </section>` : ''}

  ${q.length ? `<section id="faq" class="section section-alt">
    <div class="wrap narrow">
      <h2 class="section-title">자주 묻는 질문</h2>
      <div class="faq-list">
        ${q.map((x) => `<details class="card faq"><summary>${esc(x.q)}</summary><p>${esc(x.a)}</p></details>`).join('')}
      </div>
    </div>
  </section>` : ''}

  <section id="apply" class="section">
    <div class="wrap apply">
      <div class="apply-info">
        <h2 class="section-title left">무료 상담 신청</h2>
        <p>남겨주신 연락처로 24시간 이내에 연락드립니다.</p>
        <ul class="contact-list">
          ${site.phone ? `<li><b>전화</b><a href="tel:${esc(site.phone.replace(/[^0-9+]/g, ''))}">${esc(site.phone)}</a></li>` : ''}
          ${site.email ? `<li><b>이메일</b><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></li>` : ''}
          ${site.kakao && /^https?:\/\//.test(site.kakao) ? `<li><b>카카오톡</b><a href="${esc(site.kakao)}" target="_blank" rel="noopener">오픈채팅 상담</a></li>` : ''}
          ${site.area ? `<li><b>수업 지역</b><span>${esc(site.area)}</span></li>` : ''}
          ${site.hours ? `<li><b>상담 시간</b><span>${esc(site.hours)}</span></li>` : ''}
        </ul>
      </div>
      <form class="card apply-form" id="applyForm" novalidate>
        <input type="hidden" name="site" value="${esc(site.key)}">
        <div class="hp" aria-hidden="true"><label>웹사이트<input name="website" tabindex="-1" autocomplete="off"></label></div>
        <div class="field"><label for="f-name">이름 (학생 또는 학부모)</label><input id="f-name" name="name" required maxlength="40" autocomplete="name"></div>
        <div class="field"><label for="f-phone">연락처</label><input id="f-phone" name="phone" required maxlength="20" inputmode="tel" placeholder="010-1234-5678" autocomplete="tel"></div>
        <div class="field-row">
          <div class="field"><label for="f-grade">학년</label>
            <select id="f-grade" name="grade">${GRADES.map((g) => `<option>${g}</option>`).join('')}</select></div>
          <div class="field"><label for="f-subject">희망 과정</label>
            <select id="f-subject" name="subject"><option value="">선택 안 함</option>${c.map((x) => `<option>${esc(x.name)}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label for="f-msg">문의 내용</label><textarea id="f-msg" name="message" rows="4" maxlength="1000" placeholder="현재 성적, 희망 수업 요일 등을 적어주세요."></textarea></div>
        <label class="agree"><input type="checkbox" name="agree" required> 상담을 위한 개인정보(이름·연락처) 수집·이용에 동의합니다.</label>
        <button class="btn btn-primary btn-lg btn-block" type="submit">상담 신청하기</button>
        <p class="form-msg" role="alert" aria-live="polite"></p>
      </form>
    </div>
  </section>
</main>

<footer class="footer">
  <div class="wrap">
    <strong>${esc(site.name)}</strong>
    <span>${esc(site.tagline)}</span>
    <span>${[site.phone, site.email].filter(Boolean).map(esc).join(' · ')}</span>
    <small>© ${new Date().getFullYear()} ${esc(site.name)}. All rights reserved.</small>
  </div>
</footer>

<a class="fab" href="#apply" aria-label="상담 신청">상담</a>
<div class="toast" role="status" aria-live="polite"></div>
<script src="${A}/js/site.js" defer></script>
</body>
</html>`;
}

export function renderMaintenance(site, opts = {}) {
  return `${head(site, `${site.name} | 점검 중`, opts.assetBase ?? '/assets')}
<body class="theme-${esc(site.theme)} maintenance">
  <main class="maint card">
    <div class="brand-mark big">${esc(site.heroSymbol)}</div>
    <h1>${esc(site.name)}</h1>
    <p>더 나은 서비스를 위해 사이트를 점검하고 있습니다.<br>잠시 후 다시 방문해 주세요.</p>
    ${site.phone ? `<p>상담 문의: <a href="tel:${esc(site.phone.replace(/[^0-9+]/g, ''))}">${esc(site.phone)}</a></p>` : ''}
  </main>
</body>
</html>`;
}

export function renderPortal(sites, linkFor, A = '/assets') {
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>과외 사이트 모음</title>
${FONT}
<link rel="stylesheet" href="${A}/css/portal.css">
</head><body>
<main class="portal">
  <h1>1:1 과외 안내</h1>
  <p>원하시는 과목을 선택하세요.</p>
  <div class="portal-grid">
    ${sites.map((s) => `<a class="portal-card ${esc(s.theme)}" href="${esc(linkFor(s.key))}" style="--c:${esc(s.color)}">
      <span class="sym">${esc(s.heroSymbol)}</span>
      <strong>${esc(s.name)}</strong>
      <span>${esc(s.tagline)}</span>
    </a>`).join('')}
  </div>
</main>
</body></html>`;
}
