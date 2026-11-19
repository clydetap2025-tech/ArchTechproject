// WebGL2 photo treatment. Each photo is pre-painted once (two Kuwahara passes = brush strokes),
// then one "uber" shader blends techniques continuously: strokes, ink edges, posterize, palette map,
// sumi-e wash, temperature, light shaft, leaks, grain, transitions — all driven by style params.

const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const KUW = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uStep; uniform int uR;
void main(){
  vec3 m0=vec3(0.0), m1=vec3(0.0), m2=vec3(0.0), m3=vec3(0.0);
  vec3 s0=vec3(0.0), s1=vec3(0.0), s2=vec3(0.0), s3=vec3(0.0);
  for (int j = 0; j <= 6; j++) {
    for (int i = 0; i <= 6; i++) {
      if (i > uR || j > uR) continue;
      vec2 d = vec2(float(i), float(j)) * uStep;
      vec3 c;
      c = texture(uTex, vUv + vec2(-d.x, -d.y)).rgb; m0 += c; s0 += c*c;
      c = texture(uTex, vUv + vec2( d.x, -d.y)).rgb; m1 += c; s1 += c*c;
      c = texture(uTex, vUv + vec2( d.x,  d.y)).rgb; m2 += c; s2 += c*c;
      c = texture(uTex, vUv + vec2(-d.x,  d.y)).rgb; m3 += c; s3 += c*c;
    }
  }
  float n = float((uR + 1) * (uR + 1));
  m0 /= n; m1 /= n; m2 /= n; m3 /= n;
  vec3 v0 = abs(s0/n - m0*m0), v1 = abs(s1/n - m1*m1), v2 = abs(s2/n - m2*m2), v3 = abs(s3/n - m3*m3);
  float a0 = v0.r+v0.g+v0.b, a1 = v1.r+v1.g+v1.b, a2 = v2.r+v2.g+v2.b, a3 = v3.r+v3.g+v3.b;
  vec3 r = m0; float mn = a0;
  if (a1 < mn) { mn = a1; r = m1; }
  if (a2 < mn) { mn = a2; r = m2; }
  if (a3 < mn) { mn = a3; r = m3; }
  o = vec4(r, 1.0);
}`;

const UBER = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uA, uAk, uB, uBk;
uniform vec2 uTexA, uTexB, uFitA, uFitB;
uniform vec3 uKbA, uKbB;
uniform float uMix; uniform int uTrans; uniform int uHasB;
uniform float uTime, uBeat, uEnergy, uSeed;
uniform float uPaint, uFlow, uFlowSpeed, uEdges, uPoster, uPalMap, uInk, uSat, uContrast, uTemp, uLift;
uniform float uGrain, uGrainSize, uBloom, uLeak, uVig, uShaft, uShaftAng, uValue, uEdgeSoft, uFade, uLevels;
uniform vec2 uLvA, uLvB;
uniform vec3 uPal0, uPal1, uPal2, uPal3, uPal4, uPaper, uInkCol;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0 - 2.0*f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

vec3 palGrad(float l){
  l = clamp(l, 0.0, 1.0) * 4.0;
  if (l < 1.0) return mix(uPal0, uPal1, l);
  if (l < 2.0) return mix(uPal1, uPal2, l - 1.0);
  if (l < 3.0) return mix(uPal2, uPal3, l - 2.0);
  return mix(uPal3, uPal4, l - 3.0);
}

vec3 stylize(sampler2D raw, sampler2D kuw, vec2 texel, vec2 uv, vec2 lv){
  vec2 q = uv * 5.0 + uSeed;
  vec2 d = vec2(fbm(q + uTime * 0.04 * uFlowSpeed), fbm(q + 7.3 - uTime * 0.035 * uFlowSpeed)) - 0.5;
  uv += d * 0.014 * uFlow;
  uv = clamp(uv, texel, 1.0 - texel);
  vec3 c = mix(texture(raw, uv).rgb, texture(kuw, uv).rgb, uPaint);
  float span = max(lv.y - lv.x, 0.08);
  c = mix(c, clamp((c - lv.x) / span, 0.0, 1.0), uLevels);
  if (uEdges > 0.01) {
    vec2 t = texel * 1.5;
    float tl = luma(texture(raw, uv + vec2(-t.x, t.y)).rgb), tc = luma(texture(raw, uv + vec2(0.0, t.y)).rgb), tr = luma(texture(raw, uv + t).rgb);
    float ml = luma(texture(raw, uv + vec2(-t.x, 0.0)).rgb), mr = luma(texture(raw, uv + vec2(t.x, 0.0)).rgb);
    float bl = luma(texture(raw, uv - t).rgb), bc = luma(texture(raw, uv - vec2(0.0, t.y)).rgb), br = luma(texture(raw, uv + vec2(t.x, -t.y)).rgb);
    float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
    float gy = tl + 2.0*tc + tr - bl - 2.0*bc - br;
    c = mix(c, uInkCol, smoothstep(0.18, 0.55, sqrt(gx*gx + gy*gy) / mix(1.0, span, uLevels)) * uEdges);
  }
  vec3 blur = textureLod(kuw, uv, 4.5).rgb;
  c += blur * max(luma(blur) - 0.55, 0.0) * 2.2 * uBloom * 0.8;
  return c;
}

vec2 mapUV(vec2 uv, vec2 fit, vec3 kb){ return (uv - 0.5) * fit / kb.x + 0.5 + kb.yz; }

void main(){
  vec2 uv = vUv;
  float m = 0.0;
  if (uHasB == 1) {
    float t = uMix;
    if (uTrans == 0) { float n = fbm(uv * 3.5 + uSeed * 1.7); m = smoothstep(n - 0.12, n + 0.12, t * 1.24 - 0.12); }
    else if (uTrans == 1) { m = step(dot(uv, vec2(0.62, 0.38)), t * 1.05); }
    else if (uTrans == 2) { float e = t*t*(3.0 - 2.0*t); m = step(1.0 - e, uv.x + (noise(vec2(uv.y * 6.0, uSeed)) - 0.5) * 0.05 * (1.0 - e)); }
    else if (uTrans == 3) { m = t; }
    else if (uTrans == 4) { float r = length((uv - 0.5) * vec2(1.0, 1.2)) * 1.25 + (fbm(uv * 5.0 + uSeed) - 0.5) * 0.4; m = smoothstep(r - 0.06, r + 0.06, t * 1.15); }
    else { m = smoothstep(0.35, 0.65, t); }
  }
  vec3 ca = vec3(0.0), cb = vec3(0.0);
  if (m < 0.999) ca = stylize(uA, uAk, uTexA, mapUV(uv, uFitA, uKbA), uLvA);
  if (m > 0.001) cb = stylize(uB, uBk, uTexB, mapUV(uv, uFitB, uKbB), uLvB);
  vec3 col = mix(ca, cb, m);
  if (uHasB == 1) {
    if (uTrans == 3) col *= 1.0 - 0.45 * sin(uMix * 3.14159);
    if (uTrans == 5) col += vec3(1.0, 0.62, 0.32) * sin(uMix * 3.14159) * 0.9;
  }
  float l = luma(col);
  col = mix(col, palGrad(l), uPalMap);
  if (uPoster > 0.01) { float lv = mix(24.0, 3.0, uPoster); col = mix(col, floor(col * lv + 0.5) / lv, clamp(uPoster * 1.4, 0.0, 1.0)); }
  if (uInk > 0.01) {
    float wash = pow(smoothstep(0.9, 0.08, l + (fbm(uv * 7.0 + uSeed) - 0.5) * 0.22), 1.2);
    vec3 inkc = mix(uPaper, uInkCol, wash * 0.92);
    col = mix(col, mix(inkc, col, 0.24), uInk);
  }
  l = luma(col);
  col = mix(vec3(l), col, uSat);
  col *= vec3(1.0 + 0.12 * uTemp, 1.0 + 0.02 * uTemp, 1.0 - 0.15 * uTemp);
  col = (col - 0.5) * uContrast + 0.5;
  col *= uValue;
  col = col * (1.0 - uLift) + uLift * vec3(0.93, 0.88, 0.80);
  if (uShaft > 0.01) {
    vec2 dir = vec2(cos(uShaftAng), sin(uShaftAng));
    float dd = dot(uv - 0.5, vec2(-dir.y, dir.x)) - 0.1 * sin(uTime * 0.05);
    float band = smoothstep(0.22, 0.04, abs(dd));
    col = mix(col * (1.0 - 0.3 * uShaft), col + vec3(0.24, 0.17, 0.07) * uShaft, band);
  }
  if (uLeak > 0.01) {
    vec2 lp = vec2(1.05, 0.25 + 0.35 * sin(uTime * 0.11 + uSeed));
    col += uLeak * smoothstep(0.75, 0.0, length((uv - lp) * vec2(1.0, 1.5))) * vec3(1.0, 0.42, 0.12) * 0.65;
  }
  col *= 1.0 + uBeat * 0.07 * uEnergy;
  col += (hash(floor(gl_FragCoord.xy / uGrainSize) + fract(uTime * 23.0) * vec2(17.0, 31.0)) - 0.5) * uGrain;
  col *= mix(1.0, smoothstep(0.95, 0.25, length((uv - 0.5) * vec2(1.0, 1.1)) * 1.25), uVig);
  col = clamp(col, 0.0, 1.0);
  float a = 1.0;
  if (uEdgeSoft > 0.01) {
    float ed = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float nn = (fbm(uv * vec2(9.0, 12.0) + uSeed) - 0.5) * 0.07 * uEdgeSoft;
    a = smoothstep(0.0, 0.025 + 0.05 * uEdgeSoft, ed + nn - 0.006);
  }
  o = vec4(col, a * uFade);
}`;

const PAPER = [242 / 255, 236 / 255, 226 / 255];
const INK = [29 / 255, 26 / 255, 23 / 255];

let instance = null;
export function getGL() { return instance || (instance = new PhotoGL()); }

class PhotoGL {
  constructor() {
    const c = (this.canvas = document.createElement('canvas'));
    c.width = 8; c.height = 8;
    const gl = (this.gl = c.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, alpha: true }));
    if (!gl) throw new Error('В этом браузере нет WebGL2 — откройте прототип в свежем Chrome или Edge.');
    this.kuwP = this.program(KUW);
    this.uberP = this.program(UBER);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.fbo = gl.createFramebuffer();
  }

  program(fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const cache = {};
    return { prog: p, u: name => (name in cache ? cache[name] : (cache[name] = gl.getUniformLocation(p, name))) };
  }

  texture(w, h, src) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (src) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    return t;
  }

  pass(src, dst, w, h, step, r) {
    const gl = this.gl, p = this.kuwP;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
    gl.viewport(0, 0, w, h);
    gl.useProgram(p.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(p.u('uTex'), 0);
    gl.uniform2f(p.u('uStep'), step[0], step[1]);
    gl.uniform1i(p.u('uR'), r);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  prepare(bitmap) {
    const gl = this.gl;
    const sc = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(4, Math.round(bitmap.width * sc)), h = Math.max(4, Math.round(bitmap.height * sc));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    const tex = this.texture(w, h, c);
    const k1 = this.texture(w, h, null), k2 = this.texture(w, h, null);
    const R = Math.max(3, Math.min(6, Math.round(Math.max(w, h) / 170)));
    this.pass(tex, k1, w, h, [1.35 / w, 1.35 / h], R);
    this.pass(k1, k2, w, h, [1 / w, 1 / h], Math.max(2, R - 2));
    gl.bindTexture(gl.TEXTURE_2D, k2);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.deleteTexture(k1);
    return { tex, kuw: k2, w, h, aspect: w / h };
  }

  release(p) { if (!p) return; this.gl.deleteTexture(p.tex); this.gl.deleteTexture(p.kuw); }

  render(w, h, U) {
    const gl = this.gl, p = this.uberP, st = U.st;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(p.prog);
    const B = U.B || U.A;
    [[U.A.tex, 'uA'], [U.A.kuw, 'uAk'], [B.tex, 'uB'], [B.kuw, 'uBk']].forEach(([t, name], i) => {
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(p.u(name), i);
    });
    const f = (n, v) => gl.uniform1f(p.u(n), v);
    gl.uniform2f(p.u('uTexA'), 1 / U.A.w, 1 / U.A.h);
    gl.uniform2f(p.u('uTexB'), 1 / B.w, 1 / B.h);
    gl.uniform2f(p.u('uFitA'), U.fitA[0], U.fitA[1]);
    gl.uniform2f(p.u('uFitB'), U.fitB[0], U.fitB[1]);
    gl.uniform3f(p.u('uKbA'), U.kbA[0], U.kbA[1], U.kbA[2]);
    gl.uniform3f(p.u('uKbB'), U.kbB[0], U.kbB[1], U.kbB[2]);
    gl.uniform1i(p.u('uHasB'), U.hasB);
    gl.uniform1i(p.u('uTrans'), U.trans);
    f('uMix', U.mix); f('uTime', U.time); f('uBeat', U.beat); f('uEnergy', U.energy); f('uSeed', U.seed);
    f('uPaint', st.paint); f('uFlow', st.flow); f('uFlowSpeed', st.flowSpeed); f('uEdges', st.edges); f('uPoster', st.poster);
    f('uPalMap', st.palMap); f('uInk', st.ink); f('uSat', st.sat); f('uContrast', st.contrast); f('uTemp', st.temp); f('uLift', st.lift);
    f('uGrain', st.grain); f('uGrainSize', st.grainSize * (w / 800)); f('uBloom', st.bloom); f('uLeak', st.leak); f('uVig', st.vig);
    f('uShaft', st.shaft); f('uShaftAng', st.shaftAng); f('uValue', st.value); f('uEdgeSoft', st.edgeSoft); f('uFade', 1);
    f('uLevels', st.levels ?? 0);
    gl.uniform2f(p.u('uLvA'), U.A.lo ?? 0, U.A.hi ?? 1);
    gl.uniform2f(p.u('uLvB'), B.lo ?? 0, B.hi ?? 1);
    st.palette.forEach((c, i) => gl.uniform3f(p.u('uPal' + i), c[0] / 255, c[1] / 255, c[2] / 255));
    gl.uniform3f(p.u('uPaper'), ...PAPER);
    gl.uniform3f(p.u('uInkCol'), ...INK);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas;
  }
}
