'use strict';
// Apple-launch-style film timeline. Global time in seconds; each scene gets local time lt.
const EYE = { c: [0.133, 1.8515, 0.2006], g: V3.norm([0.337, 0.094, 0.937]) };
const HAND = [0.522, 0.70, 0.14];
const WHITE = '#f5f5f7', GRAY = '#a1a1a6';
const HEAD_FONT = '"Noto Sans CJK SC","Inter",sans-serif';

function blurIn(t, start, dur, dy = 28, blur = 10) {
  const p = tween(t, start, dur, easeOut);
  return { opacity: p, filter: `blur(${(1 - p) * blur}px)`, transform: `translateY(${(1 - p) * dy}px)` };
}
function fadeOutMul(st, t, start, dur) {
  if (t < start) return st; const p = 1 - tween(t, start, dur, easeOut);
  st.opacity = (st.opacity === undefined ? 1 : st.opacity) * p; return st;
}
function headline(id, text, x, y, size, st, extra = {}) {
  return txt(id, text, Object.assign({ left: x + 'px', top: y + 'px', fontFamily: HEAD_FONT, fontWeight: 700, fontSize: size + 'px', letterSpacing: '0.01em', color: WHITE, lineHeight: 1.15 }, extra, st));
}
function subline(id, text, x, y, size, st, extra = {}) {
  return txt(id, text, Object.assign({ left: x + 'px', top: y + 'px', fontFamily: HEAD_FONT, fontWeight: 500, fontSize: size + 'px', color: GRAY, letterSpacing: '0.02em' }, extra, st));
}
const centerX = (extra = {}) => Object.assign({ left: '0px', width: '1920px', textAlign: 'center' }, extra);

function darkFloor(extra = {}) {
  return Object.assign({ col: [0.0, 0.0, 0.0], refl: 0.45, reflBlur: 5, spot: [0.05, 0.048, 0.045], spotPos: [0, 0.1], spotR: 1.05, sh: 0.0, ao: 1.0, fade: [2.6, 5.5] }, extra);
}
function orbit(center, dist, azDeg, elDeg) {
  const a = azDeg * DEG, e = elDeg * DEG;
  return [center[0] + dist * Math.cos(e) * Math.sin(a), center[1] + dist * Math.sin(e), center[2] + dist * Math.cos(e) * Math.cos(a)];
}

// ---------- A: darkness, light sweep reveals the silhouette (0–4s)

// ---------- camera helpers ----------
function spline(pts, u) {
  const n = pts.length - 1; const x = Math.min(n - 1e-6, Math.max(0, u * n)); const i = Math.floor(x); const t = x - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  return [0, 1, 2].map(k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t));
}
function rollUp(pos, target, deg) {
  const f = V3.norm(V3.sub(target, pos)); const r = V3.norm(V3.cross(f, [0, 1, 0])); const u = V3.cross(r, f); const a = deg * DEG;
  return V3.add(V3.mul(u, Math.cos(a)), V3.mul(r, Math.sin(a)));
}
const focusOn = (pt, pos, target) => V3.dot(V3.sub(pt, pos), V3.norm(V3.sub(target, pos)));
function frameRight(center, camPos, amount) { // shift the aim so `center` lands left(+)/right(-) of frame centre
  const f = V3.norm(V3.sub(center, camPos)); const r = V3.norm(V3.cross(f, [0, 1, 0]));
  return V3.add(center, V3.mul(r, amount));
}

// ---------- A: dark contour slide -> face (0–4s). Camera glides down the rim-lit dome with a dutch roll that levels out.
function sceneA(lt, t) {
  const L = darkStudio({ key: [0.55, 0.75, 0.55], keyCol: [0, 0, 0] });
  const keyP = tween(lt, 1.6, 2.2, softInOut) * 0.85;
  L.lights[0].col = [1.5 * keyP, 1.45 * keyP, 1.4 * keyP];
  const rimP = tween(lt, 0.1, 1.4, softInOut);
  L.lights[1].col = V3.mul(L.lights[1].col, rimP * 1.25); L.lights[2].col = V3.mul(L.lights[2].col, rimP * 1.15);
  L.lights[3].col = V3.mul(L.lights[3].col, keyP);
  L.sky = V3.mul(L.sky, 0.2 + 0.8 * keyP / 0.85);
  const sw = lerp(-1.25, 1.1, tween(lt, 0.4, 3.0, softInOut));
  L.boxes = [
    { dir: [Math.sin(sw), 0.25, Math.cos(sw)], size: [0.05, 1.4], col: [5, 5, 5.2] },
    { dir: [-0.85, 0.25, -0.5], size: [0.06, 0.9], col: V3.mul([3.2, 3.2, 3.4], rimP) },
    { dir: [0.85, 0.2, -0.5], size: [0.06, 0.9], col: V3.mul([2.8, 2.8, 3.1], rimP) },
  ];
  const u = tween(lt, 0, 4, softInOut);
  const pos = spline([[0.18, 2.16, 0.62], [0.42, 2.0, 0.86], [0.56, 1.8, 1.02], [0.5, 1.64, 1.04]], u);
  const target = spline([[-0.02, 1.98, 0.0], [0.0, 1.9, 0.04], [0.0, 1.8, 0.05], [0.0, 1.78, 0.05]], u);
  return Object.assign(L, {
    cam: { pos, target, up: rollUp(pos, target, lerp(-14, 0, u)), fov: fovMM(50) },
    items: character([0, 0, 0], 0.18, 'yellow', 1, { wrap: 0.18 }), shadowBox: { c: [0, 1.4, 0], r: 1.1 },
    floor: null, dof: { focus: focusOn([0.1, 1.86, 0.18], pos, target), aperture: 24, maxCoC: 14 },
    post: { exposure: 1.05 * tween(lt, 0.0, 2.4, softInOut), vig: 0.5, grain: 0.014, bloom: 0.16, bloomThr: 1.4 }, time: t,
  });
}

// ---------- B: snap push-in onto the eye + rack focus, then slow drift (4–8s)
function sceneB(lt, t) {
  const L = darkStudio({ key: [0.3, 0.8, 0.7], keyCol: [1.6, 1.55, 1.5] });
  L.boxes = [
    { dir: [0.35, 0.55, 0.75], size: [0.45, 0.28], col: [3.0, 3.0, 3.0] },
    { dir: [-0.85, 0.25, -0.2], size: [0.06, 0.9], col: [3.0, 3.0, 3.2] },
    { dir: [0.95, 0.15, 0.0], size: [0.05, 0.8], col: [2.0, 2.0, 2.2] },
  ];
  const yaw = 0.18;
  const M = M4.trs([0, 0, 0], yaw, 1);
  const c = M4.xform(M, EYE.c); const g = V3.norm(M4.xform(M, EYE.g));
  const az = Math.atan2(g[0], g[2]) / DEG;
  const push = tween(lt, 0, 0.8, easeOut);
  const dist = lerp(1.15, 0.37, push) - 0.035 * clamp01((lt - 0.8) / 3.2);
  const a = lerp(az - 44, az - 28, push) + 14 * tween(lt, 0.8, 3.2, softInOut);
  const pos = orbit(c, dist, a, lerp(16, 5, push));
  const target = frameRight(c, pos, 0.075 * push);
  const eyeF = focusOn(V3.add(c, V3.mul(g, 0.045)), pos, target);
  const focus = lerp(eyeF * 2.6, eyeF, tween(lt, 0.25, 0.75, easeInOut));
  const S = Object.assign(L, {
    cam: { pos, target, up: rollUp(pos, target, lerp(8, 0, push)), fov: fovMM(55) }, items: character([0, 0, 0], yaw),
    shadowBox: { c: [0, 1.6, 0], r: 0.8 }, floor: null, dof: { focus, aperture: 95, maxCoC: 20 },
    post: { exposure: 1.0, vig: 0.45, grain: 0.014, bloom: 0.16, bloomThr: 1.4, fade: tween(lt, 0, 0.15, easeOut) }, time: t,
  });
  S.after = () => {
    headline('b1', '一眼入魂。', 1230, 400, 96, blurIn(lt, 1.0, 0.6));
    subline('b2', '翡翠绿双眸，炯炯有神。', 1236, 528, 36, blurIn(lt, 1.17, 0.55, 18, 8));
  };
  return S;
}

// ---------- C: crane up while orbiting the belly profile (8–12s)
function sceneC(lt, t) {
  const L = darkStudio({ key: [-0.2, 0.75, 0.9], keyCol: [1.35, 1.3, 1.25] });
  const sw = lerp(-0.9, 0.9, tween(lt, 0.2, 3.6, softInOut));
  L.boxes = [
    { dir: [Math.sin(sw), 0.1, Math.cos(sw)], size: [0.07, 1.6], col: [4.0, 4.0, 4.2] },
    { dir: [-0.85, 0.25, -0.5], size: [0.06, 0.9], col: [3.2, 3.2, 3.4] },
    { dir: [0.85, 0.2, -0.5], size: [0.06, 0.9], col: [2.8, 2.8, 3.1] },
  ];
  const bc = [0, 1.02, 0.18];
  const u = tween(lt, 0, 4, softInOut);
  const pos = orbit(bc, lerp(1.95, 1.62, u), lerp(100, 48, u), lerp(-26, 6, u));
  const target = frameRight(bc, pos, -0.42);
  const S = Object.assign(L, {
    cam: { pos, target, up: rollUp(pos, target, lerp(-6, 0, u)), fov: fovMM(42) }, items: character([0, 0, 0], 0),
    shadowBox: { c: [0, 1.0, 0], r: 1.2 }, floor: darkFloor(), floorInst: [[0, 0, 0, 1]],
    dof: { focus: focusOn([0.2, 1.05, 0.36], pos, target), aperture: 26, maxCoC: 12 },
    post: { exposure: 1.0, vig: 0.45, grain: 0.014, bloom: 0.16, bloomThr: 1.4 }, time: t,
  });
  S.after = () => {
    headline('c1', '肚量，<br>前所未有。', 150, 380, 92, blurIn(lt, 0.5, 0.6));
    subline('c2', '超大白肚皮，圆润饱满。', 156, 630, 36, blurIn(lt, 0.68, 0.55, 18, 8));
  };
  return S;
}

// ---------- D: tilt down the arm, following the gradient from yellow to dark (12–16s)
function sceneD(lt, t) {
  const L = darkStudio({ key: [0.7, 0.6, 0.6], keyCol: [1.7, 1.62, 1.55] });
  L.boxes = [
    { dir: [0.8, 0.45, 0.4], size: [0.4, 0.3], col: [2.6, 2.6, 2.6] },
    { dir: [-0.6, 0.3, -0.8], size: [0.06, 0.9], col: [3.2, 3.2, 3.4] },
    { dir: [0.4, 0.2, -0.9], size: [0.06, 0.9], col: [2.8, 2.8, 3.1] },
  ];
  const u = tween(lt, 0, 3.3, softInOut);
  const c = spline([[0.555, 1.08, 0.03], [0.55, 0.9, 0.08], [0.525, 0.71, 0.16]], u);
  const pos = orbit(c, lerp(0.85, 0.95, u), lerp(104, 80, tween(lt, 0, 4, softInOut)), lerp(2, -6, u));
  const target = frameRight(c, pos, -0.2);
  const S = Object.assign(L, {
    cam: { pos, target, up: rollUp(pos, target, lerp(4, 0, u)), fov: fovMM(55) }, items: character([0, 0, 0], 0),
    shadowBox: { c: [0.3, 0.9, 0], r: 1.0 }, floor: darkFloor(), floorInst: [[0, 0, 0, 1]],
    dof: { focus: focusOn(c, pos, target), aperture: 50, maxCoC: 16 },
    post: { exposure: 1.0, vig: 0.45, grain: 0.014, bloom: 0.16, bloomThr: 1.4 }, time: t,
  });
  S.after = () => {
    headline('d1', '渐变暗色指尖。', 150, 400, 92, blurIn(lt, 1.6, 0.6));
    subline('d2', '由浅入深，一体成型。', 156, 524, 36, blurIn(lt, 1.78, 0.55, 18, 8));
  };
  return S;
}

// ---------- E: floor-level crane up, arc round, pull back to the giant title (16–22s)
function sceneE(lt, t) {
  const L = darkStudio({ key: [-0.35, 0.85, 0.75], keyCol: [1.55, 1.5, 1.45] });
  const u = tween(lt, 0.0, 4.2, drawer);
  const pos = spline([[0.5, 0.14, 1.3], [1.45, 0.5, 2.3], [1.75, 1.05, 4.0], [1.15, 1.3, 5.6]], u);
  const target = spline([[0.08, 0.62, 0.0], [0.0, 0.92, 0.0], [0.0, 1.12, 0.0], [0.0, 1.22, 0.0]], u);
  const yaw = lerp(0.62, 0.16, tween(lt, 0.2, 3.4, softInOut));
  const tp = tween(lt, 1.7, 1.3, easeOut);
  const W = 5.8, H = W / 4;
  const tm = M4.mul(M4.trs([-0.36, 2.02 + (1 - tp) * 0.06, -1.7], 0, 1, 1), new Float32Array([W / 2, 0, 0, 0, 0, H / 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  return Object.assign(L, { lod: true,
    cam: { pos, target, up: rollUp(pos, target, lerp(-9, 0, u)), fov: fovMM(lerp(28, 40, u)) }, items: character([0, 0, 0], yaw),
    shadowBox: { c: [0, 1.0, 0], r: 1.3 }, floor: darkFloor(), floorInst: [[0, 0, yaw, 1]],
    texts: [{ tex: 'title', alpha: tp, gain: 1.15, model: tm }],
    post: { exposure: 1.0, vig: 0.4, grain: 0.012, bloom: 0.16, bloomThr: 1.4, fade: tween(lt, 0, 0.6, easeOut) }, time: t,
  });
}

// ---------- F: overhead crane-down while it spins (22–27s)
function sceneF(lt, t) {
  const L = darkStudio({ key: [-0.3, 0.85, 0.8], keyCol: [1.5, 1.45, 1.4] });
  const yaw = 2 * Math.PI * tween(lt, 0.2, 4.4, softInOut);
  const P = [0.72, 0, 0];
  const u = tween(lt, 0, 4.6, softInOut);
  const pos = orbit([0.72, 0.95, 0], lerp(5.0, 5.3, u), lerp(-38, 6, u), lerp(64, 7, u));
  const target = frameRight([0.72, 0.95, 0], pos, -0.82);
  const S = Object.assign(L, { lod: true,
    cam: { pos, target, fov: fovMM(44) }, items: character(P, yaw),
    shadowBox: { c: [0.72, 1.0, 0], r: 1.3 }, floor: darkFloor({ spotPos: [0.72, 0.1] }), floorInst: [[P[0], P[2], yaw, 1]],
    post: { exposure: 1.0, vig: 0.4, grain: 0.012, bloom: 0.16, bloomThr: 1.4 }, time: t,
  });
  S.after = () => {
    headline('f1', '360°', 210, 360, 150, blurIn(lt, 0.4, 0.6, 30), { fontFamily: '"Inter Display","Inter",sans-serif', fontWeight: 700, letterSpacing: '-0.02em' });
    headline('f2', '全方位可爱。', 216, 545, 72, blurIn(lt, 0.55, 0.6, 24));
    subline('f3', '每一个角度，都很圆。', 220, 650, 34, blurIn(lt, 0.7, 0.55, 18, 8));
  };
  return S;
}

// ---------- G: start close on yellow, pull back + crane up as the colours fan out (27–32s)
const LINEUP = [
  { v: 'mint', x: -3.0, name: '薄荷绿', dot: '#9fdcc4' },
  { v: 'sky', x: -1.5, name: '天空蓝', dot: '#86b6ee' },
  { v: 'yellow', x: 0.0, name: '柠檬黄', dot: '#f6b524' },
  { v: 'pink', x: 1.5, name: '樱花粉', dot: '#f4a9bd' },
  { v: 'titanium', x: 3.0, name: '原色钛金属', dot: 'linear-gradient(135deg,#d6d1c9,#8d877e)' },
];
function sceneG(lt, t) {
  const L = studioWhite();
  L.boxes = [
    { dir: [-0.35, 0.75, 0.75], size: [0.7, 0.4], col: [2.6, 2.6, 2.6] },
    { dir: [0.9, 0.25, 0.3], size: [0.15, 0.8], col: [1.4, 1.4, 1.45] },
    { dir: [-0.9, 0.3, 0.2], size: [0.12, 0.8], col: [1.1, 1.1, 1.15] },
  ];
  const BG = [1.7, 1.7, 1.72];
  const items = [], inst = [];
  const order = { 1: 0.0, 3: 0.0, 0: 0.16, 4: 0.16 };
  LINEUP.forEach((c, i) => {
    let x = c.x, z = 0;
    if (i !== 2) { const pp = tween(lt, 0.35 + order[i], 1.0, easeOut); x = lerp(c.x * 0.22, c.x, pp); z = lerp(-1.0, 0, pp); }
    const yaw = (i - 2) * -0.07;
    items.push(...character([x, 0, z], yaw, c.v)); inst.push([x, z, yaw, 1]);
  });
  const u = tween(lt, 0, 2.6, drawer);
  const pos = V3.add(spline([[0.35, 1.0, 3.0], [0.15, 1.2, 6.2], [0, 1.33, 8.5]], u), [0, 0, -0.35 * clamp01((lt - 2.6) / 2.4)]);
  const target = spline([[0.0, 1.05, 0], [0, 0.98, 0], [0, 0.92, 0]], u);
  const S = Object.assign(L, { lod: true,
    cam: { pos, target, up: rollUp(pos, target, lerp(5, 0, u)), fov: fovMM(35) }, items, bg: BG,
    shadowBox: { c: [0, 1.0, 0], r: 4.2 }, shadowSoft: 0.0022,
    floor: { col: BG, sh: 0.22, ao: 0.8, fade: [6, 12] }, floorInst: inst,
    post: { exposure: 0.78, vig: 0.06, grain: 0.006, bloom: 0.0 }, time: t,
  });
  S.after = (E) => {
    const dark = { color: '#1d1d1f' };
    headline('g1', '五款配色，个个圆满。', 0, 92, 76, blurIn(lt, 1.5, 0.6), centerX(dark));
    LINEUP.forEach((c, i) => {
      const sp = E.project([c.x, -0.02, 0.35]);
      const st = blurIn(lt, 2.1 + (i === 2 ? 0 : 0.08), 0.5, 12, 6);
      txt('gl' + i, `<span style="display:inline-block;width:18px;height:18px;border-radius:9px;background:${c.dot};vertical-align:-2px;margin-right:10px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)"></span>${c.name}`,
        Object.assign({ left: (sp[0] - 150) + 'px', width: '300px', textAlign: 'center', top: (sp[1] + 14) + 'px', fontFamily: HEAD_FONT, fontWeight: 500, fontSize: '32px', color: '#3a3a3c' }, st));
    });
  };
  return S;
}

// ---------- H: arc round to the front as it turns to face us; end lockup (32–37s)
function sceneH(lt, t) {
  const L = darkStudio({ key: [-0.25, 0.8, 0.85], keyCol: [1.5, 1.45, 1.4] });
  const u = tween(lt, 0.0, 2.8, easeOut);
  const yaw = lerp(-0.6, 0.0, tween(lt, 0.1, 2.4, easeOut));
  const pos = orbit([0, 1.52, 0], lerp(8.6, 9.6, u), lerp(40, 0, u), lerp(14, 1, u));
  const S = Object.assign(L, { lod: true,
    cam: { pos, target: [0, 1.52, 0], fov: fovMM(50) }, items: character([0, 0, 0], yaw),
    shadowBox: { c: [0, 1.0, 0], r: 1.3 }, floor: darkFloor(), floorInst: [[0, 0, yaw, 1]],
    post: { exposure: 1.0, vig: 0.4, grain: 0.012, bloom: 0.16, bloomThr: 1.4, fade: tween(lt, 0, 0.6, easeOut) * (1 - tween(lt, 4.25, 0.75, softInOut)) }, time: t,
  });
  S.after = () => {
    const f = 1 - tween(lt, 4.25, 0.75, softInOut);
    const g = 'linear-gradient(180deg,#fff4cf 0%,#ffd45a 45%,#f2a51c 100%)';
    const st1 = blurIn(lt, 1.3, 0.8, 30, 12); st1.opacity *= f;
    headline('h1', '奶蛙', 0, 66, 140, st1, centerX({ backgroundImage: g, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', paddingBottom: '10px', letterSpacing: '0.12em', textIndent: '0.12em' }));
    const st2 = blurIn(lt, 1.65, 0.7, 18, 8); st2.opacity *= f;
    subline('h2', '圆满，超乎想象。', 0, 244, 44, st2, centerX({ color: '#e8e8ed', fontWeight: 600 }));
    const st3 = blurIn(lt, 3.0, 0.6, 10, 6); st3.opacity *= f;
    subline('h3', '即将登场', 0, 322, 30, st3, centerX({ color: GRAY, letterSpacing: '0.3em', textIndent: '0.3em' }));
  };
  return S;
}

window.setupTimeline = async function () {
  await document.fonts.load('700 200px "Noto Sans CJK SC"'); await document.fonts.load('600 200px "Inter Display"');
  // title texture for the hero scene (drawn into the 3D set; the head sits between 奶 and 蛙)
  const c = document.createElement('canvas'); c.width = 2048; c.height = 512; const x = c.getContext('2d');
  x.clearRect(0, 0, 2048, 512);
  const g = x.createLinearGradient(0, 80, 0, 440); g.addColorStop(0, '#fff6d8'); g.addColorStop(0.5, '#ffd257'); g.addColorStop(1, '#e8961a');
  x.fillStyle = g; x.textBaseline = 'middle';
  const GAP = 330;
  x.font = '700 320px "Noto Sans CJK SC"';
  x.textAlign = 'right'; x.fillText('奶', 1024 - GAP / 2, 262);
  x.textAlign = 'left'; x.fillText('蛙', 1024 + GAP / 2, 262);
  E.textTexture('title', c);
  SCENES.push(
    { t0: 0, t1: 4, fn: sceneA }, { t0: 4, t1: 8, fn: sceneB }, { t0: 8, t1: 12, fn: sceneC }, { t0: 12, t1: 16, fn: sceneD },
    { t0: 16, t1: 22, fn: sceneE }, { t0: 22, t1: 27, fn: sceneF }, { t0: 27, t1: 32, fn: sceneG }, { t0: 32, t1: 37, fn: sceneH });
};
