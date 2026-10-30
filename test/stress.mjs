// Stress audit: every text at its maximum length (and as one unbroken word) must not break the layout.
// node test/stress.mjs [--shots <dir>]
import { launch, Page, sleep } from './cdp.mjs';

const URL_APP = new URL('../index.html', import.meta.url).href;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : '';
const words = n => Array.from({ length: n }, (_, i) => 'paraula' + (i % 7)).join(' ');
const unbroken = n => 'X'.repeat(n);
const WORDS = (n) => words(Math.ceil(n / 9)).slice(0, n);

const base = kind => {
  const mk = (n) => (kind === 'words' ? WORDS(n) : unbroken(n));
  const sched = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00'].map((t, i) => ({ t, name: mk(60), show: true, msg: mk(140) }));
  const slide = (k, content, image = '') => ({ id: 's' + k + Math.random(), kind: k, title: mk(100), content, visible: true, accent: 'theme', image });
  const long = kind === 'words' ? Array.from({ length: 30 }, () => WORDS(70)).join('\n') : Array.from({ length: 30 }, () => unbroken(70)).join('\n');
  const tableRows = Array.from({ length: 12 }, () => [mk(40), mk(40), mk(40), mk(40), mk(40)].join(' | ')).join('\n');
  return {
    title: mk(80), subtitle: mk(110), room: mk(45), board: mk(55), banner: mk(330), bannerLevel: 'important', noteLevel: 'urgent',
    clockLabel: mk(60), clockNote: mk(140), logoAlt: mk(80), schedule: sched, clockMode: 'schedule', autoRotate: false, layout: 50,
    slides: [slide('list', long), slide('text', long), slide('notice', mk(330)), slide('table', tableRows), slide('list', mk(2200))],
  };
};

const probe = `(() => {
  const vw = innerWidth, vh = innerHeight, out = [];
  const de = document.documentElement;
  if (de.scrollWidth > vw + 1) out.push('page scrolls horizontally: ' + de.scrollWidth + ' > ' + vw);
  const phone = vw <= 900; // stacked layout: the page is meant to scroll vertically
  if (!phone && de.scrollHeight > vh + 1 && document.body.scrollHeight > vh + 1) out.push('page scrolls vertically: ' + Math.max(de.scrollHeight, document.body.scrollHeight) + ' > ' + vh);
  const sel = ['.app', '.time', '.board', '#banner', '.board-head', '#slide', '.slide-body', '#stage-hint', '#collections', '.ring', '.logo', '.modes', '.stage-line', '#event-name', '#countdown'];
  for (const s of sel) {
    for (const e of document.querySelectorAll(s)) {
      const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
      if (r.right > vw + 1 || r.left < -1) out.push(s + ' outside viewport horizontally (' + Math.round(r.left) + '..' + Math.round(r.right) + ' of ' + vw + ')');
      if (!phone && r.bottom > vh + 1) out.push(s + ' below the viewport (' + Math.round(r.bottom) + ' > ' + vh + ')');
    }
  }
  // text clipped inside its own box: something wider/taller than its container that is not meant to scroll
  const clip = [];
  for (const e of document.querySelectorAll('.app *')) {
    if (e.closest('.drawer') || e.closest('svg')) continue;
    const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = e.getBoundingClientRect(); if (!r.width) continue;
    const p = e.parentElement; if (!p) continue;
    const pr = p.getBoundingClientRect();
    if (e.children.length === 0 && e.textContent.trim().length > 3 && (r.right > pr.right + 2 || r.left < pr.left - 2) && getComputedStyle(p).overflowX === 'visible') clip.push((e.id ? '#' + e.id : e.className || e.tagName) + ' spills out of its parent by ' + Math.round(Math.max(r.right - pr.right, pr.left - r.left)) + 'px');
  }
  out.push(...[...new Set(clip)].slice(0, 6));
  // overlap of the two main zones
  const a = document.querySelector('.time')?.getBoundingClientRect(), b = document.querySelector('.board')?.getBoundingClientRect();
  if (!phone && a && b && a.width && b.width && a.right > b.left + 2 && !(document.body.classList.contains('only-clock') || document.body.classList.contains('only-board'))) out.push('clock and board zones overlap by ' + Math.round(a.right - b.left));
  return out;
})()`;

const b = await launch(9460);
const sizes = [[1920, 1080], [1280, 720], [390, 844]];
let problems = 0;
for (const kind of ['words', 'unbroken']) {
  for (const [w, h] of sizes) {
    for (const mode of ['schedule', 'target', 'timer', 'stopwatch', 'clock']) {
      for (const layout of [50, 100, 0]) {
        const p = await Page.open(b, URL_APP, { scheme: 'dark', width: w, height: h, seed: {} });
        const cfg = { ...base(kind), clockMode: mode, target: '23:00', layout };
        await p.ev(`config=normalizeState(Object.assign(defaults(),${JSON.stringify(cfg)}));simulated='08:30';applyLayout();applyAppearance();renderHeader();renderSlide();renderClock();0`);
        for (let i = 0; i < 5; i++) {
          if (layout === 100 && i > 0) break;
          await p.ev(`activeId=visibleSlides()[${i}]?.id||null;renderSlide();renderClock();0`);
          await sleep(350);
          const issues = await p.ev(probe);
          const tag = `${kind} ${w}x${h} mode=${mode} layout=${layout} slide=${i}`;
          if (issues.length) { problems++; console.log('✗', tag); for (const s of issues) console.log('    -', s); if (shots && problems <= 12) await p.shot(`${shots}/stress-${problems}.png`); }
        }
        await p.close();
      }
    }
  }
}
await b.close();
console.log(problems ? `\n${problems} scenarios with problems` : '\nno problems found');
process.exit(0);
