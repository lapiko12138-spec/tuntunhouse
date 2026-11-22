import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import {createHash} from 'node:crypto';
function memoryBucket(){const objects=new Map();return {
 async put(key,value,opts={}){if(opts.onlyIf&&objects.get(key)?.etag!==opts.onlyIf.etagMatches)return null;const bytes=typeof value==='string'?Buffer.from(value):Buffer.from(value);const item={key,bytes,etag:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,httpMetadata:opts.httpMetadata||{},customMetadata:opts.customMetadata||{}};objects.set(key,item);return item;},
 async get(key,opts={}){const v=objects.get(key);if(!v)return null;const b=opts.range?v.bytes.subarray(opts.range.offset,opts.range.offset+opts.range.length):v.bytes;return {...v,body:b,json:async()=>JSON.parse(b.toString())};},
 async head(key){return objects.get(key)||null;},
 async list({prefix='',limit=100,cursor}={}){const a=[...objects.values()].filter(v=>v.key.startsWith(prefix)).sort((a,b)=>a.key.localeCompare(b.key));const n=Number(cursor)||0;return {objects:a.slice(n,n+limit),truncated:n+limit<a.length,cursor:String(n+limit)};}
};}
const env={BUCKET:memoryBucket()};
async function call(path,method='GET',data,headers={}){return worker.fetch(new Request('https://vault.test'+path,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})}),env);}
async function rpc(name,args={}){const r=await call('/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});return r.json();}
test('personal archive: exact source, de-duplication, persistence, edits, conflict and restore',async()=>{
 const source='https://www.xiaohongshu.com/explore/abc?xsec_token=original&utm_source=share';
 let r=await call('/api/items','POST',{type:'inspiration',title:'人物采访的开场',url:source,tags:['采访','采访'],notes:'保留原始观察'});assert.equal(r.status,200);let d=await r.json();assert.equal(d.item.url,source);assert.deepEqual(d.item.tags,['采访']);assert.equal(d.item.source,'小红书');const first=d.item;
 r=await call('/api/items','POST',{type:'inspiration',title:'重复链接',url:'https://www.xiaohongshu.com/explore/abc?xsec_token=other'});d=await r.json();assert.equal(d.duplicate,true);assert.equal(d.item.id,first.id);
 r=await call('/api/items/'+first.id);assert.equal((await r.json()).notes,'保留原始观察');
 r=await call('/api/items/'+first.id,'PATCH',{expectedUpdatedAt:first.updatedAt,analysis:{hook:'问题开场，依据录屏'},analysisEvidence:'已观看用户录屏',favorite:true});d=await r.json();assert.equal(d.item.analysis.hook,'问题开场，依据录屏');assert.ok(d.item.updatedAt>first.updatedAt);
 r=await call('/api/items/'+first.id,'PATCH',{expectedUpdatedAt:first.updatedAt,notes:'陈旧版本'});assert.equal(r.status,409);
 r=await call('/api/items/'+first.id,'PATCH',{expectedUpdatedAt:d.item.updatedAt,archived:true});d=await r.json();assert.equal(d.item.archived,true);
 r=await call('/api/items/'+first.id,'PATCH',{expectedUpdatedAt:d.item.updatedAt,archived:false});assert.equal((await r.json()).item.archived,false);
});
test('invalid and cross-origin submissions cannot write',async()=>{
 assert.equal((await call('/api/items','POST',{type:'site',title:'evil',url:'javascript:alert(1)'})).status,400);
 assert.equal((await call('/api/items','POST',{type:'site',title:'cross',url:'https://example.com'},{Origin:'https://attacker.test'})).status,403);
 assert.equal((await call('/api/items','POST',{type:'site',title:''})).status,400);
 assert.equal((await call('/api/items/no-such-record')).status,404);
});
test('attachments persist and video ranges return the exact bytes',async()=>{
 const form=new FormData();form.set('file',new File([new Uint8Array([0,1,2,3,4,5,6,7,8,9])],'sample.mp4',{type:'video/mp4'}));
 const r=await worker.fetch(new Request('https://vault.test/api/upload',{method:'POST',body:form}),env);assert.equal(r.status,200);const asset=await r.json();
 const result=await call('/api/assets/'+asset.key,'GET',undefined,{Range:'bytes=3-6'});assert.equal(result.status,206);assert.equal(result.headers.get('Content-Range'),'bytes 3-6/10');assert.deepEqual([...new Uint8Array(await result.arrayBuffer())],[3,4,5,6]);
 const suffix=await call('/api/assets/'+asset.key,'GET',undefined,{Range:'bytes=-2'});assert.deepEqual([...new Uint8Array(await suffix.arrayBuffer())],[8,9]);
 assert.equal((await call('/api/assets/'+asset.key,'GET',undefined,{Range:'bytes=30-40'})).status,416);
 const bad=new FormData();bad.set('file',new File(['<script>evil</script>'],'evil.html',{type:'text/html'}));assert.equal((await worker.fetch(new Request('https://vault.test/api/upload',{method:'POST',body:bad}),env)).status,400);
});
test('chat tools discover, save manual topics and find real analysis',async()=>{
 let r=await call('/mcp','POST',{jsonrpc:'2.0',id:1,method:'server/discover'});assert.deepEqual((await r.json()).result.supportedVersions,['2026-07-28']);
 r=await call('/mcp','POST',{jsonrpc:'2.0',id:2,method:'tools/list'});assert.equal((await r.json()).result.tools.length,6);
 let d=await rpc('archive_material',{type:'topic',title:'AI 如何保存未被拍下的记忆',notes:'我的手动选题',source:'我的想法',category:'AI 与效率'});assert.ok(!d.result.isError);
 d=await rpc('search_materials',{query:'记忆',type:'topic'});assert.equal(JSON.parse(d.result.content[0].text).items[0].source,'我的想法');
 d=await rpc('search_materials',{query:'录屏',type:'inspiration'});assert.equal(JSON.parse(d.result.content[0].text).items[0].analysisEvidence,'已观看用户录屏');
 d=await rpc('not_a_tool');assert.equal(d.result.isError,true);
});
test('page has no external runtime dependencies and keeps Chinese accessible structure',async()=>{
 const r=await call('/');const html=await r.text();assert.equal(r.status,200);assert.match(html,/<html lang="zh-CN">/);assert.match(html,/role="dialog"/);assert.ok(!/script[^>]+src="https?:/.test(html));assert.match(r.headers.get('Content-Security-Policy'),/object-src 'none'/);
});
