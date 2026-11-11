import { DEFAULT_SITE, SUBJECTS, SUBJECT_NAME } from './defaults.js';
import { describeSchool, studyGuide } from './school-guide.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const br = (v) => esc(v).replace(/\n/g, '<br>');
const tel = (p) => esc(String(p || '').replace(/[^0-9+]/g, ''));

const FONT = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">';

// <script type="application/ld+json"> 안에서 </script> 탈출 방지
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

// 검색엔진 구조화 데이터: 교육기관 + 수업 과정 카탈로그 + FAQ
function structuredData(site, url) {
  const subjName = (k) => (site.subjects || []).find((s) => s.key === k)?.name || SUBJECT_NAME[k] || k;
  const org = {
    '@context': 'https://schema.org',
    '@type': 'EducationalOrganization',
    name: site.name,
    description: site.heroSub,
    url,
    ...(site.phone && !/^010-0000-0000$/.test(site.phone) ? { telephone: site.phone } : {}),
    ...(site.email ? { email: site.email } : {}),
    ...(site.area ? { areaServed: site.area } : {}),
    image: url + 'assets/og.png',
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: '수업 과정',
      itemListElement: (site.courses || []).map((c) => ({
        '@type': 'Offer',
        description: c.price,
        itemOffered: {
          '@type': 'Course',
          name: `${subjName(c.subject)} · ${c.name}`,
          description: `${c.target} — ${c.desc}`,
          provider: { '@type': 'EducationalOrganization', name: site.name, sameAs: url }
        }
      }))
    }
  };
  const faq = (site.faqs || []).length ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: site.faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
  } : null;
  return ld(org) + (faq ? '\n' + ld(faq) : '');
}

// opts.canonical: 대표 URL (https://firstteacher.co.kr/) — 있으면 og:url·og:image 절대경로·구조화 데이터 출력
// opts.verify   : { google, naver, bing } 검색엔진 소유확인 코드
function head(site, title, A, opts = {}) {
  const color = /^#[0-9a-fA-F]{6}$/.test(site.color || '') ? site.color : '';
  const canonical = opts.canonical;
  const v = opts.verify || {};
  const subjects = (site.subjects || []).map((s) => s.name).join(', ');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(site.heroSub)}">
<meta name="keywords" content="${esc([site.name, '과외', '1:1 과외', '1:1 맞춤 수업', '무료 학습', '중등 내신', '고등 내신', '모의고사', subjects, ...(site.subjects || []).map((s) => s.name + ' 과외')].join(', '))}">
<meta name="robots" content="index,follow,max-image-preview:large">
${v.google ? `<meta name="google-site-verification" content="${esc(v.google)}">` : ''}
${v.naver ? `<meta name="naver-site-verification" content="${esc(v.naver)}">` : ''}
${v.bing ? `<meta name="msvalidate.01" content="${esc(v.bing)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:locale" content="ko_KR">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(site.name)} | ${esc(site.tagline)}">
<meta property="og:description" content="${esc(site.heroSub)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(canonical)}assets/og.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
${structuredData(site, canonical)}` : ''}
<meta name="theme-color" content="${esc(color || '#6750a4')}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${color || '#6750a4'}"/><text x="32" y="44" font-size="34" font-family="Arial" font-weight="700" fill="#fff" text-anchor="middle">${esc(site.heroSymbol || 'F')}</text></svg>`)}">
${FONT}
<link rel="stylesheet" href="${A}/css/base.css${opts.assetV ? `?v=${opts.assetV}` : ''}">
<link rel="stylesheet" href="${A}/css/material.css${opts.assetV ? `?v=${opts.assetV}` : ''}">
${color ? `<style>:root{--primary:${color}}</style>` : ''}
</head>`;
}

const GRADES = ['초등학생', '중학생', '고등학생', '대학생·성인', '기타'];
const LEAD_GRADES = ['초1', '초2', '초3', '초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3·재수생', '성인'];
const LEAD_MODES = ['방문수업', '화상수업'];
const MARQUEE = ['1:1 맞춤 수업', '무료 학습 30분', '중등 내신', '고등 내신', '모의고사', '학교별 기출 분석', '오답 관리', '월간 리포트'];

const leadOptions = (name, values) => values.map((v) => `<label class="opt"><input type="radio" name="${name}" value="${esc(v)}"><span>${esc(v)}</span></label>`).join('');

// 첫 방문 팝업: 1단계 과목 선택 → 2단계 인적사항 → 완료
function leadDialog(tiles) {
  return `<dialog class="lead-modal" id="leadDialog" aria-labelledby="leadTitle">
  <div class="lead-progress" aria-hidden="true"><i></i></div>
  <button class="lead-close" type="button" data-lead-close aria-label="닫기">✕</button>
  <div class="lead-step" data-step="1">
    <h2 id="leadTitle">어떤 과목을 도와드릴까요?</h2>
    <p class="lead-sub">과목을 고르시면 <b>무료 학습 30분</b> 신청으로 이어집니다.</p>
    <div class="lead-grid">
      ${tiles.map((t, i) => `<button class="lead-tile" type="button" style="--i:${i}" data-lead-pick="${esc(t.name)}"><b>${esc(t.icon)}</b><span>${esc(t.name)}</span></button>`).join('')}
    </div>
  </div>
  <form class="lead-step" id="leadForm" data-step="2" hidden novalidate>
    <button class="lead-back" type="button" data-lead-back>← 과목 다시 고르기</button>
    <h2><span data-lead-picked></span> 1:1 맞춤 수업 무료 학습 30분</h2>
    <div class="hp" aria-hidden="true"><label>웹사이트<input name="website" tabindex="-1" autocomplete="off"></label></div>
    <fieldset><legend>학년</legend><div class="opts">${leadOptions('grade', LEAD_GRADES)}</div></fieldset>
    <fieldset><legend>수업 방식</legend><div class="opts">${leadOptions('mode', LEAD_MODES)}</div></fieldset>
    <fieldset><legend>연락처</legend>
      <div class="lead-fields">
        <input name="name" maxlength="40" placeholder="이름 *" aria-label="이름" autocomplete="name">
        <input name="phone" maxlength="20" inputmode="tel" placeholder="연락처 *" aria-label="연락처" autocomplete="tel">
        <input class="wide" name="school" maxlength="60" placeholder="학교 *" aria-label="학교">
        <div class="wide lead-addr">
          <div class="addr-row">
            <input name="address" readonly placeholder="도로명 주소 * (주소 검색으로 선택)" aria-label="도로명 주소">
            <button class="btn btn-outline" type="button" data-addr-search>주소 검색</button>
          </div>
          <div class="addr-layer" hidden><div class="addr-embed"></div></div>
          <input name="addressDetail" maxlength="80" placeholder="상세 주소 (동·호수)" aria-label="상세 주소" autocomplete="address-line2">
        </div>
        <textarea class="wide" name="message" rows="2" maxlength="700" placeholder="특이사항 * (원하시는 요일·시간, 아이 상황 등)" aria-label="특이사항"></textarea>
      </div>
    </fieldset>
    <details class="lead-terms"><summary>개인정보 수집·이용 안내 보기</summary>
      <p><b>수집 항목</b> 이름, 연락처, 학년, 학교, 주소, 희망 과목, 수업 방식, 특이사항<br>
      <b>이용 목적</b> 상담 연락, 무료 학습 30분 일정 안내, 선생님 배정<br>
      <b>보유 기간</b> 상담 종료 후 1년, 이후 파기<br>
      동의를 거부할 수 있으나, 거부하시면 신청이 어렵습니다. 만 14세 미만 학생은 보호자가 작성해 주세요.</p>
    </details>
    <label class="agree"><input type="checkbox" name="agree"> [필수] 개인정보 수집·이용에 동의합니다.</label>
    <p class="form-msg" role="alert" aria-live="polite"></p>
    <button class="btn btn-primary btn-lg btn-block" type="submit">무료 학습 30분 신청하기</button>
  </form>
  <div class="lead-step lead-done" data-step="3" hidden>
    <div class="lead-check" aria-hidden="true">✓</div>
    <h2>신청이 접수되었습니다</h2>
    <p class="lead-sub">24시간 이내에 연락드려 무료 학습 30분 일정을 안내해 드리겠습니다.</p>
    <button class="btn btn-primary btn-lg btn-block" type="button" data-lead-close>확인</button>
  </div>
</dialog>`;
}

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
  // 이 항목들이 추가되기 전에 저장된 콘텐츠(로컬 DB)는 기본값으로 표시
  const worries = site.worries ?? DEFAULT_SITE.data.worries;
  const steps = site.steps ?? DEFAULT_SITE.data.steps;
  const exams = site.exams ?? DEFAULT_SITE.data.exams;
  const leadTiles = site.leadSubjects ?? DEFAULT_SITE.data.leadSubjects;
  const subjName = (k) => subjects.find((s) => s.key === k)?.name || SUBJECT_NAME[k] || '';

  return `${head(site, `${site.name} | ${site.tagline}`, A, opts)}
<body class="theme-material" data-site="${esc(site.key)}" data-api="${esc(api)}" data-track="${opts.track ? '1' : '0'}" data-static="${opts.static ? '1' : '0'}">
<div class="scroll-bar" aria-hidden="true"></div>
${site.notice ? `<div class="notice" role="status"><div class="wrap">${esc(site.notice)}</div></div>` : ''}
<header class="nav">
  <div class="wrap nav-inner">
    <a class="brand" href="./"><span class="brand-mark">${esc(site.heroSymbol)}</span><span>${esc(site.name)}</span></a>
    <button class="nav-toggle" type="button" aria-label="메뉴 열기" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
    <nav class="nav-links" aria-label="주요 메뉴">
      <a href="#worries">고민 해결</a>
      <a href="#exams">내신·모의고사</a>
      ${opts.schoolRegions?.length ? '<a href="schools/">학교별 과외</a>' : ''}
      <a href="#courses">수업 과정</a>
      <a href="#tutors">선생님</a>
      <a href="#faq">FAQ</a>
      <a class="btn btn-primary" href="#apply" data-lead-open>무료 학습 30분</a>
    </nav>
  </div>
</header>

<main>
  <section class="hero">
    <canvas class="hero-canvas" aria-hidden="true"></canvas>
    <div class="wrap hero-inner">
      <div class="hero-text">
        <span class="eyebrow">${esc(site.tagline)}</span>
        <h1>${br(site.heroTitle)}</h1>
        <p class="lead">${esc(site.heroSub)}</p>
        <p class="hero-rotate">1:1로 함께 잡습니다 · <span data-rotate="중등 내신|고등 내신|모의고사 등급|서술형 대비|반복되는 실수">중등 내신</span></p>
        <ul class="hero-badges">
          <li>1:1 맞춤 수업</li><li>무료 학습 30분</li><li>중등·고등 내신</li><li>모의고사 대비</li>
        </ul>
        <div class="hero-actions">
          <a class="btn btn-primary btn-lg" href="#apply" data-lead-open>무료 학습 30분 신청</a>
          <a class="btn btn-ghost btn-lg" href="#subjects">과목 둘러보기</a>
        </div>
      </div>
      <div class="hero-stack" aria-hidden="true">
        ${subjects.map((s, i) => `<div class="stack-card sc-${esc(s.key)}" style="--i:${i}"><b>${esc(s.icon)}</b><span>${esc(s.name)}</span></div>`).join('')}
      </div>
    </div>
  </section>

  <div class="marquee" aria-hidden="true"><div class="marquee-track">${[0, 1].map(() => MARQUEE.map((t) => `<span>${esc(t)}</span>`).join('')).join('')}</div></div>

  ${worries.length ? `<section id="worries" class="section section-alt">
    <div class="wrap">
      <h2 class="section-title">아이 공부, 이런 걱정이 드시나요?</h2>
      <p class="section-sub">학부모님의 고민을 1:1 맞춤 수업으로 이렇게 해결합니다.</p>
      <div class="grid grid-2">
        ${worries.map((x) => `<article class="card worry">
          <p class="worry-q">“${esc(x.worry)}”</p>
          <p class="worry-a">${esc(x.solution)}</p>
        </article>`).join('')}
      </div>
    </div>
  </section>` : ''}

  ${steps.length ? `<section id="trial" class="section trial">
    <div class="wrap">
      <span class="trial-badge">비용 없이 먼저 경험해 보세요</span>
      <div class="trial-ring" aria-hidden="true">
        <svg viewBox="0 0 120 120"><circle class="ring-track" cx="60" cy="60" r="54"/><circle class="ring-fill" cx="60" cy="60" r="54"/></svg>
        <b data-count="30">30</b><span>분 무료</span>
      </div>
      <h2 class="section-title">무료 학습 30분</h2>
      <p class="section-sub">등록을 결정하기 전에 1:1 수업을 직접 받아 보실 수 있습니다.</p>
      <ol class="steps">
        ${steps.map((x, i) => `<li class="card step"><span class="step-no">${i + 1}</span><h3>${esc(x.title)}</h3><p>${esc(x.desc)}</p></li>`).join('')}
      </ol>
      <div class="trial-cta"><a class="btn btn-primary btn-lg" href="#apply" data-lead-open>무료 학습 30분 신청</a></div>
    </div>
  </section>` : ''}

  ${exams.length ? `<section id="exams" class="section section-alt">
    <div class="wrap">
      <h2 class="section-title">중등·고등 내신과 모의고사 대비</h2>
      <p class="section-sub">학교와 시험에 맞춰 1:1로 준비합니다.</p>
      <div class="grid grid-3">
        ${exams.map((x) => `<article class="card exam">
          <span class="chip">${esc(x.target)}</span>
          <h3>${esc(x.title)}</h3>
          <p>${esc(x.desc)}</p>
        </article>`).join('')}
      </div>
    </div>
  </section>` : ''}

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
      <h2 class="section-title">1:1 맞춤 수업 과정</h2>
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
        <h2 class="section-title left">무료 학습 30분 신청</h2>
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
        <button class="btn btn-primary btn-lg btn-block" type="submit">무료 학습 30분 신청하기</button>
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
    ${opts.schoolRegions?.length ? `<nav class="school-links" aria-label="지역별 학교">
      <a class="school-links-all" href="schools/">전국 학교별 1:1 맞춤 수업</a>
      ${opts.schoolRegions.map((r) => `<a href="schools/${esc(r.slug)}/">${esc(r.short)}</a>`).join('')}
    </nav>` : ''}
    <small>© ${new Date().getFullYear()} ${esc(site.name)}. All rights reserved.</small>
  </div>
</footer>

<a class="fab" href="#apply" aria-label="무료 학습 30분 신청" data-lead-open>무료<br>30분</a>
<div class="toast" role="status" aria-live="polite"></div>
${leadDialog(leadTiles)}
<script src="${A}/js/site.js${opts.assetV ? `?v=${opts.assetV}` : ''}" defer></script>
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

export function renderRobots(canonical) {
  return `User-agent: *\nAllow: /\n${canonical ? `\nSitemap: ${canonical}sitemap.xml\n` : ''}`;
}

export function renderSitemap(canonical, lastmod, paths = []) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${esc(canonical)}</loc><lastmod>${esc(lastmod)}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
${paths.map((p) => `  <url><loc>${esc(canonical + encodeURI(p))}</loc><lastmod>${esc(lastmod)}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>\n`).join('')}</urlset>
`;
}

// ───── 학교별 과외 페이지 (src/schools.json → dist/schools/{시·도}/{시·군·구}/) ─────
// 시·도 → 주소·메뉴 표기. schools.json 을 갱신했을 때 새 지역이 있으면 빌드가 실패하므로 여기에 추가
export const SCHOOL_REGIONS = [
  ['서울특별시', 'seoul', '서울'], ['부산광역시', 'busan', '부산'], ['대구광역시', 'daegu', '대구'], ['인천광역시', 'incheon', '인천'],
  ['전남광주통합특별시(광주)', 'gwangju', '광주'], ['대전광역시', 'daejeon', '대전'], ['울산광역시', 'ulsan', '울산'], ['세종특별자치시', 'sejong', '세종'],
  ['경기도', 'gyeonggi', '경기'], ['강원특별자치도', 'gangwon', '강원'], ['충청북도', 'chungbuk', '충북'], ['충청남도', 'chungnam', '충남'],
  ['전북특별자치도', 'jeonbuk', '전북'], ['전남광주통합특별시(전남)', 'jeonnam', '전남'], ['경상북도', 'gyeongbuk', '경북'], ['경상남도', 'gyeongnam', '경남'],
  ['제주특별자치도', 'jeju', '제주'], ['재외한국학교', 'overseas', '재외한국학교']
].map(([name, slug, short]) => ({ name, slug, short }));

// 화면에 나오는 순서. 그 외 학교급은 '기타 학교'로 묶음
export const SCHOOL_KINDS = [['고등학교', '고등학교'], ['중학교', '중학교'], ['초등학교', '초등학교'], ['etc', '기타 학교']];
export const schoolKindKey = (k) => (SCHOOL_KINDS.some(([x]) => x === k) ? k : 'etc');
export const shortSchool = (name) => {
  // 대학 부속학교: '동국대…부속선화여자고등학교' → 선화여고, 고유 이름이 없으면 '단국대부속고'
  const own = name.replace(/^.+대학교(사범대학)?(부속|부설)/, '');
  const base = /^(여자)?(고등|중|초등)학교$/.test(own) ? name.replace(/대학교(사범대학)?(부속|부설)/, '대부속') : own;
  return base.replace(/여자고등학교$/, '여고').replace(/여자중학교$/, '여중')
    .replace(/고등학교$/, '고').replace(/중학교$/, '중').replace(/초등학교$/, '초');
};

// 시·도의 학교를 시·군·구 단위로 묶음. path 는 페이지 폴더 이름
export function schoolCitiesOf(region, list) {
  const m = new Map();
  for (const x of list) {
    const c = /(특별시|광역시|특별자치시|특별자치도|도)$/.test(x[3]) ? '기타' : x[3]; // NEIS 주소에 시·도가 중복된 학교
    if (!m.has(c)) m.set(c, []);
    m.get(c).push(x);
  }
  return [...m].sort(([a], [b]) => (a === '기타') - (b === '기타') || a.localeCompare(b, 'ko')).map(([city, schools]) => ({
    city, schools,
    path: city === '기타' ? 'all' : city,
    label: city === '기타' ? region.short : city.length > 2 ? city.slice(0, -1) : `${region.short} ${city}`
  }));
}

const count = (n) => n.toLocaleString('ko-KR');

function schoolPage(site, { title, desc, path: pagePath, root, crumbs, h1, lead, heroCta = '', body }, opts) {
  const A = `${root}assets`;
  const url = opts.canonical ? opts.canonical + encodeURI(pagePath) : '';
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index,follow">
${url ? `<link rel="canonical" href="${esc(url)}">
<meta property="og:url" content="${esc(url)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:locale" content="ko_KR">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta name="theme-color" content="#6750a4">
${FONT}
<link rel="stylesheet" href="${A}/css/base.css${opts.assetV ? `?v=${opts.assetV}` : ''}">
<link rel="stylesheet" href="${A}/css/material.css${opts.assetV ? `?v=${opts.assetV}` : ''}">
</head>
<body class="theme-material school-page" data-site="${esc(site.key)}" data-api="${esc(opts.apiBase ?? '')}" data-track="1" data-static="1">
<div class="scroll-bar" aria-hidden="true"></div>
<header class="nav">
  <div class="wrap nav-inner">
    <a class="brand" href="${root}"><span class="brand-mark">${esc(site.heroSymbol)}</span><span>${esc(site.name)}</span></a>
    <button class="nav-toggle" type="button" aria-label="메뉴 열기" aria-expanded="false"><span></span><span></span><span></span></button>
    <nav class="nav-links" aria-label="주요 메뉴">
      <a href="${root}#worries">고민 해결</a>
      <a href="${root}#exams">내신·모의고사</a>
      <a class="active" href="${root}schools/">학교별 과외</a>
      <a href="${root}#courses">수업 과정</a>
      <a href="${root}#tutors">선생님</a>
      <a href="${root}#faq">FAQ</a>
      <a class="btn btn-primary" href="${root}#apply">무료 학습 30분</a>
    </nav>
  </div>
</header>
<main>
  <section class="hero school-hero">
    <canvas class="hero-canvas" aria-hidden="true"></canvas>
    <div class="wrap"><div class="hero-text">
      <nav class="crumbs" aria-label="현재 위치">${crumbs.map(([t, href]) => (href ? `<a href="${esc(encodeURI(href))}">${esc(t)}</a>` : `<span>${esc(t)}</span>`)).join('<i aria-hidden="true">›</i>')}</nav>
      <h1>${esc(h1)}</h1>
      <p class="lead">${lead}</p>
      ${heroCta}
    </div></div>
  </section>
  <div class="wrap school-main">
${body}
    <p class="school-source">학교 목록은 교육부 나이스(NEIS) 교육정보 개방 포털의 공개 자료를 기준으로 합니다. ${esc(site.name)}은(는) 각 학교와 제휴 관계가 없습니다. 수업 지역: ${esc(site.area || '')}</p>
  </div>
</main>
<footer class="footer"><div class="wrap"><strong>${esc(site.name)}</strong><span>${esc(site.tagline)}</span><small>© ${new Date().getFullYear()} ${esc(site.name)}. All rights reserved.</small></div></footer>
<a class="fab" href="${root}#apply" aria-label="무료 학습 30분 신청">무료<br>30분</a>
<script src="${A}/js/site.js${opts.assetV ? `?v=${opts.assetV}` : ''}" defer></script>
</body>
</html>`;
}

const finderHtml = (placeholder, attrs, kinds) => `<div class="school-finder"${attrs}>
      <label class="finder-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="${esc(placeholder)}" aria-label="학교 이름 검색" autocomplete="off"></label>
      <div class="kind-chips" role="group" aria-label="학교급 선택">
        <span class="kind-pill" aria-hidden="true"></span>
        <button type="button" class="kind-chip on" data-kind="all" aria-pressed="true" data-no-track>전체</button>
        ${kinds.map(([k, t]) => `<button type="button" class="kind-chip" data-kind="${esc(k)}" aria-pressed="false" data-no-track>${esc(t)}</button>`).join('')}
      </div>
    </div>
    <p class="school-empty" hidden>조건에 맞는 학교가 없습니다. 이름을 줄여서 검색해 보세요.</p>`;

const remoteResults = `<div class="school-results-area" hidden>
      <p class="school-result-note"></p>
      <div class="school-grid" data-finder-results></div>
    </div>`;

export function renderSchoolsIndex(site, regions, total, opts = {}) {
  return schoolPage(site, {
    title: `전국 학교별 1:1 과외 · 내신 대비 | ${site.name}`,
    desc: `전국 ${count(total)}개 학교 학생을 위한 내신·모의고사 대비 1:1 맞춤 수업. 무료 학습 30분을 먼저 받아 보세요.`,
    path: 'schools/', root: '../',
    crumbs: [['홈', '../'], ['학교별 과외']],
    h1: '전국 학교별 1:1 과외',
    lead: `전국 학교 <b>${count(total)}곳</b>을 한눈에 모았습니다. 학교 이름을 검색하거나 지역을 선택하세요.`,
    body: `    ${finderHtml('학교 이름으로 검색 (예: 대치중학교)', ' data-json="search.json" data-root="../"', SCHOOL_KINDS)}
    ${remoteResults}
    <div data-finder-default>
      <div class="school-section-head"><h2>지역별 학교</h2></div>
      <div class="school-grid">${regions.map((r) => `<a class="card school-card" href="${esc(r.slug)}/"><b class="school-name">${esc(r.short)} 학교별 과외</b><span>${count(r.count)}곳 · ${r.cities.length}개 지역</span></a>`).join('')}</div>
    </div>`
  }, opts);
}

export function renderSchoolRegion(site, region, opts = {}) {
  return schoolPage(site, {
    title: `${region.short} 학교별 1:1 과외 · 내신 대비 | ${site.name}`,
    desc: `${region.name} ${count(region.count)}개 학교 학생을 위한 내신·모의고사 대비 1:1 맞춤 수업. 무료 학습 30분을 먼저 받아 보세요.`,
    path: `schools/${region.slug}/`, root: '../../',
    crumbs: [['홈', '../../'], ['학교별 과외', '../'], [region.short]],
    h1: `${region.short} 학교별 1:1 과외`,
    lead: `${esc(region.name)} 학교 <b>${count(region.count)}곳</b>을 한눈에 모았습니다. 학교 이름을 검색하거나 지역을 선택하세요.`,
    body: `    ${finderHtml('학교 이름으로 검색', ` data-json="../search.json" data-root="../../" data-region="${esc(region.slug)}"`, SCHOOL_KINDS)}
    ${remoteResults}
    <div data-finder-default>
      <div class="school-section-head"><h2>${esc(region.short)} 지역별 학교</h2></div>
      <div class="school-grid">${region.cities.map((c) => `<a class="card school-card" href="${esc(encodeURI(c.path))}/"><b class="school-name">${esc(c.label)} 학교별 과외</b><span>${count(c.schools.length)}곳</span></a>`).join('')}</div>
    </div>`
  }, opts);
}

export function renderSchoolCity(site, region, city, opts = {}) {
  const root = '../../../';
  const n = city.schools.length;
  const groups = SCHOOL_KINDS.map(([k, t]) => [k, t, city.schools.filter((x) => schoolKindKey(x[1]) === k)]).filter(([, , xs]) => xs.length);
  return schoolPage(site, {
    title: `${city.label} 학교별 1:1 과외 · 초·중·고 내신 대비 | ${site.name}`,
    desc: `${region.name} ${city.label} 학교 ${count(n)}곳 학생을 위한 국어·영어·수학 1:1 맞춤 과외. 내신·모의고사 대비, 무료 학습 30분.`,
    path: `schools/${region.slug}/${city.path}/`, root,
    crumbs: [['홈', root], ['학교별 과외', '../../'], [region.short, '../'], [city.label]],
    h1: `${city.label} 학교별 1:1 과외`,
    lead: `${esc(region.name)} ${esc(city.city === '기타' ? '' : city.city)} 학교 <b>${count(n)}곳</b>을 한눈에 모았습니다. 학교 이름을 검색하거나 아래에서 선택하세요.`,
    body: `    ${finderHtml('학교 이름으로 검색', '', groups.map(([k, t]) => [k, t]))}
${groups.map(([k, t, xs]) => `    <section class="school-section" data-section="${esc(k)}">
      <div class="school-section-head"><h2>${esc(city.label)} ${esc(t)} 과외</h2><span class="count-badge">${count(xs.length)}곳</span></div>
      <div class="school-grid">${xs.map((x) => {
        const short = shortSchool(x[0]);
        return `<a class="card school-card" href="${esc(encodeURIComponent(x[4]))}/" data-name="${esc(x[0])}" data-short="${esc(short)}" data-kind="${esc(k)}"><b class="school-name">${esc(x[0])}</b><span>${esc(city.label)} ${esc(short)} 국어·영어·수학 과외</span></a>`;
      }).join('')}</div>
    </section>`).join('\n')}`
  }, opts);
}

// 학교별 상세 페이지 (.../schools/{시·도}/{시·군·구}/{학교코드}/)
export function renderSchoolDetail(site, region, city, row, opts = {}) {
  const root = '../../../../';
  const s = describeSchool(row);
  const short = shortSchool(s.name);
  const guide = studyGuide(s.level);
  const apply = `${root}?school=${encodeURIComponent(s.name)}`;
  const nearby = city.schools.filter((x) => x[1] === s.kind && x[4] !== s.code).slice(0, 8);
  const keywords = [...guide.map((g) => `${short} ${g.subject} 과외`), `${short} 내신`, ...(s.level === 'high' ? [`${short} 모의고사`] : []), `${city.label} ${s.kind} 과외`];
  const steps = [
    ['시험 범위·평가 계획 확인', `${short}에서 공개한 평가 계획으로 지필과 수행평가 비중을 확인합니다.`],
    ['무료 학습 30분', '1:1로 수업을 해 보며 과목별 강점과 취약점을 진단합니다.'],
    ['과목별 계획', s.level === 'high' ? '학교 시험 일정과 모의고사 일정에 맞춰 학습 순서를 정합니다.' : '학교 시험 일정에 맞춰 과목별 학습 순서를 정합니다.'],
    ['오답 관리와 리포트', '틀린 이유를 기록해 반복 실수를 줄이고, 매월 학습 현황을 공유합니다.']
  ];
  return schoolPage(site, {
    title: `${s.name} 과외 | 국어·영어·수학 1:1 맞춤 내신 대비 | ${site.name}`,
    desc: `${s.region} ${city.label} ${s.name} 학생을 위한 국어·영어·수학·사회·과학·한국사 1:1 맞춤 과외. 학교 특징과 과목별 공부법, 내신 대비 순서를 안내합니다.`,
    path: `schools/${region.slug}/${city.path}/${s.code}/`, root,
    crumbs: [['홈', root], ['학교별 과외', '../../../'], [region.short, '../../'], [city.label, '../'], [s.name]],
    h1: `${s.name} 1:1 과외`,
    lead: `${esc(s.intro)}`,
    heroCta: `<a class="btn btn-primary btn-lg" href="${esc(apply)}" rel="nofollow">${esc(short)} 무료 학습 30분 신청</a>`,
    body: `    <section class="detail-section">
      <h2 class="section-title left">${esc(short)} 학교 특징</h2>
      <div class="fact-grid">${s.facts.map(([k, v]) => `<div class="card fact-card"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
      ${s.majors.length ? `<div class="card note-card"><h3>개설 학과</h3><ul class="major-list">${s.majors.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
      <div class="card note-card"><h3>${esc(short)} 학습 방향</h3><p>${esc(s.note)}</p></div>
      ${s.home ? `<p class="school-home"><a href="${esc(s.home)}" target="_blank" rel="nofollow noopener">${esc(short)} 학교 홈페이지 ↗</a></p>` : ''}
    </section>
    <section class="detail-section">
      <h2 class="section-title left">${esc(short)} 과목별 공부법</h2>
      <div class="study-grid">${guide.map((g) => `<article class="card study-card"><h3>${esc(short)} ${esc(g.subject)} 과외</h3><p>${esc(g.text)}</p></article>`).join('')}</div>
    </section>
    <section class="detail-section">
      <h2 class="section-title left">${esc(short)} 내신 대비 순서</h2>
      <ol class="steps">${steps.map(([t, d], i) => `<li class="card step"><span class="step-no">${i + 1}</span><h3>${esc(t)}</h3><p>${esc(d)}</p></li>`).join('')}</ol>
      <div class="trial-cta detail-cta"><a class="btn btn-primary btn-lg" href="${esc(apply)}" rel="nofollow">무료 학습 30분 신청</a></div>
    </section>
    <section class="detail-section">
      <h2 class="section-title left">${esc(short)} 과외 키워드</h2>
      <ul class="keyword-list">${keywords.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>
    </section>
    ${nearby.length ? `<section class="detail-section">
      <h2 class="section-title left">${esc(city.label)} 다른 ${esc(s.kind)}</h2>
      <div class="school-grid">${nearby.map((x) => `<a class="card school-card" href="../${esc(encodeURIComponent(x[4]))}/"><b class="school-name">${esc(x[0])}</b><span>${esc(city.label)} ${esc(shortSchool(x[0]))} 과외</span></a>`).join('')}</div>
    </section>` : ''}`
  }, opts);
}

// 기존 /math/ /english/ /coding/ 주소 → 통합 페이지 해당 과목으로 이동 (GitHub Pages 용)
export function renderRedirect(to) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>퍼스트티쳐로 이동</title>
<meta name="robots" content="noindex,follow"><meta http-equiv="refresh" content="0; url=${esc(to)}"></head>
<body><p>퍼스트티쳐로 이동합니다. <a href="${esc(to)}">바로 가기</a></p></body></html>`;
}
