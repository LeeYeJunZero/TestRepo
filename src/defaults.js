// 퍼스트티쳐 단일 사이트 초기 콘텐츠. 최초 실행 시 DB에 시드되며 이후에는 어드민에서 수정합니다.
export const SITE_KEY = 'firstteacher';
export const SITE_KEYS = [SITE_KEY];

// 과목 (순위·클릭률 집계 단위). 키는 고정, 표시 내용은 어드민에서 수정
export const SUBJECTS = ['math', 'english', 'coding'];
export const SUBJECT_NAME = { math: '수학', english: '영어', coding: '코딩' };

export const DEFAULT_SITE = {
  theme: 'material',
  status: 'live',
  data: {
    name: '퍼스트티쳐',
    tagline: '수학 · 영어 · 코딩 1:1 맞춤 과외',
    heroSymbol: 'F',
    heroTitle: '처음 만나는 선생님이\n실력을 바꿉니다',
    heroSub: '수학·영어·코딩을 한 곳에서. 학생의 현재 수준을 진단하고, 목표에 맞는 커리큘럼으로 1:1 맞춤 수업을 설계합니다.',
    notice: '신규 상담 접수 중 · 첫 수업 진단 테스트 무료',
    color: '#6750a4',
    phone: '010-0000-0000',
    kakao: '',
    email: 'contact@firstteacher.co.kr',
    area: '서울·수도권 방문 / 전국 온라인 화상',
    hours: '평일 14:00 – 22:00 · 주말 10:00 – 18:00',
    features: [
      { icon: '🎯', title: '수준 진단', desc: '첫 수업에서 진단 테스트로 강점과 취약점을 정확히 파악합니다.' },
      { icon: '🧭', title: '1:1 맞춤 커리큘럼', desc: '학교 진도·시험 일정·목표에 맞춘 개인별 학습 로드맵을 제공합니다.' },
      { icon: '🔁', title: '과목 간 연계', desc: '수학·영어·코딩을 함께 수강하면 학습 일정을 통합 관리해 드립니다.' },
      { icon: '📊', title: '월간 리포트', desc: '매월 학습 현황과 다음 달 계획을 학부모님께 공유합니다.' }
    ],
    subjects: [
      { key: 'math', icon: '∑', name: '수학', tagline: '개념부터 실전까지', desc: '개념 이해 → 유형 연습 → 실전 대비까지 단계별로 설계하는 수학 수업. 오답 관리로 같은 실수를 반복하지 않게 합니다.' },
      { key: 'english', icon: 'Aa', name: '영어', tagline: '말하고, 읽고, 쓰는 진짜 영어', desc: '회화·문법·독해·내신을 학생 목표에 맞게 조합합니다. 수업 녹음과 주간 피드백으로 성장을 눈으로 확인하세요.' },
      { key: 'coding', icon: '</>', name: '코딩', tagline: '프로젝트로 배우는 프로그래밍', desc: '스크래치부터 파이썬, 웹 개발까지. 학생이 만들고 싶은 것을 함께 완성하며 사고력과 문제 해결력을 키웁니다.' }
    ],
    courses: [
      { subject: 'math', name: '초등 사고력 수학', target: '초등 3–6학년', desc: '연산 정확도와 문장제 해석력을 키우는 기초 과정', price: '월 32만원 (주 2회)' },
      { subject: 'math', name: '중등 내신 완성', target: '중학교 1–3학년', desc: '교과서 개념 정리와 학교별 기출 분석 중심 수업', price: '월 40만원 (주 2회)' },
      { subject: 'math', name: '고등 수능 대비', target: '고등학교 1–3학년', desc: '수학Ⅰ·Ⅱ, 미적분, 확률과 통계 실전 문제풀이', price: '월 52만원 (주 2회)' },
      { subject: 'english', name: '키즈 파닉스 & 회화', target: '초등 1–4학년', desc: '노래와 게임으로 시작하는 즐거운 첫 영어', price: '월 28만원 (주 2회)' },
      { subject: 'english', name: '중·고등 내신 영어', target: '중1 – 고3', desc: '교과서 본문 분석, 서술형, 문법 집중 대비', price: '월 42만원 (주 2회)' },
      { subject: 'english', name: '성인 비즈니스 회화', target: '대학생·직장인', desc: '이메일, 미팅, 프레젠테이션 실전 표현', price: '월 45만원 (주 2회)' },
      { subject: 'coding', name: '스크래치 & 엔트리', target: '초등 1–6학년', desc: '블록 코딩으로 게임과 애니메이션 만들기', price: '월 30만원 (주 1회 2시간)' },
      { subject: 'coding', name: '파이썬 기초 → 심화', target: '중·고등학생', desc: '문법, 자료구조, 미니 프로젝트, 데이터 분석 입문', price: '월 40만원 (주 2회)' },
      { subject: 'coding', name: '웹 개발 포트폴리오', target: '고등·대학생·성인', desc: 'HTML/CSS/JS부터 배포까지 나만의 웹서비스 완성', price: '월 50만원 (주 2회)' }
    ],
    tutors: [
      { subject: 'math', name: '수학 대표 강사', role: '중·고등 수학', bio: '수학교육 전공. 개념 설명과 서술형 대비에 강점이 있습니다.' },
      { subject: 'english', name: '영어 대표 강사', role: '내신·회화', bio: '영어영문학 전공. 문법을 구조로 설명하고 말하기 자신감을 키웁니다.' },
      { subject: 'coding', name: '코딩 대표 멘토', role: '파이썬·웹', bio: '컴퓨터공학 전공, 현업 개발 경력을 바탕으로 실무형 수업을 진행합니다.' }
    ],
    faqs: [
      { q: '수업은 어떻게 진행되나요?', a: '방문 또는 화상으로 1:1 진행되며, 회당 90분이 기본입니다.' },
      { q: '첫 상담 비용이 있나요?', a: '상담과 첫 진단 테스트는 무료입니다.' },
      { q: '여러 과목을 함께 들을 수 있나요?', a: '네. 2과목 이상 수강 시 일정을 통합 관리해 드립니다.' },
      { q: '수업 시간 변경이 가능한가요?', a: '수업 24시간 전까지 요청하시면 변경 가능합니다.' }
    ]
  }
};

// 어드민에서 편집 가능한 필드 정의 (서버 검증 + 어드민 UI 양쪽에서 사용)
export const TEXT_FIELDS = {
  name: 60, tagline: 80, heroSymbol: 6, heroTitle: 120, heroSub: 400, notice: 120,
  color: 7, phone: 30, kakao: 200, email: 120, area: 120, hours: 120
};

// 'subject' / 'key' 필드는 SUBJECTS 중 하나여야 함
export const LIST_FIELDS = {
  features: ['icon', 'title', 'desc'],
  subjects: ['key', 'icon', 'name', 'tagline', 'desc'],
  courses: ['subject', 'name', 'target', 'desc', 'price'],
  tutors: ['subject', 'name', 'role', 'bio'],
  faqs: ['q', 'a']
};
export const SUBJECT_FIELDS = new Set(['subject', 'key']);

export const STATUSES = ['live', 'maintenance'];
