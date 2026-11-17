import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,rm,realpath,readdir,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {naverEditor} from '../extensions/blog-publisher/naver.js';
import {buildLayout} from '../extensions/blog-publisher/layout.js';

// Fresh test profile only. No user cookies, API keys, or live Naver posting.
const root=process.cwd(),sourceExtension=path.join(root,'extensions/blog-publisher');
const clientVersion=JSON.parse(await readFile(path.join(sourceExtension,'manifest.json'),'utf8')).version;
const profile=await mkdtemp(path.join(tmpdir(),'posting-studio-test-'));
const extension=path.join(profile,'extension');await mkdir(extension);
for(const file of await readdir(sourceExtension))await copyFile(path.join(sourceExtension,file),path.join(extension,file));
const pageHtml=await readFile(path.join(extension,'dashboard.html'),'utf8');
await writeFile(path.join(extension,'legacy-dashboard.html'),pageHtml.replace(/<meta name="studio-ui-version"[^>]+>/,'').replace(/id="reviewStatus"/,'id="oldReviewStatus"').replace(/id="reviewBefore"/,'id="oldReviewBefore"').replace('placeholder="AI 생성 후 직접 수정하거나 완성한 원고를 붙여넣으세요."></textarea>','placeholder="AI 생성 후 직접 수정하거나 완성한 원고를 붙여넣으세요.">미저장 복구 원고</textarea>'));
await writeFile(path.join(extension,'missing-notice.html'),pageHtml.replace('id="notice"','id="oldNotice"').replace('id="reviewBefore"','id="oldReviewBefore"'));
const executable=process.env.BLOG_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const child=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,
  '--remote-debugging-port=0',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let browser,sw,ui,errors=[],passed=0,imagePayload,initialDraftCount=0;
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();this.events=[];
    ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}}
      else {this.events.push(m);if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text+': '+(m.params.exceptionDetails.exception?.description||''));}});
  }
  static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});return new CDP(ws);}
  call(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('CDP timeout: '+method));},20000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}
  async eval(expression){const r=await this.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;}
  close(){this.ws.close();}
}
let port;
const targets=()=>fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
async function waitUntil(fn,ms=15000){const start=Date.now();while(Date.now()-start<ms){const v=await fn();if(v)return v;await sleep(100);}throw new Error('Condition timed out');}
const msg=(cmd,values={})=>ui.eval(`chrome.runtime.sendMessage(${JSON.stringify({cmd,...values,clientVersion})})`);
const c={provider:'openai',model:'mock-text',keywords:'영어',topic:'독해',persona:'학습 코치',audience:'학부모',length:1000,title:'테스트 제목',body:'확인할 본문입니다.\n\n두 번째 문단',tags:['영어'],action:'local'};
try {
  const info=await waitUntil(async()=>{try{return await readFile(path.join(profile,'DevToolsActivePort'),'utf8');}catch{return null;}});
  const lines=info.trim().split(/\r?\n/);port=Number(lines[0]);browser=await CDP.connect(`ws://127.0.0.1:${port}${lines[1]}`);
  const target=await waitUntil(async()=> {
    for(const t of (await targets()).filter(t=>t.type==='service_worker'&&t.url.endsWith('/background.js'))) {
      const candidate=await CDP.connect(t.webSocketDebuggerUrl);await candidate.call('Runtime.enable');
      const name=await candidate.eval('typeof chrome !== "undefined" && chrome.runtime?.getManifest?.().name').catch(()=>null);
      if(name==='블로그 포스팅 스튜디오'){sw=candidate;return t;}candidate.close();
    }return null;
  });
  const extId=new URL(target.url).hostname;
  const created=await browser.call('Target.createTarget',{url:`chrome-extension://${extId}/dashboard.html`});
  const page=await waitUntil(async()=> (await targets()).find(t=>t.id===created.targetId));ui=await CDP.connect(page.webSocketDebuggerUrl);
  await ui.call('Runtime.enable');await ui.call('Page.enable');
  await ui.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1120,deviceScaleFactor:1,mobile:false});
  await waitUntil(()=>ui.eval('document.getElementById("timeZone")?.textContent'));
  await check('확장 로드·전체 화면 대시보드',async()=>assert.equal(await ui.eval('document.querySelector("h1").textContent'),'블로그 포스팅 스튜디오'));
  await check('구버전 탭의 미저장 원고를 보존하고 새 버전 탭만 재사용',async()=>{
    await ui.eval(`document.getElementById('body').value='이전 탭의 미저장 원고'`);
    const first=await ui.eval(`(async()=>{const {openDashboard}=await import('./client.js');const tab=await openDashboard();return {id:tab.id,url:tab.pendingUrl || tab.url};})()`);
    assert.equal(first.url,`chrome-extension://${extId}/dashboard.html?v=${clientVersion}`);
    await waitUntil(()=>ui.eval(`(async()=> (await chrome.tabs.get(${first.id})).url===${JSON.stringify(`chrome-extension://${extId}/dashboard.html?v=${clientVersion}`)})()`));
    const second=await ui.eval(`(async()=>{const {openDashboard}=await import('./client.js');return (await openDashboard()).id;})()`);
    assert.equal(second,first.id);
    assert.equal(await ui.eval(`document.getElementById('body').value`),'이전 탭의 미저장 원고');
    await sw.eval(`chrome.tabs.remove(${first.id})`);
    await ui.eval(`document.getElementById('body').value=''`);
  });
  await check('세 제공자·초 단위 날짜·시분초 입력',async()=>assert.deepEqual(await ui.eval('[document.getElementById("provider").options.length,document.getElementById("at").step,!!document.getElementById("delayS"),!!document.getElementById("autoS")]'),[3,'1',true,true]));
  await check('API 키 세션 보관·모델 조회·생성 mock',async()=>{
    const keyResult=await msg('key',{provider:'openai',key:'test-only-key',remember:false});
    assert.equal(keyResult?.ok,true,JSON.stringify(keyResult));
    function installFetchMock() {
      globalThis.reviewMode='normal';globalThis.reviewCalls=0;globalThis.draftCalls=0;
      globalThis.fetch=async(url,options)=>{
        if(url.endsWith('/models'))return new Response(JSON.stringify({data:[{id:'mock-text'}]}),{status:200});
        const prompt=JSON.parse(options.body).input;let result;
        if(prompt.includes('작업: TITLE_BODY_REVIEW')) {
          globalThis.reviewCalls++;
          if(globalThis.transientReviewFailures>0){globalThis.transientReviewFailures--;return new Response(JSON.stringify({error:{message:'모의 일시적 검수 제한'}}),{status:429});}
          const input=JSON.parse(prompt.slice(prompt.indexOf('검수 입력(JSON): ')+'검수 입력(JSON): '.length));
          const mode=globalThis.reviewMode;if(mode==='delay')await new Promise(r=>setTimeout(r,700));
          const changed=mode==='recipe' && input.body.includes('짜파게티');
          result={title:input.title,body:changed ? '춘장과 채소로 짜장 소스를 만들어 면에 올립니다.':input.body,tags:input.tags,
            approved:mode!=='blocked',checks:{titleMatch:mode!=='blocked',scopeMatch:mode!=='blocked',personaMatch:true},
            issues:mode==='blocked' ? ['제목을 뒷받침할 자료 부족']:changed ? ['짜파게티 제품 조리법을 제목에 맞는 짜장면 조리 설명으로 수정']:[],
            summary:mode==='blocked' ? '자료 부족으로 검수 중단':changed ? '제목과 다른 조리법 교정':'제목·본문 일치 검수 통과'};
          if(mode==='compact'){result.unchanged=true;delete result.body;delete result.tags;}
        }else{globalThis.draftCalls++;result={title:'모의 생성 제목',body:'모의 생성 본문',tags:['영어']};}
        return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]}),{status:200});
      };
    }
    await sw.eval(`(${installFetchMock.toString()})()`);
    const models=await msg('models',{provider:'openai'});assert.equal(models.data[0].id,'mock-text');
    const out=await msg('generate',{content:c});assert.equal(out.data.title,c.title);assert.equal(out.data.review.status,'approved');
    assert.deepEqual(await sw.eval('[globalThis.draftCalls,globalThis.reviewCalls]'),[1,1]);initialDraftCount=(await msg('state')).data.drafts.length;
    assert.equal(await sw.eval('(async () => (await chrome.storage.local.get("apiKeys")).apiKeys?.openai || null)()'),null);
  });
  await check('실제 키 적용 버튼·모델 조회가 현재 버전에서 동작',async()=>{
    await ui.eval(`document.getElementById('apiKey').value='test-only-key';document.getElementById('saveKey').click()`);
    await waitUntil(()=>ui.eval(`document.getElementById('apiKey').value==='' && document.getElementById('models').options.length===2`));
    assert.ok(await ui.eval(`document.getElementById('keyStatus').textContent.includes('키 기기 저장됨')`));
  });
  await check('이전 화면 버전의 키 변경 요청을 거부',async()=>{
    const r=await ui.eval(`chrome.runtime.sendMessage({cmd:'key',provider:'openai',key:'must-not-save',clientVersion:'1.1.0'})`);
    assert.equal(r.ok,false);assert.equal(r.code,'VERSION_MISMATCH');
    assert.equal(await sw.eval(`(async()=>(await chrome.storage.local.get('apiKeys')).apiKeys.openai)()`),'test-only-key');
  });
  await check('기기 저장 키는 세션 초기화·화면 재로드 후 보관 옵션과 함께 유지',async()=>{
    await sw.eval(`chrome.storage.session.remove('apiKeys')`);
    await ui.call('Page.reload');
    await waitUntil(()=>ui.eval(`document.getElementById('keyStatus').textContent.includes('키 기기 저장됨')`));
    assert.equal(await ui.eval(`document.getElementById('rememberKey').checked`),true);
    const saved=(await msg('state')).data;
    assert.equal(saved.keyStored.openai,true);assert.ok(!JSON.stringify(saved).includes('test-only-key'));
    await ui.eval(`document.getElementById('apiKey').value='test-only-key';document.getElementById('saveKey').click()`);
    await waitUntil(()=>ui.eval(`document.getElementById('apiKey').value==='' && !document.getElementById('saveKey').disabled`));
    assert.equal((await msg('state')).data.keyStored.openai,true);
  });
  await check('키 적용 중 연결 끊김은 화면 안내로 처리',async()=>{
    await ui.eval(`globalThis.originalStudioSend=chrome.runtime.sendMessage;chrome.runtime.sendMessage=()=>{throw new Error('Extension context invalidated.')};document.getElementById('apiKey').value='test-only-key';document.getElementById('saveKey').click()`);
    await waitUntil(()=>ui.eval(`document.getElementById('notice').textContent.includes('확장 연결이 끊겼습니다')`));
    await ui.eval(`chrome.runtime.sendMessage=globalThis.originalStudioSend;delete globalThis.originalStudioSend;document.getElementById('apiKey').value=''`);
  });
  await check('원고 자동저장·미리보기 XSS 방지',async()=>{
    await ui.eval(`document.getElementById('title').value='<img src=x onerror=alert(1)>';document.getElementById('body').value='본문';document.getElementById('autoS').value='1';document.getElementById('body').dispatchEvent(new Event('input',{bubbles:true}));`);
    await waitUntil(async()=> (await msg('state')).data.composer?.body==='본문');
    await ui.eval('document.getElementById("previewBtn").click()');await sleep(100);
    assert.equal(await ui.eval('document.getElementById("previewTitle").querySelectorAll("img").length'),0);
    await ui.eval('document.getElementById("preview").close()');
  });
  await check('예약 일시정지·복사본 보관·중복 등록 차단',async()=>{
    await msg('pause',{paused:true});
    const r=await msg('enqueue',{content:c,schedule:{mode:'delay',seconds:2}});assert.equal(r.ok,true);
    await msg('composer',{content:{...c,title:'수정된 원고'}});
    const duplicate=await msg('enqueue',{content:c,schedule:{mode:'delay',seconds:3}});assert.equal(duplicate.ok,false);
    await sleep(2200);const s=(await msg('state')).data;assert.equal(s.jobs[0].status,'queued');assert.equal(s.jobs[0].content.title,c.title);
  });
  await check('예약 재개·로컬 저장 단일 실행',async()=>{
    await msg('pause',{paused:false});await msg('tick');
    await waitUntil(async()=> (await msg('state')).data.jobs[0].status==='done');
    const s=(await msg('state')).data;assert.equal(s.drafts.length,initialDraftCount+1);assert.ok(s.logs.some(l=>l.step==='DONE'));
  });
  await check('예약 취소 후 실행 안 함',async()=>{
    const r=await msg('enqueue',{content:{...c,title:'취소할 글'},schedule:{mode:'delay',seconds:2}});
    await msg('cancel',{id:r.data.id});await sleep(2100);await msg('tick');
    const s=(await msg('state')).data;assert.equal(s.jobs.find(j=>j.id===r.data.id).status,'cancelled');assert.equal(s.drafts.length,initialDraftCount+1);
  });
  await check('생성 예약 실행 및 작업 결과 보존',async()=>{
    const r=await msg('enqueue',{content:{...c,title:'',body:'',topic:'생성 예약 테스트'}});
    await waitUntil(async()=> (await msg('state')).data.jobs.find(j=>j.id===r.data.id)?.status==='done');
    const s=(await msg('state')).data;assert.equal(s.jobs.find(j=>j.id===r.data.id).content.title,'모의 생성 제목');
  });
  await check('생성 후 검수 API 재시도에서도 검수를 건너뛰지 않음',async()=>{
    await sw.eval(`globalThis.transientReviewFailures=1`);
    const before=await sw.eval('globalThis.reviewCalls');
    const r=await msg('enqueue',{content:{...c,title:'검수 재시도 원고',body:''}});
    await waitUntil(async()=>{const j=(await msg('state')).data.jobs.find(j=>j.id===r.data.id);return j?.status==='queued' && j.attempts===1;});
    await sw.eval(`(async()=>{const data=await chrome.storage.local.get('postingStudio');data.postingStudio.jobs.find(j=>j.id===${JSON.stringify(r.data.id)}).scheduledAt=Date.now();await chrome.storage.local.set(data)})()`);
    await msg('tick');await waitUntil(async()=> (await msg('state')).data.jobs.find(j=>j.id===r.data.id)?.status==='done');
    assert.equal(await sw.eval('globalThis.reviewCalls'),before+2);
    assert.equal((await msg('state')).data.jobs.find(j=>j.id===r.data.id).content.review.status,'approved');
  });
  await check('백업 키 제외·가져온 예약 자동 실행 금지',async()=>{
    const backup=(await msg('backup')).data;assert.ok(!JSON.stringify(backup).includes('test-only-key'));
    const before=(await msg('state')).data.jobs.length;
    const imported=await msg('import',{data:backup});assert.equal(imported.ok,true);assert.equal((await msg('state')).data.jobs.length,before);
  });
  await check('결과만·상세 로그 전환·수준 필터',async()=>{
    await ui.eval('document.querySelector("[data-panel=logs]").click();document.getElementById("logView").value="result";document.getElementById("logView").dispatchEvent(new Event("input"))');
    const resultCount=await ui.eval('document.getElementById("logRows").children.length');assert.ok(resultCount>0);
    await ui.eval('document.getElementById("logView").value="all";document.getElementById("logView").dispatchEvent(new Event("input"))');
    assert.ok(await ui.eval('document.getElementById("logRows").children.length')>=resultCount);
  });
  await check('좁은 화면 가로 넘침 없음',async()=>{
    await ui.call('Emulation.setDeviceMetricsOverride',{width:600,height:1000,deviceScaleFactor:1,mobile:false});
    await ui.eval('document.querySelector("[data-panel=write]").click()');
    assert.ok(await ui.eval('document.documentElement.scrollWidth <= innerWidth'));
  });
  await check('제목 고정·페르소나 교정 UI·수정 이유·원문 보존',async()=>{
    await sw.eval(`globalThis.reviewMode='recipe'`);
    const recipe={...c,title:'짜장면 레시피',body:'짜파게티 스프를 넣습니다.',persona:'친절한 요리 설명자'};
    await ui.eval(`Object.entries(${JSON.stringify(recipe)}).forEach(([id,value])=>{const input=document.getElementById(id);if(input){input.value=value;input.dispatchEvent(new Event('input'))}});document.getElementById('reviewPost').click()`);
    await waitUntil(()=>ui.eval(`document.getElementById('reviewStatus').textContent==='교정 후 통과'`));
    assert.equal(await ui.eval(`document.getElementById('title').value`),'짜장면 레시피');
    assert.ok(await ui.eval(`document.getElementById('body').value.includes('춘장') && document.getElementById('reviewOriginal').textContent.includes('짜파게티') && document.getElementById('reviewIssues').textContent.includes('수정')`));
    assert.ok((await msg('state')).data.logs.some(l=>l.step==='REVIEW_FIXED'));
  });
  await check('본문 수정 시 검수 무효화 표시',async()=>{
    await ui.eval(`document.getElementById('body').value+=' 추가';document.getElementById('body').dispatchEvent(new Event('input'))`);
    await waitUntil(()=>ui.eval(`document.getElementById('reviewStatus').textContent==='수정 후 재검수 필요'`));
  });
  await check('검수 중 직접 수정한 원고를 결과가 덮어쓰지 않음',async()=>{
    await sw.eval(`globalThis.reviewMode='delay'`);
    await ui.eval(`document.getElementById('reviewPost').click()`);await sleep(100);
    await ui.eval(`document.getElementById('body').value='사용자가 직접 수정한 원고';document.getElementById('body').dispatchEvent(new Event('input'))`);
    await waitUntil(()=>ui.eval(`!document.getElementById('reviewPost').disabled`));
    assert.equal(await ui.eval(`document.getElementById('body').value`),'사용자가 직접 수정한 원고');
    await sw.eval(`globalThis.reviewMode='normal'`);
  });
  await ui.eval(`globalThis.imageTest=import(chrome.runtime.getURL('images.js'));globalThis.pngData=(()=>{const c=document.createElement('canvas');c.width=2;c.height=2;const ctx=c.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,2,2);return c.toDataURL('image/png').split(',')[1]})();`);
  const png=await ui.eval('globalThis.pngData');
  await mkdir(path.join(profile,'test1'),{recursive:true});await writeFile(path.join(profile,'test1/1.png'),Buffer.from(png,'base64'));
  await check('폴더 이미지 검색·선택·썸네일·바이너리 보관',async()=>{
    await ui.eval(`(()=>{const bytes=Uint8Array.from(atob(globalThis.pngData),s=>s.charCodeAt(0));const file=new File([bytes],'1.png',{type:'image/png'});Object.defineProperty(file,'webkitRelativePath',{value:'test1/1.png'});const list=new DataTransfer();list.items.add(file);document.getElementById('imageFolder').files=list.files;document.getElementById('imageFolder').dispatchEvent(new Event('change'))})();`);
    assert.equal(await ui.eval('document.getElementById("folderPicker").open'),true);
    await ui.eval(`document.getElementById('folderSearch').value='1.png';document.getElementById('folderSearch').dispatchEvent(new Event('input'));const choice=document.querySelector('#folderOptions input');choice.focus();choice.click();if(document.activeElement!==choice)throw new Error('이미지 선택 중 키보드 포커스 유실');document.getElementById('attachFolderImages').click()`);
    await waitUntil(()=>ui.eval(`document.getElementById('imageCount').textContent==='1 / 10장' && !document.getElementById('folderPicker').open`));
    const s=(await msg('state')).data;assert.equal(s.composer.images[0].source,'test1/1.png');
    imagePayload=await ui.eval(`(async()=>{const lib=await globalThis.imageTest;return lib.imagePayload(${JSON.stringify(s.composer.images[0])})})()`);
    assert.equal(imagePayload.data,png);assert.equal(await ui.eval('document.querySelector("#imageList img").naturalWidth'),2);
  });
  let imageJob;
  await check('원본 변경·선택 해제 후에도 예약 이미지 유지',async()=>{
    const s=(await msg('state')).data;await msg('pause',{paused:true});
    imageJob=(await msg('enqueue',{content:{...c,title:'이미지 예약',images:s.composer.images},schedule:{mode:'delay',hours:1}})).data;
    await writeFile(path.join(profile,'test1/1.png'),'원본 파일 변경');
    await ui.eval(`document.getElementById('clearImages').click()`);
    await waitUntil(async()=> (await msg('state')).data.composer.images?.length===0);
    const stored=(await msg('state')).data.jobs.find(j=>j.id===imageJob.id);assert.equal(stored.content.images.length,1);
    const saved=await ui.eval(`(async()=>{const lib=await globalThis.imageTest;return lib.imagePayload(${JSON.stringify(imageJob.content.images[0])})})()`);
    assert.equal(saved.data,png);
  });
  await check('페이지 재시작·예약 원고 불러오기에서 첨부 복원',async()=>{
    await ui.call('Page.reload');await waitUntil(()=>ui.eval('document.getElementById("timeZone")?.textContent'));
    await waitUntil(()=>ui.eval(`!![...document.querySelectorAll('.job h3')].find(e=>e.textContent==='이미지 예약')`));
    await ui.eval(`(()=>{const h=[...document.querySelectorAll('.job h3')].find(e=>e.textContent==='이미지 예약');h.closest('.job').querySelector('button').click()})()`);
    await waitUntil(()=>ui.eval(`document.getElementById('imageCount').textContent==='1 / 10장' && document.querySelector('#imageList img')?.naturalWidth===2`));
    await ui.eval(`globalThis.imageTest=import(chrome.runtime.getURL('images.js'))`);
  });
  await check('커서 위치 표시·이미지 연결·중간 위치 미리보기',async()=>{
    await ui.eval(`(()=>{const body=document.getElementById('body');body.value='ABCDE';body.focus();body.setSelectionRange(1,1);body.dispatchEvent(new Event('input'));[...document.querySelectorAll('#imageList button')].find(b=>b.textContent==='커서 위치에 삽입').click()})()`);
    await waitUntil(()=>ui.eval(`document.getElementById('body').value.includes('[[1]]') && document.querySelector('#imageList input')?.value==='1'`));
    await ui.eval(`document.getElementById('previewBtn').click()`);
    await waitUntil(()=>ui.eval(`document.querySelector('#previewBody figure img')?.naturalWidth===2`));
    const preview=await ui.eval(`(()=>{const figure=document.querySelector('#previewBody figure');return [figure.previousElementSibling.textContent.trim(),figure.nextElementSibling.textContent.trim(),document.getElementById('previewBody').textContent.includes('[[1]]')]})()`);
    assert.deepEqual(preview,['A','BCDE',false]);await ui.eval(`document.getElementById('preview').close()`);
  });
  await check('삽입 표시 이름 변경 시 기존 본문 표시도 함께 변경',async()=>{
    await ui.eval(`(()=>{const input=document.querySelector('#imageList input');input.value='FI';input.dispatchEvent(new Event('change'))})()`);
    assert.ok(await ui.eval(`document.getElementById('body').value.includes('[[FI]]') && !document.getElementById('body').value.includes('[[1]]')`));
    await waitUntil(async()=> (await msg('state')).data.composer.images?.[0]?.marker==='FI');
  });
  await check('이미지 포함 백업·바이트 복원·해시 변조 차단',async()=>{
    const backup=(await msg('backup')).data;
    const exported=await ui.eval(`(async()=>{const lib=await globalThis.imageTest;return lib.exportImages(lib.referencedImages(${JSON.stringify(backup)}))})()`);
    assert.equal(exported[0].data,png);
    await ui.eval(`(async()=>{const lib=await globalThis.imageTest;await lib.importImages(${JSON.stringify(exported)})})()`);
    await assert.rejects(()=>ui.eval(`(async()=>{const lib=await globalThis.imageTest;await lib.importImages(${JSON.stringify([{...exported[0],id:'b'.repeat(64)}])})})()`),/검증값/);
  });
  await check('가짜 이미지·손상 PNG를 첨부하지 않음',async()=>{
    await assert.rejects(()=>ui.eval(`(async()=>{const lib=await globalThis.imageTest;return lib.storeImage(new File(['가짜 이미지'],'bad.png',{type:'image/png'}))})()`),/이미지 파일/);
    await assert.rejects(()=>ui.eval(`(async()=>{const lib=await globalThis.imageTest;return lib.storeImage(new File([Uint8Array.of(137,80,78,71,13,10,26,10)],'broken.png',{type:'image/png'}))})()`));
  });
  await check('저장본 없는 이미지 예약은 브라우저 실행 전에 거부',async()=>{
    const before=(await msg('state')).data.jobs.length;
    const r=await msg('enqueue',{content:{...c,title:'없는 이미지',images:[{...imageJob.content.images[0],id:'c'.repeat(64)}]}});
    assert.equal(r.ok,false);assert.match(r.error,/저장본/);assert.equal((await msg('state')).data.jobs.length,before);
  });
  await sw.eval(`globalThis.realPostingApis={create:chrome.tabs.create,get:chrome.tabs.get,execute:chrome.scripting.executeScript};globalThis.imageAdapterMode='ok';globalThis.finalSends=0;globalThis.receivedImageData=null;chrome.tabs.create=async()=>({id:98765});chrome.tabs.get=async()=>({id:98765,url:'https://blog.naver.com/PostWriteForm.naver?blogId=testblog'});chrome.scripting.executeScript=async options=>{const cmd=options.args[0];let result={};if(cmd.op==='probe')result={ready:true};if(cmd.op==='fill')result={filled:true,bodyChars:100};if(cmd.op==='prepare-image')result={prepared:globalThis.imageAdapterMode==='ok'};if(cmd.op==='image-probe')result={inputReady:true,newImageReady:true};if(cmd.op==='attach-images'){globalThis.receivedImageData=cmd.images;result={attached:true,count:cmd.images.length};}if(cmd.op==='verify-post')result={valid:true};if(cmd.op==='draft'||cmd.op==='publish'){globalThis.finalSends++;result={saved:true,evidence:'테스트 저장 확인'};}return [{frameId:0,result}];};`);
  await check('예약 실행이 저장된 이미지 바이트를 전송한 뒤 임시저장',async()=>{
    const r=await msg('enqueue',{content:{...c,title:'사진 포함 네이버 저장 테스트',action:'draft',blogId:'https://m.blog.naver.com/testblog/123456789',images:imageJob.content.images}});
    assert.equal(r.data.content.blogId,'testblog');
    await msg('pause',{paused:false});await msg('tick');
    await waitUntil(async()=> (await msg('state')).data.jobs.find(j=>j.id===r.data.id)?.status==='done');
    assert.equal(await sw.eval('globalThis.receivedImageData[0].data'),png);assert.equal(await sw.eval('globalThis.finalSends'),1);
  });
  await check('이미지 입력 실패 시 최종 저장·발행 호출 금지',async()=>{
    await sw.eval(`globalThis.imageAdapterMode='fail';globalThis.finalSends=0;`);
    const r=await msg('enqueue',{content:{...c,title:'사진 실패 발행 차단 테스트',action:'publish',blogId:'testblog',images:imageJob.content.images}});
    await msg('tick');await waitUntil(async()=> (await msg('state')).data.jobs.find(j=>j.id===r.data.id)?.status==='needs_review');
    assert.equal(await sw.eval('globalThis.finalSends'),0);
  });
  await check('검수 미통과 원고는 편집기를 열거나 발행하지 않음',async()=>{
    await sw.eval(`globalThis.reviewMode='blocked';globalThis.finalSends=0;globalThis.createdReviewTabs=0;chrome.tabs.create=async()=>{globalThis.createdReviewTabs++;return {id:98765}};`);
    const r=await msg('enqueue',{content:{...c,title:'근거 부족 제목',action:'publish',blogId:'testblog'}});await msg('tick');
    await waitUntil(async()=> (await msg('state')).data.jobs.find(j=>j.id===r.data.id)?.status==='failed');
    assert.equal(await sw.eval('globalThis.createdReviewTabs'),0);assert.equal(await sw.eval('globalThis.finalSends'),0);
    const j=(await msg('state')).data.jobs.find(j=>j.id===r.data.id);assert.equal(j.content.review.status,'blocked');
    assert.ok((await msg('state')).data.logs.some(l=>l.jobId===r.data.id && l.step==='REVIEW_HELP' && l.message.includes('네이버 전송 전에')));
    assert.ok((await msg('state')).data.drafts.some(d=>d.content.title==='근거 부족 제목' && d.content.body===c.body));
    await sw.eval(`globalThis.reviewMode='normal';globalThis.imageAdapterMode='ok'`);
  });
  await check('통과한 원고는 검수 재사용, 제목이 바뀌면 재검수',async()=>{
    const source={...c,title:'재사용 검수 제목'},checked=(await msg('review',{content:source})).data;
    const before=await sw.eval('globalThis.reviewCalls');
    const r=await msg('enqueue',{content:{...source,...checked,action:'draft',blogId:'testblog'}});await msg('tick');
    await waitUntil(async()=> (await msg('state')).data.jobs.find(j=>j.id===r.data.id)?.status==='done');assert.equal(await sw.eval('globalThis.reviewCalls'),before);
    const changed=await msg('enqueue',{content:{...source,...checked,title:'수정한 검수 제목',action:'draft',blogId:'testblog'}});await msg('tick');
    await waitUntil(async()=> (await msg('state')).data.jobs.find(j=>j.id===changed.data.id)?.status==='done');assert.equal(await sw.eval('globalThis.reviewCalls'),before+1);
  });
  await check('수동 완료 오처리 후 미발행 확인으로 즉시·예약 재등록 가능',async()=>{
    await msg('pause',{paused:true});
    await sw.eval(`(async()=>{const x=(await chrome.storage.local.get('postingStudio')).postingStudio;x.jobs.push({id:'manual-old',content:${JSON.stringify({...c,action:'publish',blogId:'testblog',title:'미발행 복구 테스트'})},status:'needs_review',createdAt:Date.now(),scheduledAt:Date.now()});await chrome.storage.local.set({postingStudio:x})})()`);
    await msg('resolve',{id:'manual-old'});
    assert.equal((await msg('not-published',{id:'manual-old'})).ok,true);
    assert.equal((await msg('state')).data.jobs.find(j=>j.id==='manual-old').status,'cancelled');
    const content={...c,action:'publish',blogId:'testblog',title:'미발행 복구 테스트'};
    const immediate=await msg('enqueue',{content});assert.equal(immediate.ok,true);
    assert.equal((await msg('enqueue',{content})).ok,false);
    await msg('cancel',{id:immediate.data.id});
    const scheduled=await msg('enqueue',{content,schedule:{mode:'delay',minutes:5}});assert.equal(scheduled.ok,true);
    await msg('cancel',{id:scheduled.data.id});
    await msg('pause',{paused:false});
  });
  await check('짧은 검수 판정·수동 재검수 캐시·검수 시간 로그',async()=>{
    await sw.eval(`globalThis.reviewMode='compact'`);
    const source={...c,title:'짧은 검수 응답 테스트'},checked=(await msg('review',{content:source})).data;
    assert.equal(checked.body,source.body);assert.equal(checked.review.changed,false);
    const before=await sw.eval('globalThis.reviewCalls');
    assert.equal((await msg('review',{content:{...source,...checked}})).ok,true);
    assert.equal(await sw.eval('globalThis.reviewCalls'),before);
    await msg('review',{content:{...source,...checked,references:'추가 참고자료'}});
    assert.equal(await sw.eval('globalThis.reviewCalls'),before+1);
    assert.ok((await msg('state')).data.logs.some(l=>l.step==='REVIEW_PASS' && /· \d+\.\d초/.test(l.message)));
    await sw.eval(`globalThis.reviewMode='normal'`);
  });
  await sw.eval(`chrome.tabs.create=globalThis.realPostingApis.create;chrome.tabs.get=globalThis.realPostingApis.get;chrome.scripting.executeScript=globalThis.realPostingApis.execute;delete globalThis.realPostingApis;`);
  await ui.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1120,deviceScaleFactor:1,mobile:false});
  const demo={title:'대원외고 영어, 단어는 아는데 해석이 막히는 이유',body:'단어를 모두 해석했는데도 문장의 뜻이 이어지지 않나요?\n\n긴 문장을 읽는 연습은 주어와 동사를 찾는 데서 시작합니다. 문장의 뼈대를 먼저 잡고 수식어를 연결해 보세요.',topic:'긴 문장을 정확하게 읽는 구문 분석',keywords:'대원외고, 심화 영어, 영어 독해',persona:'학생의 고민을 구체적인 예시로 풀어주는 학습 코치'};
  await ui.eval(`Object.entries(${JSON.stringify(demo)}).forEach(([id,value])=>document.getElementById(id).value=value)`);
  await mkdir(path.join(root,'reports'),{recursive:true});
  const screenshot=await ui.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(root,'reports/blog-publisher-dashboard.png'),Buffer.from(screenshot.data,'base64'));
  await check('대시보드 런타임 오류 없음',async()=>assert.deepEqual(errors,[]));

  const mock=await browser.call('Target.createTarget',{url:'about:blank'});
  const mockInfo=await waitUntil(async()=> (await targets()).find(t=>t.id===mock.targetId));const dom=await CDP.connect(mockInfo.webSocketDebuggerUrl);
  const fixture=`<style>[contenteditable]{display:block;width:400px;min-height:20px}button{display:block}</style><div class="se-main-container"><div class="se-documentTitle"><p contenteditable="true"></p></div><div class="se-component se-text"><div class="se-component-content"><div class="se-section-text"><p contenteditable="true"></p></div></div></div></div><button id="save">저장</button><button id="first">발행</button>`;
  const reset=()=>dom.eval(`document.body.innerHTML=${JSON.stringify(fixture)};delete globalThis.__postingStudioCancelled;`);
  const act=cmd=>dom.eval(`(${naverEditor.toString()})(${JSON.stringify(cmd)})`);
  async function positionFixture(wrong=false) {
    await reset();
    function installUpload(wrong) {
      const input=document.createElement('input');input.type='file';input.accept='image/*';input.multiple=true;document.body.append(input);
      input.addEventListener('change',()=>{
        const range=window.getSelection().getRangeAt(0);
        const target=range.startContainer.nodeType===Node.TEXT_NODE ? range.startContainer.parentElement:range.startContainer;
        const comp=target.closest('.se-component.se-text'),paragraph=comp.querySelector('[contenteditable=true]');
        const before=document.createRange();before.selectNodeContents(paragraph);before.setEnd(range.startContainer,range.startOffset);
        const after=document.createRange();after.selectNodeContents(paragraph);after.setStart(range.startContainer,range.startOffset);
        const asText=n=>n.nodeType===Node.TEXT_NODE ? n.textContent:n.nodeName==='BR' ? '\n'
          :[...n.childNodes].map(asText).join('')+(['DIV','P'].includes(n.nodeName) ? '\n':'');
        const block=text=>{const div=document.createElement('div');div.className='se-component se-text';const p=document.createElement('p');p.contentEditable='true';p.textContent=text;div.append(p);return div;};
        const inserted=[...input.files].map(f=>{
          const div=document.createElement('div');div.className='se-component se-image';const img=document.createElement('img');
          Object.defineProperties(img,{currentSrc:{value:'https://postfiles.pstatic.net/'+f.name},complete:{value:true},naturalWidth:{value:2}});div.append(img);return div;
        });
        if(wrong)document.querySelector('.se-main-container').append(...inserted);
        else comp.replaceWith(block(asText(before.cloneContents())),...inserted,block(asText(after.cloneContents())));
      });
    }
    await dom.eval(`(${installUpload.toString()})(${wrong})`);
  }
  await check('편집기 DOM 입력·태그·원문 검증',async()=>{
    await reset();assert.equal((await act({op:'probe'})).ready,true);
    const r=await act({op:'fill',post:c,jobId:'test'});assert.equal(r.filled,true);
    assert.ok(await dom.eval('document.body.innerText.includes("#영어")'));
  });
  await check('기존 원고 덮어쓰기 차단',async()=>{await assert.rejects(()=>act({op:'fill',post:c,jobId:'test'}),/기존 내용/);});
  await check('사진 파일 입력 영역이 없으면 전송 중단',async()=>{
    await reset();await act({op:'fill',post:c,jobId:'test'});
    await assert.rejects(()=>act({op:'prepare-image',jobId:'test'}),/사진 첨부 버튼/);
  });
  await check('실제 File 바이트·여러 이미지 순서를 편집기에 전달',async()=>{
    await reset();await act({op:'fill',post:c,jobId:'test'});
    await dom.eval(`(()=>{const input=document.createElement('input');input.type='file';input.accept='image/*';input.multiple=true;document.body.append(input);input.addEventListener('change',()=>{globalThis.receivedFiles=[...input.files].map(f=>({name:f.name,size:f.size}));for(const f of input.files){const component=document.createElement('div');component.className='se-component se-image';const img=document.createElement('img');Object.defineProperties(img,{currentSrc:{value:'https://postfiles.pstatic.net/'+f.name},complete:{value:true},naturalWidth:{value:2}});component.append(img);document.querySelector('.se-main-container').append(component)}})})()`);
    await act({op:'prepare-image',jobId:'test'});
    assert.equal((await act({op:'image-probe',jobId:'test',expected:2})).newImageReady,false);
    const result=await act({op:'attach-images',jobId:'test',images:[imagePayload,{...imagePayload,name:'2.png'}]});
    assert.equal(result.count,2);assert.deepEqual((await dom.eval('globalThis.receivedFiles')).map(f=>f.name),['1.png','2.png']);
    assert.equal((await act({op:'image-probe',jobId:'test',expected:2})).newImageReady,true);
    assert.equal((await act({op:'verify-post',jobId:'test',post:c})).valid,true);
  });
  await check('A와 B 사이 표시를 실제 이미지 컴포넌트로 대체',async()=>{
    const ref={...imagePayload,name:'FI.png',marker:'1'},post={...c,body:'A[[1]]BCDE',images:[ref],tags:[]};
    await positionFixture();await act({op:'fill',jobId:'position',post});
    await act({op:'prepare-image',jobId:'position',marker:'1'});
    await act({op:'attach-images',jobId:'position',images:[ref]});
    assert.equal((await act({op:'image-probe',jobId:'position',expected:1,imageIds:[ref.id]})).newImageReady,true);
    assert.equal((await act({op:'verify-post',jobId:'position',post,layout:buildLayout(post).blocks})).valid,true);
    assert.equal(await dom.eval(`document.querySelector('.se-main-container').textContent.includes('[[1]]')`),false);
  });
  await check('사진이 끝에 잘못 들어가면 최종 위치 검증 거부',async()=>{
    const ref={...imagePayload,name:'FI.png',marker:'1'},post={...c,body:'A[[1]]BCDE',images:[ref],tags:[]};
    await positionFixture(true);await act({op:'fill',jobId:'wrong',post});await act({op:'prepare-image',jobId:'wrong',marker:'1'});
    await act({op:'attach-images',jobId:'wrong',images:[ref]});await act({op:'image-probe',jobId:'wrong',expected:1,imageIds:[ref.id]});
    assert.equal((await act({op:'verify-post',jobId:'wrong',post,layout:buildLayout(post).blocks})).valid,false);
  });
  await check('편집기가 이미지 DOM을 교체해도 위치 확인 유지',async()=>{
    const ref={...imagePayload,name:'FI.png',marker:'1'},post={...c,body:'A[[1]]B',images:[ref],tags:[]};
    await positionFixture();await act({op:'fill',jobId:'replace',post});await act({op:'prepare-image',jobId:'replace',marker:'1'});
    await act({op:'attach-images',jobId:'replace',images:[ref]});await act({op:'image-probe',jobId:'replace',expected:1,imageIds:[ref.id]});
    await dom.eval(`(()=>{const old=document.querySelector('.se-image img'),img=old.cloneNode();Object.defineProperties(img,{currentSrc:{value:old.currentSrc+'?type=w773'},complete:{value:true},naturalWidth:{value:2}});old.replaceWith(img)})()`);
    assert.equal((await act({op:'verify-post',jobId:'replace',post,layout:buildLayout(post).blocks})).valid,true);
  });
  await check('중간 이미지 여러 장과 끝 첨부의 최종 순서 검증',async()=>{
    const first={...imagePayload,name:'FI.png',marker:'1'},second={...imagePayload,id:'e'.repeat(64),name:'F2.png',marker:'2'},tail={...imagePayload,id:'d'.repeat(64),name:'tail.png'};
    const post={...c,body:'A[[1]]B[[2]]CDE',images:[first,tail,second]},layout=buildLayout(post);
    await positionFixture();await act({op:'fill',jobId:'many',post});
    for(const g of layout.groups){await act({op:'prepare-image',jobId:'many',marker:g.marker});await act({op:'attach-images',jobId:'many',images:g.images.map(ref=>({...ref,data:imagePayload.data}))});await act({op:'image-probe',jobId:'many',expected:g.images.length,imageIds:g.images.map(r=>r.id)});}
    assert.equal((await act({op:'verify-post',jobId:'many',post,layout:layout.blocks})).valid,true);
  });
  await check('임시저장 완료는 새로운 성공 안내로만 인정',async()=>{
    await reset();await dom.eval(`document.getElementById('save').onclick=()=>setTimeout(()=>{const p=document.createElement('p');p.textContent='임시저장되었습니다';document.body.append(p)},100)`);
    const r=await act({op:'draft',jobId:'test'});assert.equal(r.saved,true);
  });
  await check('저장 실패 안내를 성공으로 오판하지 않음',async()=>{
    await reset();await dom.eval(`document.getElementById('save').onclick=()=>setTimeout(()=>{const p=document.createElement('p');p.textContent='저장이 실패했습니다';document.body.append(p)},100)`);
    const r=await act({op:'draft',jobId:'test'});assert.equal(r.saved,false);assert.equal(r.uncertain,true);
  });
  await check('발행 설정과 최종 발행 버튼을 순서대로 클릭',async()=>{
    await reset();await dom.eval(`globalThis.clicks=0;document.getElementById('first').onclick=()=>{globalThis.clicks++;const b=document.createElement('button');b.textContent='발행';b.onclick=()=>globalThis.clicks++;document.body.append(b)};`);
    const r=await act({op:'publish',jobId:'test'});assert.equal(r.submitted,true);assert.equal(await dom.eval('globalThis.clicks'),2);
  });
  await check('전송 직전 취소 차단',async()=>{
    await reset();await act({op:'cancel',jobId:'stop'});await assert.rejects(()=>act({op:'publish',jobId:'stop'}),/중단 요청/);
  });dom.close();
  for(const [file,needle] of [['legacy-dashboard.html','reviewStatus'],['missing-notice.html','notice']]) {
    await check(`화면 파일 불일치 복구 안내·미저장 원고 보존: ${file}`,async()=>{
      const target=await browser.call('Target.createTarget',{url:`chrome-extension://${extId}/${file}`});
      const info=await waitUntil(async()=> (await targets()).find(t=>t.id===target.targetId));const page=await CDP.connect(info.webSocketDebuggerUrl);await page.call('Runtime.enable');
      await waitUntil(()=>page.eval('!!document.getElementById("studio-recovery")'));
      assert.ok(await page.eval(`document.getElementById('studio-recovery').textContent.includes(${JSON.stringify(needle)})`));
      const rescue=await page.eval(`JSON.parse(document.getElementById('studio-rescue').value)`);
      assert.equal(rescue.format,'blog-posting-studio');assert.ok(!Object.hasOwn(rescue.composer,'apiKey'));
      if(file==='legacy-dashboard.html')assert.equal(rescue.composer.body,'미저장 복구 원고');
      assert.equal(await page.eval(`document.getElementById('saveKey').disabled`),true);
      await sleep(300);page.close();await browser.call('Target.closeTarget',{targetId:target.targetId});
    });
  }
  await check('실행 중 hidden/textContent 대상이 사라져도 Promise 예외 없이 중단',async()=>{
    await ui.eval(`document.getElementById('reviewBefore').remove();document.getElementById('body').dispatchEvent(new Event('input'))`);
    await waitUntil(()=>ui.eval('!!document.getElementById("studio-recovery")'));
    assert.equal(await ui.eval(`document.getElementById('runNow').disabled`),true);
    await sleep(300);assert.deepEqual(errors,[]);
  });
  console.log(`브라우저 통합 테스트 ${passed}개 통과. 실제 API 호출·네이버 실발행 없음.`);
} finally {
  ui?.close();sw?.close();
  try {await browser?.call('Browser.close');}catch{}browser?.close();
  child.kill();await sleep(500);
  const resolved=await realpath(profile).catch(()=>profile),temp=await realpath(tmpdir());
  if (path.dirname(resolved).toLowerCase()===temp.toLowerCase() && path.basename(resolved).startsWith('posting-studio-test-'))
    await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{});
}
