// 무안 화상과외 과목별 검색 유입 페이지: public/muan/index.html 을 틀로 /muan/{slug}/ 생성
// ("무안 수학과외", "남악 수학과외" 같은 검색어마다 제목·설명·본문이 다른 페이지가 잡히게 함)
const BASE = 'https://firstteacher.co.kr/muan/';

export const MUAN_SUBJECTS = [
  ['math', '수학', '초등 연산부터 중등 수학, 고등 수학(상·하)·수Ⅰ·수Ⅱ·확률과 통계·미적분까지 학생 수준에 맞춰 수업합니다.', ['개념 이해 → 유형 풀이 → 오답 정리 순서의 1:1 수업', '남악고·무안고·남악중·오룡중 내신 기출 대비', '수능 수학·모의고사 대비']],
  ['english', '영어', '중·고등 내신 영어와 수능 영어, 문법·독해·어휘를 학생 약점에 맞춰 잡아드립니다.', ['학교 교과서 본문·문법 내신 대비', '수능 독해·듣기 유형별 풀이', '초등 영어 기초·파닉스']],
  ['korean', '국어', '문학·비문학 독해와 문법, 중·고등 내신 국어와 수능 국어를 함께 준비합니다.', ['교과서 작품 분석 내신 대비', '비문학 독해 훈련', '수능 국어·언어와 매체·화법과 작문']],
  ['science', '과학', '중학 과학과 고1 통합과학을 개념부터 차근차근 설명하고 내신 시험까지 대비합니다.', ['중1~중3 과학 내신', '고1 통합과학', '실험·탐구 서술형 대비']],
  ['social', '사회', '중학 사회와 고1 통합사회, 지리·일반사회 과목을 내신 위주로 정리합니다.', ['중학 사회·역사 내신', '고1 통합사회', '사회탐구 선택과목']],
  ['history', '한국사', '중·고등 역사와 한국사 내신, 한국사능력검정시험 대비를 함께 합니다.', ['시대 흐름 중심 개념 정리', '학교 내신·수행평가 대비', '한능검 심화·기본 대비']],
  ['physics', '물리', '물리학Ⅰ·Ⅱ 개념과 계산 문제를 1:1로 풀어주며 내신과 수능을 대비합니다.', ['역학·전자기·파동 개념 정리', '고2·고3 내신 물리', '수능 물리학Ⅰ']],
  ['chemistry', '화학', '화학Ⅰ·Ⅱ의 몰 계산, 화학 반응, 평형까지 개념과 문제풀이를 함께 합니다.', ['양적 관계·몰 계산 집중', '고2·고3 내신 화학', '수능 화학Ⅰ']],
  ['biology', '생명과학', '생명과학Ⅰ·Ⅱ 개념 암기와 유전 문제 풀이를 체계적으로 지도합니다.', ['세포·유전·항상성 개념 정리', '유전 킬러 문항 풀이', '내신·수능 생명과학Ⅰ']],
  ['earth-science', '지구과학', '지구과학Ⅰ·Ⅱ의 지질·대기·천체 단원을 그림과 자료 해석 위주로 수업합니다.', ['자료 해석형 문제 훈련', '내신 지구과학', '수능 지구과학Ⅰ']],
  ['coding', '코딩', '스크래치·엔트리부터 파이썬·C언어까지 화면 공유로 직접 코드를 짜며 배웁니다.', ['초등 블록 코딩', '중·고등 파이썬·C언어', '정보 과목 내신·자격증 대비']],
  ['english-conversation', '영어회화', '화상으로 매 수업 직접 말하며 스피킹 자신감을 키우는 1:1 영어회화 수업입니다.', ['초등·중등 스피킹', '프리토킹·발음 교정', '성인 영어회화']],
  ['essay', '논술', '독서논술과 대입 논술을 글쓰기·첨삭 중심으로 1:1 지도합니다.', ['초등·중등 독서논술', '서술형·수행평가 글쓰기', '대입 논술 첨삭']],
  ['self-study', '자기주도학습', '공부 계획 세우기, 플래너 관리, 공부법 코칭으로 혼자 공부하는 힘을 기릅니다.', ['주간 학습 계획·플래너 점검', '과목별 공부법 코칭', '시험 기간 일정 관리']],
  ['foreign-language', '제2외국어', '중국어·일본어를 회화와 시험 대비로 나눠 1:1 화상 수업합니다.', ['중국어·일본어 기초 회화', '학교 제2외국어 내신', 'HSK·JLPT 대비']]
];

// 틀에서 바꿀 곳이 하나라도 안 맞으면 빌드 실패 (index.html 수정 시 조용히 깨지는 것 방지)
function swap(html, re, to) {
  if (!re.test(html)) throw new Error(`muan-pages: 틀에서 ${re} 를 찾지 못함`);
  return html.replace(re, to);
}

export function muanPages(tpl) {
  return MUAN_SUBJECTS.map(([slug, n, desc, points]) => {
    const url = `${BASE}${slug}/`;
    const title = `무안 ${n}과외 · 남악 ${n}과외 | 1:1 화상 ${n} 과외, 30분 무료수업`;
    const meta = `무안${n}과외·남악${n}과외 찾으세요? 선생님 500명 이상 중 맞춤 매칭, 1:1 화상 ${n} 과외. 남악·오룡·무안읍 내신 대비, 30분 무료수업. ☎ 010-2224-4713`;
    const intro = `<section class="intro"><div class="wrap">
  <h2>무안·남악 ${n}과외 안내</h2>
  <p>${desc} 무안읍·남악신도시·오룡지구 어디서든 집에서 1:1 화상으로 수업합니다.</p>
  <ul>${points.map((p) => `<li>${p}</li>`).join('')}<li>30분 무료수업 후 결정</li></ul>
</div></section>`;
    let html = tpl;
    html = swap(html, /<title>[^<]*<\/title>/, `<title>${title}</title>`);
    html = swap(html, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${meta}">`);
    html = swap(html, /<meta name="keywords" content="/, `<meta name="keywords" content="무안${n}과외,무안 ${n}과외,남악${n}과외,남악 ${n}과외,오룡 ${n}과외,무안 ${n} 화상과외,`);
    html = swap(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`);
    html = swap(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="무안 ${n}과외 · 남악 ${n}과외">`);
    html = swap(html, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`);
    html = swap(html, /(<h1 id="heroTitle">)[\s\S]*?(<\/h1>)/, `$1무안 ${n}과외 · 남악 ${n}과외<br><span>1:1 화상 ${n} 과외</span>$2`);
    html = swap(html, /<body>/, `<body data-preset="${n}">`);
    html = swap(html, /<!--INTRO-->/, intro);
    html = swap(html, /<a class="logo" href="#top">/, '<a class="logo" href="/muan/">');
    return { slug, html };
  });
}
