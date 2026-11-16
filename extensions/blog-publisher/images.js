export const MAX_IMAGES = 10, MAX_IMAGE_BYTES = 10 * 1024 * 1024, MAX_POST_IMAGE_BYTES = 40 * 1024 * 1024;
export const MAX_BACKUP_IMAGE_BYTES = 100 * 1024 * 1024;
const DB_NAME = 'postingStudioImages';
let connection;
export function normalizeMarker(raw = '') {
  const marker=String(raw || '').trim().replace(/^\[\[([^\[\]]+)\]\]$/,'$1');
  if (marker && !/^[A-Za-z0-9가-힣_-]{1,40}$/.test(marker)) throw new Error('삽입 표시는 한글·영문·숫자·밑줄·하이픈 1~40자로 입력하세요. 예: 1, FI');
  return marker;
}

export function normalizeImages(raw = []) {
  if (!Array.isArray(raw) || raw.length > MAX_IMAGES) throw new Error(`이미지는 원고당 최대 ${MAX_IMAGES}장입니다.`);
  const seen = new Set(), markers=new Set();
  const result = raw.map(r => {
    if (!r || !/^[a-f0-9]{64}$/.test(r.id) || !Number.isSafeInteger(r.size) || r.size <= 0 || r.size > MAX_IMAGE_BYTES
      || !['image/png','image/jpeg','image/gif','image/webp'].includes(r.type) || seen.has(r.id))
      throw new Error('이미지 첨부 정보가 올바르지 않습니다. 파일을 다시 선택하세요.');
    seen.add(r.id);
    const marker=normalizeMarker(r.marker);
    if (marker && markers.has(marker)) throw new Error(`삽입 표시 [[${marker}]]가 여러 이미지에 연결돼 있습니다.`);
    if (marker) markers.add(marker);
    return {id:r.id,name:String(r.name || 'image').replace(/[\\/\x00-\x1f]/g,'_').slice(0,200),
      source:String(r.source || r.name || '').replace(/[\x00-\x1f]/g,'').slice(0,500),type:r.type,size:r.size,...(marker ? {marker}:{})};
  });
  if (result.reduce((n,r) => n+r.size,0) > MAX_POST_IMAGE_BYTES) throw new Error('한 원고의 이미지 합계는 40MB 이하여야 합니다.');
  return result;
}
export function imageType(bytes) {
  if (bytes[0]===137 && bytes[1]===80 && bytes[2]===78 && bytes[3]===71 && bytes[4]===13 && bytes[5]===10 && bytes[6]===26 && bytes[7]===10) return 'image/png';
  if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'image/jpeg';
  const ascii = (start,end) => String.fromCharCode(...bytes.slice(start,end));
  if (['GIF87a','GIF89a'].includes(ascii(0,6))) return 'image/gif';
  if (ascii(0,4)==='RIFF' && ascii(8,12)==='WEBP') return 'image/webp';
  throw new Error('PNG·JPG·GIF·WebP 이미지 파일만 첨부할 수 있습니다. 확장자가 아닌 파일 내용을 확인합니다.');
}
export async function inspectImage(blob) {
  if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_IMAGE_BYTES) throw new Error('이미지는 장당 10MB 이하여야 합니다.');
  const bytes = new Uint8Array(await blob.arrayBuffer()), type = imageType(bytes);
  const id = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b => b.toString(16).padStart(2,'0')).join('');
  return {id,type,size:bytes.length};
}
function db() {
  if (!connection) connection = new Promise((resolve,reject) => {
    const request = indexedDB.open(DB_NAME,1);
    request.onupgradeneeded = () => request.result.createObjectStore('images',{keyPath:'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {connection=null;reject(request.error);};
  });
  return connection;
}
async function access(mode,fn) {
  const database = await db();
  return new Promise((resolve,reject) => {
    const tx=database.transaction('images',mode), request=fn(tx.objectStore('images'));
    tx.oncomplete=()=>resolve(request?.result);
    tx.onerror=()=>reject(tx.error || new Error('이미지 저장소 오류'));
    tx.onabort=()=>reject(tx.error || new Error('이미지 보관을 완료하지 못했습니다.'));
  });
}
export async function storeImage(file,source = file.webkitRelativePath || file.name) {
  const meta=await inspectImage(file);
  // Decode before storing; a renamed text file or a corrupt image must not reach the uploader.
  const bitmap=await createImageBitmap(file);
  if (bitmap.width*bitmap.height > 60000000) {bitmap.close();throw new Error('이미지는 6천만 화소 이하로 줄여 주세요.');}
  bitmap.close();
  const ref=normalizeImages([{...meta,name:file.name || 'image',source}])[0];
  await access('readwrite',s => s.put({...ref,blob:new Blob([file],{type:meta.type}),createdAt:Date.now()}));
  return ref;
}
export async function getImage(ref) {
  const asset=await access('readonly',s => s.get(ref.id));
  if (!asset || !(asset.blob instanceof Blob) || asset.size!==ref.size || asset.type!==ref.type || asset.blob.size!==ref.size)
    throw new Error(`첨부 이미지 '${ref.name}'의 저장본이 없습니다. 파일을 다시 선택하세요.`);
  return asset;
}
export async function ensureImages(refs = []) {for (const ref of normalizeImages(refs)) await getImage(ref);}
export function encodeBase64(bytes) {
  let s='';for (let i=0;i<bytes.length;i+=32768) s+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(s);
}
export async function imagePayload(ref) {
  const asset=await getImage(ref);
  return {...ref,data:encodeBase64(new Uint8Array(await asset.blob.arrayBuffer()))};
}
export function referencedImages(state) {
  const contents=[state.composer,...(state.drafts || []).map(d=>d.content),...(state.jobs || []).map(j=>j.content)];
  return [...new Map(contents.flatMap(c=>c?.images || []).map(ref=>[ref.id,ref])).values()];
}
export async function exportImages(refs) {
  if (refs.reduce((n,r)=>n+r.size,0)>MAX_BACKUP_IMAGE_BYTES) throw new Error('이미지 포함 백업은 100MB까지 지원합니다. 오래된 원고를 정리하고 다시 백업하세요.');
  const result=[];for (const ref of refs) result.push(await imagePayload(ref));return result;
}
export async function importImages(items = []) {
  if (!Array.isArray(items) || items.length>2000 || items.reduce((n,r)=>n+(Number(r.size)||0),0)>MAX_BACKUP_IMAGE_BYTES)
    throw new Error('이미지 백업의 개수 또는 용량이 지원 범위를 초과했습니다.');
  for (const item of items) {
    const ref=normalizeImages([item])[0];
    if (typeof item.data!=='string' || item.data.length>Math.ceil(MAX_IMAGE_BYTES/3)*4+4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) throw new Error('백업 이미지 데이터가 잘못됐습니다.');
    const bytes=Uint8Array.from(atob(item.data),s=>s.charCodeAt(0));
    const actual=await inspectImage(new Blob([bytes]));
    if (actual.id!==ref.id || actual.type!==ref.type || actual.size!==ref.size) throw new Error(`백업 이미지 '${ref.name}'의 검증값이 일치하지 않습니다.`);
    await storeImage(new File([bytes],ref.name,{type:ref.type}),ref.source);
  }
}
export async function pruneImages(refs,now = Date.now()) {
  const keep=new Set(refs.map(r=>r.id));
  const all=await access('readonly',s=>s.getAll());let removed=0;
  for (const r of all) if (!keep.has(r.id) && r.createdAt<now-600000) {
    await access('readwrite',s=>s.delete(r.id));removed++;
  }
  return removed;
}
