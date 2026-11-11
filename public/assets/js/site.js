(() => {
  const body = document.body;
  const API = (body.dataset.api || '').replace(/\/$/, '');
  const IS_STATIC = body.dataset.static === '1';
  // 서버 모드: 같은 origin 으로 전송 / 정적 모드: API 주소가 있을 때만 전송
  const CAN_SEND = !IS_STATIC || !!API;
  const nav = document.querySelector('.nav');
  const toggle = document.querySelector('.nav-toggle');
  let leadBlocked = IS_STATIC && !API; // 접수 API 가 없으면 팝업을 띄우지 않음
  const motionOK = matchMedia('(prefers-reduced-motion: no-preference)').matches;

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
    const DONE_KEY = 'ft_lead_done';
    let picked = '';
    const showStep = (n) => {
      lead.dataset.at = n;
      lead.querySelectorAll('.lead-step').forEach((s) => (s.hidden = s.dataset.step !== String(n)));
      lead.querySelector('.lead-tile.picked')?.classList.remove('picked');
      lead.scrollTop = 0;
    };
    const openLead = () => { if (!lead.open) { showStep(1); lead.showModal(); } };
    // 접수 완료 축하 효과
    const burst = () => {
      if (!motionOK) return;
      const box = document.createElement('div');
      box.className = 'lead-burst';
      const colors = ['#6750a4', '#00897b', '#1565c0', '#f9a825', '#e91e63'];
      for (let i = 0; i < 48; i++) {
        const p = document.createElement('i');
        const a = Math.random() * Math.PI * 2, d = 110 + Math.random() * 230;
        p.style.cssText = `--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d + 90}px;--r:${Math.random() * 720 - 360}deg;background:${colors[i % colors.length]};animation-delay:${Math.random() * 120}ms`;
        box.appendChild(p);
      }
      lead.appendChild(box);
      setTimeout(() => box.remove(), 1700);
    };
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
        tile.classList.add('picked');
        setTimeout(() => showStep(2), motionOK ? 260 : 0);
      }
    });

    const addrBox = leadForm.querySelector('.lead-addr');
    const addrLayer = leadForm.querySelector('.addr-layer');
    const addrEmbed = leadForm.querySelector('.addr-embed');
    let addrZip = '';
    const clearAddr = () => {
      fieldOf('address').value = ''; fieldOf('addressDetail').value = '';
      addrZip = ''; addrLayer.hidden = true; addrEmbed.textContent = '';
    };

    // 대상에 해당하지 않는 항목은 숨김: 성인 → 학교, 화상수업 → 주소
    const syncFields = () => {
      const school = fieldOf('school');
      school.hidden = fieldOf('grade').value === '성인';
      addrBox.hidden = fieldOf('mode').value === '화상수업';
      if (school.hidden) school.value = '';
      if (addrBox.hidden) clearAddr();
    };
    leadForm.addEventListener('change', syncFields);

    // 도로명 주소: 카카오 우편번호 서비스에서 선택한 주소만 입력 (직접 입력 불가)
    // 주의: 이 스크립트 주소에 쿼리 파라미터를 붙이면 서비스가 경고창을 띄우고 멈춤
    const POSTCODE_SRC = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    const Postcode = () => window.kakao?.Postcode || window.daum?.Postcode;
    let postcodeReady = null;
    const loadPostcode = () => (postcodeReady ||= new Promise((ok, no) => {
      if (Postcode()) return ok();
      const failed = () => { postcodeReady = null; s.remove(); no(new Error('postcode')); };
      const s = document.createElement('script');
      s.src = POSTCODE_SRC;
      s.onload = () => (Postcode() ? ok() : failed());
      s.onerror = failed;
      document.head.appendChild(s);
    }));
    const openAddr = async () => {
      if (!addrLayer.hidden) { addrLayer.hidden = true; return; }
      try {
        await loadPostcode();
      } catch {
        fail('주소 검색을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      leadMsg.textContent = '';
      addrEmbed.textContent = '';
      addrLayer.hidden = false;
      new (Postcode())({
        width: '100%', height: '100%',
        oncomplete: (d) => {
          const road = d.roadAddress || d.autoRoadAddress;
          addrLayer.hidden = true;
          if (!road) { fail('도로명 주소가 있는 항목을 선택해 주세요.'); return; }
          addrZip = d.zonecode || '';
          fieldOf('address').value = road;
          fieldOf('addressDetail').focus();
        }
      }).embed(addrEmbed);
      addrLayer.scrollIntoView({ block: 'nearest' });
    };
    leadForm.querySelector('[data-addr-search]').addEventListener('click', openAddr);
    fieldOf('address').addEventListener('click', () => { if (addrLayer.hidden) openAddr(); });

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
      if (!addrBox.hidden && !val('address')) return fail('주소 검색으로 주소를 선택해 주세요.');
      if (!val('message')) return fail('특이사항을 입력해 주세요.', 'message');
      if (!data.agree) return fail('개인정보 수집·이용에 동의해 주세요.');
      // 우편번호 + 선택한 도로명 주소 + 상세 주소를 한 줄로 전송
      data.address = val('address') ? [addrZip && `[${addrZip}]`, val('address'), val('addressDetail')].filter(Boolean).join(' ') : '';
      delete data.addressDetail;
      // 운영 Worker 의 텔레그램 알림은 이름·연락처·학년·과목·문의 내용을 표시하므로 나머지 항목을 문의 내용에 함께 담음
      data.message = [['수업 방식', data.mode], ['학교', val('school')], ['주소', data.address], ['특이사항', val('message')]]
        .filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
      delete data.mode; delete data.school; delete data.address;
      const label = btn.textContent;
      btn.disabled = true; btn.textContent = '전송 중…';
      try {
        await sendInquiry(data);
        leadForm.reset(); clearAddr(); syncFields();
        showStep(3);
        burst();
        try { sessionStorage.setItem(DONE_KEY, '1'); } catch { /* 저장 불가 */ }
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

    // 사이트에 들어올 때마다 표시 (같은 탭에서 신청을 마친 뒤에는 제외)
    let done = false;
    try { done = !!sessionStorage.getItem(DONE_KEY); } catch { /* 저장 불가: 항상 표시 */ }
    // 학교별 과외 페이지의 카드에서 온 경우: 학교 이름을 미리 채우고 항상 표시
    const schoolParam = new URLSearchParams(location.search).get('school');
    if (schoolParam) fieldOf('school').value = schoolParam.slice(0, 60);
    if ((!done || schoolParam) && !leadBlocked) openLead();
  }

  // 학교별 과외: 학교 찾기 (시·군·구 페이지는 화면의 카드를 거르고, 전국·시·도 페이지는 목록을 내려받아 검색)
  const finder = document.querySelector('.school-finder');
  if (finder) {
    const input = finder.querySelector('input');
    const chips = [...finder.querySelectorAll('[data-kind]')];
    const pill = finder.querySelector('.kind-pill');
    const emptyNote = document.querySelector('.school-empty');
    const sections = [...document.querySelectorAll('.school-section')];
    const defaultBox = document.querySelector('[data-finder-default]');
    const resultsArea = document.querySelector('.school-results-area');
    const resultsGrid = document.querySelector('[data-finder-results]');
    const resultNote = document.querySelector('.school-result-note');
    const MAX_RESULTS = 60;
    let kind = 'all', timer, index = null, indexLoading = null;

    const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
    const paintName = (el, name, q) => {
      const i = q ? name.toLowerCase().indexOf(q) : -1;
      el.textContent = '';
      if (i < 0) { el.textContent = name; return; }
      const m = document.createElement('mark');
      m.textContent = name.slice(i, i + q.length);
      el.append(name.slice(0, i), m, name.slice(i + q.length));
    };
    const movePill = () => {
      const on = chips.find((c) => c.dataset.kind === kind);
      pill.style.width = `${on.offsetWidth}px`;
      pill.style.transform = `translateX(${on.offsetLeft}px)`;
    };

    const filterLocal = (q) => {
      let shown = 0;
      for (const sec of sections) {
        let n = 0;
        for (const card of sec.querySelectorAll('.school-card')) {
          const name = card.dataset.name;
          const ok = (kind === 'all' || card.dataset.kind === kind) && (!q || name.toLowerCase().includes(q) || card.dataset.short.toLowerCase().includes(q));
          card.hidden = !ok;
          if (ok) {
            card.style.setProperty('--d', `${Math.min(n, 8) * 24}ms`); // 필터 후 카드가 빠르게 차례로 등장
            n++;
            paintName(card.querySelector('.school-name'), name, q);
          }
        }
        sec.hidden = !n;
        shown += n;
        const badge = sec.querySelector('.count-badge');
        if (n && badge.textContent !== `${n}곳`) {
          badge.textContent = `${n}곳`;
          badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump');
        }
      }
      emptyNote.hidden = shown > 0;
    };

    const loadIndex = () => (indexLoading ||= fetch(finder.dataset.json).then((r) => r.json()).then((j) => { index = j; }).catch(() => { indexLoading = null; }));
    const KIND_LABEL = ['고등학교', '중학교', '초등학교', 'etc'];
    const filterRemote = async (q) => {
      if (!q && kind === 'all') { resultsArea.hidden = true; defaultBox.hidden = false; emptyNote.hidden = true; return; }
      if (!index) await loadIndex();
      if (!index) { defaultBox.hidden = true; resultsArea.hidden = true; emptyNote.textContent = '학교 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'; emptyNote.hidden = false; return; }
      if (norm(input.value) !== q) return; // 불러오는 사이 검색어가 바뀜
      const region = finder.dataset.region || '';
      const rows = index.s.filter(([name, k, c]) => (kind === 'all' || KIND_LABEL[k] === kind) && (!region || index.c[c][0] === region) && (!q || name.toLowerCase().includes(q)));
      resultsGrid.textContent = '';
      rows.slice(0, MAX_RESULTS).forEach(([name, k, c, code], i) => {
        const a = document.createElement('a');
        a.className = 'card school-card pop-in';
        a.href = `${finder.dataset.root}schools/${index.c[c][0]}/${encodeURI(index.c[c][2])}/${encodeURIComponent(code)}/`;
        a.style.setProperty('--d', `${Math.min(i, 12) * 28}ms`);
        const b = document.createElement('b'); b.className = 'school-name'; paintName(b, name, q);
        const s = document.createElement('span'); s.textContent = `${index.c[c][1]} · ${k === 3 ? '기타 학교' : KIND_LABEL[k]}`;
        a.append(b, s);
        resultsGrid.appendChild(a);
      });
      defaultBox.hidden = true;
      resultsArea.hidden = !rows.length;
      emptyNote.hidden = rows.length > 0;
      resultNote.textContent = rows.length > MAX_RESULTS ? `${rows.length.toLocaleString('ko-KR')}곳 중 ${MAX_RESULTS}곳을 보여드립니다. 이름을 더 입력해 주세요.` : `${rows.length.toLocaleString('ko-KR')}곳을 찾았습니다.`;
    };

    const apply = () => {
      const q = norm(input.value);
      if (sections.length) filterLocal(q); else filterRemote(q);
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(apply, 110); });
    if (!sections.length) input.addEventListener('focus', loadIndex, { once: true });
    chips.forEach((c) => c.addEventListener('click', () => {
      kind = c.dataset.kind;
      chips.forEach((x) => { const on = x === c; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
      movePill();
      apply();
    }));
    movePill();
    window.addEventListener('resize', movePill, { passive: true });
    document.fonts?.ready.then(movePill);
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
  if (motionOK) {
    // 첫 화면 제목: 글자가 차례로 올라오고 마지막 줄은 색이 흐름
    const h1 = document.querySelector('.hero h1');
    if (h1) {
      const lines = [...h1.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent);
      h1.setAttribute('aria-label', lines.join(' '));
      h1.textContent = '';
      let n = 0;
      lines.forEach((line, li) => {
        if (li) h1.appendChild(document.createElement('br'));
        if (li === lines.length - 1 && lines.length > 1) {
          const mask = document.createElement('span'), inner = document.createElement('span');
          mask.className = 'grad-mask'; inner.className = 'grad'; inner.textContent = line;
          mask.setAttribute('aria-hidden', 'true'); mask.appendChild(inner); h1.appendChild(mask);
          return;
        }
        line.split(' ').forEach((w, wi) => {
          if (wi) h1.appendChild(document.createTextNode(' '));
          const word = document.createElement('span');
          word.className = 'word'; word.setAttribute('aria-hidden', 'true');
          for (const ch of w) {
            const c = document.createElement('span');
            c.className = 'ch'; c.textContent = ch; c.style.setProperty('--n', n++);
            word.appendChild(c);
          }
          h1.appendChild(word);
        });
      });
    }

    // 첫 화면 배경: 떠다니는 수식·기호 (화면에 보일 때만 동작)
    const canvas = document.querySelector('.hero-canvas');
    const ctx = canvas?.getContext('2d');
    if (ctx) {
      const glyphs = ['∑', 'π', '√', 'x²', 'Aa', '</>', '÷', '∞', '{ }', '%', 'A+', 'y=ax'];
      const small = innerWidth < 720;
      let w = 0, h = 0, on = true, raf = 0, mx = 0, my = 0;
      const items = Array.from({ length: Math.max(6, Math.min(small ? 16 : 38, Math.round((canvas.clientWidth * canvas.clientHeight) / 22000))) }, (_, i) => ({
        g: glyphs[i % glyphs.length], x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7,
        s: 0.00035 + Math.random() * 0.0007, p: Math.random() * 6.28
      }));
      const color = getComputedStyle(body).getPropertyValue('--primary').trim() || '#6750a4';
      const size = () => {
        const dpr = Math.min(devicePixelRatio || 1, 2), r = canvas.getBoundingClientRect();
        w = r.width; h = r.height; canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      const draw = (t) => {
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = color; ctx.textAlign = 'center';
        for (const it of items) {
          it.y -= it.s * it.z; if (it.y < -0.08) { it.y = 1.08; it.x = Math.random(); }
          const x = it.x * w + Math.sin(t / 1600 + it.p) * 18 * it.z - mx * 34 * it.z;
          const y = it.y * h - my * 34 * it.z;
          ctx.globalAlpha = 0.04 + it.z * 0.11;
          ctx.font = `800 ${Math.round(14 + it.z * 26)}px system-ui, sans-serif`;
          ctx.fillText(it.g, x, y);
        }
        if (on) raf = requestAnimationFrame(draw);
      };
      size();
      window.addEventListener('resize', size, { passive: true });
      window.addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });
      new IntersectionObserver(([e]) => {
        const vis = e.isIntersecting;
        if (vis && !on) { on = true; raf = requestAnimationFrame(draw); } else if (!vis) { on = false; cancelAnimationFrame(raf); }
      }).observe(canvas);
      raf = requestAnimationFrame(draw);
    }

    // 스크롤 등장: 좌우에서 번갈아, 같은 줄의 카드는 순서대로
    const countUp = (el) => {
      const end = +el.dataset.count, t0 = performance.now();
      const step = (t) => {
        const p = Math.min((t - t0) / 1500, 1);
        el.textContent = Math.round(end * (1 - (1 - p) ** 3));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    if ('IntersectionObserver' in window) {
      const isSchoolPage = body.classList.contains('school-page'); // 카드가 많아 화면에 들어오기 전에 미리 표시
      const reveal = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) {
          e.target.classList.add('in'); reveal.unobserve(e.target);
          const num = e.target.querySelector?.('[data-count]');
          if (num) countUp(num);
        }
      }, { threshold: isSchoolPage ? 0.01 : 0.12, rootMargin: isSchoolPage ? '0px 0px 14% 0px' : '0px 0px -6% 0px' });
      document.querySelectorAll('main .section-title, main .section-sub, main .trial-badge, main .trial-ring, main .trial-cta, main .card:not(.apply-form), main .steps, main .school-section-head').forEach((el) => {
        const idx = [...el.parentElement.children].indexOf(el);
        el.style.setProperty('--d', `${Math.min(idx, 5) * 90}ms`);
        if (el.matches('.school-card')) el.style.setProperty('--d', `${(idx % 4) * 35}ms`);
        if (el.matches('.grid > .card')) el.style.setProperty('--x', idx % 2 ? '60px' : '-60px');
        el.classList.add('reveal');
        reveal.observe(el);
      });
    }

    // 섹션 뒤의 큰 글자
    const decos = [['#worries', '?', 0.22], ['#exams', 'A+', -0.18], ['#features', '1:1', 0.2]].flatMap(([sel, text, speed]) => {
      const sec = document.querySelector(sel);
      if (!sec) return [];
      const d = document.createElement('span');
      d.className = 'deco'; d.textContent = text; d.setAttribute('aria-hidden', 'true');
      sec.classList.add('has-deco'); sec.prepend(d);
      return [{ sec, d, speed }];
    });

    // 스크롤에 연동: 첫 화면 카드 펼침, 단계 진행선, 큰 글자 이동
    const heroEl = document.querySelector('.hero');
    const heroText = document.querySelector('.hero-text');
    const heroStack = document.querySelector('.hero-stack');
    const stepsEl = document.querySelector('.steps');
    const stepItems = stepsEl ? [...stepsEl.children] : [];
    let fxTick = false;
    const paintFx = () => {
      fxTick = false;
      const vh = innerHeight, y = scrollY;
      const hh = heroEl?.offsetHeight || 1;
      if (y < hh * 1.2) {
        const p = Math.min(y / hh, 1);
        if (heroText) { heroText.style.transform = `translateY(${(p * 80).toFixed(1)}px)`; heroText.style.opacity = (1 - p * 0.85).toFixed(3); }
        heroStack?.style.setProperty('--sp', p.toFixed(3));
      }
      if (stepsEl) {
        const top = stepsEl.getBoundingClientRect().top;
        const prog = Math.max(0, Math.min((vh * 0.9 - top) / (vh * 0.55), 1));
        stepsEl.style.setProperty('--prog', prog.toFixed(3));
        stepItems.forEach((s, i) => s.classList.toggle('lit', prog >= (i + 0.4) / stepItems.length));
      }
      for (const { sec, d, speed } of decos) {
        const r = sec.getBoundingClientRect();
        if (r.bottom > 0 && r.top < vh) d.style.transform = `translateY(${((r.top + r.height / 2 - vh / 2) * speed).toFixed(1)}px) rotate(${((r.top / vh) * 12).toFixed(2)}deg)`;
      }
    };
    window.addEventListener('scroll', () => { if (!fxTick) { fxTick = true; requestAnimationFrame(paintFx); } }, { passive: true });
    window.addEventListener('resize', paintFx, { passive: true });
    paintFx();

    // 첫 화면 문구: 타자기처럼 지우고 다시 입력
    const rotor = document.querySelector('[data-rotate]');
    const words = rotor?.dataset.rotate.split('|') || [];
    if (words.length > 1) {
      let w = 0, c = words[0].length, erasing = true;
      const type = () => {
        rotor.textContent = words[w].slice(0, c);
        if (erasing) {
          if (c > 0) { c--; setTimeout(type, 45); } else { erasing = false; w = (w + 1) % words.length; setTimeout(type, 180); }
        } else if (c < words[w].length) { c++; setTimeout(type, 85); } else { erasing = true; setTimeout(type, 1700); }
      };
      setTimeout(type, 1900);
    }

    // 마우스를 따라 움직이는 효과 (터치 기기 제외)
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
      const hero = document.querySelector('.hero');
      const stack = document.querySelector('.hero-stack');
      hero?.addEventListener('pointermove', (e) => {
        if (!stack) return;
        const r = hero.getBoundingClientRect();
        stack.style.setProperty('--px', `${((e.clientX - r.left) / r.width - 0.5) * 22}px`);
        stack.style.setProperty('--py', `${((e.clientY - r.top) / r.height - 0.5) * 22}px`);
      });
      document.querySelectorAll('.subject-card, .worry, .exam, .step, .school-card, .study-card, .fact-card').forEach((el) => {
        el.addEventListener('pointermove', (e) => {
          const r = el.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
          el.style.transform = `perspective(800px) rotateX(${(-y * 5).toFixed(2)}deg) rotateY(${(x * 5).toFixed(2)}deg) translateY(-4px)`;
        });
        el.addEventListener('pointerleave', () => { el.style.transform = ''; });
      });

      // 카드 위 빛 번짐
      document.querySelectorAll('main .card').forEach((el) => el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${e.clientX - r.left}px`);
        el.style.setProperty('--my', `${e.clientY - r.top}px`);
      }));

      // 신청 버튼이 마우스 쪽으로 끌려옴
      document.querySelectorAll('.hero-actions .btn-primary, .trial-cta .btn-primary').forEach((b) => {
        b.addEventListener('pointermove', (e) => {
          const r = b.getBoundingClientRect();
          b.style.transform = `translate(${((e.clientX - r.left - r.width / 2) * 0.22).toFixed(1)}px, ${((e.clientY - r.top - r.height / 2) * 0.32).toFixed(1)}px) scale(1.05)`;
        });
        b.addEventListener('pointerleave', () => { b.style.transform = ''; });
      });
    }
  }
})();
