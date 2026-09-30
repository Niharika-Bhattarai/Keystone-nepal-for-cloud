'use strict';
/* C7 performance probe against the production build served by the local backend
   (http://127.0.0.1:8198 serves frontend-keystone/dist). For each route, on a desktop
   profile and a phone profile (4x CPU slowdown, 10 Mbps / 40 ms network):
   JavaScript and total bytes downloaded, Largest Contentful Paint, and the total of
   main-thread long tasks over 50 ms (a proxy for blocking time).

     node scripts/perf-probe.cjs --out <file.json> [--base http://127.0.0.1:8198]
*/
const fs = require('node:fs');
const { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://127.0.0.1:8198');
const OUT = arg('--out', 'perf-probe.json');
const ROUTES = ['/', '/pricing', '/how-floor-plans-work', '/faq', '/account'];
const PROFILES = [
  { name: 'desktop', viewport: { width: 1440, height: 950 }, cpu: 1, net: null },
  { name: 'phone', viewport: { width: 390, height: 860 }, cpu: 4, net: { downloadThroughput: 10e6 / 8, uploadThroughput: 5e6 / 8, latency: 40 } },
];

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const out = [];
  for (const profile of PROFILES) {
    for (const route of ROUTES) {
      const context = await browser.newContext({ viewport: profile.viewport });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      if (profile.net) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...profile.net });
      let js = 0, total = 0;
      cdp.on('Network.loadingFinished', e => { total += e.encodedDataLength; });
      page.on('response', async r => { if (/\.m?js(\?|$)/.test(r.url())) { try { js += (await r.body()).length; } catch { /* aborted */ } } });
      await page.addInitScript(() => {
        window.__perf = { lcp: 0, longTasks: 0 };
        new PerformanceObserver(l => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver(l => { for (const e of l.getEntries()) window.__perf.longTasks += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true });
      });
      const t0 = Date.now();
      await page.goto(BASE + route, { waitUntil: 'load' });
      await page.waitForTimeout(3000);
      const perf = await page.evaluate(() => window.__perf);
      out.push({ profile: profile.name, route, jsKB: Math.round(js / 1024), totalKB: Math.round(total / 1024), lcpMs: Math.round(perf.lcp), blockingMs: Math.round(perf.longTasks), loadMs: Date.now() - t0 });
      console.log(`${profile.name.padEnd(7)} ${route.padEnd(22)} js ${String(Math.round(js / 1024)).padStart(5)} KB  total ${String(Math.round(total / 1024)).padStart(5)} KB  LCP ${String(Math.round(perf.lcp)).padStart(5)} ms  blocking ${String(Math.round(perf.longTasks)).padStart(5)} ms`);
      await context.close();
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exitCode = 1; });
