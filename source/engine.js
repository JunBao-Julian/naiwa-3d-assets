// Minimal WebGL2 studio renderer: shadow map, planar reflection, softbox reflections, DOF, bloom, ACES.
'use strict';
const V3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};
const M4 = {
  mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
  persp(fovy, asp, n, f) { const t = 1 / Math.tan(fovy / 2), o = new Float32Array(16); o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o; },
  ortho(l, r, b, t, n, f) { const o = new Float32Array(16); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n); o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o; },
  look(eye, at, up) {
    const z = V3.norm(V3.sub(eye, at)), x = V3.norm(V3.cross(up, z)), y = V3.cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -V3.dot(x, eye), -V3.dot(y, eye), -V3.dot(z, eye), 1]);
  },
  // T * Ry(yaw) * S(sx,sy,sz)
  trs(t, yaw, s, sy) { const c = Math.cos(yaw), n = Math.sin(yaw); sy = sy === undefined ? s : sy; return new Float32Array([c * s, 0, -n * s, 0, 0, sy, 0, 0, n * s, 0, c * s, 0, t[0], t[1], t[2], 1]); },
  nrm3(m) { // inverse transpose of upper 3x3 (rotation+scale)
    const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map(v => v / det);
    return new Float32Array([inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]]);
  },
  xform(m, p) { const x = p[0], y = p[1], z = p[2]; const w = m[3] * x + m[7] * y + m[11] * z + m[15]; return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w]; },
};

const MESH_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aCol;
layout(location=3) in float aAO; layout(location=4) in vec3 aMask;
uniform mat4 uModel, uVP, uView; uniform mat3 uNrmMat;
out vec3 vW, vN, vCol, vMask; out float vAO, vVZ;
void main(){ vec4 w=uModel*vec4(aPos,1.); vW=w.xyz; vN=uNrmMat*aNrm; vCol=aCol; vAO=aAO; vMask=aMask;
 vVZ=-(uView*w).z; gl_Position=uVP*w; }`;

const LIGHT_COMMON = `
uniform vec3 uCam;
uniform int uNL; uniform vec3 uLDir[4]; uniform vec3 uLCol[4]; uniform float uLRim[4];
uniform vec3 uSky, uGround;
uniform int uNB; uniform vec3 uBDir[4]; uniform vec3 uBRight[4]; uniform vec3 uBUp[4]; uniform vec2 uBSize[4]; uniform vec3 uBCol[4];
uniform vec3 uEnvTop, uEnvHor, uEnvBot;
uniform highp sampler2DShadow uShadow; uniform mat4 uLightVP; uniform float uShadowOn; uniform float uShadowSoft;
const vec2 PD[12]=vec2[](vec2(-.326,-.406),vec2(-.840,-.074),vec2(-.696,.457),vec2(-.203,.621),vec2(.962,-.195),vec2(.473,-.480),
 vec2(.519,.767),vec2(.185,-.893),vec2(.507,.064),vec2(.896,.412),vec2(-.322,-.933),vec2(-.792,-.598));
float shadowAt(vec3 w, vec3 n){
  if(uShadowOn<.5) return 1.;
  vec4 s=uLightVP*vec4(w+n*0.006,1.); vec3 p=s.xyz/s.w*.5+.5;
  if(p.x<0.||p.x>1.||p.y<0.||p.y>1.||p.z>1.) return 1.;
  float acc=0.; for(int i=0;i<8;i++){ acc+=texture(uShadow, vec3(p.xy+PD[i]*uShadowSoft, p.z-0.0015)); }
  return acc/8.;
}
vec3 envRefl(vec3 R, float rough){
  vec3 c = R.y>0. ? mix(uEnvHor, uEnvTop, pow(clamp(R.y,0.,1.),.6)) : mix(uEnvHor, uEnvBot, pow(clamp(-R.y,0.,1.),.5));
  for(int i=0;i<4;i++){ if(i>=uNB) break;
    float w=dot(R,uBDir[i]); if(w<=0.02) continue;
    vec2 uv=vec2(dot(R,uBRight[i]),dot(R,uBUp[i]))/w; vec2 sz=uBSize[i];
    float soft=0.015+rough*rough*2.2; vec2 d=abs(uv)-sz;
    float m=(1.-smoothstep(-soft,soft,d.x))*(1.-smoothstep(-soft,soft,d.y));
    c+=uBCol[i]*m*(sz.x*sz.y)/((sz.x+soft)*(sz.y+soft));
  }
  return c;
}
float ggx(float NdH, float a){ float a2=a*a; float d=NdH*NdH*(a2-1.)+1.; return a2/(3.14159*d*d); }
`;

const MESH_FS = `#version 300 es
precision highp float;
in vec3 vW, vN, vCol, vMask; in float vAO, vVZ;
uniform int uUseMask; uniform vec3 uCBody, uCBelly, uCDark, uCSole;
uniform float uRough, uMetal, uSpecK, uWrap, uMirror, uReflFade, uEmit;
${LIGHT_COMMON}
layout(location=0) out vec4 oCol; layout(location=1) out vec4 oDep;
void main(){
  vec3 N=normalize(vN); if(!gl_FrontFacing) N=-N;
  vec3 V=normalize(uCam-vW);
  vec3 base=vCol;
  if(uUseMask==1){ base=mix(uCBody,uCSole,vMask.z); base=mix(base,uCBelly,vMask.x); base=mix(base,uCDark,vMask.y); }
  float rough=uRough; float metal=uMetal;
  vec3 F0=mix(vec3(.04),base,metal); vec3 diffC=base*(1.-metal);
  float NdV=max(dot(N,V),1e-3);
  vec3 Fv=F0+(1.-F0)*pow(1.-NdV,5.);
  float ao=vAO; float sh=shadowAt(vW,N);
  vec3 dif=mix(uGround,uSky,N.y*.5+.5)*ao;
  vec3 spc=vec3(0.);
  for(int i=0;i<4;i++){ if(i>=uNL) break;
    vec3 L=uLDir[i]; float NdL=dot(N,L); float s=(i==0)?sh:1.;
    float w=clamp((NdL+uWrap)/(1.+uWrap),0.,1.);
    vec3 tint=mix(vec3(1.,.62,.42),vec3(1.),clamp(NdL*2.2+.25,0.,1.));
    dif+=uLCol[i]*w*s*mix(vec3(1.),tint,uWrap*2.);
    vec3 H=normalize(L+V); float NdH=max(dot(N,H),0.);
    float a=max(rough*rough,.002);
    spc+=uLCol[i]*ggx(NdH,a)*max(NdL,0.)*s*0.25*uSpecK;
    // rim
    spc+=uLCol[i]*uLRim[i]*smoothstep(.45,1.,1.-NdV)*clamp(NdL+.15,0.,1.)*mix(vec3(1.),base,.6);
  }
  vec3 R=reflect(-V,N);
  float specOcc=clamp(pow(ao,1.5)*1.15,0.,1.);
  spc+=envRefl(R,rough)*specOcc*uSpecK;
  vec3 col=diffC*dif*(1.-Fv*(1.-metal)*.6) + spc*Fv*(metal>.5?1.:1.) + base*uEmit;
  if(uMirror>.5){ float h=max(-vW.y,0.); col*=exp(-h*uReflFade); }
  oCol=vec4(col,1.); oDep=vec4(vVZ,0.,0.,1.);
}`;

const DEPTH_VS = `#version 300 es
layout(location=0) in vec3 aPos; uniform mat4 uModel, uVP; void main(){ gl_Position=uVP*uModel*vec4(aPos,1.); }`;
const DEPTH_FS = `#version 300 es
precision highp float; out vec4 o; void main(){ o=vec4(1.); }`;

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aP; out vec2 vUV; void main(){ vUV=aP*.5+.5; gl_Position=vec4(aP,0.,1.); }`;

const BG_FS = `#version 300 es
precision highp float; in vec2 vUV;
uniform vec3 uBg, uBgGlow; uniform vec2 uGlowPos; uniform float uGlowR; uniform vec2 uRes;
layout(location=0) out vec4 oCol; layout(location=1) out vec4 oDep;
void main(){ vec2 p=(vUV-uGlowPos)*vec2(uRes.x/uRes.y,1.);
 float g=exp(-dot(p,p)/(uGlowR*uGlowR)); oCol=vec4(uBg+uBgGlow*g,1.); oDep=vec4(1000.,0.,0.,1.); }`;

const FLOOR_VS = `#version 300 es
layout(location=0) in vec2 aP; uniform mat4 uVP, uView; uniform float uSize; out vec3 vW; out float vVZ;
void main(){ vec4 w=vec4(aP.x*uSize,0.,aP.y*uSize,1.); vW=w.xyz; vVZ=-(uView*w).z; gl_Position=uVP*w; }`;
const FLOOR_FS = `#version 300 es
precision highp float; in vec3 vW; in float vVZ;
uniform sampler2D uAO; uniform float uAOExt; uniform int uNI; uniform vec4 uInst[6];
uniform sampler2D uRefl; uniform vec2 uRes; uniform float uReflStr, uReflBlur;
uniform vec3 uFloorCol, uSpotCol; uniform vec2 uSpotPos; uniform float uSpotR;
uniform float uShStr, uAOStr, uFadeNear, uFadeFar; uniform vec2 uFadeC;
${LIGHT_COMMON}
layout(location=0) out vec4 oCol; layout(location=1) out vec4 oDep;
void main(){
  float ao=1.;
  for(int i=0;i<6;i++){ if(i>=uNI) break; vec4 I=uInst[i];
    vec2 d=vW.xz-I.xy; float c=cos(I.z), s=sin(I.z); vec2 l=vec2(c*d.x-s*d.y, s*d.x+c*d.y)/I.w;
    vec2 uv=l/(2.*uAOExt)+.5; if(uv.x>0.&&uv.x<1.&&uv.y>0.&&uv.y<1.) ao*=texture(uAO,uv).r; }
  float sh=shadowAt(vW,vec3(0.,1.,0.));
  vec3 col=uFloorCol*mix(1.,sh,uShStr)*mix(1.,ao,uAOStr);
  vec2 sp=vW.xz-uSpotPos; col+=uSpotCol*exp(-dot(sp,sp)/(uSpotR*uSpotR))*mix(1.,sh,.85)*ao;
  if(uReflStr>0.){ vec2 uv=gl_FragCoord.xy/uRes; vec3 r=vec3(0.); float tw=0.;
    for(int i=0;i<12;i++){ vec2 o=PD[i]*uReflBlur/uRes; r+=texture(uRefl,uv+o).rgb; tw+=1.; }
    r+=texture(uRefl,uv).rgb*2.; tw+=2.;
    vec3 V=normalize(uCam-vW); float f=.06+.94*pow(1.-max(V.y,0.),5.);
    col+=r/tw*uReflStr*mix(.35,1.,f); }
  float a=1.-smoothstep(uFadeNear,uFadeFar,length(vW.xz-uFadeC));
  oCol=vec4(col,a); oDep=vec4(vVZ,0.,0.,a);
}`;

const TEXT_VS = `#version 300 es
layout(location=0) in vec2 aP; uniform mat4 uVP, uView, uModel; out vec2 vUV; out float vVZ;
void main(){ vUV=vec2(aP.x*.5+.5, .5-aP.y*.5); vec4 w=uModel*vec4(aP,0.,1.); vVZ=-(uView*w).z; gl_Position=uVP*w; }`;
const TEXT_FS = `#version 300 es
precision highp float; in vec2 vUV; in float vVZ; uniform sampler2D uTex; uniform float uAlpha, uGain;
layout(location=0) out vec4 oCol; layout(location=1) out vec4 oDep;
void main(){ vec4 t=texture(uTex,vUV); vec3 c=pow(t.rgb,vec3(2.2)); float a=t.a*uAlpha; oCol=vec4(c*uGain,a); oDep=vec4(vVZ,0.,0.,a); }`;

const BRIGHT_FS = `#version 300 es
precision highp float; in vec2 vUV; uniform sampler2D uSrc; uniform float uThr; uniform vec2 uTexel; out vec4 o;
void main(){ vec3 c=vec3(0.); for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) c+=texture(uSrc,vUV+vec2(x,y)*uTexel).rgb; c/=9.;
 float l=max(c.r,max(c.g,c.b)); o=vec4(c*max(l-uThr,0.)/max(l,1e-4),1.); }`;
const BLUR_FS = `#version 300 es
precision highp float; in vec2 vUV; uniform sampler2D uSrc; uniform vec2 uDir; out vec4 o;
void main(){ float w[5]=float[](.227,.194,.121,.054,.016); vec3 c=texture(uSrc,vUV).rgb*w[0];
 for(int i=1;i<5;i++){ c+=texture(uSrc,vUV+uDir*float(i)).rgb*w[i]; c+=texture(uSrc,vUV-uDir*float(i)).rgb*w[i]; } o=vec4(c,1.); }`;

const DOF_FS = `#version 300 es
precision highp float; in vec2 vUV;
uniform sampler2D uCol, uDep; uniform vec2 uRes; uniform float uFocus, uAperture, uMaxCoC; out vec4 o;
float coc(float z){ return clamp(abs(z-uFocus)/max(z,1e-3)*uAperture, 0., uMaxCoC); }
void main(){
  float cz=texture(uDep,vUV).r; float cc=coc(cz);
  vec3 c0=min(texture(uCol,vUV).rgb, vec3(2.0)); float w0=1./(1.+dot(c0,vec3(.2,.6,.2))*.6); vec3 acc=c0*w0; float tw=w0; float cmax=cc;
  for(int i=0;i<40;i++){ float fi=float(i)+.5; float r=sqrt(fi/40.)*uMaxCoC; float a=fi*2.39996;
    vec2 off=vec2(cos(a),sin(a))*r/uRes; float sz=texture(uDep,vUV+off).r; float sc=coc(sz);
    float w=clamp(sc-r+1.,0.,1.); if(sz>cz+.05) w*=clamp(cc-r+1.,0.,1.);
    if(sz<cz-.05) cmax=max(cmax, sc*w);
    vec3 sc3=min(texture(uCol,vUV+off).rgb, vec3(2.0)); float kw=w/(1.+dot(sc3,vec3(.2,.6,.2))*.6);
    acc+=sc3*kw; tw+=kw; }
  o=vec4(acc/tw, cmax);
}`;

const POST_FS = `#version 300 es
precision highp float; in vec2 vUV;
uniform sampler2D uCol, uDep, uBloom, uDof; uniform vec2 uRes;
uniform float uFocus, uAperture, uMaxCoC, uBloomK, uExposure, uVig, uGrain, uTime, uFade; uniform vec2 uOutRes;
out vec4 o;
float coc(float z){ return clamp(abs(z-uFocus)/max(z,1e-3)*uAperture, 0., uMaxCoC); }
vec3 aces(vec3 x){ const mat3 I=mat3(.59719,.07600,.02840,.35458,.90834,.13383,.04823,.01566,.83777);
 const mat3 O=mat3(1.60475,-.10208,-.00327,-.53108,1.10813,-.07276,-.07367,-.00605,1.07602);
 vec3 v=I*x; vec3 a=v*(v+.0245786)-.000090537; vec3 b=v*(.983729*v+.4329510)+.238081; return clamp(O*(a/b),0.,1.); }
float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233))+uTime*17.)*43758.5453); }
void main(){
  vec2 ho=.25/uOutRes;
  vec3 c=.25*(texture(uCol,vUV+vec2(-ho.x,-ho.y)).rgb+texture(uCol,vUV+vec2(ho.x,-ho.y)).rgb+texture(uCol,vUV+vec2(-ho.x,ho.y)).rgb+texture(uCol,vUV+ho).rgb);
  if(uAperture>0.){
    float cc=coc(texture(uDep,vUV).r); vec4 d=texture(uDof,vUV);
    float k=smoothstep(.6,2.2,max(cc,d.a)); c=mix(c,d.rgb,k);
  }
  c+=texture(uBloom,vUV).rgb*uBloomK;
  c*=uExposure;
  c=aces(c);
  vec2 q=vUV-.5; c*=1.-uVig*dot(q,q)*1.6;
  c=pow(c,vec3(1./2.2));
  c+=(h(vUV*uRes)-.5)*uGrain;
  o=vec4(c*uFade,1.);
}`;

class Engine {
  constructor(canvas, opts = {}) {
    this.cv = canvas; this.OW = canvas.width; this.OH = canvas.height; this.SS = opts.ss || 1; this.MSAA = opts.msaa || 0;
    this.W = Math.round(this.OW * this.SS); this.H = Math.round(this.OH * this.SS);
    const gl = this.gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, alpha: false });
    gl.getExtension('EXT_color_buffer_float'); gl.getExtension('OES_texture_float_linear');
    this.progs = {
      mesh: this.prog(MESH_VS, MESH_FS), depth: this.prog(DEPTH_VS, DEPTH_FS), bg: this.prog(QUAD_VS, BG_FS),
      floor: this.prog(FLOOR_VS, FLOOR_FS), text: this.prog(TEXT_VS, TEXT_FS), bright: this.prog(QUAD_VS, BRIGHT_FS),
      blur: this.prog(QUAD_VS, BLUR_FS), post: this.prog(QUAD_VS, POST_FS), dof: this.prog(QUAD_VS, DOF_FS),
    };
    this.quad = this.vao([{ loc: 0, data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), size: 2 }]);
    this.setupTargets();
    this.meshes = {}; this.textures = {};
  }
  prog(vs, fs) {
    const gl = this.gl, p = gl.createProgram();
    for (const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) + '\n' + s.split('\n').map((l, i) => i + 1 + ': ' + l).join('\n'));
      gl.attachShader(p, sh);
    }
    gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const nm = info.name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }
  vao(attrs, idx) {
    const gl = this.gl, v = gl.createVertexArray(); gl.bindVertexArray(v);
    for (const a of attrs) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, a.data, gl.STATIC_DRAW); gl.enableVertexAttribArray(a.loc); gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, 0, 0); }
    if (idx) { const b = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW); }
    gl.bindVertexArray(null); return v;
  }
  addMesh(name, d) { // d: {pos,nrm,col?,ao?,mask?,idx, constCol?}
    const attrs = [{ loc: 0, data: d.pos, size: 3 }, { loc: 1, data: d.nrm, size: 3 }];
    if (d.col) attrs.push({ loc: 2, data: d.col, size: 3 });
    if (d.ao) attrs.push({ loc: 3, data: d.ao, size: 1 });
    if (d.mask) attrs.push({ loc: 4, data: d.mask, size: 3 });
    this.meshes[name] = { vao: this.vao(attrs, d.idx), n: d.idx.length, has: { col: !!d.col, ao: !!d.ao, mask: !!d.mask }, constCol: d.constCol || [1, 1, 1] };
  }
  tex(w, h, ifmt, fmt, type, filter, data) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data || null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  fbo(texs, depth) {
    const gl = this.gl, f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    texs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    if (depth) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    return f;
  }
  setupTargets() {
    const gl = this.gl, W = this.W, H = this.H;
    // scene target (optionally MSAA)
    this.msFbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo);
    const ms = this.MSAA;
    const rb = (fmt) => { const r = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, r); if (ms) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, ms, fmt, W, H); else gl.renderbufferStorage(gl.RENDERBUFFER, fmt, W, H); return r; };
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb(gl.RGBA16F));
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.RENDERBUFFER, rb(gl.RGBA16F));
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb(gl.DEPTH_COMPONENT24));
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    this.colTex = this.tex(W, H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.depTex = this.tex(W, H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST);
    this.resColFbo = this.fbo([this.colTex]); this.resDepFbo = this.fbo([this.depTex]);
    // reflection target (half res, MSAA-free)
    this.rW = W >> 1; this.rH = H >> 1;
    this.reflTex = this.tex(this.rW, this.rH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.reflDep = this.tex(this.rW, this.rH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST);
    const rdb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rdb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.rW, this.rH);
    this.reflFbo = this.fbo([this.reflTex, this.reflDep], rdb);
    // shadow map
    this.SM = 2048;
    this.shTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.shTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.SM, this.SM, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.shFbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.shFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shTex, 0); gl.drawBuffers([gl.NONE]);
    // bloom (quarter res)
    this.bW = W >> 2; this.bH = H >> 2;
    this.bTexA = this.tex(this.bW, this.bH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.bTexB = this.tex(this.bW, this.bH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.bFboA = this.fbo([this.bTexA]); this.bFboB = this.fbo([this.bTexB]);
    this.dW = this.OW >> 1; this.dH = this.OH >> 1;
    this.dofTex = this.tex(this.dW, this.dH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR); this.dofFbo = this.fbo([this.dofTex]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  setFloorAO(data, n, ext) { const gl = this.gl; gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); this.aoTex = this.tex(n, n, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR, data); this.aoExt = ext; }
  textTexture(key, canvas) {
    const gl = this.gl; let t = this.textures[key]; if (!t) { t = this.textures[key] = gl.createTexture(); }
    gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }
  lightUniforms(u, S) {
    const gl = this.gl, L = S.lights;
    gl.uniform1i(u.uNL, L.length);
    gl.uniform3fv(u.uLDir, new Float32Array([].concat(...L.map(l => V3.norm(l.dir)), ...Array(4 - L.length).fill([0, 1, 0]))));
    gl.uniform3fv(u.uLCol, new Float32Array([].concat(...L.map(l => l.col), ...Array(4 - L.length).fill([0, 0, 0]))));
    gl.uniform1fv(u.uLRim, new Float32Array([...L.map(l => l.rim || 0), ...Array(4 - L.length).fill(0)]));
    gl.uniform3fv(u.uSky, S.sky); gl.uniform3fv(u.uGround, S.ground);
    const B = S.boxes || [];
    const bd = [], br = [], bu = [], bs = [], bc = [];
    for (let i = 0; i < 4; i++) {
      const b = B[i]; if (!b) { bd.push(0, 1, 0); br.push(1, 0, 0); bu.push(0, 0, 1); bs.push(0, 0); bc.push(0, 0, 0); continue; }
      const f = V3.norm(b.dir); const r = V3.norm(V3.cross(b.up || [0, 1, 0], f)); const up = V3.cross(f, r);
      bd.push(...f); br.push(...r); bu.push(...up); bs.push(...b.size); bc.push(...b.col);
    }
    gl.uniform1i(u.uNB, B.length); gl.uniform3fv(u.uBDir, bd); gl.uniform3fv(u.uBRight, br); gl.uniform3fv(u.uBUp, bu); gl.uniform2fv(u.uBSize, bs); gl.uniform3fv(u.uBCol, bc);
    gl.uniform3fv(u.uEnvTop, S.env[0]); gl.uniform3fv(u.uEnvHor, S.env[1]); gl.uniform3fv(u.uEnvBot, S.env[2]);
    gl.uniform3fv(u.uCam, S.cam.pos);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shTex); gl.uniform1i(u.uShadow, 0);
    gl.uniformMatrix4fv(u.uLightVP, false, this.lightVP); gl.uniform1f(u.uShadowOn, S.shadow === false ? 0 : 1);
    gl.uniform1f(u.uShadowSoft, S.shadowSoft || 0.0016);
  }
  // items: list of draws {mesh, model, mat:{useMask, cBody..., rough, metal, spec, wrap, emit}}
  drawItems(items, VP, view, S, mirror) {
    const gl = this.gl, P = this.progs.mesh, u = P.u; gl.useProgram(P.p); this.lightUniforms(u, S);
    gl.uniformMatrix4fv(u.uVP, false, VP); gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform1f(u.uMirror, mirror ? 1 : 0); gl.uniform1f(u.uReflFade, S.reflFade || 2.0);
    gl.enable(gl.CULL_FACE); gl.cullFace(mirror ? gl.FRONT : gl.BACK);
    for (const it of items) {
      const m = this.meshes[(mirror || S.lod) && it.lo ? it.lo : it.mesh]; const mat = it.mat;
      let model = it.model; if (mirror) model = M4.mul(new Float32Array([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), model);
      gl.uniformMatrix4fv(u.uModel, false, model); gl.uniformMatrix3fv(u.uNrmMat, false, M4.nrm3(model));
      gl.uniform1i(u.uUseMask, mat.useMask ? 1 : 0);
      gl.uniform3fv(u.uCBody, mat.cBody || [1, 1, 1]); gl.uniform3fv(u.uCBelly, mat.cBelly || [1, 1, 1]);
      gl.uniform3fv(u.uCDark, mat.cDark || [0, 0, 0]); gl.uniform3fv(u.uCSole, mat.cSole || mat.cBody || [1, 1, 1]);
      gl.uniform1f(u.uRough, mat.rough); gl.uniform1f(u.uMetal, mat.metal || 0); gl.uniform1f(u.uSpecK, mat.spec === undefined ? 1 : mat.spec);
      gl.uniform1f(u.uWrap, mat.wrap === undefined ? 0.3 : mat.wrap); gl.uniform1f(u.uEmit, mat.emit || 0);
      gl.bindVertexArray(m.vao);
      if (!m.has.col) gl.vertexAttrib3fv(2, mat.constCol || m.constCol);
      if (!m.has.ao) gl.vertexAttrib1f(3, mat.ao === undefined ? 1 : mat.ao);
      if (!m.has.mask) gl.vertexAttrib3f(4, 0, 0, 0);
      gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null); gl.disable(gl.CULL_FACE);
  }
  render(S) {
    const gl = this.gl, W = this.W, H = this.H;
    const cam = S.cam; const view = M4.look(cam.pos, cam.target, cam.up || [0, 1, 0]);
    const proj = M4.persp(cam.fov, W / H, cam.near || 0.05, cam.far || 60); const VP = M4.mul(proj, view);
    this.VP = VP;
    // ---- shadow pass (key light = lights[0])
    const sb = S.shadowBox || { c: [0, 1, 0], r: 1.6 };
    const ld = V3.norm(S.lights[0].dir);
    const lv = M4.look(V3.add(sb.c, V3.mul(ld, 8)), sb.c, Math.abs(ld[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0]);
    this.lightVP = M4.mul(M4.ortho(-sb.r, sb.r, -sb.r, sb.r, 1, 16), lv);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shFbo); gl.viewport(0, 0, this.SM, this.SM);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    if (S.shadow !== false) {
      const D = this.progs.depth; gl.useProgram(D.p); gl.uniformMatrix4fv(D.u.uVP, false, this.lightVP);
      for (const it of S.items) { if (it.noShadow) continue; const m = this.meshes[it.lo || it.mesh]; gl.uniformMatrix4fv(D.u.uModel, false, it.model); gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_INT, 0); }
    }
    // ---- reflection pass
    const F = S.floor;
    if (F && F.refl > 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.reflFbo); gl.viewport(0, 0, this.rW, this.rH);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 1]); gl.clearBufferfv(gl.COLOR, 1, [1000, 0, 0, 1]); gl.clear(gl.DEPTH_BUFFER_BIT);
      this.drawItems(S.items, VP, view, S, true);
    }
    // ---- main pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo); gl.viewport(0, 0, W, H);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 1]); gl.clearBufferfv(gl.COLOR, 1, [1000, 0, 0, 1]); gl.clear(gl.DEPTH_BUFFER_BIT);
    // background
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    { const P = this.progs.bg; gl.useProgram(P.p); gl.uniform3fv(P.u.uBg, S.bg); gl.uniform3fv(P.u.uBgGlow, S.bgGlow || [0, 0, 0]);
      gl.uniform2fv(P.u.uGlowPos, S.glowPos || [0.5, 0.55]); gl.uniform1f(P.u.uGlowR, S.glowR || 0.6); gl.uniform2f(P.u.uRes, W, H);
      gl.bindVertexArray(this.quad); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
    // text planes behind (drawn before meshes, depth-tested against nothing yet; meshes overwrite)
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    // floor
    if (F) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      const P = this.progs.floor, u = P.u; gl.useProgram(P.p); this.lightUniforms(u, S);
      gl.uniformMatrix4fv(u.uVP, false, VP); gl.uniformMatrix4fv(u.uView, false, view); gl.uniform1f(u.uSize, 12);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.aoTex); gl.uniform1i(u.uAO, 1); gl.uniform1f(u.uAOExt, this.aoExt);
      const inst = S.floorInst || []; gl.uniform1i(u.uNI, inst.length);
      const ia = new Float32Array(24); inst.forEach((v, i) => ia.set(v, i * 4)); gl.uniform4fv(u.uInst, ia);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.reflTex); gl.uniform1i(u.uRefl, 2);
      gl.uniform2f(u.uRes, W, H); gl.uniform1f(u.uReflStr, F.refl || 0); gl.uniform1f(u.uReflBlur, F.reflBlur || 6);
      gl.uniform3fv(u.uFloorCol, F.col); gl.uniform3fv(u.uSpotCol, F.spot || [0, 0, 0]); gl.uniform2fv(u.uSpotPos, F.spotPos || [0, 0]); gl.uniform1f(u.uSpotR, F.spotR || 1);
      gl.uniform1f(u.uShStr, F.sh === undefined ? 0.6 : F.sh); gl.uniform1f(u.uAOStr, F.ao === undefined ? 1 : F.ao);
      gl.uniform1f(u.uFadeNear, F.fade[0]); gl.uniform1f(u.uFadeFar, F.fade[1]); gl.uniform2fv(u.uFadeC, F.fadeC || [0, 0]);
      const fq = this.quad; gl.bindVertexArray(fq);
      // the quad is in XY [-1,1]; floor VS maps (x,y)->(x,0,y)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    // text planes (behind the character in z, depth tested)
    for (const tp of (S.texts || [])) {
      if (tp.alpha <= 0.001) continue;
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      const P = this.progs.text, u = P.u; gl.useProgram(P.p);
      gl.uniformMatrix4fv(u.uVP, false, VP); gl.uniformMatrix4fv(u.uView, false, view); gl.uniformMatrix4fv(u.uModel, false, tp.model);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.textures[tp.tex]); gl.uniform1i(u.uTex, 3);
      gl.uniform1f(u.uAlpha, tp.alpha); gl.uniform1f(u.uGain, tp.gain || 1);
      gl.bindVertexArray(this.quad); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    this.drawItems(S.items, VP, view, S, false);
    // ---- resolve
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resColFbo);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.readBuffer(gl.COLOR_ATTACHMENT1); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resDepFbo);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.disable(gl.DEPTH_TEST);
    // ---- bloom
    const pp = S.post || {};
    gl.bindVertexArray(this.quad);
    { const P = this.progs.bright; gl.useProgram(P.p); gl.bindFramebuffer(gl.FRAMEBUFFER, this.bFboA); gl.viewport(0, 0, this.bW, this.bH);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.colTex); gl.uniform1i(P.u.uSrc, 0); gl.uniform1f(P.u.uThr, pp.bloomThr || 1.0);
      gl.uniform2f(P.u.uTexel, 1 / W * 1.5, 1 / H * 1.5); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
    { const P = this.progs.blur; gl.useProgram(P.p); gl.uniform1i(P.u.uSrc, 0);
      for (let k = 0; k < 2; k++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bFboB); gl.bindTexture(gl.TEXTURE_2D, this.bTexA); gl.uniform2f(P.u.uDir, (1 + k) / this.bW, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bFboA); gl.bindTexture(gl.TEXTURE_2D, this.bTexB); gl.uniform2f(P.u.uDir, 0, (1 + k) / this.bH); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } }
    // ---- half-res DOF
    const dof = S.dof || { aperture: 0 };
    if (dof.aperture > 0) {
      const P = this.progs.dof, u = P.u; gl.useProgram(P.p); gl.bindFramebuffer(gl.FRAMEBUFFER, this.dofFbo); gl.viewport(0, 0, this.dW, this.dH);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.colTex); gl.uniform1i(u.uCol, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.depTex); gl.uniform1i(u.uDep, 1);
      gl.uniform2f(u.uRes, this.dW, this.dH); gl.uniform1f(u.uFocus, dof.focus || 1);
      gl.uniform1f(u.uAperture, (dof.aperture || 0) * 0.5); gl.uniform1f(u.uMaxCoC, (dof.maxCoC || 18) * 0.5);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    // ---- post to canvas
    { const P = this.progs.post, u = P.u; gl.useProgram(P.p); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.OW, this.OH);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.colTex); gl.uniform1i(u.uCol, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.depTex); gl.uniform1i(u.uDep, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.bTexA); gl.uniform1i(u.uBloom, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.dofTex); gl.uniform1i(u.uDof, 3);
      gl.uniform2f(u.uRes, this.OW, this.OH); gl.uniform2f(u.uOutRes, this.OW, this.OH);
      gl.uniform1f(u.uFocus, dof.focus || 1); gl.uniform1f(u.uAperture, dof.aperture || 0); gl.uniform1f(u.uMaxCoC, dof.maxCoC || 18);
      gl.uniform1f(u.uBloomK, pp.bloom === undefined ? 0.35 : pp.bloom); gl.uniform1f(u.uExposure, pp.exposure || 1);
      gl.uniform1f(u.uVig, pp.vig === undefined ? 0.35 : pp.vig); gl.uniform1f(u.uGrain, pp.grain === undefined ? 0.012 : pp.grain);
      gl.uniform1f(u.uTime, S.time || 0); gl.uniform1f(u.uFade, pp.fade === undefined ? 1 : pp.fade);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
    gl.bindVertexArray(null);
  }
  project(p) { const q = M4.xform(this.VP, p); return [(q[0] * 0.5 + 0.5) * this.OW, (0.5 - q[1] * 0.5) * this.OH, q[2]]; }
}
window.Engine = Engine; window.V3 = V3; window.M4 = M4;
