(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  let SUBJ = { math: '수학', english: '영어', coding: '코딩' };
  const COLOR = { math: 'var(--c-math)', english: 'var(--c-english)', coding: 'var(--c-coding)', pv: '#98a2b3' };
  const STATUS_LABEL = { live: '운영 중', maintenance: '점검 중' };
  const INQ_LABEL = { new: '신규', contacted: '연락완료', enrolled: '등록', closed: '종료' };
  const LIST_LABEL = {
    features: ['특징', { icon: '아이콘', title: '제목', desc: '설명' }],
    subjects: ['과목 소개', { key: '과목', icon: '아이콘', name: '표시 이름', tagline: '한 줄 소개', desc: '설명' }],
    courses: ['수업 과정', { subject: '과목', name: '과정명', target: '대상', desc: '설명', price: '수강료' }],
    tutors: ['선생님', { subject: '과목', name: '이름', role: '담당', bio: '소개' }],
    faqs: ['FAQ', { q: '질문', a: '답변' }]
  };
  const TEXT_LABEL = {
    name: '사이트 이름', tagline: '한 줄 소개', heroSymbol: '로고 글자', color: '대표 색상',
    heroTitle: '메인 타이틀 (줄바꿈 가능)', heroSub: '메인 설명', notice: '상단 공지 (비우면 숨김)',
    phone: '전화번호', email: '이메일', kakao: '카카오톡 오픈채팅 URL', area: '수업 지역', hours: '상담 시간'
  };
  const tag = (s) => s ? `<span class="tag"><i class="dot" style="background:${COLOR[s]}"></i>${esc(SUBJ[s] || s)}</span>` : '<span class="muted">공통</span>';
  const tags = (arr) => arr?.length ? arr.map(tag).join(' ') : '<span class="muted">–</span>';

  let toastT;
  function toast(msg, error) {
    const t = $('#toast');
    t.textContent = msg; t.classList.toggle('error', !!error); t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function api(path, opts = {}) {
    const res = await fetch('/api/admin' + path, {
      ...opts,
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin'
    });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login') { showLogin(); throw new Error(j.error || '로그인이 필요합니다.'); }
    if (!res.ok) throw new Error(j.error || `요청 실패 (${res.status})`);
    return j;
  }

  // ───────── 인증 ─────────
  function showLogin() { $('#app').hidden = true; $('#login').hidden = false; $('#loginForm [name=password]').focus(); }
  let booted = false;
  async function boot() {
    try {
      const me = await api('/me');
      SUBJ = me.subjectNames;
      $('#login').hidden = true; $('#app').hidden = false;
      $('#siteLink').href = me.siteUrl;
      if (!booted) {
        $('#eSubj').insertAdjacentHTML('beforeend', me.subjects.map((k) => `<option value="${k}">${esc(SUBJ[k])}</option>`).join(''));
        booted = true;
      }
      go(location.hash.slice(1) || 'dash');
    } catch { /* showLogin 호출됨 */ }
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#loginErr').textContent = '';
    try { await api('/login', { method: 'POST', body: { password: e.target.password.value } }); e.target.reset(); boot(); }
    catch (err) { $('#loginErr').textContent = err.message; }
  });
  $('#logout').addEventListener('click', async () => { await api('/logout', { method: 'POST', body: {} }).catch(() => {}); showLogin(); });

  // ───────── 탭 ─────────
  const loaders = { dash: loadDash, visits: loadLog, inq: loadInq, site: loadSite };
  function go(tab) {
    if (!loaders[tab]) tab = 'dash';
    $$('.side-nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== (tab === 'visits' ? 'visits' : tab)));
    history.replaceState(null, '', '#' + tab);
    loaders[tab]().catch((e) => toast(e.message, true));
  }
  $$('.side-nav button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));

  // ───────── 대시보드 ─────────
  let days = 7;
  $('#daysSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    days = +b.dataset.days;
    $$('#daysSeg button').forEach((x) => x.classList.toggle('on', x === b));
    loadStats().catch((e) => toast(e.message, true));
  });

  async function loadDash() { await Promise.all([loadRanking(), loadStats()]); }

  async function loadRanking() {
    const r = await api('/ranking');
    const maxV = Math.max(1, ...r.rows.map((x) => x.views));
    const row = (k) => r.rows.find((x) => x.subject === k);
    const hl = (icon, title, k, val) => `<div><span class="trophy">${icon}</span><div><span>${title}</span><b>${k ? `${esc(SUBJ[k])} · ${val(row(k))}` : '아직 기록 없음'}</b></div></div>`;
    $('#rankHl').innerHTML =
      hl('👑', '최다 조회 과목', r.mostViewed, (x) => `노출 ${x.views.toLocaleString()}회`) +
      hl('🖱️', '최다 클릭 과목', r.mostClicked, (x) => `클릭 ${x.clicks.toLocaleString()}회`) +
      hl('🎯', '최고 클릭률 과목', r.bestCtr, (x) => `${x.ctr}%`) +
      `<div><span class="trophy">🌐</span><div><span>전체 페이지 조회 (누적)</span><b>${r.page.pv.toLocaleString()}회 · 방문자 ${r.page.uv.toLocaleString()}명</b></div></div>`;
    $('#rankTable').innerHTML = `<thead><tr><th>순위</th><th>과목</th><th class="num">노출(조회)</th><th class="num">본 방문자</th><th class="num">클릭</th><th class="num">클릭률</th><th>많이 클릭된 항목</th><th>최근</th></tr></thead><tbody>
      ${r.rows.map((x) => `<tr>
        <td><span class="rank-no ${x.rank === 1 && x.views ? 'r1' : ''}">${x.rank}</span></td>
        <td>${tag(x.subject)}<div class="bar"><i style="width:${(x.views / maxV) * 100}%;background:${COLOR[x.subject]}"></i></div></td>
        <td class="num"><b>${x.views.toLocaleString()}</b></td>
        <td class="num">${x.viewers.toLocaleString()}</td>
        <td class="num">${x.clicks.toLocaleString()}</td>
        <td class="num"><b>${x.ctr}%</b></td>
        <td><div class="top-clicks">${x.topClicks.map((t) => `<span class="pill">${esc(t.label || '(이름 없음)')} ${t.n}</span>`).join('') || '<span class="muted">–</span>'}</div></td>
        <td>${x.lastAt ? esc(x.lastAt.slice(5, 16)) : '–'}</td></tr>`).join('')}</tbody>`;
  }

  async function loadStats() {
    const s = await api('/stats?days=' + days);
    const t = s.totals;
    const badge = $('#pendingBadge'); badge.hidden = !s.pendingAll; badge.textContent = s.pendingAll;
    $('#kpis').innerHTML = [
      ['오늘 페이지 조회', t.today_pv || 0, '오늘 0시 이후'],
      [`페이지 조회 (${days}일)`, t.pv || 0, `방문자 ${(t.uv || 0).toLocaleString()}명`],
      ['모바일 비율', t.pv ? Math.round(((t.mobile || 0) / t.pv) * 100) + '%' : '–', `${days}일 기준`],
      [`상담 신청 (${days}일)`, s.inqTotal, `미처리 ${s.pendingAll}건`]
    ].map(([l, v, sub]) => `<div class="kpi"><span>${l}</span><b>${typeof v === 'number' ? v.toLocaleString() : v}</b><small>${sub}</small></div>`).join('');

    const dates = [];
    const now = new Date(Date.now() + 9 * 3600e3);
    for (let i = s.days - 1; i >= 0; i--) dates.push(new Date(now - i * 86400e3).toISOString().slice(0, 10));
    const series = [{ key: 'pv', name: '페이지 조회', values: dates.map((d) => s.dailyPv.find((r) => r.d === d)?.n || 0) }]
      .concat(Object.keys(SUBJ).map((k) => ({ key: k, name: `${SUBJ[k]} 노출`, values: dates.map((d) => s.dailySubj.find((r) => r.d === d && r.subject === k)?.n || 0) })));
    lineChart($('#chartDaily'), dates, series);
    $('#legend').innerHTML = series.map((x) => `<span><i class="dot" style="background:${COLOR[x.key]}"></i>${esc(x.name)}</span>`).join('');
    barChart($('#chartHourly'), Array.from({ length: 24 }, (_, h) => s.hourly.find((r) => r.h === h)?.n || 0));

    $('#subjTable').innerHTML = `<table class="tbl"><thead><tr><th>과목</th><th class="num">노출</th><th class="num">클릭</th><th class="num">클릭률</th></tr></thead><tbody>
      ${s.subjects.map((x) => `<tr><td>${tag(x.subject)}</td><td class="num">${x.views.toLocaleString()}</td><td class="num">${x.clicks.toLocaleString()}</td><td class="num">${x.ctr}%</td></tr>`).join('')}</tbody></table>`;
    $('#refTable').innerHTML = s.topReferrers.length
      ? `<table class="tbl"><thead><tr><th>유입 도메인</th><th class="num">방문</th></tr></thead><tbody>${s.topReferrers.map((r) => `<tr><td>${esc(r.host)}</td><td class="num">${r.n}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">외부 유입 기록이 없습니다 (직접 접속만 있음)</div>';
  }

  function attachTip(el, svg, points) {
    let tip = el.querySelector('.tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; el.appendChild(tip); }
    svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 600;
      let best = points[0];
      for (const p of points) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
      if (!best) return;
      tip.hidden = false; tip.innerHTML = best.html;
      tip.style.left = (best.x / 600) * r.width + 'px';
      tip.style.top = (best.y / 220) * r.height + 'px';
    });
    svg.addEventListener('pointerleave', () => (tip.hidden = true));
  }
  function lineChart(el, labels, series) {
    const W = 600, H = 220, P = { l: 36, r: 10, t: 10, b: 26 };
    const max = Math.max(1, ...series.flatMap((s) => s.values));
    const nice = Math.ceil(max / 4) * 4 || 4;
    const x = (i) => P.l + (labels.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (labels.length - 1));
    const y = (v) => H - P.b - (v / nice) * (H - P.t - P.b);
    const grid = [0, 1, 2, 3, 4].map((i) => { const v = (nice / 4) * i; return `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="#eef0f3"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#98a2b3">${v}</text>`; }).join('');
    const step = Math.ceil(labels.length / 8);
    const xl = labels.map((d, i) => (i % step === 0 || i === labels.length - 1) ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#98a2b3">${d.slice(5)}</text>` : '').join('');
    const lines = series.map((s) => `<polyline fill="none" stroke="${COLOR[s.key]}" stroke-width="${s.key === 'pv' ? 2 : 2.5}" ${s.key === 'pv' ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round" points="${s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>` +
      (labels.length <= 31 ? s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="2.5" fill="${COLOR[s.key]}"/>`).join('') : '')).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}${xl}${lines}</svg>`;
    attachTip(el, el.querySelector('svg'), labels.map((d, i) => ({
      x: x(i), y: y(Math.max(...series.map((s) => s.values[i]))),
      html: `<b>${d}</b><br>` + series.map((s) => `${esc(s.name)}: ${s.values[i]}`).join('<br>')
    })));
  }
  function barChart(el, values) {
    const W = 600, H = 220, P = { l: 36, r: 10, t: 10, b: 26 };
    const max = Math.max(1, ...values); const nice = Math.ceil(max / 4) * 4 || 4;
    const bw = (W - P.l - P.r) / 24;
    const y = (v) => H - P.b - (v / nice) * (H - P.t - P.b);
    const grid = [0, 2, 4].map((i) => { const v = (nice / 4) * i; return `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="#eef0f3"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#98a2b3">${v}</text>`; }).join('');
    const bars = values.map((v, h) => `<rect x="${P.l + h * bw + 2}" y="${y(v)}" width="${bw - 4}" height="${H - P.b - y(v)}" rx="3" fill="#6750a4" opacity="${v ? 0.85 : 0.15}"/>` +
      (h % 3 === 0 ? `<text x="${P.l + h * bw + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#98a2b3">${h}시</text>` : '')).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}${bars}</svg>`;
    attachTip(el, el.querySelector('svg'), values.map((v, h) => ({ x: P.l + h * bw + bw / 2, y: y(v), html: `${h}시 – ${v}회` })));
  }

  // ───────── 접속 기록 (페이지 접속 / 과목 클릭) ─────────
  let logMode = 'visits', vOffset = 0, vTimer; const V_LIMIT = 50;
  $('#logSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    logMode = b.dataset.log; vOffset = 0;
    $$('#logSeg button').forEach((x) => x.classList.toggle('on', x === b));
    $('#vTools').hidden = logMode !== 'visits'; $('#eTools').hidden = logMode !== 'events';
    loadLog().catch((e) => toast(e.message, true));
  });
  const when = (ts) => `<td>${esc(ts.slice(0, 10))}</td><td class="time-big">${esc(ts.slice(11, 16))}</td>`;
  async function loadLog() {
    let total, html;
    if (logMode === 'visits') {
      const q = new URLSearchParams({ limit: V_LIMIT, offset: vOffset, q: $('#vQ').value.trim(), bots: $('#vBots').checked ? '1' : '' });
      const r = await api('/visits?' + q); total = r.total;
      html = `<thead><tr><th>날짜</th><th>시각 (KST)</th><th>접속 경로</th><th>본 과목</th><th>클릭한 과목</th><th>IP</th><th>유입경로</th><th>기기</th><th>브라우저</th></tr></thead><tbody>
        ${r.rows.length ? r.rows.map((x) => `<tr>${when(x.created_at)}<td>${esc(x.path)}</td><td>${tags(x.viewed)}</td><td>${tags(x.clicked)}</td><td>${esc(x.ip)}</td>
          <td class="ref" title="${esc(x.referrer)}">${esc(x.referrer) || '<span class="pill">직접</span>'}</td>
          <td>${x.bot ? '<span class="pill bot">봇</span>' : x.mobile ? '<span class="pill mobile">모바일</span>' : '<span class="pill">PC</span>'}</td>
          <td class="ua" title="${esc(x.ua)}">${esc(x.ua)}</td></tr>`).join('') : '<tr><td colspan="9" class="empty">기록이 없습니다</td></tr>'}</tbody>`;
    } else {
      const q = new URLSearchParams({ limit: V_LIMIT, offset: vOffset, subject: $('#eSubj').value });
      const r = await api('/events?' + q); total = r.total;
      html = `<thead><tr><th>날짜</th><th>시각 (KST)</th><th>과목</th><th>클릭한 항목</th><th>링크</th><th>IP</th></tr></thead><tbody>
        ${r.rows.length ? r.rows.map((x) => `<tr>${when(x.created_at)}<td>${tag(x.subject)}</td><td>${esc(x.label)}</td><td>${esc(x.href)}</td><td>${esc(x.ip)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">기록이 없습니다</td></tr>'}</tbody>`;
    }
    $('#vTable').innerHTML = html;
    $('#vInfo').textContent = total ? `${vOffset + 1}–${Math.min(vOffset + V_LIMIT, total)} / 총 ${total.toLocaleString()}건` : '0건';
    $('#vPrev').disabled = vOffset === 0;
    $('#vNext').disabled = vOffset + V_LIMIT >= total;
  }
  const reloadLog = () => { vOffset = 0; loadLog().catch((e) => toast(e.message, true)); };
  $('#vBots').addEventListener('change', reloadLog);
  $('#eSubj').addEventListener('change', reloadLog);
  $('#vQ').addEventListener('input', () => { clearTimeout(vTimer); vTimer = setTimeout(reloadLog, 300); });
  $('#vPrev').addEventListener('click', () => { vOffset = Math.max(0, vOffset - V_LIMIT); loadLog(); });
  $('#vNext').addEventListener('click', () => { vOffset += V_LIMIT; loadLog(); });
  $('#vPurge').addEventListener('click', async () => {
    if (!confirm('30일보다 오래된 접속·클릭 기록을 삭제할까요? 되돌릴 수 없습니다.')) return;
    const r = await api('/visits/purge', { method: 'POST', body: { olderThanDays: 30 } });
    toast(`${r.deleted}건 삭제됨`); reloadLog();
  });

  // ───────── 상담 신청 ─────────
  async function loadInq() {
    const { rows } = await api('/inquiries?' + new URLSearchParams({ status: $('#iStatus').value }));
    $('#inqList').innerHTML = rows.length ? rows.map((r) => `
      <article class="inq ${r.status === 'new' ? 'is-new' : ''}" data-id="${r.id}">
        <div>
          <div class="inq-head"><b>${esc(r.name)}</b><span class="st-${r.status}">● ${INQ_LABEL[r.status]}</span></div>
          <div class="inq-meta">
            <a href="tel:${esc(r.phone.replace(/[^0-9+]/g, ''))}">📞 ${esc(r.phone)}</a>
            <span>${esc(r.grade)}</span>${r.subject ? `<span>${esc(r.subject)}</span>` : ''}<span>${esc(r.created_at)}</span>
          </div>
          ${r.message ? `<p class="inq-msg">${esc(r.message)}</p>` : ''}
        </div>
        <div class="inq-side">
          <select class="i-status">${Object.entries(INQ_LABEL).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <textarea class="i-memo" rows="2" placeholder="상담 메모">${esc(r.memo)}</textarea>
          <div class="row"><button class="btn subtle i-save">저장</button><button class="btn danger i-del">삭제</button></div>
        </div>
      </article>`).join('') : '<div class="panel empty">상담 신청이 없습니다</div>';
  }
  $('#iStatus').addEventListener('change', () => loadInq());
  $('#inqList').addEventListener('click', async (e) => {
    const card = e.target.closest('.inq'); if (!card) return;
    const id = card.dataset.id;
    try {
      if (e.target.closest('.i-save')) {
        await api('/inquiries/' + id, { method: 'PATCH', body: { status: $('.i-status', card).value, memo: $('.i-memo', card).value } });
        toast('저장했습니다'); loadInq(); refreshBadge();
      } else if (e.target.closest('.i-del')) {
        if (!confirm('이 상담 신청을 삭제할까요?')) return;
        await api('/inquiries/' + id, { method: 'DELETE' });
        toast('삭제했습니다'); loadInq(); refreshBadge();
      }
    } catch (err) { toast(err.message, true); }
  });
  async function refreshBadge() {
    const s = await api('/stats?days=1').catch(() => null);
    if (s) { const b = $('#pendingBadge'); b.hidden = !s.pendingAll; b.textContent = s.pendingAll; }
  }

  // ───────── 사이트 관리 ─────────
  let site = null, fields = null;
  async function loadSite() {
    const r = await api('/site');
    site = r.site; fields = r.fields;
    renderSiteForm();
  }
  function listEditor(name, items) {
    const [title, labels] = LIST_LABEL[name];
    const keys = fields.lists[name];
    const longKeys = new Set(['desc', 'bio', 'a']);
    const subjSel = (k, v) => `<select data-k="${k}">${fields.subjects.map((s) => `<option value="${s}" ${s === v ? 'selected' : ''}>${esc(fields.subjectNames[s])}</option>`).join('')}</select>`;
    const row = (it = {}) => `<div class="list-item" style="--cols:${keys.length}">
      ${keys.map((k) => `<label class="field"><span>${labels[k]}</span>${fields.subjectFields.includes(k) ? subjSel(k, it[k])
        : longKeys.has(k) ? `<textarea data-k="${k}" rows="2">${esc(it[k])}</textarea>` : `<input data-k="${k}" value="${esc(it[k])}">`}</label>`).join('')}
      <button type="button" class="btn danger rm" title="삭제">✕</button></div>`;
    return `<div class="panel" data-list="${name}">
      <div class="list-head"><h2>${title}</h2><button type="button" class="btn subtle add">+ 항목 추가</button></div>
      <div class="list-ed">${items.map(row).join('')}</div>
      <template>${row()}</template>
    </div>`;
  }
  function renderSiteForm() {
    const s = site;
    const input = (k, wide, area) => `<label class="field ${wide ? 'wide' : ''}"><span>${TEXT_LABEL[k]}</span>${area
      ? `<textarea name="${k}" rows="${area}" maxlength="${fields.text[k]}">${esc(s[k])}</textarea>`
      : `<input name="${k}" value="${esc(s[k])}" maxlength="${fields.text[k]}">`}</label>`;
    $('#siteForm').innerHTML = `
      <div class="panel">
        <h2>운영 상태</h2>
        <div class="status-row">${fields.statuses.map((st) => `<label><input type="radio" name="status" value="${st}" ${s.status === st ? 'checked' : ''}> ${STATUS_LABEL[st]}</label>`).join('')}</div>
        <small class="muted">점검 중: 점검 안내 페이지 표시 및 상담 접수 중단</small>
      </div>
      <div class="panel">
        <h2>기본 정보</h2>
        <div class="form-grid">
          ${input('name')}${input('tagline')}${input('heroSymbol')}
          <label class="field"><span>${TEXT_LABEL.color}</span><div class="color-in"><input type="color" value="${esc(s.color)}" data-sync="color"><input name="color" value="${esc(s.color)}" maxlength="7"></div></label>
          ${input('heroTitle', true, 2)}${input('heroSub', true, 3)}${input('notice', true)}
        </div>
      </div>
      <div class="panel">
        <h2>연락처</h2>
        <div class="form-grid">${input('phone')}${input('email')}${input('kakao', true)}${input('area')}${input('hours')}</div>
      </div>
      ${Object.keys(fields.lists).map((k) => listEditor(k, s[k] || [])).join('')}
      <div class="save-bar">
        <span class="meta">마지막 수정: ${esc(s.updatedAt)}</span>
        <a class="btn subtle" href="${esc($('#siteLink').href)}" target="_blank" rel="noopener">사이트 보기 ↗</a>
        <button class="btn primary" type="submit">변경사항 저장</button>
      </div>`;
  }
  $('#siteForm').addEventListener('input', (e) => {
    if (e.target.dataset.sync === 'color') $('#siteForm [name=color]').value = e.target.value;
    else if (e.target.name === 'color' && /^#[0-9a-f]{6}$/i.test(e.target.value)) $('#siteForm [data-sync=color]').value = e.target.value;
  });
  $('#siteForm').addEventListener('click', (e) => {
    const panel = e.target.closest('[data-list]'); if (!panel) return;
    if (e.target.closest('.add')) $('.list-ed', panel).insertAdjacentHTML('beforeend', $('template', panel).innerHTML);
    if (e.target.closest('.rm')) e.target.closest('.list-item').remove();
  });
  $('#siteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = { status: f.status.value };
    for (const k of Object.keys(fields.text)) body[k] = f[k]?.value ?? '';
    for (const k of Object.keys(fields.lists)) {
      body[k] = $$(`[data-list=${k}] .list-ed .list-item`, f).map((it) => Object.fromEntries($$('[data-k]', it).map((i) => [i.dataset.k, i.value])));
    }
    const btn = $('button[type=submit]', f); btn.disabled = true;
    try {
      const r = await api('/site', { method: 'PUT', body });
      site = r.site; renderSiteForm(); toast('저장했습니다 · 사이트에 즉시 반영됩니다');
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  });

  boot();
})();
