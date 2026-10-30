// Writes presets/exemple-complet.json from the app's own defaults, so the example can never drift from the code.
import { launch, Page } from './cdp.mjs';
import { writeFileSync } from 'node:fs';
const b = await launch(9447);
const p = await Page.open(b, new URL('../index.html', import.meta.url).href, { seed: {} });
const data = await p.ev('currentContent()');
const out = { app: 'Rellotge-IOC-Plantilla', version: 2, name: 'Exemple complet (tots els paràmetres)', data };
writeFileSync(new URL('../presets/exemple-complet.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(Object.keys(data).length + ' keys');
process.exit(0);
