import {ACTIONS, STATES, RUNNING, PROVIDERS, normalizeComposer, durationMs, dueTime, importDrafts} from './core.js';
import {normalizeImages, normalizeMarker, storeImage, getImage, exportImages, importImages, referencedImages} from './images.js';
import {buildLayout, insertMarkerAt, markerToken} from './layout.js';
import {isReviewCurrent} from './review.js';
const $ = id => document.getElementById(id);
let state = {jobs:[],drafts:[],logs:[],keyStatus:{}}, changed = false, lastAuto = Date.now(), fetching = false;
let generating = false, generationEpoch = 0, timerNotice;
let attachments=[],imagesBusy=false,folderFiles=[],folderSelection=new Set(),imageEpoch=0;
let reviewInfo=null,reviewEpoch=0;
const imageURLs=new Map();
const fields = ['provider','model','keywords','topic','persona','audience','tone','length','references','instructions','title','body','tags','blogId','action'];
function notify(msg,error=false) {
  $('notice').hidden = false;$('notice').textContent = msg;$('notice').classList.toggle('error',error);
  clearTimeout(timerNotice);timerNotice = setTimeout(() => {$('notice').hidden = true;},error ? 15000:7000);
}
async function send(cmd, values={}) {
  const r = await chrome.runtime.sendMessage({cmd,...values});
  if (!r?.ok) {const error=new Error(r?.error || '확장 프로그램과 연결되지 않았습니다. 확장 프로그램을 다시 불러오세요.');error.review=r?.review;throw error;}
  return r.data;
}
function bind(id, fn) {$(id).addEventListener('click',() => Promise.resolve().then(fn).catch(e => notify(e.message,true)));}
function content() {
  if (imagesBusy) throw new Error('이미지를 보관 중입니다. 첨부 완료 후 실행하세요.');
  return normalizeComposer({...Object.fromEntries(fields.map(id => [id,$(id).value])),images:attachments,review:reviewInfo});
}
function load(c) {
  generationEpoch++;
  for (const id of fields) if (c[id] !== undefined) $(id).value = id === 'tags' ? c.tags.join(', ') : c[id];
  attachments=normalizeImages(c.images || []);void renderAttachments();
  reviewInfo=c.review || null;
  changed = true;updateCount();updateKeyStatus();
}
function updateCount() {$('charCount').textContent = `${$('body').value.length.toLocaleString()}자`;void renderReview();}
async function renderReview() {
  const epoch=++reviewEpoch;
  let current=false;try{current=!!reviewInfo && await isReviewCurrent(content());}catch{}
  if(epoch!==reviewEpoch)return;
  $('reviewStatus').textContent=!reviewInfo ? '검수 전':reviewInfo.status==='blocked' ? '검수 미통과':!current ? '수정 후 재검수 필요':reviewInfo.changed ? '교정 후 통과':'검수 통과';
  $('reviewSummary').textContent=reviewInfo ? `기준 제목: ${reviewInfo.title} · ${reviewInfo.summary}${!current && reviewInfo.status==='approved' ? ' · 이전 검수 결과이며 현재 수정본은 재검수가 필요합니다.':''}`:'AI 생성 후 자동 검수합니다. 직접 쓴 글도 이 버튼으로 검수하거나 네이버 작업 직전에 검수할 수 있습니다.';
  $('reviewIssues').replaceChildren(...(reviewInfo?.issues || []).map(s=>node('li',s)));
  $('reviewBefore').hidden=!reviewInfo?.originalBody;$('reviewOriginal').textContent=reviewInfo?.originalBody || '';
}
function panel(id) {
  document.querySelectorAll('.panel').forEach(p => {p.hidden = p.id !== id;});
  document.querySelectorAll('[data-panel]').forEach(b => b.classList.toggle('selected',b.dataset.panel===id));
}
function node(tag, txt='', cls='') {const el = document.createElement(tag);el.textContent = txt;if (cls) el.className=cls;return el;}
function btn(label, fn) {
  const b = node('button',label);b.addEventListener('click',() => Promise.resolve().then(fn).catch(e => notify(e.message,true)));return b;
}
function date(t) {return new Date(t).toLocaleString('ko-KR',{hour12:false});}
function updateKeyStatus() {
  const p = $('provider').value;
  $('keyStatus').textContent = `${PROVIDERS[p].name} · ${state.keyStatus[p] ? '키 설정됨':'키 필요'}`;
  void renderReview();
}
function renderJobs() {
  const root = $('jobs');root.replaceChildren();
  const pending = state.jobs.filter(j => j.status === 'queued').length;
  const done = state.jobs.filter(j => j.status === 'done').length;
  const review = state.jobs.filter(j => ['failed','needs_review'].includes(j.status)).length;
  $('queueSummary').replaceChildren(node('span',`대기 ${pending}`),node('span',`완료 ${done}`),node('span',`확인·오류 ${review}`),node('span',state.paused ? '전체 일시정지 중':'예약 실행 중'));
  $('pause').textContent = state.paused ? '전체 예약 재개':'전체 일시정지';
  if (!state.jobs.length) root.append(node('p','등록된 예약이 없습니다. 글 작성에서 작업을 등록하세요.','empty'));
  for (const j of [...state.jobs].reverse()) {
    const box = node('div','','job'),head = node('div','','job-head'),title = node('div');
    title.append(node('h3',j.content.title || j.content.topic || '제목 생성 예정'),node('p',`${ACTIONS[j.content.action]} · ${date(j.scheduledAt)} · 이미지 ${j.content.images?.length || 0}장 · ${j.id.slice(0,8)}`));
    head.append(title,node('span',STATES[j.status] || j.status,`state ${j.status}`));box.append(head);
    if (j.error) box.append(node('p',j.error,'error'));
    if (j.result) box.append(node('p',j.result.message));
    if(j.content.review)box.append(node('p',`검수: ${j.content.review.summary}`));
    const actions = node('div','','job-actions');
    actions.append(btn('원고 불러오기',async () => {await replaceComposer(j.content);panel('write');}));
    if (j.status === 'queued' || RUNNING.includes(j.status)) actions.append(btn('작업 취소',async () => {await send('cancel',{id:j.id});await refresh();}));
    if (j.status === 'failed' && !j.tabId) actions.append(btn('재시도',async () => {await send('retry',{id:j.id});await refresh();}));
    if (j.tabId) actions.append(btn('작업 탭 보기',() => chrome.tabs.update(j.tabId,{active:true})));
    if (j.result?.url?.startsWith('https://blog.naver.com/')) actions.append(btn('결과 열기',() => chrome.tabs.create({url:j.result.url})));
    if (j.status === 'needs_review') actions.append(btn('확인 후 완료 처리',async () => {await send('resolve',{id:j.id});await refresh();}));
    box.append(actions);root.append(box);
  }
}
async function replaceComposer(c) {
  if (changed || $('body').value) await send('draft',{content:content()});
  load(c);await persist();notify('기존 원고를 보관하고 선택한 원고를 불러왔습니다.');
}
function renderDrafts() {
  const root = $('draftList');root.replaceChildren();
  if (!state.drafts.length) root.append(node('p','아직 저장한 원고가 없습니다.','empty'));
  for (const d of state.drafts) {
    const box = node('div','','draft-card');
    box.append(node('h3',d.content.title || d.content.topic || '작성 중인 원고'),node('p',date(d.savedAt)),node('p',`${d.content.body?.length || 0}자 · 이미지 ${d.content.images?.length || 0}장 · ${d.content.keywords || '키워드 없음'}`));
    const actions = node('div','','job-actions');
    actions.append(btn('불러오기',async () => {await replaceComposer(d.content);panel('write');}),btn('삭제',async () => {await send('delete-draft',{id:d.id});await refresh();}));
    box.append(actions);root.append(box);
  }
}
function filteredLogs() {
  return state.logs.filter(l => ($('logView').value !== 'result' || ['DONE','STOP','RETRY','CANCEL','REVIEW_PASS','REVIEW_FIXED','REVIEW_BLOCKED'].includes(l.step))
    && (!$('logLevel').value || l.level === $('logLevel').value)
    && `${l.message} ${l.step} ${l.jobId}`.toLowerCase().includes($('logSearch').value.toLowerCase()));
}
function renderLogs() {
  const root = $('logRows');root.replaceChildren();
  for (const l of filteredLogs().slice().reverse()) {
    const row = node('tr','','level-'+l.level);
    for (const v of [date(l.at),l.level,l.step,l.jobId?.slice(0,8) || '—',l.message]) row.append(node('td',v));
    root.append(row);
  }
}
async function refresh() {
  if (fetching) return;fetching = true;
  try {
    state = await send('state');renderJobs();renderDrafts();renderLogs();updateKeyStatus();
  } finally {fetching = false;}
}
async function persist() {
  const snapshot = content(),serialized = JSON.stringify(snapshot);
  await send('composer',{content:snapshot});
  if (serialized === JSON.stringify(content())) changed = false;
  lastAuto = Date.now();$('saveStatus').textContent = `${new Date().toLocaleTimeString('ko-KR',{hour12:false})} 자동저장`;
}
async function loadModels() {
  $('loadModels').disabled = true;
  try {
    const p = $('provider').value,list = await send('models',{provider:p});
    if (p !== $('provider').value) return;
    $('models').replaceChildren(new Option(`${list.length}개 · 모델을 선택하세요`,''),...list.map(m => new Option(m.name,m.id)));
    const existing = $('model').value;if (list.some(m => m.id === existing)) $('models').value = existing;
    notify(`모델 ${list.length}개를 조회했습니다.`);
  } finally {$('loadModels').disabled = false;}
}
async function enqueue(schedule) {
  if (generating) throw new Error('AI 작성·검수가 끝난 뒤 작업을 등록하세요.');
  await persist();const job = await send('enqueue',{content:content(),schedule});
  notify(`작업 등록 완료 · ${date(job.scheduledAt)}`);await refresh();panel('queue');
}
function download(name,text,type) {
  const url = URL.createObjectURL(new Blob([text],{type}));const a = document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(() => URL.revokeObjectURL(url),5000);
}
async function imageUrl(ref,epoch=imageEpoch) {
  if (imageURLs.has(ref.id)) return imageURLs.get(ref.id);
  const asset=await getImage(ref),url=URL.createObjectURL(asset.blob);
  if (epoch!==imageEpoch) {URL.revokeObjectURL(url);return null;}
  imageURLs.set(ref.id,url);return url;
}
async function renderAttachments() {
  void renderReview();
  const epoch=++imageEpoch;
  for (const url of imageURLs.values()) URL.revokeObjectURL(url);imageURLs.clear();
  $('previewImages').replaceChildren();$('imageList').replaceChildren();$('imageCount').textContent=`${attachments.length} / 10장`;
  for (const [index,ref] of attachments.entries()) {
    if (epoch!==imageEpoch) return;
    const card=node('div','','image-card'),img=node('img');img.alt=ref.name;
    card.append(img,node('p',ref.source || ref.name),node('small',`${(ref.size/1024).toFixed(1)} KB`));
    const positionLabel=node('label','삽입 표시 · 비우면 본문 끝'),position=node('input');
    position.type='text';position.value=ref.marker || '';position.placeholder='예: 1 또는 FI';position.maxLength=44;position.setAttribute('aria-label',ref.name+' 삽입 표시');positionLabel.append(position);card.append(positionLabel);
    position.addEventListener('change',()=>{
      const current=attachments.find(r=>r.id===ref.id);
      try {
        if(imagesBusy)throw new Error('첨부가 끝난 뒤 위치를 지정하세요.');
        const marker=normalizeMarker(position.value),next=attachments.map(r=>r.id===ref.id ? {...r,marker}:r);
        const normalized=normalizeImages(next);
        if(current.marker && current.marker!==marker)$('body').value=$('body').value.split(markerToken(current.marker)).join(marker ? markerToken(marker):'');
        attachments=normalized;position.value=marker;positionInfo.textContent=marker ? `${markerToken(marker)}에 삽입`:'위치 미지정: 본문 끝';changed=true;generationEpoch++;updateCount();
      }catch(e){position.value=current?.marker || '';notify(e.message,true);}
    });
    const place=btn('커서 위치에 삽입',()=>{
      if(imagesBusy)throw new Error('첨부가 끝난 뒤 위치를 지정하세요.');
      let marker=attachments.find(r=>r.id===ref.id)?.marker;
      if(!marker){let n=1;while(attachments.some(r=>r.marker===String(n)) || $('body').value.includes(markerToken(String(n))))n++;marker=String(n);}
      const inserted=insertMarkerAt($('body').value,marker,$('body').selectionStart);
      attachments=normalizeImages(attachments.map(r=>r.id===ref.id ? {...r,marker}:r));
      $('body').value=inserted.body;$('body').focus();$('body').setSelectionRange(inserted.cursor,inserted.cursor);
      changed=true;generationEpoch++;updateCount();void renderAttachments();notify(`${ref.name} → ${markerToken(marker)} 위치로 지정했습니다.`);
    });const positionInfo=node('small',ref.marker ? `${markerToken(ref.marker)}에 삽입`:'위치 미지정: 본문 끝');card.append(place,positionInfo);
    const tools=node('div','','image-actions');
    const move=delta=>{if(imagesBusy)return;const at=index+delta;[attachments[index],attachments[at]]=[attachments[at],attachments[index]];changed=true;generationEpoch++;void renderAttachments();};
    const up=btn('앞으로',()=>move(-1)),down=btn('뒤로',()=>move(1));up.disabled=index===0;down.disabled=index===attachments.length-1;
    tools.append(up,down,btn('제거',()=>{if(imagesBusy)return;const current=attachments.find(r=>r.id===ref.id);if(current?.marker)$('body').value=$('body').value.split(markerToken(current.marker)).join('');attachments=attachments.filter(r=>r.id!==ref.id);changed=true;generationEpoch++;updateCount();void renderAttachments();}));card.append(tools);$('imageList').append(card);
    try {const url=await imageUrl(ref,epoch);if(url)img.src=url;}
    catch(e) {card.append(node('p',e.message,'error'));}
  }
}
async function attachFiles(files) {
  if (imagesBusy) throw new Error('다른 이미지 첨부가 진행 중입니다.');
  if (!files.length) throw new Error('첨부할 이미지를 선택하세요.');
  if (files.length>10) throw new Error('한 번에 최대 10장의 이미지를 선택하세요.');
  imagesBusy=true;$('chooseFolder').disabled=true;$('chooseFiles').disabled=true;$('attachFolderImages').disabled=true;
  try {
    const next=attachments.slice();
    for (const file of files) {
      const ref=await storeImage(file);
      if (!next.some(r=>r.id===ref.id)) next.push(ref);
      normalizeImages(next);
    }
    attachments=next;changed=true;generationEpoch++;
  } finally {imagesBusy=false;$('chooseFolder').disabled=false;$('chooseFiles').disabled=false;$('attachFolderImages').disabled=false;}
  await renderAttachments();await persist();notify(`이미지 ${attachments.length}장을 원고와 함께 보관했습니다.`);
}
function renderFolder() {
  const q=$('folderSearch').value.toLowerCase();
  const matching=folderFiles.map((file,index)=>({file,index})).filter(({file})=>(file.webkitRelativePath || file.name).toLowerCase().includes(q));
  $('folderOptions').replaceChildren();
  const updateInfo=()=>{$('folderInfo').textContent=`이미지 ${folderFiles.length}개 · 검색 ${matching.length}개 · 선택 ${folderSelection.size}개${matching.length>200 ? ' · 앞 200개 표시, 검색으로 범위를 좁히세요.':''}`;};
  updateInfo();
  for(const {file,index} of matching.slice(0,200)) {
    const label=node('label','','folder-option'),check=node('input');check.type='checkbox';check.checked=folderSelection.has(index);
    check.addEventListener('change',()=>{if(check.checked)folderSelection.add(index);else folderSelection.delete(index);updateInfo();});
    label.append(check,node('span',file.webkitRelativePath || file.name),node('small',`${(file.size/1024).toFixed(1)} KB`));$('folderOptions').append(label);
  }
}
bind('chooseFolder',()=>$('imageFolder').click());bind('chooseFiles',()=>$('imageFiles').click());
$('imageFolder').addEventListener('change',()=>{
  folderFiles=[...$('imageFolder').files].filter(f=>/\.(png|jpe?g|gif|webp)$/i.test(f.name));folderSelection=new Set();$('folderSearch').value='';renderFolder();
  if(folderFiles.length)$('folderPicker').showModal();else notify('이 폴더에 지원하는 이미지가 없습니다.',true);
  $('imageFolder').value='';
});
$('imageFiles').addEventListener('change',async()=>{try {await attachFiles([...$('imageFiles').files]);}catch(e){notify(e.message,true);}finally{$('imageFiles').value='';}});
$('folderSearch').addEventListener('input',renderFolder);
bind('closeFolder',()=>$('folderPicker').close());
bind('attachFolderImages',async()=>{await attachFiles([...folderSelection].sort((a,b)=>a-b).map(i=>folderFiles[i]));$('folderPicker').close();});
bind('clearImages',()=>{if(imagesBusy)throw new Error('첨부 완료 후 다시 시도하세요.');for(const ref of attachments)if(ref.marker)$('body').value=$('body').value.split(markerToken(ref.marker)).join('');attachments=[];changed=true;generationEpoch++;updateCount();return renderAttachments();});
bind('pruneImages',async()=>{await persist();const n=await send('prune-images');notify(`미사용 이미지 ${n}개를 정리했습니다. 최근 10분 내 추가 파일은 보관합니다.`);});
for (const b of document.querySelectorAll('[data-panel]')) b.addEventListener('click',() => panel(b.dataset.panel));
for (const b of document.querySelectorAll('[data-persona]')) b.addEventListener('click',() => {$('persona').value=b.dataset.persona;changed=true;generationEpoch++;});
for (const id of fields) $(id).addEventListener('input',() => {changed=true;generationEpoch++;updateCount();});
$('provider').addEventListener('change',() => {
  $('model').value='';$('models').replaceChildren(new Option('이 제공자의 목록을 새로 불러오세요',''));$('apiKey').value='';updateKeyStatus();
});
$('models').addEventListener('change',() => {$('model').value=$('models').value;changed=true;generationEpoch++;});
$('scheduleMode').addEventListener('change',() => {$('atBox').hidden=$('scheduleMode').value!=='at';$('delayBox').hidden=$('scheduleMode').value!=='delay';});
for (const id of ['logView','logLevel','logSearch']) $(id).addEventListener('input',renderLogs);
bind('saveKey',async () => {
  await send('key',{provider:$('provider').value,key:$('apiKey').value,remember:$('rememberKey').checked});
  $('apiKey').value='';await refresh();await loadModels();
});
bind('forgetKey',async () => {await send('forget-key',{provider:$('provider').value});$('apiKey').value='';await refresh();notify('해당 제공자의 API 키를 삭제했습니다.');});
bind('loadModels',loadModels);
async function runAi(mode) {
  if (generating) return;
  if (mode==='generate' && $('body').value) await send('draft',{content:content()});
  const epoch = generationEpoch,c = content();generating=true;$('generate').disabled=true;$('reviewPost').disabled=true;$('generating').textContent=mode==='generate' ? '초안 작성 → 제목 기준 페르소나 검수·교정을 진행합니다…':'제목을 기준으로 본문을 검수·교정하고 있습니다…';
  try {
    const result = await send(mode,{content:c});
    if (epoch !== generationEpoch) {
      await send('draft',{content:{...c,...result}});notify('AI 작업 중 원고가 변경되어 검수 결과를 임시저장했습니다.');
    } else {load({...c,...result});await persist();notify(result.review.changed ? '제목에 맞게 본문을 교정했습니다. 수정 이유를 확인하세요.':'제목·본문 일치 검수를 통과했습니다.');}
    await refresh();
  }catch(e){if(epoch===generationEpoch){reviewInfo=e.review || null;changed=true;await persist();void renderReview();}await refresh();throw new Error(e.message+' · 원고·임시저장 목록을 확인하세요.');}
  finally {generating=false;$('generate').disabled=false;$('reviewPost').disabled=false;$('generating').textContent='';}
}
bind('generate',()=>runAi('generate'));bind('reviewPost',()=>runAi('review'));
bind('saveDraft',async () => {await send('draft',{content:content()});await persist();await refresh();notify('로컬 임시저장 목록에 저장했습니다.');});
bind('newPost',async () => {
  await send('draft',{content:content()});load({...content(),title:'',body:'',tags:[],topic:'',keywords:'',images:[],review:null});await persist();await refresh();notify('이전 원고를 저장하고 새 원고를 열었습니다.');
});
bind('previewBtn',async() => {
  const c=content(),layout=buildLayout(c);$('previewTitle').textContent=c.title;$('previewBody').replaceChildren();$('previewTags').textContent='';$('previewImages').replaceChildren();$('preview').showModal();
  const epoch=imageEpoch;
  for(const block of layout.blocks){
    if(block.type==='text'){$('previewBody').append(node('div',block.text,'preview-text'));continue;}
    for(const ref of block.images){const url=await imageUrl(ref,epoch);if(url){const figure=node('figure','','preview-image'),img=node('img');img.src=url;img.alt=ref.name;figure.append(img,node('figcaption',ref.name));$('previewBody').append(figure);}}
  }
});
bind('closePreview',() => $('preview').close());
bind('copy',async () => {const c=content();await navigator.clipboard.writeText(`${c.title}\n\n${c.body}\n\n${c.tags.map(t=>'#'+t).join(' ')}`);notify(c.images.length ? '텍스트를 복사했습니다. 이미지는 작업 실행 시 편집기에 첨부합니다.':'원고를 복사했습니다.');});
bind('runNow',() => enqueue());
bind('schedule',() => {
  const schedule={mode:$('scheduleMode').value,at:$('at').value,hours:$('delayH').value,minutes:$('delayM').value,seconds:$('delayS').value};
  dueTime(schedule);return enqueue(schedule);
});
bind('pause',async () => {await send('pause',{paused:!state.paused});await refresh();notify(state.paused ? '다음 작업부터 실행을 멈춥니다. 실행 중 작업은 별도로 취소할 수 있습니다.':'예약 실행을 재개합니다.');});
bind('cleanJobs',async () => {await send('clean');await refresh();});
bind('backup',async () => {await persist();const data=await send('backup');data.assets=await exportImages(referencedImages(data));download(`블로그스튜디오_백업_${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(data,null,2),'application/json');});
bind('importBtn',() => $('importFile').click());
$('importFile').addEventListener('change',async () => {
  try {
    const f=$('importFile').files[0];if (!f) return;
    if (f.size>160*1024*1024) throw new Error('이미지 포함 백업 파일은 160MB 이하여야 합니다.');
    const data=JSON.parse(await f.text());importDrafts(data);await importImages(data.assets || []);delete data.assets;
    const n=await send('import',{data});await refresh();notify(`${n}개 원고를 가져왔습니다. 예약은 자동 실행하지 않습니다.`);
  } catch(e) {notify(e.message,true);} finally {$('importFile').value='';}
});
bind('exportLogs',() => {
  const safe = v => {let s=String(v??'');if (/^\s*[=+\-@]|^[\t\r]/.test(s)) s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const rows=[['시각','수준','단계','작업 ID','내용'],...filteredLogs().map(l=>[date(l.at),l.level,l.step,l.jobId,l.message])];
  download('블로그스튜디오_상세로그.csv','\ufeff'+rows.map(r=>r.map(safe).join(',')).join('\r\n'),'text/csv;charset=utf-8');
});
bind('clearLogs',async () => {await send('clear-logs');await refresh();});
const preferenceIds=['autoSave','autoH','autoM','autoS'];
for (const id of preferenceIds) $(id).addEventListener('change',() => {
  const prefs={autoSave:$('autoSave').checked,autoH:$('autoH').value,autoM:$('autoM').value,autoS:$('autoS').value};
  chrome.storage.local.set({studioPrefs:prefs});
});
async function init() {
  await refresh();
  load(normalizeComposer(state.composer));changed=false;
  const prefs=(await chrome.storage.local.get('studioPrefs')).studioPrefs;
  if (prefs) for (const id of preferenceIds) if (prefs[id]!==undefined) $(id)[id==='autoSave'?'checked':'value']=prefs[id];
  const next=new Date(Date.now()+300000);next.setMilliseconds(0);$('at').value=new Date(next.getTime()-next.getTimezoneOffset()*60000).toISOString().slice(0,19);
  $('timeZone').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone;
  setInterval(() => {void refresh().catch(e=>notify(e.message,true));},2500);
  let saving=false,ticking=false;
  setInterval(async () => {
    try {
      const period=durationMs($('autoH').value,$('autoM').value,$('autoS').value);
      if ($('autoSave').checked && changed && !saving && Date.now()-lastAuto>=Math.max(1000,period)) {
        saving=true;try {await persist();} finally {saving=false;}
      }
      if (!ticking && !state.paused && state.jobs.some(j=>j.status==='queued' && j.scheduledAt<=Date.now())) {
        ticking=true;try {await send('tick');} finally {ticking=false;}
      }
    } catch(e) {$('saveStatus').textContent=e.message;}
  },1000);
}
window.addEventListener('beforeunload',e => {if (changed) {e.preventDefault();e.returnValue='';}});
void init().catch(e=>notify(e.message,true));
