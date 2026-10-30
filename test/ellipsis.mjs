// Audit: no short, normal text may be cut with an ellipsis in any mode or size.
// node test/ellipsis.mjs
import { launch, Page, sleep } from './cdp.mjs';
const URL_APP = new URL('../index.html', import.meta.url).href;
const probe = `(() => { const out = [];
  for (const e of document.querySelectorAll('body *')) {
    if (e.closest('.drawer') || e.closest('svg')) continue;
    const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = e.getBoundingClientRect(); if (!r.width) continue;
    const clipped = (cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) || (cs.webkitLineClamp !== 'none' && e.scrollHeight > e.clientHeight + 2);
    const txt = (e.textContent || '').trim();
    if (clipped && e.children.length === 0 && txt.length <= 40) out.push((e.id ? '#' + e.id : e.className || e.tagName) + ' "' + txt + '" ' + e.scrollWidth + '>' + e.clientWidth);
  }
  return out; })()`;
const b = await launch(9461);
let problems = 0;
for (const [w, h] of [[1920, 1080], [1280, 720], [1024, 700]]) {
  for (const mode of ['schedule', 'target', 'timer', 'stopwatch', 'clock']) {
    for (const layout of [50, 100]) {
      const p = await Page.open(b, URL_APP, { scheme: 'dark', width: w, height: h, seed: {} });
      await p.ev(`applyTemplateData(${JSON.stringify(JSON.parse((await import('node:fs')).readFileSync(new URL('../presets/proves-compleccio.json', import.meta.url))).data)});config.clockMode=${JSON.stringify(mode)};config.target='23:00';config.layout=${layout};simulated='15:10';applyLayout();renderClock();0`);
      await sleep(300);
      const issues = await p.ev(probe);
      if (issues.length) { problems++; console.log('✗', `${w}x${h} mode=${mode} layout=${layout}`); issues.forEach(i => console.log('    -', i)); }
      await p.close();
    }
  }
}
await b.close();
console.log(problems ? `\n${problems} scenarios with short text cut` : '\nno short text is cut');
process.exit(0);
