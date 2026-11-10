// 각 하위 사이트의 초기 콘텐츠. 최초 실행 시 DB에 시드되며 이후에는 어드민에서 수정합니다.
export const SITE_KEYS = ['math', 'english', 'coding'];

export const THEME_LABEL = { flat: '플랫', material: '머티리얼', fluent: '플루언트' };

export const DEFAULT_SITES = {
  math: {
    theme: 'flat',
    status: 'live',
    data: {
      name: '셈터 수학과외',
      tagline: '개념부터 실전까지, 1:1 수학 과외',
      heroSymbol: '∑',
      heroTitle: '수학이 쉬워지는 순간,\n셈터에서 시작하세요',
      heroSub: '학생의 현재 수준을 진단하고, 개념 이해 → 유형 연습 → 실전 대비까지 단계별로 설계하는 맞춤형 1:1 수학 과외입니다.',
      notice: '신학기 상담 접수 중 · 첫 수업 진단 테스트 무료',
      color: '#16a085',
      phone: '010-0000-0000',
      kakao: '',
      email: 'math@example.com',
      area: '서울 전 지역 방문 / 온라인 화상',
      hours: '평일 14:00 – 22:00 · 주말 10:00 – 18:00',
      features: [
        { icon: '🎯', title: '수준 진단', desc: '첫 수업에서 진단 테스트로 취약 단원을 정확히 파악합니다.' },
        { icon: '🧭', title: '맞춤 커리큘럼', desc: '학교 진도와 내신 일정에 맞춘 개인별 학습 로드맵을 제공합니다.' },
        { icon: '📝', title: '오답 관리', desc: '틀린 문제를 유형별로 정리해 같은 실수를 반복하지 않게 합니다.' },
        { icon: '📊', title: '학부모 리포트', desc: '매월 학습 현황과 다음 달 계획을 리포트로 공유합니다.' }
      ],
      courses: [
        { name: '초등 사고력 수학', target: '초등 3–6학년', desc: '연산 정확도와 문장제 해석력을 키우는 기초 과정', price: '월 32만원 (주 2회)' },
        { name: '중등 내신 완성', target: '중학교 1–3학년', desc: '교과서 개념 정리와 학교별 기출 분석 중심 수업', price: '월 40만원 (주 2회)' },
        { name: '고등 수능 대비', target: '고등학교 1–3학년', desc: '수학Ⅰ·Ⅱ, 미적분, 확률과 통계 실전 문제풀이', price: '월 52만원 (주 2회)' }
      ],
      tutors: [
        { name: '대표 강사', role: '고등 수학 전담', bio: '수학교육 전공. 개념 설명과 서술형 대비에 강점이 있습니다.' },
        { name: '전임 강사', role: '중등 수학 전담', bio: '내신 기출 분석과 오답 관리 시스템을 담당합니다.' }
      ],
      faqs: [
        { q: '수업은 어떻게 진행되나요?', a: '방문 또는 화상으로 1:1 진행되며, 회당 90분이 기본입니다.' },
        { q: '첫 상담 비용이 있나요?', a: '상담과 첫 진단 테스트는 무료입니다.' },
        { q: '교재는 어떻게 하나요?', a: '학생 수준에 맞춰 시중 교재와 자체 프린트를 함께 사용합니다.' }
      ]
    }
  },

  english: {
    theme: 'material',
    status: 'live',
    data: {
      name: '링고브릿지 영어과외',
      tagline: '말하고, 읽고, 쓰는 진짜 영어',
      heroSymbol: 'Aa',
      heroTitle: '외우는 영어에서\n쓰는 영어로',
      heroSub: '회화·문법·독해·내신을 학생 목표에 맞게 조합하는 1:1 영어 과외. 수업 녹음과 주간 피드백으로 성장을 눈으로 확인하세요.',
      notice: '여름방학 집중반 모집 중',
      color: '#6750a4',
      phone: '010-0000-0000',
      kakao: '',
      email: 'english@example.com',
      area: '온라인 화상 수업 (전국)',
      hours: '매일 09:00 – 23:00',
      features: [
        { icon: '🗣️', title: '스피킹 중심', desc: '매 수업 20분 이상 실제 대화로 말하기 자신감을 키웁니다.' },
        { icon: '📚', title: '문법·독해 체계화', desc: '헷갈리는 문법을 구조로 이해하고 긴 지문도 빠르게 읽습니다.' },
        { icon: '🎧', title: '수업 녹음 제공', desc: '수업 내용을 다시 듣고 복습할 수 있도록 녹음본을 드립니다.' },
        { icon: '✅', title: '주간 피드백', desc: '매주 과제 첨삭과 발음 피드백을 정리해 보내드립니다.' }
      ],
      courses: [
        { name: '키즈 파닉스 & 회화', target: '초등 1–4학년', desc: '노래와 게임으로 시작하는 즐거운 첫 영어', price: '월 28만원 (주 2회)' },
        { name: '중·고등 내신 영어', target: '중1 – 고3', desc: '교과서 본문 분석, 서술형, 문법 집중 대비', price: '월 42만원 (주 2회)' },
        { name: '성인 비즈니스 회화', target: '대학생·직장인', desc: '이메일, 미팅, 프레젠테이션 실전 표현', price: '월 45만원 (주 2회)' }
      ],
      tutors: [
        { name: '대표 강사', role: '내신·문법', bio: '영어영문학 전공. 문법을 구조로 설명하는 수업을 진행합니다.' },
        { name: '회화 강사', role: '스피킹·발음', bio: '해외 거주 경험을 바탕으로 자연스러운 표현을 지도합니다.' }
      ],
      faqs: [
        { q: '화상 수업은 어떤 프로그램을 쓰나요?', a: 'Zoom 또는 Google Meet을 사용하며, 링크는 수업 전 문자로 보내드립니다.' },
        { q: '레벨테스트가 있나요?', a: '첫 상담 시 15분 무료 레벨테스트를 진행합니다.' },
        { q: '수업 시간 변경이 가능한가요?', a: '수업 24시간 전까지 요청하시면 변경 가능합니다.' }
      ]
    }
  },

  coding: {
    theme: 'fluent',
    status: 'live',
    data: {
      name: '코드멘토 코딩과외',
      tagline: '프로젝트로 배우는 1:1 코딩',
      heroSymbol: '</>',
      heroTitle: '직접 만들며 배우는\n진짜 프로그래밍',
      heroSub: '스크래치부터 파이썬, 웹 개발, 정보올림피아드까지. 학생이 만들고 싶은 것을 함께 완성하며 사고력과 문제 해결력을 키웁니다.',
      notice: '겨울방학 프로젝트반 사전 접수 중',
      color: '#0f6cbd',
      phone: '010-0000-0000',
      kakao: '',
      email: 'coding@example.com',
      area: '온라인 화상 / 수도권 방문',
      hours: '평일 15:00 – 22:00 · 토요일 10:00 – 17:00',
      features: [
        { icon: '🧩', title: '프로젝트 기반', desc: '매달 하나의 결과물(게임·앱·웹)을 완성하며 배웁니다.' },
        { icon: '🧠', title: '알고리즘 사고력', desc: '문제를 쪼개고 해결하는 컴퓨팅 사고력을 단계별로 훈련합니다.' },
        { icon: '💻', title: '실시간 코드 리뷰', desc: '화면 공유로 학생 코드를 함께 보며 즉시 피드백합니다.' },
        { icon: '🏆', title: '대회·자격 대비', desc: '정보올림피아드, 코딩 대회, 자격증 준비를 지원합니다.' }
      ],
      courses: [
        { name: '스크래치 & 엔트리', target: '초등 1–6학년', desc: '블록 코딩으로 게임과 애니메이션 만들기', price: '월 30만원 (주 1회 2시간)' },
        { name: '파이썬 기초 → 심화', target: '중·고등학생', desc: '문법, 자료구조, 미니 프로젝트, 데이터 분석 입문', price: '월 40만원 (주 2회)' },
        { name: '웹 개발 포트폴리오', target: '고등·대학생·성인', desc: 'HTML/CSS/JS부터 배포까지 나만의 웹서비스 완성', price: '월 50만원 (주 2회)' }
      ],
      tutors: [
        { name: '대표 멘토', role: '웹·파이썬', bio: '컴퓨터공학 전공, 현업 개발 경력을 바탕으로 실무형 수업을 진행합니다.' },
        { name: '알고리즘 멘토', role: '대회·알고리즘', bio: '알고리즘 문제 풀이와 대회 준비 과정을 담당합니다.' }
      ],
      faqs: [
        { q: '컴퓨터가 꼭 있어야 하나요?', a: '네, 노트북이나 데스크톱이 필요합니다. 필요한 프로그램 설치는 첫 수업에서 함께 합니다.' },
        { q: '전혀 처음인데 괜찮을까요?', a: '물론입니다. 수준 상담 후 가장 쉬운 단계부터 시작합니다.' },
        { q: '수업 결과물은 어떻게 되나요?', a: '완성한 프로젝트는 학생 계정에 저장되어 포트폴리오로 활용할 수 있습니다.' }
      ]
    }
  }
};

// 어드민에서 편집 가능한 필드 정의 (서버 검증 + 어드민 UI 양쪽에서 사용)
export const TEXT_FIELDS = {
  name: 60, tagline: 80, heroSymbol: 6, heroTitle: 120, heroSub: 400, notice: 120,
  color: 7, phone: 30, kakao: 200, email: 120, area: 120, hours: 120
};

export const LIST_FIELDS = {
  features: ['icon', 'title', 'desc'],
  courses: ['name', 'target', 'desc', 'price'],
  tutors: ['name', 'role', 'bio'],
  faqs: ['q', 'a']
};

export const STATUSES = ['live', 'maintenance', 'hidden'];
