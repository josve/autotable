import { ObjectView } from "./object-view";
import { World } from "./world";
import { Client } from "./client";
import { AssetLoader } from "./asset-loader";
import { Animation } from "./utils";
import { MouseUi } from "./mouse-ui";
import { MainView } from "./main-view";
import { Group } from "three";
import { ClientUi } from "./client-ui";
import { SoundPlayer } from "./sound-player";
import { GameUi } from './game-ui';

export class Game {
  private assetLoader: AssetLoader;
  private mainGroup: Group;
  private client: Client;
  private world: World;
  private objectView: ObjectView;
  private mainView: MainView;
  private mouseUi: MouseUi;
  private clientUi: ClientUi;
  private soundPlayer: SoundPlayer;
  private gameUi: GameUi;

  benchmark: boolean = false;

  settings: {
    perspective: HTMLInputElement;
    benchmark: HTMLInputElement;
    muted: HTMLInputElement;
    sticky: HTMLInputElement;
  };

  private lookDown = new Animation(150);
  private zoom = new Animation(150);
  private lookDownState: number = 0;
  private zoomState: number = 0;

  keys: Set<string> = new Set();

  constructor(assetLoader: AssetLoader) {
    this.assetLoader = assetLoader;
    this.mainGroup = new Group;
    this.client = new Client();
    this.objectView = new ObjectView(this.mainGroup, assetLoader, this.client);
    this.soundPlayer = new SoundPlayer(this.client);
    this.world = new World(this.objectView, this.soundPlayer, this.client);
    this.mainView = new MainView(this.mainGroup);
    this.mouseUi = new MouseUi(this.world, this.mainGroup);
    this.clientUi = new ClientUi(this.client);
    this.gameUi = new GameUi(this.client, this.world);

    this.settings = {
      perspective: document.getElementById('perspective') as HTMLInputElement,
      benchmark: document.getElementById('benchmark') as HTMLInputElement,
      muted: document.getElementById('muted') as HTMLInputElement,
      sticky: document.getElementById('sticky') as HTMLInputElement,
    };


    this.setupEvents();
  }

  private setupEvents(): void {
    window.addEventListener('keypress', this.onKeyPress.bind(this));
    window.addEventListener('keydown', this.onKeyDown.bind(this));
    window.addEventListener('keyup', this.onKeyUp.bind(this));
    for (const key in this.settings) {
      const element = (this.settings as any)[key] as HTMLInputElement;
      element.addEventListener('change', this.updateSettings.bind(this));
    }
    this.setupTouchControls();
  }

  // On-screen buttons replacing keyboard shortcuts, for touch devices
  private setupTouchControls(): void {
    const buttons: Record<string, () => void> = {
      'touch-flip': () => this.world.onFlip(1),
      'touch-flip-back': () => this.world.onFlip(-1),
      'touch-look-down': () => this.toggleLookDown(),
      'touch-zoom-in': () => this.toggleZoom(1),
      'touch-zoom-out': () => this.toggleZoom(-1),
      'touch-toggle-sidebar': () => {
        document.getElementById('sidebar')!.classList.toggle('hidden');
      },
    };
    for (const id in buttons) {
      const button = document.getElementById(id)!;
      button.addEventListener('click', buttons[id]);
    }
  }

  private toggleLookDown(): void {
    this.lookDownState = 1 - this.lookDownState;
    this.lookDown.start(this.lookDownState);
    document.getElementById('touch-look-down')!.classList.toggle('active', this.lookDownState === 1);
  }

  private toggleZoom(direction: number): void {
    this.zoomState = this.zoomState === direction ? 0 : direction;
    this.zoom.start(this.zoomState);
    document.getElementById('touch-zoom-in')!.classList.toggle('active', this.zoomState === 1);
    document.getElementById('touch-zoom-out')!.classList.toggle('active', this.zoomState === -1);
  }

  private updateSettings(): void {
    this.mainView.setPerspective(this.settings.perspective.checked);
    this.benchmark = this.settings.benchmark.checked;
    this.soundPlayer.muted = this.settings.muted.checked;
    this.mouseUi.sticky = this.settings.sticky.checked;
  }

  start(): void {
    this.clientUi.start();
    this.mainLoop();
  }

  mainLoop(): void {
    requestAnimationFrame(this.mainLoop.bind(this));

    if (this.benchmark) {
      const start = new Date().getTime();
      let end;
      do {
        this.update();
        end = new Date().getTime();
      } while (end - start < 15);
    } else {
      this.update();
    }
  }

  private update(): void {
    this.lookDown.update();
    this.zoom.update();

    this.world.updateView();
    this.mainView.updateViewport();
    this.mainView.updateCamera(this.world.seat, this.lookDown.pos, this.zoom.pos, this.mouseUi.zoomTarget());
    this.mainView.updateOutline(this.objectView.selectedObjects);
    this.mouseUi.setCamera(this.mainView.camera);
    this.mouseUi.updateObjects();
    this.mouseUi.update();
    this.mouseUi.updateCursors();
    this.mainView.render();
  }

  private onKeyPress(event: KeyboardEvent): void {
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (document.activeElement?.tagName === 'INPUT') {
      return;
    }

    if (this.keys.has(event.key)) {
      return;
    }

    this.keys.add(event.key);

    switch(event.key) {
      case 'f':
        this.world.onFlip(1);
        break;
      case 'F':
        this.world.onFlip(1, true);
        break;
      case 'r':
        this.world.onFlip(-1);
        break;
      case 'R':
        this.world.onFlip(-1, true);
        break;
      case ' ':
        this.lookDown.start(1);
        break;
      case 'z':
        this.zoom.start(1);
        break;
      case 'x':
        this.zoom.start(-1);
        break;
      case 'q':
        this.toggleLookDown();
        break;
      case 'p':
        this.settings.perspective.checked = !this.settings.perspective.checked;
        this.updateSettings();
        break;
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    this.keys.delete(event.key);

    switch(event.key) {
      case ' ':
        this.lookDown.start(0);
        break;
      case 'z':
        this.zoom.start(0);
        break;
      case 'x':
        this.zoom.start(0);
        break;
    }
  }
}
