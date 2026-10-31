import { Material, Object3D, Mesh, Vector2, Group, PlaneGeometry, ShaderMaterial,
  AdditiveBlending, NormalBlending, CylinderGeometry, DoubleSide, BufferGeometry, BufferAttribute, Points, WebGLRenderer,
  Scene, Camera, Color, BoxGeometry, CanvasTexture, MeshLambertMaterial, RepeatWrapping } from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

import { Size, Place } from './types';

// Optional shader effects. All of them are off by default and can be turned
// on from the "Effects" menu.
export const EFFECT_NAMES = [
  'hoverGlow',
  'discardPulse',
  'ripple',
  'felt',
  'shadows',
  'ambientOcclusion',
  'jadeBacks',
  'lacquerTable',
  'lightShaft',
  'winter',
  'antiqueTiles',
  'colorGrade',
  'glossyTiles',
  'sharpTextures',
  'tableRim',
  'backdrop',
  'bloom',
] as const;

export type EffectName = typeof EFFECT_NAMES[number];
export type EffectSettings = Record<EffectName, boolean>;

export function defaultEffects(): EffectSettings {
  const settings = {} as EffectSettings;
  for (const name of EFFECT_NAMES) {
    settings[name] = false;
  }
  return settings;
}

// What kind of object a material belongs to; decides which effects apply.
export type MaterialKind = 'tile' | 'piece' | 'table' | 'other';

// Same as TABLE_WIDTH; not imported to avoid an import cycle.
const TABLE_WIDTH = 174;
const CENTER = (TABLE_WIDTH / 2).toFixed(1);
const RIPPLE_DURATION = 2;

// Back of the tile (and its coloured sides), see TileThingGroup.getUvChunk().
const TILE_BACK_V = (4 * 40 / 256).toFixed(4);

const NOISE_GLSL = `
float fxHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float fxHash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fxNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fxHash(i), fxHash(i + vec2(1, 0)), f.x), mix(fxHash(i + vec2(0, 1)), fxHash(i + vec2(1, 1)), f.x), f.y);
}
float fxNoise3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fxHash3(i), fxHash3(i + vec3(1, 0, 0)), f.x), mix(fxHash3(i + vec3(0, 1, 0)), fxHash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(fxHash3(i + vec3(0, 0, 1)), fxHash3(i + vec3(1, 0, 1)), f.x), mix(fxHash3(i + vec3(0, 1, 1)), fxHash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fxFbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * fxNoise(p); p *= 2.03; a *= 0.5; } return v; }
float fxFbm3(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * fxNoise3(p); p *= 2.03; a *= 0.5; } return v; }
float fxBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
`;

const VERTEX_DECL = `
varying vec3 fxWorldPos;
varying vec3 fxLocalPos;
#ifdef FX_TILE
attribute float fxSeed;
varying float vFxSeed;
#endif
`;

const VERTEX_MAIN = `
{
  vec4 fxP = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  fxP = instanceMatrix * fxP;
#endif
  fxWorldPos = (modelMatrix * fxP).xyz;
  fxLocalPos = transformed;
#ifdef FX_TILE
  vFxSeed = fxSeed;
#endif
}
`;

const FRAGMENT_DECL = `
varying vec3 fxWorldPos;
varying vec3 fxLocalPos;
#ifdef FX_TILE
varying float vFxSeed;
#endif
uniform float fxTime;
uniform float fxHover;
uniform vec2 fxRippleCenter;
uniform float fxRippleTime;
${NOISE_GLSL}
vec2 fxVoronoi(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(x, y);
    vec2 o = vec2(fxHash(i + g), fxHash(i + g + 17.3));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return vec2(d1, d2);
}
`;

// Runs after the texture is applied: changes the surface colour.
const FRAGMENT_MAP = `
#ifdef FX_FELT
{
  vec2 p = fxWorldPos.xy;
  float fib = 0.0;
  for (int i = 0; i < 4; i++) {
    float a = float(i) * 1.7;
    mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
    fib += fxNoise(r * p * vec2(6.0, 0.35));
  }
  fib /= 4.0;
  vec3 col = vec3(0.07, 0.36, 0.22) * (0.75 + 0.35 * fxFbm(p * 0.05) + 0.35 * fib);
  float d = length(p - vec2(${CENTER})) / ${CENTER};
  col *= mix(1.25, 0.55, smoothstep(0.0, 1.15, d));
  float box = max(abs(p.x - ${CENTER}), abs(p.y - ${CENTER}));
  float line = smoothstep(0.35, 0.0, abs(box - 85.0));
  float dash = step(0.45, fract((p.x + p.y) * 0.35));
  diffuseColor.rgb = mix(col, vec3(0.85, 0.7, 0.35), line * dash * 0.8);
}
#endif

#ifdef FX_JADE
if (vMapUv.y >= ${TILE_BACK_V}) {
  vec3 p = fxLocalPos * 0.35 + vFxSeed * vec3(3.1, 1.7, 2.3);
  float vein = abs(sin(p.x * 2.0 + fxFbm3(p * 1.5) * 6.0));
  vec3 jade = mix(vec3(0.02, 0.28, 0.16), vec3(0.25, 0.75, 0.5), fxFbm3(p * 0.7));
  diffuseColor.rgb = mix(jade, vec3(0.75, 0.95, 0.85), smoothstep(0.2, 0.0, vein) * 0.5);
}
#endif

#ifdef FX_ANTIQUE
{
  vec3 c = diffuseColor.rgb;
  vec3 p = fxLocalPos + vFxSeed * vec3(5.3, 2.9, 1.7);
  float white = smoothstep(0.75, 0.95, min(c.r, min(c.g, c.b)));
  vec3 ivory = mix(vec3(0.93, 0.86, 0.68), vec3(0.78, 0.66, 0.45), fxFbm3(p * 0.6) * 0.8);
  c = mix(c, ivory, white);
  vec2 v = fxVoronoi(p.xy * 1.3 + p.z * 0.7);
  c *= 1.0 - smoothstep(0.06, 0.0, v.y - v.x) * 0.35 * white;
  c = mix(c, c * vec3(0.85, 0.75, 0.6), (1.0 - white) * 0.35);
  diffuseColor.rgb = c;
}
#endif
`;

// Runs once the normal is known: can bend it, and decides snow cover.
const FRAGMENT_NORMAL = `
float fxSlope = 0.0;
float fxSnow = 0.0;

#ifdef FX_RIPPLE
if (fxRippleTime < ${RIPPLE_DURATION.toFixed(1)}) {
  vec2 dp = fxWorldPos.xy - fxRippleCenter;
  float r = length(dp) + 1e-4;
  float t = fxRippleTime;
  float env = smoothstep(t * 30.0, t * 30.0 - 8.0, r) * exp(-r * 0.045) * smoothstep(4.0, 7.0, r)
    * (1.0 - smoothstep(0.6, ${RIPPLE_DURATION.toFixed(1)}, t));
  fxSlope = cos(r * 1.1 - t * 20.0) * env;
  vec3 nW = normalize(vec3(-dp / r * fxSlope * 0.9, 1.0));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}
#endif

#ifdef FX_SNOW
{
  vec3 nW = inverseTransformDirection(normal, viewMatrix);
  fxSnow = smoothstep(0.55, 0.9, nW.z) *
    smoothstep(0.56, 0.66, fxFbm(fxWorldPos.xy * 0.18) + (fxWorldPos.z > 0.5 ? 0.15 : 0.0));
#ifdef FX_TILE
  // Keep the faces readable: snow only settles on the backs.
  if (vMapUv.y < ${TILE_BACK_V}) fxSnow = 0.0;
#endif
}
#endif
`;

// Runs on the final colour.
const FRAGMENT_END = `
#ifdef FX_RIPPLE
gl_FragColor.rgb *= 1.0 + fxSlope * 0.35;
gl_FragColor.rgb += vec3(0.7, 0.9, 0.8) * pow(max(fxSlope, 0.0), 3.0) * 0.25;
#endif

#ifdef FX_JADE
if (vMapUv.y >= ${TILE_BACK_V}) {
  vec3 n = normalize(vNormal), v = normalize(vViewPosition);
  float fres = pow(1.0 - abs(dot(n, v)), 3.0);
  vec3 l = normalize((viewMatrix * vec4(0.3, -0.5, 1.0, 0.0)).xyz);
  float spec = pow(max(dot(reflect(-l, n), v), 0.0), 40.0);
  gl_FragColor.rgb += vec3(0.1, 0.4, 0.25) * fres + spec * 0.6;
}
#endif

#ifdef FX_SNOW
{
  vec3 snowCol = vec3(0.92, 0.96, 1.0) * (0.9 + 0.1 * fxNoise(fxWorldPos.xy * 8.0));
  float glint = step(0.993, fxHash(floor(fxWorldPos.xy * 10.0)));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, snowCol + glint, fxSnow);
}
#endif

#ifdef FX_SHAFT
{
  float d = length(fxWorldPos.xy - vec2(${CENTER})) / 70.0;
  float pool = mix(1.3, 0.5, smoothstep(0.2, 1.1, d));
  gl_FragColor.rgb *= mix(1.0, pool, FX_SHAFT);
}
#endif

#ifdef FX_GLOSS
{
  // Clear lacquer on the tile: a sharp highlight from the lamp above, and a
  // soft reflection of a bright ceiling and dark room towards grazing angles.
  vec3 n = normalize(vNormal), v = normalize(vViewPosition);
  float fres = 0.04 + 0.5 * pow(1.0 - abs(dot(n, v)), 5.0);
  vec3 r = inverseTransformDirection(reflect(-v, n), viewMatrix);
  vec3 room = mix(vec3(0.15, 0.13, 0.11), vec3(1.0, 0.97, 0.9), smoothstep(-0.1, 0.8, r.z));
  vec3 l = normalize((viewMatrix * vec4(-0.3, -0.4, 1.0, 0.0)).xyz);
  float spec = pow(max(dot(reflect(-l, n), v), 0.0), 60.0);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, room, fres) + spec * 0.35;
}
#endif

#ifdef FX_HOVER
{
  float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.0);
  gl_FragColor.rgb += vec3(1.0, 0.85, 0.35) * (0.25 + 1.2 * fres) * fxHover;
}
#endif
`;

class ShaderEffects {
  settings: EffectSettings = defaultEffects();
  frame = 0;

  readonly uniforms = {
    fxTime: { value: 0 },
    fxRippleCenter: { value: new Vector2() },
    fxRippleTime: { value: 1000 },
  };

  private startTime = performance.now();
  private rippleStart = -Infinity;

  // Add the effect code to a built-in material. The effects themselves are
  // switched on with defines (see applyDefines), so that a material with all
  // effects off compiles to the same shader as before.
  patch(material: Material, kind: MaterialKind): void {
    material.userData.fxKind = kind;
    material.userData.fxHover = { value: 0 };

    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);

      Object.assign(shader.uniforms, this.uniforms);
      shader.uniforms.fxHover = material.userData.fxHover;

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_DECL}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_MAIN}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_DECL}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAGMENT_MAP}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAGMENT_NORMAL}`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${FRAGMENT_END}`);
    };
    // Different kinds share the onBeforeCompile source, so they need their
    // own cache key: https://github.com/mrdoob/three.js/issues/19377
    const previousKey = previous.toString();
    material.customProgramCacheKey = () => `fx:${kind}:${previousKey}`;

    this.applyDefines(material);
  }

  setSettings(settings: EffectSettings): void {
    this.settings = { ...settings };
  }

  // Update all patched materials under root after the settings changed.
  refresh(root: Object3D): void {
    root.traverse(obj => {
      const material = (obj as Mesh).material;
      if (material && !Array.isArray(material) && material.userData.fxKind) {
        this.applyDefines(material);
      }
    });
  }

  startRipple(x: number, y: number): void {
    this.uniforms.fxRippleCenter.value.set(x, y);
    this.rippleStart = this.now();
  }

  tick(): void {
    const now = this.now();
    this.frame++;
    this.uniforms.fxTime.value = now;
    this.uniforms.fxRippleTime.value = Math.min(now - this.rippleStart, 1000);
  }

  private now(): number {
    return (performance.now() - this.startTime) / 1000;
  }

  private applyDefines(material: Material): void {
    const kind: MaterialKind = material.userData.fxKind;
    const s = this.settings;
    const wanted: Record<string, string> = {};
    if (kind === 'tile') wanted.FX_TILE = '';
    if (s.hoverGlow && (kind === 'tile' || kind === 'piece')) wanted.FX_HOVER = '';
    if (s.felt && kind === 'table') wanted.FX_FELT = '';
    if (s.ripple && kind === 'table') wanted.FX_RIPPLE = '';
    if (s.jadeBacks && kind === 'tile') wanted.FX_JADE = '';
    if (s.antiqueTiles && kind === 'tile') wanted.FX_ANTIQUE = '';
    if (s.glossyTiles && kind === 'tile') wanted.FX_GLOSS = '';
    if (s.winter && kind !== 'other') wanted.FX_SNOW = '';
    if (s.lightShaft) wanted.FX_SHAFT = kind === 'table' ? '1.0' : '0.4';

    const defines: Record<string, any> = {};
    let changed = false;
    const current = material.defines ?? {};
    for (const key in current) {
      if (key.startsWith('FX_')) {
        changed = changed || current[key] !== wanted[key];
      } else {
        defines[key] = current[key];
      }
    }
    for (const key in wanted) {
      changed = changed || current[key] !== wanted[key];
      defines[key] = wanted[key];
    }
    if (changed || material.defines === undefined) {
      material.defines = defines;
      material.needsUpdate = true;
    }
  }
}

export const shaderEffects = new ShaderEffects();

const PLANE_VERTEX = `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

function overlayMaterial(fragmentShader: string, uniforms: Record<string, { value: any }> = {}): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { ...uniforms, fxTime: shaderEffects.uniforms.fxTime },
    vertexShader: PLANE_VERTEX,
    fragmentShader: `uniform float fxTime;\nvarying vec2 vP;\n${NOISE_GLSL}\n${fragmentShader}`,
  });
}

function makePoints(count: number, position: (i: number) => [number, number, number],
  vertexShader: string, fragmentShader: string, additive: boolean): Points {
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    data.set(position(i), 3 * i);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data, 3));
  const points = new Points(geometry, new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
    uniforms: { fxTime: shaderEffects.uniforms.fxTime },
    vertexShader: `uniform float fxTime;\n${vertexShader}`,
    fragmentShader,
  }));
  points.frustumCulled = false;
  return points;
}

// Extra objects drawn by some effects (glows, light cone, snow, lacquered table).
export class EffectObjects {
  private group: Group;
  private table: Mesh;

  private hoverGlow: Mesh;
  private discardPulse: Mesh;
  private lightShaft: Group;
  private snow: Points;
  private lacquer: Reflector | null = null;
  private rim: Group | null = null;
  private lacquerFrame = -1;

  constructor(group: Group, table: Mesh) {
    this.group = group;
    this.table = table;

    this.hoverGlow = new Mesh(new PlaneGeometry(20, 20), overlayMaterial(`
      uniform vec2 uHalf;
      void main() {
        float d = max(fxBox(vP, uHalf), 0.0);
        gl_FragColor = vec4(vec3(1.0, 0.8, 0.3) * smoothstep(5.0, 0.0, d) * 0.5, 1.0);
      }`, { uHalf: { value: new Vector2() } }));

    this.discardPulse = new Mesh(new PlaneGeometry(40, 40), overlayMaterial(`
      uniform vec2 uHalf;
      void main() {
        float d = fxBox(vP, uHalf) - 0.6;
        float a = smoothstep(1.5, 0.0, abs(d)) * 0.8;
        for (int i = 0; i < 3; i++) {
          float ph = fract(fxTime * 0.5 + float(i) / 3.0);
          a += smoothstep(0.7, 0.0, abs(d - ph * 9.0)) * (1.0 - ph);
        }
        gl_FragColor = vec4(vec3(1.0, 0.75, 0.25) * a, 1.0);
      }`, { uHalf: { value: new Vector2() } }));

    this.lightShaft = this.makeLightShaft();
    this.snow = this.makeSnow();

    for (const obj of [this.hoverGlow, this.discardPulse, this.lightShaft, this.snow]) {
      obj.visible = false;
      this.group.add(obj);
    }
  }

  update(hovered: Place | null, discard: Place | null): void {
    const s = shaderEffects.settings;

    this.place(this.hoverGlow, s.hoverGlow ? hovered : null);
    this.place(this.discardPulse, s.discardPulse ? discard : null);

    this.lightShaft.visible = s.lightShaft;
    this.snow.visible = s.winter;

    if (s.lacquerTable && this.lacquer === null) {
      this.lacquer = this.makeLacquer();
      this.group.add(this.lacquer);
    }
    if (this.lacquer !== null) {
      this.lacquer.visible = s.lacquerTable;
    }
    this.table.visible = !s.lacquerTable;

    if (s.tableRim && this.rim === null) {
      this.rim = this.makeRim();
      this.group.add(this.rim);
    }
    if (this.rim !== null) {
      this.rim.visible = s.tableRim;
    }
  }

  private makeRim(): Group {
    // Wood grain drawn once on a canvas.
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#5b3317';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let seed = 3;
    const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 120; i++) {
      ctx.strokeStyle = `rgba(${20 + rnd() * 40},${8 + rnd() * 15},0,${0.15 + rnd() * 0.3})`;
      ctx.lineWidth = 0.5 + rnd() * 2;
      const y = rnd() * canvas.height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= canvas.width; x += 32) {
        ctx.lineTo(x, y + Math.sin(x * 0.03 + i) * 3);
      }
      ctx.stroke();
    }
    const texture = new CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(2, 1);
    const material = new MeshLambertMaterial({ map: texture, color: 0xdddddd });

    const group = new Group();
    const half = (TABLE_WIDTH + Size.TILE.y) / 2;
    const width = 9, height = 7;
    const length = 2 * half + 2 * width;
    const offset = half + width / 2;
    for (let i = 0; i < 4; i++) {
      const horizontal = i < 2;
      const sign = i % 2 === 0 ? -1 : 1;
      const box = new Mesh(new BoxGeometry(horizontal ? length : width, horizontal ? width : length, height), material);
      box.position.set(
        TABLE_WIDTH / 2 + (horizontal ? 0 : sign * offset),
        TABLE_WIDTH / 2 + (horizontal ? sign * offset : 0),
        height / 2 - 1.5);
      box.castShadow = true;
      box.receiveShadow = true;
      group.add(box);
    }
    group.traverse(obj => obj.updateMatrixWorld());
    return group;
  }

  private place(obj: Mesh, place: Place | null): void {
    obj.visible = place !== null;
    if (place === null) {
      return;
    }
    const material = obj.material as ShaderMaterial;
    material.uniforms.uHalf.value.set(place.size.x / 2, place.size.y / 2);
    obj.position.set(place.position.x, place.position.y, 0.05);
    obj.updateMatrixWorld();
  }

  private makeLightShaft(): Group {
    const group = new Group();
    const height = 170;
    const bottom = 58, top = 8;

    const cone = new Mesh(new CylinderGeometry(top, bottom, height, 64, 1, true), new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: { fxTime: shaderEffects.uniforms.fxTime },
      vertexShader: `
        varying vec3 vL; varying vec3 vW; varying vec3 vN;
        void main() {
          vL = position;
          vN = normalize(mat3(modelMatrix) * normal);
          vW = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }`,
      fragmentShader: `
        uniform float fxTime;
        varying vec3 vL; varying vec3 vW; varying vec3 vN;
        ${NOISE_GLSL}
        void main() {
          float h = (vL.y + ${(height / 2).toFixed(1)}) / ${height.toFixed(1)};
          float ang = atan(vL.z, vL.x);
          float streak = 0.55 + 0.45 * fxFbm(vec2(ang * 6.0 + fxTime * 0.05, h * 1.5));
          vec3 V = normalize(cameraPosition - vW);
          float thick = pow(abs(dot(normalize(vN), V)), 1.5);
          float a = 0.22 * streak * thick * smoothstep(0.0, 0.3, h) * (0.5 + 0.5 * h);
          gl_FragColor = vec4(vec3(1.0, 0.85, 0.6) * a, 1.0);
        }`,
    }));
    cone.rotation.x = Math.PI / 2;
    cone.position.set(TABLE_WIDTH / 2, TABLE_WIDTH / 2, height / 2);
    cone.updateMatrix();
    group.add(cone);

    let seed = 1;
    const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const dust = makePoints(500, () => {
      const h = rnd() * 150;
      const r = Math.sqrt(rnd()) * (top + (bottom - top) * (1 - h / height));
      const a = rnd() * Math.PI * 2;
      return [TABLE_WIDTH / 2 + Math.cos(a) * r, TABLE_WIDTH / 2 + Math.sin(a) * r, h];
    }, `
      varying float vS;
      void main() {
        vS = fract(sin(dot(position.xy, vec2(12.9, 78.2))) * 43758.5);
        vec3 p = position;
        p.x += sin(fxTime * 0.3 + vS * 20.0) * 1.5;
        p.y += cos(fxTime * 0.25 + vS * 13.0) * 1.5;
        p.z = mod(p.z + fxTime * (0.5 + vS), 150.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (120.0 + 200.0 * vS) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`, `
      varying float vS;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * smoothstep(0.5, 0.0, d) * (0.5 + 0.8 * vS), 1.0);
      }`, true);
    group.add(dust);

    group.traverse(obj => obj.updateMatrixWorld());
    return group;
  }

  private makeSnow(): Points {
    let seed = 7;
    const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const snow = makePoints(900, () => [rnd() * 260 - 43, rnd() * 260 - 43, rnd() * 140], `
      void main() {
        float s = fract(sin(dot(position.xy, vec2(12.9, 78.2))) * 43758.5);
        vec3 p = position;
        p.z = mod(p.z - fxTime * (6.0 + 4.0 * s), 140.0);
        p.x += sin(fxTime * 0.7 + position.y) * 2.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = 260.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`, `
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(1.0, 1.0, 1.0, smoothstep(0.5, 0.1, d) * 0.85);
      }`, false);
    snow.updateMatrixWorld();
    return snow;
  }

  private makeLacquer(): Reflector {
    const size = TABLE_WIDTH + Size.TILE.y;
    const lacquer = new Reflector(new PlaneGeometry(size, size), {
      textureWidth: 1024,
      textureHeight: 1024,
      clipBias: 0.003,
      shader: {
        name: 'LacquerShader',
        uniforms: {
          color: { value: new Color(0xffffff) },
          tDiffuse: { value: null },
          textureMatrix: { value: null },
        },
        vertexShader: `
          uniform mat4 textureMatrix;
          varying vec4 vUvR;
          varying vec3 vW;
          void main() {
            vUvR = textureMatrix * vec4(position, 1.0);
            vW = (modelMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          varying vec4 vUvR;
          varying vec3 vW;
          ${NOISE_GLSL}
          void main() {
            vec2 p = vW.xy;
            float rings = fract(p.y * 0.12 + fxFbm(p * vec2(0.015, 0.12)) * 4.0 + 0.3 * sin(p.x * 0.02));
            vec3 wood = mix(vec3(0.16, 0.05, 0.03), vec3(0.32, 0.12, 0.06), smoothstep(0.2, 0.8, rings));
            vec2 uv = vUvR.xy / vUvR.w;
            vec3 refl = vec3(0.0);
            for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++)
              refl += texture2D(tDiffuse, uv + vec2(float(i), float(j)) * 0.0012).rgb;
            refl /= 25.0;
            vec3 V = normalize(cameraPosition - vW);
            float fres = 0.45 + 0.55 * pow(1.0 - V.z, 3.0);
            float d = length(p - vec2(${CENTER})) / ${CENTER};
            gl_FragColor = vec4(wood * mix(1.3, 0.6, d) * (1.0 - fres * 0.5) + refl * fres, 1.0);
          }`,
      },
    });
    lacquer.position.set(TABLE_WIDTH / 2, TABLE_WIDTH / 2, 0);
    lacquer.updateMatrixWorld();

    // The composer renders the scene several times per frame (outline,
    // ambient occlusion); render the reflection only for the first one.
    const render = lacquer.onBeforeRender;
    lacquer.onBeforeRender = (renderer: WebGLRenderer, scene: Scene, camera: Camera, ...rest: any[]) => {
      if (this.lacquerFrame === shaderEffects.frame) {
        return;
      }
      this.lacquerFrame = shaderEffects.frame;
      (render as any).call(lacquer, renderer, scene, camera, ...rest);
    };
    return lacquer;
  }
}

export function loadEffectSettings(): EffectSettings {
  const settings = defaultEffects();
  try {
    const saved = JSON.parse(localStorage.getItem('autotable.effects') ?? '{}');
    for (const name of EFFECT_NAMES) {
      settings[name] = saved[name] === true;
    }
  } catch {
    // Ignore broken or missing settings.
  }
  return settings;
}

export function saveEffectSettings(settings: EffectSettings): void {
  try {
    localStorage.setItem('autotable.effects', JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (e.g. private mode).
  }
}

