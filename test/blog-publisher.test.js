import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeComposer, normalizePost, parseGenerated, durationMs, dueTime, redact, recoverJobs, publicBackup, importDrafts, fingerprint, buildPrompt, validateComposer} from '../extensions/blog-publisher/core.js';
import {listModels, generate, review} from '../extensions/blog-publisher/api.js';
import {publishedUrl} from '../extensions/blog-publisher/naver.js';
import {imageType, inspectImage, normalizeImages, MAX_IMAGE_BYTES} from '../extensions/blog-publisher/images.js';
import {buildLayout, insertMarkerAt} from '../extensions/blog-publisher/layout.js';
import {parseReviewReply, reviewSignature, isReviewCurrent, buildReviewPrompt} from '../extensions/blog-publisher/review.js';
import {CLIENT_VERSION, requestMessage} from '../extensions/blog-publisher/client.js';
import {readFile} from 'node:fs/promises';

const c = normalizeComposer({provider:'openai',model:'text-model',keywords:'대원외고 영어',topic:'구문 분석',persona:'친절한 학습 코치',title:'제목',body:'본문',tags:['영어']});
const response = data => new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
test('BP-01 초 단위 지연과 절대 시각 검증',() => {
  assert.equal(durationMs(1,2,3),3723000);
  assert.equal(dueTime({mode:'delay',hours:1,minutes:2,seconds:3},1000),3724000);
  assert.equal(dueTime({mode:'at',at:'2030-01-01T00:00:01Z'},0),1893456001000);
  for (const args of [[-1,0,0],[0,60,0],[0,0,1.2]]) assert.throws(()=>durationMs(...args));
  assert.throws(()=>dueTime({mode:'at',at:'잘못된 시각'}));
  assert.throws(()=>dueTime({mode:'delay',seconds:0},1000));
});
test('BP-02 AI JSON 검증·제목 및 태그 제한',() => {
  assert.equal(parseGenerated('```json\n{"title":"제목","body":"본문"}\n```').body,'본문');
  assert.throws(()=>parseGenerated('<script>alert(1)</script>'));
  assert.throws(()=>parseGenerated('{"title":"빈글"}'));
  assert.equal(normalizePost({title:'가'.repeat(150),tags:['#영어','영어','수학']}).title.length,100);
  assert.deepEqual(normalizePost({tags:['#영어','영어','수학']}).tags,['영어','수학']);
});
test('BP-03 페르소나·키워드·주제와 사실성 지침 전달',() => {
  const prompt=buildPrompt(c);
  for (const s of ['대원외고 영어','구문 분석','친절한 학습 코치','학교 특성','JSON']) assert.ok(prompt.includes(s));
  assert.throws(()=>validateComposer({...c,persona:''},{generate:true}));
  assert.throws(()=>validateComposer({...c,action:'publish',blogId:'https://blog.naver.com/a'}));
});
test('BP-04 중복 지문은 원고/작업/블로그와 생성 주제를 구분',async () => {
  assert.equal(await fingerprint(c),await fingerprint({...c,persona:'변경'}));
  assert.notEqual(await fingerprint(c),await fingerprint({...c,action:'draft'}));
  assert.notEqual(await fingerprint({...c,title:'',body:''}),await fingerprint({...c,title:'',body:'',topic:'다른 주제'}));
});
test('BP-05 재시작 시 발행 중인 작업을 다시 보내지 않음',() => {
  const recovered=recoverJobs([{id:'a',status:'submitting'},{id:'b',status:'queued'},{id:'c',status:'done'}]);
  assert.equal(recovered[0].status,'needs_review');assert.equal(recovered[1].status,'queued');assert.equal(recovered[2].status,'done');
});
test('BP-06 백업은 키를 제외하고 가져오기는 임시저장만',() => {
  const backup=publicBackup({apiKeys:{openai:'private-key'},drafts:[{content:c}],composer:c,jobs:[{id:'a',content:c,status:'queued',fingerprint:'fp'}]});
  assert.ok(!JSON.stringify(backup).includes('private-key'));
  const drafts=importDrafts(backup);assert.equal(drafts.length,1);assert.equal(drafts[0].content.body,'본문');assert.equal(drafts[0].status,undefined);
  assert.throws(()=>importDrafts({format:'other',drafts:[]}));
});
test('BP-07 로그 키 마스킹',() => {
  const s=redact('err custom-secret sk-123456789abcdefgh', ['custom-secret']);
  assert.ok(!s.includes('custom-secret'));assert.ok(!s.includes('sk-'));
});
test('BP-08 OpenAI 모델 목록과 Responses 요청',async () => {
  const models=await listModels('openai','test-key',async (url,options) => {
    assert.equal(url,'https://api.openai.com/v1/models');assert.equal(options.headers.Authorization,'Bearer test-key');
    return response({data:[{id:'text-model'},{id:'text-embedding-3-small'},{id:'gpt-image-1'}]});
  });assert.deepEqual(models.map(m=>m.id),['text-model']);
  const out=await generate(c,'test-key',null,async (url,options) => {
    assert.ok(url.endsWith('/responses'));const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.model,c.model);
    return response({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({title:'AI 제목',body:'AI 본문'})}]}],usage:{output_tokens:25}});
  });assert.equal(out.title,c.title);assert.equal(out.usage.output_tokens,25);
});
test('BP-09 Claude 페이지 처리와 메시지 요청',async () => {
  let page=0;
  const models=await listModels('anthropic','test-key',async (url,options)=>{
    assert.equal(options.headers['x-api-key'],'test-key');page++;
    return response(page===1 ? {data:[{id:'claude-a'}],has_more:true,last_id:'claude-a'}:{data:[{id:'claude-b'}],has_more:false});
  });assert.equal(models.length,2);
  const out=await generate({...c,provider:'anthropic',title:''},'test-key',null,async (url,options)=>{
    assert.ok(url.endsWith('/messages'));assert.equal(JSON.parse(options.body).messages[0].role,'user');
    return response({content:[{type:'text',text:'{"title":"클로드","body":"본문"}'}]});
  });assert.equal(out.title,'클로드');
});
test('BP-10 Gemini 생성 지원 모델 필터와 키 헤더',async () => {
  const models=await listModels('gemini','test-key',async(url,options)=>{
    assert.ok(!url.includes('test-key'));assert.equal(options.headers['x-goog-api-key'],'test-key');
    return response({models:[{name:'models/gemini-text',supportedGenerationMethods:['generateContent']},{name:'models/embed',supportedGenerationMethods:['embedContent']}]});
  });assert.deepEqual(models.map(m=>m.id),['gemini-text']);
  const out=await generate({...c,provider:'gemini',model:'gemini-text',title:''},'test-key',null,async(url,options)=>{
    assert.ok(url.endsWith('/models/gemini-text:generateContent'));
    assert.equal(JSON.parse(options.body).generationConfig.responseMimeType,'application/json');
    return response({candidates:[{content:{parts:[{thought:true,text:'private reasoning'},{text:'{"title":"제미나이","body":"본문"}'}]}}]});
  });assert.equal(out.title,'제미나이');
});
test('BP-11 API 오류·요청취소·잘린 출력은 성공으로 처리하지 않음',async()=>{
  await assert.rejects(()=>listModels('openai','sk-secret123456',async()=>new Response('{"error":{"message":"bad sk-secret123456"}}',{status:401})),e=>!e.retryable && !e.message.includes('sk-secret123456'));
  await assert.rejects(()=>listModels('openai','key',async()=>new Response('{}',{status:429})),e=>e.retryable);
  await assert.rejects(()=>generate(c,'key',null,async()=>response({status:'incomplete'})),/중단/);
  const ctrl=new AbortController();ctrl.abort();
  await assert.rejects(()=>generate(c,'key',ctrl.signal,async()=>{throw new Error('abort');}),e=>!e.retryable);
});
test('BP-12 발행 완료 URL은 해당 블로그 글 주소만 인정',()=>{
  assert.equal(publishedUrl('https://blog.naver.com/teacher/123456','teacher'),'https://blog.naver.com/teacher/123456');
  assert.ok(publishedUrl('https://blog.naver.com/PostView.naver?blogId=teacher&logNo=123456','teacher'));
  for (const u of ['https://evil.test/teacher/123456','https://blog.naver.com/other/123456','https://blog.naver.com/PostWriteForm.naver?blogId=teacher']) assert.equal(publishedUrl(u,'teacher'),null);
});
test('BP-13 이미지 내용 확인·가짜 확장자·SVG 거부',()=>{
  assert.equal(imageType(new Uint8Array([137,80,78,71,13,10,26,10])),'image/png');
  assert.equal(imageType(new Uint8Array([255,216,255])),'image/jpeg');
  assert.equal(imageType(new TextEncoder().encode('GIF89a')),'image/gif');
  assert.equal(imageType(new TextEncoder().encode('RIFF1234WEBP')),'image/webp');
  assert.throws(()=>imageType(new TextEncoder().encode('<svg><script>bad</script></svg>')));
  assert.throws(()=>imageType(new TextEncoder().encode('not a png')));
});
test('BP-14 첨부 개수·크기·중복·총량·식별자 검증',()=>{
  const ref={id:'a'.repeat(64),name:'1.png',source:'test1/1.png',type:'image/png',size:100};
  assert.equal(normalizeComposer({...c,images:[ref]}).images[0].source,'test1/1.png');
  assert.throws(()=>normalizeImages([ref,ref]));
  assert.throws(()=>normalizeImages([{...ref,id:'file:///C:/secret.png'}]));
  assert.throws(()=>normalizeImages([{...ref,size:MAX_IMAGE_BYTES+1}]));
  assert.throws(()=>normalizeImages(Array.from({length:5},(_,i)=>({...ref,id:String(i).repeat(64),size:MAX_IMAGE_BYTES}))));
  assert.throws(()=>normalizeImages(Array.from({length:11},(_,i)=>({...ref,id:i.toString(16).repeat(64)}))));
});
test('BP-15 이미지 바이트 해시·용량·형식과 첨부별 중복 판정',async()=>{
  const bytes=new Uint8Array([137,80,78,71,13,10,26,10,0]),image=await inspectImage(new Blob([bytes]));
  assert.equal(image.size,9);assert.equal(image.type,'image/png');assert.match(image.id,/^[a-f0-9]{64}$/);
  const other=await inspectImage(new Blob([bytes,Uint8Array.of(1)]));assert.notEqual(image.id,other.id);
  await assert.rejects(()=>inspectImage(new Blob([])));
  await assert.rejects(()=>inspectImage(new Blob([new Uint8Array(MAX_IMAGE_BYTES+1)])));
  assert.notEqual(await fingerprint(c),await fingerprint({...c,images:[{...image,name:'1.png'}]}));
});
test('BP-16 원고 백업과 복원은 이미지 참조·순서를 유지',()=>{
  const images=[{id:'a'.repeat(64),name:'1.png',source:'test1/1.png',type:'image/png',size:100},
    {id:'b'.repeat(64),name:'2.jpg',source:'test1/2.jpg',type:'image/jpeg',size:200}];
  const content=normalizeComposer({...c,images});
  const restored=importDrafts(publicBackup({composer:content,drafts:[],jobs:[]}));
  assert.deepEqual(restored[0].content.images,images);
  const prompt=buildPrompt(content);assert.ok(!prompt.includes(images[0].id));assert.ok(!prompt.includes('test1/1.png'));
});
const fi={id:'f'.repeat(64),name:'FI.png',source:'test1/FI.png',size:100,type:'image/png',marker:'1'};
test('BP-17 A와 B 사이 표시를 이미지 블록으로 치환·일반 숫자 보존',()=>{
  const layout=buildLayout({...c,body:'A[[1]]BCDE 1',tags:[],images:[fi]});
  assert.deepEqual(layout.blocks.map(b=>b.type==='text'?b.text:b.images[0].name),['A','FI.png','BCDE 1']);
  assert.equal(layout.groups[0].marker,'1');
});
test('BP-18 중복·미연결·누락 삽입 표시는 실행 전에 거부',()=>{
  for(const body of ['A[[1]]B[[1]]C','A[[2]]B','ABCDE'])assert.throws(()=>validateComposer({...c,body,images:[fi]}));
  assert.throws(()=>buildLayout({...c,body:'A[[unknown]]B'}));
  assert.throws(()=>normalizeImages([fi,{...fi,id:'e'.repeat(64)}]));
  assert.throws(()=>normalizeImages([{...fi,marker:'bad marker'}]));
});
test('BP-19 커서 삽입·기존 표시 이동은 본문을 보존',()=>{
  const inserted=insertMarkerAt('ABCDE','1',1);
  assert.equal(inserted.body,'A\n\n[[1]]\n\nBCDE');
  const moved=insertMarkerAt('A[[1]]BCDE','1',9);
  assert.equal(moved.body.replace(/\s/g,''),'ABCD[[1]]E');
  assert.equal((moved.body.match(/\[\[1\]\]/g)||[]).length,1);
});
test('BP-20 본문 순서·끝 첨부·백업·중복 판정에 위치 반영',async()=>{
  const tail={...fi,id:'d'.repeat(64),marker:'',name:'tail.png'};
  const second={...fi,id:'e'.repeat(64),marker:'FI2',name:'2.png'};
  const post={...c,body:'A[[FI2]]B[[1]]C',images:[fi,tail,second]};
  const layout=buildLayout(post);
  assert.deepEqual(layout.groups.map(g=>g.marker),['','FI2','1']);
  assert.equal(layout.blocks.at(-1).images[0].name,'tail.png');
  const restored=importDrafts(publicBackup({composer:post,drafts:[],jobs:[]}));assert.equal(restored[0].content.images[0].marker,'1');
  assert.ok(buildPrompt(post).includes('[[FI2]]'));
  assert.notEqual(await fingerprint(post),await fingerprint({...post,images:[{...fi,marker:'3'},tail,second]}));
});
const checkedReply=(input,extra={})=>({title:input.title,body:input.body,tags:input.tags,approved:true,
  checks:{titleMatch:true,scopeMatch:true,personaMatch:true},issues:[],summary:'제목과 본문 일치',...extra});
test('BP-21 제목을 고정하고 주제 이탈 원고를 교정하는 별도 API 요청',async()=>{
  const input=normalizeComposer({...c,title:'짜장면 레시피',body:'짜파게티 봉지의 스프를 넣습니다.',persona:'친절한 요리 설명자',topic:'짜파게티'});
  const out=await review(input,'test-key',null,async(url,options)=>{
    const prompt=JSON.parse(options.body).input;
    assert.ok(prompt.includes('TITLE_BODY_REVIEW'));assert.ok(prompt.includes('짜장면 레시피'));assert.ok(prompt.includes('친절한 요리 설명자'));
    return response({output:[{content:[{type:'output_text',text:JSON.stringify(checkedReply(input,{body:'춘장과 채소로 소스를 만들어 면에 올립니다.',issues:['인스턴트 제품 조리법을 제목이 요구하는 짜장면 조리 내용으로 수정'],summary:'주제 이탈 교정'}))}]}]});
  });
  assert.equal(out.title,input.title);assert.ok(!out.body.includes('짜파게티'));assert.equal(out.review.changed,true);
  assert.equal(out.review.originalBody,input.body);assert.equal(await isReviewCurrent({...input,...out}),true);
});
test('BP-22 제목 변경·불승인·불완전 판정을 통과로 처리하지 않음',async()=>{
  for(const change of [{title:'다른 제목'},{approved:false},{checks:{titleMatch:false,scopeMatch:true,personaMatch:true}},{checks:{titleMatch:'true',scopeMatch:true,personaMatch:true}},{body:''}])
    await assert.rejects(()=>parseReviewReply(JSON.stringify(checkedReply(c,change)),c));
});
test('BP-23 검수 전후 이미지 표시·순서 보존',async()=>{
  const second={...fi,id:'b'.repeat(64),marker:'2'};
  const input={...c,body:'A[[1]]B[[2]]C',images:[fi,second]};
  for(const body of ['A[[1]]BC','A[[2]]B[[1]]C','A[[1]]B[[2]]C[[3]]'])
    await assert.rejects(()=>parseReviewReply(JSON.stringify(checkedReply(input,{body,issues:['내용 수정']})),input),/삽입 표시/);
  const out=await parseReviewReply(JSON.stringify(checkedReply(input,{body:'교정 A[[1]]교정 B[[2]]C',issues:['제목에 맞춰 설명 수정']})),input);
  assert.equal(out.review.status,'approved');
});
test('BP-24 제목·본문·페르소나 변경 시 재검수, 발행 방식 변경은 재사용',async()=>{
  const out=await parseReviewReply(JSON.stringify(checkedReply(c)),c),approved={...c,...out};
  for(const change of [{title:'수정 제목'},{body:'수정 본문'},{persona:'다른 사람'},{references:'새 자료'},{model:'다른 모델'}])
    assert.equal(await isReviewCurrent({...approved,...change}),false);
  assert.equal(await isReviewCurrent({...approved,action:'draft',blogId:'anotherblog'}),true);
  assert.equal(out.review.signature,await reviewSignature(approved));
});
test('BP-25 가져온 원고는 승인 기록을 재사용하지 않으며 검수 중 재시작은 정지',async()=>{
  const out=await parseReviewReply(JSON.stringify(checkedReply(c)),c);
  const restored=importDrafts(publicBackup({composer:{...c,...out},drafts:[],jobs:[]}));
  assert.equal(restored[0].content.review,null);
  assert.equal(recoverJobs([{status:'reviewing'}])[0].status,'needs_review');
});
test('BP-26 수정 이유 없는 교정·잘못된 JSON은 거부',async()=>{
  await assert.rejects(()=>parseReviewReply(JSON.stringify(checkedReply(c,{body:'새 본문'})),c),/수정 이유/);
  await assert.rejects(()=>parseReviewReply(JSON.stringify(checkedReply(c,{body:'새 본문',issues:[{}]})),c),/수정 이유/);
  await assert.rejects(()=>parseReviewReply('not-json',c),/JSON/);
  assert.ok(buildReviewPrompt(c).includes('제목을 본문에 맞춰 바꾸지 말고'));
});
test('BP-27 확장 연결 끊김·백그라운드 없음은 사용자 안내로 구분',async()=>{
  await assert.rejects(()=>requestMessage('key',{key:'secret-key'},{}),e=>e.code==='CONTEXT_INVALID');
  for(const [message,code] of [['Extension context invalidated.','CONTEXT_INVALID'],['Could not establish connection. Receiving end does not exist.','WORKER_UNAVAILABLE']]) {
    let calls=0;
    await assert.rejects(()=>requestMessage('key',{key:'secret-key'},{id:'test',sendMessage:async()=>{calls++;throw new Error(message);}}),e=>e.code===code && !e.message.includes('secret-key'));
    assert.equal(calls,1);
  }
});
test('BP-28 무응답·구버전 응답은 성공으로 처리하지 않음',async()=>{
  for(const [response,code] of [[undefined,'NO_RESPONSE'],[{ok:true,data:true},'VERSION_MISMATCH'],[{ok:true,data:true,version:'1.1.0'},'VERSION_MISMATCH']])
    await assert.rejects(()=>requestMessage('state',{}, {id:'test',sendMessage:async()=>response}),e=>e.code===code);
});
test('BP-29 메시지 버전·작업 실패·검수 보고서를 유지하고 키를 가림',async()=>{
  const value=await requestMessage('state',{}, {id:'test',sendMessage:async m=>{assert.equal(m.clientVersion,CLIENT_VERSION);return {ok:true,data:42,version:CLIENT_VERSION};}});
  assert.equal(value,42);
  await assert.rejects(()=>requestMessage('key',{key:'private-api-token'},{id:'test',sendMessage:async m=>m.cmd==='hello' ? {ok:true,data:true,version:CLIENT_VERSION}:({ok:false,error:'bad private-api-token',code:'OPERATION_FAILED',version:CLIENT_VERSION,review:{status:'blocked'}})}),e=>e.code==='OPERATION_FAILED' && !e.message.includes('private-api-token') && e.review.status==='blocked');
});
test('BP-30 배포 manifest와 화면 통신 버전 일치',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../extensions/blog-publisher/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.version,CLIENT_VERSION);
});
test('BP-31 구버전 워커에는 키 저장·게시 요청을 보내기 전에 중단',async()=>{
  const calls=[];
  await assert.rejects(()=>requestMessage('enqueue',{content:c},{id:'test',sendMessage:async m=>{calls.push(m.cmd);return {ok:true,data:true};}}),e=>e.code==='VERSION_MISMATCH');
  assert.deepEqual(calls,['hello']);
});
