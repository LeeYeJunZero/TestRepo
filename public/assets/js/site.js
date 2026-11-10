(() => {
  const body = document.body;
  const API = (body.dataset.api || '').replace(/\/$/, '');
  const IS_STATIC = body.dataset.static === '1';
  // 서버 모드: 같은 origin 으로 전송 / 정적 모드: API 주소가 있을 때만 전송
  const CAN_SEND = !IS_STATIC || !!API;
  const nav = document.querySelector('.nav');
  const toggle = document.querySelector('.nav-toggle');

  // 방문자 ID (정적 모드는 쿠키 대신 localStorage)
  let vid = '';
  try {
    vid = localStorage.getItem('vid') || '';
    if (!/^[a-f0-9]{32}$/.test(vid)) {
      vid = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('vid', vid);
    }
  } catch { vid = ''; }

  const post = (path, data) => {
    if (!CAN_SEND) return;
    fetch(API + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, mode: 'cors',
      body: JSON.stringify({ ...data, vid })
    }).catch(() => {});
  };

  // 1) 페이지 조회 (정적 모드만 — 서버 모드는 서버가 HTML 응답 시 직접 기록)
  if (body.dataset.track === '1') post('/api/track', { path: location.pathname + location.search, referrer: document.referrer });

  // 2) 과목 노출: 과목별 과정 블록이 화면에 40% 이상 보이면 페이지 로드당 1회
  const seen = new Set();
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const s = e.target.dataset.impression;
        if (e.isIntersecting && !seen.has(s)) { seen.add(s); post('/api/event', { kind: 'view', subject: s }); io.unobserve(e.target); }
      }
    }, { threshold: 0.4 });
    document.querySelectorAll('[data-impression]').forEach((el) => io.observe(el));
  }

  // 3) 클릭: 링크·버튼·FAQ. 과목 영역 안이면 해당 과목으로 집계
  document.addEventListener('click', (e) => {
    const el = e.target.closest('a, button, summary');
    if (!el || el.closest('.hp')) return;
    const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const subject = el.closest('[data-subject]')?.dataset.subject || '';
    post('/api/event', { kind: 'click', subject, label, href: el.getAttribute('href') || '' });
  }, { capture: true });

  // 모바일 메뉴
  toggle?.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('.nav-links a').forEach((a) => a.addEventListener('click', () => {
    nav.classList.remove('open'); toggle?.setAttribute('aria-expanded', 'false');
  }));

  // 스크롤 시 앱바 그림자
  const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // Material 리플
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.btn, .fab, .tab');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const size = Math.max(r.width, r.height);
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    btn.appendChild(s);
    setTimeout(() => s.remove(), 600);
  });

  // 과정 카드 → 폼 과정 자동 선택
  document.querySelectorAll('[data-course]').forEach((a) => a.addEventListener('click', () => {
    const sel = document.getElementById('f-subject');
    if (sel) sel.value = a.dataset.course;
  }));

  // 토스트
  const toastEl = document.querySelector('.toast');
  let tt;
  const toast = (msg) => {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('show'), 3200);
  };

  // 상담 신청
  const form = document.getElementById('applyForm');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = form.querySelector('.form-msg');
    const btn = form.querySelector('button[type=submit]');
    const data = Object.fromEntries(new FormData(form).entries());
    data.agree = form.agree.checked;
    msg.className = 'form-msg';
    if (!data.name.trim()) { msg.textContent = '이름을 입력해 주세요.'; msg.classList.add('err'); form.name.focus(); return; }
    if (!/^[0-9+\-() ]{8,20}$/.test(data.phone.trim())) { msg.textContent = '연락처를 정확히 입력해 주세요.'; msg.classList.add('err'); form.phone.focus(); return; }
    if (!data.agree) { msg.textContent = '개인정보 수집·이용에 동의해 주세요.'; msg.classList.add('err'); return; }
    // 정적 호스팅(GitHub Pages)은 상담 신청을 받지 않음
    if (IS_STATIC) { msg.textContent = '미리보기 사이트입니다. 상담 신청은 정식 사이트에서 가능합니다.'; msg.classList.add('err'); return; }
    btn.disabled = true; btn.textContent = '전송 중…';
    try {
      const res = await fetch('/api/inquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || '전송에 실패했습니다.');
      form.reset();
      msg.textContent = '상담 신청이 접수되었습니다. 곧 연락드리겠습니다!'; msg.classList.add('ok');
      toast('상담 신청 완료 ✓');
    } catch (err) {
      msg.textContent = err.message; msg.classList.add('err');
    } finally {
      btn.disabled = false; btn.textContent = '상담 신청하기';
    }
  });
})();
