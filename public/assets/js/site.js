(() => {
  const body = document.body;
  const API = (body.dataset.api || '').replace(/\/$/, '');
  const IS_STATIC = body.dataset.static === '1';
  const nav = document.querySelector('.nav');

  // 정적 호스팅(GitHub Pages)일 때 방문 기록을 API 서버로 전송
  if (body.dataset.track === '1' && API) {
    let vid = '';
    try {
      vid = localStorage.getItem('vid') || '';
      if (!/^[a-f0-9]{32}$/.test(vid)) {
        vid = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('vid', vid);
      }
    } catch { /* 저장소 차단 시 익명 */ }
    const payload = JSON.stringify({ site: body.dataset.site, path: location.pathname + location.search, referrer: document.referrer, vid });
    fetch(API + '/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true, mode: 'cors' }).catch(() => {});
  }
  const toggle = document.querySelector('.nav-toggle');

  // 클릭 추적 (버튼·링크) → 어드민 클릭률 집계. 서버 모드는 같은 origin, 정적 모드는 API 서버로 전송
  const CLICK_OK = !IS_STATIC || !!API;
  document.addEventListener('click', (e) => {
    if (!CLICK_OK) return;
    const el = e.target.closest('a, button, summary');
    if (!el || el.closest('.hp')) return;
    const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    let vid = '';
    try { vid = localStorage.getItem('vid') || ''; } catch {}
    fetch(API + '/api/click', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ site: body.dataset.site, label, href: el.getAttribute('href') || '', vid })
    }).catch(() => {});
  }, { capture: true });

  // 모바일 메뉴
  toggle?.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('.nav-links a').forEach((a) => a.addEventListener('click', () => {
    nav.classList.remove('open'); toggle?.setAttribute('aria-expanded', 'false');
  }));

  // 스크롤 시 앱바 그림자 (Material)
  const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // Material 리플
  if (body.classList.contains('theme-material')) {
    document.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('.btn, .fab');
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const size = Math.max(r.width, r.height);
      const s = document.createElement('span');
      s.className = 'ripple';
      s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      btn.appendChild(s);
      setTimeout(() => s.remove(), 600);
    });
  }

  // Fluent Reveal 하이라이트
  if (body.classList.contains('theme-fluent')) {
    document.addEventListener('pointermove', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    }, { passive: true });
  }

  // 과정 카드 → 폼 과정 자동 선택
  document.querySelectorAll('[data-subject]').forEach((a) => a.addEventListener('click', () => {
    const sel = document.getElementById('f-subject');
    if (sel) sel.value = a.dataset.subject;
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
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    data.agree = form.agree.checked;
    msg.className = 'form-msg';
    if (!data.name.trim()) { msg.textContent = '이름을 입력해 주세요.'; msg.classList.add('err'); form.name.focus(); return; }
    if (!/^[0-9+\-() ]{8,20}$/.test(data.phone.trim())) { msg.textContent = '연락처를 정확히 입력해 주세요.'; msg.classList.add('err'); form.phone.focus(); return; }
    if (!data.agree) { msg.textContent = '개인정보 수집·이용에 동의해 주세요.'; msg.classList.add('err'); return; }
    // 정적 호스팅(GitHub Pages)은 접속 기록만 수집하고 상담 신청은 받지 않음
    if (IS_STATIC) { msg.textContent = '미리보기 사이트입니다. 상담 신청은 정식 사이트에서 가능합니다.'; msg.classList.add('err'); return; }
    btn.disabled = true; btn.textContent = '전송 중…';
    try {
      const res = await fetch(API + '/api/inquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
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
