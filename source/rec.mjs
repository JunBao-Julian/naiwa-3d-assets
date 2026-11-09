// usage:
//   node rec.mjs stills out_prefix t1 t2 ...         -> out_prefix_<t>.jpg
//   node rec.mjs scene out.mp4 tStart tEnd           -> encoded scene file (30fps)
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { spawn } from 'child_process';

const ROOT = '/home/claude/work';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.bin': 'application/octet-stream', '.json': 'application/json', '.u8': 'application/octet-stream', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); });
});
await new Promise(res => srv.listen(0, res));
const port = srv.address().port;

const [mode, out, ...rest] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--font-render-hinting=none'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exit(1); });
await page.goto(`http://localhost:${port}/page.html`);
await page.waitForFunction('window.READY === true', null, { timeout: 120000 });

async function frame(t) {
  await page.evaluate(async (t) => { await window.renderFrame(t); }, t);
  return page.screenshot({ type: 'jpeg', quality: 92 });
}

if (mode === 'stills') {
  for (const ts of rest) {
    const t0 = Date.now(); const buf = await frame(parseFloat(ts));
    fs.writeFileSync(`${out}_${ts}.jpg`, buf); console.log('still', ts, Date.now() - t0, 'ms');
  }
} else if (mode === 'scene') {
  const t0 = parseFloat(rest[0]), t1 = parseFloat(rest[1]); const FPS = 30;
  const n = Math.round((t1 - t0) * FPS); const tmp = out.replace(/\.mp4$/, '.part.mp4');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
  const st = Date.now();
  for (let i = 0; i < n; i++) {
    const buf = await frame(t0 + i / FPS);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 30 === 0) console.log(out, i, '/', n, ((Date.now() - st) / (i + 1)).toFixed(0), 'ms/f');
  }
  ff.stdin.end();
  const code = await new Promise(r => ff.on('close', r));
  if (code === 0) fs.renameSync(tmp, out); else { console.error('ffmpeg failed', code); process.exit(1); }
  console.log('done', out, n, 'frames', ((Date.now() - st) / 1000).toFixed(1), 's');
}
await browser.close(); srv.close();
