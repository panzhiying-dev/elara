import * as THREE from 'three';
import { VRM, VRMUtils } from '@pixiv/three-vrm';
import { AvatarLoader } from './AvatarLoader';
import { ThreeRenderer } from '../renderer/ThreeRenderer';

export class AvatarViewer {
  private readonly three: ThreeRenderer;
  private readonly loader: AvatarLoader;
  private vrm: VRM | null = null;
  private disposed = false;

  public constructor(container: HTMLElement) {
    this.three = new ThreeRenderer(container);
    this.loader = new AvatarLoader();
    this.three.start();
  }

  public async load(url = '/models/avatar.vrm'): Promise<void> {
    try {
      const vrm = await this.loader.loadAvatar(url);
      if (this.disposed) {
        VRMUtils.deepDispose(vrm.scene);
        return;
      }

      VRMUtils.rotateVRM0(vrm);
      this.vrm = vrm;
      this.frameModel(vrm.scene);
      this.three.scene.add(vrm.scene);
    } catch {
      // AvatarLoader has already logged the concrete failure reason.
    }
  }

  private frameModel(model: THREE.Object3D): void {
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());

    model.position.x -= center.x;
    model.position.y -= bounds.min.y;
    model.position.z -= center.z;
    model.updateMatrixWorld(true);

    const framedBounds = new THREE.Box3().setFromObject(model);
    const framedSize = framedBounds.getSize(new THREE.Vector3());
    const height = Math.max(framedSize.y, 0.01);
    const width = Math.max(framedSize.x, framedSize.z, 0.01);
    const fovRadians = THREE.MathUtils.degToRad(this.three.camera.fov);
    const distance = (Math.max(height, width) / (2 * Math.tan(fovRadians / 2))) * 1.25;
    const target = new THREE.Vector3(0, height * 0.5, 0);

    this.three.camera.position.set(0, target.y, distance);
    this.three.camera.near = Math.max(distance / 100, 0.01);
    this.three.camera.far = Math.max(distance * 100, 100);
    this.three.camera.lookAt(target);
    this.three.camera.updateProjectionMatrix();

    // Keep the first calculation alive for readability when inspecting model bounds.
    void size;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.vrm) {
      this.three.scene.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
    }
    this.three.dispose();
  }
}
