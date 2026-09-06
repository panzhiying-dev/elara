import * as THREE from 'three'
import type { AvatarFeature, AvatarFeatureContext } from '../../AvatarFeature'

export interface AvatarShadowFeatureOptions {
  enabled?: boolean
  color?: string
  opacity?: number
  radius?: number
}

/** 使用径向透明渐变模拟贴地柔和阴影。 */
export class AvatarShadowFeature implements AvatarFeature {
  private readonly options: Required<AvatarShadowFeatureOptions>
  private readonly position = new THREE.Vector3()
  private readonly bounds = new THREE.Box3()
  private context: AvatarFeatureContext | null = null
  private shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null
  private texture: THREE.CanvasTexture | null = null
  private elapsedSeconds = 0
  private enabled = false

  private constructor(options: AvatarShadowFeatureOptions = {}) {
    this.options = {
      enabled: options.enabled ?? true,
      color: options.color ?? '#111827',
      opacity: options.opacity ?? 0.28,
      radius: options.radius ?? 0.55,
    }
  }

  public static create(options: AvatarShadowFeatureOptions = {}): AvatarShadowFeature {
    return new AvatarShadowFeature(options)
  }

  public init(context: AvatarFeatureContext): void {
    if (this.context) return
    this.context = context

    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const canvasContext = canvas.getContext('2d')
    if (!canvasContext) throw new Error('AvatarShadowFeature could not create a 2D canvas context.')

    const gradient = canvasContext.createRadialGradient(64, 64, 0, 64, 64, 64)
    gradient.addColorStop(0, `${this.options.color}cc`)
    gradient.addColorStop(0.45, `${this.options.color}66`)
    gradient.addColorStop(0.78, `${this.options.color}1c`)
    gradient.addColorStop(1, `${this.options.color}00`)
    canvasContext.fillStyle = gradient
    canvasContext.fillRect(0, 0, 128, 128)

    this.texture = new THREE.CanvasTexture(canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.needsUpdate = true

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        opacity: this.options.opacity,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    this.shadow.name = 'AvatarShadow'
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.y = context.groundY + 0.006
    this.shadow.scale.set(this.options.radius, this.options.radius * 0.62, 1)
    context.scene.add(this.shadow)
    this.setEnabled(this.options.enabled)
  }

  public update(deltaSeconds: number): void {
    if (!this.shadow || !this.context) return

    const avatarRoot = this.context.getAvatarRoot()
    if (!avatarRoot) {
      this.shadow.visible = false
      return
    }
    this.shadow.visible = this.enabled
    if (!this.shadow.visible) return

    this.elapsedSeconds += Math.max(deltaSeconds, 0)
    avatarRoot.getWorldPosition(this.position)
    this.bounds.setFromObject(avatarRoot)
    const heightAboveGround = Math.max(this.bounds.min.y - this.context.groundY, 0)
    const distanceFactor = THREE.MathUtils.clamp(1 - heightAboveGround * 1.5, 0.2, 1)
    const pulse = 1 + Math.sin(this.elapsedSeconds * 2.2) * 0.025

    this.shadow.position.x = this.position.x
    this.shadow.position.z = this.position.z
    this.shadow.position.y = this.context.groundY + 0.006
    this.shadow.scale.set(
      this.options.radius * distanceFactor * pulse,
      this.options.radius * 0.62 * distanceFactor * (2 - pulse),
      1,
    )
    this.shadow.material.opacity = this.options.opacity * distanceFactor
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (this.shadow) this.shadow.visible = enabled && !!this.context?.getAvatarRoot()
  }

  public dispose(): void {
    if (!this.shadow) return
    this.context?.scene.remove(this.shadow)
    this.shadow.geometry.dispose()
    this.shadow.material.dispose()
    this.texture?.dispose()
    this.shadow = null
    this.texture = null
    this.context = null
  }
}
