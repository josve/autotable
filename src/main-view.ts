import { Scene, Camera, WebGLRenderer, Vector2, Vector3, Group, AmbientLight, DirectionalLight, PerspectiveCamera, OrthographicCamera, Mesh, Object3D, PlaneGeometry, ColorManagement, LinearSRGBColorSpace, WebGLRenderTarget, SpotLight, Light, VSMShadowMap, CanvasTexture, Texture } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import { World } from './world';
import { EffectSettings, defaultEffects, shaderEffects } from './effects';

const RATIO = 1.85; //LG Adjusted camera to new wider view port (org Ratio 1.5)

// Multisample anti-aliasing for the post-processing render targets.
const MSAA_SAMPLES = 4;

// Final colour pass: a gentle film-like contrast curve with a little more
// saturation and warmth, and/or darkened corners.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    grade: { value: 0 },
    vignette: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float grade;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (grade > 0.5) {
        c = clamp(c, 0.0, 1.0);
        c = mix(c, c * c * (3.0 - 2.0 * c), 0.6);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, 1.15);
        c *= vec3(1.05, 1.0, 0.93);
      }
      if (vignette > 0.5) {
        vec2 d = vUv - 0.5;
        d.x *= 1.3;
        c *= mix(1.0, 0.45, smoothstep(0.35, 0.85, length(d)));
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// Depth of field for the close-up of your own tiles. The table is a tilted
// plane, so distance from the camera follows the screen height: a band around
// the hand stays sharp and everything further away (up the screen) melts into
// soft bokeh. Gathers samples on a golden-angle disc and boosts bright samples
// so highlights bloom into round discs. Also adds a cinematic vignette and
// letterbox bars.
const FocusShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0 },
    focusY: { value: 0.3 },
    focusHalf: { value: 0.1 },
    maxRadius: { value: 14 },
    resolution: { value: new Vector2(1, 1) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float amount;
    uniform float focusY;
    uniform float focusHalf;
    uniform float maxRadius;
    uniform vec2 resolution;
    varying vec2 vUv;

    const int SAMPLES = 48;

    // Circle of confusion (0..1) for a screen position.
    float coc(vec2 uv) {
      float d = uv.y - focusY;
      // Further away (above the hand) blurs strongly, the table edge in
      // front only a little.
      float far = smoothstep(focusHalf, focusHalf + 0.38, d);
      float near = smoothstep(focusHalf, focusHalf + 0.25, -d) * 0.45;
      // Slight falloff towards the sides, like a real lens.
      float side = smoothstep(0.32, 0.6, abs(uv.x - 0.5)) * 0.35;
      return clamp(max(far, near) + side, 0.0, 1.0);
    }

    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      float c = coc(vUv) * amount;
      float radius = c * maxRadius;
      vec3 color = base;

      if (radius > 0.5) {
        vec3 acc = vec3(0.0);
        float total = 0.0;
        for (int i = 0; i < SAMPLES; i++) {
          float f = (float(i) + 0.5) / float(SAMPLES);
          float r = sqrt(f) * radius;
          float a = float(i) * 2.39996323;
          vec2 uv = vUv + vec2(cos(a), sin(a)) * r / resolution;
          vec3 s = texture2D(tDiffuse, uv).rgb;
          // Don't let sharp things in focus bleed into the blurred background.
          float w = smoothstep(0.0, 0.25, coc(uv)) * 0.9 + 0.1;
          // Bright spots spread into bokeh discs.
          float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
          w *= 1.0 + 6.0 * pow(max(l - 0.55, 0.0), 1.5);
          acc += s * w;
          total += w;
        }
        color = mix(base, acc / total, smoothstep(0.5, 2.0, radius));
      }

      // Vignette.
      vec2 d = vUv - vec2(0.5, 0.45);
      d.x *= 1.4;
      color *= mix(1.0, 0.55, smoothstep(0.3, 0.9, length(d)) * amount);

      // Letterbox bars sliding in.
      float bar = 0.075 * amount;
      float edge = 1.0 / resolution.y;
      float inBar = 1.0 - smoothstep(bar - edge, bar, vUv.y) * smoothstep(bar - edge, bar, 1.0 - vUv.y);
      color = mix(color, vec3(0.0), inBar);

      gl_FragColor = vec4(color, 1.0);
    }`,
};

// Centre of your own hand, in view group coordinates (the hand slot starts at
// (46, 0) on a 174 wide table, tiles are 9 high when standing).
const HAND_CENTER = new Vector3(-2, -85, 4.5);

function smootherstep(t: number): number {
  t = Math.min(1, Math.max(0, t));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Effects that need the post-processing chain to be rebuilt.
const COMPOSER_EFFECTS = ['ambientOcclusion', 'colorGrade', 'backdrop', 'bloom'] as const;

export class MainView {
  private main: HTMLElement;
  private perspective = true;
  private antialias = true;
  private effects: EffectSettings = defaultEffects();

  private scene: Scene;
  private mainGroup: Group;
  private viewGroup: Group;
  private renderer: WebGLRenderer;

  camera: Camera = null!;
  private composer: EffectComposer = null!;
  private outlinePass: OutlinePass = null!;
  private focusPass: ShaderPass = null!;

  private width = 0;
  private height = 0;

  private dummyObject: Object3D;

  // Lights with their normal intensity, dimmed when the lamp casts shadows.
  private lights: Array<[Light, number]> = [];
  private shadowLight: SpotLight = null!;
  private backdrop: Texture | null = null;

  constructor(mainGroup: Group) {
    this.mainGroup = mainGroup;
    this.main = document.getElementById('main')!;

    this.scene = new Scene();
    this.scene.matrixWorldAutoUpdate = false;
    this.viewGroup = new Group();
    this.viewGroup.position.set(World.WIDTH/2, World.WIDTH/2, 0);
    this.scene.add(this.mainGroup);
    this.scene.add(this.viewGroup);

    this.dummyObject = new Mesh(new PlaneGeometry(0, 0, 0));

    // Keep the pre-r152 look: no color management, linear output.
    ColorManagement.enabled = false;
    this.renderer = new WebGLRenderer({ antialias: false });
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.shadowMap.type = VSMShadowMap;
    this.main.appendChild(this.renderer.domElement);

    this.setupLights();
    this.setupRendering();
  }

  private setupLights(): void {
    const ambientLight = new AmbientLight(0x888888, Math.PI);
    this.viewGroup.add(ambientLight);
    const topLight = new DirectionalLight(0x777777, Math.PI);
    topLight.position.set(0, 0, 10000);
    this.viewGroup.add(topLight);

    const frontLight = new DirectionalLight(0x222222, Math.PI);
    frontLight.position.set(0, -10000, 0);
    this.viewGroup.add(frontLight);

    const sideLight = new DirectionalLight(0x222222, Math.PI);
    sideLight.position.set(-10000, -10000, 0);
    this.viewGroup.add(sideLight);

    for (const light of [ambientLight, topLight, frontLight, sideLight]) {
      this.lights.push([light, light.intensity]);
    }

    // Warm lamp above the table, used only for the shadows effect.
    this.shadowLight = new SpotLight(0xffe2b0, 3.2, 0, 0.75, 0.7, 0);
    this.shadowLight.position.set(-50, -70, 160);
    this.shadowLight.target.position.set(0, 0, 0);
    this.shadowLight.shadow.mapSize.set(2048, 2048);
    this.shadowLight.shadow.bias = -0.0004;
    this.shadowLight.shadow.radius = 6;
    this.shadowLight.shadow.blurSamples = 16;
    this.shadowLight.shadow.camera.near = 50;
    this.shadowLight.shadow.camera.far = 400;
    this.shadowLight.visible = false;
    this.viewGroup.add(this.shadowLight, this.shadowLight.target);
  }

  setEffects(effects: EffectSettings): void {
    const composerChanged = COMPOSER_EFFECTS.some(name => effects[name] !== this.effects[name]);
    this.effects = { ...effects };

    const shadows = effects.shadows;
    this.renderer.shadowMap.enabled = shadows;
    this.shadowLight.visible = shadows;
    this.shadowLight.castShadow = shadows;
    for (const [light, intensity] of this.lights) {
      light.intensity = shadows ? intensity * 0.45 : intensity;
    }

    if (composerChanged) {
      this.setupRendering();
    } else {
      this.updateClearColor();
    }
  }

  maxAnisotropy(): number {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  private updateClearColor(): void {
    // Darker room around the table when the lamp's light shaft is on.
    this.renderer.setClearColor(this.effects.lightShaft ? 0x14120e : 0x404040, 1);
    this.scene.background = this.effects.backdrop ? this.getBackdrop() : null;
  }

  // Warm, dark room behind the table.
  private getBackdrop(): Texture {
    if (this.backdrop === null) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 512;
      const ctx = canvas.getContext('2d')!;
      const gradient = ctx.createRadialGradient(256, 300, 40, 256, 300, 420);
      gradient.addColorStop(0, '#3a2a1c');
      gradient.addColorStop(0.6, '#1d150e');
      gradient.addColorStop(1, '#070504');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      this.backdrop = new CanvasTexture(canvas);
    }
    return this.backdrop;
  }

  private setupRendering(): void {
    const w = Math.max(this.renderer.domElement.clientWidth, 1);
    const h = Math.max(this.renderer.domElement.clientHeight, 1);

    this.updateClearColor(); //LG Edit, change to a slightly lighter non-black background color

    if (this.camera !== null) {
      this.scene.remove(this.camera);
    }

    this.camera = this.makeCamera(this.perspective);
    this.viewGroup.add(this.camera);
    if (this.composer !== null) {
      for (const pass of this.composer.passes) {
        pass.dispose();
      }
      this.composer.dispose();
    }
    const renderTarget = new WebGLRenderTarget(w, h, { samples: this.antialias ? MSAA_SAMPLES : 0 });
    this.composer = new EffectComposer(this.renderer, renderTarget);
    // Passing our own render target sets the size without the pixel ratio
    this.composer.setSize(w, h);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.outlinePass = new OutlinePass(new Vector2(w, h), this.scene, this.camera);
    this.outlinePass.visibleEdgeColor.setHex(0xffff99);
    this.outlinePass.hiddenEdgeColor.setHex(0x333333);
    this.composer.addPass(renderPass);
    if (this.effects.ambientOcclusion) {
      const gtaoPass = new GTAOPass(this.scene, this.camera, w, h);
      gtaoPass.updateGtaoMaterial({ radius: 7, distanceExponent: 1, thickness: 6, scale: 2, samples: 16 });
      gtaoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      gtaoPass.blendIntensity = 2;
      this.composer.addPass(gtaoPass);
    }
    this.composer.addPass(this.outlinePass);
    if (this.effects.bloom) {
      this.composer.addPass(new UnrealBloomPass(new Vector2(w, h), 0.45, 0.5, 0.82));
    }
    this.focusPass = new ShaderPass(FocusShader);
    this.focusPass.enabled = false;
    this.focusPass.uniforms.resolution.value.set(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
    // Blur radius in pixels, relative to a 1080p high picture.
    this.focusPass.uniforms.maxRadius.value = 22 * h * this.renderer.getPixelRatio() / 1080 + 4;
    this.composer.addPass(this.focusPass);
    if (this.effects.colorGrade || this.effects.backdrop) {
      const grade = new ShaderPass(GradeShader);
      grade.uniforms.grade.value = this.effects.colorGrade ? 1 : 0;
      grade.uniforms.vignette.value = this.effects.backdrop ? 1 : 0;
      this.composer.addPass(grade);
    }

    // Force OutlinePass to precompile shadows, otherwise there is a pause when
    // you first select something.
    this.outlinePass.selectedObjects.push(this.dummyObject);
    this.composer.render();
    this.outlinePass.selectedObjects.pop();
  }

  private makeCamera(perspective: boolean): Camera {
    if (perspective) {
      //const camera = new PerspectiveCamera(30, RATIO, 0.1, 1000);
      const camera = new PerspectiveCamera(28, RATIO, 0.1, 1000); //LG Adjusted camera to new wider view port
      return camera;
    } else {
      //const w = World.WIDTH * 1.2;
      const w = World.WIDTH * 1.45; //LG Adjusted camera to new wider view port
      const h = w / RATIO;
      const camera = new OrthographicCamera(
        -w / 2, w / 2,
        h / 2, -h / 2,
        0.1, 1000);
      return camera;
    }
  }

  updateCamera(seat: number | null, lookDown: number, handView: number, zoom: number, mouse2: Vector2 | null): void {
    const fromTop = seat === null;
    const t = fromTop ? 0 : smootherstep(handView);
    if (this.perspective) {
      this.updatePespectiveCamera(fromTop, lookDown, t, zoom, mouse2);
    } else {
      this.updateOrthographicCamera(fromTop, lookDown, t, zoom, mouse2);
    }

    const angle = (seat ?? 0) * Math.PI * 0.5;
    this.viewGroup.rotation.set(0, 0, angle);
    this.viewGroup.updateMatrixWorld();

    this.updateFocus(t);
  }

  // Keep the hand in the sharp band of the depth of field.
  private updateFocus(t: number): void {
    this.focusPass.enabled = t > 0.001;
    if (!this.focusPass.enabled) {
      return;
    }
    const project = (dy: number, dz: number): number => {
      const v = HAND_CENTER.clone().add(new Vector3(0, dy, dz));
      this.viewGroup.localToWorld(v);
      v.project(this.camera);
      return v.y * 0.5 + 0.5;
    };
    const bottom = project(2, -4.5);
    const top = project(-2, 4.5);
    this.focusPass.uniforms.focusY.value = (bottom + top) / 2;
    this.focusPass.uniforms.focusHalf.value = Math.abs(top - bottom) / 2 + 0.03;
    this.focusPass.uniforms.amount.value = t;
  }

  private updatePespectiveCamera(
    fromTop: boolean,
    lookDown: number,
    handView: number,
    zoom: number,
    mouse2: Vector2 | null): void
  {
    const camera = this.camera as PerspectiveCamera;
    if (fromTop) {
      camera.position.set(0, 0, 400); //Original camera location
      camera.rotation.set(0, 0, 0);
    } else {
      //this.camera.position.set(0, -World.WIDTH*1.44, World.WIDTH * 1.05); //Original camera location
      camera.position.set(0, -World.WIDTH*1.30, World.WIDTH * 0.90); //LG Adjusted camera to new wider view port
      //this.camera.rotation.set(Math.PI * 0.3 - lookDown * 0.2, 0, 0);
      camera.rotation.set(Math.PI * 0.3 - lookDown * 0.2 - 0.03, 0, 0); //LG Adjusted camera to center a little below the center

      if (handView > 0) {
        // Swoop down to a low angle close to the hand, like a camera crane.
        const pitch = 1.13;
        const dist = 128;
        const aim = HAND_CENTER.clone().add(new Vector3(0, 14, -1.5));
        const dir = new Vector3(0, Math.sin(pitch), -Math.cos(pitch));
        const target = aim.sub(dir.multiplyScalar(dist));
        // Lift the path a little in the middle so it arcs instead of sliding.
        const arc = Math.sin(handView * Math.PI) * 10;
        camera.position.set(
          lerp(camera.position.x, target.x, handView),
          lerp(camera.position.y, target.y, handView),
          lerp(camera.position.z, target.z, handView) + arc);
        camera.rotation.x = lerp(camera.rotation.x, pitch, handView);
        // A touch of roll during the move for a hand-held feel.
        camera.rotation.z = Math.sin(handView * Math.PI) * 0.015;
      }
      const fov = lerp(28, 25, handView);
      if (camera.fov !== fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }

      if (zoom !== 0) {
        const dist = new Vector3(0, 1.37, -1).multiplyScalar(zoom * 55 * (1 - handView));
        camera.position.add(dist);
      }
      if (zoom > 0 && mouse2) {
        // NOTE: with multiplier larger than 0.5 it's possible to look at left
        // or right player's tiles!
        camera.position.x += mouse2.x * zoom * World.WIDTH * 0.5 * (1 - handView);
        camera.position.y += mouse2.y * zoom * World.WIDTH * 0.5 * (1 - handView);
      }
    }
  }

  private updateOrthographicCamera(
    fromTop: boolean,
    lookDown: number,
    handView: number,
    zoom: number,
    mouse2: Vector2 | null): void
  {
    if (fromTop) {
      this.camera.position.set(0, 0, 100);
      this.camera.rotation.set(0, 0, 0);
      this.setOrthographicScale(1.55);
    } else {
      // Camera centred on a point just above the hand, looking at 45 degrees.
      const handY = HAND_CENTER.y + 12 - (174 - HAND_CENTER.z);
      this.camera.position.set(
        0,
        lerp(-53 * lookDown - World.WIDTH, handY, handView),
        174);
      this.camera.rotation.set(Math.PI * 0.25, 0, 0);
      this.setOrthographicScale(lerp(1 - 0.45 * zoom, 0.55, handView));

      if (zoom > 0 && mouse2) {
        this.camera.position.x += mouse2.x * zoom * World.WIDTH * 0.6 * (1 - handView);
        this.camera.position.y += mouse2.y * zoom * World.WIDTH * 0.6 * (1 - handView);
      }
    }
  }

  // Camera scale is ignored by three.js for the view matrix, use zoom instead.
  private setOrthographicScale(scale: number): void {
    const camera = this.camera as OrthographicCamera;
    if (camera.zoom !== 1 / scale) {
      camera.zoom = 1 / scale;
      camera.updateProjectionMatrix();
    }
  }

  updateOutline(selectedObjects: Array<Mesh>): void {
    this.outlinePass.selectedObjects = selectedObjects;
  }

  setPerspective(perspective: boolean): void {
    this.perspective = perspective;
    this.setupRendering();
  }

  setAntialias(antialias: boolean): void {
    if (antialias === this.antialias) {
      return;
    }
    this.antialias = antialias;
    this.setupRendering();
  }

  render(): void {
    shaderEffects.tick();
    this.composer.render();
  }

  updateViewport(): void {
    if (this.main.parentElement!.clientWidth !== this.width ||
      this.main.parentElement!.clientHeight !== this.height) {

      this.width = this.main.parentElement!.clientWidth;
      this.height = this.main.parentElement!.clientHeight;

      let renderWidth: number, renderHeight: number;

      if (this.width / this.height > RATIO) {
        renderWidth = Math.floor(this.height * RATIO);
        renderHeight = Math.floor(this.height);
      } else {
        renderWidth = Math.floor(this.width);
        renderHeight = Math.floor(this.width / RATIO);
      }
      // Odd dimensions make Chrome render a blurry picture.
      renderWidth -= renderWidth % 2;
      renderHeight -= renderHeight % 2;

      this.main.style.width = `${renderWidth}px`;
      this.main.style.height = `${renderHeight}px`;
      this.renderer.setSize(renderWidth, renderHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));

      this.setupRendering();
    }
  }
}
