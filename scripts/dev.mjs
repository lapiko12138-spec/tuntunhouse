import http from "node:http";
import {readFile,writeFile,mkdir,readdir,rename,stat} from "node:fs/promises";
import path from "node:path";
import {execFileSync} from "node:child_process";
const root=path.resolve('.sites-runtime/data');await mkdir(root,{recursive:true});
function filePath(key){if(!/^[a-zA-Z0-9./_-]+$/.test(key)||key.includes('..'))throw new Error('Invalid key');return path.join(root,key);}
const bucket={
 async put(key,value,opts={}){const p=filePath(key);await mkdir(path.dirname(p),{recursive:true});const b=typeof value==='string'?Buffer.from(value):Buffer.from(value);await writeFile(p+'.tmp',b);await rename(p+'.tmp',p);const meta={key,size:b.length,httpMetadata:opts.httpMetadata||{},customMetadata:opts.customMetadata||{}};await writeFile(p+'.meta',JSON.stringify(meta));return meta;},
 async head(key){try{return JSON.parse(await readFile(filePath(key)+'.meta','utf8'));}catch{return null;}},
 async get(key,opts={}){const meta=await this.head(key);if(!meta)return null;let b=await readFile(filePath(key));if(opts.range)b=b.subarray(opts.range.offset,opts.range.offset+opts.range.length);return {...meta,body:b,json:async()=>JSON.parse(b.toString()),text:async()=>b.toString()};},
 async list({prefix='',cursor,limit=100}={}){const folder=filePath(prefix);let entries=[];try{entries=(await readdir(folder)).filter(x=>!x.endsWith('.meta')&&!x.endsWith('.tmp')).sort();}catch{}const offset=Number(cursor)||0;const page=entries.slice(offset,offset+limit);return {objects:await Promise.all(page.map(x=>this.head(prefix+x))),truncated:offset+limit<entries.length,cursor:String(offset+limit)};}
};
let worker,signature='';
async function currentWorker(){const sig=String((await stat('worker/server.mjs')).mtimeMs)+String((await stat('worker/page.html')).mtimeMs);if(sig!==signature){execFileSync(process.execPath,['scripts/build.mjs'],{stdio:'ignore'});worker=(await import(path.resolve('dist/server/index.js')+'?t='+Date.now())).default;signature=sig;}return worker;}
const server=http.createServer(async(req,res)=>{try{const worker=await currentWorker();const origin='http://'+req.headers.host;const chunks=[];for await(const b of req)chunks.push(b);const body=Buffer.concat(chunks);const request=new Request(origin+req.url,{method:req.method,headers:{...req.headers,'oai-authenticated-user-id':'local-owner','oai-authenticated-user-email':'local@sites.test'},...(body.length?{body}:{} )});const response=await worker.fetch(request,{BUCKET:bucket});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(error){console.error(error);res.writeHead(500);res.end('Preview error');}});
server.listen(5173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:5173'));
