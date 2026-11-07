const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const keyList = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
let KEYS = keyList(process.env.GEMINI_API_KEYS);
let TTS_KEYS = keyList(process.env.GEMINI_TTS_KEYS);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Secret1234';

const TEXT_MODEL = process.env.TEXT_MODEL || 'gemini-3.6-flash';
const TTS_MODEL = process.env.TTS_MODEL || 'gemini-3.8-flash-tts';
const VOICE_LIST = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Aoede', 'Zephyr'];
const DEFAULT_VOICE = VOICE_LIST.includes(process.env.VOICE) ? process.env.VOICE : 'Kore';
const EXT = (process.env.EXT_PATH || '1').replace(/^\/+|\/+$/g, '');
const TOKEN = process.env.YEMOT_TOKEN || (process.env.YEMOT_API_USERNAME + ':' + process.env.YEMOT_API_PASSWORD);
const YM = process.env.YEMOT_BASE || 'https://www.call2all.co.il/ym/api/';
const GBASE = process.env.GEMINI_BASE || 'https://generativelanguage.googleapis.com/v1beta/models/';
const BUDGET = Number(process.env.TURN_BUDGET_MS) || 120000;
const REC_MAX = String(parseInt(process.env.REC_MAX, 10) || 30);

app.post('/update-keys', (req, res) => {
  const { admin_password, gemini_api_key, gemini_tts_key } = req.body;
  if (admin_password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'סיסמה שגויה או חסרה.' });
  }
  let updated = false;
  if (gemini_api_key) { KEYS = keyList(gemini_api_key); updated = true; }
  if (gemini_tts_key) { TTS_KEYS = keyList(gemini_tts_key); updated = true; }
  
  if (updated) {
    console.log('מפתחות ה-API עודכנו מרחוק.');
    res.json({ message: 'המפתחות עודכנו בהצלחה!' });
  } else {
    res.status(400).json({ error: 'לא נשלחו מפתחות לעדכון.' });
  }
});

const sp = s => String(s).replace(/[.\-"'&|,=]/g, ' ').replace(/\s+/g, ' ').trim();

const MODES = {
  '1': 'האופי שלך: שנון וחד. אתה מהיר מחשבה. בכל תשובה תן קודם תשובה אמיתית ונכונה לשאלה, ובסגנון קליל.',
  '2': 'האופי שלך: חכם ויעיל. ענה ישר לעניין, בלי הקדמות ובמשפט הכי ברור ושימושי שאפשר. אם אינך בטוח, אמור זאת במפורש ואל תמציא עובדות.',
  '3': 'האופי שלך: ידיד קרוב. נעים ואכפתי, מדבר בעברית יומיומית בגובה העיניים, מקשיב ומגיב בטוב לב.',
  '4': 'האופי שלך: משורר ויוצר שירים. חבר שיר או פיוט בחרוזים עשירים, במשקל קצבי וברור, לפי בקשת המתקשר.',
  '5': 'האופי שלך: מלחין ומייצר מוזיקה. הלחן מנגינה עשירה באמצעות תגית [MUSIC:...], והוסף משפט קצר ונעים שיוקרא לפני שהמנגינה מתנגנת.',
  '6': 'האופי שלך: מסייע בעיבוד וסיכום דברי תורה. המשתמש יאמר דברי תורה, ואתה תעבד ותקריא לו חזרה את הרעיון מנוסח בצורה מסודרת כעזר ללומד. אל תחדש חידושים משלך ואל תפסוק הלכה. מקורותיך מוגבלים לתנ"ך, תלמוד בבלי וירושלמי, רמב"ם ושולחן ערוך.',
  '7': 'האופי שלך: מומחה לגימטריות ופרפראות. חשב את הערך הגימטרי של דברי המשתמש והצע מילים או מראי מקומות מהתנ"ך (בלבד) בעלי אותו ערך מספרי.',
  '8': 'האופי שלך: מספר סיפורי חז"ל ומשלים. ספק משלים וסיפורים ראויים וחינוכיים ממקורות יהודיים (תלמוד בבלי וירושלמי, רמב"ם) לפי נושא שהמשתמש מבקש, וסיים במוסר השכל קצר.',
  '9': 'האופי שלך: עורך חידונים על התנ"ך. שאל שאלה, המתן לתשובה, ואשר או תקן. אל תעבור לשאלה הבאה לפני שהמשתמש עונה.',
  '10': 'האופי שלך: מסייע באיתור מראי מקומות. עליך לסייע באיתור מקורות בספרות היסוד בלבד: תנ"ך, תלמוד, משנה תורה לרמב"ם ושולחן ערוך. אם אינך ודאי לחלוטין, עליך להשיב: "לא מצאתי מקור מדויק לכך". לעולם אל תמציא מקורות.',
  '11': 'האופי שלך: נתב קולי. המשתמש יבקש לאן להגיע, ואתה תנחה אותו איזה מספר שלוחה להקיש בהתאם לבקשתו. ענה בצורה תמציתית מאוד.'
};

const VOICE_HELP = 'יכולות מיוחדות: ' +
  '1. לשינוי קול, הוסף בתחילת התשובה [VOICE:Next] או שם קול (Kore, Puck, Charon, Fenrir, Aoede, Zephyr). ' +
  '2. ליצירת שירים הוסף את התגית [SONG]. ' +
  '3. ליצירת מוזיקה הוסף [MUSIC:BPM:NOTE:BEATS,...] (למשל [MUSIC:110:E4:1,G4:1,A4:2]). ';

const buildSys = (mode, extra) => 'אתה עוזר קולי בטלפון. ' + (MODES[String(mode)] || MODES['2']) +
  ' ' + VOICE_HELP +
  ' ענה בבהירות, בעד ' + (['4', '5', '6', '8'].includes(String(mode)) ? Math.max(Number(process.env.MAX_WORDS)||50, 120) : (Number(process.env.MAX_WORDS)||50)) + ' מילים. ' +
  (String(process.env.EXTRA_INSTRUCTION || '') ? 'הנחיה כללית: ' + String(process.env.EXTRA_INSTRUCTION || '').trim() + ' ' : '') +
  (extra ? 'הנחיה לשלוחה זו: ' + extra + ' ' : '');

let CFG = [];
try { CFG = JSON.parse(process.env.EXTENSIONS || '[]'); } catch (e) { CFG = []; }
if (!Array.isArray(CFG) || !CFG.length) CFG = [{ p: EXT, m: process.env.MODE || '2', v: DEFAULT_VOICE, x: '', g: process.env.GREETING || '' }];
const EXTS = {};
for (const c of CFG) {
  const p = String(c.p || '').replace(/^\/+|\/+$/g, '');
  if (!/^[0-9]+(\/[0-9]+)*$/.test(p)) continue;
  const v = VOICE_LIST.includes(c.v) ? c.v : DEFAULT_VOICE;
  EXTS[p.replace(/\//g, '_')] = {
    p, d: '/' + p, m: String(c.m || '2'), v,
    sys: buildSys(c.m, String(c.x || '').replace(/\s+/g, ' ').trim().slice(0, 1000)),
    g: sp(String(c.g || '').slice(0, 300)) || sp('ברוכים הבאים. שאל או אמור דבר מה ובסיום הקש סולמית')
  };
}
const EXT_FIRST = EXTS[Object.keys(EXTS)[0]] || { p: EXT, d: '/' + EXT, m: '2', v: DEFAULT_VOICE, sys: buildSys('2', ''), g: sp('ברוכים הבאים') };
const AGAIN = sp('לא שמעתי, אנא נסו שוב');
const ERR = sp('הייתה תקלה, אנא נסו שוב');

const EXTP = '/' + EXT;
const yp = (name, d) => 'ivr2:' + (d === undefined ? EXTP : d) + '/' + name + '.wav';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isBudget = e => e && /budget/.test(e.message || '');
const rot = { text: 0, tts: 0 };
const calls = {};

setInterval(() => {
  const now = Date.now();
  for (const id of Object.keys(calls)) if (now - calls[id].t > 3600000) delete calls[id];
}, 600000).unref();

async function http(url, opt, ms, deadline) {
  const left = deadline ? deadline - Date.now() : ms;
  if (left < 800) throw new Error('turn budget exhausted');
  return fetch(url, { ...opt, signal: AbortSignal.timeout(Math.min(ms, left)) });
}

async function gem(model, body, deadline, pool) {
  pool = pool || 'text';
  const list = pool === 'tts' ? TTS_KEYS : KEYS;
  if (!list.length) throw new Error(pool === 'tts' ? 'GEMINI_TTS_KEYS is empty' : 'GEMINI_API_KEYS is empty');
  let err = model + ' failed';
  let status = 0;
  for (let i = 0; i < list.length * 2; i++) {
    const key = list[rot[pool]++ % list.length];
    try {
      const r = await http(GBASE + model + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body)
      }, 60000, deadline);
      if (r.ok) return await r.json();
      status = r.status;
      err = model + ' ' + r.status + ' ' + (await r.text()).slice(0, 200);
      if (![429, 500, 502, 503, 504].includes(r.status)) break;
    } catch (e) {
      if (isBudget(e)) throw e;
      status = 0;
      err = model + ' ' + (e.name === 'TimeoutError' ? 'timeout' : e.message);
    }
    await sleep(500);
  }
  const e = new Error(err);
  e.status = status;
  throw e;
}

const THINK = ['minimal', 'low', null];
let thinkIdx = 0;
async function textGen(body, deadline) {
  for (;;) {
    const lvl = THINK[thinkIdx];
    const gc = { maxOutputTokens: 1500 };
    if (lvl) gc.thinkingConfig = { thinkingLevel: lvl };
    try {
      return await gem(TEXT_MODEL, { ...body, generationConfig: gc }, deadline, 'text');
    } catch (e) {
      if (e.status === 400 && /think/i.test(e.message) && thinkIdx < THINK.length - 1) { thinkIdx++; continue; }
      throw e;
    }
  }
}

function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const SEMI = { C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11 };
function noteFreq(n) {
  if (!n || n.toUpperCase() === 'R') return 0;
  const m = /^([A-G][#B]?)([2-6])$/i.exec(n.trim());
  if (!m) return 0;
  const s = SEMI[m[1].toUpperCase()];
  if (s === undefined) return 0;
  const midi = (parseInt(m[2], 10) + 1) * 12 + s;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function synthMusic(spec, rate = 24000) {
  const parts = String(spec || '').split(':');
  let bpm = 110;
  let seqStr = parts[0] || '';
  if (parts.length > 1 && /^\d+$/.test(parts[0].trim())) {
    bpm = Math.min(220, Math.max(50, parseInt(parts[0].trim(), 10) || 110));
    seqStr = parts.slice(1).join(':');
  }
  const beatSec = 60 / bpm;
  const items = seqStr.split(',').map(s => s.trim()).filter(Boolean).slice(0, 64);
  if (!items.length) items.push('E4:1', 'G4:1', 'A4:2', 'B4:1', 'A4:1', 'G4:2', 'E4:2');
  const bufs = [];
  let beatPos = 0;
  for (const it of items) {
    const [nStr, dStr] = it.split(':');
    const beats = Math.min(8, Math.max(0.2, parseFloat(dStr) || 1));
    const dur = beats * beatSec;
    const f = noteFreq(nStr);
    const samples = Math.floor(dur * rate);
    const b = Buffer.alloc(samples * 2);
    const bassF = (f > 0 && Math.floor(beatPos) % 2 === 0) ? f * 0.5 : 0;
    for (let i = 0; i < samples; i++) {
      const t = i / rate;
      let val = 0;
      if (f > 0) {
        const att = Math.min(1, t / 0.025);
        const rel = Math.min(1, (dur - t) / 0.06);
        const env = att * rel * Math.exp(-2.2 * t / dur);
        val += Math.sin(2 * Math.PI * f * t) * 0.55 + Math.sin(2 * Math.PI * f * 2 * t) * 0.22 + Math.sin(2 * Math.PI * f * 3 * t) * 0.08;
        val *= env;
      }
      if (bassF > 0) {
        const bEnv = Math.min(1, t / 0.02) * Math.exp(-3.5 * t / dur);
        val += Math.sin(2 * Math.PI * bassF * t) * 0.25 * bEnv;
      }
      const s = Math.max(-1, Math.min(1, val * 0.45));
      b.writeInt16LE(Math.floor(s * 32767), i * 2);
    }
    bufs.push(b);
    beatPos += beats;
  }
  return wav(Buffer.concat(bufs), rate);
}

function concatWav(w1, w2) {
  if (!w1) return w2;
  if (!w2) return w1;
  const rate = w1.readUInt32LE(24) || 24000;
  const p1 = w1.subarray(44);
  const p2 = w2.subarray(44);
  const gap = Buffer.alloc(Math.floor(rate * 0.35) * 2);
  return wav(Buffer.concat([p1, gap, p2]), rate);
}

const NEW_TTS = /^gemini-(3\.[8-9]|[4-9])/.test(TTS_MODEL);
let vIdx = 0;
function voiceFormats(vName) {
  const v = VOICE_LIST.includes(vName) ? vName : DEFAULT_VOICE;
  return NEW_TTS
    ? [{ voice: v }, { prebuiltVoiceConfig: { voiceName: v } }]
    : [{ prebuiltVoiceConfig: { voiceName: v } }, { voice: v }];
}

async function tts(text, deadline, voiceName, isSong) {
  let last = new Error('no audio from tts');
  const vForms = voiceFormats(voiceName);
  const promptText = isSong ? 'הקרא בקצב מוזיקלי וברור: ' + text.slice(0, 1200) : text.slice(0, 1200);
  for (let i = 0; i < 3; i++) {
    try {
      const cfg = vForms[Math.min(vIdx, vForms.length - 1)];
      const t = await gem(TTS_MODEL, {
        contents: [{ role: 'user', parts: [{ text: promptText }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: cfg } }
      }, deadline, 'tts');
      const parts = (((t.candidates || [])[0] || {}).content || {}).parts || [];
      const part = parts.find(p => p.inlineData && p.inlineData.data);
      if (part) {
        let pcm = Buffer.from(part.inlineData.data, 'base64');
        if (pcm.subarray(0, 4).toString() !== 'RIFF') {
          const m = /rate=(\d+)/.exec(part.inlineData.mimeType || '');
          pcm = wav(pcm, m ? Number(m[1]) : 24000);
        }
        return pcm;
      }
      last = new Error('no audio from tts');
    } catch (e) {
      last = e;
      if (isBudget(e)) throw e;
      if (e.status === 400 && /voice|speech/i.test(e.message) && vIdx < 1) vIdx++;
    }
  }
  throw last;
}

async function download(name, deadline, d) {
  let last = '';
  for (let i = 0; i < 4; i++) {
    try {
      const r = await http(YM + 'DownloadFile?token=' + encodeURIComponent(TOKEN) + '&path=' + encodeURIComponent(yp(name, d)), {}, 12000, deadline);
      const b = Buffer.from(await r.arrayBuffer());
      if (r.ok && b.length > 100 && b.subarray(0, 4).toString() === 'RIFF') return b;
      last = r.status + ' ' + b.subarray(0, 80).toString('utf8').replace(/\s+/g, ' ');
    } catch (e) {
      if (isBudget(e)) throw e;
      last = e.message;
    }
    await sleep(500);
  }
  throw new Error('download failed ' + last);
}

async function upload(name, buf, deadline, d) {
  const path = yp(name, d);
  const attempts = [{ q: true, field: 'file' }, { q: true, field: 'upload' }, { q: false, field: 'upload' }, { q: false, field: 'file' }];
  let last = '';
  for (const a of attempts) {
    try {
      const f = new FormData();
      let url = YM + 'UploadFile';
      if (a.q) {
        url += '?token=' + encodeURIComponent(TOKEN) + '&path=' + encodeURIComponent(path) + '&convertAudio=1';
      } else {
        f.append('token', TOKEN); f.append('path', path); f.append('convertAudio', '1');
      }
      f.append(a.field, new Blob([buf], { type: 'audio/wav' }), name + '.wav');
      const r = await http(url, { method: 'POST', body: f }, 25000, deadline);
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.responseStatus === 'OK') return;
      last = JSON.stringify(j).slice(0, 200);
    } catch (e) {
      if (isBudget(e)) throw e;
      last = e.message;
    }
  }
  throw new Error('upload failed ' + last);
}

function del(name, d) {
  fetch(YM + 'FileAction?token=' + encodeURIComponent(TOKEN) + '&action=delete&what=' + encodeURIComponent(yp(name, d)), { signal: AbortSignal.timeout(8000) }).catch(() => {});
}

app.get('/', (q, r) => { r.set('Access-Control-Allow-Origin', '*'); r.send('ok'); });

app.all(['/yemot', '/yemot/:e'], async (req, res) => {
  const q = { ...req.query, ...req.body };
  const id = String(q.ApiCallId || 'x').replace(/[^a-zA-Z0-9]/g, '').slice(-24) || 'x';
  res.type('text/plain');
  const T0 = Date.now();
  const ext = EXTS[String(req.params.e || '')] || EXT_FIRST;
  try {
    if (q.hangup === 'yes') {
      const old = calls[id];
      if (old && old.r) del(old.r, old.d);
      delete calls[id];
      return res.send('noop=bye');
    }
    const s = calls[id] || (calls[id] = { d: ext.d, m: ext.m, v: ext.v, sys: ext.sys, g: ext.g, n: 0, h: [], p: '', name: '', r: '', t: 0, e: crypto.randomBytes(3).toString('hex') });
    s.t = Date.now();
    const ask = pre => {
      s.n++; s.p = 'Q' + s.e + s.n; s.name = 'q' + s.e + 'n' + s.n;
      return 'read=' + pre + '=' + s.p + ',no,record,' + s.d + ',' + s.name + ',no,,,1,' + REC_MAX;
    };
    if (!s.name) {
      const g = (await greetFile(s.d, Date.now() + 4000)) ? 'f-' + s.d + '/greet' : 't-' + s.g;
      return res.send(ask(g));
    }
    if (!q[s.p]) return res.send(ask('t-' + AGAIN));
    const deadline = T0 + BUDGET;
    const qn = s.name;
    let out;
    try {
      const audio = await download(qn, deadline, s.d);
      del(qn, s.d);
      if (s.r) { del(s.r, s.d); s.r = ''; }
      const t1 = Date.now();

      const a = await textGen({
        systemInstruction: { parts: [{ text: s.sys + ' (הקול הנוכחי: ' + s.v + ')' }] },
        contents: [...s.h.slice(-8), { role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: audio.toString('base64') } }] }]
      }, deadline);
      const parts = (((a.candidates || [])[0] || {}).content || {}).parts || [];
      let text = parts.filter(p => !p.thought).map(p => p.text || '').join('').trim();
      if (!text) throw new Error('empty answer');

      let isSong = s.m === '4';
      let musicSpec = '';

      const vm = /\[VOICE:([A-Za-z]+)\]/i.exec(text);
      if (vm) {
        const reqV = vm[1];
        if (reqV.toLowerCase() === 'next') { s.v = VOICE_LIST[(VOICE_LIST.indexOf(s.v) + 1) % VOICE_LIST.length]; } 
        else { const found = VOICE_LIST.find(x => x.toLowerCase() === reqV.toLowerCase()); if (found) s.v = found; else s.v = VOICE_LIST[(VOICE_LIST.indexOf(s.v) + 1) % VOICE_LIST.length]; }
        text = text.replace(/\[VOICE:[A-Za-z]+\]/gi, '').trim();
      }
      if (/\[SONG\]/i.test(text)) { isSong = true; text = text.replace(/\[SONG\]/gi, '').trim(); }
      const mm = /\[MUSIC:([^\]]+)\]/i.exec(text);
      if (mm) { musicSpec = mm[1].trim(); text = text.replace(/\[MUSIC:[^\]]+\]/gi, '').trim(); } 
      else if (s.m === '5') { musicSpec = '110:E4:1,G4:1,A4:2,B4:1,A4:1,G4:2,E4:1,G4:1,A4:1,B4:1,C5:2,B4:2,A4:2,G4:1,F4:1,E4:4'; }

      const t2 = Date.now();
      let pcm = null;
      if (text) { pcm = await tts(text, deadline, s.v, isSong); } 
      else if (!musicSpec) { pcm = await tts('החלפתי את הקול.', deadline, s.v, false); }
      if (musicSpec) {
        const rate = pcm ? (pcm.readUInt32LE(24) || 24000) : 24000;
        const mWav = synthMusic(musicSpec, rate);
        pcm = pcm ? concatWav(pcm, mWav) : mWav;
      }
      const t3 = Date.now();
      const rn = 'r' + s.e + 'n' + s.n;
      await upload(rn, pcm, deadline, s.d);
      s.r = rn;
      s.h.push({ role: 'user', parts: [{ text: '[שאלה]' }] }, { role: 'model', parts: [{ text: text || '[ניגון]' }] });
      if (s.h.length > 12) s.h = s.h.slice(-12);
      console.log(id, 'turn', s.n, 'ok', 'voice', s.v, 'gemini', t2 - t1, 'tts', t3 - t2, 'total', Date.now() - T0);
      out = ask('f-' + s.d + '/' + rn);
    } catch (e) {
      console.error(id, 'turn', s.n, 'failed after', Date.now() - T0, 'ms:', e.message);
      del(qn, s.d);
      out = ask('t-' + ERR);
    }
    return res.send(out);
  } catch (e) {
    console.error(id, 'fatal', e.message);
    if (!res.headersSent) res.send('id_list_message=t-' + ERR);
  }
});

const greetOk = {};
async function greetFile(d, deadline) {
  if (greetOk[d] !== undefined) return greetOk[d];
  try {
    const r = await http(YM + 'GetIVR2Dir?token=' + encodeURIComponent(TOKEN) + '&path=' + encodeURIComponent('ivr2:' + d), {}, 4500, deadline);
    const j = await r.json().catch(() => ({}));
    if (j.responseStatus !== 'OK') return false;
    greetOk[d] = JSON.stringify(j).includes('greet.wav');
    return greetOk[d];
  } catch (e) { return false; }
}

let lastRec = 0;
app.post('/record', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*').type('text/plain; charset=utf-8');
  try {
    if (String(req.body.token || '') !== TOKEN) return res.send('ERR טוקן שגוי');
    if (Date.now() - lastRec < 6000) return res.send('ERR המתן');
    const dir = String(req.body.dir || '').replace(/^\/+|\/+$/g, '');
    const file = String(req.body.file || 'greet');
    const voice = VOICE_LIST.includes(req.body.voice) ? req.body.voice : DEFAULT_VOICE;
    if (dir && !/^[0-9]+(\/[0-9]+)*$/.test(dir)) return res.send('ERR שלוחה לא תקינה');
    if (!/^[A-Za-z0-9_]{1,20}$/.test(file)) return res.send('ERR קובץ לא תקין');
    const text = String(req.body.text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    if (!text) return res.send('ERR טקסט ריק');
    lastRec = Date.now();
    const d = dir ? '/' + dir : '';
    const deadline = Date.now() + 120000;
    const pcm = await tts(text, deadline, voice, false);
    await upload(file, pcm, deadline, d);
    if (file === 'greet') greetOk[d] = true;
    res.send('OK ' + file + '.wav ב- ' + voice);
  } catch (e) {
    res.send('ERR ' + String(e.message).slice(0, 200));
  }
});

let lastTest = 0;
app.get('/selftest', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*').type('text/plain; charset=utf-8');
  if (Date.now() - lastTest < 20000) return res.send('ERR המתן');
  lastTest = Date.now();
  const out = [];
  const deadline = Date.now() + 120000;
  const step = async (name, fn) => {
    try { out.push('OK  ' + name + (await fn() || '')); }
    catch (e) { out.push('ERR ' + name + ': ' + String(e.message).slice(0, 220)); }
  };
  const silent = wav(Buffer.alloc(3200), 8000);
  await step('מפתחות ג׳מיני לתמלול', async () => { if (!KEYS.length) throw new Error('ריק'); return ' (' + KEYS.length + ')'; });
  await step('מפתחות ג׳מיני להקראה', async () => { if (!TTS_KEYS.length) throw new Error('ריק'); return ' (' + TTS_KEYS.length + ')'; });
  await step('טוקן ימות', async () => { if (!TOKEN || /undefined/.test(TOKEN)) throw new Error('ריק'); });
  await step('ימות: קריאת שלוחה ' + EXT, async () => {
    const r = await http(YM + 'GetIVR2Dir?token=' + encodeURIComponent(TOKEN) + '&path=' + encodeURIComponent('ivr2:' + EXTP), {}, 10000, deadline);
    const j = await r.json().catch(() => ({}));
    if (j.responseStatus !== 'OK') throw new Error(JSON.stringify(j).slice(0, 180));
  });
  await step('ימות: העלאה ומחיקה', async () => {
    await upload('selftest', silent, deadline);
    const r = await http(YM + 'FileAction?token=' + encodeURIComponent(TOKEN) + '&action=delete&what=' + encodeURIComponent(yp('selftest')), {}, 8000, deadline);
    const j = await r.json().catch(() => ({}));
    if (j.responseStatus !== 'OK') throw new Error('מחיקה: ' + JSON.stringify(j).slice(0, 150));
  });
  await step('ג׳מיני ' + TEXT_MODEL, async () => {
    const a = await textGen({ contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: silent.toString('base64') } }, { text: 'אמור אמן' }] }] }, deadline);
    if (!(((a.candidates || [])[0] || {}).content)) throw new Error('תשובה ריקה');
    return ' (thinking: ' + (THINK[thinkIdx] || 'רגיל') + ')';
  });
  await step('ג׳מיני ' + TTS_MODEL + ' (קול ' + DEFAULT_VOICE + ')', async () => {
    const p = await tts('בדיקה', deadline, DEFAULT_VOICE, false);
    return ' (' + Math.round(p.length / 1024) + 'KB)';
  });
  await step('מנוע יצירת קובצי מוזיקה', async () => {
    const m = synthMusic('120:C4:1,E4:1');
    if (m.length < 1000) throw new Error('ריק');
    return ' תקין';
  });
  res.send(out.join('\n'));
});

app.use((err, req, res, next) => {
  console.error('express', err && err.message);
  if (!res.headersSent) res.type('text/plain').send('id_list_message=t-' + ERR);
});
process.on('unhandledRejection', e => console.error('unhandledRejection', e && e.message));
process.on('uncaughtException', e => console.error('uncaughtException', e && e.message));

app.listen(process.env.PORT || 3000, () => console.log('zygy up, budget:', BUDGET));
