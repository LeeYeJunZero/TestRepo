import {PROVIDERS, buildPrompt, parseGenerated, redact} from './core.js';

export class ApiError extends Error {
  constructor(message, retryable = false) { super(message); this.retryable = retryable; }
}
function auth(provider, key) {
  if (provider === 'anthropic') return {'x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'};
  if (provider === 'gemini') return {'x-goog-api-key':key};
  return {Authorization:`Bearer ${key}`};
}
async function request(provider, key, path, body, signal, fetcher = fetch) {
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
  if (!response.ok) throw new ApiError(`API ${response.status}: ${redact(data.error?.message || '요청 실패',[key]).slice(0,500)}`,
    response.status === 429 || response.status >= 500);
  return data;
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
export async function generate(c, key, signal, fetcher = fetch) {
  const prompt = buildPrompt(c);
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
  return {...parseGenerated(output), usage:data.usage || data.usageMetadata || null};
}
