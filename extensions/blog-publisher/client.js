import {redact} from './core.js';

export const CLIENT_VERSION='1.3.9';
export async function openDashboard(browser=globalThis.chrome) {
  const base=browser.runtime.getURL('dashboard.html');
  const url=`${base}?v=${encodeURIComponent(browser.runtime.getManifest().version)}`;
  const tabs=await browser.tabs.query({url:`${base}*`});
  const current=tabs.find(tab=>(tab.pendingUrl || tab.url)?.split('#')[0]===url);
  // Preserve unsaved input in old-version tabs instead of reusing or reloading them.
  if(!current)return browser.tabs.create({url});
  await browser.tabs.update(current.id,{active:true});
  await browser.windows.update(current.windowId,{focused:true});
  return current;
}
export class StudioError extends Error {
  constructor(message,code,review){super(message);this.code=code;this.review=review;}
}
export function connectionError(error,secrets=[]) {
  const message=redact(error?.message || String(error),secrets);
  if(/context invalidated|extension.*invalid|확장.*무효/i.test(message))
    return new StudioError('확장 연결이 끊겼습니다. 현재 원고를 복사해 보관한 뒤, 확장 프로그램을 새로고침하고 기존 대시보드 탭을 닫아 다시 여세요.','CONTEXT_INVALID');
  if(/receiving end does not exist|could not establish connection|message port closed|channel closed|응답.*없|수신.*없/i.test(message))
    return new StudioError('백그라운드와 연결하지 못했습니다. chrome://extensions에서 스튜디오의 새로고침을 누른 뒤 대시보드를 다시 여세요. 계속되면 서비스 워커 오류 메시지를 확인하세요.','WORKER_UNAVAILABLE');
  return new StudioError(`확장 통신 오류: ${message.slice(0,300)}`,'TRANSPORT_ERROR');
}
export async function requestMessage(cmd,values={},runtime=globalThis.chrome?.runtime) {
  if(!runtime?.id || typeof runtime.sendMessage!=='function')
    throw new StudioError('확장 프로그램 연결이 없습니다. 확장 아이콘에서 대시보드를 새로 여세요.','CONTEXT_INVALID');
  let response;
  try {
    // Check a read-only handshake before any action; an old worker must never execute a new client's post request.
    if(cmd!=='state') {
      const hello=await runtime.sendMessage({cmd:'hello',clientVersion:CLIENT_VERSION});
      if(!hello || hello.version!==CLIENT_VERSION)
        throw new StudioError('대시보드와 백그라운드 버전이 다릅니다. 확장을 새로고침한 뒤 기존 대시보드를 닫고 다시 여세요.','VERSION_MISMATCH');
      if(!hello.ok)throw new StudioError(redact(hello.error || '백그라운드 초기화에 실패했습니다.',[values.key]),hello.code || 'WORKER_UNAVAILABLE',hello.review);
    }
    response=await runtime.sendMessage({cmd,...values,clientVersion:CLIENT_VERSION});
  }
  catch(e){if(e instanceof StudioError)throw e;throw connectionError(e,[values.key]);}
  if(!response || typeof response.ok!=='boolean')
    throw new StudioError('백그라운드가 정상 응답을 보내지 않았습니다. 확장 프로그램을 새로고침하고 대시보드를 다시 여세요.','NO_RESPONSE');
  if(response.version!==CLIENT_VERSION)
    throw new StudioError(`화면 버전 ${CLIENT_VERSION}과 백그라운드 버전 ${response.version || '이전 버전'}이 다릅니다. chrome://extensions에서 새로고침한 뒤 기존 대시보드를 닫고 확장 아이콘으로 다시 여세요.`,'VERSION_MISMATCH');
  if(!response.ok)throw new StudioError(redact(response.error || '요청 처리에 실패했습니다.',[values.key]),response.code || 'OPERATION_FAILED',response.review);
  return response.data;
}
