import { SUBJECTS, SUBJECT_NAME } from './defaults.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const br = (v) => esc(v).replace(/\n/g, '<br>');
const tel = (p) => esc(String(p || '').replace(/[^0-9+]/g, ''));

const FONT = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">';

function head(site, title, A, canonical) {
  const color = /^#[0-9a-fA-F]{6}$/.test(site.color || '') ? site.color : '';
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(site.heroSub)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(site.name)} | ${esc(site.tagline)}">
<meta property="og:description" content="${esc(site.heroSub)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}"><meta property="og:url" content="${esc(canonical)}">` : ''}
<meta name="theme-color" content="${esc(color || '#6750a4')}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${color || '#6750a4'}"/><text x="32" y="44" font-size="34" font-family="Arial" font-weight="700" fill="#fff" text-anchor="middle">${esc(site.heroSymbol || 'F')}</text></svg>`)}">
${FONT}
<link rel="stylesheet" href="${A}/css/base.css">
<link rel="stylesheet" href="${A}/css/material.css">
${color ? `<style>:root{--primary:${color}}</style>` : ''}
</head>`;
}

const GRADES = ['초등학생', '중학생', '고등학생', '대학생·성인', '기타'];

// opts.assetBase: 정적 파일 경로 (서버: /assets, GitHub Pages: assets)
// opts.apiBase  : 접속 기록 API 서버 (서버 모드는 같은 origin → '')
// opts.track    : 브라우저에서 방문 비콘 전송 (서버 모드는 서버가 직접 기록하므로 false)
// opts.static   : 정적 호스팅 (상담 폼 미리보기 모드)
export function renderSite(site, opts = {}) {
  const A = opts.assetBase ?? '/assets';
  const api = opts.apiBase ?? '';
  const subjects = (site.subjects || []).filter((s) => SUBJECTS.includes(s.key));
  const courses = site.courses || [];
  const tutors = site.tutors || [];
  const f = site.features || [];
  const q = site.faqs || [];
  const subjName = (k) => subjects.find((s) => s.key === k)?.name || SUBJECT_NAME[k] || '';

  return `${head(site, `${site.name} | ${site.tagline}`, A, opts.canonical)}
<body class="theme-material" data-site="${esc(site.key)}" data-api="${esc(api)}" data-track="${opts.track ? '1' : '0'}" data-static="${opts.static ? '1' : '0'}">
${site.notice ? `<div class="notice" role="status"><div class="wrap">${esc(site.notice)}</div></div>` : ''}
<header class="nav">
  <div class="wrap nav-inner">
    <a class="brand" href="./"><span class="brand-mark">${esc(site.heroSymbol)}</span><span>${esc(site.name)}</span></a>
    <button class="nav-toggle" type="button" aria-label="메뉴 열기" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
    <nav class="nav-links" aria-label="주요 메뉴">
      <a href="#subjects">과목 소개</a>
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
          <a class="btn btn-ghost btn-lg" href="#subjects">과목 둘러보기</a>
        </div>
      </div>
      <div class="hero-stack" aria-hidden="true">
        ${subjects.map((s, i) => `<div class="stack-card sc-${esc(s.key)}" style="--i:${i}"><b>${esc(s.icon)}</b><span>${esc(s.name)}</span></div>`).join('')}
      </div>
    </div>
  </section>

  ${subjects.length ? `<section id="subjects" class="section">
    <div class="wrap">
      <h2 class="section-title">과목 소개</h2>
      <div class="grid grid-3">
        ${subjects.map((s) => `<article class="card subject-card subj-${esc(s.key)}" data-subject="${esc(s.key)}">
          <div class="subject-icon">${esc(s.icon)}</div>
          <span class="chip">${esc(s.tagline)}</span>
          <h3>${esc(s.name)}</h3>
          <p>${esc(s.desc)}</p>
          <a class="btn btn-outline" href="#subject-${esc(s.key)}">${esc(s.name)} 과정 보기</a>
        </article>`).join('')}
      </div>
    </div>
  </section>` : ''}

  ${f.length ? `<section id="features" class="section section-alt">
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

  <section id="courses" class="section">
    <div class="wrap">
      <h2 class="section-title">수업 과정</h2>
      <nav class="subject-tabs" aria-label="과목 바로가기">
        ${subjects.map((s) => `<a class="tab subj-${esc(s.key)}" href="#subject-${esc(s.key)}" data-subject="${esc(s.key)}">${esc(s.icon)} ${esc(s.name)}</a>`).join('')}
      </nav>
      ${subjects.map((s) => {
        const list = courses.filter((c) => c.subject === s.key);
        return `<div class="subject-block subj-${esc(s.key)}" id="subject-${esc(s.key)}" data-subject="${esc(s.key)}" data-impression="${esc(s.key)}">
          <div class="subject-head">
            <span class="subject-icon sm">${esc(s.icon)}</span>
            <div><h3>${esc(s.name)}</h3><p>${esc(s.tagline)}</p></div>
          </div>
          <div class="grid grid-3">
            ${list.map((x) => `<article class="card course">
              <span class="chip">${esc(x.target)}</span>
              <h3>${esc(x.name)}</h3>
              <p>${esc(x.desc)}</p>
              <div class="price">${esc(x.price)}</div>
              <a class="btn btn-outline" href="#apply" data-course="${esc(s.name)} · ${esc(x.name)}">이 과정 상담하기</a>
            </article>`).join('') || '<p class="empty-note">준비 중인 과정입니다.</p>'}
          </div>
        </div>`;
      }).join('')}
    </div>
  </section>

  ${tutors.length ? `<section id="tutors" class="section section-alt">
    <div class="wrap">
      <h2 class="section-title">선생님 소개</h2>
      <div class="grid grid-3">
        ${tutors.map((x) => `<article class="card tutor subj-${esc(x.subject)}" data-subject="${esc(x.subject)}">
          <div class="avatar">${esc((x.name || '?').trim().charAt(0))}</div>
          <div>
            <span class="chip">${esc(subjName(x.subject))}</span>
            <h3>${esc(x.name)} <small>${esc(x.role)}</small></h3>
            <p>${esc(x.bio)}</p>
          </div>
        </article>`).join('')}
      </div>
    </div>
  </section>` : ''}

  ${q.length ? `<section id="faq" class="section">
    <div class="wrap narrow">
      <h2 class="section-title">자주 묻는 질문</h2>
      <div class="faq-list">
        ${q.map((x) => `<details class="card faq"><summary>${esc(x.q)}</summary><p>${esc(x.a)}</p></details>`).join('')}
      </div>
    </div>
  </section>` : ''}

  <section id="apply" class="section section-alt">
    <div class="wrap apply">
      <div class="apply-info">
        <h2 class="section-title left">무료 상담 신청</h2>
        <p>남겨주신 연락처로 24시간 이내에 연락드립니다.</p>
        <ul class="contact-list">
          ${site.phone ? `<li><b>전화</b><a href="tel:${tel(site.phone)}">${esc(site.phone)}</a></li>` : ''}
          ${site.email ? `<li><b>이메일</b><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></li>` : ''}
          ${site.kakao && /^https?:\/\//.test(site.kakao) ? `<li><b>카카오톡</b><a href="${esc(site.kakao)}" target="_blank" rel="noopener">오픈채팅 상담</a></li>` : ''}
          ${site.area ? `<li><b>수업 지역</b><span>${esc(site.area)}</span></li>` : ''}
          ${site.hours ? `<li><b>상담 시간</b><span>${esc(site.hours)}</span></li>` : ''}
        </ul>
      </div>
      <form class="card apply-form" id="applyForm" novalidate>
        <div class="hp" aria-hidden="true"><label>웹사이트<input name="website" tabindex="-1" autocomplete="off"></label></div>
        <div class="field"><label for="f-name">이름 (학생 또는 학부모)</label><input id="f-name" name="name" required maxlength="40" autocomplete="name"></div>
        <div class="field"><label for="f-phone">연락처</label><input id="f-phone" name="phone" required maxlength="20" inputmode="tel" placeholder="010-1234-5678" autocomplete="tel"></div>
        <div class="field-row">
          <div class="field"><label for="f-grade">학년</label>
            <select id="f-grade" name="grade">${GRADES.map((g) => `<option>${g}</option>`).join('')}</select></div>
          <div class="field"><label for="f-subject">희망 과목 · 과정</label>
            <select id="f-subject" name="subject"><option value="">선택 안 함</option>
              ${subjects.map((s) => `<optgroup label="${esc(s.name)}"><option>${esc(s.name)} (과정 미정)</option>${courses.filter((c) => c.subject === s.key).map((c) => `<option>${esc(s.name)} · ${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}
            </select></div>
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
<body class="theme-material maintenance">
  <main class="maint card">
    <div class="brand-mark big">${esc(site.heroSymbol)}</div>
    <h1>${esc(site.name)}</h1>
    <p>더 나은 서비스를 위해 사이트를 점검하고 있습니다.<br>잠시 후 다시 방문해 주세요.</p>
    ${site.phone ? `<p>상담 문의: <a href="tel:${tel(site.phone)}">${esc(site.phone)}</a></p>` : ''}
  </main>
</body>
</html>`;
}

// 기존 /math/ /english/ /coding/ 주소 → 통합 페이지 해당 과목으로 이동 (GitHub Pages 용)
export function renderRedirect(to) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>퍼스트티쳐로 이동</title>
<meta http-equiv="refresh" content="0; url=${esc(to)}"><link rel="canonical" href="${esc(to)}"></head>
<body><p>퍼스트티쳐로 이동합니다. <a href="${esc(to)}">바로 가기</a></p></body></html>`;
}
