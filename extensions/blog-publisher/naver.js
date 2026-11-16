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
  const imageInputs = () => [...document.querySelectorAll('input[type="file"]')].filter(el =>
    /image|\.png|\.jpe?g|\.gif|\.webp/i.test(el.accept) || el.closest('.se-popup-image, .se-image-uploader'));
  const uploaded = () => [...document.querySelectorAll('.se-main-container .se-component.se-image img')].filter(el =>
    /^https:\/\//.test(el.currentSrc || el.src) && el.complete && el.naturalWidth>0);
  const actualBody = () => norm([...document.querySelectorAll('.se-main-container .se-component.se-text')].map(value).join(' '));
  const check = () => {
    if (globalThis.__postingStudioCancelled === jobId) throw new Error('중단 요청을 확인했습니다.');
    if (/자동입력 방지|보안문자|캡차|비정상적인 접근/.test(all('[role="dialog"], .captcha, [class*="captcha"]').map(value).join(' ')))
      throw new Error('보안 확인 화면입니다. 직접 확인 후 진행하세요.');
  };
  if (op === 'cancel') { globalThis.__postingStudioCancelled = jobId; return {cancelled:true}; }
  if (op === 'probe') return {ready:!!title() && !!body(),url:location.href};
  check();
  if (op === 'verify-post') return {valid:value(title())===norm(post.title) && actualBody().includes(norm(post.body))};
  if (op === 'image-probe') {
    const before=globalThis.__postingStudioImageBefore;
    const nodes=uploaded();
    return {inputReady:imageInputs().length===1,imageCount:nodes.length,
      newImageReady:before?.jobId===jobId && nodes.length>=before.count+(Number(command.expected)||1)};
  }
  if (op === 'prepare-image') {
    const paragraphs=[...document.querySelectorAll('.se-main-container .se-component.se-text [contenteditable="true"]')];
    const last=paragraphs.at(-1);
    if (!last) throw new Error('사진을 넣을 본문 위치를 찾지 못했습니다.');
    last.focus();const range=document.createRange();range.selectNodeContents(last);range.collapse(false);
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    globalThis.__postingStudioImageBefore={jobId,count:uploaded().length};
    if (!imageInputs().length) {
      const toolbar=all('button').filter(el => el.dataset.name==='image' || ['사진','사진 추가'].includes(norm(el.getAttribute('aria-label') || el.title || el.textContent)));
      if (toolbar.length!==1) throw new Error('네이버 사진 첨부 버튼을 확정할 수 없습니다.');
      check();toolbar[0].click();
    }
    return {prepared:true};
  }
  if (op === 'attach-images') {
    const images=command.images;
    if (!Array.isArray(images) || !images.length || images.length>10 || images.reduce((n,r)=>n+r.size,0)>41943040)
      throw new Error('사진 전송 정보가 올바르지 않습니다.');
    const inputs=imageInputs();
    if (inputs.length!==1) throw new Error('사진 파일 입력 영역을 하나로 확정할 수 없습니다.');
    if (images.length>1 && !inputs[0].multiple) throw new Error('편집기가 여러 사진 선택을 지원하지 않습니다. 한 장씩 첨부할 원고로 나누어 주세요.');
    const files=new DataTransfer();
    for (const image of images) {
      if (!image || !['image/png','image/jpeg','image/gif','image/webp'].includes(image.type) || typeof image.data!=='string'
        || image.size<=0 || image.size>10485760 || image.data.length>13981020) throw new Error('사진 전송 정보가 올바르지 않습니다.');
      const bytes=Uint8Array.from(atob(image.data),c=>c.charCodeAt(0));
      if (bytes.length!==image.size) throw new Error('사진 데이터 크기가 원본과 다릅니다.');
      files.items.add(new File([bytes],image.name,{type:image.type}));
    }
    check();inputs[0].files=files.files;
    inputs[0].dispatchEvent(new Event('input',{bubbles:true}));
    inputs[0].dispatchEvent(new Event('change',{bubbles:true}));
    return {attached:true,count:images.length};
  }
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
