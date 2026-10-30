// Functional test battery for the classroom clock. Run: node test/run-tests.mjs [filter]
// Needs Node >= 22 and Google Chrome (set CHROME=/path/to/chrome otherwise). No dependencies.
import { launch, Page, sleep } from './cdp.mjs';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { extname, normalize } from 'node:path';

const URL_APP = new URL('../index.html', import.meta.url).href;
const filter = process.argv[2] || '';
const results = []; let browser;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.md': 'text/plain' };
let server, BASE = '';
async function serve() {
  if (server) return BASE;
  server = http.createServer((req, res) => {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
    if (p.startsWith('..')) { res.writeHead(403).end(); return; }
    try { const body = readFileSync(join(ROOT, p)); res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body); } catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return (BASE = `http://127.0.0.1:${server.address().port}/`);
}

const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, m = 'condition is false') => { if (!v) throw new Error(m); };
const has = (s, sub, m = '') => { if (!String(s).includes(sub)) throw new Error(`${m} ${JSON.stringify(s)} does not contain ${JSON.stringify(sub)}`); };
const near = (a, b, tol, m = '') => { if (Math.abs(a - b) > tol) throw new Error(`${m} ${a} not within ${tol} of ${b}`); };

async function t(group, name, fn, opts = {}) {
  const full = `${group} › ${name}`;
  if (filter && !full.toLowerCase().includes(filter.toLowerCase())) return;
  const page = await Page.open(browser, opts.url || URL_APP, opts);
  const t0 = Date.now();
  try {
    await fn(page);
    if (!opts.allowErrors && page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
    results.push({ full, pass: true, ms: Date.now() - t0 });
    console.log(`  \x1b[32m✓\x1b[0m ${full}`);
  } catch (e) {
    results.push({ full, pass: false, err: e.message });
    console.log(`  \x1b[31m✗\x1b[0m ${full}\n      ${e.message.split('\n').join('\n      ')}`);
  } finally { await page.close(); }
}
const sim = async (p, hhmm) => p.ev(`simulated=${JSON.stringify(hhmm)};renderClock();0`);
const txt = (p, id) => p.ev(`document.getElementById(${JSON.stringify(id)}).textContent`);
const cfg = (p, k) => p.ev(`config[${JSON.stringify(k)}]`);
const body = p => p.ev('({cls:document.body.className,data:{...document.body.dataset}})');
// test data with a fixed shape (4 visible sections, 8 stops); the shipped presets have their own tests
const PRESET = JSON.parse(readFileSync(new URL('./fixture-sessio.json', import.meta.url), 'utf8'));
const SHIPPED = JSON.parse(readFileSync(new URL('../presets/proves-compleccio.json', import.meta.url), 'utf8'));
const tpl = async (p, k, mode = 'schedule') => p.ev(`${k === 'complecio' ? `applyTemplateData(${JSON.stringify(PRESET.data)})` : `applyTemplate(${JSON.stringify(k)})`};config.clockMode=${JSON.stringify(mode)};renderClock();0`);
const open = async (p, tab) => { await p.ev(`document.getElementById('edit-btn').click();${tab ? `document.querySelector('[data-tab=${tab}]').click();` : ''}0`); await sleep(80); };


function png(w, h, rgba = [200, 30, 30, 255]) {
  const row = w * 4 + 1, raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgba, y * row + 1 + x * 4);
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const tmp = (name, data) => { const f = join(mkdtempSync(join(tmpdir(), 'ioc-logo-')), name); writeFileSync(f, data); return f; };

browser = await launch();
console.log(`\nRellotge i tauler · versió IOC · battery against ${URL_APP.split('/').pop()}\n`);

// ───────────────────────── 1. Load & structure
const G1 = '1 Càrrega';
await t(G1, 'loads with no errors and the default state', async p => {
  eq(await p.ev('document.title'), "Benvinguts");
  eq(await cfg(p, 'clockMode'), 'clock'); eq(await cfg(p, 'layout'), 50); eq(await cfg(p, 'theme'), 'system'); eq(await p.ev('config.slides.length'), 1);
});
await t(G1, 'every icon placeholder is hydrated with an SVG', async p => {
  eq(await p.ev("[...document.querySelectorAll('[data-i]')].filter(e=>!e.querySelector('svg')).length"), 0);
  ok(await p.ev("document.querySelectorAll('[data-i]').length")>25, 'expected many icons');
});
await t(G1, 'no emoji or legacy glyphs remain in the interface', async p => {
  await open(p);
  const bad = await p.ev("(()=>{const re=/[\\u2190-\\u21ff\\u2300-\\u23ff\\u25a0-\\u27bf\\u2b00-\\u2bff\\u{1F000}-\\u{1FFFF}\\uFF0B]/u;return [...document.querySelectorAll('body *')].filter(e=>e.children.length===0&&re.test(e.textContent)).map(e=>e.textContent.trim()).filter(x=>!/^[←→]$/.test(x))})()");
  eq(bad, []);
});
await t(G1, 'every icon-only button has an accessible name', async p => {
  const bad = await p.ev("[...document.querySelectorAll('button')].filter(b=>!(b.textContent.trim()||b.getAttribute('aria-label')||b.title)).map(b=>b.id||b.className)");
  eq(bad, []);
});
await t(G1, 'IOC logo shows by default, with a variant per theme', async p => {
  const src = () => p.ev("document.getElementById('logo-img').src");
  const vis = () => p.ev("(()=>{const i=document.getElementById('logo-img');return getComputedStyle(i).display!=='none'&&i.naturalWidth>100})()");
  await p.ev("config.theme='dark';applyAppearance()"); await sleep(100); const d = await src(); ok(await vis());
  await p.ev("config.theme='light';applyAppearance()"); await sleep(100); const l = await src(); ok(await vis()); ok(d !== l, 'light variant differs');
  eq(await p.ev("document.getElementById('logo-img').alt"), 'Institut Obert de Catalunya');
});
await t(G1, 'logo is clearly visible (height ≥ 70px at 1080p)', async p => { ok((await p.rect('#logo-img')).h >= 70, 'logo too small'); });
await t(G1, 'the page never scrolls horizontally at 1920/1280/390 px', async p => {
  for (const [w, h] of [[1920, 1080], [1280, 720], [390, 844]]) {
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(150);
    ok(await p.ev('document.documentElement.scrollWidth<=innerWidth+1'), `horizontal overflow at ${w}`);
  }
});

// ───────────────────────── 2. Schedule mode
const G2 = '2 Fites';
const cases = [
  ['13:00', '01:00', 'Preparació de la seu', 'Abans de començar'],
  ['14:10', '00:35', 'Entrada de l’alumnat', 'Preparació de la seu'],
  ['14:50', '00:10', 'Inici de les proves', 'Entrada de l’alumnat'],
  ['15:10', '00:20', 'Tancament de l’accés', 'Inici de les proves'],
  ['16:55', '00:05', 'Primera recollida', 'Tancament de l’accés'],
  ['19:00', '02:00', 'Tercera recollida', 'Segona recollida'],
  ['21:10', '00:05', 'Recollida final', 'Tercera recollida'],
  ['21:15', '00:00', '', 'Recollida final'],
  ['23:59', '00:00', '', 'Recollida final'],
];
for (const [time, big, name, tag] of cases) await t(G2, `at ${time} shows ${big} · ${tag}`, async p => {
  await tpl(p, 'complecio'); await sim(p, time); eq(await txt(p, 'countdown'), big, 'countdown'); eq(await txt(p, 'stage-tag'), tag, 'tag');
  if (name) eq(await txt(p, 'event-name'), name, 'event'); else eq(await txt(p, 'ring-overline'), 'Finalitzat');
});
await t(G2, 'each phase can show its own message', async p => {
  await tpl(p, 'complecio'); await sim(p, '16:20'); has(await txt(p, 'stage-hint-text'), '16:30'); eq(await p.ev("document.getElementById('stage-hint').hidden"), false);
  await sim(p, '18:00'); has(await txt(p, 'stage-hint-text'), 'abans de les 19:00'); await sim(p, '13:00'); eq(await p.ev("document.getElementById('stage-hint').hidden"), true, 'no message before the first phase');
});
await t(G2, 'automatic warning "Falten N min" appears near a milestone, only when enabled', async p => {
  await tpl(p, 'blank', 'schedule'); await sim(p, '10:27'); eq(await p.ev("document.getElementById('stage-hint').hidden"), true, 'nothing by default');
  await p.ev("config.autoHint=true;renderClock()"); await sim(p, '10:27'); eq(await txt(p, 'stage-hint-text'), 'Falten 3 min per a «Pausa»');
  await p.ev("config.autoHint=false;renderClock()"); await sim(p, '10:27'); eq(await p.ev("document.getElementById('stage-hint').hidden"), true);
  await p.ev("config.autoHint=true;config.clockNote='La meva nota';renderClock()"); await sim(p, '10:27'); eq(await txt(p, 'stage-hint-text'), 'La meva nota', 'a manual message wins');
});
await t(G2, 'day timeline: only the stops marked for the day line, past/next classes and fill', async p => {
  await tpl(p, 'complecio'); await sim(p, '18:00');
  eq(await p.ev("document.querySelectorAll('#collections .stop').length"), 4, 'only stops with show');
  eq(await p.ev("[...document.querySelectorAll('#collections .stop')].map(s=>s.classList.contains('past')?'p':s.classList.contains('next')?'n':'-').join('')"), 'pn--');
  const pct = await p.ev("parseFloat(document.querySelector('#collections .fill').style.width)");
  near(pct, (0 + 60 / 120) / 3 * 100, 0.6, 'fill %');
  await sim(p, '16:10'); eq(await p.ev("[...document.querySelectorAll('#collections .stop')].map(s=>s.classList.contains('next')?'n':'-').join('')"), 'n---');
  await p.ev(`applyTemplateData(${JSON.stringify(SHIPPED.data)})`); await sim(p, '16:10');
  eq(await p.ev("[...document.querySelectorAll('#collections .stop .at')].map(e=>e.textContent).join(' ')"), '15:00 15:30 17:00 19:00 21:00 21:15', 'the shipped template shows the six student-facing stops');
});
await t(G2, 'timeline hides when the schedule has fewer than two stops', async p => {
  await tpl(p, 'complecio'); await p.ev("config.schedule=[{t:'09:00',name:'A',show:true}];renderClock()"); ok(await p.ev("document.getElementById('collections').hidden"));
});
await t(G2, 'warning state: amber near a milestone, normal far away, off when disabled', async p => {
  await tpl(p, 'complecio'); await sim(p, '16:56'); eq((await body(p)).data.state, 'warn');
  await sim(p, '15:40'); eq((await body(p)).data.state, 'ok');
  await p.ev("config.warnMin=0;renderClock()"); await sim(p, '16:58'); eq((await body(p)).data.state, 'ok');
  await p.ev("config.warnMin=5;config.tintMode='none';renderClock()"); await sim(p, '16:58'); eq((await body(p)).data.state, 'ok');
});
await t(G2, 'custom schedule typed in the editor drives the clock', async p => {
  await tpl(p, 'blank', 'schedule'); await open(p, 'clock');
  await p.ev(`(()=>{const t=document.getElementById('schedule-text');t.value='+09:00 Entrada | Seieu\\n+09:30 Inici de la prova | Bona sort\\nfoo bar\\n11:30 Final';t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  eq(await p.ev('config.schedule.length'), 3, 'invalid line ignored');
  await sim(p, '09:10'); eq(await txt(p, 'countdown'), '00:20'); eq(await txt(p, 'event-name'), 'Inici de la prova');
  eq(await txt(p, 'stage-hint-text'), 'Seieu', 'phase message of the previous milestone');
  eq(await p.ev("document.querySelectorAll('#collections .stop').length"), 2, 'only the lines starting with + are on the day line');
});
await t(G2, 'the stops are optional: none at all is allowed, and the mode can be switched off', async p => {
  await tpl(p, 'blank', 'schedule'); await open(p, 'clock');
  await p.ev(`(()=>{const t=document.getElementById('schedule-text');t.value='';t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  eq(await p.ev('config.schedule.length'), 0); eq(await txt(p, 'event-name'), 'Cap fita definida'); ok(await p.ev("document.getElementById('collections').hidden"));
  await sleep(400); await p.reload(); eq(await p.ev('config.schedule.length'), 0, 'stays empty after a reload');
  await open(p, 'clock'); await p.realClick('[data-mode-enable=schedule]'); await sleep(200);
  eq(await p.ev("config.enabledModes.includes('schedule')"), false); eq(await p.ev("document.querySelector('#mode-tabs [data-mode=schedule]').hidden"), true, 'tab hidden');
  ok(await cfg(p, 'clockMode') !== 'schedule', 'moved to an enabled mode'); eq(await p.ev("document.querySelector('#clock-mode option[value=schedule]').hidden"), true);
  await p.realClick('[data-mode-enable=schedule]'); await sleep(200);
  eq(await cfg(p, 'clockMode'), 'schedule', 'turning a mode on selects it'); eq(await p.ev("document.querySelector('#mode-tabs [data-mode=schedule]').hidden"), false);
  ok((await p.rect('#schedule-text')).h > 40, 'the Fites block is visible again'); eq(await p.ev("document.querySelector('#mode-tabs [data-mode=schedule]').getAttribute('aria-selected')"), 'true');
  for (const m of ['schedule', 'target', 'timer', 'stopwatch']) { await p.ev(`document.querySelector('[data-mode-enable=${m}]').click()`); }
  eq(await p.ev('config.enabledModes.join()'), 'clock', 'the last one cannot be switched off'); await p.ev("document.querySelector('[data-mode-enable=clock]').click()"); eq(await p.ev('config.enabledModes.join()'), 'clock');
});
await t(G2, 'schedule accepts at most 16 stops and sorts them', async p => {
  await tpl(p, 'blank', 'schedule'); await open(p, 'clock');
  const lines = Array.from({ length: 25 }, (_, i) => `${String(23 - Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'} P${i}`).join('\\n');
  await p.ev(`(()=>{const t=document.getElementById('schedule-text');t.value=\`${lines}\`;t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  eq(await p.ev('config.schedule.length'), 16);
  ok(await p.ev("sortedSchedule().every((e,i,a)=>i===0||a[i-1].t<=e.t)"), 'not sorted');
});
await t(G2, 'restore button brings the sample schedule back', async p => {
  await tpl(p, 'complecio'); await open(p, 'clock'); await p.ev("document.getElementById('schedule-reset').click()");
  eq(await p.ev('config.schedule.map(e=>e.name)'), ['Inici', 'Pausa', 'Represa', 'Final']);
});

// ───────────────────────── 3. Target countdown
const G3 = '3 Fins a una hora';
await t(G3, 'counts down to a time today and flags when reached', async p => {
  await p.ev("config.clockMode='target';config.target='18:30';config.targetFrom=17*3600;renderClock()");
  await sim(p, '17:45'); eq(await txt(p, 'countdown'), '00:45'); has(await txt(p, 'stage-detail'), '18:30');
  const prog = await p.ev("parseFloat(document.getElementById('progress').style.strokeDashoffset)/C");
  near(1 - prog, 0.5, 0.01, 'ring 50% (45 of 90 min)');
  await sim(p, '18:30'); eq(await txt(p, 'countdown'), '00:00'); eq((await body(p)).data.state, 'ended'); eq(await txt(p, 'ring-overline'), 'Hora assolida');
});
await t(G3, 'without a target it asks for one instead of crashing', async p => {
  await p.ev("config.clockMode='target';config.target='';renderClock()"); has(await txt(p, 'event-name'), 'Trieu una hora'); eq(await txt(p, 'countdown'), '--:--');
});
await t(G3, 'the target-time input in the editor is applied and persisted', async p => {
  await open(p, 'clock'); await p.ev("document.getElementById('clock-mode').value='target';document.getElementById('clock-mode').dispatchEvent(new Event('change',{bubbles:true}));const i=document.getElementById('target-time');i.value='22:10';i.dispatchEvent(new Event('input',{bubbles:true}))");
  eq(await cfg(p, 'target'), '22:10'); await sleep(400); await p.reload(); eq(await cfg(p, 'target'), '22:10'); eq(await cfg(p, 'clockMode'), 'target');
});

// ───────────────────────── 4. Timer
const G4 = '4 Temporitzador';
await t(G4, 'durations of 1 h 50 min and 2 h are one click away and read naturally', async p => {
  await p.ev("config.clockMode='timer';renderClock()"); await open(p, 'clock');
  const labels = await p.ev("[...document.querySelectorAll('#timer-presets button')].map(b=>b.textContent)");
  has(labels.join('|'), '1 h 50 min'); has(labels.join('|'), '2 h');
  await p.ev("[...document.querySelectorAll('#timer-presets button')].find(b=>b.textContent==='1 h 50 min').click()");
  eq(await txt(p, 'countdown'), '1:50:00'); eq(await cfg(p, 'timerMinutes'), 110); has(await txt(p, 'timer-human'), '1 h 50 min'); has(await txt(p, 'stage-detail'), '1 h 50 min');
  await p.ev("[...document.querySelectorAll('#timer-presets button')].find(b=>b.textContent==='2 h').click()"); eq(await txt(p, 'countdown'), '2:00:00');
});
await t(G4, 'idle shows the full duration and the controls', async p => {
  await p.ev("config.clockMode='timer';config.timerMinutes=45;config.timerState='idle';renderClock()");
  eq(await txt(p, 'countdown'), '45:00'); eq(await p.ev("document.getElementById('controls').hidden"), false);
});
await t(G4, 'start → running → pause freezes → resume → reset', async p => {
  await p.ev("config.clockMode='timer';config.timerMinutes=10;config.timerState='idle';renderClock()");
  await p.ev("document.getElementById('ctl-toggle').click()"); eq(await cfg(p, 'timerState'), 'running');
  await sleep(2200); const a = await txt(p, 'countdown'); ok(a < '10:00' && a >= '09:56', 'ticking ' + a);
  await p.ev("document.getElementById('ctl-toggle').click()"); eq(await cfg(p, 'timerState'), 'paused');
  const frozen = await txt(p, 'countdown'); await sleep(1300); eq(await txt(p, 'countdown'), frozen, 'frozen');
  await p.ev("document.getElementById('ctl-toggle').click()"); eq(await cfg(p, 'timerState'), 'running');
  await p.ev("document.getElementById('ctl-reset').click()"); eq(await cfg(p, 'timerState'), 'idle'); eq(await txt(p, 'countdown'), '10:00');
});
await t(G4, 'finishing turns the whole screen red and blinks', async p => {
  await p.ev("config.clockMode='timer';config.timerMinutes=1;config.timerBeep=false;config.timerState='running';config.timerEnd=Date.now()+1200;renderClock()");
  await sleep(2000); eq(await cfg(p, 'timerState'), 'done'); const b = await body(p); eq(b.data.state, 'ended');
  eq(await txt(p, 'countdown'), '00:00'); eq(await txt(p, 'ring-overline'), 'Temps esgotat');
  ok(await p.ev("document.getElementById('countdown').classList.contains('ended')"));
  const bg = await p.ev("getComputedStyle(document.body).backgroundColor"); ok(/rgb\(5\d, 4\d, 4\d\)/.test(bg), 'maroon background, got ' + bg);
});
await t(G4, '+1:00 extends running, idle and finished timers', async p => {
  await p.ev("config.clockMode='timer';config.timerMinutes=5;config.timerState='idle';renderClock()");
  await p.ev("document.getElementById('ctl-plus').click()"); eq(await txt(p, 'countdown'), '06:00');
  await p.ev("config.timerState='running';config.timerEnd=Date.now()+60000;renderClock();document.getElementById('ctl-plus').click()");
  const e = await p.ev("Math.round((config.timerEnd-Date.now())/1000)"); near(e, 120, 2, 'extended running');
  await p.ev("config.timerState='done';config.timerLeft=0;renderClock();document.getElementById('ctl-plus').click()"); eq(await cfg(p, 'timerState'), 'paused'); eq(await txt(p, 'countdown'), '01:00');
});
await t(G4, 'keyboard: T starts/pauses and R resets', async p => {
  await p.ev("config.clockMode='timer';config.timerMinutes=3;config.timerState='idle';renderClock()");
  await p.key('t'); eq(await cfg(p, 'timerState'), 'running'); await p.key('t'); eq(await cfg(p, 'timerState'), 'paused'); await p.key('r'); eq(await cfg(p, 'timerState'), 'idle');
});
await t(G4, 'a running timer survives a page reload', async p => {
  await p.ev("config.clockMode='timer';config.timerMinutes=10;renderClock();document.getElementById('ctl-toggle').click()"); await sleep(1500); await p.reload();
  eq(await cfg(p, 'timerState'), 'running'); const left = await p.ev('timerLeftNow()'); near(left, 598, 3, 'remaining after reload');
});
await t(G4, 'presets set the duration and reset the timer', async p => {
  await open(p, 'clock'); await p.ev("document.getElementById('clock-mode').value='timer';document.getElementById('clock-mode').dispatchEvent(new Event('change',{bubbles:true}))");
  eq(await p.ev("document.querySelectorAll('#timer-presets .btn').length"), 11);
  await p.ev("[...document.querySelectorAll('#timer-presets .btn')].find(b=>b.textContent==='1 h 30 min').click()"); eq(await cfg(p, 'timerMinutes'), 90); eq(await txt(p, 'countdown'), '1:30:00');
});
await t(G4, 'duration input rejects out-of-range values', async p => {
  await open(p, 'clock'); await p.ev("document.getElementById('clock-mode').value='timer';document.getElementById('clock-mode').dispatchEvent(new Event('change',{bubbles:true}));const i=document.getElementById('timer-minutes');i.value='9999';i.dispatchEvent(new Event('input',{bubbles:true}))");
  eq(await cfg(p, 'timerMinutes'), 600);
  await p.ev("{const i=document.getElementById('timer-minutes');i.value='0';i.dispatchEvent(new Event('input',{bubbles:true}))}"); eq(await cfg(p, 'timerMinutes'), 600, 'zero ignored');
});
await t(G4, 'sound toggle flips the icon and the setting', async p => {
  const before = await cfg(p, 'timerBeep'); await p.ev("document.getElementById('sound-btn').click()"); eq(await cfg(p, 'timerBeep'), !before);
  eq(await p.ev("document.getElementById('sound-btn').getAttribute('aria-pressed')"), String(!before));
});
await t(G4, 'controls are only shown for timer and stopwatch', async p => {
  for (const [m, vis] of [['schedule', false], ['target', false], ['clock', false], ['timer', true], ['stopwatch', true]]) {
    await p.ev(`config.clockMode='${m}';renderClock()`); eq(await p.ev("!document.getElementById('controls').hidden"), vis, m);
  }
  await p.ev("config.clockMode='stopwatch';renderClock()"); eq(await p.ev("document.getElementById('ctl-plus').hidden"), true, '+1:00 hidden on stopwatch');
});

// ───────────────────────── 5. Stopwatch & clock
const G5 = '5 Cronòmetre i hora';
await t(G5, 'stopwatch counts up, pauses and resets', async p => {
  await p.ev("config.clockMode='stopwatch';renderClock()"); eq(await txt(p, 'countdown'), '00:00');
  await p.key('t'); await sleep(2300); const a = await txt(p, 'countdown'); ok(a >= '00:02' && a <= '00:03', a);
  await p.key('t'); const f = await txt(p, 'countdown'); await sleep(1200); eq(await txt(p, 'countdown'), f);
  await p.key('r'); eq(await txt(p, 'countdown'), '00:00'); eq(await cfg(p, 'swState'), 'idle');
});
await t(G5, 'stopwatch shows hours past 60 minutes', async p => {
  await p.ev("config.clockMode='stopwatch';config.swState='paused';config.swElapsed=3725;renderClock()"); eq(await txt(p, 'countdown'), '1:02:05');
  ok(await p.ev("document.getElementById('countdown').classList.contains('long')"));
});
await t(G5, 'clock mode shows the time of the day, with or without seconds', async p => {
  await p.ev("config.clockMode='clock';config.seconds=false;renderClock()"); ok(/^\d\d:\d\d$/.test(await txt(p, 'countdown')));
  await p.ev("config.seconds=true;renderClock()"); ok(/^\d\d:\d\d:\d\d$/.test(await txt(p, 'countdown')));
  await sim(p, '08:07'); eq((await txt(p, 'countdown')).slice(0, 5), '08:07');
});
await t(G5, 'mode tabs switch modes and mark the selected tab', async p => {
  for (const m of ['target', 'timer', 'stopwatch', 'clock', 'schedule']) {
    await p.ev(`document.querySelector('#mode-tabs [data-mode=${m}]').click()`); eq(await cfg(p, 'clockMode'), m);
    eq(await p.ev("[...document.querySelectorAll('#mode-tabs .chip')].filter(c=>c.getAttribute('aria-selected')==='true').map(c=>c.dataset.mode)"), [m]);
  }
});

// ───────────────────────── 6. Layout
const G6 = '6 Disposició';
await t(G6, 'the five presets (buttons) set the split', async p => {
  for (const v of [100, 70, 50, 30, 0]) {
    await p.ev(`document.querySelector('#layout-seg [data-layout="${v}"]').click()`); eq(await cfg(p, 'layout'), v);
    const b = await body(p); eq(b.cls.includes('only-clock'), v === 100, 'only-clock'); eq(b.cls.includes('only-board'), v === 0, 'only-board');
    eq(await p.ev("document.documentElement.style.getPropertyValue('--clock')"), String(v));
    eq(await p.ev("document.querySelector('#layout-seg [aria-pressed=true]').dataset.layout"), String(v));
  }
});
await t(G6, 'keys 1–5 switch the layout', async p => {
  for (const [k, v] of [['1', 100], ['2', 70], ['3', 50], ['4', 30], ['5', 0]]) { await p.key(k); eq(await cfg(p, 'layout'), v, 'key ' + k); }
});
await t(G6, 'only-clock hides the message zone and vice versa', async p => {
  await p.ev("setLayout(100)"); eq(await p.ev("getComputedStyle(document.querySelector('.board')).display"), 'none'); ok((await p.rect('.time')).w > 1500);
  await p.ev("setLayout(0)"); eq(await p.ev("getComputedStyle(document.querySelector('.time')).display"), 'none'); ok((await p.rect('.board')).w > 1500);
});
await t(G6, 'the notice banner stays visible in every layout', async p => {
  await p.ev("config.banner='Avís';config.bannerLevel='urgent';renderHeader()");
  for (const v of [100, 50, 0]) { await p.ev(`setLayout(${v})`); ok((await p.rect('#banner')).h > 20, 'banner hidden at ' + v); }
});
await t(G6, 'dragging the divider resizes within 20–80% and persists', async p => {
  const s = await p.rect('#split'); const st = await p.rect('#stage');
  await p.mouse('mouseMoved', s.cx, s.cy, { buttons: 0 }); await p.mouse('mousePressed', s.cx, s.cy);
  await p.mouse('mouseMoved', st.x + st.w * 0.7, s.cy, { buttons: 1 }); await p.mouse('mouseReleased', st.x + st.w * 0.7, s.cy);
  near(await cfg(p, 'layout'), 70, 3, 'dragged to 70');
  await p.mouse('mousePressed', (await p.rect('#split')).cx, s.cy); await p.mouse('mouseMoved', 5, s.cy, { buttons: 1 }); await p.mouse('mouseReleased', 5, s.cy);
  eq(await cfg(p, 'layout'), 20, 'clamped at 20');
  await sleep(400); await p.reload(); eq(await cfg(p, 'layout'), 20);
});
await t(G6, 'divider is keyboard accessible', async p => {
  await p.ev("document.getElementById('split').focus()"); await p.key('ArrowRight'); eq(await cfg(p, 'layout'), 55); await p.key('ArrowLeft'); await p.key('ArrowLeft'); eq(await cfg(p, 'layout'), 45);
});
await t(G6, 'legacy "hidden" clock mode becomes message-only layout', async p => {
  eq(await cfg(p, 'layout'), 0); eq(await cfg(p, 'clockMode'), 'schedule');
}, { seed: { clockMode: 'hidden' } });

// ───────────────────────── 7. Theme & accent
const G7 = '7 Tema i color';
await t(G7, 'system theme follows the OS (dark)', async p => { ok(!(await body(p)).cls.includes('light')); eq(await p.ev("getComputedStyle(document.body).backgroundColor"), 'rgb(43, 46, 59)'); }, { scheme: 'dark' });
await t(G7, 'system theme follows the OS (light) and reacts live', async p => {
  ok((await body(p)).cls.includes('light'));
  await p.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }); await sleep(200); ok(!(await body(p)).cls.includes('light'), 'live switch to dark');
}, { scheme: 'light' });
await t(G7, 'theme button and D key cycle system → clar → fosc', async p => {
  eq(await cfg(p, 'theme'), 'system'); await p.key('d'); eq(await cfg(p, 'theme'), 'light'); await p.key('d'); eq(await cfg(p, 'theme'), 'dark'); await p.ev("document.getElementById('theme-btn').click()"); eq(await cfg(p, 'theme'), 'system');
});
await t(G7, 'explicit theme overrides the OS and persists', async p => {
  await p.ev("document.querySelector('[data-seg=theme] [data-v=light]').click()"); ok((await body(p)).cls.includes('light')); await sleep(400); await p.reload(); ok((await body(p)).cls.includes('light'));
}, { scheme: 'dark' });
await t(G7, 'text keeps enough contrast in both themes (WCAG AA ≥ 4.5)', async p => {
  const contrast = () => p.ev(`(()=>{const c=s=>s.match(/\\d+(\\.\\d+)?/g).slice(0,3).map(Number);const L=([r,g,b])=>{const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4};return .2126*f(r)+.7152*f(g)+.0722*f(b)};const fg=L(c(getComputedStyle(document.getElementById('countdown')).color)),bg=L(c(getComputedStyle(document.body).backgroundColor));const [a,b]=[Math.max(fg,bg),Math.min(fg,bg)];return (a+.05)/(b+.05)})()`);
  for (const th of ['dark', 'light']) { await p.ev(`config.theme='${th}';applyAppearance()`); await sleep(900); ok(await contrast() >= 4.5, th + ' contrast ' + await contrast()); }
});
await t(G7, 'accent swatches recolour the interface and persist', async p => {
  const prim = () => p.ev("getComputedStyle(document.body).getPropertyValue('--primary').trim()");
  const before = await prim(); await p.ev("document.querySelector('[data-swatches] [data-v=green]').click()");
  eq((await body(p)).data.accent, 'green'); ok((await prim()) !== before, 'primary changed'); eq(await prim(), '#7fd7a0');
  await sleep(400); await p.reload(); eq((await body(p)).data.accent, 'green');
  await p.ev("config.theme='light';applyAppearance()"); eq(await prim(), '#146c3d');
});
await t(G7, 'warn and ended tints override the accent', async p => {
  await tpl(p, 'complecio'); await p.ev("config.accent='green';applyAppearance()"); await sim(p, '16:58');
  eq(await p.ev("getComputedStyle(document.body).getPropertyValue('--primary').trim()"), '#f9dd8c');
});

await t(G7, 'the end-of-time colour is configurable: whole screen, ring only, or none', async p => {
  await tpl(p, 'complecio'); await sim(p, '16:58');
  eq(await cfg(p, 'tintMode'), 'screen', 'default'); eq(await p.ev("getComputedStyle(document.body).getPropertyValue('--bg').trim()"), '#322f20');
  await sleep(900); const bg0 = await p.ev("getComputedStyle(document.body).backgroundColor");
  await p.ev("config.tintMode='ring';renderClock()"); await sleep(900);
  eq((await body(p)).data.state, 'warn'); ok(await p.ev("getComputedStyle(document.body).backgroundColor") !== bg0, 'background back to normal');
  eq(await p.ev("getComputedStyle(document.getElementById('progress')).stroke"), 'rgb(224, 168, 0)', 'ring is amber');
  await p.ev("config.tintMode='none';renderClock()"); await sleep(300); eq((await body(p)).data.state, 'ok');
  await open(p, 'clock'); await p.ev("document.querySelector('[data-seg=tintMode] [data-v=screen]').click()"); eq(await cfg(p, 'tintMode'), 'screen');
  eq(await p.ev("document.querySelectorAll('[data-seg=tintMode] button').length"), 3);
});

await t(G7, 'the screen background colour is chosen in Aparença, for dark and light themes', async p => {
  await open(p, 'display');
  eq(await p.ev("document.querySelectorAll('[data-seg=bgColor] button').length"), 7); eq(await cfg(p, 'bgColor'), 'default');
  const seen = new Set();
  for (const th of ['dark', 'light']) {
    await p.ev(`config.theme='${th}';applyTheme();0`);
    for (const c of ['default', 'cream', 'mint', 'sky', 'rose', 'lilac', 'graphite']) {
      await p.ev(`document.querySelector('[data-seg=bgColor] [data-v=${c}]').click()`); await sleep(750);
      eq(await cfg(p, 'bgColor'), c); seen.add(th + await p.ev("getComputedStyle(document.body).backgroundColor"));
    }
  }
  eq(seen.size, 14, 'every colour differs in both themes');
  await sleep(300); await p.reload(); eq(await cfg(p, 'bgColor'), 'graphite', 'persisted');
});

await t(G7, 'clamped texts keep room for letter descenders (g, p, y are not cut at the bottom)', async p => {
  await p.ev("config.slides=[{id:'x',kind:'text',title:'Programa gypq',content:'Hola',visible:true,accent:'theme',image:''}];config.subtitle='Jornada gypq';config.clockNote='Agrupem gypq';activeId='x';renderHeader();renderSlide();renderClock()");
  const r = await p.ev(`(()=>{const out={};for(const s of ['.slide-title','#main-subtitle','#stage-hint-text']){const e=document.querySelector(s);const cs=getComputedStyle(e);const lh=parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.2;out[s]={lhRatio:lh/parseFloat(cs.fontSize),pad:parseFloat(cs.paddingBottom)/parseFloat(cs.fontSize),clip:e.scrollHeight>e.clientHeight+1}}return out})()`);
  for (const [s, v] of Object.entries(r)) { ok(v.lhRatio + v.pad >= 1.3, s + ' line box too tight: ' + JSON.stringify(v)); ok(!v.clip, s + ' clipped'); }
});

// ───────────────────────── 8. Appearance toggles
const G8 = '8 Aparença';
for (const [key, sel] of [['showLogo', '#logo-img'], ['showTitle', '.board-head h1'], ['showTabs', '.modes'], ['showTag', '.tagline'], ['showRing', '.ring svg'], ['showDay', '#collections']]) {
  await t(G8, `${key} off hides ${sel}, on restores it`, async p => {
    await tpl(p, 'complecio'); await sim(p, '16:10'); const vis = () => p.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});return !!e&&getComputedStyle(e).display!=='none'&&!e.hidden})()`);
    ok(await vis(), 'visible at start'); await p.ev(`config.${key}=false;applyAppearance()`); ok(!(await vis()), 'hidden'); await p.ev(`config.${key}=true;applyAppearance()`); ok(await vis(), 'restored');
  });
}
await t(G8, 'the text under the clock has its own switch in the editor and hides the label', async p => {
  await open(p, 'display'); ok(await p.ev("!!document.querySelector('[data-bool=showLabel]')"), 'toggle row missing'); ok((await p.rect('.what')).h > 10, 'label visible');
  await p.ev("(()=>{const c=document.querySelector('[data-bool=showLabel]');c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}))})()");
  eq(await p.ev("getComputedStyle(document.querySelector('.what')).display"), 'none'); eq(await cfg(p, 'showLabel'), false);
  await sleep(400); await p.reload(); eq(await p.ev("getComputedStyle(document.querySelector('.what')).display"), 'none', 'persisted');
});
await t(G8, 'showNote off hides the note card even when there is a message', async p => {
  await p.ev("config.clockNote='Hola';renderClock()"); ok((await p.rect('#stage-hint')).h > 20);
  await p.ev("config.showNote=false;applyAppearance()"); eq(await p.ev("getComputedStyle(document.getElementById('stage-hint')).display"), 'none');
});
await t(G8, 'showControls off hides the timer buttons', async p => {
  await p.ev("config.clockMode='timer';config.showControls=false;applyAppearance();renderClock()"); eq(await p.ev("getComputedStyle(document.getElementById('controls')).display"), 'none');
});
await t(G8, 'sliders drive dial size and logo size', async p => {
  const r0 = await p.rect('.ring'); const l0 = await p.rect('#logo-img');
  await p.ev("(()=>{const d=document.querySelector('[data-range=dial]');d.value=60;d.dispatchEvent(new Event('input',{bubbles:true}))})()");
  near((await p.rect('.ring')).w / r0.w, 0.6, 0.03, 'dial');
  await p.ev("(()=>{const l=document.querySelector('[data-range=logoScale]');l.value=150;l.dispatchEvent(new Event('input',{bubbles:true}))})()");
  near((await p.rect('#logo-img')).h / l0.h, 1.5, 0.05, 'logo');
});
await t(G8, 'label and note sizes scale the text', async p => {
  await p.ev("config.clockNote='Missatge';renderClock()");
  const size = sel => p.ev(`parseFloat(getComputedStyle(document.querySelector(${JSON.stringify(sel)})).fontSize)`);
  const l0 = await size('.what'), n0 = await size('.hint');
  await p.ev("document.querySelector('[data-seg=labelSize] [data-v=xl]').click();document.querySelector('[data-seg=noteSize] [data-v=xl]').click()");
  ok(await size('.what') > l0 * 1.5, 'label bigger'); ok(await size('.hint') > n0 * 1.5, 'note bigger');
  await p.ev("document.querySelector('[data-seg=labelSize] [data-v=s]').click();document.querySelector('[data-seg=noteSize] [data-v=s]').click()");
  ok(await size('.what') < l0, 'label smaller'); ok(await size('.hint') < n0, 'note smaller');
});
await t(G8, 'note style (info/important/urgent) and label accent colour', async p => {
  await p.ev("config.clockNote='X';renderClock()");
  for (const lv of ['info', 'important', 'urgent']) { await p.ev(`document.querySelector('[data-seg=noteLevel] [data-v=${lv}]').click()`); eq(await p.ev("document.getElementById('stage-hint').dataset.level"), lv); }
  const c0 = await p.ev("getComputedStyle(document.querySelector('.what')).color"); await p.ev("config.labelAccent=true;applyAppearance()");
  ok((await p.ev("getComputedStyle(document.querySelector('.what')).color")) !== c0, 'accent colour');
});
await t(G8, 'controls auto-hide after the idle time and wake on mouse move', async p => {
  await p.ev("config.idle=1;persist()"); await p.mouse('mouseMoved', 300, 300, { buttons: 0 }); await sleep(1500); ok((await body(p)).cls.includes('idle'), 'idle');
  eq(await p.ev("getComputedStyle(document.querySelector('.modes')).opacity"), '0'); ok((await p.rect('#logo-img')).h > 60, 'logo stays');
  await p.mouse('mouseMoved', 400, 320, { buttons: 0 }); await sleep(500); ok(!(await body(p)).cls.includes('idle'), 'woke');
});
await t(G8, 'idle = 0 never hides the controls', async p => {
  await p.ev("config.idle=0"); await p.mouse('mouseMoved', 300, 300, { buttons: 0 }); await sleep(1200); ok(!(await body(p)).cls.includes('idle'));
}, { seed: { idle: 0 } });
await t(G8, 'every appearance control reflects the saved config when the editor opens', async p => {
  await open(p, 'display');
  eq(await p.ev("document.querySelector('[data-seg=labelSize] [aria-checked=true]').dataset.v"), 'l');
  eq(await p.ev("document.querySelector('[data-bool=showLogo]').checked"), false); eq(await p.ev("document.querySelector('[data-range=dial]').value"), '70');
  eq(await p.ev("document.querySelector('[data-swatches] [aria-checked=true]').dataset.v"), 'purple');
}, { seed: { labelSize: 'l', showLogo: false, dial: 70, accent: 'purple' } });

// ───────────────────────── 9. Notice banner & messages
const G9 = '9 Avisos';
await t(G9, 'every level has its own icon and colours, for the banner and the highlighted message', async p => {
  await p.ev("config.banner='Avís';config.clockNote='Nota';renderHeader();renderClock()");
  const seen = new Set(), icons = new Set();
  for (const lv of ['info', 'success', 'important', 'urgent', 'note']) {
    await p.ev(`config.bannerLevel='${lv}';config.noteLevel='${lv}';renderHeader();renderClock()`);
    seen.add(await p.ev("getComputedStyle(document.getElementById('banner')).backgroundColor") + await p.ev("getComputedStyle(document.getElementById('stage-hint')).backgroundColor"));
    icons.add(await p.ev("document.getElementById('banner-ic').innerHTML"));
    ok((await p.rect('#banner-ic svg')).w > 10, 'icon visible for ' + lv);
  }
  eq(seen.size, 5, 'distinct colours'); eq(icons.size, 5, 'distinct icons');
  ok(!(await p.ev("document.getElementById('banner-label')")), 'no label element');
});
await t(G9, 'the banner content is centred in the banner', async p => {
  await p.ev("config.banner='Canvi d\u2019aula';config.bannerLevel='info';renderHeader()");
  const b = await p.rect('#banner'), i = await p.rect('#banner-ic'), t = await p.rect('#banner-content');
  const mid = (i.x + t.x + t.w) / 2; ok(Math.abs(mid - b.cx) < 8, 'icon+text group off-centre by ' + Math.round(mid - b.cx));
});
await t(G9, 'the level pickers in the editor set the banner and the message', async p => {
  await open(p, 'general'); await p.realClick('[data-seg=bannerLevel] [data-v=success]');
  eq(await cfg(p, 'bannerLevel'), 'success'); eq(await p.ev("document.querySelectorAll('[data-seg=bannerLevel] [aria-checked=true]').length"), 1);
  eq(await p.ev("document.querySelectorAll('[data-seg=bannerLevel] button').length"), 5);
});
await t(G9, 'banner shows text, tag and level; hides when emptied', async p => {
  await open(p, 'general');
  await p.ev("(()=>{const s=(id,v)=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))};s('banner-input','Canvi d’aula');s('banner-input','Canvi d’aula')})()");
  ok(!(await p.ev("document.getElementById('banner').hidden"))); eq(await txt(p, 'banner-content'), 'Canvi d’aula'); await p.ev("config.bannerLevel='urgent';renderHeader()"); eq(await p.ev("document.getElementById('banner').dataset.level"), 'urgent');
  await p.ev("(()=>{const e=document.getElementById('banner-input');e.value='';e.dispatchEvent(new Event('input',{bubbles:true}))})()"); ok(await p.ev("document.getElementById('banner').hidden"));
});
await t(G9, 'live-edit of title, subtitle, room and board name', async p => {
  await open(p, 'general');
  await p.ev("(()=>{const s=(id,v)=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};s('title-input','Prova FOL');s('subtitle-input','Aula magna');s('room-input','Aula 2.3');s('board-input','Tauler')})()");
  eq(await txt(p, 'main-title'), 'Prova FOL'); eq(await txt(p, 'main-subtitle'), 'Aula magna'); eq(await txt(p, 'room-badge'), 'Aula 2.3'); ok(!(await p.ev("document.getElementById('room-badge').hidden")));
});
await t(G9, 'text under the clock and the highlighted message are editable and bounded', async p => {
  await open(p, 'clock'); await p.ev("document.getElementById('clock-mode').value='clock';document.getElementById('clock-mode').dispatchEvent(new Event('change',{bubbles:true}))");
  await p.ev("(()=>{const s=(id,v)=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};s('clock-label','Prova de FOL');s('clock-note','Lliureu abans de sortir')})()");
  eq(await txt(p, 'event-name'), 'Prova de FOL'); eq(await txt(p, 'stage-hint-text'), 'Lliureu abans de sortir');
  ok(await p.ev("document.getElementById('clock-label').maxLength")===60, 'label maxlength');
});
await t(G9, 'a per-phase message replaces the automatic guidance', async p => {
  await p.ev("config.clockMode='schedule';config.schedule=[{t:'15:00',name:'Inici',show:true,msg:''},{t:'17:00',name:'Recollida',show:true,msg:'Entregueu la primera prova'}];renderClock()"); 
  await sim(p, '17:30'); eq(await txt(p, 'stage-hint-text'), 'Entregueu la primera prova');
});

// ───────────────────────── 10. Sections (slides)
const G10 = '10 Seccions';
const slideTitles = p => p.ev("visibleSlides().map(s=>s.title)");
await t(G10, 'default sections exist, nav and dots work', async p => {
  await tpl(p, 'complecio', 'clock');
  eq(await p.ev('visibleSlides().length'), 4); eq(await p.ev("document.querySelectorAll('#slide-dots .dot').length"), 4); eq(await txt(p, 'slide-count'), '1 / 4');
  await p.ev("document.getElementById('next-btn').click()"); eq(await txt(p, 'slide-count'), '2 / 4'); await p.ev("document.getElementById('prev-btn').click();document.getElementById('prev-btn').click()"); eq(await txt(p, 'slide-count'), '4 / 4', 'wraps');
  await p.ev("document.querySelectorAll('#slide-dots .dot')[1].click()"); eq(await txt(p, 'slide-count'), '2 / 4');
});
await t(G10, 'a text section uses the width of the message zone when it takes the whole screen', async p => {
  await p.ev("config.layout=0;config.slides=[{id:'a',type:'text',title:'T',visible:true,content:'Un missatge prou llarg per ocupar diverses línies si l\u2019ample fos estret, i que ha de repartir-se per tota la pantalla projectada.'}];config.slideIndex=0;save();location.reload()"); await sleep(600);
  const w = await p.rect('.prose'), b = await p.rect('.slide-body');
  ok(w && b && w.w > b.w * 0.6, 'text column too narrow: ' + (w && Math.round(w.w)) + ' of ' + (b && Math.round(b.w)));
});
await t(G10, 'arrow keys move between sections', async p => {
  await tpl(p, 'complecio', 'clock'); await p.key('ArrowRight'); eq(await txt(p, 'slide-count'), '2 / 4'); await p.key('ArrowLeft'); eq(await txt(p, 'slide-count'), '1 / 4'); });
await t(G10, 'add, edit, duplicate, reorder and delete a section', async p => {
  await tpl(p, 'complecio', 'clock');
  await open(p, 'slides'); await p.ev("document.getElementById('add-slide').click()"); eq(await p.ev('config.slides.length'), 5);
  await p.ev("(()=>{const s=(id,v)=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};s('slide-title','Nova prova');s('slide-text','Un\\nDos\\nTres')})()");
  eq(await txt(p, 'slide').then(() => p.ev("document.querySelector('#slide .slide-title').textContent")), 'Nova prova'); eq(await p.ev("document.querySelectorAll('#slide li').length"), 3);
  await p.ev("document.getElementById('copy-slide').click()"); eq(await p.ev('config.slides.length'), 6);
  await p.ev("document.getElementById('move-up').click()"); eq(await p.ev("config.slides.map(s=>s.title).slice(4,6)"), ['Nova prova (còpia)', 'Nova prova']);
  await p.ev("document.getElementById('remove-slide').click()"); eq(await p.ev('config.slides.length'), 5); ok(p.dialogs.length === 1, 'confirm dialog shown');
});
await t(G10, 'cancelling the delete confirmation keeps the section', async p => {
  await tpl(p, 'complecio', 'clock');
  p.acceptDialogs = false; await open(p, 'slides'); await p.ev("document.getElementById('remove-slide').click()"); await sleep(200); eq(await p.ev('config.slides.length'), 4);
});
await t(G10, 'hidden sections leave the rotation and the counter', async p => {
  await tpl(p, 'complecio', 'clock');
  await open(p, 'slides'); await p.ev("(()=>{const c=document.getElementById('slide-visible');c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}))})()");
  eq(await p.ev('visibleSlides().length'), 3); eq(await p.ev("document.querySelectorAll('#slide-dots .dot').length"), 3);
});
await t(G10, 'the limit of 30 sections is enforced', async p => {
  await open(p, 'slides'); for (let i = 0; i < 30; i++) await p.ev("document.getElementById('add-slide').click()"); eq(await p.ev('config.slides.length'), 30);
});
await t(G10, 'the five sample presets add sections', async p => {
  await open(p, 'slides'); const n0 = await p.ev('config.slides.length'); await p.ev("document.querySelectorAll('[data-preset]').forEach(b=>b.click())"); eq(await p.ev('config.slides.length'), n0 + 5);
});
await t(G10, 'all five kinds render (list, text, notice, image, table)', async p => {
  const imgPixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const kinds = [['list', 'a\nb', '#slide li', 2], ['text', 'hola', '#slide .text-content', 1], ['notice', 'ALERTA', '.slide.is-notice .callout', 1], ['image', 'peu', '#slide img.slide-image', 1], ['table', 'A|B\n1|2\n3|4', '#slide .info-table tbody tr', 2]];
  for (const [kind, content, sel, n] of kinds) {
    await p.ev(`config.slides=[{id:'x',kind:'${kind}',title:'T',content:${JSON.stringify(content)},visible:true,accent:'theme',image:${kind === 'image' ? JSON.stringify(imgPixel) : "''"}}];activeId='x';renderSlide()`);
    eq(await p.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`), n, kind);
  }
});
await t(G10, 'automatic rotation advances and the pause button/space stop it', async p => {
  await tpl(p, 'complecio', 'clock');
  await p.ev("config.rotateSeconds=10;lastRotation=Date.now()-11000"); await sleep(700); eq(await txt(p, 'slide-count'), '2 / 4', 'rotated');
  await p.key(' '); await p.ev("lastRotation=Date.now()-60000"); await sleep(700); eq(await txt(p, 'slide-count'), '2 / 4', 'paused');
  has(await txt(p, 'rotation-btn'), 'Reprèn');
});
await t(G10, 'rotation does not run while the editor is open', async p => {
  await tpl(p, 'complecio', 'clock');
  await open(p); await p.ev("lastRotation=Date.now()-60000"); await sleep(700); eq(await txt(p, 'slide-count'), '1 / 4');
});
await t(G10, 'rotation setting off keeps a single section', async p => {
  await tpl(p, 'complecio', 'clock');
  await p.ev("config.autoRotate=false;updateRotation();lastRotation=Date.now()-99999"); await sleep(700); eq(await txt(p, 'slide-count'), '1 / 4');
});
await t(G10, 'user text is rendered as text, never as HTML (XSS)', async p => {
  await p.ev(`config.slides=[{id:'x',kind:'list',title:'<img src=x onerror=window.__pwned=1>',content:'<b>bold</b>\\n<script>window.__pwned=2<\\/script>',visible:true,accent:'theme',image:''}];config.banner='<img src=x onerror=window.__pwned=3>';config.title='<svg onload=window.__pwned=4>';activeId='x';renderSlide();renderHeader()`);
  await sleep(200); eq(await p.ev('window.__pwned===undefined'), true); eq(await p.ev("document.querySelectorAll('#slide img,#slide b,#slide script,#banner img').length"), 0);
  eq(await p.ev("document.querySelector('#slide li .t').textContent"), '<b>bold</b>');
});
await t(G10, 'long content shrinks to fit and short content grows, in every layout', async p => {
  const fits = () => p.ev("(()=>{const b=document.querySelector('.slide-body');const l=b.lastElementChild.getBoundingClientRect().bottom;return l<=b.getBoundingClientRect().bottom+1&&b.scrollHeight<=b.clientHeight+1})()");
  const long = Array.from({ length: 14 }, (_, i) => `Punt ${i + 1} amb text prou llarg per ocupar més d’una línia en pantalla de projecció`).join('\\n');
  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    for (const lay of [100, 70, 50, 30, 0]) {
      await p.ev(`setLayout(${lay});config.slides=[{id:'x',kind:'list',title:'Llarg',content:\`${long}\`,visible:true,accent:'theme',image:''}];activeId='x';renderSlide()`); await sleep(250);
      ok(await fits(), `long overflows at ${w}x${h} layout ${lay}`);
    }
    await p.ev("setLayout(0);config.slides=[{id:'x',kind:'list',title:'Curt',content:'Un\\nDos',visible:true,accent:'theme',image:''}];activeId='x';renderSlide()"); await sleep(250);
    ok(parseFloat(await p.ev("document.getElementById('slide').style.getPropertyValue('--fit')")) > 1.1, 'short grows'); ok(await fits(), 'short fits');
  }
});
await t(G10, 'section text size: "Normal" stays moderate and the four sizes are ordered', async p => {
  await p.ev("config.slides=[{id:'x',kind:'list',title:'T',content:'Un punt\\nAltre punt',visible:true,accent:'theme',image:''}];activeId='x';renderSlide()");
  const fs = async () => { await sleep(150); return p.ev("parseFloat(getComputedStyle(document.querySelector('#slide li')).fontSize)"); };
  await p.ev("setLayout(50)"); await sleep(200); const base = await fs(); ok(base <= 42 && base >= 28, 'normal at 50/50 is ' + base + 'px');
  await p.ev("setLayout(0)"); await sleep(250); const wide = await fs(); ok(wide <= 75, 'normal in message-only is ' + wide + 'px'); ok(wide > base, 'grows with the space');
  await p.ev("setLayout(50)"); const sizes = [];
  for (const v of ['small', 'normal', 'large', 'xlarge']) { await p.ev(`document.querySelector('[data-seg=textSize] [data-v=${v}]').click()`); eq(await cfg(p, 'textSize'), v); await sleep(250); sizes.push(await fs()); }
  ok(sizes[0] < sizes[1] && sizes[1] < sizes[2] && sizes[2] < sizes[3], 'ordered ' + sizes.join('<'));
});
await t(G10, 'the growth of the text is capped by the width of its zone', async p => {
  await p.ev("config.slides=[{id:'x',kind:'text',title:'T',content:'Hola',visible:true,accent:'theme',image:''}];activeId='x';setLayout(70);renderSlide()"); await sleep(300);
  ok(parseFloat(await p.ev("document.getElementById('slide').style.getPropertyValue('--fit')")) <= 1.01, 'narrow zone: no growth');
  await p.ev("setLayout(0)"); await sleep(300); const f = parseFloat(await p.ev("document.getElementById('slide').style.getPropertyValue('--fit')")); ok(f > 1.4 && f <= 2.21, 'wide zone grows to ' + f);
});

// ───────────────────────── 11. Editor
const G11 = '11 Editor';
await t(G11, 'opens with the button, E key; closes with ✕ and Esc; tabs switch panes', async p => {
  await p.ev("document.getElementById('edit-btn').click()"); ok((await body(p)).cls.includes('panel-open')); await p.ev("document.getElementById('close-btn').click()"); ok(!(await body(p)).cls.includes('panel-open'));
  await p.key('e'); ok((await body(p)).cls.includes('panel-open')); await p.key('Escape'); ok(!(await body(p)).cls.includes('panel-open'));
  await open(p);
  for (const tab of ['general', 'slides', 'clock', 'display', 'files']) {
    await p.ev(`document.querySelector('[data-tab=${tab}]').click()`); eq(await p.ev("[...document.querySelectorAll('.pane.active')].map(e=>e.id)"), ['pane-' + tab]);
    eq(await p.ev("document.querySelector('.tab[aria-selected=true]').dataset.tab"), tab);
  }
});
await t(G11, 'keyboard shortcuts are ignored while typing in a field', async p => {
  await open(p, 'general'); await p.ev("document.getElementById('title-input').focus()"); const l0 = await cfg(p, 'layout'); await p.key('3'); await p.key('d');
  eq(await cfg(p, 'layout'), l0); eq(await cfg(p, 'theme'), 'system');
});
await t(G11, 'editor panel has a usable width and fits in the viewport', async p => { await open(p, 'display'); const r = await p.rect('#drawer'); ok(r.w >= 380 && r.w <= 520, 'width ' + r.w); near(r.h, 1080, 2); });
await t(G11, 'simulation banner appears and "torna a l’hora real" clears it', async p => {
  await open(p, 'display'); await p.ev("(()=>{const i=document.getElementById('test-time');i.value='16:55';})();document.getElementById('simulate').click()");
  ok(!(await p.ev("document.getElementById('test-banner').hidden"))); eq(await txt(p, 'countdown'), '16:55'); await p.ev("document.getElementById('test-stop').click()"); ok(await p.ev("document.getElementById('test-banner').hidden")); eq(await p.ev('simulated'), null);
});
await t(G11, 'persistence: edits survive a reload', async p => {
  await open(p, 'general'); await p.ev("(()=>{const e=document.getElementById('title-input');e.value='Persistit';e.dispatchEvent(new Event('input',{bubbles:true}))})()"); await sleep(400); await p.reload(); eq(await txt(p, 'main-title'), 'Persistit');
});
await t(G11, 'reset restores defaults after confirmation', async p => {
  await p.ev("config.title='X';config.layout=100;config.accent='pink';save()"); await open(p, 'files'); await p.ev("document.getElementById('reset-btn').click()"); await sleep(250);
  eq(await cfg(p, 'title'), 'Benvinguts'); eq(await cfg(p, 'layout'), 50); eq(await cfg(p, 'accent'), 'blue'); ok(p.dialogs.length >= 1);
});
await t(G11, 'import applies a valid file and rejects an invalid one', async p => {
  const dir = mkdtempSync(join(tmpdir(), 'ioc-import-')); const good = join(dir, 'ok.json'); const bad = join(dir, 'bad.json');
  writeFileSync(good, JSON.stringify({ app: 'Rellotge-IOC', version: 2, config: { title: 'Importat', accent: 'teal', layout: 70, slides: [{ id: 'a', kind: 'text', title: 'Hola', content: 'Món', visible: true }] } }));
  writeFileSync(bad, '{not json'); await open(p, 'files');
  await p.setFiles('#import-file', [bad]); eq(await cfg(p, 'title'), 'Benvinguts', 'invalid ignored'); 
  await p.setFiles('#import-file', [good]); eq(await cfg(p, 'title'), 'Importat'); eq(await cfg(p, 'accent'), 'teal'); eq(await cfg(p, 'layout'), 70); eq(await p.ev('config.slides.length'), 1);
}, { allowErrors: true });

// ───────────────────────── 12. Robustness
const G12 = '12 Robustesa';
await t(G12, 'corrupted localStorage falls back to defaults', async p => { eq(await cfg(p, 'title'), 'Benvinguts'); eq(await cfg(p, 'layout'), 50); }, { seed: '{{{ not json' });
await t(G12, 'invalid and hostile values are sanitised', async p => {
  eq(await cfg(p, 'accent'), 'blue'); eq(await cfg(p, 'theme'), 'system'); eq(await cfg(p, 'dial'), 100); eq(await cfg(p, 'logoScale'), 160); eq(await cfg(p, 'idle'), 0, 'negative clamps to 0');
  eq(await cfg(p, 'layout'), 100); eq(await cfg(p, 'clockMode'), 'clock'); ok((await cfg(p, 'title')).length <= 120, 'title truncated'); eq(await cfg(p, 'timerMinutes'), 600); eq(await cfg(p, 'target'), '');
  eq(await p.ev('config.schedule.length'), 4, 'bad schedule ignored'); eq(await p.ev('config.slides.length'), 1, 'bad slides ignored → defaults');
}, { seed: { accent: 'neon', theme: 'purple', dial: 'abc', logoScale: 99999, idle: -5, layout: 1000, clockMode: 'nope', title: 'x'.repeat(5000), timerMinutes: 99999, target: '25:99', schedule: [{ t: '99:99', name: 'x' }], slides: 'oops' } });
await t(G12, 'a missing localStorage (private mode) does not break the app', async p => { eq(await txt(p, 'main-title'), 'Benvinguts'); await p.ev("document.getElementById('next-btn').click()"); },
  { pre: "Object.defineProperty(window,'localStorage',{get(){throw new Error('denied')}});", allowErrors: true });
await t(G12, 'midnight and the first second of the day are handled', async p => { await tpl(p, 'complecio'); await sim(p, '00:00'); eq(await txt(p, 'countdown'), '14:00'); eq(await txt(p, 'stage-tag'), 'Abans de començar'); });
await t(G12, 'time travel: simulated time never breaks the timer or stopwatch', async p => { await sim(p, '16:10'); await p.ev("config.clockMode='timer';config.timerMinutes=2;renderClock();document.getElementById('ctl-toggle').click()"); await sleep(1300); ok((await txt(p, 'countdown')) < '02:00'); });
await t(G12, 'no timers leak: the heap stays flat over many renders', async p => {
  const heap = () => p.ev("performance.memory?performance.memory.usedJSHeapSize:0"); const a = await heap();
  await p.ev("for(let i=0;i<3000;i++){renderClock();renderSlide()}"); await p.cmd('HeapProfiler.collectGarbage').catch(() => {}); const b = await heap();
  ok(!a || b - a < 12 * 1024 * 1024, 'heap grew ' + ((b - a) / 1048576).toFixed(1) + ' MB');
});
await t(G12, 'the clock digits always stay inside the ring (1080p, 720p, 4K, portrait)', async p => {
  await p.ev("config.clockMode='stopwatch';config.swState='paused';config.swElapsed=36061;renderClock()");
  for (const [w, h] of [[1920, 1080], [1280, 720], [3840, 2160], [900, 1400]]) {
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(250);
    const ok2 = await p.ev("(()=>{const d=document.getElementById('countdown').getBoundingClientRect(),r=document.querySelector('.ring').getBoundingClientRect();return d.left>=r.left&&d.right<=r.right&&d.top>=r.top&&d.bottom<=r.bottom})()"); ok(ok2, `digits outside ring at ${w}x${h}`);
  }
});
await t(G12, 'on a phone the page can still be scrolled down to the messages', async p => {
  await p.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(300);
  eq(await p.ev("getComputedStyle(document.body).overflowY"), 'auto'); ok(await p.ev("document.body.scrollHeight > innerHeight + 50"), 'content is taller than the screen');
  await p.ev("document.body.scrollTo(0, document.body.scrollHeight)"); await sleep(150); ok(await p.ev("document.body.scrollTop > 100"), 'it actually scrolls');
});
await t(G12, 'mobile portrait: stacked layout, no clipped controls', async p => {
  await p.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(300);
  ok(await p.ev('document.documentElement.scrollWidth<=innerWidth+1'), 'h-scroll'); ok((await p.rect('.time')).w <= 390 && (await p.rect('.board')).w <= 390);
});


// ───────────────────────── 13. Plantilles i text configurable (res de compleció dins del codi)
const G13 = '13 Plantilles';
await t(G13, 'the word "compleció" (or PAF) is not hardcoded anywhere in the app', async () => {
  const src = readFileSync(fileURLToPath(URL_APP), 'utf8').replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g, 'IMG');
  eq(src.split('\n').filter(l => /compleci|PAF/i.test(l)), [], 'occurrences'); eq(src.includes('Instruccions_PAF'), false);
});
await t(G13, 'the IOC app has no translations and no language selector', async p => {
  eq(await p.ev("!document.getElementById('lang-btn')&&typeof I18N==='undefined'&&typeof setLanguage==='undefined'"), true);
}, { locale: 'es-ES' });
await t(G13, 'the interface stays in Catalan whatever the browser language is', async p => {
  await open(p, 'display'); eq(await txt(p, 'edit-btn').then(() => p.ev("document.getElementById('edit-btn').title")), 'Configuració · tecla E'); eq(await p.ev("document.querySelector('[data-tab=display]').textContent"), 'Aparença');
}, { locale: 'en-GB' });
await t(G13, 'the default screen is neutral (no school, exam or collection wording)', async p => {
  await open(p);
  for (const tab of ['general', 'slides', 'clock', 'display', 'files']) { await p.ev(`document.querySelector('[data-tab=${tab}]').click()`); }
  const text = await p.ev("document.body.innerText + ' ' + [...document.querySelectorAll('input,textarea')].map(e=>e.placeholder+e.value).join(' ')");
  eq(/PAF|compleci|recollida|FOL|EIE|LOE/i.test(text), false, 'specific wording visible: ' + (text.match(/.{0,20}(PAF|compleci|recollida|FOL|EIE|LOE).{0,20}/i) || [''])[0]);
  eq(await txt(p, 'main-title'), 'Benvinguts'); eq(await cfg(p, 'subtitle'), '');
});
await t(G13, 'the page title follows the configured title', async p => {
  await open(p, 'general'); await p.ev("(()=>{const e=document.getElementById('title-input');e.value='Institut Exemple';e.dispatchEvent(new Event('input',{bubbles:true}))})()");
  eq(await p.ev('document.title'), 'Institut Exemple');
});
for (const [key, title, stops, slides] of [['blank', 'Benvinguts', 4, 1], ['exam', 'Examen', 4, 2], ['event', 'Jornada', 5, 2]]) {
  await t(G13, `built-in template "${key}" is applied from the Desar tab, keeping the look and feel`, async p => {
    await p.ev("config.accent='pink';config.layout=70;config.theme='dark';config.dial=80;config.logoMode='custom';applyAppearance();applyLayout()");
    await open(p, 'files'); await p.ev(`document.querySelector('[data-template=${key}]').click()`); await sleep(150);
    eq(await cfg(p, 'title'), title); eq(await p.ev('config.schedule.length'), stops); eq(await p.ev('config.slides.length'), slides);
    eq(await txt(p, 'main-title'), title); eq(await cfg(p, 'accent'), 'pink'); eq(await cfg(p, 'layout'), 70); eq(await cfg(p, 'dial'), 80); eq(await cfg(p, 'logoMode'), 'custom'); ok(p.dialogs.length === 1, 'asks for confirmation');
  });
}
await t(G13, 'declining the template confirmation changes nothing', async p => {
  p.acceptDialogs = false; await p.ev("config.title='Meu';save()"); await open(p, 'files'); await p.ev("document.querySelector('[data-template=exam]').click()"); await sleep(150); eq(await cfg(p, 'title'), 'Meu');
});
await t(G13, 'a template with phases drives the clock end-to-end', async p => {
  await p.ev("applyTemplate('exam');config.clockMode='schedule';renderClock()"); await sim(p, '09:20'); eq(await txt(p, 'stage-tag'), 'Inici de l’examen'); has(await txt(p, 'stage-hint-text'), 'nom'); eq(await txt(p, 'event-name'), 'Entrega');
});
await t(G13, 'the shipped collection template is valid, imported as your own and applied: seu, schedule and sections', async p => {
  await open(p, 'files'); eq(await p.ev("document.querySelectorAll('#my-templates b').length"), 0);
  await p.setFiles('#tpl-file', [fileURLToPath(new URL('../presets/proves-compleccio.json', import.meta.url))]);
  has(await txt(p, 'tpl-status'), 'desada');
  await p.ev("document.querySelector('#my-templates .btn:not(.danger)').click()"); await sleep(250);
  eq(await cfg(p, 'room'), 'Aula DAW'); has(await cfg(p, 'subtitle'), 'Escola del Treball'); eq(await cfg(p, 'clockMode'), 'schedule');
  eq(await p.ev('config.schedule.length'), 10); eq(await p.ev('config.slides.length'), 8); eq(await p.ev('visibleSlides().length'), 6, 'teacher sections are hidden');
  eq(await p.ev("config.slides.filter(s=>!s.visible).map(s=>s.title).join('|')"), 'Vigilància (professorat)|Final de jornada (professorat)');
});
await t(G13, 'the shipped collection template follows the protocol: times, phases and messages', async p => {
  eq(JSON.stringify(SHIPPED.data.schedule.map(e => e.t)), JSON.stringify(['14:00', '14:45', '15:00', '15:30', '16:10', '17:00', '19:00', '21:00', '21:15', '21:30']));
  await tpl(p, 'blank'); await p.ev(`applyTemplateData(${JSON.stringify(SHIPPED.data)})`);
  await sim(p, '15:10'); eq(await txt(p, 'stage-tag'), 'Inici de les proves'); eq(await txt(p, 'countdown'), '00:20'); has(await txt(p, 'stage-hint-text'), 'Mòbils');
  await sim(p, '16:58'); eq(await txt(p, 'event-name'), 'Primera recollida'); eq((await body(p)).data.state, 'warn');
  await sim(p, '21:20'); eq(await txt(p, 'stage-tag'), 'Recollida de la resta');
  const all = JSON.stringify(SHIPPED); ok(!/chat\.whatsapp|https?:/.test(all), 'no links in a projected screen');
  for (const e of SHIPPED.data.schedule) { ok(e.name.length <= 60 && e.msg.length <= 140, 'limits ' + e.name); }
  const back = await p.ev("normalizeState(" + JSON.stringify(SHIPPED.data) + ")"); eq(back.schedule.length, 10); eq(back.slides.length, 8);
});
const ALL_NON_DEFAULT = {
  enabledModes: ['timer', 'clock'], title: 'Prova completa', subtitle: 'Sub', room: 'Aula 9', board: 'Tauler X', banner: 'Avís X', bannerLevel: 'note',
  theme: 'light', textSize: 'large', clockMode: 'timer', layout: 70, logoMode: 'custom', logoAlt: 'Centre X', logoScale: 130,
  autoHint: true, accent: 'teal', bgColor: 'sky', dial: 80, listStyle: 'numbers', labelSize: 'l', labelAccent: true, noteSize: 'xl', noteLevel: 'success',
  showLogo: false, showTitle: false, showTabs: false, showTag: false, showLabel: false, showRing: false, showNote: false, showDay: false, showControls: false,
  idle: 9, warnMin: 12, tintMode: 'ring', clockLabel: 'Etiqueta', clockNote: 'Nota', target: '13:45', timerMinutes: 110, timerBeep: false, seconds: true,
  autoRotate: false, rotateSeconds: 90, schedule: [{ t: '08:00', name: 'A', show: true, msg: 'm1' }, { t: '09:00', name: 'B', show: false, msg: '' }],
  slides: [{ kind: 'table', title: 'T1', content: 'a | b\n1 | 2', visible: false, accent: 'purple', image: '' }, { kind: 'notice', title: 'T2', content: 'x', visible: true, accent: 'coral', image: '' }],
};
await t(G13, 'one JSON holds the whole configuration: every setting, imported as a file, is applied exactly', async p => {
  const file = tmp('tot.json', JSON.stringify({ app: 'Rellotge-IOC-Plantilla', version: 2, name: 'Tot', data: ALL_NON_DEFAULT }));
  await open(p, 'files'); await p.setFiles('#tpl-file', [file]); has(await txt(p, 'tpl-status'), 'desada');
  await p.ev("document.querySelector('#my-templates .btn:not(.danger)').click()"); await sleep(250);
  for (const [k, v] of Object.entries(ALL_NON_DEFAULT)) {
    if (k === 'slides') { const got = await p.ev("config.slides.map(({id,...x})=>x)"); eq(JSON.stringify(got), JSON.stringify(v), 'slides'); continue; }
    eq(JSON.stringify(await cfg(p, k)), JSON.stringify(v), k);
  }
  const keys = await p.ev("TEMPLATE_FIELDS"); const missing = keys.filter(k => !(k in ALL_NON_DEFAULT) && !['logoDark', 'logoLight'].includes(k)); eq(missing.length, 0, 'fields not covered by this test: ' + missing);
  eq(await p.ev("document.body.dataset.bg"), 'sky'); eq(await p.ev("document.body.dataset.accent"), 'teal'); eq(await p.ev("document.body.classList.contains('hide-logo')"), true);
});
await t(G13, 'a link with ?plantilla= opens the app already configured, and only accepts same-site .json paths', async p => {
  const base = await serve();
  const open2 = async (qs, seed) => Page.open(browser, base + 'index.html' + qs, { seed });
  let q = await open2('?plantilla=presets/proves-compleccio.json');
  try {
    await sleep(500); eq(await q.ev('config.room'), 'Aula DAW'); eq(await q.ev('config.schedule.length'), 10); eq(await q.ev('location.search'), '', 'the parameter is removed from the address'); eq(q.dialogs.length, 0, 'no question on a first visit');
  } finally { await q.close(); }
  q = await open2('?plantilla=presets/proves-compleccio.json', { title: 'Meva configuració' });
  try { await sleep(500); eq(q.dialogs.length, 1, 'asks before replacing an existing setup'); has(q.dialogs[0], 'Substituirà'); eq(await q.ev('config.room'), 'Aula DAW'); } finally { await q.close(); }
  for (const bad of ['//evil.example/x.json', '../index.html', 'https://evil.example/x.json', '/presets/proves-compleccio.json', 'presets/%2e%2e/index.json', 'index.html', 'presets/no-existeix.json']) {
    q = await open2('?plantilla=' + encodeURIComponent(bad));
    try { await sleep(400); eq(await q.ev('config.room'), '', 'rejected: ' + bad); } finally { await q.close(); }
  }
});
await t(G13, 'section colours stay readable on a light theme (deep tones, not pastels)', async p => {
  await p.ev("config.theme='light';config.slides=[{id:'x',kind:'text',title:'T',content:'Hola',visible:true,accent:'blue',image:''}];activeId='x';applyTheme();applyAppearance();renderSlide()"); await sleep(700);
  const lum = c => { const [r, g, b] = c.match(/\d+/g).map(Number).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
  for (const tone of ['theme', 'blue', 'mint', 'gold', 'coral', 'purple']) {
    await p.ev(`config.slides[0].accent='${tone}';renderSlide()`); await sleep(50);
    const fg = await p.ev("getComputedStyle(document.querySelector('.slide-type')).color"), bg = await p.ev("getComputedStyle(document.body).backgroundColor");
    const ratio = (Math.max(lum(fg), lum(bg)) + .05) / (Math.min(lum(fg), lum(bg)) + .05);
    ok(ratio >= 4.5, tone + ' contrast ' + ratio.toFixed(2) + ' on the light theme');
  }
});
await t(G13, 'in a saved template the bulky images come last, so the JSON stays readable', async p => {
  await p.ev("config.logoDark='data:image/png;base64,AAAA';config.logoLight='data:image/png;base64,BBBB';0");
  const keys = await p.ev("Object.keys(currentContent())"); eq(keys.slice(-2).join(), 'logoDark,logoLight'); eq(await p.ev("Object.keys(currentContent().slides[0]).pop()"), 'image');
});
await t(G13, 'a saved own template restores appearance too, after everything is reset', async p => {
  await p.ev(`Object.assign(config, ${JSON.stringify({ accent: 'pink', bgColor: 'rose', theme: 'dark', layout: 30, tintMode: 'none', listStyle: 'bullets' })});save();addUserTemplate('Visual', currentContent())`);
  await p.ev("config=defaults();save();applyLayout();applyAppearance()"); eq(await cfg(p, 'accent'), 'blue');
  await open(p, 'files'); await p.ev("document.querySelector('#my-templates .btn:not(.danger)').click()"); await sleep(250);
  for (const [k, v] of Object.entries({ accent: 'pink', bgColor: 'rose', theme: 'dark', layout: 30, tintMode: 'none', listStyle: 'bullets' })) eq(await cfg(p, k), v, k);
  ok(!(await p.ev("JSON.stringify(currentContent())")).includes('timerState'), 'no runtime state in templates');
});
await t(G13, 'save the current setup as your own template, apply it later, delete it; survives a reload', async p => {
  await open(p, 'files');
  await p.ev("document.getElementById('tpl-save').click()"); has(await txt(p, 'tpl-status'), 'nom'); eq(await p.ev('userTemplates().length'), 0, 'a name is required');
  await p.ev("(()=>{config.title='La meva sessió';config.clockMode='schedule';config.schedule=[{t:'08:00',name:'Entrada',show:true,msg:'Bon dia'},{t:'09:00',name:'Final',show:true,msg:''}];save();const i=document.getElementById('tpl-name');i.value='Sessió de matí';document.getElementById('tpl-save').click()})()");
  eq(await p.ev("userTemplates().map(t=>t.name)"), ['Sessió de matí']); eq(await p.ev("[...document.querySelectorAll('#my-templates b')].map(b=>b.textContent)"), ['Sessió de matí']);
  await p.ev("config.title='Un altre';config.schedule=[{t:'10:00',name:'X',show:true,msg:''}];save()");
  await sleep(300); await p.reload(); await open(p, 'files'); eq(await p.ev("userTemplates().length"), 1, 'survives reload');
  await p.ev("document.querySelector('#my-templates .btn:not(.danger)').click()"); await sleep(200);
  eq(await cfg(p, 'title'), 'La meva sessió'); eq(await p.ev("config.schedule.map(e=>e.msg)"), ['Bon dia', '']);
  await p.ev("document.querySelector('#my-templates .btn.danger').click()"); await sleep(150); eq(await p.ev('userTemplates().length'), 0);
});
await t(G13, 'declining the delete confirmation keeps the template', async p => {
  await p.ev("addUserTemplate('Meva',currentContent())"); p.acceptDialogs = false; await open(p, 'files'); await p.ev("document.querySelector('#my-templates .btn.danger').click()"); await sleep(150); eq(await p.ev('userTemplates().length'), 1);
});
await t(G13, 'invalid or hostile template files are rejected', async p => {
  await open(p, 'files'); const dir = mkdtempSync(join(tmpdir(), 'ioc-tpl-')); const bad = join(dir, 'bad.json'), wrong = join(dir, 'wrong.json'), evil = join(dir, 'evil.json');
  writeFileSync(bad, '{nope'); writeFileSync(wrong, JSON.stringify({ app: 'Altra-Cosa', data: {} }));
  writeFileSync(evil, JSON.stringify({ app: 'Rellotge-IOC-Plantilla', name: '<img src=x onerror=window.__x=1>', data: { title: '<svg onload=window.__x=2>', schedule: [{ t: '99:99', name: 'x' }], slides: [{ kind: 'script', title: 't', content: '<script>window.__x=3</script>', image: 'javascript:alert(1)' }] } }));
  for (const f of [bad, wrong]) { await p.setFiles('#tpl-file', [f]); eq(await p.ev('userTemplates().length'), 0, 'rejected ' + f); has(await txt(p, 'tpl-status'), 'Format incorrecte'); }
  await p.setFiles('#tpl-file', [evil]); await sleep(200); eq(await p.ev('window.__x===undefined'), true); eq(await p.ev("document.querySelectorAll('#my-templates img,#my-templates svg:not(.i),#my-templates script').length"), 0);
  await p.ev("document.querySelector('#my-templates .btn:not(.danger)').click()"); await sleep(200); eq(await p.ev("config.slides[0].kind"), 'text', 'unknown kind sanitised'); eq(await p.ev("config.slides[0].image"), '');
  eq(await p.ev("document.querySelectorAll('#slide img,#slide script').length"), 0);
}, { allowErrors: true });
await t(G13, 'at most 30 own templates', async p => {
  await p.ev("for(let i=0;i<35;i++)addUserTemplate('P'+i,currentContent())"); eq(await p.ev('userTemplates().length'), 30);
});
await t(G13, 'About is a direct link, only in the General tab, and no name appears', async p => {
  await open(p, 'general'); const a = await p.ev("(()=>{const l=document.getElementById('about-link');return {href:l.href,target:l.target,rel:l.rel,h:l.getBoundingClientRect().height}})()");
  ok(a.h > 40, 'row visible'); eq(a.href, 'https://itrascastro.github.io/'); eq(a.target, '_blank'); has(a.rel, 'noopener');
  eq(await p.ev("document.querySelectorAll('#about-link, [href*=itrascastro]').length"), 1, 'only one link');
  eq(await p.ev("document.getElementById('about-link').closest('#pane-general')!==null"), true, 'in General');
  eq(await p.ev("/Trascastro|Ismael/i.test(document.body.innerText)"), false, 'name visible');
  eq(await p.ev("!!document.querySelector('dialog')"), false, 'no dialog');
  eq(await p.ev("getComputedStyle(document.getElementById('about-link')).cursor"), 'pointer', 'hand cursor on the link');
});

// ───────────────────────── 14. Logo
const G14 = '14 Logo';
const logoState = p => p.ev("(()=>{const i=document.getElementById('logo-img');return {src:i.getAttribute('src')||'',hidden:i.hidden||getComputedStyle(i).display==='none',alt:i.alt,w:i.naturalWidth,h:Math.round(i.getBoundingClientRect().height),data:document.body.dataset.logo}})()");
await t(G14, 'switching to "El meu logo" without images shows no logo; back to IOC restores it', async p => {
  await open(p, 'display'); await p.ev("document.querySelector('[data-seg=logoMode] [data-v=custom]').click()"); let l = await logoState(p); ok(l.hidden && l.data === 'none', 'hidden without image');
  await p.ev("document.querySelector('[data-seg=logoMode] [data-v=ioc]').click()"); l = await logoState(p); ok(!l.hidden && l.w > 100);
});
await t(G14, 'custom-logo controls only appear in "El meu logo" mode', async p => {
  await open(p, 'display'); const vis = () => p.ev("[...document.querySelectorAll('.logo-custom')].every(e=>getComputedStyle(e).display!=='none')");
  eq(await vis(), false); await p.ev("document.querySelector('[data-seg=logoMode] [data-v=custom]').click()"); eq(await vis(), true);
});
await t(G14, 'uploading a PNG for dark backgrounds shows it, previews it and persists', async p => {
  await open(p, 'display'); const f = tmp('escola.png', png(600, 200)); await p.setFiles('[data-logo-file=logoDark]', [f]);
  eq(await cfg(p, 'logoMode'), 'custom'); ok((await cfg(p, 'logoDark')).startsWith('data:image/png;base64,')); const l = await logoState(p); ok(!l.hidden && l.w === 600 && l.h >= 60, JSON.stringify(l));
  ok(await p.ev("!document.querySelector('[data-logo-prev=logoDark]').hidden && !document.querySelector('[data-logo-clear=logoDark]').hidden"));
  await sleep(400); await p.reload(); const l2 = await logoState(p); ok(!l2.hidden && l2.src.startsWith('data:image/png'));
}, { scheme: 'dark' });
await t(G14, 'separate logos for dark and light backgrounds, with fallback when only one exists', async p => {
  await open(p, 'display'); await p.setFiles('[data-logo-file=logoDark]', [tmp('dark.png', png(300, 100, [255, 255, 255, 255]))]);
  await p.ev("config.theme='light';applyAppearance()"); const fb = await logoState(p); ok(!fb.hidden, 'falls back to the only logo on light'); eq(fb.src, await cfg(p, 'logoDark'));
  await p.setFiles('[data-logo-file=logoLight]', [tmp('light.png', png(300, 100, [0, 0, 0, 255]))]);
  const l = await logoState(p); eq(l.src, await cfg(p, 'logoLight'), 'light uses its own'); await p.ev("config.theme='dark';applyAppearance()"); eq((await logoState(p)).src, await cfg(p, 'logoDark'), 'dark uses its own');
});
await t(G14, 'SVG logos are accepted and cannot run scripts', async p => {
  await open(p, 'display'); await p.setFiles('[data-logo-file=logoDark]', [tmp('l.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60" onload="window.__x=1"><script>window.__x=2</script><rect width="200" height="60" fill="#09f"/></svg>')]);
  ok((await cfg(p, 'logoDark')).startsWith('data:image/svg+xml;base64,')); await sleep(200); eq(await p.ev('window.__x===undefined'), true); ok(!(await logoState(p)).hidden);
});
await t(G14, 'large rasters are downscaled to keep storage small', async p => {
  await open(p, 'display'); await p.setFiles('[data-logo-file=logoDark]', [tmp('big.png', png(3000, 1500))]); await sleep(300);
  const d = await p.ev("(()=>new Promise(r=>{const i=new Image();i.onload=()=>r([i.width,i.height]);i.src=config.logoDark}))()"); ok(d[1] <= 700 && d[0] <= 1400, 'downscaled to ' + d); ok((await cfg(p, 'logoDark')).length < 400000, 'small data URL');
});
await t(G14, 'files that are not images are rejected with a message', async p => {
  await open(p, 'display'); await p.setFiles('[data-logo-file=logoDark]', [tmp('notes.txt', 'hola')]); eq(await cfg(p, 'logoDark'), ''); has(await txt(p, 'logo-status'), 'Trieu un PNG');
  await p.setFiles('[data-logo-file=logoDark]', [tmp('fake.png', 'this is not a png')]); await sleep(300); eq(await cfg(p, 'logoDark'), ''); has(await txt(p, 'logo-status'), 'no és una imatge');
}, { allowErrors: true });
await t(G14, 'removing a logo clears it and its preview', async p => {
  await open(p, 'display'); await p.setFiles('[data-logo-file=logoDark]', [tmp('a.png', png(100, 50))]); await p.ev("document.querySelector('[data-logo-clear=logoDark]').click()");
  eq(await cfg(p, 'logoDark'), ''); ok(await p.ev("document.querySelector('[data-logo-prev=logoDark]').hidden")); ok((await logoState(p)).hidden);
});
await t(G14, 'alt text is configurable and the logo can be hidden', async p => {
  await open(p, 'display'); await p.setFiles('[data-logo-file=logoDark]', [tmp('a.png', png(100, 50))]);
  await p.ev("(()=>{const i=document.querySelector('[data-text=logoAlt]');i.value='Escola Exemple';i.dispatchEvent(new Event('input',{bubbles:true}))})()"); eq((await logoState(p)).alt, 'Escola Exemple');
  await p.ev("config.showLogo=false;applyAppearance()"); ok((await logoState(p)).hidden, 'hidden by the toggle'); await p.ev("config.showLogo=true;applyAppearance()"); ok(!(await logoState(p)).hidden);
});
await t(G14, 'logo size slider scales a custom logo', async p => {
  await open(p, 'display'); await p.setFiles('[data-logo-file=logoDark]', [tmp('a.png', png(400, 200))]); const h0 = (await logoState(p)).h;
  await p.ev("(()=>{const l=document.querySelector('[data-range=logoScale]');l.value=50;l.dispatchEvent(new Event('input',{bubbles:true}))})()"); near((await logoState(p)).h / h0, 0.5, 0.06);
});
await t(G14, 'hostile logo values in storage are discarded', async p => { eq(await cfg(p, 'logoDark'), ''); eq(await cfg(p, 'logoLight'), ''); eq(await cfg(p, 'logoMode'), 'ioc'); },
  { seed: { logoMode: 'evil', logoDark: 'javascript:alert(1)', logoLight: 'data:text/html;base64,PHNjcmlwdD4=' } });


// ───────────────────────── 15. Seccions: visualització i editor
const G15 = '15 Visualització de seccions';
const S1 = (kind, content, extra = '') => `config.slides=[{id:'x',kind:'${kind}',title:'Títol',content:${JSON.stringify(content)},visible:true,accent:'theme',image:''${extra}}];activeId='x';renderSlide()`;
await t(G15, 'lists render as cards with numbered badges by default', async p => {
  await p.ev(S1('list', 'Una\nDues\nTres')); eq(await p.ev("document.querySelector('#slide ul').className"), 'cards');
  eq(await p.ev("[...document.querySelectorAll('#slide li .num')].map(n=>n.textContent)"), ['1', '2', '3']); eq(await p.ev("[...document.querySelectorAll('#slide li .t')].map(n=>n.textContent)"), ['Una', 'Dues', 'Tres']);
  ok(await p.ev("parseFloat(getComputedStyle(document.querySelector('#slide li')).borderTopLeftRadius)")>8, 'rounded cards'); ok((await p.ev("getComputedStyle(document.querySelector('#slide li')).backgroundColor")) !== 'rgba(0, 0, 0, 0)');
});
for (const [st, cls, nums] of [['numbers', 'numbers', 3], ['bullets', 'bullets', 0], ['cards', 'cards', 3]]) await t(G15, `list style "${st}" is selectable and persists`, async p => {
  await open(p, 'display'); await p.ev(`document.querySelector('[data-seg=listStyle] [data-v=${st}]').click()`); await p.ev(S1('list', 'a\nb\nc'));
  eq(await p.ev("document.querySelector('#slide ul').className"), cls); eq(await p.ev("document.querySelectorAll('#slide li .num').length"), nums);
  await sleep(300); await p.reload(); eq(await cfg(p, 'listStyle'), st);
});
await t(G15, 'dashes or bullets typed by hand are stripped from list items', async p => { await p.ev(S1('list', '- una\n• dues\n– tres')); eq(await p.ev("[...document.querySelectorAll('#slide li .t')].map(n=>n.textContent)"), ['una', 'dues', 'tres']); });
await t(G15, 'every section shows its kind chip with an icon', async p => {
  for (const [k, label] of [['list', 'Punts clau'], ['text', 'Informació'], ['notice', 'Avís destacat'], ['image', 'Imatge'], ['table', 'Taula']]) {
    await p.ev(S1(k, 'x')); eq(await p.ev("document.querySelector('#slide .slide-type').textContent"), label, k); ok(await p.ev("!!document.querySelector('#slide .slide-type svg.i')"), 'icon ' + k);
  }
});
await t(G15, 'text sections split into paragraphs on blank lines', async p => { await p.ev(S1('text', 'Primer\n\nSegon\n\n\nTercer')); eq(await p.ev("[...document.querySelectorAll('#slide .prose p')].map(n=>n.textContent)"), ['Primer', 'Segon', 'Tercer']); });
await t(G15, 'notice shows a callout with an icon, tinted with the section colour', async p => {
  await p.ev(S1('notice', 'Atenció')); eq(await p.ev("document.getElementById('slide').classList.contains('notice')"), false, 'must not inherit the banner styles'); ok((await p.rect('#slide .callout')).h < 400, 'callout is not stretched'); ok(await p.ev("!!document.querySelector('#slide .callout svg.i')")); eq(await txt(p, 'slide').then(() => p.ev("document.querySelector('#slide .callout .text-content').textContent")), 'Atenció');
});
await t(G15, 'table: header row, body rows and at most 5 columns', async p => {
  await p.ev(S1('table', 'A|B|C|D|E|F|G\n1|2|3|4|5|6|7\n8|9')); eq(await p.ev("document.querySelectorAll('#slide th').length"), 5); eq(await p.ev("document.querySelectorAll('#slide tbody tr').length"), 2);
  eq(await p.ev("[...document.querySelectorAll('#slide tbody tr:nth-child(2) td')].map(t=>t.textContent)"), ['8', '9', '', '', '']);
});
await t(G15, 'image sections show the picture inside a rounded frame with its caption', async p => {
  const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await p.ev(S1('image', 'Peu de foto').replace("image:''", `image:'${px}'`)); ok(await p.ev("!!document.querySelector('#slide figure.fig img.slide-image')")); eq(await p.ev("document.querySelector('#slide figcaption').textContent"), 'Peu de foto');
  ok(parseFloat(await p.ev("getComputedStyle(document.querySelector('#slide img')).borderTopLeftRadius")) >= 16, 'rounded image');
});
await t(G15, 'changing section animates (enter class) but re-fitting does not restart it', async p => {
  await tpl(p, 'complecio', 'clock'); await p.ev("document.getElementById('next-btn').click()"); ok(await p.ev("document.getElementById('slide').classList.contains('enter')"));
  await p.ev("renderSlide()"); eq(await p.ev("document.getElementById('slide').classList.contains('enter')"), false, 'same section: no animation');
});
await t(G15, 'rotation progress bar fills until the next section and hides when not rotating', async p => {
  await tpl(p, 'complecio', 'clock'); await p.ev("config.rotateSeconds=10;lastRotation=Date.now()-5000"); await sleep(500);
  const w = parseFloat(await p.ev("document.getElementById('rot-fill').style.width")); near(w, 50, 8, 'about half way'); eq(await p.ev("getComputedStyle(document.getElementById('rotbar')).visibility"), 'visible');
  await p.key(' '); await sleep(400); eq(await p.ev("getComputedStyle(document.getElementById('rotbar')).visibility"), 'hidden', 'paused');
});
await t(G15, 'the section list shows one tile per section with kind, title and number', async p => {
  await tpl(p, 'complecio', 'clock'); await open(p, 'slides');
  eq(await p.ev("document.querySelectorAll('#slide-list .tile').length"), 4); eq(await p.ev("[...document.querySelectorAll('#slide-list .tile b')].map(b=>b.textContent)"), ['Abans de començar', 'Com organitzar les proves', 'Entrega i sortida', 'Consultes i indicacions']);
  has(await p.ev("document.querySelector('#slide-list .tile small').textContent"), '1 · Llista de punts'); eq(await txt(p, 'sec-count'), 'Seccions (4/30)');
  eq(await p.ev("document.querySelectorAll('#slide-list .tile.sel').length"), 1);
});
await t(G15, 'clicking a tile selects it, shows it on screen and loads it in the form', async p => {
  await tpl(p, 'complecio', 'clock'); await open(p, 'slides'); await p.realClick('#slide-list .tile:nth-child(3)'); await sleep(150);
  eq(await p.ev("document.getElementById('slide-title').value"), 'Entrega i sortida'); eq(await p.ev("document.querySelector('#slide .slide-title').textContent"), 'Entrega i sortida'); eq(await p.ev("document.querySelector('#slide-list .tile.sel b').textContent"), 'Entrega i sortida');
  await p.ev("document.querySelector('#slide-list .tile:nth-child(2)').focus()"); await p.key('Enter'); eq(await p.ev("document.getElementById('slide-title').value"), 'Com organitzar les proves', 'keyboard');
});
await t(G15, 'the eye on a tile hides and shows that section', async p => {
  await tpl(p, 'complecio', 'clock'); await open(p, 'slides'); await p.ev("document.querySelector('#slide-list .tile:nth-child(2) .icon').click()");
  eq(await p.ev('visibleSlides().length'), 3); ok(await p.ev("document.querySelector('#slide-list .tile:nth-child(2)').classList.contains('off')")); has(await p.ev("document.querySelector('#slide-list .tile:nth-child(2) small').textContent"), 'Oculta');
  await p.ev("document.querySelector('#slide-list .tile:nth-child(2) .icon').click()"); eq(await p.ev('visibleSlides().length'), 4);
});
await t(G15, 'typing the title updates the tile and the screen live', async p => {
  await open(p, 'slides'); await p.ev("(()=>{const i=document.getElementById('slide-title');i.value='Nou títol';i.dispatchEvent(new Event('input',{bubbles:true}))})()");
  eq(await p.ev("document.querySelector('#slide-list .tile.sel b').textContent"), 'Nou títol'); eq(await p.ev("document.querySelector('#slide .slide-title').textContent"), 'Nou títol');
});
await t(G15, 'kind buttons and colour swatches edit the section', async p => {
  await open(p, 'slides');
  for (const k of ['text', 'notice', 'table', 'image', 'list']) { await p.ev(`document.querySelector('[data-slide-kind] [data-v=${k}]').click()`); eq(await p.ev('selectedSlide().kind'), k); eq(await p.ev("document.querySelector('[data-slide-kind] [aria-checked=true]').dataset.v"), k); eq(await p.ev("document.querySelector('#slide-list .tile.sel')?1:0"), 1); }
  await p.ev("document.querySelector('[data-slide-accent] [data-v=coral]').click()"); eq(await p.ev('selectedSlide().accent'), 'coral'); eq(await p.ev("document.querySelector('[data-slide-accent] [aria-checked=true]').dataset.v"), 'coral');
  eq(await p.ev("document.getElementById('slide').dataset.tone"), 'coral'); eq(await p.ev("getComputedStyle(document.getElementById('slide')).getPropertyValue('--accent').trim().toLowerCase()"), '#f28b82');
});
await t(G15, 'toolbar icons reorder, duplicate and delete, and the first/last limits disable them', async p => {
  await tpl(p, 'complecio', 'clock'); await open(p, 'slides'); eq(await p.ev("document.getElementById('move-up').disabled"), true, 'first cannot go up');
  await p.ev("document.querySelector('#slide-list .tile:nth-child(1)').click();document.getElementById('move-down').click()"); eq(await p.ev("document.querySelector('#slide-list .tile:nth-child(2) b').textContent"), 'Abans de començar');
  await p.ev("document.getElementById('copy-slide').click()"); eq(await p.ev('config.slides.length'), 5); await p.ev("document.getElementById('remove-slide').click()"); eq(await p.ev('config.slides.length'), 4);
  ok(await p.ev("[...document.querySelectorAll('.sec-tools .icon')].every(b=>b.getAttribute('aria-label')&&b.title)"), 'labelled');
});
await t(G15, 'the section editor fits the panel without horizontal scroll', async p => {
  await open(p, 'slides'); ok(await p.ev("(()=>{const b=document.querySelector('.drawer-body');return b.scrollWidth<=b.clientWidth+1})()"), 'horizontal overflow in the editor');
  ok(await p.ev("[...document.querySelectorAll('[data-slide-kind] button')].every(b=>b.getBoundingClientRect().right<=document.querySelector('#drawer').getBoundingClientRect().right+1)"), 'kind buttons clipped');
});

await browser.close(); if (server) server.close();
const pass = results.filter(r => r.pass).length, fail = results.length - pass;
console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${pass}/${results.length} passed${fail ? `, ${fail} failed` : ''}\x1b[0m\n`);
process.exit(fail ? 1 : 0);
