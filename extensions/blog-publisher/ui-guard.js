export const DASHBOARD_IDS = `notice keyStatus backup importBtn importFile write queue drafts logs
provider apiKey saveKey rememberKey forgetKey models loadModels model keywords topic persona audience tone length references instructions generate generating
title body tags charCount previewBtn copy saveDraft newPost reviewPost reviewStatus reviewSummary reviewIssues reviewBefore reviewOriginal
imageCount clearImages chooseFolder chooseFiles pruneImages imageFolder imageFiles imageList autoSave autoH autoM autoS saveStatus
blogId action scheduleMode atBox at timeZone delayBox delayH delayM delayS runNow schedule pause cleanJobs queueSummary jobs draftList
logView logLevel logSearch exportLogs clearLogs logRows preview closePreview previewTitle previewBody previewTags previewImages
folderPicker closeFolder folderSearch folderInfo folderOptions attachFolderImages`.split(/\s+/);

export class DashboardLayoutError extends Error {
  constructor(ids){super(`화면 구성 요소가 누락됐습니다: ${ids.join(', ')}`);this.code='UI_LAYOUT_MISMATCH';}
}
export function requiredElement(id,doc=document) {
  const el=doc.getElementById(id);if(!el)throw new DashboardLayoutError([id]);return el;
}
export function checkDashboard(doc,version) {
  const missing=DASHBOARD_IDS.filter(id=>!doc.getElementById(id));
  const actual=doc.querySelector('meta[name="studio-ui-version"]')?.content;
  return {ok:!missing.length && actual===version,message:missing.length ? new DashboardLayoutError(missing).message
    :`화면 버전 ${actual || '이전 버전'}과 스크립트 버전 ${version}이 다릅니다.`};
}
export function showRecovery(message,doc=document,extra={}) {
  let panel=doc.getElementById('studio-recovery');
  if(panel)return;
  const make=(tag,text)=>{const n=doc.createElement(tag);n.textContent=text || '';return n;};
  panel=make('section');panel.id='studio-recovery';panel.setAttribute('role','alert');
  panel.style.cssText='position:relative;z-index:99999;margin:20px;padding:22px;border:2px solid #bd582a;border-radius:12px;background:#fff8f1;color:#382819;font:14px/1.7 sans-serif;';
  panel.append(make('h2','화면 파일을 다시 불러와야 합니다'),make('p',message),make('p','새 화면 파일과 이전 화면이 섞였거나 필수 요소가 빠져 이 화면의 추가 요청을 멈췄습니다. 아래에 현재 입력을 보관했습니다. 백업 후 확장을 새로고침하고 이 탭을 다시 여세요. 저장된 원고·사진·API 키는 삭제하지 않습니다.'));
  const composer={};
  for(const id of ['title','body','tags','keywords','topic','persona','audience','tone','length','references','instructions','blogId','action','provider','model']) {
    const el=doc.getElementById(id);if(el)composer[id]=el.value;
  }
  if(Array.isArray(extra.images))composer.images=extra.images;
  const rescue=make('textarea');rescue.id='studio-rescue';rescue.readOnly=true;rescue.rows=7;rescue.setAttribute('aria-label','현재 입력 원고 복구용 백업');
  rescue.style.cssText='display:block;width:100%;margin:10px 0;font:12px/1.5 monospace;';
  rescue.value=JSON.stringify({format:'blog-posting-studio',version:1,composer,drafts:[],jobs:[]},null,2);
  const download=make('button','현재 입력 백업 받기');download.type='button';
  download.addEventListener('click',()=>{
    const url=URL.createObjectURL(new Blob([rescue.value],{type:'application/json'})),a=doc.createElement('a');
    a.href=url;a.download='블로그스튜디오_화면복구_원고.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  });
  panel.append(rescue,download);
  for(const el of doc.querySelectorAll('button,input,select,textarea'))if(!panel.contains(el))el.disabled=true;
  for(const dialog of doc.querySelectorAll('dialog[open]'))dialog.close();
  doc.body.prepend(panel);
  panel.tabIndex=-1;panel.scrollIntoView({block:'start'});panel.focus({preventScroll:true});
}
