import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

const APPROACH_MS = 1800;
const RING_X = 0;
const RING_Y = -4.0;
const RING_Z = -16;
const RING_R = 2.6;
const BASE_FOV = 60;
const SHARD_CAP = 256;
const EV_CAP = 512;
const DEG = Math.PI / 180;

const LANE_NEAR = [
  [-6.2, -9.2, 4.6],
  [-3.0, -8.4, 3.4],
  [3.0, -8.4, 3.4],
  [6.2, -9.2, 4.6],
];
const LANE_RIM_DEG = [205, 235, 305, 335];

const KIND_CODE = { kick: 0, snare: 1, hat: 2, bass: 3, lead: 4, pad: 5, impact: 6, riser: 7 };
const KIND_W = [1.0, 0.8, 0.35, 0.7, 0.6, 0.3, 1.0, 0.45];
const KIND_HEAVY = [1, 1, 0, 0, 0, 0, 1, 0];

const UP = new THREE.Vector3(0, 1, 0);

const NEBULA_VERT = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const NEBULA_FRAG = `
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreb;
uniform float uBeat;
uniform float uProg;
uniform float uAspect;
uniform int uOct;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
varying vec2 vUv;

float h21(vec2 p){
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = h21(i);
  float b = h21(i + vec2(1.0, 0.0));
  float c = h21(i + vec2(0.0, 1.0));
  float d = h21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p){
  float s = 0.0;
  float a = 0.5;
  for(int i = 0; i < 4; i++){
    if(i >= uOct) break;
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.52;
  }
  return s;
}

void main(){
  vec2 uv = (vUv - 0.5) * vec2(uAspect, 1.0);
  vec2 p = uv * 1.7;
  float t = uTime * 0.02;
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
  float f = fbm(p + q * (1.1 + uMid * 1.5) + vec2(0.0, uTime * 0.008));
  float g = fbm(p * 2.1 - q * 1.3 + vec2(uTime * 0.011, -uTime * 0.007));
  float hueMix = clamp(smoothstep(0.18, 0.85, f) + uProg * 0.22, 0.0, 1.0);
  vec3 col = mix(uColA, uColB, hueMix);
  col = mix(col, uColC, smoothstep(0.55, 0.95, g) * (0.2 + 0.8 * uTreb));
  float amp = 0.05 + uBass * 0.085 + uMid * 0.05 + uTreb * 0.03 + uBeat * 0.11;
  col *= amp * (f * 1.9 + 0.05);
  col += uColA * uBeat * f * 0.06;
  gl_FragColor = vec4(col, 1.0);
}`;

const RIBBON_VERT = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const RIBBON_FRAG = `
uniform vec3 uColor;
uniform float uTime;
uniform float uBoost;
uniform float uOpacity;
varying vec2 vUv;
void main(){
  float ex = abs(vUv.x * 2.0 - 1.0);
  float body = mix(0.05, 0.38, pow(ex, 2.2));
  float band = fract(vUv.y * 1.6 - uTime * 0.22);
  band = exp(-pow((band - 0.5) * 5.5, 2.0));
  float tip = smoothstep(1.0, 0.9, vUv.y) * smoothstep(0.0, 0.06, vUv.y);
  vec3 col = uColor * (body * (0.55 + uBoost * 1.6) + band * body * (1.1 + uBoost * 1.4));
  float a = (body * uOpacity + band * body * 0.5) * tip;
  gl_FragColor = vec4(col * tip, a);
}`;

const PARTICLE_VERT = `
attribute float aFade;
attribute vec3 aCol;
varying float vFade;
varying vec3 vCol;
uniform float uSize;
void main(){
  vFade = aFade;
  vCol = aCol;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * max(aFade, 0.0) * (120.0 / max(-mv.z, 1.0));
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FRAG = `
varying float vFade;
varying vec3 vCol;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.05, d) * vFade;
  gl_FragColor = vec4(vCol * (0.6 + 1.4 * vFade) * a, a);
}`;

export class ReactiveStage {
  constructor(threeStuff, palette, opts) {
    const ts = threeStuff || {};
    this.scene = ts.scene;
    this.camera = ts.camera || null;
    this.renderer = ts.renderer || null;
    this.quality = (opts && opts.quality) || ts.quality || 'high';
    const low = this.quality === 'low';
    this.low = low;

    if (this.renderer) {
      if (typeof this.renderer.setPixelRatioCap === 'function') {
        this.renderer.setPixelRatioCap(low ? 1.0 : 1.5);
      } else {
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1.0 : 1.5));
      }
    }

    const pal = palette || {};
    const laneHex = pal.lane || ['#29f3ff', '#ff3df0', '#ffb347', '#7dff9e'];
    this._laneCols = [];
    for (let i = 0; i < 4; i++) this._laneCols.push(new THREE.Color(laneHex[i % laneHex.length]));
    this._accent = new THREE.Color(pal.accent || '#ffffff');

    this._rng = mulberry32(0x51ec7a);

    this._time = 0;
    this._durMs = 0;
    this._notes = null;
    this._lastAspect = 0;
    this._lastFov = BASE_FOV;
    this._pr = 1;

    this._ringEnv = 0;
    this._beatEnv = 0;
    this._gridEnv = 0;
    this._ribbonEnv = 0;
    this._kickEnv = 0;
    this._laneFlash = [0, 0, 0, 0];

    this._evT = new Float32Array(EV_CAP);
    this._evV = new Float32Array(EV_CAP);
    this._evK = new Uint8Array(EV_CAP);
    this._evHead = 0;
    this._evCount = 0;

    this._vA = new THREE.Vector3();
    this._vB = new THREE.Vector3();
    this._vC = new THREE.Vector3();
    this._vD = new THREE.Vector3();
    this._mA = new THREE.Matrix4();
    this._colA = new THREE.Color();

    this._geos = [];
    this._mats = [];
    this._tex = [];

    this.root = new THREE.Group();
    if (this.scene) this.scene.add(this.root);

    this._bezCoef = new Float32Array(48);
    for (let i = 0; i < 4; i++) this._buildLane(i);

    this._burstN = low ? 42 : 84;
    this._buildNebula(low);
    this._buildStars(low);
    this._buildRecRings();
    this._buildRibbons();
    this._buildPulsar();
    this._buildArcs();
    this._buildShards();
    this._buildParticles(low);
  }

  setChartBounds(durationMs) {
    this._durMs = durationMs > 0 ? durationMs : 0;
  }

  pushEvents(events) {
    if (!events) return;
    for (let ei = 0; ei < events.length; ei++) {
      const e = events[ei];
      let code = KIND_CODE[e.kind];
      if (code === undefined) code = 5;
      let idx = (this._evHead + this._evCount) % EV_CAP;
      if (this._evCount === EV_CAP) {
        this._evHead = (this._evHead + 1) % EV_CAP;
        this._evCount--;
      }
      this._evT[idx] = e.tMs;
      this._evV[idx] = e.vel !== undefined ? e.vel : 0.8;
      this._evK[idx] = code;
      this._evCount++;
      while (this._evCount > 1) {
        const prev = (idx - 1 + EV_CAP) % EV_CAP;
        if (this._evT[idx] >= this._evT[prev]) break;
        const tt = this._evT[idx]; this._evT[idx] = this._evT[prev]; this._evT[prev] = tt;
        const tv = this._evV[idx]; this._evV[idx] = this._evV[prev]; this._evV[prev] = tv;
        const tk = this._evK[idx]; this._evK[idx] = this._evK[prev]; this._evK[prev] = tk;
        idx = prev;
      }
    }
  }

  enqueueNotes(notes) {
    this._notes = notes || null;
  }

  hitFlash(lane, verdict, deltaMs) {
    const l = lane | 0;
    if (l < 0 || l > 3) return;
    const miss = verdict === 'MISS';
    const spread = 1 + Math.min(Math.abs(deltaMs || 0), 135) / 135 * 0.6;
    this._laneFlash[l] = 1;
    this._ringEnv = Math.min(this._ringEnv + 0.25, 1.8);
    if (miss) this._gridEnv = Math.min(this._gridEnv + 0.35, 1.6);
    this._spawnBurst(l, miss, spread);
  }

  update(dtSec, ctx) {
    const dt = dtSec > 0 ? (dtSec < 0.05 ? dtSec : 0.05) : 0;
    const ctxOk = !!ctx;
    const st = ctxOk ? ctx.songTimeMs : 0;
    const bands = ctxOk ? ctx.bands : null;
    const bass = bands && bands.bass > 0 ? bands.bass : 0;
    const mid = bands && bands.mid > 0 ? bands.mid : 0;
    const treb = bands && bands.treb > 0 ? bands.treb : 0;
    this._time += dt;

    this._fireEvents(st);

    this._ringEnv *= Math.exp(-dt * 9);
    this._beatEnv *= Math.exp(-dt * 7);
    this._gridEnv *= Math.exp(-dt * 8);
    this._ribbonEnv *= Math.exp(-dt * 8);
    this._kickEnv *= Math.exp(-dt * 12);

    const ringE = Math.min(this._ringEnv, 1.2);
    this._ringGroup.scale.setScalar(1 + 0.12 * Math.min(this._ringEnv, 1));
    this._coreMat.color.copy(this._accent).multiplyScalar(0.55 + 1.8 * ringE + Math.sin(this._time * 2.0) * 0.04);
    this._haloMat.opacity = 0.10 + 0.38 * Math.min(this._ringEnv, 1.3);

    for (let l = 0; l < 4; l++) {
      const arc = this._arcs[l];
      const op = this._laneFlash[l];
      arc.mat.opacity = op * 0.95;
      arc.mesh.visible = op > 0.005;
      this._laneFlash[l] = op * Math.exp(-dt * 10);
    }

    for (let i = 0; i < this._rings.length; i++) {
      const r = this._rings[i];
      r.obj.rotation.z += r.spin * dt;
      r.obj.rotation.x = Math.sin(this._time * 0.13 + i * 1.7) * 0.05;
      r.mat.opacity = Math.min(r.base * (0.35 + bass * 1.25 + this._gridEnv * 1.1), 0.85);
      r.mat.color.copy(this._accent).multiplyScalar(0.22 + 0.6 * bass + 0.5 * this._gridEnv);
    }

    const starSpeed = (ctxOk && ctx.playing ? 1 : 0.15) * (6 + bass * 7);
    const spArr = this._starPos.array;
    const starN = this._starN;
    for (let i = 0; i < starN; i++) {
      const zi = i * 3 + 2;
      spArr[zi] += starSpeed * dt;
      if (spArr[zi] > 10) spArr[zi] -= 158;
    }
    this._starPos.needsUpdate = true;
    this._starMat.size = 0.5 + bass * 0.55;

    for (let i = 0; i < this._ribbons.length; i++) {
      const rb = this._ribbons[i];
      rb.mat.uniforms.uTime.value = this._time;
      rb.mat.uniforms.uBoost.value = this._ribbonEnv;
      const eo = 0.3 + 0.5 * Math.min(bass * 1.3 + this._ribbonEnv, 1.4);
      rb.edgeMat.opacity = eo > 0.95 ? 0.95 : eo;
      rb.edgeMatR.opacity = eo > 0.95 ? 0.95 : eo;
    }

    const nu = this._nebMat.uniforms;
    nu.uTime.value = this._time;
    nu.uBass.value = bass;
    nu.uMid.value = mid;
    nu.uTreb.value = treb;
    nu.uBeat.value = this._beatEnv;
    nu.uProg.value = this._durMs > 0 ? Math.min(st / this._durMs, 1) : 0;
    if (this.camera && this.camera.aspect !== this._lastAspect) {
      this._lastAspect = this.camera.aspect;
      nu.uAspect.value = this.camera.aspect;
    }

    this._updateNotesAndGlow(st);

    if (this.renderer) this._pr = this.renderer.getPixelRatio ? this.renderer.getPixelRatio() : 1;
    this._pMat.uniforms.uSize.value = 9 * this._pr;
    this._integrateParticles(dt);

    if (this.camera) {
      const fov = BASE_FOV + this._kickEnv;
      if (Math.abs(fov - this._lastFov) > 0.0005) {
        this._lastFov = fov;
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
      }
    }
  }

  dispose() {
    if (this.scene) this.scene.remove(this.root);
    for (let i = 0; i < this._geos.length; i++) this._geos[i].dispose();
    for (let i = 0; i < this._mats.length; i++) this._mats[i].dispose();
    for (let i = 0; i < this._tex.length; i++) this._tex[i].dispose();
    this._geos.length = 0;
    this._mats.length = 0;
    this._tex.length = 0;
    if (this._shards && this._shards.dispose) this._shards.dispose();
    if (this._glow && this._glow.dispose) this._glow.dispose();
  }

  _trackGeo(g) { this._geos.push(g); return g; }
  _trackMat(m) { this._mats.push(m); return m; }

  _buildLane(i) {
    const n = LANE_NEAR[i];
    const a = LANE_RIM_DEG[i] * DEG;
    const p0x = n[0], p0y = n[1], p0z = n[2];
    const p3x = RING_X + RING_R * Math.cos(a);
    const p3y = RING_Y + RING_R * Math.sin(a);
    const p3z = RING_Z;
    const p1x = p0x * 0.72, p1y = p0y + 2.4, p1z = p0z - 5.5;
    const p2x = p3x * 1.9, p2y = p3y - 1.5, p2z = p3z + 6.5;
    const o = i * 12;
    const c = this._bezCoef;
    c[o] = p0x; c[o + 1] = p0y; c[o + 2] = p0z;
    c[o + 3] = 3 * (p1x - p0x); c[o + 4] = 3 * (p1y - p0y); c[o + 5] = 3 * (p1z - p0z);
    c[o + 6] = 3 * (p2x - 2 * p1x + p0x); c[o + 7] = 3 * (p2y - 2 * p1y + p0y); c[o + 8] = 3 * (p2z - 2 * p1z + p0z);
    c[o + 9] = p3x - 3 * p2x + 3 * p1x - p0x;
    c[o + 10] = p3y - 3 * p2y + 3 * p1y - p0y;
    c[o + 11] = p3z - 3 * p2z + 3 * p1z - p0z;
  }

  _bezPoint(lane, t, out) {
    const o = lane * 12;
    const c = this._bezCoef;
    out.set(
      c[o] + t * (c[o + 3] + t * (c[o + 6] + t * c[o + 9])),
      c[o + 1] + t * (c[o + 4] + t * (c[o + 7] + t * c[o + 10])),
      c[o + 2] + t * (c[o + 5] + t * (c[o + 8] + t * c[o + 11]))
    );
    return out;
  }

  _bezTangent(lane, t, out) {
    const o = lane * 12;
    const c = this._bezCoef;
    out.set(
      c[o + 3] + t * (2 * c[o + 6] + t * 3 * c[o + 9]),
      c[o + 4] + t * (2 * c[o + 7] + t * 3 * c[o + 10]),
      c[o + 5] + t * (2 * c[o + 8] + t * 3 * c[o + 11])
    );
    out.normalize();
    return out;
  }

  _buildNebula(low) {
    const geo = this._trackGeo(new THREE.PlaneGeometry(620, 360));
    const mat = this._trackMat(new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreb: { value: 0 },
        uBeat: { value: 0 },
        uProg: { value: 0 },
        uAspect: { value: 1.777 },
        uOct: { value: low ? 2 : 3 },
        uColA: { value: this._laneCols[0].clone() },
        uColB: { value: this._laneCols[1].clone() },
        uColC: { value: this._accent.clone() },
      },
      vertexShader: NEBULA_VERT,
      fragmentShader: NEBULA_FRAG,
      depthWrite: false,
    }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, -2, -155);
    mesh.renderOrder = -1;
    this.root.add(mesh);
    this._nebMat = mat;
  }

  _buildStars(low) {
    const n = this._starN = low ? 300 : 600;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const rng = mulberry32(0xa71e5);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rng() * 2 - 1) * 55;
      pos[i * 3 + 1] = -30 + rng() * 68;
      pos[i * 3 + 2] = -150 + rng() * 158;
      const b = 0.55 + rng() * 0.45;
      col[i * 3] = 0.68 * b + 0.2;
      col[i * 3 + 1] = 0.82 * b + 0.14;
      col[i * 3 + 2] = b + 0.1;
    }
    const geo = this._trackGeo(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = this._trackMat(new THREE.PointsMaterial({
      size: 0.55,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }));
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 0;
    this.root.add(pts);
    this._starPos = geo.attributes.position;
    this._starMat = mat;
  }

  _buildRecRings() {
    const seg = 96;
    const pos = new Float32Array(seg * 2 * 3);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      pos[i * 6] = Math.cos(a0); pos[i * 6 + 1] = Math.sin(a0); pos[i * 6 + 2] = 0;
      pos[i * 6 + 3] = Math.cos(a1); pos[i * 6 + 4] = Math.sin(a1); pos[i * 6 + 5] = 0;
    }
    const geo = this._trackGeo(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this._rings = [];
    for (let i = 0; i < 10; i++) {
      const mat = this._trackMat(new THREE.LineBasicMaterial({
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }));
      const obj = new THREE.LineSegments(geo, mat);
      obj.position.set(0, RING_Y, -22 - i * 6.5);
      obj.scale.setScalar(RING_R + i * 0.62);
      obj.renderOrder = 1;
      this.root.add(obj);
      this._rings.push({
        obj,
        mat,
        spin: (i % 2 === 0 ? 1 : -1) * (0.06 + i * 0.01),
        base: 0.16 * Math.exp(-i * 0.13),
      });
    }
  }

  _buildRibbons() {
    const SEG = 56;
    this._ribbons = [];
    const sides = [-1, 1];
    for (let si = 0; si < 2; si++) {
      const side = sides[si];
      const rimDeg = side < 0 ? 220 : 320;
      const ra = rimDeg * DEG;
      const b0x = side * 7.9, b0y = -9.6, b0z = 5.2;
      const b3x = RING_X + RING_R * Math.cos(ra);
      const b3y = RING_Y + RING_R * Math.sin(ra);
      const b3z = RING_Z;
      const b1x = b0x * 0.78, b1y = b0y + 2.6, b1z = b0z - 5.0;
      const b2x = b3x * 2.1, b2y = b3y - 1.7, b2z = b3z + 6.0;
      const ax = b0x;
      const bx = 3 * (b1x - b0x);
      const cx = 3 * (b2x - 2 * b1x + b0x);
      const dx = b3x - 3 * b2x + 3 * b1x - b0x;
      const ay = b0y;
      const by = 3 * (b1y - b0y);
      const cy = 3 * (b2y - 2 * b1y + b0y);
      const dy = b3y - 3 * b2y + 3 * b1y - b0y;
      const az = b0z;
      const bz = 3 * (b1z - b0z);
      const cz = 3 * (b2z - 2 * b1z + b0z);
      const dz = b3z - 3 * b2z + 3 * b1z - b0z;

      const verts = (SEG + 1) * 2;
      const pos = new Float32Array(verts * 3);
      const uv = new Float32Array(verts * 2);
      const edgePosL = new Float32Array((SEG + 1) * 3);
      const edgePosR = new Float32Array((SEG + 1) * 3);
      for (let v = 0; v <= SEG; v++) {
        const t = v / SEG;
        const px = ax + t * (bx + t * (cx + t * dx));
        const py = ay + t * (by + t * (cy + t * dy));
        const pz = az + t * (bz + t * (cz + t * dz));
        let tx = bx + t * (2 * cx + t * 3 * dx);
        let ty = by + t * (2 * cy + t * 3 * dy);
        let tz = bz + t * (2 * cz + t * 3 * dz);
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        let nx = ty * 1 - tz * 0;
        let ny = tz * 0 - tx * 1;
        let nz = 0;
        const nl = Math.sqrt(nx * nx + ny * ny) || 1;
        nx /= nl; ny /= nl;
        const w = (2.7 + (0.62 - 2.7) * Math.pow(t, 0.8)) * 0.5;
        const r = v * 6;
        pos[r] = px - nx * w; pos[r + 1] = py - ny * w; pos[r + 2] = pz - nz * w;
        pos[r + 3] = px + nx * w; pos[r + 4] = py + ny * w; pos[r + 5] = pz + nz * w;
        const ru = v * 4;
        uv[ru] = 0; uv[ru + 1] = t;
        uv[ru + 2] = 1; uv[ru + 3] = t;
        const re = v * 3;
        edgePosL[re] = px - nx * w; edgePosL[re + 1] = py - ny * w; edgePosL[re + 2] = pz;
        edgePosR[re] = px + nx * w; edgePosR[re + 1] = py + ny * w; edgePosR[re + 2] = pz;
      }
      const idx = new Uint16Array(SEG * 6);
      for (let v = 0; v < SEG; v++) {
        const a0 = v * 2;
        const o = v * 6;
        idx[o] = a0; idx[o + 1] = a0 + 1; idx[o + 2] = a0 + 2;
        idx[o + 3] = a0 + 1; idx[o + 4] = a0 + 3; idx[o + 5] = a0 + 2;
      }
      const geo = this._trackGeo(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));

      const tint = this._colA.copy(this._accent);
      tint.lerp(this._laneCols[si * 3], 0.5);
      const mat = this._trackMat(new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: tint.clone() },
          uTime: { value: 0 },
          uBoost: { value: 0 },
          uOpacity: { value: 0.85 },
        },
        vertexShader: RIBBON_VERT,
        fragmentShader: RIBBON_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 1;
      mesh.frustumCulled = false;
      this.root.add(mesh);

      const mkEdge = (arr) => {
        const eg = this._trackGeo(new THREE.BufferGeometry());
        eg.setAttribute('position', new THREE.BufferAttribute(arr.slice(), 3));
        const em = this._trackMat(new THREE.LineBasicMaterial({
          color: tint.clone().multiplyScalar(1.2),
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }));
        const line = new THREE.Line(eg, em);
        line.renderOrder = 2;
        line.frustumCulled = false;
        this.root.add(line);
        return { line, mat: em };
      };
      const eL = mkEdge(edgePosL);
      const eR = mkEdge(edgePosR);
      this._ribbons.push({ mesh, mat, edgeL: eL.line, edgeR: eR.line, edgeMat: eL.mat, edgeMatR: eR.mat });
    }
  }

  _buildPulsar() {
    this._ringGroup = new THREE.Group();
    this._ringGroup.position.set(RING_X, RING_Y, RING_Z);
    const coreGeo = this._trackGeo(new THREE.TorusGeometry(RING_R, 0.10, 12, 96));
    this._coreMat = this._trackMat(new THREE.MeshBasicMaterial({ color: this._accent.clone(), fog: false }));
    const core = new THREE.Mesh(coreGeo, this._coreMat);
    core.renderOrder = 2;
    this._ringGroup.add(core);
    const haloGeo = this._trackGeo(new THREE.TorusGeometry(RING_R, 0.26, 8, 64));
    this._haloMat = this._trackMat(new THREE.MeshBasicMaterial({
      color: this._accent.clone(),
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }));
    const halo = new THREE.Mesh(haloGeo, this._haloMat);
    halo.renderOrder = 2;
    this._ringGroup.add(halo);
    this.root.add(this._ringGroup);
  }

  _buildArcs() {
    const arcLen = Math.PI * 0.3;
    const geo = this._trackGeo(new THREE.TorusGeometry(RING_R + 0.14, 0.055, 6, 28, arcLen));
    this._arcs = [];
    for (let l = 0; l < 4; l++) {
      const mat = this._trackMat(new THREE.MeshBasicMaterial({
        color: this._laneCols[l].clone(),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(RING_X, RING_Y, RING_Z);
      mesh.rotation.z = LANE_RIM_DEG[l] * DEG - arcLen / 2;
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.root.add(mesh);
      this._arcs.push({ mesh, mat });
    }
  }

  _buildShards() {
    const geo = this._trackGeo(new THREE.OctahedronGeometry(1, 0));
    const mat = this._trackMat(new THREE.MeshBasicMaterial({ fog: false }));
    const mesh = new THREE.InstancedMesh(geo, mat, SHARD_CAP);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._colA.setRGB(1, 1, 1);
    for (let i = 0; i < SHARD_CAP; i++) mesh.setColorAt(i, this._colA);
    if (mesh.instanceColor) mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.root.add(mesh);
    this._shards = mesh;

    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 128;
    const g2 = cv.getContext('2d');
    const grad = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g2.fillStyle = grad;
    g2.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv);
    this._tex.push(tex);

    const glowMat = this._trackMat(new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }));
    const glowGeo = this._trackGeo(new THREE.PlaneGeometry(1, 1));
    const glow = new THREE.InstancedMesh(glowGeo, glowMat, SHARD_CAP);
    glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._colA.setRGB(1, 1, 1);
    for (let i = 0; i < SHARD_CAP; i++) glow.setColorAt(i, this._colA);
    if (glow.instanceColor) glow.instanceColor.setUsage(THREE.DynamicDrawUsage);
    glow.count = 0;
    glow.frustumCulled = false;
    glow.renderOrder = 2;
    this.root.add(glow);
    this._glow = glow;
  }

  _buildParticles(low) {
    const cap = this._pCap = low ? 512 : 1024;
    const pos = new Float32Array(cap * 3);
    for (let i = 0; i < cap; i++) pos[i * 3 + 1] = -9999;
    const col = new Float32Array(cap * 3);
    const fade = new Float32Array(cap);
    const geo = this._trackGeo(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aFade', new THREE.BufferAttribute(fade, 1));
    const mat = this._pMat = this._trackMat(new THREE.ShaderMaterial({
      uniforms: { uSize: { value: 9 } },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }));
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    this.root.add(pts);

    this._pPos = geo.attributes.position;
    this._pColAttr = geo.attributes.aCol;
    this._pFadeAttr = geo.attributes.aFade;
    this._pVel = new Float32Array(cap * 3);
    this._pLife = new Float32Array(cap);
    this._pMaxLife = new Float32Array(cap);
    this._pGrav = new Float32Array(cap);
    this._pHead = 0;
    this._pAlive = 0;
    this._pDirty = false;
  }

  _spawnBurst(lane, miss, spread) {
    this._bezPoint(lane, 0, this._vA);
    const n = this._burstN;
    const r = this._rng;
    const lc = this._laneCols[lane];
    for (let k = 0; k < n; k++) {
      const i = this._pHead;
      this._pHead = (i + 1) % this._pCap;
      const i3 = i * 3;
      this._pPos.array[i3] = this._vA.x + (r() - 0.5) * 0.3;
      this._pPos.array[i3 + 1] = this._vA.y + (r() - 0.5) * 0.3;
      this._pPos.array[i3 + 2] = this._vA.z;
      const u = r() * 2 - 1;
      const ph = r() * Math.PI * 2;
      const sq = Math.sqrt(Math.max(1 - u * u, 0));
      const sp = (miss ? 4 + r() * 6 : (2.2 + r() * 4.5)) * spread;
      this._pVel[i3] = sq * Math.cos(ph) * sp;
      this._pVel[i3 + 1] = (u * 0.8 + 0.5) * sp;
      this._pVel[i3 + 2] = sq * Math.sin(ph) * 0.6 * sp;
      this._pMaxLife[i] = this._pLife[i] = miss ? 0.42 + r() * 0.18 : 0.34 + r() * 0.2;
      this._pGrav[i] = miss ? 9 : 4.5;
      this._pFadeAttr.array[i] = 1;
      if (miss) {
        if (k % 3 === 0) {
          this._pColAttr.array[i3] = 1.0; this._pColAttr.array[i3 + 1] = 0.16; this._pColAttr.array[i3 + 2] = 0.13;
        } else {
          this._pColAttr.array[i3] = 0.58; this._pColAttr.array[i3 + 1] = 0.58; this._pColAttr.array[i3 + 2] = 0.62;
        }
      } else {
        this._pColAttr.array[i3] = Math.min(1, lc.r * 1.15 + 0.1);
        this._pColAttr.array[i3 + 1] = Math.min(1, lc.g * 1.15 + 0.1);
        this._pColAttr.array[i3 + 2] = Math.min(1, lc.b * 1.15 + 0.1);
      }
    }
    this._pAlive += n;
    this._pDirty = true;
    this._pPos.needsUpdate = true;
    this._pColAttr.needsUpdate = true;
    this._pFadeAttr.needsUpdate = true;
  }

  _integrateParticles(dt) {
    if (this._pAlive <= 0) {
      if (!this._pDirty) return;
      this._pDirty = false;
      return;
    }
    const drag = Math.exp(-dt * 2.4);
    const pos = this._pPos.array;
    const vel = this._pVel;
    const fade = this._pFadeAttr.array;
    for (let i = 0; i < this._pCap; i++) {
      let life = this._pLife[i];
      if (life <= 0) continue;
      life -= dt;
      const i3 = i * 3;
      if (life <= 0) {
        this._pLife[i] = 0;
        fade[i] = 0;
        pos[i3 + 1] = -9999;
        this._pAlive--;
        continue;
      }
      this._pLife[i] = life;
      vel[i3 + 1] -= this._pGrav[i] * dt;
      vel[i3] *= drag;
      vel[i3 + 1] *= drag;
      vel[i3 + 2] *= drag;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      fade[i] = life / this._pMaxLife[i];
    }
    this._pPos.needsUpdate = true;
    this._pFadeAttr.needsUpdate = true;
    this._pDirty = true;
  }

  _fireEvents(st) {
    while (this._evCount > 0 && this._evT[this._evHead] <= st) {
      const i = this._evHead;
      this._evHead = (i + 1) % EV_CAP;
      this._evCount--;
      const k = this._evK[i];
      const w = KIND_W[k];
      const v = this._evV[i];
      const imp = w * (0.3 + 0.7 * v);
      this._ringEnv = Math.min(this._ringEnv + imp, 1.8);
      this._beatEnv = Math.min(this._beatEnv + imp * 0.85, 1.5);
      this._gridEnv = Math.min(this._gridEnv + imp * (KIND_HEAVY[k] ? 0.9 : 0.4) + imp * 0.15, 1.6);
      this._ribbonEnv = Math.min(this._ribbonEnv + imp * 0.8, 1.5);
      this._kickEnv = Math.min(this._kickEnv + w * v * 3.0, 3.4);
    }
  }

  _updateNotesAndGlow(st) {
    const notes = this._notes;
    const shards = this._shards;
    const glow = this._glow;
    let n = 0;
    if (notes) {
      const total = notes.length < SHARD_CAP ? notes.length : SHARD_CAP;
      for (let i = 0; i < total; i++) {
        const note = notes[i];
        let tMs = 0, lane = 0, str = 1;
        if (Array.isArray(note)) {
          tMs = note[0]; lane = note[1] | 0;
          if (note.length > 2) str = +note[2];
        } else if (note) {
          tMs = note.tMs; lane = note.lane | 0;
          if (note.strength !== undefined) str = +note.strength;
        } else {
          continue;
        }
        if (lane < 0 || lane > 3) continue;
        let p = (tMs - st) / APPROACH_MS;
        if (p > 1) continue;
        if (p < 0) p = 0;

        this._bezPoint(lane, p, this._vA);
        this._bezTangent(lane, p, this._vB);
        this._vC.crossVectors(UP, this._vB);
        if (this._vC.lengthSq() < 1e-6) this._vC.set(1, 0, 0);
        else this._vC.normalize();
        this._vD.crossVectors(this._vB, this._vC);

        let s = (0.72 + 0.55 * (str < 0 ? 0 : str > 1.5 ? 1.5 : str));
        if (p > 0.94) {
          const k = (1 - p) / 0.06;
          s *= 0.35 + 0.65 * k;
        }
        const g = 2.2 * s;

        this._mA.makeBasis(
          this._vC.multiplyScalar(0.40 * s),
          this._vB.multiplyScalar(1.30 * s),
          this._vD.multiplyScalar(0.40 * s)
        );
        this._mA.setPosition(this._vA.x, this._vA.y, this._vA.z);
        shards.setMatrixAt(n, this._mA);

        this._mA.makeScale(g, g, g);
        this._mA.setPosition(this._vA.x, this._vA.y, this._vA.z);
        glow.setMatrixAt(n, this._mA);

        this._colA.copy(this._laneCols[lane]).multiplyScalar(0.72 + 0.55 * (1 - p));
        shards.setColorAt(n, this._colA);
        glow.setColorAt(n, this._colA);
        n++;
      }
    }
    shards.count = n;
    glow.count = n;
    shards.instanceMatrix.needsUpdate = true;
    glow.instanceMatrix.needsUpdate = true;
    if (n > 0) {
      if (shards.instanceColor) shards.instanceColor.needsUpdate = true;
      if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
    }
  }
}
