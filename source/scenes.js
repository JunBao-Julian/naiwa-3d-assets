'use strict';
// ---------- helpers ----------
const srgb = (r, g, b) => [r, g, b].map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
function bezier(x1, y1, x2, y2) {
  const A = (a, b) => 1 - 3 * b + 3 * a, B = (a, b) => 3 * b - 6 * a, C = a => 3 * a;
  const at = (t, a, b) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
  const slope = (t, a, b) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
  return x => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const s = slope(t, x1, x2); if (Math.abs(s) < 1e-6) break; t -= (at(t, x1, x2) - x) / s; }
    if (!(t >= 0 && t <= 1) || Math.abs(at(t, x1, x2) - x) > 1e-5) { let lo = 0, hi = 1; t = x; for (let i = 0; i < 40; i++) { const v = at(t, x1, x2); if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; } }
    return at(t, y1, y2);
  };
}
const easeOut = bezier(0.23, 1, 0.32, 1), easeInOut = bezier(0.77, 0, 0.175, 1), drawer = bezier(0.32, 0.72, 0, 1);
const softInOut = bezier(0.45, 0, 0.25, 1);
const clamp01 = v => Math.min(1, Math.max(0, v));
const tween = (t, s, d, e = easeOut) => e(clamp01((t - s) / d));
const lerp = (a, b, p) => a + (b - a) * p;
const L3 = (a, b, p) => [lerp(a[0], b[0], p), lerp(a[1], b[1], p), lerp(a[2], b[2], p)];
const DEG = Math.PI / 180;
const fovMM = mm => 2 * Math.atan(10.125 / mm);   // 16:9 full-frame equivalent

// ---------- assets ----------
async function bin(name, T = Float32Array) { const r = await fetch('assets/' + name); return new T(await r.arrayBuffer()); }
let E, META;
const VARIANTS = {
  yellow: { useMask: true, cBody: srgb(248, 170, 26), cBelly: srgb(240, 222, 188), cDark: srgb(86, 78, 64), cSole: srgb(226, 140, 30), rough: 0.42, metal: 0, wrap: 0.32 },
  mint: { useMask: true, cBody: srgb(150, 222, 196), cBelly: srgb(244, 241, 232), cDark: srgb(58, 70, 66), cSole: srgb(110, 190, 165), rough: 0.42, metal: 0, wrap: 0.32 },
  sky: { useMask: true, cBody: srgb(122, 178, 240), cBelly: srgb(242, 242, 238), cDark: srgb(48, 56, 72), cSole: srgb(90, 140, 210), rough: 0.42, metal: 0, wrap: 0.32 },
  pink: { useMask: true, cBody: srgb(246, 168, 190), cBelly: srgb(250, 238, 232), cDark: srgb(78, 60, 64), cSole: srgb(220, 130, 155), rough: 0.42, metal: 0, wrap: 0.32 },
  titanium: { useMask: true, cBody: [0.50, 0.47, 0.43], cBelly: [0.82, 0.80, 0.77], cDark: [0.10, 0.10, 0.10], cSole: [0.42, 0.40, 0.37], rough: 0.30, metal: 1, wrap: 0, spec: 1 },
};
const EYE_MAT = { rough: 0.05, metal: 0, wrap: 0.0, spec: 1.6 };
function character(pos, yaw, variant = 'yellow', scale = 1, extra = {}) {
  const model = M4.trs(pos, yaw, scale);
  const v = VARIANTS[variant];
  const mouth = { rough: 0.5, metal: 0, wrap: 0.1, constCol: META.colors.mouth };
  return [
    { mesh: 'body', lo: 'bodylo', model, mat: Object.assign({}, v, extra) },
    { mesh: 'eyeL', model, mat: EYE_MAT },
    { mesh: 'eyeR', model, mat: EYE_MAT },
    { mesh: 'mouth', model, mat: mouth },
  ];
}

// ---------- lighting presets ----------
function studioWhite() {
  return {
    lights: [
      { dir: [-0.45, 0.75, 0.75], col: [2.3, 2.25, 2.15] },
      { dir: [0.8, 0.35, 0.45], col: [0.75, 0.78, 0.85] },
      { dir: [0.1, 0.5, -1.0], col: [0.9, 0.9, 0.95], rim: 0.25 },
    ],
    sky: [0.62, 0.64, 0.68], ground: [0.42, 0.38, 0.33],
    env: [[1.2, 1.2, 1.2], [0.85, 0.85, 0.86], [0.45, 0.43, 0.40]],
    boxes: [
      { dir: [-0.4, 0.7, 0.75], size: [0.55, 0.38], col: [2.4, 2.4, 2.4] },
      { dir: [0.85, 0.2, 0.4], size: [0.12, 0.7], col: [1.2, 1.2, 1.25] },
    ],
    bg: srgb(244, 244, 246), shadowSoft: 0.003,
  };
}
function darkStudio(o = {}) {
  return {
    lights: [
      { dir: o.key || [-0.5, 0.85, 0.65], col: o.keyCol || [1.5, 1.45, 1.4] },
      { dir: [-1.0, 0.35, -0.75], col: [2.4, 2.4, 2.6], rim: 1.1 },
      { dir: [1.0, 0.3, -0.7], col: [2.0, 2.05, 2.3], rim: 1.0 },
      { dir: [0.6, 0.2, 0.8], col: o.fill || [0.18, 0.18, 0.2] },
    ],
    sky: [0.035, 0.036, 0.04], ground: [0.01, 0.01, 0.01],
    env: [[0.02, 0.02, 0.022], [0.006, 0.006, 0.007], [0.0, 0.0, 0.0]],
    boxes: [
      { dir: [-0.85, 0.25, -0.5], size: [0.06, 0.9], col: [3.2, 3.2, 3.4] },
      { dir: [0.85, 0.2, -0.5], size: [0.06, 0.9], col: [2.8, 2.8, 3.1] },
      { dir: o.boxDir || [-0.3, 0.9, 0.5], size: [0.35, 0.25], col: [1.4, 1.4, 1.4] },
    ],
    bg: [0.0, 0.0, 0.0], shadowSoft: 0.0022,
  };
}

// ---------- test scene: turnaround matching the reference sheet ----------
function sceneTurnaround(t) {
  const L = studioWhite();
  const items = [...character([-1.55, 0, 0], 0), ...character([0, 0, 0], Math.PI / 2), ...character([1.55, 0, 0], Math.PI)];
  return Object.assign(L, {
    cam: { pos: [0, 1.05, 14], target: [0, 1.0, 0], fov: fovMM(115) },
    items, shadowBox: { c: [0, 1, 0], r: 2.6 }, shadowSoft: 0.0016,
    floor: { col: [3.2, 3.2, 3.2], sh: 0.12, ao: 0.35, fade: [3, 6] },
    floorInst: [[-1.55, 0, 0, 1], [0, 0, Math.PI / 2, 1], [1.55, 0, Math.PI, 1]],
    post: { exposure: 0.78, vig: 0.0, grain: 0.0, bloom: 0.0 }, time: t, bg: [3.2, 3.2, 3.2],
  });
}

// ---------- DOM overlay ----------
const OV = document.getElementById('ov');
const els = {};
function txt(id, html, style) {
  let e = els[id]; if (!e) { e = els[id] = document.createElement('div'); e.className = 't'; OV.appendChild(e); }
  if (e._html !== html) { e.innerHTML = html; e._html = html; }
  Object.assign(e.style, style);
  return e;
}
function hideAll() { for (const k in els) els[k].style.opacity = 0; }

// ---------- timeline ----------
const SCENES = [];  // filled below: {t0, t1, fn}
window.renderFrame = async function (t) {
  hideAll();
  let S;
  if (t >= 1000) S = sceneTurnaround(t);
  else { const sc = SCENES.find(s => t >= s.t0 && t < s.t1) || SCENES[SCENES.length - 1]; S = sc.fn(t - sc.t0, t); }
  E.render(S);
  if (S.after) S.after(E);
  E.gl.finish();
};

(async () => {
  META = await (await fetch('assets/meta.json')).json();
  E = new Engine(document.getElementById('gl'), window.ENGINE_OPTS || { ss: 1.25, msaa: 0 });
  E.addMesh('body', { pos: await bin('body_pos.bin'), nrm: await bin('body_nrm.bin'), col: await bin('body_col.bin'), ao: await bin('body_ao.bin'), mask: await bin('body_mask.bin'), idx: await bin('body_idx.bin', Uint32Array) });
  E.addMesh('bodylo', { pos: await bin('bodylo_pos.bin'), nrm: await bin('bodylo_nrm.bin'), col: await bin('bodylo_col.bin'), ao: await bin('bodylo_ao.bin'), mask: await bin('bodylo_mask.bin'), idx: await bin('bodylo_idx.bin', Uint32Array) });
  for (const e of ['eyeL', 'eyeR']) E.addMesh(e, { pos: await bin(e + '_pos.bin'), nrm: await bin(e + '_nrm.bin'), col: await bin(e + '_col.bin'), idx: await bin(e + '_idx.bin', Uint32Array) });
  E.addMesh('mouth', { pos: await bin('mouth_pos.bin'), nrm: await bin('mouth_nrm.bin'), idx: await bin('mouth_idx.bin', Uint32Array) });
  E.setFloorAO(await bin('floor_ao.u8', Uint8Array), META.floorAO.n, META.floorAO.extent);
  if (window.setupTimeline) await window.setupTimeline();
  window.READY = true;
})();
