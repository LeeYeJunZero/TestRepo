import {PROVIDERS, buildPrompt, parseGenerated, redact} from './core.js';
import {buildReviewPrompt, validateReviewInput, parseReviewReply} from './review.js';

export class ApiError extends Error {
  constructor(message, retryable = false) { super(message); this.retryable = retryable; }
}
function auth(provider, key) {
  if (provider === 'anthropic') return {'x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'};
  if (provider === 'gemini') return {'x-goog-api-key':key};
  return {Authorization:`Bearer ${key}`};
}
async function requestOnce(provider, key, path, body, signal, fetcher = fetch) {
  if (!Object.hasOwn(PROVIDERS, provider) || !key) throw new ApiError('API 제공자와 키를 설정하세요.');
  let response;
  try {
    response = await fetcher(PROVIDERS[provider].base + path, {
      method:body ? 'POST':'GET', headers:{...auth(provider,key),...(body ? {'Content-Type':'application/json'} : {})},
      ...(body ? {body:JSON.stringify(body)} : {}), signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(120000)]) : AbortSignal.timeout(body ? 120000:30000),
      credentials:'omit', redirect:'error'
    });
  } catch (e) {
    if (signal?.aborted) throw new ApiError('작업을 중단했습니다.');
    throw new ApiError(`API 연결 실패: ${redact(e.message,[key])}`, true);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error=new ApiError(response.status===503
      ? 'API 503: 선택한 모델의 서버가 혼잡합니다. 잠시 후 다시 시도하거나 API 모델을 변경하세요. 원고는 유지됩니다.'
      : `API ${response.status}: ${redact(data.error?.message || '요청 실패',[key]).slice(0,500)}`,
      response.status === 429 || response.status >= 500);
    error.status=response.status;throw error;
  }
  return data;
}
async function request(provider,key,path,body,signal,fetcher=fetch) {
  try{return await requestOnce(provider,key,path,body,signal,fetcher);}
  catch(e){
    if(e.status!==503 || signal?.aborted)throw e;
    await new Promise(resolve=>setTimeout(resolve,1000));
    if(signal?.aborted)throw new ApiError('작업을 중단했습니다.');
    return requestOnce(provider,key,path,body,signal,fetcher);
  }
}
export async function listModels(provider, key, fetcher = fetch) {
  let list = [], cursor = '';
  for (let page = 0; page < 10; page++) {
    const path = provider === 'gemini' ? `/models?pageSize=1000${cursor ? '&pageToken='+encodeURIComponent(cursor):''}`
      : provider === 'anthropic' ? `/models?limit=1000${cursor ? '&after_id='+encodeURIComponent(cursor):''}` : '/models';
    const r = await request(provider,key,path,null,null,fetcher);
    list.push(...(provider === 'gemini' ? (r.models || []).filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => ({id:m.name.replace(/^models\//,''),name:m.displayName || m.name}))
      : (r.data || []).filter(m => provider !== 'openai' || !/embed|whisper|tts|audio|realtime|image|dall-e|moderation|transcri|sora/i.test(m.id))
      .map(m => ({id:m.id,name:m.display_name || m.id}))));
    cursor = provider === 'gemini' ? r.nextPageToken : provider === 'anthropic' && r.has_more ? r.last_id : '';
    if (!cursor) break;
  }
  return [...new Map(list.map(m => [m.id,m])).values()].sort((a,b) => a.name.localeCompare(b.name));
}
async function complete(c, key, prompt, signal, fetcher = fetch) {
  let data, output;
  if (c.provider === 'openai') {
    data = await request(c.provider,key,'/responses',{model:c.model,input:prompt,max_output_tokens:12000,store:false},signal,fetcher);
    output = (data.output || []).flatMap(o => o.content || []).filter(p => p.type === 'output_text').map(p => p.text).join('');
    if (data.status === 'incomplete') throw new ApiError('API 응답이 길이 제한으로 중단됐습니다. 목표 글 길이를 줄이세요.');
  } else if (c.provider === 'anthropic') {
    data = await request(c.provider,key,'/messages',{model:c.model,max_tokens:12000,messages:[{role:'user',content:prompt}]},signal,fetcher);
    output = (data.content || []).filter(p => p.type === 'text').map(p => p.text).join('');
    if (data.stop_reason === 'max_tokens') throw new ApiError('API 응답이 잘렸습니다. 목표 글 길이를 줄이세요.');
  } else {
    data = await request(c.provider,key,`/models/${encodeURIComponent(c.model)}:generateContent`,{
      contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:12000}
    },signal,fetcher);
    output = (data.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    if (data.candidates?.[0]?.finishReason === 'MAX_TOKENS') throw new ApiError('API 응답이 잘렸습니다. 목표 글 길이를 줄이세요.');
  }
  if (!output) throw new ApiError('텍스트가 반환되지 않았습니다. 선택한 모델의 텍스트 생성 지원과 API 정책을 확인하세요.');
  return {output,usage:data.usage || data.usageMetadata || null};
}
export async function generate(c,key,signal,fetcher=fetch) {
  const r=await complete(c,key,buildPrompt(c),signal,fetcher),draft=parseGenerated(r.output);
  return {...draft,title:c.title || draft.title,usage:r.usage};
}
export async function review(c,key,signal,fetcher=fetch) {
  validateReviewInput(c);
  const r=await complete(c,key,buildReviewPrompt(c),signal,fetcher);
  return {...await parseReviewReply(r.output,c),usage:r.usage};
}
