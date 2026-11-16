// Headless renderer for the deterministic seek(t) scene.
//   node render.mjs stills <outDir>                 -> PNG stills at cutlist.preview_stills_s
//   node render.mjs chunk <f0> <f1> <out.mkv>       -> frames [f0, f1) as lossless FFV1 intermediate
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import sharp from 'sharp';
import ffmpegPath from 'ffmpeg-static';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const CL = JSON.parse(fs.readFileSync(path.join(ROOT, 'scene/cutlist.json')));
const [W, H] = CL.resolution, FPS = CL.fps;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.error('[page]', m.text()); });
page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exitCode = 2; });
await page.goto(`http://127.0.0.1:${port}/scene/index.html`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const info = await page.evaluate(() => window.__info);
console.error('renderer:', info.renderer, '| use_platforms lifts:', info.upTiles.join(', '));

const grab = async t => Buffer.from(await page.evaluate(t => window.grab(t), t), 'base64');
const mode = process.argv[2];
if (mode === 'stills') {
  const out = process.argv[3]; fs.mkdirSync(out, { recursive: true });
  const TIMES = process.argv[4] ? process.argv[4].split(",").map(Number) : CL.preview_stills_s;
  for (const t of TIMES) {
    const buf = await grab(t);
    await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).flip().removeAlpha().png().toFile(path.join(out, `still_${t.toFixed(2).replace(".", "_")}s.png`));
    console.error('still', t);
  }
  fs.writeFileSync(path.join(out, 'drawn_text.json'), JSON.stringify(info.drawnText, null, 1));
} else if (mode === 'chunk') {
  const f0 = +process.argv[3], f1 = +process.argv[4], out = process.argv[5];
  const ff = spawn(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
    '-vf', 'vflip', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'bgr0', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg exit ' + c))));
  const t0 = Date.now();
  for (let f = f0; f < f1; f++) {
    const buf = await grab(f / FPS);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if ((f - f0) % 30 === 0) console.error(`chunk ${path.basename(out)} frame ${f} (${((Date.now() - t0) / (f - f0 + 1)).toFixed(0)} ms/f)`);
  }
  ff.stdin.end(); await done;
  console.error(`chunk ${path.basename(out)} done: ${f1 - f0} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
await browser.close(); server.close();
