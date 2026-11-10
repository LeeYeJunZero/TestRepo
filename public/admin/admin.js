(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  const SITE_NAME = { math: '수학 (플랫)', english: '영어 (머티리얼)', coding: '코딩 (플루언트)' };
  const SITE_COLOR = { math: 'var(--c-math)', english: 'var(--c-english)', coding: 'var(--c-coding)' };
  const STATUS_LABEL = { live: '운영 중', maintenance: '점검 중', hidden: '숨김' };
  const INQ_LABEL = { new: '신규', contacted: '연락완료', enrolled: '등록', closed: '종료' };
  const LIST_LABEL = {
    features: ['특징', { icon: '아이콘', title: '제목', desc: '설명' }],
    courses: ['수업 과정', { name: '과정명', target: '대상', desc: '설명', price: '수강료' }],
    tutors: ['선생님', { name: '이름', role: '담당', bio: '소개' }],
    faqs: ['FAQ', { q: '질문', a: '답변' }]
  };
  const TEXT_LABEL = {
    name: '사이트 이름', tagline: '한 줄 소개', heroSymbol: '로고 심볼', color: '대표 색상',
    heroTitle: '메인 타이틀 (줄바꿈 가능)', heroSub: '메인 설명', notice: '상단 공지 (비우면 숨김)',
    phone: '전화번호', email: '이메일', kakao: '카카오톡 오픈채팅 URL', area: '수업 지역', hours: '상담 시간'
  };
  const tag = (site) => `<span class="tag"><i class="dot" style="background:${SITE_COLOR[site]}"></i>${esc(SITE_NAME[site] || site)}</span>`;

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
  async function boot() {
    try {
      const me = await api('/me');
      $('#login').hidden = true; $('#app').hidden = false;
      $('#siteLinks').innerHTML = Object.entries(me.links).map(([k, url]) =>
        `<a href="${esc(url)}" target="_blank" rel="noopener"><i class="dot" style="background:${SITE_COLOR[k]}"></i>${esc(SITE_NAME[k])} ↗</a>`).join('');
      for (const sel of ['#vSite', '#iSite']) {
        $(sel).insertAdjacentHTML('beforeend', Object.keys(SITE_NAME).map((k) => `<option value="${k}">${SITE_NAME[k]}</option>`).join(''));
      }
      go(location.hash.slice(1) || 'dash');
    } catch { /* showLogin 호출됨 */ }
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#loginErr').textContent = '';
    try {
      await api('/login', { method: 'POST', body: { password: e.target.password.value } });
      e.target.reset(); boot();
    } catch (err) { $('#loginErr').textContent = err.message; }
  });
  $('#logout').addEventListener('click', async () => { await api('/logout', { method: 'POST', body: {} }).catch(() => {}); showLogin(); });

  // ───────── 탭 ─────────
  const loaders = { dash: loadDash, visits: loadVisits, inq: loadInq, sites: loadSites };
  function go(tab) {
    if (!loaders[tab]) tab = 'dash';
    $$('.side-nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab));
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
    loadDash().catch((e) => toast(e.message, true));
  });

  async function loadDash() {
    const s = await api('/stats?days=' + days);
    const by = Object.fromEntries(s.perSite.map((r) => [r.site, r]));
    const sum = (k) => s.perSite.reduce((a, r) => a + (r[k] || 0), 0);
    const inqTotal = s.inquiries.reduce((a, r) => a + r.total, 0);
    const badge = $('#pendingBadge'); badge.hidden = !s.pendingAll; badge.textContent = s.pendingAll;

    $('#kpis').innerHTML = [
      ['오늘 방문 (PV)', sum('today_pv'), '전체 사이트'],
      [`방문수 (${days}일)`, sum('pv'), `방문자 ${sum('uv').toLocaleString()}명`],
      ['모바일 비율', sum('pv') ? Math.round((sum('mobile') / sum('pv')) * 100) + '%' : '–', `${days}일 기준`],
      [`상담 신청 (${days}일)`, inqTotal, `미처리 ${s.pendingAll}건`]
    ].map(([l, v, sub]) => `<div class="kpi"><span>${l}</span><b>${typeof v === 'number' ? v.toLocaleString() : v}</b><small>${sub}</small></div>`).join('');

    // 일별 차트 데이터 (빈 날짜 채우기)
    const dates = [];
    const now = new Date(Date.now() + 9 * 3600e3);
    for (let i = s.days - 1; i >= 0; i--) dates.push(new Date(now - i * 86400e3).toISOString().slice(0, 10));
    const series = s.sites.map((site) => ({
      site, values: dates.map((d) => s.daily.find((r) => r.d === d && r.site === site)?.pv || 0)
    }));
    lineChart($('#chartDaily'), dates, series);
    $('#legend').innerHTML = s.sites.map((k) => `<span><i class="dot" style="background:${SITE_COLOR[k]}"></i>${SITE_NAME[k]}</span>`).join('');

    const hours = Array.from({ length: 24 }, (_, h) => s.hourly.find((r) => r.h === h)?.n || 0);
    barChart($('#chartHourly'), hours);

    $('#siteTable').innerHTML = `<table class="tbl"><thead><tr><th>사이트</th><th class="num">PV</th><th class="num">방문자</th><th class="num">오늘</th><th class="num">상담</th></tr></thead><tbody>
      ${s.sites.map((k) => {
        const r = by[k] || {}; const q = s.inquiries.find((x) => x.site === k) || {};
        return `<tr><td>${tag(k)}</td><td class="num">${(r.pv || 0).toLocaleString()}</td><td class="num">${(r.uv || 0).toLocaleString()}</td><td class="num">${r.today_pv || 0}</td><td class="num">${q.total || 0}</td></tr>`;
      }).join('')}</tbody></table>`;

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
      tip.hidden = false;
      tip.innerHTML = best.html;
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
    const grid = [0, 1, 2, 3, 4].map((i) => {
      const v = (nice / 4) * i;
      return `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="#eef0f3"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#98a2b3">${v}</text>`;
    }).join('');
    const step = Math.ceil(labels.length / 8);
    const xl = labels.map((d, i) => (i % step === 0 || i === labels.length - 1)
      ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#98a2b3">${d.slice(5)}</text>` : '').join('');
    const lines = series.map((s) => {
      const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
      return `<polyline fill="none" stroke="${SITE_COLOR[s.site]}" stroke-width="2.5" stroke-linejoin="round" points="${pts}"/>` +
        (labels.length <= 31 ? s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${SITE_COLOR[s.site]}"/>`).join('') : '');
    }).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}${xl}${lines}</svg>`;
    attachTip(el, el.querySelector('svg'), labels.map((d, i) => ({
      x: x(i), y: y(Math.max(...series.map((s) => s.values[i]))),
      html: `<b>${d}</b><br>` + series.map((s) => `${SITE_NAME[s.site]}: ${s.values[i]}`).join('<br>')
    })));
  }

  function barChart(el, values) {
    const W = 600, H = 220, P = { l: 36, r: 10, t: 10, b: 26 };
    const max = Math.max(1, ...values); const nice = Math.ceil(max / 4) * 4 || 4;
    const bw = (W - P.l - P.r) / 24;
    const y = (v) => H - P.b - (v / nice) * (H - P.t - P.b);
    const grid = [0, 2, 4].map((i) => { const v = (nice / 4) * i; return `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="#eef0f3"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#98a2b3">${v}</text>`; }).join('');
    const bars = values.map((v, h) => `<rect x="${P.l + h * bw + 2}" y="${y(v)}" width="${bw - 4}" height="${H - P.b - y(v)}" rx="3" fill="#2f6fed" opacity="${v ? 0.85 : 0.15}"/>` +
      (h % 3 === 0 ? `<text x="${P.l + h * bw + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#98a2b3">${h}시</text>` : '')).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}${bars}</svg>`;
    attachTip(el, el.querySelector('svg'), values.map((v, h) => ({ x: P.l + h * bw + bw / 2, y: y(v), html: `${h}시 – ${v}회` })));
  }

  // ───────── 접속 기록 ─────────
  let vOffset = 0; const V_LIMIT = 50; let vTimer;
  async function loadVisits() {
    const q = new URLSearchParams({ limit: V_LIMIT, offset: vOffset, site: $('#vSite').value, q: $('#vQ').value.trim(), bots: $('#vBots').checked ? '1' : '' });
    const { total, rows } = await api('/visits?' + q);
    $('#vTable').innerHTML = `<thead><tr><th>시각 (KST)</th><th>사이트</th><th>경로</th><th>IP</th><th>유입경로</th><th>기기</th><th>브라우저</th></tr></thead><tbody>
      ${rows.length ? rows.map((r) => `<tr>
        <td>${esc(r.created_at)}</td><td>${tag(r.site)}</td><td>${esc(r.path)}</td><td>${esc(r.ip)}</td>
        <td class="ref" title="${esc(r.referrer)}">${esc(r.referrer) || '<span class="pill">직접</span>'}</td>
        <td>${r.bot ? '<span class="pill bot">봇</span>' : r.mobile ? '<span class="pill mobile">모바일</span>' : '<span class="pill">PC</span>'}</td>
        <td class="ua" title="${esc(r.ua)}">${esc(r.ua)}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">기록이 없습니다</td></tr>'}</tbody>`;
    $('#vInfo').textContent = total ? `${vOffset + 1}–${Math.min(vOffset + V_LIMIT, total)} / 총 ${total.toLocaleString()}건` : '0건';
    $('#vPrev').disabled = vOffset === 0;
    $('#vNext').disabled = vOffset + V_LIMIT >= total;
  }
  const reloadVisits = () => { vOffset = 0; loadVisits().catch((e) => toast(e.message, true)); };
  $('#vSite').addEventListener('change', reloadVisits);
  $('#vBots').addEventListener('change', reloadVisits);
  $('#vQ').addEventListener('input', () => { clearTimeout(vTimer); vTimer = setTimeout(reloadVisits, 300); });
  $('#vPrev').addEventListener('click', () => { vOffset = Math.max(0, vOffset - V_LIMIT); loadVisits(); });
  $('#vNext').addEventListener('click', () => { vOffset += V_LIMIT; loadVisits(); });
  $('#vPurge').addEventListener('click', async () => {
    if (!confirm('30일보다 오래된 접속 기록을 삭제할까요? 되돌릴 수 없습니다.')) return;
    const r = await api('/visits/purge', { method: 'POST', body: { olderThanDays: 30 } });
    toast(`${r.deleted}건 삭제됨`); reloadVisits();
  });

  // ───────── 상담 신청 ─────────
  async function loadInq() {
    const q = new URLSearchParams({ site: $('#iSite').value, status: $('#iStatus').value });
    const { rows } = await api('/inquiries?' + q);
    $('#inqList').innerHTML = rows.length ? rows.map((r) => `
      <article class="inq ${r.status === 'new' ? 'is-new' : ''}" data-id="${r.id}">
        <div>
          <div class="inq-head"><b>${esc(r.name)}</b>${tag(r.site)}<span class="st-${r.status}">● ${INQ_LABEL[r.status]}</span></div>
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
  $('#iSite').addEventListener('change', () => loadInq());
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
  let sites = [], fields = null, curKey = 'math';
  async function loadSites() {
    const r = await api('/sites');
    sites = r.sites; fields = r.fields;
    $('#siteSeg').innerHTML = sites.map((s) => `<button type="button" data-key="${s.key}" class="${s.key === curKey ? 'on' : ''}">${esc(SITE_NAME[s.key])}</button>`).join('');
    renderSiteForm();
  }
  $('#siteSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    curKey = b.dataset.key;
    $$('#siteSeg button').forEach((x) => x.classList.toggle('on', x === b));
    renderSiteForm();
  });

  function listEditor(name, items) {
    const [title, labels] = LIST_LABEL[name];
    const keys = fields.lists[name];
    const longKeys = new Set(['desc', 'bio', 'a']);
    const row = (it = {}) => `<div class="list-item" style="--cols:${keys.length}">
      ${keys.map((k) => `<label class="field"><span>${labels[k]}</span>${longKeys.has(k)
        ? `<textarea data-k="${k}" rows="2">${esc(it[k])}</textarea>`
        : `<input data-k="${k}" value="${esc(it[k])}">`}</label>`).join('')}
      <button type="button" class="btn danger rm" title="삭제">✕</button></div>`;
    return `<div class="panel" data-list="${name}">
      <div class="list-head"><h2>${title}</h2><button type="button" class="btn subtle add">+ 항목 추가</button></div>
      <div class="list-ed">${items.map(row).join('')}</div>
      <template>${row()}</template>
    </div>`;
  }

  function renderSiteForm() {
    const s = sites.find((x) => x.key === curKey);
    const input = (k, wide, area) => `<label class="field ${wide ? 'wide' : ''}"><span>${TEXT_LABEL[k]}</span>${area
      ? `<textarea name="${k}" rows="${area}" maxlength="${fields.text[k]}">${esc(s[k])}</textarea>`
      : `<input name="${k}" value="${esc(s[k])}" maxlength="${fields.text[k]}">`}</label>`;
    $('#siteForm').innerHTML = `
      <div class="panel">
        <h2>운영 상태</h2>
        <div class="status-row">${fields.statuses.map((st) => `<label><input type="radio" name="status" value="${st}" ${s.status === st ? 'checked' : ''}> ${STATUS_LABEL[st]}</label>`).join('')}</div>
        <small style="color:var(--muted)">점검 중: 점검 안내 페이지 표시 · 숨김: 404 처리 및 포털 목록에서 제외</small>
      </div>
      <div class="panel">
        <h2>기본 정보</h2>
        <div class="form-grid">
          ${input('name')}${input('tagline')}
          ${input('heroSymbol')}
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
        <a class="btn subtle" href="${esc($(`#siteLinks a:nth-child(${Object.keys(SITE_NAME).indexOf(curKey) + 1})`)?.href || '#')}" target="_blank" rel="noopener">사이트 보기 ↗</a>
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
      body[k] = $$(`[data-list=${k}] .list-ed .list-item`, f).map((it) =>
        Object.fromEntries($$('[data-k]', it).map((i) => [i.dataset.k, i.value])));
    }
    const btn = $('button[type=submit]', f); btn.disabled = true;
    try {
      const r = await api('/sites/' + curKey, { method: 'PUT', body });
      sites = sites.map((s) => (s.key === curKey ? r.site : s));
      renderSiteForm(); toast('저장했습니다 · 사이트에 즉시 반영됩니다');
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  });

  boot();
})();
