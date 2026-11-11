import { DEFAULT_SITE, SUBJECTS, SUBJECT_NAME } from './defaults.js';

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
<link rel="stylesheet" href="${A}/css/base.css">
<link rel="stylesheet" href="${A}/css/material.css">
${color ? `<style>:root{--primary:${color}}</style>` : ''}
</head>`;
}

const GRADES = ['초등학생', '중학생', '고등학생', '대학생·성인', '기타'];
const LEAD_GRADES = ['초1', '초2', '초3', '초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3·재수생', '성인'];
const LEAD_MODES = ['방문수업', '화상수업'];
// NEIS 학교기본정보의 LCTN_SC_NM 값과 일치해야 함
const SCHOOL_REGIONS = ['서울특별시', '부산광역시', '대구광역시', '인천광역시', '전남광주통합특별시(광주)', '대전광역시', '울산광역시', '세종특별자치시', '경기도', '강원특별자치도', '충청북도', '충청남도', '전북특별자치도', '전남광주통합특별시(전남)', '경상북도', '경상남도', '제주특별자치도'];
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
        <div class="wide lead-school">
          <div class="school-row" data-school-search>
            <select data-school-region aria-label="학교 지역"><option value="">전체 지역</option>${SCHOOL_REGIONS.map((r) => `<option>${r}</option>`).join('')}</select>
            <input data-school-q maxlength="40" placeholder="학교 이름 검색 *" aria-label="학교 이름" autocomplete="off">
          </div>
          <div class="school-results" hidden></div>
          <div class="school-picked" hidden>
            <div class="school-info"><b data-school-name></b><span data-school-addr></span></div>
            <a data-school-link target="_blank" rel="noopener" data-no-track>학교 정보 ↗</a>
            <button type="button" data-school-change data-no-track>변경</button>
          </div>
          <button class="school-manual" type="button" data-school-manual data-no-track>찾는 학교가 없어요 (직접 입력)</button>
          <input type="hidden" name="school">
        </div>
        <div class="wide lead-addr">
          <div class="addr-row">
            <input name="address" readonly placeholder="도로명 주소 * (주소 검색으로 선택)" aria-label="도로명 주소">
            <button class="btn btn-outline" type="button" data-addr-search>주소 검색</button>
          </div>
          <div class="addr-layer" hidden><div class="addr-embed"></div></div>
          <input name="addressDetail" maxlength="80" placeholder="상세 주소 (동·호수)" aria-label="상세 주소" autocomplete="address-line2">
        </div>
        <textarea class="wide" name="message" rows="2" maxlength="1000" placeholder="특이사항 * (원하시는 요일·시간, 아이 상황 등)" aria-label="특이사항"></textarea>
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
    <small>© ${new Date().getFullYear()} ${esc(site.name)}. All rights reserved.</small>
  </div>
</footer>

<a class="fab" href="#apply" aria-label="무료 학습 30분 신청" data-lead-open>무료<br>30분</a>
<div class="toast" role="status" aria-live="polite"></div>
${leadDialog(leadTiles)}
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

export function renderRobots(canonical) {
  return `User-agent: *\nAllow: /\n${canonical ? `\nSitemap: ${canonical}sitemap.xml\n` : ''}`;
}

export function renderSitemap(canonical, lastmod) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${esc(canonical)}</loc><lastmod>${esc(lastmod)}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>
`;
}

// 기존 /math/ /english/ /coding/ 주소 → 통합 페이지 해당 과목으로 이동 (GitHub Pages 용)
export function renderRedirect(to) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>퍼스트티쳐로 이동</title>
<meta name="robots" content="noindex,follow"><meta http-equiv="refresh" content="0; url=${esc(to)}"></head>
<body><p>퍼스트티쳐로 이동합니다. <a href="${esc(to)}">바로 가기</a></p></body></html>`;
}
