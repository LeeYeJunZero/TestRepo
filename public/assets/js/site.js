(() => {
  const body = document.body;
  const API = (body.dataset.api || '').replace(/\/$/, '');
  const IS_STATIC = body.dataset.static === '1';
  // 서버 모드: 같은 origin 으로 전송 / 정적 모드: API 주소가 있을 때만 전송
  const CAN_SEND = !IS_STATIC || !!API;
  const nav = document.querySelector('.nav');
  const toggle = document.querySelector('.nav-toggle');
  let leadBlocked = IS_STATIC && !API; // 접수 API 가 없으면 팝업을 띄우지 않음

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

  // 0) 공지·점검 상태 (텔레그램 /notice, /maint → 재배포 없이 즉시 반영)
  if (IS_STATIC && API) {
    fetch(API + '/api/site', { mode: 'cors', cache: 'no-store' }).then((r) => r.json()).then((s) => {
      if (typeof s.notice === 'string') {
        let bar = document.querySelector('.notice');
        if (!s.notice) bar?.remove();
        else {
          if (!bar) { bar = document.createElement('div'); bar.className = 'notice'; bar.setAttribute('role', 'status'); bar.innerHTML = '<div class="wrap"></div>'; body.prepend(bar); }
          bar.querySelector('.wrap').textContent = s.notice;
        }
      }
      if (s.status === 'maintenance') {
        const main = document.querySelector('main');
        const el = document.createElement('div');
        el.className = 'maint-banner card';
        el.innerHTML = '<b>🛠 사이트 점검 중입니다</b><p>잠시 후 다시 방문해 주세요. 상담 문의는 전화로 부탁드립니다.</p>';
        main?.prepend(el);
        document.querySelectorAll('#applyForm, #leadForm').forEach((f) => f.querySelectorAll('input, select, textarea, button').forEach((x) => (x.disabled = true)));
        // 점검 중에는 팝업을 띄우지 않고, 신청 버튼은 하단 안내로 이동
        leadBlocked = true;
        document.getElementById('leadDialog')?.close();
      }
    }).catch(() => {});
  }

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

  const sendInquiry = async (data) => {
    const res = await fetch(API + '/api/inquiry', { method: 'POST', mode: 'cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || '전송에 실패했습니다.');
  };
  // 네트워크 오류(서버 꺼짐 등)는 TypeError
  const sendError = (err) => (err instanceof TypeError ? '접수 서버에 연결할 수 없습니다. 잠시 후 다시 시도하거나 전화로 문의해 주세요.' : err.message);

  // 첫 방문 팝업: 과목 선택 → 인적사항 → 완료
  const lead = document.getElementById('leadDialog');
  const leadForm = document.getElementById('leadForm');
  if (lead && leadForm) {
    const POPUP_KEY = 'ft_lead_popup_seen';
    let picked = '';
    const showStep = (n) => lead.querySelectorAll('.lead-step').forEach((s) => (s.hidden = s.dataset.step !== String(n)));
    const openLead = () => { if (!lead.open) { showStep(1); lead.showModal(); } };
    const fieldOf = (n) => leadForm.elements.namedItem(n);
    const leadMsg = leadForm.querySelector('.form-msg');
    const fail = (text, focusName) => {
      leadMsg.textContent = text; leadMsg.className = 'form-msg err';
      if (focusName) fieldOf(focusName).focus?.();
    };

    lead.addEventListener('click', (e) => {
      if (e.target === lead || e.target.closest('[data-lead-close]')) { lead.close(); return; }
      if (e.target.closest('[data-lead-back]')) { showStep(1); return; }
      const tile = e.target.closest('[data-lead-pick]');
      if (tile) {
        picked = tile.dataset.leadPick;
        lead.querySelector('[data-lead-picked]').textContent = picked;
        leadMsg.textContent = '';
        showStep(2);
      }
    });

    // 대상에 해당하지 않는 항목은 숨김: 성인 → 학교, 화상수업 → 주소
    const syncFields = () => {
      const school = fieldOf('school'), address = fieldOf('address');
      school.hidden = fieldOf('grade').value === '성인';
      address.hidden = fieldOf('mode').value === '화상수업';
      if (school.hidden) school.value = '';
      if (address.hidden) address.value = '';
    };
    leadForm.addEventListener('change', syncFields);

    leadForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = leadForm.querySelector('button[type=submit]');
      const data = Object.fromEntries(new FormData(leadForm).entries());
      data.subject = picked;
      data.agree = fieldOf('agree').checked;
      const val = (n) => String(data[n] || '').trim();
      leadMsg.className = 'form-msg'; leadMsg.textContent = '';
      if (!val('grade')) return fail('학년을 선택해 주세요.');
      if (!val('mode')) return fail('수업 방식을 선택해 주세요.');
      if (!val('name')) return fail('이름을 입력해 주세요.', 'name');
      if (!/^[0-9+\-() ]{8,20}$/.test(val('phone'))) return fail('연락처를 정확히 입력해 주세요.', 'phone');
      if (!fieldOf('school').hidden && !val('school')) return fail('학교를 입력해 주세요.', 'school');
      if (!fieldOf('address').hidden && !val('address')) return fail('주소를 입력해 주세요.', 'address');
      if (!val('message')) return fail('특이사항을 입력해 주세요.', 'message');
      if (!data.agree) return fail('개인정보 수집·이용에 동의해 주세요.');
      const label = btn.textContent;
      btn.disabled = true; btn.textContent = '전송 중…';
      try {
        await sendInquiry(data);
        leadForm.reset(); syncFields();
        showStep(3);
      } catch (err) {
        fail(sendError(err));
      } finally {
        btn.disabled = false; btn.textContent = label;
      }
    });

    document.querySelectorAll('[data-lead-open]').forEach((a) => a.addEventListener('click', (e) => {
      if (leadBlocked) return; // 점검 중 등은 기본 동작(하단 #apply 이동)
      e.preventDefault();
      openLead();
    }));

    // 첫 방문에만 자동으로 띄움 (닫아도 다시 띄우지 않음)
    let seen = false;
    try { seen = !!localStorage.getItem(POPUP_KEY); localStorage.setItem(POPUP_KEY, '1'); } catch { /* 저장 불가: 방문마다 표시 */ }
    if (!seen && !leadBlocked) openLead();
  }

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
    // 정적 호스팅(GitHub Pages)은 API 서버(로컬 PC 터널/VPS)가 연결된 경우에만 접수
    if (IS_STATIC && !API) { msg.textContent = '지금은 온라인 접수가 어렵습니다. 전화로 문의해 주세요.'; msg.classList.add('err'); return; }
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = '전송 중…';
    try {
      await sendInquiry(data);
      form.reset();
      msg.textContent = '상담 신청이 접수되었습니다. 곧 연락드리겠습니다!'; msg.classList.add('ok');
      toast('상담 신청 완료 ✓');
    } catch (err) {
      msg.textContent = sendError(err);
      msg.classList.add('err');
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  });

  // ───── 시선 유도 효과 ─────
  // 스크롤 진행 표시줄
  const bar = document.querySelector('.scroll-bar');
  let barTick = false;
  const paintBar = () => {
    barTick = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    if (bar) bar.style.transform = `scaleX(${max > 0 ? Math.min(scrollY / max, 1) : 0})`;
  };
  window.addEventListener('scroll', () => { if (!barTick) { barTick = true; requestAnimationFrame(paintBar); } }, { passive: true });
  paintBar();

  // 현재 보고 있는 섹션을 메뉴에 표시
  if ('IntersectionObserver' in window) {
    const links = new Map([...document.querySelectorAll('.nav-links a[href^="#"]:not(.btn)')].map((a) => [a.getAttribute('href').slice(1), a]));
    const spy = new IntersectionObserver((entries) => {
      for (const e of entries) links.get(e.target.id)?.classList.toggle('active', e.isIntersecting);
    }, { rootMargin: '-45% 0px -50% 0px' });
    links.forEach((_, id) => { const s = document.getElementById(id); if (s) spy.observe(s); });
  }

  // 아래 효과는 '동작 줄이기' 설정 방문자에게는 적용하지 않음
  if (matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    // 스크롤 등장: 같은 줄의 카드는 순서대로
    if ('IntersectionObserver' in window) {
      const reveal = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); reveal.unobserve(e.target); }
      }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
      document.querySelectorAll('main .section-title, main .section-sub, main .trial-badge, main .trial-cta, main .card:not(.apply-form), main .steps').forEach((el) => {
        el.style.setProperty('--d', `${Math.min([...el.parentElement.children].indexOf(el), 5) * 90}ms`);
        el.classList.add('reveal');
        reveal.observe(el);
      });
    }

    // 첫 화면 문구 교체
    const rotor = document.querySelector('[data-rotate]');
    const words = rotor?.dataset.rotate.split('|') || [];
    if (words.length > 1) {
      let i = 0;
      setInterval(() => {
        rotor.classList.add('out');
        setTimeout(() => { i = (i + 1) % words.length; rotor.textContent = words[i]; rotor.classList.remove('out'); }, 260);
      }, 2400);
    }

    // 마우스를 따라 움직이는 효과 (터치 기기 제외)
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
      const hero = document.querySelector('.hero');
      const stack = document.querySelector('.hero-stack');
      hero?.addEventListener('pointermove', (e) => {
        const r = hero.getBoundingClientRect();
        stack.style.setProperty('--px', `${((e.clientX - r.left) / r.width - 0.5) * 22}px`);
        stack.style.setProperty('--py', `${((e.clientY - r.top) / r.height - 0.5) * 22}px`);
      });
      document.querySelectorAll('.subject-card, .worry, .exam, .step').forEach((el) => {
        el.addEventListener('pointermove', (e) => {
          const r = el.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
          el.style.transform = `perspective(800px) rotateX(${(-y * 5).toFixed(2)}deg) rotateY(${(x * 5).toFixed(2)}deg) translateY(-4px)`;
        });
        el.addEventListener('pointerleave', () => { el.style.transform = ''; });
      });
    }
  }
})();
