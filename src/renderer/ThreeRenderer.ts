import * as THREE from 'three';

export class ThreeRenderer {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;

  private animationFrameId: number | null = null;
  private lastFrameTime = 0;
  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;

  public constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x202633);

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
    this.camera.position.set(0, 1.2, 3);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight, false);
    container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(1, 2, 3);
    this.scene.add(keyLight);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  public start(): void {
    if (this.animationFrameId !== null) return;

    const render = (time: number): void => {
      this.animationFrameId = window.requestAnimationFrame(render);
      this.lastFrameTime = time;
      this.renderer.render(this.scene, this.camera);
    };

    this.animationFrameId = window.requestAnimationFrame(render);
  }

  public stop(): void {
    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.lastFrameTime = 0;
  }

  public resize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(width, height, false);
  }

  public dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
