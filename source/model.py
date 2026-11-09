"""Procedural 3D reconstruction of the yellow character from the turnaround sheet.
Body = smooth union of a measured loft (front/side silhouettes) + arms + hands + legs + feet + eye sockets.
Outputs: assets/*.bin (render data), assets/meta.json, character.glb
"""
import numpy as np, json, struct, os
from skimage.measure import marching_cubes
from scipy.ndimage import distance_transform_edt, map_coordinates, gaussian_filter1d
from scipy.interpolate import PchipInterpolator

os.makedirs('assets', exist_ok=True)
S = 2.0 / 258.0          # world units per reference pixel (height 2.0)
Y0 = 267.0               # reference pixel row of the ground

def ypx(v): return (Y0 - np.asarray(v, float)) * S

# ---------------- measured profiles (reference pixels) ----------------
# torso half-width (front view, arms excluded)
W = [(9,0),(10.5,8),(12,12.5),(14,17),(17,21.5),(20,24),(26,26.5),(32,27.2),(38,28.2),(44,30.2),
     (50,32),(56,34.5),(62,37.5),(70,41.5),(80,46.5),(92,51.5),(104,56),(116,59.5),(128,61.2),
     (140,62),(152,61),(164,57.5),(176,53),(188,47.5),(196,44),(202,39),(207,31),(210.5,20),(212.5,9),(213.2,0)]
# side view back / front (relative to leg axis x=238)
B = [(9,4.5),(10.5,-2),(12,-7),(14,-13),(17,-17),(20,-20),(26,-24.5),(32,-28),(38,-31),(44,-34),(50,-36),(56,-38),(62,-40),
     (68,-42),(74,-44),(80,-46),(86,-47),(92,-48),(98,-49),(104,-50),(116,-50.5),(128,-51),(146,-51),(158,-50),
     (164,-49),(170,-46.5),(176,-44),(182,-41),(188,-35.5),(194,-29),(200,-21),(205,-14),(209,-8),(212,-3),(213.2,1)]
F_ = [(9,4.5),(10.5,11),(12,15),(14,20),(17,24),(20,26.5),(26,28),(32,28.6),(38,28.8),(44,29),(50,29.5),(56,28.6),(62,27.2),
     (68,27),(74,28),(80,30),(86,32),(92,34),(98,35.5),(104,38.5),(110,42.5),(116,44.5),(122,47.2),(128,50),(134,52),
     (140,53),(146,53),(152,52.3),(158,52),(164,51),(170,49),(176,46),(182,42),(188,36),(194,29.5),(200,22),(205,15),
     (209,9.5),(212,4),(213.2,1)]

def prof(tab, sq=False):
    t = np.array(tab, float)
    y = ypx(t[:, 0])[::-1]; v = (t[:, 1] * S)[::-1]
    yy = np.linspace(y.min(), y.max(), 4000)
    sig = 0.028 / (yy[1] - yy[0])
    if sq:   # interpolate & smooth w^2 so the caps are domes, not cones
        f = PchipInterpolator(y, v ** 2)
        w2 = gaussian_filter1d(f(yy), sig, mode='nearest')
        out = np.sqrt(np.clip(w2, 0, None))
    else:
        out = gaussian_filter1d(PchipInterpolator(y, v)(yy), sig, mode='nearest')
    return yy, out

yW, vW = prof(W, sq=True)
yB, vB = prof(B)
yF, vF = prof(F_)
YMIN, YMAX = yW.min(), yW.max()

def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)

def smax(a, b, k):
    return -smin(-a, -b, k)

def torso(x, y, z):
    w = np.interp(y, yW, vW); bb = np.interp(y, yB, vB); ff = np.interp(y, yF, vF)
    c = 0.5 * (ff + bb); h = np.maximum(0.5 * (ff - bb), 1e-4)
    w = np.maximum(w, 1e-4)
    q = np.sqrt((x / w) ** 2 + ((z - c) / h) ** 2)
    d = (q - 1.0) * np.minimum(w, h)
    # outside the vertical range: distance to cap
    d = np.where(y > YMAX, np.sqrt(x**2 + (y - YMAX)**2 + (z - 4.5*S)**2), d)
    d = np.where(y < YMIN, np.sqrt(x**2 + (y - YMIN)**2 + z**2), d)
    tt = np.clip((y - 1.90) / 0.08, 0, 1)
    return d + tt * tt * 0.06

def round_cone(x, y, z, a, b):
    ax, ay, az, ar = a; bx, by, bz, br = b
    dx, dy, dz = bx - ax, by - ay, bz - az
    L2 = dx*dx + dy*dy + dz*dz
    t = np.clip(((x-ax)*dx + (y-ay)*dy + (z-az)*dz) / L2, 0, 1)
    px, py, pz = x - (ax + t*dx), y - (ay + t*dy), z - (az + t*dz)
    return np.sqrt(px*px + py*py + pz*pz) - (ar + t*(br - ar))

def catmull(pts, n=36):
    P = np.array(pts, float)
    P = np.vstack([2*P[0]-P[1], P, 2*P[-1]-P[-2]])
    out = []
    for i in range(1, len(P)-2):
        p0, p1, p2, p3 = P[i-1], P[i], P[i+1], P[i+2]
        m = max(2, n // (len(P)-3))
        for t in np.linspace(0, 1, m, endpoint=False):
            t2, t3 = t*t, t*t*t
            out.append(0.5*((2*p1) + (-p0+p2)*t + (2*p0-5*p1+4*p2-p3)*t2 + (-p0+3*p1-3*p2+p3)*t3))
    out.append(P[-2])
    return np.array(out)

def chain(x, y, z, pts, k=None, n=150):
    S_ = catmull(pts, n)
    lo = S_[:, :3].min(0) - S_[:, 3].max() - 0.08; hi = S_[:, :3].max(0) + S_[:, 3].max() + 0.08
    x = np.asarray(x); y = np.asarray(y); z = np.asarray(z)
    inb = (x >= lo[0]) & (x <= hi[0]) & (y >= lo[1]) & (y <= hi[1]) & (z >= lo[2]) & (z <= hi[2])
    out = np.full(x.shape, 0.1, dtype=np.float64)
    xi, yi, zi = x[inb], y[inb], z[inb]
    d = np.full(xi.shape, 1e9)
    for i in range(len(S_) - 1):
        d = np.minimum(d, round_cone(xi, yi, zi, S_[i], S_[i+1]))
    out[inb] = d
    # outside bbox: conservative distance estimate
    cx = np.maximum(np.maximum(lo[0]-x, x-hi[0]), 0); cy = np.maximum(np.maximum(lo[1]-y, y-hi[1]), 0); cz = np.maximum(np.maximum(lo[2]-z, z-hi[2]), 0)
    out[~inb] = (np.sqrt(cx**2 + cy**2 + cz**2) + 0.08)[~inb]
    return out

def ellipsoid(x, y, z, c, r, yaw=0.0):
    px, py, pz = x - c[0], y - c[1], z - c[2]
    if yaw:
        cs, sn = np.cos(yaw), np.sin(yaw)
        px, pz = cs*px - sn*pz, sn*px + cs*pz
    k0 = np.sqrt((px/r[0])**2 + (py/r[1])**2 + (pz/r[2])**2)
    k1 = np.sqrt((px/r[0]**2)**2 + (py/r[1]**2)**2 + (pz/r[2]**2)**2)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-6)

# arm control points for the +x side (x, y, z, radius)
ARM = [(0.22, 1.54, -0.03, 0.092), (0.38, 1.40, -0.02, 0.086), (0.495, 1.21, 0.0, 0.079),
       (0.548, 1.01, 0.03, 0.072), (0.546, 0.88, 0.07, 0.066), (0.533, 0.79, 0.108, 0.057)]
LEG = [(0.20, 0.66, 0.0, 0.145), (0.229, 0.47, 0.01, 0.131), (0.25, 0.29, -0.022, 0.094),
       (0.267, 0.14, -0.048, 0.06), (0.276, 0.075, -0.05, 0.052)]

def hand(x, y, z):
    palm = ellipsoid(x, y, z, (0.523, 0.718, 0.135), (0.043, 0.072, 0.068))
    d = palm
    for zc, yb, r in [(0.098, 0.612, 0.019), (0.133, 0.598, 0.021), (0.168, 0.612, 0.019)]:
        f = round_cone(x, y, z, (0.522, 0.70, zc, r + 0.004), (0.515, yb, zc + 0.012, r))
        d = smin(d, f, 0.022)
    th = round_cone(x, y, z, (0.508, 0.725, 0.175, 0.024), (0.478, 0.672, 0.212, 0.02))
    return smin(d, th, 0.02)

def foot(x, y, z):
    return ellipsoid(x, y, z, (0.287, 0.044, 0.05), (0.056, 0.05, 0.158), yaw=-0.2)

# ---- eyes ----
def surface_z(x, y):
    """march +z to find torso surface"""
    zs = np.linspace(0.6, -0.1, 7001)
    X_, Y_ = np.full_like(zs, x), np.full_like(zs, y)
    d = smin(torso(X_, Y_, zs), ellipsoid(X_, Y_, zs, (0.0, 1.80, 0.018), (0.212, 0.205, 0.207)), 0.05)
    i = np.argmax(d < 0)
    return zs[i]

EYE_R = 0.055
eyes = []
for sx in (1, -1):
    ex, ey = 0.129 * sx, ypx(28.3)
    ez = surface_z(ex, ey)
    g = np.array([0.36 * sx, 0.10, 1.0]); g /= np.linalg.norm(g)
    surf = np.array([ex, ey, ez])
    eyes.append(dict(center=surf + g * 0.012, gaze=g, socket=surf - g * 0.020))
SOCKET_R = 0.072

def body_parts(x, y, z):
    ax = np.abs(x)            # mirror symmetry
    t = torso(x, y, z)
    arm = chain(ax, y, z, ARM)
    arm = smin(arm, hand(ax, y, z), 0.035)
    # legs: slightly deeper than wide
    zl = (z + 0.02) / 1.12 - 0.02
    leg = chain(ax, y, zl, LEG)
    leg = smin(leg, foot(ax, y, z), 0.045)
    sock = None
    for e in eyes:
        c = e['socket']
        ds = np.sqrt((x-c[0])**2 + (y-c[1])**2 + (z-c[2])**2) - SOCKET_R
        sock = ds if sock is None else np.minimum(sock, ds)
    return t, arm, leg, sock

def body_sdf(x, y, z):
    t, arm, leg, sock = body_parts(x, y, z)
    head = ellipsoid(x, y, z, (0.0, 1.80, 0.018), (0.212, 0.205, 0.207))
    t = smin(t, head, 0.05)
    d = smin(t, arm, 0.032)
    d = smin(d, leg, 0.075)
    d = smin(d, sock, 0.028)
    d = smax(d, -y, 0.012)        # flat soles
    return d

# ---------------- mesh the body ----------------
VOX = 0.006
xs = np.arange(-0.70, 0.70 + 1e-9, VOX, dtype=np.float32)
ys = np.arange(-0.03, 2.05 + 1e-9, VOX, dtype=np.float32)
zs = np.arange(-0.46, 0.50 + 1e-9, VOX, dtype=np.float32)
X, Yg, Z = np.meshgrid(xs, ys, zs, indexing='ij')
print('grid', X.shape)
D = body_sdf(X, Yg, Z).astype(np.float32)
del X, Yg, Z
verts, faces, _, _ = marching_cubes(D, 0.0, spacing=(VOX, VOX, VOX))
verts = verts + np.array([xs[0], ys[0], zs[0]], np.float32)
print('verts', len(verts), 'faces', len(faces))

# exact-ish SDF for AO from occupancy
occ = D < 0
edt = ((distance_transform_edt(~occ) - distance_transform_edt(occ)) * VOX).astype(np.float32)
# near the surface the analytic field is smooth and accurate; far away the EDT is exact
sd = np.where(np.abs(D) < 0.05, D, edt).astype(np.float32)
del D, edt

def sample_sd(p):
    idx = np.stack([(p[:, 0] - xs[0]) / VOX, (p[:, 1] - ys[0]) / VOX, (p[:, 2] - zs[0]) / VOX])
    return map_coordinates(sd, idx, order=1, mode='nearest')

def grad(f, p, e=0.0015):
    gx = f(p[:,0]+e, p[:,1], p[:,2]) - f(p[:,0]-e, p[:,1], p[:,2])
    gy = f(p[:,0], p[:,1]+e, p[:,2]) - f(p[:,0], p[:,1]-e, p[:,2])
    gz = f(p[:,0], p[:,1], p[:,2]+e) - f(p[:,0], p[:,1], p[:,2]-e)
    g = np.stack([gx, gy, gz], 1)
    return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)

nrm = grad(body_sdf, verts.astype(np.float64)).astype(np.float32)
import scipy.sparse as sp
nv_ = len(verts)
rows = np.concatenate([faces[:,0], faces[:,1], faces[:,2], faces[:,1], faces[:,2], faces[:,0]])
cols = np.concatenate([faces[:,1], faces[:,2], faces[:,0], faces[:,0], faces[:,1], faces[:,2]])
Adj = sp.csr_matrix((np.ones(len(rows), np.float32), (rows, cols)), shape=(nv_, nv_))
Adj.data[:] = 1.0
for _ in range(3):
    nrm = nrm + Adj @ nrm
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
# one pass of positional smoothing (taubin-lite) to remove marching-cube micro facets
deg = np.asarray(Adj.sum(1)).ravel()[:, None]
lap = (Adj @ verts) / deg - verts
verts = verts + 0.5 * lap
lap = (Adj @ verts) / deg - verts
verts = verts - 0.52 * lap
# fix winding so faces point along normals
fn = np.cross(verts[faces[:,1]] - verts[faces[:,0]], verts[faces[:,2]] - verts[faces[:,0]])
if np.sum(fn * nrm[faces[:,0]]) < 0:
    faces = faces[:, ::-1].copy()

# ---------------- AO bake ----------------
rng = np.random.default_rng(3)
def hemi_dirs(n, k):
    # cosine-weighted directions around normals n (N,3); k samples each
    out = []
    t1 = np.cross(n, np.array([0, 1, 0.0001]))
    t1 /= np.linalg.norm(t1, axis=1, keepdims=True)
    t2 = np.cross(n, t1)
    for i in range(k):
        u1, u2 = (i + 0.5) / k, (i * 0.618034) % 1.0
        r = np.sqrt(u1); ph = 2 * np.pi * u2
        d = t1 * (r*np.cos(ph)) + t2 * (r*np.sin(ph)) + n * np.sqrt(1 - u1)
        out.append(d)
    return out

def bake_ao(p, n, k=16, steps=(0.018, 0.036, 0.065, 0.1, 0.16, 0.25, 0.38)):
    occl = np.zeros(len(p))
    for d in hemi_dirs(n, k):
        vis = np.ones(len(p))
        for h in steps:
            q = p + n * 0.004 + d * h
            s = sample_sd(q)
            vis = np.minimum(vis, np.clip(s / (h * 0.55), 0, 1))
        occl += vis
    return occl / k

ao = bake_ao(verts.astype(np.float64), nrm.astype(np.float64)).astype(np.float32)
print('ao range', ao.min(), ao.mean())

# ---------------- region masks ----------------
vx, vy, vz = verts[:,0].astype(np.float64), verts[:,1].astype(np.float64), verts[:,2].astype(np.float64)
t_, arm_, leg_, sock_ = body_parts(vx, vy, vz)
def sstep(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1); return t*t*(3-2*t)
by_c, by_h, bx_h = ypx(122.5), 35.5 * S, 57.0 * S
e = np.sqrt((vx / bx_h) ** 2 + ((vy - by_c) / by_h) ** 2)
belly = (1 - sstep(0.93, 1.03, e)) * sstep(0.0, 0.08, vz) * sstep(-0.01, 0.03, arm_ - t_)
hand_m = sstep(0.84, 0.665, vy) * sstep(0.01, -0.015, arm_ - t_) * sstep(0.40, 0.45, np.abs(vx))
sole = sstep(0.03, 0.004, vy)

def srgb2lin(c): c = np.asarray(c, float) / 255; return np.where(c <= 0.04045, c/12.92, ((c+0.055)/1.055)**2.4)
YEL, CREAM, DARK, SOLE = srgb2lin((248, 170, 26)), srgb2lin((240, 222, 188)), srgb2lin((86, 78, 64)), srgb2lin((226, 140, 30))
col = YEL[None] * np.ones((len(verts), 1))
col = col * (1 - sole[:, None]) + SOLE[None] * sole[:, None]
col = col * (1 - belly[:, None]) + CREAM[None] * belly[:, None]
col = col * (1 - hand_m[:, None]) + DARK[None] * hand_m[:, None]

# ---------------- eyes (pole along gaze, hard color rings) ----------------
PUPIL, IRIS, RIM = np.radians(31), np.radians(80), np.radians(95)
EYE_PUPIL, EYE_IRIS, EYE_RIM, EYE_BACK = srgb2lin((8, 9, 8)), srgb2lin((78, 196, 44)), srgb2lin((22, 40, 14)), srgb2lin((240, 236, 225))
def eye_mesh(center, gaze, R, nlon=72):
    g = gaze / np.linalg.norm(gaze)
    t1 = np.cross(g, [0, 1, 0]); t1 /= np.linalg.norm(t1); t2 = np.cross(g, t1)
    bands = [(0, PUPIL, 10, EYE_PUPIL), (PUPIL, IRIS, 18, EYE_IRIS), (IRIS, RIM, 6, EYE_RIM), (RIM, np.pi, 10, EYE_BACK)]
    P, N, C, I = [], [], [], []
    for a0, a1, nr, cc in bands:
        base = len(P)
        ths = np.linspace(a0, a1, nr + 1)
        for th in ths:
            for j in range(nlon):
                ph = 2*np.pi*j/nlon
                d = g*np.cos(th) + (t1*np.cos(ph) + t2*np.sin(ph))*np.sin(th)
                P.append(center + d*R); N.append(d); C.append(cc)
        for i in range(nr):
            for j in range(nlon):
                a = base + i*nlon + j; b = base + i*nlon + (j+1) % nlon
                c2 = a + nlon; d2 = b + nlon
                I += [a, c2, b, b, c2, d2]
    P, N, C, I = np.array(P, np.float32), np.array(N, np.float32), np.array(C, np.float32), np.array(I, np.uint32)
    # winding check
    fn = np.cross(P[I[1::3]] - P[I[0::3]], P[I[2::3]] - P[I[0::3]])
    if np.sum(fn * N[I[0::3]]) < 0: I = I.reshape(-1, 3)[:, ::-1].reshape(-1).copy()
    return P, N, C, I

# ---------------- mouth tube ----------------
def mouth_mesh():
    xsm = np.linspace(-0.082, 0.082, 61)
    yc = ypx(42.5)
    pts = []
    for x in xsm:
        y = yc + 0.0105 * (x / 0.082) ** 2 + 0.002 * (x/0.082)**4
        z = surface_z(x, y) - 0.0012
        pts.append((x, y, z))
    pts = np.array(pts)
    P, N, I = [], [], []
    nseg = 10
    for i, p in enumerate(pts):
        tng = pts[min(i+1, len(pts)-1)] - pts[max(i-1, 0)]; tng /= np.linalg.norm(tng)
        u = np.cross(tng, [0, 0, 1.0]); u /= np.linalg.norm(u); v = np.cross(tng, u)
        taper = 0.55 + 0.45 * np.sin(np.pi * i / (len(pts)-1)) ** 0.4
        r = 0.0046 * taper
        for j in range(nseg):
            a = 2*np.pi*j/nseg; d = u*np.cos(a) + v*np.sin(a)
            P.append(p + d*r); N.append(d)
    for i in range(len(pts)-1):
        for j in range(nseg):
            a = i*nseg + j; b = i*nseg + (j+1) % nseg
            I += [a, b, a+nseg, b, b+nseg, a+nseg]
    P, N, I = np.array(P, np.float32), np.array(N, np.float32), np.array(I, np.uint32)
    fn = np.cross(P[I[1::3]] - P[I[0::3]], P[I[2::3]] - P[I[0::3]])
    if np.sum(fn * N[I[0::3]]) < 0: I = I.reshape(-1, 3)[:, ::-1].reshape(-1).copy()
    return P, N, I

eyeL = eye_mesh(eyes[0]['center'], eyes[0]['gaze'], EYE_R)
eyeR = eye_mesh(eyes[1]['center'], eyes[1]['gaze'], EYE_R)
mP, mN, mI = mouth_mesh()
MOUTH = srgb2lin((52, 30, 14))

# ---------------- floor AO texture (contact shadow) ----------------
FN, FE = 256, 1.6  # texture res, half-extent
fx = np.linspace(-FE, FE, FN); fz = np.linspace(-FE, FE, FN)
FX, FZ = np.meshgrid(fx, fz, indexing='xy')
fp = np.stack([FX.ravel(), np.full(FX.size, 0.0), FZ.ravel()], 1)
# analytic SDF everywhere (no box seams); sdf of body only (eyes/mouth negligible)
def sample_sd_analytic(p):
    return body_sdf(p[:,0], p[:,1], p[:,2])
_old = sample_sd
sample_sd = sample_sd_analytic
fn_up = np.tile([0, 1.0, 0], (len(fp), 1))
near = (np.abs(fp[:,0]) < 1.5) & (np.abs(fp[:,2]) < 1.5)
fao = np.ones(len(fp))
fao[near] = bake_ao(fp[near], fn_up[near], k=20, steps=(0.012, 0.03, 0.07, 0.13, 0.22, 0.35, 0.5, 0.7, 0.95))
sample_sd = _old
fao = fao.reshape(FN, FN)
from scipy.ndimage import gaussian_filter
fao = gaussian_filter(fao, 1.0)
# fade to exactly 1 at the texture border
rr = np.maximum(np.abs(FX), np.abs(FZ)) / FE
fao = 1 - (1 - fao) * np.clip((1 - rr) / 0.08, 0, 1)

# ---------------- low-poly LOD for wide shots / shadow / reflection passes ----------------
from scipy.spatial import cKDTree
VL = 0.011
xl = np.arange(-0.70, 0.70 + 1e-9, VL, dtype=np.float32); yl = np.arange(-0.03, 2.05 + 1e-9, VL, dtype=np.float32); zl_ = np.arange(-0.46, 0.50 + 1e-9, VL, dtype=np.float32)
Xl, Yl, Zl = np.meshgrid(xl, yl, zl_, indexing='ij')
Dl = body_sdf(Xl, Yl, Zl).astype(np.float32); del Xl, Yl, Zl
lv, lf, _, _ = marching_cubes(Dl, 0.0, spacing=(VL, VL, VL)); lv = (lv + np.array([xl[0], yl[0], zl_[0]])).astype(np.float32)
ln = grad(body_sdf, lv.astype(np.float64)).astype(np.float32)
fnl = np.cross(lv[lf[:,1]] - lv[lf[:,0]], lv[lf[:,2]] - lv[lf[:,0]])
if np.sum(fnl * ln[lf[:,0]]) < 0: lf = lf[:, ::-1].copy()
_, nn = cKDTree(verts).query(lv)
lcol, lao, lmask = col[nn], ao[nn], np.stack([belly, hand_m, sole], 1)[nn]
print('lod verts', len(lv), 'faces', len(lf))

# ---------------- write render assets ----------------
def wbin(name, arr): arr.astype(np.float32 if arr.dtype.kind == 'f' else np.uint32).tofile(f'assets/{name}.bin')
wbin('body_pos', verts); wbin('body_nrm', nrm); wbin('body_col', col.astype(np.float32))
wbin('body_ao', ao); wbin('body_mask', np.stack([belly, hand_m, sole], 1).astype(np.float32))
wbin('body_idx', faces.astype(np.uint32).ravel())
wbin('bodylo_pos', lv); wbin('bodylo_nrm', ln); wbin('bodylo_col', lcol.astype(np.float32)); wbin('bodylo_ao', lao.astype(np.float32))
wbin('bodylo_mask', lmask.astype(np.float32)); wbin('bodylo_idx', lf.astype(np.uint32).ravel())
for nm, (P, N, C, I) in (('eyeL', eyeL), ('eyeR', eyeR)):
    wbin(nm + '_pos', P); wbin(nm + '_nrm', N); wbin(nm + '_col', C); wbin(nm + '_idx', I)
wbin('mouth_pos', mP); wbin('mouth_nrm', mN); wbin('mouth_idx', mI)
(np.clip(fao, 0, 1) * 255).astype(np.uint8).tofile('assets/floor_ao.u8')
meta = dict(body=dict(nv=len(verts), ni=int(faces.size)), eyeL=dict(nv=len(eyeL[0]), ni=len(eyeL[3])),
            eyeR=dict(nv=len(eyeR[0]), ni=len(eyeR[3])), mouth=dict(nv=len(mP), ni=len(mI)),
            floorAO=dict(n=FN, extent=FE),
            eyes=[dict(center=e['center'].tolist(), gaze=e['gaze'].tolist()) for e in eyes],
            colors=dict(yellow=YEL.tolist(), cream=CREAM.tolist(), dark=DARK.tolist(), sole=SOLE.tolist(),
                        mouth=MOUTH.tolist()))
json.dump(meta, open('assets/meta.json', 'w'), indent=1)

# ---------------- GLB export ----------------
def glb(path, meshes):
    """meshes: list of (name, P, N, C(rgb linear) or None, I, material dict)"""
    bufs, views, accs, gl_meshes, mats, nodes = [], [], [], [], [], []
    off = 0
    def add(arr, target, comp, typ, mm=False):
        nonlocal off
        b = arr.tobytes(); pad = (-len(b)) % 4
        views.append(dict(buffer=0, byteOffset=off, byteLength=len(b), target=target))
        a = dict(bufferView=len(views)-1, componentType=comp, count=int(arr.shape[0]), type=typ)
        if mm: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        accs.append(a); bufs.append(b + b'\0'*pad); off += len(b) + pad
        return len(accs) - 1
    for name, P, N, C, I, mat in meshes:
        attrs = dict(POSITION=add(P.astype(np.float32), 34962, 5126, 'VEC3', True),
                     NORMAL=add(N.astype(np.float32), 34962, 5126, 'VEC3'))
        if C is not None:
            c4 = np.concatenate([C, np.ones((len(C), 1))], 1).astype(np.float32)
            attrs['COLOR_0'] = add(c4, 34962, 5126, 'VEC4')
        ia = add(I.astype(np.uint32).reshape(-1), 34963, 5125, 'SCALAR')
        mats.append(dict(name=name + '_mat', pbrMetallicRoughness=dict(baseColorFactor=mat['color'] + [1.0],
                         metallicFactor=0.0, roughnessFactor=mat['rough'])))
        gl_meshes.append(dict(name=name, primitives=[dict(attributes=attrs, indices=ia, material=len(mats)-1)]))
        nodes.append(dict(name=name, mesh=len(gl_meshes)-1))
    binary = b''.join(bufs)
    doc = dict(asset=dict(version='2.0', generator='procedural SDF reconstruction'),
               scene=0, scenes=[dict(nodes=[len(nodes)])],
               nodes=nodes + [dict(name='Character', children=list(range(len(nodes))))],
               meshes=gl_meshes, materials=mats, accessors=accs, bufferViews=views,
               buffers=[dict(byteLength=len(binary))])
    js = json.dumps(doc, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(binary), 0x004E4942)); f.write(binary)

glb('character.glb', [
    ('Body', verts, nrm, col, faces, dict(color=[1, 1, 1], rough=0.45)),
    ('Eye_L', eyeL[0], eyeL[1], eyeL[2], eyeL[3], dict(color=[1, 1, 1], rough=0.08)),
    ('Eye_R', eyeR[0], eyeR[1], eyeR[2], eyeR[3], dict(color=[1, 1, 1], rough=0.08)),
    ('Mouth', mP, mN, None, mI, dict(color=MOUTH.tolist(), rough=0.6)),
])
print('done; glb MB', os.path.getsize('character.glb') / 1e6)
