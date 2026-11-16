import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {naverEditor} from '../extensions/blog-publisher/naver.js';

// Fresh test profile only. No user cookies, API keys, or live Naver posting.
const root=process.cwd(),extension=path.join(root,'extensions/blog-publisher');
const profile=await mkdtemp(path.join(tmpdir(),'posting-studio-test-'));
const executable=process.env.BLOG_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const child=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,
  '--remote-debugging-port=0',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let browser,sw,ui,errors=[],passed=0,imagePayload;
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
const msg=(cmd,values={})=>ui.eval(`chrome.runtime.sendMessage(${JSON.stringify({cmd,...values})})`);
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
  await check('세 제공자·초 단위 날짜·시분초 입력',async()=>assert.deepEqual(await ui.eval('[document.getElementById("provider").options.length,document.getElementById("at").step,!!document.getElementById("delayS"),!!document.getElementById("autoS")]'),[3,'1',true,true]));
  await check('API 키 세션 보관·모델 조회·생성 mock',async()=>{
    const keyResult=await msg('key',{provider:'openai',key:'test-only-key',remember:false});
    assert.equal(keyResult?.ok,true,JSON.stringify(keyResult));
    await sw.eval(`globalThis.fetch = async (url, options) => new Response(JSON.stringify(url.endsWith('/models') ? {data:[{id:'mock-text'}]} : {status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({title:'모의 생성 제목',body:'모의 생성 본문',tags:['영어']})}]}]}),{status:200});`);
    const models=await msg('models',{provider:'openai'});assert.equal(models.data[0].id,'mock-text');
    const out=await msg('generate',{content:c});assert.equal(out.data.title,'모의 생성 제목');
    assert.equal(await sw.eval('(async () => (await chrome.storage.local.get("apiKeys")).apiKeys?.openai || null)()'),null);
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
    const s=(await msg('state')).data;assert.equal(s.drafts.length,1);assert.ok(s.logs.some(l=>l.step==='DONE'));
  });
  await check('예약 취소 후 실행 안 함',async()=>{
    const r=await msg('enqueue',{content:{...c,title:'취소할 글'},schedule:{mode:'delay',seconds:2}});
    await msg('cancel',{id:r.data.id});await sleep(2100);await msg('tick');
    const s=(await msg('state')).data;assert.equal(s.jobs.find(j=>j.id===r.data.id).status,'cancelled');assert.equal(s.drafts.length,1);
  });
  await check('생성 예약 실행 및 작업 결과 보존',async()=>{
    const r=await msg('enqueue',{content:{...c,title:'',body:'',topic:'생성 예약 테스트'}});
    await waitUntil(async()=> (await msg('state')).data.jobs.find(j=>j.id===r.data.id)?.status==='done');
    const s=(await msg('state')).data;assert.equal(s.jobs.find(j=>j.id===r.data.id).content.title,'모의 생성 제목');
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
    const r=await msg('enqueue',{content:{...c,title:'사진 포함 네이버 저장 테스트',action:'draft',blogId:'testblog',images:imageJob.content.images}});
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
  console.log(`브라우저 통합 테스트 ${passed}개 통과. 실제 API 호출·네이버 실발행 없음.`);
} finally {
  ui?.close();sw?.close();
  try {await browser?.call('Browser.close');}catch{}browser?.close();
  child.kill();await sleep(500);
  const resolved=await realpath(profile).catch(()=>profile),temp=await realpath(tmpdir());
  if (path.dirname(resolved).toLowerCase()===temp.toLowerCase() && path.basename(resolved).startsWith('posting-studio-test-'))
    await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{});
}
