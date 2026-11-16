import { chromium } from 'playwright';
import fs from 'fs';
const OUT = process.argv[2];
const L = OUT + '/layers';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.clock.install();
await page.goto('https://vanguarddigital.co.zw/', { waitUntil: 'load', timeout: 90000 });
await page.clock.runFor(6000); await page.waitForTimeout(3000);
const ess = page.getByRole('button', { name: /Essential only/i });
console.log('loaded'); if (await ess.count()) { await ess.first().click({ timeout: 5000 }).catch(e => console.log('cookie click', e.message)); await page.waitForTimeout(800); }
await page.clock.runFor(1000);
await page.locator('section').first().getByRole('button', { name: 'Show slide 1' }).click({ timeout: 5000 });
await page.clock.runFor(2500); await page.waitForTimeout(500);
const H0 = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y <= H0; y += 300) { await page.evaluate(v => window.scrollTo(0, v), y); await page.waitForTimeout(200); }
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(()=>{});
await page.evaluate(() => window.scrollTo(0, 0));
const marquee = await page.evaluate(() => {
  const tr = document.querySelector('.platform-marquee-track'); const cs = getComputedStyle(tr);
  return { anim: cs.animationName, dur: cs.animationDuration, timing: cs.animationTimingFunction, trackW: tr.scrollWidth };
});
// Pin hero carousel to slide 1 (phone / trolley / Amazon imagery), including its dot indicator
await page.evaluate(() => {
  const hero = document.querySelector('section');
  const slides = [...hero.querySelector('.pointer-events-none.absolute.inset-0').children].filter(c => c.querySelector('img'));
  slides.forEach((s, i) => { s.style.transition = 'none'; s.classList.toggle('opacity-100', i === 0); s.classList.toggle('opacity-0', i !== 0); s.style.opacity = i === 0 ? '1' : '0'; if (s.firstElementChild) s.firstElementChild.style.transform = 'none'; const im = s.querySelector('img'); if (im) im.loading = 'eager'; });
  const dots = [...hero.querySelectorAll('button[aria-label^="Show slide"]')];
  const activeIdx = dots.findIndex(d => d.getAttribute('aria-current') === 'true' || d.getBoundingClientRect().width > 12);
  if (activeIdx > 0) { const a = dots[activeIdx], ref = dots.find((d, i) => i !== activeIdx && i !== 0);
    const aCls = a.className, aSty = a.getAttribute('style'); a.className = ref.className; a.setAttribute('style', ref.getAttribute('style') || ''); a.innerHTML = ref.innerHTML;
    dots[0].className = aCls; dots[0].setAttribute('style', aSty || ''); }
  dots.forEach((d, i) => { if (i === 0) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); d.blur(); });
  window.__dotFix = { a: dots[0].className, aS: dots[0].getAttribute('style') || '', i: dots[dots.length - 1].className, iS: dots[dots.length - 1].getAttribute('style') || '' };
  window.__repin = () => { const ds = [...document.querySelector('section').querySelectorAll('button[aria-label^="Show slide"]')]; const f = window.__dotFix;
    ds.forEach((d, i) => { d.className = i === 0 ? f.a : f.i; d.setAttribute('style', i === 0 ? f.aS : f.iS); if (i === 0) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
    const sl = [...document.querySelector('section').querySelector('.pointer-events-none.absolute.inset-0').children].filter(c => c.querySelector('img'));
    sl.forEach((x, i) => { x.style.transition = 'none'; x.style.opacity = i === 0 ? '1' : '0'; }); };
});
await page.mouse.move(5, 895); await page.waitForTimeout(1500);
await page.addStyleTag({ content: `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}` });
await page.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach(i => i.loading = 'eager'));
await page.evaluate(async () => { await Promise.race([new Promise(r => setTimeout(r, 15000)), Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })))]); });
await page.waitForTimeout(1500);
console.log('shot1'); await page.screenshot({ path: OUT + '/fullpage_live.png', fullPage: true });

const info = await page.evaluate(() => {
  const r = el => { const b = el.getBoundingClientRect(); return { x: +(b.x).toFixed(1), y: +(b.y + scrollY).toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const T = s => s.replace(/\s+/g, ' ').trim();
  const secs = [...document.querySelectorAll('section')];
  const hero = secs.find(s => /Smartest/.test(s.textContent));
  const stores = secs.find(s => /Shop from Top Global/.test(T(s.textContent)));
  const trend = secs.find(s => /Trending Now/.test(T(s.textContent)));
  const trust = secs.find(s => /100% Secure/.test(T(s.textContent)));
  const mask = stores.querySelector('.platform-marquee-mask');
  const track = stores.querySelector('.platform-marquee-track');
  const hosts = [...track.children];
  const tiles = []; const seen = new Set();
  hosts.forEach((h, i) => { const a = h.firstElementChild; const lab = a.getAttribute('aria-label'); if (seen.has(lab)) return; seen.add(lab);
    tiles.push({ idx: i, label: lab, name: T(h.querySelector('.storefront-marquee-label')?.textContent || ''), href: a.getAttribute('href'), kind: a.tagName, live: a.tagName === 'A', box: r(h), offsetLeft: h.offsetLeft, inner: r(h.firstElementChild.firstElementChild), innerOffsetLeft: h.firstElementChild.firstElementChild.getBoundingClientRect().x - track.getBoundingClientRect().x, visibleText: T(h.innerText) }); });
  const mq = getComputedStyle(mask);
  const logoImg = [...document.querySelectorAll('header img')].find(i => i.getBoundingClientRect().width > 0);
  const h1 = hero.querySelector('h1'); h1.__t = [...h1.querySelectorAll('.inline-block')].map(e => e.textContent).join(' '); const p = hero.querySelector('p'); const btn = [...hero.querySelectorAll('a,button')].find(e => /Start shopping/.test(e.innerText));
  const cards = [...trend.querySelectorAll('article')];
  const vis = cards.filter(c => { const b = c.getBoundingClientRect(); return b.right <= 1440 - 60 && b.left >= 0; });
  const cardInfo = vis.map(c => ({ box: r(c), name: T(c.querySelector('h3,h4,p,a')?.innerText || ''), text: T(c.innerText).slice(0, 220) }));
  const trustCols = [...trust.querySelectorAll('h3,h4,p')].filter(e => /^(100% Secure|Fast & Reliable|Local Support)$/.test(T(e.textContent))).map(e => e.closest('div'));
  const trustCards = trustCols.map(d => { let el = d; while (el.parentElement && el.parentElement.children.length < 3) el = el.parentElement; return el; });
  const powered = [...trust.querySelectorAll('*')].find(e => /POWERED BY/i.test(e.innerText) && e.children.length <= 3 && e.innerText.length < 40);
  window.__cap = { hero, h1, p, btn, logoImg, mask, track, hosts, vis, trustCards, trust, trend, stores, powered };
  return {
    page: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
    header: r(document.querySelector('header')), logo: r(logoImg),
    hero: r(hero), h1: { ...r(h1), text: h1.__t }, p: { ...r(p), text: T(p.innerText) }, btn: { ...r(btn), text: T(btn.innerText) },
    stores: r(stores), mask: { ...r(mask), maskImage: mq.webkitMaskImage || mq.maskImage }, track: r(track), tiles,
    trend: r(trend), cards: cardInfo, trust: r(trust), trustCards: trustCards.map(e => ({ ...r(e), text: T(e.innerText) })),
    powered: powered ? { ...r(powered), text: T(powered.innerText) } : null,
    footer: r(document.querySelector('footer')),
    affiliateOnPage: /affiliate|runner network/i.test(document.body.innerText),
    howItWorksSection: [...document.querySelectorAll('section h2')].some(h => /how it works/i.test(h.innerText)),
  };
});
info.marquee = marquee;

// Base plate: hide everything that becomes its own layer
await page.evaluate(() => { const c = window.__cap;
  const hide = e => e && (e.style.visibility = 'hidden');
  hide(c.logoImg); hide(c.btn); hide(c.track); c.vis.forEach(hide); c.trustCards.forEach(hide); });
await page.evaluate(() => window.__repin()); await page.waitForTimeout(300);
await page.screenshot({ path: OUT + '/base_page.png', fullPage: true });
await page.evaluate(() => { const c = window.__cap; [c.logoImg, c.btn, c.track, ...c.vis, ...c.trustCards].forEach(e => e.style.visibility = ''); });

// Hero imagery plate (text hidden) for the CTA card
await page.evaluate(() => { const c = window.__cap; [c.h1, c.p, c.btn].forEach(e => e.style.visibility = 'hidden'); });
await page.evaluate(() => window.__repin()); await page.waitForTimeout(300);
await c_shot(page, 'hero', 'hero_bg.png', false);
await page.evaluate(() => { const c = window.__cap; [c.h1, c.p, c.btn].forEach(e => e.style.visibility = ''); });

// Transparent element layers
await page.addStyleTag({ content: `html,body,main,section,footer,header{background:transparent!important;background-image:none!important}` });
await page.evaluate(() => { const c = window.__cap; [...c.vis, ...c.trustCards].forEach(e => { e.style.boxShadow = 'none'; }); });
await c_shot(page, 'btn', 'start_shopping_btn.png', true);
for (let i = 0; i < info.cards.length; i++) await page.evaluate(i => window.__el = window.__cap.vis[i], i).then(() => elShot(page, `card_${i}.png`));
for (let i = 0; i < 3; i++) await page.evaluate(i => window.__el = window.__cap.trustCards[i], i).then(() => elShot(page, `trust_${i}.png`));
// store tiles: lay track out flat so every tile is on-screen for capture only
await page.evaluate(() => { const c = window.__cap; c.mask.style.overflow = 'visible'; c.mask.style.webkitMaskImage = 'none'; c.mask.style.maskImage = 'none'; c.track.style.flexWrap = 'wrap'; c.track.style.width = '1100px'; });
for (const t of info.tiles) { await page.evaluate(i => window.__el = window.__cap.hosts[i].firstElementChild.firstElementChild, t.idx); await elShot(page, `tile_${t.idx}.png`); }
fs.writeFileSync(OUT + '/capture_info.json', JSON.stringify(info, null, 1));
await browser.close();

async function c_shot(page, key, file, transparent) { await page.evaluate(k => window.__el = window.__cap[k], key); await elShot(page, file, transparent); }
async function elShot(page, file, transparent = true) {
  const h = await page.evaluateHandle(() => window.__el);
  await h.asElement().screenshot({ path: L + '/' + file, omitBackground: transparent, animations: 'disabled' });
}
