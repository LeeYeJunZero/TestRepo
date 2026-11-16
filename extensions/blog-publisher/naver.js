// Injected into the editor frame; keep this function independent of module scope.
export async function naverEditor(command) {
  const {op, post, jobId} = command;
  const norm = s => String(s || '').replace(/[\u200b\ufeff]/g,'').replace(/\s+/g,' ').trim();
  const visible = el => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
  const value = el => norm(el?.innerText || el?.textContent);
  const all = selector => [...document.querySelectorAll(selector)].filter(visible);
  const title = () => document.querySelector('.se-documentTitle [contenteditable="true"], .se-section-documentTitle [contenteditable="true"], .se-title-text[contenteditable="true"]');
  const body = () => [...document.querySelectorAll('.se-main-container .se-component.se-text [contenteditable="true"], .se-component-content .se-section-text [contenteditable="true"]')]
    .find(el => !el.closest('.se-documentTitle, .se-section-documentTitle'));
  const check = () => {
    if (globalThis.__postingStudioCancelled === jobId) throw new Error('중단 요청을 확인했습니다.');
    if (/자동입력 방지|보안문자|캡차|비정상적인 접근/.test(all('[role="dialog"], .captcha, [class*="captcha"]').map(value).join(' ')))
      throw new Error('보안 확인 화면입니다. 직접 확인 후 진행하세요.');
  };
  if (op === 'cancel') { globalThis.__postingStudioCancelled = jobId; return {cancelled:true}; }
  if (op === 'probe') return {ready:!!title() && !!body(),url:location.href};
  check();
  if (op === 'fill') {
    const t = title(), b = body();
    if (!t || !b) throw new Error('네이버 SmartEditor 제목/본문 입력 영역을 찾지 못했습니다.');
    const existingText = [...document.querySelectorAll('.se-main-container [contenteditable="true"]')].some(value);
    const existingMedia = document.querySelector('.se-main-container .se-image, .se-main-container .se-video, .se-main-container .se-file');
    if (value(t) || value(b) || existingText || existingMedia) throw new Error('편집기에 기존 내용이 있습니다. 기존 글을 덮어쓰지 않고 멈췄습니다. 새 글 화면을 준비하세요.');
    const insert = (el, str) => {
      check(); el.focus();
      const range = document.createRange(); range.selectNodeContents(el);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      if (!document.execCommand('insertText',false,str)) throw new Error('편집기 텍스트 입력을 지원하지 않습니다.');
      el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:null}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
    };
    insert(t,post.title);
    insert(b,post.body + (post.tags?.length ? '\n\n'+post.tags.map(t => '#'+t.replace(/\s+/g,'')).join(' ') : ''));
    const actualBody = () => norm([...document.querySelectorAll('.se-main-container .se-component.se-text')].map(value).join(' '));
    if (value(t) !== norm(post.title) || !actualBody().includes(norm(post.body)))
      throw new Error('입력 후 제목/본문이 원문과 일치하지 않습니다. 화면에서 확인하세요.');
    return {filled:true,title:value(t),bodyChars:post.body.length};
  }
  const button = labels => all('button, a[role="button"]').filter(el => !el.disabled && labels.includes(value(el)));
  const waitFor = (fn, ms = 12000) => new Promise(resolve => {
    const start = Date.now();
    const timer = setInterval(() => {
      try { check(); const result = fn(); if (result) {clearInterval(timer);resolve(result);} }
      catch(e) { clearInterval(timer); resolve({error:e.message}); }
      if (Date.now()-start >= ms) {clearInterval(timer);resolve(null);}
    },200);
  });
  if (op === 'draft') {
    const save = button(['저장','임시저장'])[0];
    if (!save) throw new Error('임시저장 버튼을 찾지 못했습니다. 자동 발행으로 전환하지 않습니다.');
    let evidence = '';
    // Observe fresh feedback only, never count a stale toast as a new save.
    const observer = new MutationObserver(records => {
      for (const r of records) {
        const nodes = r.type === 'characterData' ? [r.target.parentElement] : [...r.addedNodes];
        for (const n of nodes) {
          const s = norm(n.textContent);
          if (s.length < 200 && /(?:임시\s*)?저장(?:이)?\s*(?:되었습니다|완료(?:되었습니다)?|됐습니다)|저장했/.test(s)) evidence = s;
        }
      }
    });
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    check(); save.click();
    const result = await waitFor(() => evidence ? {saved:true,evidence} : null);
    observer.disconnect();
    return result || {saved:false,uncertain:true,evidence:'저장 버튼은 눌렀지만 새로운 완료 안내를 확인하지 못했습니다.'};
  }
  if (op === 'publish') {
    const first = button(['발행'])[0];
    if (!first) throw new Error('발행 설정 버튼을 찾지 못했습니다.');
    check(); first.click();
    const ready = await waitFor(() => {
      const candidates = button(['발행']).filter(el => el !== first);
      return candidates.length === 1 ? candidates[0] : null;
    },7000);
    if (ready?.error) throw new Error(ready.error);
    if (!ready) return {published:false,uncertain:true,evidence:'발행 설정 화면의 최종 발행 버튼을 확정할 수 없습니다.'};
    check(); ready.click();
    return {submitted:true,evidence:'최종 발행 버튼 클릭. 새 게시글 주소를 확인하는 중입니다.'};
  }
  throw new Error('지원하지 않는 편집기 작업입니다.');
}

export function publishedUrl(url, blogId) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'blog.naver.com') return null;
    const path = u.pathname.match(/^\/([^/]+)\/(\d+)$/);
    if (path && path[1].toLowerCase() === blogId.toLowerCase()) return u.href;
    if (u.pathname.endsWith('/PostView.naver') && u.searchParams.get('blogId')?.toLowerCase() === blogId.toLowerCase()
      && /^\d+$/.test(u.searchParams.get('logNo') || '')) return u.href;
  } catch {}
  return null;
}
