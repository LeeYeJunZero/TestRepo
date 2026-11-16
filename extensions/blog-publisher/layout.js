import {normalizeImages, normalizeMarker} from './images.js';

export const markerToken = marker => `[[${normalizeMarker(marker)}]]`;

export function buildLayout(post) {
  const images=normalizeImages(post.images || []),body=String(post.body || '');
  const linked=new Map(images.filter(r=>r.marker).map(r=>[r.marker,r]));
  const used=new Set(),blocks=[];let offset=0;
  for (const match of body.matchAll(/\[\[([^\[\]\r\n]+)\]\]/g)) {
    const marker=normalizeMarker(match[1]);
    if (match[0]!==markerToken(marker)) throw new Error(`삽입 표시 ${match[0]}의 공백·형식을 확인하세요.`);
    if (!linked.has(marker)) throw new Error(`삽입 표시 ${match[0]}에 연결된 이미지가 없습니다.`);
    if (used.has(marker)) throw new Error(`삽입 표시 ${match[0]}는 본문에 한 번만 사용하세요.`);
    if (match.index>offset) blocks.push({type:'text',text:body.slice(offset,match.index)});
    blocks.push({type:'images',images:[linked.get(marker)]});used.add(marker);offset=match.index+match[0].length;
  }
  if(offset<body.length)blocks.push({type:'text',text:body.slice(offset)});
  for(const marker of linked.keys())if(!used.has(marker))throw new Error(`이미지에 연결한 ${markerToken(marker)} 표시가 본문에 없습니다. '커서 위치에 삽입'을 누르세요.`);
  if(post.tags?.length)blocks.push({type:'text',text:'\n\n'+post.tags.map(t=>'#'+t.replace(/\s+/g,'')).join(' ')});
  const tail=images.filter(r=>!r.marker);
  if(tail.length)blocks.push({type:'images',images:tail});
  return {blocks,groups:[...(tail.length ? [{marker:'',images:tail}]:[]),
    ...blocks.filter(b=>b.type==='images' && b.images[0].marker).map(b=>({marker:b.images[0].marker,images:b.images}))]};
}

export function insertMarkerAt(body,marker,cursor) {
  body=String(body);const token=markerToken(marker),index=body.indexOf(token);
  cursor=Math.max(0,Math.min(body.length,Number(cursor)||0));
  if(index>=0) {
    if(body.indexOf(token,index+token.length)>=0)throw new Error(`${token}가 본문에 여러 번 있습니다. 하나만 남겨 주세요.`);
    body=body.slice(0,index)+body.slice(index+token.length);
    if(cursor>index)cursor-=Math.min(cursor-index,token.length);
  }
  const insertion=`\n\n${token}\n\n`;
  return {body:body.slice(0,cursor)+insertion+body.slice(cursor),cursor:cursor+insertion.length};
}
