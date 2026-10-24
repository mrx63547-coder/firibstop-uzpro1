// FiribStop UZ live cybersecurity news proxy. Node.js 18+; no API keys required.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const CACHE_MS = 10 * 60 * 1000;
let newsCache = { items: [], sources: [], updatedAt: null, fetchedAt: 0 };
let geoCache = null;
const FEEDS = [
  { name: 'UZCERT — официальные новости Узбекистана', url: 'https://uzcert.uz/ru/feed', official: true },
  { name: 'SecurityLab — новости ИБ', url: 'https://www.securitylab.ru/_services/export/rss/news/', official: false },
  { name: 'Securelist — аналитика киберугроз', url: 'https://securelist.ru/feed/', official: false },
  { name: 'Positive Technologies — новости безопасности', url: 'https://www.ptsecurity.com/ru-ru/rss/', official: false },
  { name: 'BI.ZONE — кибербезопасность', url: 'https://bi.zone/rss/', official: false }
];
const TYPES = [
  ['ransomware', /ransomware|ransom|шифровальщик|вымогател/i],
  ['уязвимости', /vulnerabilit|cve-|zero.day|уязвимост|эксплуатац/i],
  ['фишинг', /phish|scam|fraud|фишинг|мошеннич/i],
  ['утечка данных', /data breach|leak|exposed data|утечк/i],
  ['вредоносное ПО', /malware|trojan|botnet|вредоносн|троян/i],
  ['кибератака / инцидент', /cyber.?attack|hack(ed|ing)?|incident|attack|кибератак|взлом|инцидент/i]
];
function decode(s='') { return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/\s+/g,' ').trim(); }
function tag(block, names) { for (const name of names) { const re = new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'\\s*>','i'); const m=block.match(re); if(m) return m[1]; } return ''; }
function classify(text) { for(const [name,re] of TYPES) if(re.test(text)) return name; return 'кибербезопасность'; }
function cleanUrl(raw) { const s=decode(raw); try { const u=new URL(s); return ['http:','https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } }
function parseFeed(xml, feed) {
 const blocks = xml.match(/<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)\s*>/gi) || [];
 return blocks.map((b,i)=>{
   const title=decode(tag(b,['title']));
   let link=tag(b,['link']);
   if(!link){const m=b.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i);if(m)link=m[1];}
   let url=cleanUrl(link);
   if(!url){const m=b.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);if(m)url=cleanUrl(m[1]);}
   const description=decode(tag(b,['description','summary','content:encoded','content'])).slice(0,700);
   const date=decode(tag(b,['pubDate','published','updated','dc:date','date']));
   const parsedDate=date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null;
   if(!title || !url) return null;
   const text=title+' '+description;
   return { id:Buffer.from(url).toString('base64url').slice(0,80), title, description, url, date:parsedDate, source:feed.name, category:classify(text), important:/critical|actively exploited|zero.day|ransomware|data breach|кибератак|критическ|активно эксплуат/i.test(text), official:feed.official, region:null, confidence:'Источник публикации; географическая привязка не подтверждена' };
 }).filter(Boolean);
}
async function fetchFeed(feed) {
 const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),9000);
 try { const r=await fetch(feed.url,{signal:controller.signal,headers:{'user-agent':'FiribStop-Community-Security-News/1.0','accept':'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'}}); if(!r.ok)throw new Error('HTTP '+r.status); const xml=await r.text(); if(!xml.includes('<'))throw new Error('Ответ не похож на XML'); const items=parseFeed(xml,feed);return {items,status:{name:feed.name,ok:true,count:items.length}}; }
 finally {clearTimeout(timer);}
}
async function loadNews(force=false) {
 if(!force && newsCache.fetchedAt && Date.now()-newsCache.fetchedAt<CACHE_MS) return newsCache;
 const results=await Promise.all(FEEDS.map(async f=>{try{return await fetchFeed(f)}catch(e){return {items:[],status:{name:f.name,ok:false,error:String(e.message||e).slice(0,120),count:0}}}}));
 let items=results.flatMap(r=>r.items);
 const seen=new Set(); items=items.filter(x=>{const key=x.url.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>Date.parse(b.date||0)-Date.parse(a.date||0)).slice(0,160);
 newsCache={items,sources:results.map(r=>r.status),updatedAt:new Date().toISOString(),fetchedAt:Date.now()};
 return newsCache;
}
async function loadGeo() {
 if(geoCache)return geoCache;
 const urls=['https://raw.githubusercontent.com/akbartus/GeoJSON-Uzbekistan/main/geojson/uzbekistan_regional.geojson','https://raw.githubusercontent.com/negeloT/uzbekistan_borders/main/GEOJSON_LVL/uzbekistan_lvl2.geojson'];
 for(const url of urls){try{const r=await fetch(url,{headers:{'user-agent':'FiribStop-Community-Map/1.0'},signal:AbortSignal.timeout(10000)});if(!r.ok)continue;const j=await r.json();if(j&&j.type==='FeatureCollection'&&Array.isArray(j.features)&&j.features.length>=10){geoCache=j;return j;}}catch{}}
 throw new Error('Геоданные регионов временно недоступны');
}
let phish={set:new Set(),updatedAt:null,fetchedAt:0,error:null};
function normalizeUrlKey(raw){try{const u=new URL(raw);u.hash='';return u.href.replace(/\/$/,'').toLowerCase()}catch{return ''}}
function matchPhish(raw,db=phish){const k=normalizeUrlKey(raw);return !!k&&db.set.has(k)}
async function loadPhish(){
 if(phish.fetchedAt&&Date.now()-phish.fetchedAt<3600000)return phish;
 try{const r=await fetch('https://openphish.com/feed.txt',{headers:{'user-agent':'FiribStop-Community-Security/1.0'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('HTTP '+r.status);
  const set=new Set((await r.text()).split(/\r?\n/).map(normalizeUrlKey).filter(Boolean));phish={set,updatedAt:new Date().toISOString(),fetchedAt:Date.now(),error:null};}
 catch(e){phish.fetchedAt=Date.now()-3300000;phish.error=String(e.message||e).slice(0,120);}
 return phish;
}
const CSP="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: blob: https:; connect-src 'self' https://raw.githubusercontent.com https://cdn.jsdelivr.net https://tessdata.projectnaptha.com; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const SEC_HEADERS={'content-security-policy':CSP,'x-frame-options':'DENY','x-content-type-options':'nosniff','permissions-policy':'camera=(), microphone=(), geolocation=(), payment=()','cross-origin-opener-policy':'same-origin','strict-transport-security':'max-age=15552000'};
// Ограничение частоты запросов к /api (в памяти). За прокси включите TRUST_PROXY=1, иначе X-Forwarded-For игнорируется.
const RATE={windowMs:60000,max:Number(process.env.RATE_LIMIT||120)};
const hits=new Map();let lastRefresh=0;
function clientIp(req){const x=process.env.TRUST_PROXY==='1'?String(req.headers['x-forwarded-for']||'').split(',')[0].trim():'';return x||(req.socket&&req.socket.remoteAddress)||'?';}
function limited(req){const ip=clientIp(req),now=Date.now();let e=hits.get(ip);if(!e||now>e.reset){e={n:0,reset:now+RATE.windowMs};hits.set(ip,e);}e.n++;return e.n>RATE.max?Math.ceil((e.reset-now)/1000):0;}
setInterval(()=>{const now=Date.now();for(const[k,v]of hits)if(now>v.reset)hits.delete(k);},60000).unref();
function forceRefresh(u){if(u.searchParams.get('refresh')!=='1'||Date.now()-lastRefresh<60000)return false;lastRefresh=Date.now();return true;}
function send(res,code,data,type='application/json; charset=utf-8'){const body=type.startsWith('application/json')?JSON.stringify(data):data;res.writeHead(code,{'content-type':type,'cache-control':'no-store',...SEC_HEADERS,'referrer-policy':'strict-origin-when-cross-origin','access-control-allow-origin':'*','access-control-allow-methods':'GET, OPTIONS','access-control-allow-headers':'Content-Type, Accept'});res.end(body);}
const PUBLIC_FILES=new Set(['index.html','sw.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','scams.json']);
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.txt':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
 if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET, OPTIONS','access-control-allow-headers':'Content-Type, Accept'});return res.end();}
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/')){const wait=limited(req);if(wait){res.writeHead(429,{...SEC_HEADERS,'content-type':'application/json; charset=utf-8','retry-after':String(wait),'cache-control':'no-store'});return res.end(JSON.stringify({error:'Too many requests'}));}}
 try {
  if(req.method==='GET'&&u.pathname==='/api/health')return send(res,200,{ok:true,service:'FiribStop live threat news',now:new Date().toISOString(),cacheMinutes:CACHE_MS/60000});
  if(req.method==='GET'&&u.pathname==='/api/news'){const d=await loadNews(forceRefresh(u));return send(res,200,{items:d.items,sources:d.sources,updatedAt:d.updatedAt,stale:Date.now()-d.fetchedAt>CACHE_MS});}
  if(req.method==='GET'&&u.pathname==='/api/analytics'){const d=await loadNews(false),categories={},sources={},months={};for(const n of d.items){categories[n.category]=(categories[n.category]||0)+1;sources[n.source]=(sources[n.source]||0)+1;if(n.date){const m=n.date.slice(0,7);months[m]=(months[m]||0)+1;}}return send(res,200,{total:d.items.length,important:d.items.filter(x=>x.important).length,categories,sources,months,updatedAt:d.updatedAt,method:'Статистика публикаций из RSS, не статистика всех кибератак.'});}
  if(req.method==='GET'&&u.pathname==='/api/attacks'){const d=await loadNews(false);return send(res,200,{items:d.items.filter(x=>/кибератак \/ инцидент|вредоносное ПО|утечка данных|фишинг|ransomware|уязвимости/i.test(x.category)),updatedAt:d.updatedAt,notice:'Это сообщения СМИ и бюллетени безопасности, не подтверждённый глобальный поток атак.'});}
  if(req.method==='GET'&&u.pathname==='/api/threat-status'){const d=await loadPhish();return send(res,200,{available:d.set.size>0,count:d.set.size,updatedAt:d.updatedAt,error:d.error});}
  if(req.method==='GET'&&u.pathname==='/api/threat-check'){const url=(u.searchParams.get('url')||'').slice(0,2048);const d=await loadPhish();return send(res,200,{available:d.set.size>0,listed:matchPhish(url,d),error:d.error});}
  if(req.method==='GET'&&u.pathname==='/api/regions'){const g=await loadGeo();return send(res,200,g);}
  if(req.method==='GET'){
   let p=decodeURIComponent(u.pathname);if(p==='/')p='/index.html';const name=p.slice(1);if(!PUBLIC_FILES.has(name))return send(res,404,{error:'Not found'});const full=path.join(ROOT,name);
   fs.readFile(full,(err,data)=>{if(err)return send(res,404,{error:'Not found'});send(res,200,data,MIME[path.extname(full)]||'application/octet-stream');});return;
  }
  return send(res,405,{error:'Method not allowed'});
 }catch(e){console.error(e);return send(res,502,{error:'Upstream source unavailable',items:[],sources:[],updatedAt:newsCache.updatedAt||null});}
});
if(require.main===module){server.listen(PORT,'0.0.0.0',()=>console.log(`FiribStop server listening on ${PORT}`));
 for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{console.log('Shutting down');server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),8000).unref();});}
module.exports={parseFeed,classify,decode,cleanUrl,normalizeUrlKey,matchPhish,PUBLIC_FILES,server,limited,RATE,SEC_HEADERS};
