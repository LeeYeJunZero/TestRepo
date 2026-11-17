import {ACTIONS, RUNNING, PROVIDERS, normalizeComposer, validateComposer, dueTime, fingerprint, recoverJobs, publicBackup, importDrafts, redact} from './core.js';
import {generate, review, listModels} from './api.js';
import {naverEditor, publishedUrl} from './naver.js';
import {ensureImages, imagePayload, referencedImages, pruneImages} from './images.js';
import {buildLayout} from './layout.js';
import {isReviewCurrent} from './review.js';
import {openDashboard} from './client.js';

const DB = 'postingStudio';
const empty = () => ({composer:{},drafts:[],jobs:[],logs:[],settings:{},paused:false});
let serial = Promise.resolve(), busy = false, active = null, timer;
function mutate(fn) {
  const next = serial.then(async () => {
    const state = (await chrome.storage.local.get(DB))[DB] || empty();
    const result = await fn(state);
    await chrome.storage.local.set({[DB]:state});
    return result;
  });
  serial = next.catch(() => {});
  return next;
}
async function read() {await serial;return (await chrome.storage.local.get(DB))[DB] || empty();}
async function log(level, step, message, jobId = '') {
  const keys = {...(await chrome.storage.local.get('apiKeys')).apiKeys,...(await chrome.storage.session.get('apiKeys')).apiKeys};
  await mutate(s => {
    s.logs.push({at:Date.now(),level,step,message:redact(message,Object.values(keys)),jobId});
    s.logs = s.logs.slice(-3000);
  });
}
async function getKey(provider) {
  const local = (await chrome.storage.local.get('apiKeys')).apiKeys || {};
  const session = (await chrome.storage.session.get('apiKeys')).apiKeys || {};
  return session[provider] || local[provider] || '';
}
async function updateJob(id, patch) {
  return mutate(s => {const j = s.jobs.find(j => j.id === id); if (j) Object.assign(j,patch,{updatedAt:Date.now()});});
}
async function inspectPost(c,signal,jobId='') {
  await saveDraft({...c,review:null});
  await log('info','REVIEW_START',`${PROVIDERS[c.provider].name} / ${c.model} · 기준 제목: ${c.title}`,jobId);
  try {
    const result=await review(c,await getKey(c.provider),signal);
    await log(result.review.changed ? 'warn':'success',result.review.changed ? 'REVIEW_FIXED':'REVIEW_PASS',result.review.summary,jobId);
    for(const issue of result.review.issues)await log('info','REVIEW_NOTE',issue,jobId);
    return result;
  }catch(e){
    await log('error','REVIEW_BLOCKED',e.message,jobId);
    for(const issue of e.review?.issues || [])await log('warn','REVIEW_NOTE',issue,jobId);
    if(e.review)await log('info','REVIEW_HELP','검수 보류로 네이버 전송 전에 멈췄습니다. 원고를 불러와 제목·본문을 맞추거나 필요한 공식 자료를 참고자료에 추가한 뒤 제목 기준 검수를 다시 실행하세요.',jobId);
    throw e;
  }
}
async function alive(id) {
  const s = await read();
  if (s.jobs.find(j => j.id === id)?.status === 'cancelling') throw new Error('중단 요청을 확인했습니다.');
}
async function arm() {
  clearTimeout(timer);
  const s = await read();
  const next = s.paused ? null : s.jobs.filter(j => j.status === 'queued').sort((a,b) => a.scheduledAt-b.scheduledAt)[0];
  await chrome.alarms.clear('posting-next');
  if (!next) return;
  await chrome.alarms.create('posting-next',{when:Math.max(Date.now()+1000,next.scheduledAt)});
  const delay = next.scheduledAt-Date.now();
  if (delay < 25000) timer = setTimeout(() => tick().catch(console.error),Math.max(0,delay));
}
async function recover() {
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  const found = await mutate(async s => {
    const n = s.jobs.filter(j => RUNNING.includes(j.status)).length;
    s.jobs = recoverJobs(s.jobs);
    for (const j of s.jobs) j.fingerprint=await fingerprint(j.content);
    return n;
  });
  if (found) await log('warn','RECOVERY',`실행 중이던 ${found}건을 화면 확인 필요로 바꿨습니다. 자동 재발행하지 않습니다.`);
  await chrome.alarms.create('posting-watch',{periodInMinutes:0.5});
  await arm();
}
const boot = recover();

async function exec(tabId, command, frameId) {
  const results = await chrome.scripting.executeScript({target:{tabId,...(frameId === undefined ? {allFrames:true}:{frameIds:[frameId]})},func:naverEditor,args:[command]});
  return results;
}
async function editor(job) {
  await alive(job.id);
  const tab = await chrome.tabs.create({url:`https://blog.naver.com/PostWriteForm.naver?blogId=${encodeURIComponent(job.content.blogId)}`,active:true});
  active.tabId = tab.id;
  await updateJob(job.id,{tabId:tab.id});
  await log('info','EDITOR',`작업 탭 ${tab.id} 열기. 기존 글은 덮어쓰지 않습니다.`,job.id);
  let frame;
  for (let i = 0; i < 100; i++) {
    await alive(job.id);
    const t = await chrome.tabs.get(tab.id);
    if (t.url?.includes('nid.naver.com')) throw new Error('네이버 로그인이 필요합니다. 열린 탭에서 로그인 후 새 작업을 실행하세요.');
    const probes = await exec(tab.id,{op:'probe',jobId:job.id}).catch(() => []);
    frame = probes.find(p => p.result?.ready)?.frameId;
    if (frame !== undefined) break;
    await new Promise(r => setTimeout(r,400));
  }
  if (frame === undefined) throw new Error('40초 동안 새 글 편집기를 찾지 못했습니다. 로그인·작성 중 글 복구 안내·편집기 구조를 확인하세요.');
  await updateJob(job.id,{status:'filling'});
  const result = (await exec(tab.id,{op:'fill',jobId:job.id,post:job.content},frame))[0]?.result;
  if (!result?.filled) throw new Error('제목·본문 입력 완료를 확인하지 못했습니다.');
  await log('info','FILL',`제목·본문 ${result.bodyChars}자 입력 및 원문 대조 완료`,job.id);
  const layout=buildLayout(job.content);
  for (const group of layout.groups) {
    await alive(job.id);
    for (const ref of group.images) await log('info','IMAGE',`업로드 준비 · ${ref.source || ref.name} · 위치 ${group.marker ? '[['+group.marker+']]':'본문 끝'} · ${ref.size} bytes`,job.id);
    const prepared=(await exec(tab.id,{op:'prepare-image',jobId:job.id,marker:group.marker},frame))[0]?.result;
    if (!prepared?.prepared) throw new Error('사진 입력 위치를 준비하지 못했습니다. 발행을 중단합니다.');
    let ready=false;
    for (let i=0;i<25;i++) {
      await alive(job.id);
      ready=(await exec(tab.id,{op:'image-probe',jobId:job.id},frame))[0]?.result?.inputReady;
      if (ready) break;
      await new Promise(r=>setTimeout(r,200));
    }
    if (!ready) throw new Error('사진 파일 입력 영역을 찾지 못했습니다. 열린 편집기를 확인하세요. 이미지 없이 발행하지 않습니다.');
    const images=[];for (const ref of group.images) images.push(await imagePayload(ref));
    const attached=(await exec(tab.id,{op:'attach-images',jobId:job.id,images},frame))[0]?.result;
    if (!attached?.attached) throw new Error('사진 파일을 편집기에 전달하지 못했습니다.');
    let verified=false;
    for (let i=0;i<90;i++) {
      await alive(job.id);
      const probe=(await exec(tab.id,{op:'image-probe',jobId:job.id,expected:images.length,imageIds:group.images.map(r=>r.id)},frame))[0]?.result;
      if (probe?.newImageReady) {verified=true;break;}
      await new Promise(r=>setTimeout(r,500));
    }
    if (!verified) throw new Error('선택한 이미지 전체의 업로드 완료를 확인하지 못했습니다. 이미지 누락 방지를 위해 저장·발행을 중단합니다.');
    await log('success','IMAGE',`이미지 ${images.length}장 업로드 완료 확인`,job.id);
  }
  const verified=(await exec(tab.id,{op:'verify-post',jobId:job.id,post:job.content,layout:layout.blocks},frame))[0]?.result;
  if (!verified?.valid) throw new Error('최종 제목·본문 대조에 실패했습니다. 저장·발행 전에 작업 화면을 확인하세요.');
  if (job.content.action === 'editor') return {message:'편집기에 입력했습니다. 발행하지 않았습니다.',url:(await chrome.tabs.get(tab.id)).url};
  await alive(job.id);
  // Persist intent before any final click: a restart must never replay an ambiguous send.
  await updateJob(job.id,{status:'submitting',effectStarted:true});
  const action = job.content.action;
  const res = (await exec(tab.id,{op:action,jobId:job.id},frame))[0]?.result;
  if (res?.error) throw new Error(res.error);
  if (action === 'draft') {
    if (!res?.saved) throw new Error(res?.evidence || '임시저장 완료를 확인하지 못했습니다.');
    return {message:res.evidence,url:(await chrome.tabs.get(tab.id)).url};
  }
  if (!res?.submitted) throw new Error(res?.evidence || '발행 버튼 처리 결과가 불명확합니다.');
  await log('info','PUBLISH',res.evidence,job.id);
  for (let i = 0; i < 60; i++) {
    const t = await chrome.tabs.get(tab.id);
    let url = publishedUrl(t.url,job.content.blogId);
    if (!url) {
      const frames = await exec(tab.id,{op:'probe',jobId:job.id}).catch(() => []);
      url = frames.map(f => publishedUrl(f.result?.url,job.content.blogId)).find(Boolean);
    }
    if (url) return {message:'새 게시글 주소 확인 완료',url};
    await new Promise(r => setTimeout(r,500));
  }
  throw new Error('최종 발행 후 새 글 주소를 확인하지 못했습니다. 열린 탭을 확인하세요. 재발행하지 않습니다.');
}

async function run(job) {
  active = {id:job.id,controller:new AbortController(),tabId:null};
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}),20000);
  try {
    await log('info','START',`${ACTIONS[job.content.action]} 시작 · 예약 대비 ${Math.max(0,Date.now()-job.scheduledAt)}ms 지연`,job.id);
    await ensureImages(job.content.images);
    if (!job.content.body || !job.content.title) {
      await updateJob(job.id,{status:'generating'});
      validateComposer(job.content,{generate:true});
      await log('info','API',`${PROVIDERS[job.content.provider].name} / ${job.content.model} 생성 요청`,job.id);
      const key = await getKey(job.content.provider);
      const generated = await generate(job.content,key,active.controller.signal);
      job.content = {...job.content,...generated,review:null};job.requiresReview=true;
      await updateJob(job.id,{content:job.content,requiresReview:true});
      await log('info','GENERATE',`제목·본문 ${generated.body.length}자 생성 완료`,job.id);
    }
    await alive(job.id);
    if(job.requiresReview || job.content.action!=='local') {
      if(!await isReviewCurrent(job.content)) {
        await updateJob(job.id,{status:'reviewing'});
        const checked=await inspectPost(job.content,active.controller.signal,job.id);
        await alive(job.id);job.content={...job.content,...checked};
        await updateJob(job.id,{content:job.content});
      } else await log('info','REVIEW_PASS','현재 원고와 일치하는 제목 기준 검수 결과를 사용합니다.',job.id);
    }
    validateComposer(job.content);
    const generatedFp = await fingerprint(job.content);
    await mutate(s => {
      if (s.jobs.some(j => j.id !== job.id && j.fingerprint === generatedFp && !['failed','cancelled'].includes(j.status)))
        throw new Error('같은 원고의 작업 기록이 있어 중복 실행을 중단했습니다.');
      const current = s.jobs.find(j => j.id === job.id);if (current) current.fingerprint = generatedFp;
    });
    if (job.content.action === 'local') {
      await saveDraft(job.content);
      await updateJob(job.id,{status:'done',result:{message:'로컬 임시저장 완료'}});
    } else {
      await updateJob(job.id,{status:'opening'});
      const result = await editor(job);
      await updateJob(job.id,{status:'done',result});
    }
    await log('success','DONE',`${ACTIONS[job.content.action]} 완료`,job.id);
  } catch (e) {
    const current = (await read()).jobs.find(j => j.id === job.id);
    const opened = !!current?.tabId;
    const cancelled = current?.status === 'cancelling';
    const attempts = (current?.attempts || 0)+1;
    const retry = !opened && !cancelled && e.retryable && attempts < 3;
    const status = retry ? 'queued' : opened ? 'needs_review' : cancelled ? 'cancelled' : 'failed';
    const message = redact(e.message,[await getKey(job.content.provider)]);
    await updateJob(job.id,{status,error:message,attempts,...(e.review ? {content:{...current.content,review:e.review}}:{}),...(retry ? {scheduledAt:Date.now()+attempts*30000}: {})});
    await log(retry ? 'warn':'error',retry ? 'RETRY':'STOP',`${message}${retry ? ` · ${attempts*30}초 후 API 재시도` : ''}`,job.id);
  } finally {clearInterval(keepAlive);active = null;}
}
async function tick() {
  await boot;
  if (busy) return;
  busy = true;
  try {
    const job = await mutate(s => {
      if (s.paused) return null;
      const j = s.jobs.filter(j => j.status === 'queued' && j.scheduledAt <= Date.now()).sort((a,b) => a.scheduledAt-b.scheduledAt)[0];
      if (!j) return null;
      j.status = 'generating'; j.startedAt = Date.now(); return structuredClone(j);
    });
    if (job) await run(job);
  } finally {busy = false;await arm();}
}
async function saveDraft(raw) {
  const content = normalizeComposer(raw);
  await ensureImages(content.images);
  return mutate(s => {
    const draft = {id:crypto.randomUUID(),content,savedAt:Date.now()};
    s.drafts.unshift(draft); s.drafts = s.drafts.slice(0,200); return draft;
  });
}
async function dispatch(m) {
  if(m.clientVersion!==chrome.runtime.getManifest().version) {
    const e=new Error('대시보드와 백그라운드 버전이 다릅니다. 확장을 새로고침하고 기존 대시보드를 닫아 다시 여세요.');e.code='VERSION_MISMATCH';throw e;
  }
  await boot;
  switch (m.cmd) {
    case 'hello': return true;
    case 'state': {
      const s = await read();
      s.keyStatus = Object.fromEntries(await Promise.all(Object.keys(PROVIDERS).map(async p => [p,!!await getKey(p)])));
      return s;
    }
    case 'composer': {
      const content=normalizeComposer(m.content);await ensureImages(content.images);
      return mutate(s => {s.composer=content;s.composerSavedAt=Date.now();});
    }
    case 'draft': {
      const d = await saveDraft(m.content);await log('info','DRAFT','로컬 임시저장 완료');return d;
    }
    case 'delete-draft': return mutate(s => {s.drafts = s.drafts.filter(d => d.id !== m.id);});
    case 'key': {
      if (!Object.hasOwn(PROVIDERS,m.provider)) throw new Error('알 수 없는 제공자입니다.');
      const key = String(m.key || '').trim();
      if (!key || key.length > 1000 || /\s/.test(key)) throw new Error('API 키를 확인하세요.');
      for (const area of [chrome.storage.local,chrome.storage.session]) {
        const keys = (await area.get('apiKeys')).apiKeys || {};delete keys[m.provider];
        if (area === (m.remember ? chrome.storage.local:chrome.storage.session)) keys[m.provider] = key;
        await area.set({apiKeys:keys});
      }
      await log('info','KEY',`${PROVIDERS[m.provider].name} 키 설정 · ${m.remember ? '이 기기에 보관':'크롬 세션 동안만 보관'}`);
      return true;
    }
    case 'forget-key': {
      for (const area of [chrome.storage.local,chrome.storage.session]) {
        const keys = (await area.get('apiKeys')).apiKeys || {};delete keys[m.provider];await area.set({apiKeys:keys});
      } return true;
    }
    case 'models': {
      const list = await listModels(m.provider,await getKey(m.provider));
      await log('info','MODELS',`${PROVIDERS[m.provider].name} 모델 ${list.length}개 조회`);
      return list;
    }
    case 'generate': {
      const c = normalizeComposer(m.content);validateComposer(c,{generate:true});
      await log('info','API',`${PROVIDERS[c.provider].name} / ${c.model} 미리보기 생성 요청`);
      const hold = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}),20000);
      try {
        const draft = await generate(c,await getKey(c.provider));
        await log('info','GENERATE',`초안 ${draft.body.length}자 작성 완료 · 제목 기준 검수를 시작합니다.`);
        return await inspectPost({...c,...draft,review:null});
      } finally {clearInterval(hold);}
    }
    case 'review': {
      const c=normalizeComposer(m.content),hold=setInterval(()=>chrome.runtime.getPlatformInfo().catch(()=>{}),20000);
      try {return await inspectPost(c);}finally{clearInterval(hold);}
    }
    case 'enqueue': {
      const content = normalizeComposer(m.content);
      validateComposer(content,{generate:!content.title || !content.body});
      await ensureImages(content.images);
      const scheduledAt = m.schedule ? dueTime(m.schedule):Date.now();
      const fp = await fingerprint(content);
      const job = await mutate(s => {
        if (s.jobs.length >= 500) throw new Error('작업은 최대 500개까지 보관합니다. 완료 기록을 정리하세요.');
        if (s.jobs.some(j => j.fingerprint === fp && !['cancelled','failed'].includes(j.status)))
          throw new Error('같은 내용·작업의 기록이 있습니다. 중복 게시 방지를 위해 추가하지 않았습니다.');
        const j = {id:crypto.randomUUID(),content,scheduledAt,createdAt:Date.now(),status:'queued',attempts:0,fingerprint:fp};
        s.jobs.push(j);return j;
      });
      await log('info','QUEUE',`${ACTIONS[content.action]} 등록 · ${new Date(scheduledAt).toISOString()}`,job.id);
      await arm();void tick().catch(console.error);return job;
    }
    case 'tick': void tick().catch(console.error);return true;
    case 'pause': await mutate(s => {s.paused = !!m.paused;});await arm();return true;
    case 'cancel': {
      const isActive = active?.id === m.id;
      await mutate(s => {
        const j = s.jobs.find(j => j.id === m.id);
        if (!j || (!RUNNING.includes(j.status) && j.status !== 'queued')) return;
        j.status = isActive ? 'cancelling':'cancelled';
      });
      if (isActive) {
        active.controller.abort();
        if (active.tabId) await exec(active.tabId,{op:'cancel',jobId:m.id}).catch(() => {});
      }
      await log('warn','CANCEL','중단 요청. 이미 눌린 저장·발행은 되돌리지 않습니다.',m.id);await arm();return true;
    }
    case 'retry': {
      await mutate(s => {
        const j = s.jobs.find(j => j.id === m.id);
        if (j?.status !== 'failed' || j.tabId) throw new Error('브라우저 전송 전 실패한 작업만 재시도할 수 있습니다. 확인 필요 작업은 화면을 확인하세요.');
        j.status = 'queued';j.attempts = 0;j.error = '';j.scheduledAt = Date.now();
      });await arm();void tick().catch(console.error);return true;
    }
    case 'resolve': return mutate(s => {
      const j = s.jobs.find(j => j.id === m.id);
      if (j?.status === 'needs_review') {j.status = 'done';j.result = {message:'사용자가 작업 화면 확인 후 수동 완료 처리'};}
    });
    case 'clean': return mutate(s => {s.jobs = s.jobs.filter(j => !['done','failed','cancelled'].includes(j.status));});
    case 'clear-logs': return mutate(s => {s.logs = [];});
    case 'backup': return publicBackup(await read());
    case 'prune-images': {
      const removed=await pruneImages(referencedImages(await read()));
      await log('info','IMAGE',`미사용 이미지 ${removed}개 정리 · 최근 10분 내 추가 파일은 유지`);return removed;
    }
    case 'import': {
      const drafts = importDrafts(m.data);
      for (const d of drafts) await ensureImages(d.content.images);
      await mutate(s => {s.drafts = [...drafts,...s.drafts].slice(0,200);});
      await log('info','IMPORT',`${drafts.length}개를 로컬 임시저장으로 가져옴. 예약·발행은 실행하지 않음.`);return drafts.length;
    }
    default: throw new Error('지원하지 않는 요청입니다.');
  }
}
chrome.runtime.onMessage.addListener((m,sender,reply) => {
  if (sender.id !== chrome.runtime.id || sender.url?.split('?')[0] !== chrome.runtime.getURL('dashboard.html')) return false;
  dispatch(m).then(data => reply({ok:true,data,version:chrome.runtime.getManifest().version}), async e => {
    const msg = redact(e.message);
    await log('error','REQUEST',msg).catch(() => {});reply({ok:false,error:msg,code:e.code || 'OPERATION_FAILED',version:chrome.runtime.getManifest().version,...(e.review ? {review:e.review}:{})});
  });return true;
});
chrome.action.onClicked.addListener(() => {void openDashboard().catch(console.error);});
chrome.alarms.onAlarm.addListener(a => {if (a.name.startsWith('posting-')) void tick().catch(console.error);});
chrome.runtime.onStartup.addListener(() => {void boot.then(() => tick()).catch(console.error);});
chrome.runtime.onInstalled.addListener(() => {void boot.then(() => arm()).catch(console.error);});
