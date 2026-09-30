'use strict';
// Optional local UI smoke with Microsoft Edge. No remote browser service.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./local-env.cjs');
const edgeBin = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const port = 9225;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await Promise.resolve().then(fn).catch(() => null); if (value) return value; await delay(200); }
  throw new Error('Browser smoke timed out');
}
async function main() {
  if (!fs.existsSync(edgeBin)) throw new Error('Microsoft Edge not installed');
  const browser = spawn(edgeBin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(ROOT, 'runtime', 'edge-milestone-b')}`, 'about:blank'],
  { stdio: 'ignore', windowsHide: true });
  let socket;
  try {
    const pages = await waitUntil(async () => {
      const r = await fetch(`http://127.0.0.1:${port}/json`);
      return r.ok ? (await r.json()).find(p => p.type === 'page') : null;
    });
    socket = new WebSocket(pages.webSocketDebuggerUrl);
    await waitUntil(() => socket.readyState === WebSocket.OPEN);
    let nextId = 1;
    const pending = new Map(), errors = [], remote = [];
    socket.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
      if (msg.method === 'Network.requestWillBeSent') {
        const url = msg.params.request.url;
        if (/^https?:\/\//.test(url) && !/^http:\/\/127\.0\.0\.1:(5299|8299)\//.test(url)) remote.push(url);
      }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out`)); }, 10000);
    });
    const evaluate = async expression => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
      return r.result?.result?.value;
    };
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Page.navigate', { url: 'http://127.0.0.1:5299/' });
    await waitUntil(() => evaluate('document.body?.innerText.includes("Design my house")'));
    await evaluate('localStorage.removeItem("keystone-nepal:brief-v1")');
    await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.innerText.includes("Design my house"))?.click()');
    try { await waitUntil(() => evaluate('document.body?.innerText.includes("Nepal site brief")')); }
    catch (error) { throw new Error(`Studio navigation failed: ${await evaluate('JSON.stringify({url:location.href,text:document.body.innerText.slice(0,1800)})')}`, { cause: error }); }
    if (process.argv.includes('--screenshot')) {
      const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      fs.writeFileSync(path.join(ROOT,'runtime','nepal-studio-survey.png'),Buffer.from(shot.result.data,'base64'));
    }
    const signIn = await evaluate('document.body.innerText.includes("Sign in") || document.body.innerText.includes("Create a free account")');
    await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.innerText.includes("Check Nepal brief"))?.click()');
    await waitUntil(() => evaluate('document.body?.innerText.includes("More information needed")'));
    const missingWard = await evaluate('document.body.innerText.includes("Enter the plot ward number")');
    const missingNorth = await evaluate('document.body.innerText.includes("source of the north bearing")');
    const fill = async (label, value) => evaluate(`(() => {
      const label = [...document.querySelectorAll('label')].find(l => l.innerText.startsWith(${JSON.stringify(label)}));
      const input = label?.querySelector('input'); if (!input) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event('input',{bubbles:true})); return true;
    })()`);
    if (!await fill('Ward', '10') || !await fill('Source of north bearing', 'survey drawing'))
      throw new Error('Could not fill Nepal site evidence');
    await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.innerText.includes("Check Nepal brief"))?.click()');
    let complete;
    try { complete = await waitUntil(() => evaluate('document.body?.innerText.includes("Survey inputs complete")')); }
    catch (error) { throw new Error(`Survey completion failed: ${await evaluate('document.body.innerText.slice(-2500)')}`, { cause: error }); }
    const rentalControls = await evaluate(`(() => {
      const label = [...document.querySelectorAll('label')].find(l => l.innerText.includes('Will you rent out one or more floors?'));
      label?.querySelector('input')?.click(); return document.body.innerText.includes('How many floors will be rented?') &&
        document.body.innerText.includes('Who uses this floor?');
    })()`);
    await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.innerText === "Existing engine")?.click()');
    const baseline = await waitUntil(() => evaluate('document.body?.innerText.includes("Generate floor plan")'));
    console.log(JSON.stringify({ studioOpen: true, signInPromptVisible: signIn, missingWard, missingNorth,
      completedSurvey: Boolean(complete), rentalControls, existingEngineAvailable: Boolean(baseline),
      runtimeErrors: errors, remoteRequests: remote }));
    if (signIn || !missingWard || !missingNorth || !complete || !rentalControls || errors.length || remote.length) process.exitCode = 1;
  } finally { socket?.close(); browser.kill(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
