const PAGE = /*__PAGE__*/ "";
const TYPES = ["site", "inspiration", "topic"];
const STATUS = ["idea", "ready", "making", "published"];
const ANALYSIS = ["hook", "structure", "visual", "emotion", "reuse"];
const MAX_FILE = 100 * 1024 * 1024;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
class AppError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
function clean(value, max = 5000) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function urlOf(value) {
  if (!value) return "";
  let u; try { u = new URL(value); } catch { throw new AppError("请填写完整的 http 或 https 链接"); }
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) throw new AppError("只支持 http 或 https 链接");
  return u.href;
}
function canonicalUrl(value) {
  const u = new URL(value);u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|xsec_token|xsec_source|igsh|fbclid)/i.test(k)) u.searchParams.delete(k);
  return u.href;
}
function classify(url = "", text = "") {
  const value = (url + " " + text).toLowerCase();
  if (/xiaohongshu|xhslink/.test(value)) return { source: "小红书", category: "内容参考" };
  if (/instagram/.test(value)) return { source: "Instagram", category: "内容参考" };
  if (/mp\.weixin|公众号/.test(value)) return { source: "公众号", category: "AI 与效率" };
  if (/runway|kling|jimeng|hailuo|midjourney|sora|ai\b|aigc/.test(value)) return { source: "网站", category: "AI 与效率" };
  if (/artlist|epidemic|freesound|music|音乐|音效/.test(value)) return { source: "网站", category: "音乐音效" };
  if (/film-grab|shotdeck|电影|分镜|镜头/.test(value)) return { source: "网站", category: "影像审美" };
  if (/pexels|unsplash|pixabay|mixkit|素材/.test(value)) return { source: "网站", category: "素材资源" };
  return { source: url ? "网站" : "我的想法", category: "未分类" };
}
function normalize(input, existing = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError("记录格式不正确");
  const item = { ...existing };
  item.id = existing.id || crypto.randomUUID();
  item.type = input.type ?? existing.type ?? "inspiration";
  if (!TYPES.includes(item.type)) throw new AppError("请选择正确的素材类型");
  item.url = urlOf(input.url === undefined ? existing.url : clean(input.url, 3000));
  const inferred = classify(item.url, input.title);
  item.title = clean(input.title ?? existing.title, 160);
  if (!item.title) throw new AppError("给这条素材起个名字吧");
  item.category = clean(input.category ?? existing.category ?? inferred.category, 40) || "未分类";
  item.source = clean(input.source ?? existing.source ?? inferred.source, 40);
  item.notes = clean(input.notes ?? existing.notes, 30000);
  const tags = input.tags ?? existing.tags ?? [];
  if (!Array.isArray(tags)) throw new AppError("标签格式不正确");
  item.tags = [...new Set(tags.map(t => clean(t, 30)).filter(Boolean))].slice(0, 15);
  item.favorite = input.favorite === undefined ? !!existing.favorite : input.favorite === true;
  item.status = input.status ?? existing.status ?? "idea";
  if (!STATUS.includes(item.status)) throw new AppError("选题状态不正确");
  item.analysis = {};
  for (const k of ANALYSIS) item.analysis[k] = clean(input.analysis?.[k] ?? existing.analysis?.[k], 6000);
  item.analysisEvidence = clean(input.analysisEvidence ?? existing.analysisEvidence, 6000);
  item.attachments = input.attachments ?? existing.attachments ?? [];
  if (!Array.isArray(item.attachments) || item.attachments.length > 10) throw new AppError("每条素材最多保存 10 个附件");
  item.attachments = item.attachments.map(a => {
    if (!a || !/^assets\/[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/.test(a.key)) throw new AppError("附件地址不正确");
    return { key: a.key, name: clean(a.name, 200), type: clean(a.type, 100), size: Number(a.size) || 0 };
  });
  item.archived = input.archived === undefined ? !!existing.archived : input.archived === true;
  item.createdAt = existing.createdAt || new Date().toISOString();
  item.updatedAt = new Date(Math.max(Date.now(),Date.parse(existing.updatedAt || 0)+1 || 0)).toISOString();
  return item;
}
function bucket(env) { if (!env.BUCKET) throw new AppError("存储暂时不可用，请稍后重试", 503); return env.BUCKET; }
async function readStored(env, id) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new AppError("素材编号不正确");
  const object = await bucket(env).get("records/" + id + ".json");
  if (!object) throw new AppError("这条素材不存在", 404);
  return {item: await object.json(), etag:object.etag};
}
async function readItem(env,id){return (await readStored(env,id)).item;}
async function listItems(env, { cursor, limit = 100 } = {}) {
  const listing = await bucket(env).list({ prefix: "records/", cursor: cursor || undefined, limit: Math.min(100, Math.max(1, Number(limit) || 100)) });
  const items = [];
  // Bound concurrent object reads for large personal archives.
  for (let i = 0; i < listing.objects.length; i += 12) {
    const part = await Promise.all(listing.objects.slice(i, i + 12).map(async x => {
      const v = await bucket(env).get(x.key); return v ? v.json() : null;
    }));
    items.push(...part.filter(Boolean));
  }
  return { items, cursor: listing.truncated ? listing.cursor : null };
}
async function allItems(env, max = 5000) {
  let cursor, out = [];
  do { const page = await listItems(env, { cursor }); out.push(...page.items); cursor = page.cursor; } while (cursor && out.length < max);
  return { items: out, cursor: cursor || null };
}
async function saveItem(env, input, id) {
  const stored = id ? await readStored(env, id) : null;
  const previous = stored?.item;
  if(previous&&!input.expectedUpdatedAt)throw new AppError("请先读取当前素材版本再编辑",409);
  if (previous && input.expectedUpdatedAt && input.expectedUpdatedAt !== previous.updatedAt) throw new AppError("这条素材已在其他窗口更新，请重新打开后再编辑", 409);
  const item = normalize(input, previous || {});
  if (!id && item.url) {
    const { items } = await allItems(env);
    const duplicate = items.find(v => !v.archived && v.type === item.type && v.url && canonicalUrl(v.url) === canonicalUrl(item.url));
    if (duplicate) return { item: duplicate, duplicate: true };
  }
  const written = await bucket(env).put("records/" + item.id + ".json", JSON.stringify(item), { httpMetadata: { contentType: "application/json" },...(stored?.etag?{onlyIf:{etagMatches:stored.etag}}:{}) });
  if(written===null)throw new AppError("素材已在其他窗口更新，请重新打开后再编辑",409);
  return { item, duplicate: false };
}
function assertOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) throw new AppError("请从素材网站内提交", 403);
}
async function bodyJson(request) {
  if (Number(request.headers.get("Content-Length")) > 300000) throw new AppError("内容过长", 413);
  const body = await request.text();
  if (body.length > 300000) throw new AppError("内容过长", 413);
  try { return JSON.parse(body); } catch { throw new AppError("提交的内容格式不正确"); }
}
function allowedFile(type, name) {
  const extensions = { png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", gif:"image/gif", avif:"image/avif", mp4:"video/mp4", mov:"video/quicktime", webm:"video/webm", m4v:"video/mp4", mp3:"audio/mpeg", wav:"audio/wav", m4a:"audio/mp4", pdf:"application/pdf", txt:"text/plain" };
  const ext = name.split(".").pop()?.toLowerCase();
  const canonical = extensions[ext];
  if (!canonical || (type && type !== "application/octet-stream" && type !== canonical && !(ext === "m4v" && type === "video/x-m4v") && !(ext === "wav" && type === "audio/x-wav"))) throw new AppError("支持图片、MP4/MOV/WebM 录屏、音频、PDF 和 TXT");
  return { type: canonical, ext };
}
async function upload(env, file) {
  if (!file || typeof file.arrayBuffer !== "function") throw new AppError("请选择一个附件");
  if (!file.size || file.size > MAX_FILE) throw new AppError("单个附件需大于 0 且不超过 100 MB", 413);
  const safe = allowedFile(file.type, file.name);
  const key = "assets/" + crypto.randomUUID() + "/" + crypto.randomUUID() + "." + safe.ext;
  await bucket(env).put(key, await file.arrayBuffer(), { httpMetadata: { contentType: safe.type }, customMetadata: { name: clean(file.name, 200) } });
  return { key, name: clean(file.name, 200), type: safe.type, size: file.size };
}
async function asset(request, env, key) {
  if (!/^assets\/[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/.test(key)) throw new AppError("附件不存在", 404);
  const head = await bucket(env).head(key); if (!head) throw new AppError("附件不存在", 404);
  const headers = { "Content-Type": head.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "private, max-age=3600", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff" };
  const media = /^(image|video|audio)\//.test(headers["Content-Type"]);
  headers["Content-Disposition"] = (media ? "inline" : "attachment") + "; filename*=UTF-8''" + encodeURIComponent(head.customMetadata?.name || "素材");
  const range = request.headers.get("Range"); let opts, code = 200;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null, {status:416,headers:{"Content-Range":"bytes */"+head.size}});
    const start = match[1] ? Number(match[1]) : Math.max(0, head.size - Number(match[2]));
    const end = match[1] ? (match[2] ? Math.min(Number(match[2]), head.size - 1) : head.size - 1) : head.size - 1;
    if (start >= head.size || end < start) return new Response(null, {status:416,headers:{"Content-Range":"bytes */"+head.size}});
    opts = { range: { offset: start, length: end - start + 1 } }; code = 206;
    headers["Content-Range"] = "bytes " + start + "-" + end + "/" + head.size;
    headers["Content-Length"] = String(end - start + 1);
  } else headers["Content-Length"] = String(head.size);
  if (request.method === "HEAD") return new Response(null,{status:code,headers});
  const object = await bucket(env).get(key, opts);
  return new Response(object.body, { status: code, headers });
}
const SOURCES = {
  xhs: { name: "小红书", domain: "xiaohongshu.com", site: "xiaohongshu.com" },
  instagram: { name: "Instagram", domain: "instagram.com", site: "instagram.com" },
  wechat: { name: "公众号", domain: "mp.weixin.qq.com", site: "mp.weixin.qq.com" }
};
function xmlText(value = "") {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/<[^>]*>/g," ").replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").trim();
}
async function searchSource(source, query) {
  const config = SOURCES[source];
  const u = new URL("https://www.bing.com/search"); u.searchParams.set("format","rss"); u.searchParams.set("q","site:" + config.site + " " + query); u.searchParams.set("count","15");
  try {
    const response = await fetch(u, { signal: AbortSignal.timeout(14000), headers: { Accept: "application/rss+xml, application/xml, text/xml" } });
    if (!response.ok) throw new Error("upstream");
    const xml = await response.text();
    if (!/<rss|<channel/i.test(xml)) throw new Error("format");
    const results = [];
    for (const block of xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []) {
      const field = n => xmlText(new RegExp("<"+n+"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/"+n+">","i").exec(block)?.[1] || "");
      let url; try { url = new URL(field("link")); } catch { continue; }
      if (url.protocol !== "https:" || !(url.hostname === config.domain || url.hostname.endsWith("."+config.domain))) continue;
      const title = field("title"); if (!title) continue;
      if (results.some(r=>r.url===url.href)) continue;
      results.push({ title: title.slice(0,200), url: url.href, summary: field("description").slice(0,600), source: config.name, indexedDate: field("pubDate"), verifiedHeat: false });
    }
    return { source, name: config.name, status: "success", results: results.slice(0,12), message: results.length ? "公开网页结果 · 热度未核验" : "暂未检索到公开结果，可继续站内搜索" };
  } catch { return { source, name: config.name, status: "unavailable", results: [], message: "公开搜索暂不可用，可继续站内搜索" }; }
}
async function radar(query, sources) {
  const q = clean(query,80) || "AI 视频创作";
  const chosen = (sources || Object.keys(SOURCES)).filter(s=>SOURCES[s]);
  return { query:q, searchedAt:new Date().toISOString(), notice:"检索公开收录的网页，不代表平台实时热榜。互动数据与发布时间请以原文为准。", sources: await Promise.all(chosen.map(s=>searchSource(s,q))) };
}
const recordSchema = {
  type:"object", properties: {
    title:{type:"string",description:"准确的素材名称，不夸大效果"},type:{type:"string",enum:TYPES},url:{type:"string"},category:{type:"string"},source:{type:"string"},notes:{type:"string",description:"保留用户原始想法、上下文和出处。未读取内容应明确说明。"},tags:{type:"array",items:{type:"string"}},status:{type:"string",enum:STATUS},favorite:{type:"boolean"},analysis:{type:"object",properties:Object.fromEntries(ANALYSIS.map(k=>[k,{type:"string"}]))},analysisEvidence:{type:"string",description:"实际阅读/观看的内容和已核验的互动数据；推测要标注，不虚构爆款或流量。"}
  },required:["title","type"],additionalProperties:false
};
const TOOLS = [
  {name:"search_materials",description:"搜索囤囤屋的常用网站、视频灵感和选题。返回完整备注与拆解；不修改资料。",inputSchema:{type:"object",properties:{query:{type:"string"},type:{type:"string",enum:TYPES},includeArchived:{type:"boolean"},limit:{type:"integer",minimum:1,maximum:50}},additionalProperties:false}},
  {name:"archive_material",description:"把用户发来的链接或想法分类存入个人素材库，保留原始来源。已有同类型链接会去重。视频拆解写入 analysis 的 hook(开头钩子)、structure(叙事结构)、visual(画面声音)、emotion(情绪互动)、reuse(可迁移做法)。只有实际读取原文或观看素材后才能分析，未获得内容要标记待分析。",inputSchema:recordSchema},
  {name:"update_material",description:"补充已有素材的分类、备注、创作进度或有依据的内容拆解。先搜索获得准确 id 和 updatedAt，再提交 expectedUpdatedAt。",inputSchema:{...recordSchema,properties:{...recordSchema.properties,id:{type:"string"},expectedUpdatedAt:{type:"string"}},required:["id","expectedUpdatedAt"]}},
  {name:"search_ai_topics",description:"按关键词搜寻小红书、Instagram 和公众号公开收录内容。结果不是实时热榜，不自动存入手动选题库；必要时另用 ChatGPT 网页检索补充核验。",inputSchema:{type:"object",properties:{query:{type:"string"},sources:{type:"array",items:{type:"string",enum:Object.keys(SOURCES)}}},additionalProperties:false}},
  {name:"upload_material_attachment",description:"把用户已提供的图片、录屏、音频或文档保存为素材附件。小文件限 8MB 原文件大小；较大录屏请用户从网站上传（100MB/个）。返回附件元数据后用 attach_material_files 关联，不要编造文件内容。",inputSchema:{type:"object",properties:{name:{type:"string"},mimeType:{type:"string"},contentBase64:{type:"string",maxLength:11200000}},required:["name","mimeType","contentBase64"],additionalProperties:false}},
  {name:"attach_material_files",description:"将已上传附件的元数据追加到一条素材。先读取记录，不重复添加。",inputSchema:{type:"object",properties:{id:{type:"string"},expectedUpdatedAt:{type:"string"},attachments:{type:"array",items:{type:"object",properties:{key:{type:"string"},name:{type:"string"},type:{type:"string"},size:{type:"number"}},required:["key","name","type","size"]}}},required:["id","expectedUpdatedAt","attachments"],additionalProperties:false}}
];
async function mcp(request, env) {
  const rpc = await bodyJsonMcp(request);
  if (!rpc?.method) return json({jsonrpc:"2.0",id:rpc?.id??null,error:{code:-32600,message:"Invalid request"}},400);
  const ok = result => json({ jsonrpc:"2.0", id:rpc.id??null, result });
  if (rpc.method.startsWith("notifications/")) return new Response(null,{status:202});
  if (rpc.method === "server/discover") return ok({supportedVersions:["2026-07-28"],capabilities:{tools:{}}});
  if (rpc.method === "initialize") return ok({protocolVersion:rpc.params?.protocolVersion||"2026-07-28",capabilities:{tools:{}},serverInfo:{name:"tuntun-creative-library",version:"1.0.0"}});
  if (rpc.method === "ping") return ok({});
  if (rpc.method === "tools/list") return ok({ tools: TOOLS });
  if (rpc.method !== "tools/call") return json({jsonrpc:"2.0",id:rpc.id??null,error:{code:-32601,message:"Method not found"}});
  try {
    const a = rpc.params?.arguments || {}; let result;
    switch (rpc.params?.name) {
      case "search_materials": {
        const data = await allItems(env); const q = clean(a.query,200).toLowerCase();
        const items = data.items.filter(v=>(a.includeArchived || !v.archived)&&(!a.type||v.type===a.type)&&(!q||JSON.stringify(v).toLowerCase().includes(q))).sort((x,y)=>y.updatedAt.localeCompare(x.updatedAt));
        result={items:items.slice(0,Math.max(1,Math.min(50,a.limit||30))),matched:items.length,truncated:!!data.cursor}; break;
      }
      case "archive_material": result = await saveItem(env,a); break;
      case "update_material": { if(!a.expectedUpdatedAt)throw new AppError("请先读取记录并提供 expectedUpdatedAt");result = await saveItem(env,a,a.id); break; }
      case "search_ai_topics": result = await radar(a.query,a.sources); break;
      case "upload_material_attachment": {
        if(typeof a.contentBase64!=="string"||a.contentBase64.length>11200000) throw new AppError("聊天附件入口支持 8MB 以内文件，较大文件请从网站上传");
        let raw; try{raw=atob(a.contentBase64);}catch{throw new AppError("附件编码不正确");}
        if(raw.length>8*1024*1024)throw new AppError("文件超过 8MB，请从网站上传");
        result = await upload(env,new File([Uint8Array.from(raw,c=>c.charCodeAt(0))],a.name,{type:a.mimeType}));break;
      }
      case "attach_material_files": {
        const item = await readItem(env,a.id);
        if(!a.expectedUpdatedAt||!Array.isArray(a.attachments))throw new AppError("请提供当前版本和已上传附件");
        const attachments=[...item.attachments,...a.attachments].filter((v,i,all)=>all.findIndex(x=>x.key===v.key)===i);
        result=await saveItem(env,{attachments,expectedUpdatedAt:a.expectedUpdatedAt},a.id);break;
      }
      default: throw new AppError("工具不存在");
    }
    return ok({content:[{type:"text",text:JSON.stringify(result)}]});
  } catch(error) { return ok({isError:true,content:[{type:"text",text:error instanceof AppError?error.message:"操作暂未完成，请稍后重试"}]}); }
}
async function bodyJsonMcp(request) {
  if (Number(request.headers.get("Content-Length"))>12500000)throw new AppError("请求过大",413);
  const text=await request.text();if(text.length>12500000)throw new AppError("请求过大",413);
  try{return JSON.parse(text);}catch{throw new AppError("Invalid JSON");}
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url), path = url.pathname;
      // This shared, personal vault is protected by owner-only Sites access.
      // Keep that audience in all deployments. Origin checks protect browser writes.
      if (path === "/mcp" && request.method === "POST") {assertOrigin(request);return await mcp(request,env);}
      if (path === "/api/items" && request.method === "GET") return json(await listItems(env,{cursor:url.searchParams.get("cursor")}));
      if (path === "/api/items" && request.method === "POST") {assertOrigin(request);return json(await saveItem(env,await bodyJson(request)));}
      const itemMatch = /^\/api\/items\/([a-zA-Z0-9-]+)$/.exec(path);
      if (itemMatch && request.method === "GET") return json(await readItem(env,itemMatch[1]));
      if (itemMatch && request.method === "PATCH") {assertOrigin(request);return json(await saveItem(env,await bodyJson(request),itemMatch[1]));}
      if (path === "/api/classify" && request.method === "GET") return json(classify(url.searchParams.get("url")||"",url.searchParams.get("title")||""));
      if (path === "/api/upload" && request.method === "POST") {
        assertOrigin(request);if(Number(request.headers.get("Content-Length"))>MAX_FILE+1024*1024)throw new AppError("单个附件不超过 100MB",413);
        const form=await request.formData();return json(await upload(env,form.get("file")));
      }
      if (path.startsWith("/api/assets/") && ["GET","HEAD"].includes(request.method)) return await asset(request,env,decodeURIComponent(path.slice(12)));
      if (path === "/api/radar" && request.method === "POST") {assertOrigin(request);const a=await bodyJson(request);return json(await radar(a.query,a.sources));}
      if (path.startsWith("/api/")) return json({error:"接口不存在"},404);
      if (path === "/favicon.svg") return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#7561dd"/><path d="M17 28 32 17l15 11v21H17Z" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/><path d="M26 49V35h12v14" fill="none" stroke="white" stroke-width="4"/></svg>',{headers:{"Content-Type":"image/svg+xml"}});
      if(path!=="/"||request.method!=="GET")return new Response("Not found",{status:404});
      return new Response(PAGE,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"strict-origin-when-cross-origin","Content-Security-Policy":"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"}});
    } catch (error) { return json({error:error instanceof AppError?error.message:"服务暂时不可用，请稍后重试"},error instanceof AppError?error.status:500); }
  }
};
