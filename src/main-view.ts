import { Scene, Camera, WebGLRenderer, Vector2, Vector3, Group, AmbientLight, DirectionalLight, PerspectiveCamera, OrthographicCamera, Mesh, Object3D, PlaneGeometry, ColorManagement, LinearSRGBColorSpace, WebGLRenderTarget, SpotLight, Light, VSMShadowMap } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

import { World } from './world';
import { EffectSettings, defaultEffects, shaderEffects } from './effects';

const RATIO = 1.85; //LG Adjusted camera to new wider view port (org Ratio 1.5)

// Multisample anti-aliasing for the post-processing render targets.
const MSAA_SAMPLES = 4;

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

  private width = 0;
  private height = 0;

  private dummyObject: Object3D;

  // Lights with their normal intensity, dimmed when the lamp casts shadows.
  private lights: Array<[Light, number]> = [];
  private shadowLight: SpotLight = null!;

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
    const aoChanged = effects.ambientOcclusion !== this.effects.ambientOcclusion;
    this.effects = { ...effects };

    const shadows = effects.shadows;
    this.renderer.shadowMap.enabled = shadows;
    this.shadowLight.visible = shadows;
    this.shadowLight.castShadow = shadows;
    for (const [light, intensity] of this.lights) {
      light.intensity = shadows ? intensity * 0.45 : intensity;
    }

    if (aoChanged) {
      this.setupRendering();
    } else {
      this.updateClearColor();
    }
  }

  private updateClearColor(): void {
    // Darker room around the table when the lamp's light shaft is on.
    this.renderer.setClearColor(this.effects.lightShaft ? 0x14120e : 0x404040, 1);
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

  updateCamera(seat: number | null, lookDown: number, zoom: number, mouse2: Vector2 | null): void {
    if (this.perspective) {
      this.updatePespectiveCamera(seat === null, lookDown, zoom, mouse2);
    } else {
      this.updateOrthographicCamera(seat === null, lookDown, zoom, mouse2);
    }

    const angle = (seat ?? 0) * Math.PI * 0.5;
    this.viewGroup.rotation.set(0, 0, angle);
    this.viewGroup.updateMatrixWorld();
  }

  private updatePespectiveCamera(
    fromTop: boolean,
    lookDown: number,
    zoom: number,
    mouse2: Vector2 | null): void
  {
    if (fromTop) {
      this.camera.position.set(0, 0, 400); //Original camera location
      this.camera.rotation.set(0, 0, 0);
    } else {
      //this.camera.position.set(0, -World.WIDTH*1.44, World.WIDTH * 1.05); //Original camera location
      this.camera.position.set(0, -World.WIDTH*1.30, World.WIDTH * 0.90); //LG Adjusted camera to new wider view port
      //this.camera.rotation.set(Math.PI * 0.3 - lookDown * 0.2, 0, 0);
      this.camera.rotation.set(Math.PI * 0.3 - lookDown * 0.2 - 0.03, 0, 0); //LG Adjusted camera to center a little below the center
      if (zoom !== 0) {
        const dist = new Vector3(0, 1.37, -1).multiplyScalar(zoom * 55);
        this.camera.position.add(dist);
      }
      if (zoom > 0 && mouse2) {
        // NOTE: with multiplier larger than 0.5 it's possible to look at left
        // or right player's tiles!
        this.camera.position.x += mouse2.x * zoom * World.WIDTH * 0.5;
        this.camera.position.y += mouse2.y * zoom * World.WIDTH * 0.5;
      }
    }
  }

  private updateOrthographicCamera(
    fromTop: boolean,
    lookDown: number,
    zoom: number,
    mouse2: Vector2 | null): void
  {
    if (fromTop) {
      this.camera.position.set(0, 0, 100);
      this.camera.rotation.set(0, 0, 0);
      this.camera.scale.setScalar(1.55);
    } else {
      this.camera.position.set(
        0,
        -53 * lookDown - World.WIDTH,
        174);
      this.camera.rotation.set(Math.PI * 0.25, 0, 0);
      this.camera.scale.setScalar(1 - 0.45 * zoom);

      if (zoom > 0 && mouse2) {
        this.camera.position.x += mouse2.x * zoom * World.WIDTH * 0.6;
        this.camera.position.y += mouse2.y * zoom * World.WIDTH * 0.6;
      }
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
