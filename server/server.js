/* Mind's Eye Lab — research backend
 * Node 18+, Express, better-sqlite3. One file on purpose: easy to read, easy to audit for the IRB.
 *
 *   npm install && cp .env.example .env && npm start
 *
 * Endpoints (participant side; authenticated by participant ID + recovery code):
 *   GET  /api/config                        study config: consent text, arms, which assessments are required/optional/locked/hidden
 *   POST /api/participants                  enrol {pid, code, demo, arm, consent, device}
 *   GET  /api/participants/:pid?code=...    restore a participant's snapshot on a new device
 *   POST /api/events                        append events {pid, code, events:[...], snapshot}
 * Endpoints (researcher side; Authorization: Bearer ADMIN_TOKEN):
 *   GET  /admin                             dashboard (admin.html)
 *   GET  /admin/api/summary                 counts
 *   GET  /admin/api/participants            list with latest snapshot summaries
 *   GET  /admin/api/participants/:pid       everything for one participant
 *   GET  /admin/api/config  PUT /admin/api/config
 *   GET  /admin/api/export.csv?type=...     long-format CSV of events (optionally one type)
 *   GET  /admin/api/export.json             everything
 *   DELETE /admin/api/participants/:pid     withdrawal: hard-delete all of a participant's data
 */
require('dotenv').config();
const express=require('express');
const Database=require('better-sqlite3');
const path=require('path');
const crypto=require('crypto');

const PORT=process.env.PORT||3000;
const ADMIN_TOKEN=process.env.ADMIN_TOKEN;
const DB_PATH=process.env.DB_PATH||path.join(__dirname,'data','mindseye.sqlite');
const ORIGINS=(process.env.CORS_ORIGINS||'*').split(',').map(s=>s.trim());
if(!ADMIN_TOKEN||ADMIN_TOKEN.length<16){console.error('Set ADMIN_TOKEN (16+ chars) in .env');process.exit(1)}

require('fs').mkdirSync(path.dirname(DB_PATH),{recursive:true});
const db=new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS participants(
  pid TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  arm TEXT,
  demo TEXT,
  consent TEXT,
  device TEXT,
  snapshot TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events(
  id TEXT PRIMARY KEY,
  pid TEXT NOT NULL,
  type TEXT NOT NULL,
  day TEXT,
  client_time TEXT,
  server_time TEXT DEFAULT (datetime('now')),
  payload TEXT,
  FOREIGN KEY(pid) REFERENCES participants(pid) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ev_pid ON events(pid);
CREATE INDEX IF NOT EXISTS ev_type ON events(type);
CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY, value TEXT);
`);
db.pragma('foreign_keys = ON');

const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
const DEFAULT_CONFIG=require('./default-config.json');
function getConfig(){const r=db.prepare('SELECT value FROM config WHERE key=?').get('study');return r?JSON.parse(r.value):DEFAULT_CONFIG}
function setConfig(c){db.prepare('INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('study',JSON.stringify(c))}

const app=express();
app.use(express.json({limit:'2mb'}));
app.use((req,res,next)=>{const o=req.headers.origin;if(ORIGINS.includes('*')||ORIGINS.includes(o))res.setHeader('Access-Control-Allow-Origin',ORIGINS.includes('*')?'*':o);res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');if(req.method==='OPTIONS')return res.sendStatus(204);next()});

// very small rate limit (per IP, per minute)
const hits=new Map();app.use('/api',(req,res,next)=>{const k=req.ip+':'+Math.floor(Date.now()/60000);const n=(hits.get(k)||0)+1;hits.set(k,n);if(hits.size>5000)hits.clear();if(n>240)return res.status(429).json({error:'slow down'});next()});

const auth=(pid,code)=>{const p=db.prepare('SELECT * FROM participants WHERE pid=?').get(pid);return p&&p.code_hash===hash(code)?p:null};
const validPid=p=>typeof p==='string'&&/^[A-Z0-9_-]{3,40}$/.test(p);

/* ---------- participant API ---------- */
app.get('/api/config',(req,res)=>{const c=getConfig();res.json(c)});

app.post('/api/participants',(req,res)=>{
  const {pid,code,demo,arm,consent,device}=req.body||{};
  if(!validPid(pid)||typeof code!=='string'||code.length<4)return res.status(400).json({error:'pid/code'});
  const existing=db.prepare('SELECT pid,code_hash FROM participants WHERE pid=?').get(pid);
  if(existing&&existing.code_hash!==hash(code))return res.status(409).json({error:'pid taken'});
  const cfg=getConfig();const arms=cfg.arms&&cfg.arms.length?cfg.arms:['A'];
  // server-side arm assignment: balanced by current counts
  let assigned=arm;if(!existing){const counts=Object.fromEntries(arms.map(a=>[a,0]));db.prepare('SELECT arm,COUNT(*) n FROM participants GROUP BY arm').all().forEach(r=>{if(r.arm in counts)counts[r.arm]=r.n});assigned=arms.sort((a,b)=>counts[a]-counts[b])[0]}
  db.prepare(`INSERT INTO participants(pid,code_hash,arm,demo,consent,device) VALUES(?,?,?,?,?,?)
    ON CONFLICT(pid) DO UPDATE SET demo=excluded.demo,consent=excluded.consent,device=excluded.device,updated_at=datetime('now')`)
    .run(pid,hash(code),existing?undefined:assigned,JSON.stringify(demo||{}),JSON.stringify(consent||{}),JSON.stringify(device||{}));
  const p=db.prepare('SELECT arm FROM participants WHERE pid=?').get(pid);
  res.json({ok:true,arm:p.arm});
});

app.get('/api/participants/:pid',(req,res)=>{
  const p=auth(req.params.pid,req.query.code);if(!p)return res.status(404).json({error:'not found'});
  res.json({pid:p.pid,arm:p.arm,snapshot:p.snapshot?JSON.parse(p.snapshot):null,created_at:p.created_at});
});

app.post('/api/events',(req,res)=>{
  const {pid,code,events,snapshot}=req.body||{};
  const p=auth(pid,code);if(!p)return res.status(401).json({error:'auth'});
  if(_withdrawn(pid))return res.status(403).json({error:'withdrawn'});
  if(!Array.isArray(events)||events.length>200)return res.status(400).json({error:'events'});
  const ins=db.prepare('INSERT OR IGNORE INTO events(id,pid,type,day,client_time,payload) VALUES(?,?,?,?,?,?)');
  const tx=db.transaction(()=>{for(const e of events){if(!e||typeof e.id!=='string'||typeof e.type!=='string')continue;ins.run(e.id,pid,e.type.slice(0,40),e.day||null,e.t||null,JSON.stringify(e.payload||{}))}
    if(snapshot&&typeof snapshot==='object'){const {code:_c,...safe}=snapshot;db.prepare("UPDATE participants SET snapshot=?,updated_at=datetime('now') WHERE pid=?").run(JSON.stringify(safe),pid)}});
  tx();res.json({ok:true,stored:events.length});
});

app.post('/api/withdraw',(req,res)=>{
  const {pid,code,deleteData}=req.body||{};const p=auth(pid,code);if(!p)return res.status(401).json({error:'auth'});
  if(deleteData){db.prepare('DELETE FROM participants WHERE pid=?').run(pid);return res.json({ok:true,deleted:true})}
  const c=JSON.parse(p.consent||'{}');c.withdrawn=true;c.withdrawnAt=new Date().toISOString();
  db.prepare("UPDATE participants SET consent=?,updated_at=datetime('now') WHERE pid=?").run(JSON.stringify(c),pid);
  db.prepare('INSERT OR IGNORE INTO events(id,pid,type,day,client_time,payload) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),pid,'withdraw',new Date().toISOString().slice(0,10),new Date().toISOString(),'{}');
  res.json({ok:true,deleted:false});
});
// events from withdrawn participants are refused
const _withdrawn=pid=>{const p=db.prepare('SELECT consent FROM participants WHERE pid=?').get(pid);return p&&JSON.parse(p.consent||'{}').withdrawn};

/* ---------- admin API ---------- */
const admin=(req,res,next)=>{const h=req.headers.authorization||'';const t=h.startsWith('Bearer ')?h.slice(7):req.query.token;if(t!==ADMIN_TOKEN)return res.status(401).json({error:'admin token'});next()};
app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'admin.html')));
app.get('/admin/api/summary',admin,(req,res)=>{
  const n=db.prepare('SELECT COUNT(*) n FROM participants').get().n;
  const byArm=db.prepare('SELECT arm,COUNT(*) n FROM participants GROUP BY arm').all();
  const byType=db.prepare('SELECT type,COUNT(*) n FROM events GROUP BY type').all();
  const recent=db.prepare("SELECT COUNT(DISTINCT pid) n FROM events WHERE server_time>datetime('now','-7 days')").get().n;
  const vviq=db.prepare("SELECT json_extract(snapshot,'$.vviq.total') t FROM participants WHERE json_extract(snapshot,'$.vviq.total') IS NOT NULL").all().map(r=>r.t);
  const bands={aphantasia:0,low:0,typical:0,hyper:0};vviq.forEach(t=>{if(t<=32)bands.aphantasia++;else if(t<=47)bands.low++;else if(t<=74)bands.typical++;else bands.hyper++});
  res.json({participants:n,activeLast7d:recent,byArm,byType,vviqN:vviq.length,bands});
});
app.get('/admin/api/participants',admin,(req,res)=>{
  const rows=db.prepare('SELECT pid,arm,demo,consent,snapshot,created_at,updated_at,(SELECT COUNT(*) FROM events e WHERE e.pid=p.pid) n_events FROM participants p ORDER BY updated_at DESC').all();
  res.json(rows.map(r=>{const s=r.snapshot?JSON.parse(r.snapshot):{};const d=JSON.parse(r.demo||'{}');return{pid:r.pid,arm:r.arm,created_at:r.created_at,updated_at:r.updated_at,n_events:r.n_events,research:!!(JSON.parse(r.consent||'{}').research),age:d.age,gender:d.gender,source:d.source,
    vviq:s.vviq?s.vviq.total:null,screen:s.screen?s.screen.v:null,multiLow:s.multi?Object.values(s.multi.mods).filter(m=>m.score<=2).length:null,rot:s.rot?s.rot.acc:null,slope:s.rot?s.rot.slope:null,meta:s.rot?s.rot.meta:null,span:s.span?s.span.span:null,
    checkins:(s.checkins||[]).length,sessions:s.sessions||0,exp:Object.keys(s.exp||{}).filter(k=>s.exp[k]&&s.exp[k].complete)}}));
});
app.get('/admin/api/participants/:pid',admin,(req,res)=>{
  const p=db.prepare('SELECT pid,arm,demo,consent,device,snapshot,created_at,updated_at FROM participants WHERE pid=?').get(req.params.pid);if(!p)return res.status(404).json({error:'not found'});
  const ev=db.prepare('SELECT id,type,day,client_time,server_time,payload FROM events WHERE pid=? ORDER BY client_time').all(p.pid);
  res.json({...p,demo:JSON.parse(p.demo||'{}'),consent:JSON.parse(p.consent||'{}'),device:JSON.parse(p.device||'{}'),snapshot:p.snapshot?JSON.parse(p.snapshot):null,events:ev.map(e=>({...e,payload:JSON.parse(e.payload||'{}')}))});
});
app.delete('/admin/api/participants/:pid',admin,(req,res)=>{const r=db.prepare('DELETE FROM participants WHERE pid=?').run(req.params.pid);res.json({deleted:r.changes})});
app.get('/admin/api/config',admin,(req,res)=>res.json(getConfig()));
app.put('/admin/api/config',admin,(req,res)=>{const c=req.body;if(!c||!c.assessments)return res.status(400).json({error:'config needs assessments'});setConfig(c);res.json({ok:true})});

// flatten helpers for CSV
function flatten(obj,prefix='',out={}){for(const k in obj){const v=obj[k];const key=prefix?prefix+'.'+k:k;if(v&&typeof v==='object'&&!Array.isArray(v))flatten(v,key,out);else out[key]=Array.isArray(v)?JSON.stringify(v):v}return out}
const csvEsc=v=>{if(v==null)return'';const s=String(v);return/[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
app.get('/admin/api/export.csv',admin,(req,res)=>{
  const type=req.query.type;const rows=db.prepare('SELECT e.*,p.arm,p.demo FROM events e JOIN participants p ON p.pid=e.pid'+(type?' WHERE e.type=?':'')+' ORDER BY e.pid,e.client_time').all(...(type?[type]:[]));
  const flat=rows.map(r=>({event_id:r.id,pid:r.pid,arm:r.arm,type:r.type,day:r.day,client_time:r.client_time,server_time:r.server_time,...Object.fromEntries(Object.entries(flatten(JSON.parse(r.demo||'{}'))).map(([k,v])=>['demo.'+k,v])),...flatten(JSON.parse(r.payload||'{}'))}));
  const cols=[...new Set(flat.flatMap(r=>Object.keys(r)))];
  res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition','attachment; filename="mindseye_'+(type||'all')+'_'+new Date().toISOString().slice(0,10)+'.csv"');
  res.send([cols.join(','),...flat.map(r=>cols.map(c=>csvEsc(r[c])).join(','))].join('\n'));
});
app.get('/admin/api/export.json',admin,(req,res)=>{
  const ps=db.prepare('SELECT pid,arm,demo,consent,device,snapshot,created_at,updated_at FROM participants').all().map(p=>({...p,demo:JSON.parse(p.demo||'{}'),consent:JSON.parse(p.consent||'{}'),device:JSON.parse(p.device||'{}'),snapshot:p.snapshot?JSON.parse(p.snapshot):null}));
  const ev=db.prepare('SELECT * FROM events ORDER BY pid,client_time').all().map(e=>({...e,payload:JSON.parse(e.payload||'{}')}));
  res.json({exported_at:new Date().toISOString(),config:getConfig(),participants:ps,events:ev});
});

// optionally serve the web app from the same server (set SERVE_WEB=1)
if(process.env.SERVE_WEB)app.use('/',express.static(path.join(__dirname,'..','web')));

app.listen(PORT,()=>console.log('Mind\'s Eye Lab server on http://localhost:'+PORT+'  (admin at /admin)'));
