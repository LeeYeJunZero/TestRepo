import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeComposer, normalizePost, parseGenerated, durationMs, dueTime, redact, recoverJobs, publicBackup, importDrafts, fingerprint, buildPrompt, validateComposer} from '../extensions/blog-publisher/core.js';
import {listModels, generate} from '../extensions/blog-publisher/api.js';
import {publishedUrl} from '../extensions/blog-publisher/naver.js';

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
  });assert.equal(out.title,'AI 제목');assert.equal(out.usage.output_tokens,25);
});
test('BP-09 Claude 페이지 처리와 메시지 요청',async () => {
  let page=0;
  const models=await listModels('anthropic','test-key',async (url,options)=>{
    assert.equal(options.headers['x-api-key'],'test-key');page++;
    return response(page===1 ? {data:[{id:'claude-a'}],has_more:true,last_id:'claude-a'}:{data:[{id:'claude-b'}],has_more:false});
  });assert.equal(models.length,2);
  const out=await generate({...c,provider:'anthropic'},'test-key',null,async (url,options)=>{
    assert.ok(url.endsWith('/messages'));assert.equal(JSON.parse(options.body).messages[0].role,'user');
    return response({content:[{type:'text',text:'{"title":"클로드","body":"본문"}'}]});
  });assert.equal(out.title,'클로드');
});
test('BP-10 Gemini 생성 지원 모델 필터와 키 헤더',async () => {
  const models=await listModels('gemini','test-key',async(url,options)=>{
    assert.ok(!url.includes('test-key'));assert.equal(options.headers['x-goog-api-key'],'test-key');
    return response({models:[{name:'models/gemini-text',supportedGenerationMethods:['generateContent']},{name:'models/embed',supportedGenerationMethods:['embedContent']}]});
  });assert.deepEqual(models.map(m=>m.id),['gemini-text']);
  const out=await generate({...c,provider:'gemini',model:'gemini-text'},'test-key',null,async(url,options)=>{
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
