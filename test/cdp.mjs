// Minimal Chrome DevTools Protocol driver (Node >= 22, no dependencies).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
if (!CHROME) throw new Error('Chrome not found: set CHROME=/path/to/chrome');

export async function launch(port = 9333) {
  const dir = mkdtempSync(join(tmpdir(), 'ioc-clock-test-'));
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox'] : []), '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  let info;
  for (let i = 0; i < 100 && !info; i++) {
    try { info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  if (!info) throw new Error('Chrome did not start');
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else listeners.forEach(l => l(m));
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const on = fn => listeners.push(fn);
  async function close() { try { await send('Browser.close'); } catch {} try { ws.close(); } catch {} proc.kill(); await new Promise(r => setTimeout(r, 200)); rmSync(dir, { recursive: true, force: true }); }
  return { send, on, close };
}

export class Page {
  constructor(browser, sessionId, contextId, targetId) { Object.assign(this, { browser, sessionId, contextId, targetId, errors: [], dialogs: [] }); }
  static async open(browser, url, { seed, width = 1920, height = 1080, scheme = 'dark', pre = '', locale = 'ca-ES' } = {}) {
    const { send, on } = browser;
    const { browserContextId } = await send('Target.createBrowserContext');
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(browser, sessionId, browserContextId, targetId);
    on(m => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.exceptionThrown') page.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') page.errors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
      if (m.method === 'Page.javascriptDialogOpening') { page.dialogs.push(m.params.message); send('Page.handleJavaScriptDialog', { accept: page.acceptDialogs !== false }, sessionId); }
    });
    page.acceptDialogs = true;
    await page.cmd('Page.enable'); await page.cmd('Runtime.enable'); await page.cmd('DOM.enable');
    await page.cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await page.cmd('Emulation.setUserAgentOverride', { userAgent: (await browser.send('Browser.getVersion')).userAgent, acceptLanguage: locale });
    await page.cmd('Emulation.setLocaleOverride', { locale });
    await page.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    const origin = new URL(url).origin;
    if (seed !== undefined || pre) {
      await page.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{try{${seed !== undefined ? `if(!sessionStorage.getItem('__seeded')){localStorage.setItem('rellotge-ioc-v1',${JSON.stringify(typeof seed === 'string' ? seed : JSON.stringify(seed))});sessionStorage.setItem('__seeded','1');}` : ''}${pre}}catch(e){}})();` });
    }
    await page.cmd('Page.navigate', { url });
    await page.waitFor("document.readyState==='complete'&&typeof renderClock==='function'", 8000);
    return page;
  }
  cmd(method, params = {}) { return this.browser.send(method, params, this.sessionId); }
  async ev(expr) {
    const r = await this.cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n  in: ' + expr.slice(0, 200));
    return r.result.value;
  }
  async waitFor(expr, ms = 3000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await this.ev(expr)) return true; } catch {} await sleep(50); } throw new Error('timeout waiting for: ' + expr); }
  async reload() { await this.cmd('Page.reload'); await sleep(150); await this.waitFor("document.readyState==='complete'&&typeof renderClock==='function'", 8000); }
  async rect(sel) { return this.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2}})()`); }
  async mouse(type, x, y, extra = {}) { await this.cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra }); }
  async realClick(sel) { const r = await this.rect(sel); if (!r) throw new Error('no element ' + sel); await this.mouse('mouseMoved', r.cx, r.cy, { buttons: 0 }); await this.mouse('mousePressed', r.cx, r.cy); await this.mouse('mouseReleased', r.cx, r.cy); await sleep(60); }
  async key(key, extra = {}) { const code = key.length === 1 ? 'Key' + key.toUpperCase() : key; const base = { key, code, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : ({ Escape: 27, ArrowLeft: 37, ArrowRight: 39, ' ': 32 }[key] || 0), ...extra }; await this.cmd('Input.dispatchKeyEvent', { type: 'keyDown', text: key.length === 1 ? key : undefined, ...base }); await this.cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...base }); await sleep(60); }
  async setFiles(sel, files) { const { root } = await this.cmd('DOM.getDocument'); const { nodeId } = await this.cmd('DOM.querySelector', { nodeId: root.nodeId, selector: sel }); await this.cmd('DOM.setFileInputFiles', { files, nodeId }); await sleep(250); }
  async shot(path) { const { data } = await this.cmd('Page.captureScreenshot', { format: 'png' }); (await import('node:fs')).writeFileSync(path, Buffer.from(data, 'base64')); }
  async close() { try { await this.browser.send('Target.closeTarget', { targetId: this.targetId }); await this.browser.send('Target.disposeBrowserContext', { browserContextId: this.contextId }); } catch {} }
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
