import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { DEFAULT_RENDERER_CONFIG } from './RendererConfig'

export interface ThreeRendererOptions {
  showGrid?: boolean
  showAxes?: boolean
}

export class ThreeRenderer {
  public readonly scene: THREE.Scene
  public readonly camera: THREE.PerspectiveCamera
  public readonly renderer: THREE.WebGLRenderer
  public readonly controls: OrbitControls
  private animationFrameId: number | null = null
  private lastFrameTime = 0
  private animationMixer: THREE.AnimationMixer | null = null
  private animationUpdater: ((deltaSeconds: number) => void) | null = null
  private animationDiagnosticAction: THREE.AnimationAction | null = null
  private animationDiagnosticsUntil = 0
  private backgroundTexture: THREE.Texture | null = null
  private backgroundImageAspect: number | null = null
  private disposed = false
  private readonly container: HTMLElement
  private readonly resizeObserver: ResizeObserver

  public constructor(
    container: HTMLElement,
    options: ThreeRendererOptions = {},
  ) {
    this.container = container
    this.scene = this.createScene()
    this.loadBackground()
    this.camera = this.createCamera()
    this.renderer = this.createRenderer()
    // this.createGround()
    this.createDebugHelpers(options)
    this.createLights()
    this.controls = this.createControls()
    this.resizeObserver = this.setupResizeObserver(container)
    this.resize()
  }

  public start(): void {
    if (this.animationFrameId !== null) return
    const render = (time: number): void => {
      this.animationFrameId = window.requestAnimationFrame(render)
      const deltaSeconds = this.calculateDelta(time)
      this.lastFrameTime = time
      this.renderFrame(deltaSeconds)
    }
    this.animationFrameId = window.requestAnimationFrame(render)
  }

  public setAnimationMixer(mixer: THREE.AnimationMixer | null): void {
    this.animationMixer = mixer
  }
  public setAnimationUpdater(
    updater: ((deltaSeconds: number) => void) | null,
  ): void {
    this.animationUpdater = updater
  }
  public getAnimationMixer(): THREE.AnimationMixer | null {
    return this.animationMixer
  }
  public startAnimationDiagnostics(
    action: THREE.AnimationAction,
    durationMs = 1000,
  ): void {
    this.animationDiagnosticAction = action
    this.animationDiagnosticsUntil = performance.now() + durationMs
  }

  public stop(): void {
    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    this.lastFrameTime = 0
  }

  public resize(): void {
    const width = this.container.clientWidth || window.innerWidth
    const height = this.container.clientHeight || window.innerHeight
    this.camera.aspect = width / Math.max(height, 1)
    this.camera.updateProjectionMatrix()
    this.resizeBackgroundTexture(width, height)
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(width, height, false)
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    this.animationMixer = null
    this.animationUpdater = null
    this.animationDiagnosticAction = null
    this.controls.dispose()
    this.resizeObserver.disconnect()
    this.scene.traverse((object) => {
      if (!('geometry' in object) || !('material' in object)) return
      const renderable = object as THREE.Mesh | THREE.Line
      renderable.geometry.dispose()
      const materials = Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material]
      materials.forEach((material) => material.dispose())
    })
    this.backgroundTexture?.dispose()
    this.backgroundTexture = null
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private createScene(): THREE.Scene {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(
      DEFAULT_RENDERER_CONFIG.scene.backgroundColor,
    )
    return scene
  }

  private loadBackground(): void {
    new THREE.TextureLoader().load(
      '/bg.png',
      (texture) => {
        if (this.disposed) {
          texture.dispose()
          return
        }
        texture.colorSpace = THREE.SRGBColorSpace
        texture.wrapS = THREE.ClampToEdgeWrapping
        texture.wrapT = THREE.ClampToEdgeWrapping
        texture.needsUpdate = true
        this.backgroundTexture = texture
        this.backgroundImageAspect = texture.image.width / texture.image.height
        this.scene.background = texture
        this.resizeBackgroundTexture(
          this.container.clientWidth || window.innerWidth,
          this.container.clientHeight || window.innerHeight,
        )
      },
      undefined,
      (error) => {
        console.error('Failed to load scene background: /bg.png', error)
      },
    )
  }

  /** 以 cover 方式裁剪背景 UV，保持图片宽高比并避免拉伸。 */
  private resizeBackgroundTexture(width: number, height: number): void {
    const texture = this.backgroundTexture
    const imageAspect = this.backgroundImageAspect
    if (!texture || !imageAspect || width <= 0 || height <= 0) return

    const viewportAspect = width / height
    texture.repeat.set(1, 1)
    texture.offset.set(0, 0)

    if (imageAspect > viewportAspect) {
      const visibleWidth = viewportAspect / imageAspect
      texture.repeat.x = visibleWidth
      texture.offset.x = (1 - visibleWidth) / 2
    } else if (imageAspect < viewportAspect) {
      const visibleHeight = imageAspect / viewportAspect
      texture.repeat.y = visibleHeight
      texture.offset.y = (1 - visibleHeight) / 2
    }
    texture.needsUpdate = true
  }

  private createCamera(): THREE.PerspectiveCamera {
    const config = DEFAULT_RENDERER_CONFIG.camera
    const camera = new THREE.PerspectiveCamera(
      config.fov,
      1,
      config.near,
      config.far,
    )
    camera.position.copy(config.position)
    return camera
  }

  private createRenderer(): THREE.WebGLRenderer {
    const config = DEFAULT_RENDERER_CONFIG.renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: config.antialias,
      alpha: config.alpha,
      preserveDrawingBuffer: config.preserveDrawingBuffer,
    })
    renderer.setPixelRatio(config.pixelRatio)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = false
    renderer.setSize(
      this.container.clientWidth || window.innerWidth,
      this.container.clientHeight || window.innerHeight,
      false,
    )
    this.container.appendChild(renderer.domElement)
    return renderer
  }

  private createGround(): void {
    const config = DEFAULT_RENDERER_CONFIG.ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(config.size, config.size),
      new THREE.MeshStandardMaterial({
        color: config.color,
        roughness: config.roughness,
        metalness: config.metalness,
      }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.name = 'Ground'
    this.scene.add(ground)
  }

  private createDebugHelpers(options: ThreeRendererOptions): void {
    const config = DEFAULT_RENDERER_CONFIG.debug
    const grid = new THREE.GridHelper(
      config.gridSize,
      config.gridDivisions,
      config.gridPrimaryColor,
      config.gridSecondaryColor,
    )
    grid.name = 'GridHelper'
    grid.visible = options.showGrid ?? config.showGrid
    this.scene.add(grid)
    const axes = new THREE.AxesHelper(config.axesSize)
    axes.name = 'AxesHelper'
    axes.visible = options.showAxes ?? config.showAxes
    this.scene.add(axes)
  }

  private createLights(): void {
    const config = DEFAULT_RENDERER_CONFIG.lighting
    this.scene.add(
      new THREE.AmbientLight(config.ambientColor, config.ambientIntensity),
    )
    this.scene.add(
      new THREE.HemisphereLight(
        config.hemisphereSkyColor,
        config.hemisphereGroundColor,
        config.hemisphereIntensity,
      ),
    )
    const keyLight = new THREE.DirectionalLight(
      config.keyColor,
      config.keyIntensity,
    )
    keyLight.name = 'KeyLight'
    keyLight.position.copy(config.keyPosition)
    this.scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(
      config.fillColor,
      config.fillIntensity,
    )
    fillLight.name = 'FillLight'
    fillLight.position.copy(config.fillPosition)
    this.scene.add(fillLight)
  }

  private createControls(): OrbitControls {
    const config = DEFAULT_RENDERER_CONFIG.controls
    const controls = new OrbitControls(this.camera, this.renderer.domElement)
    controls.enableDamping = config.enableDamping
    controls.dampingFactor = config.dampingFactor
    controls.minDistance = config.minDistance
    controls.maxDistance = config.maxDistance
    controls.minPolarAngle = config.minPolarAngle
    controls.maxPolarAngle = config.maxPolarAngle
    controls.screenSpacePanning = config.screenSpacePanning
    controls.zoomSpeed = config.zoomSpeed
    return controls
  }

  private setupResizeObserver(container: HTMLElement): ResizeObserver {
    const observer = new ResizeObserver(() => this.resize())
    observer.observe(container)
    return observer
  }

  private calculateDelta(time: number): number {
    return this.lastFrameTime === 0
      ? 0
      : Math.min((time - this.lastFrameTime) / 1000, 0.1)
  }

  private renderFrame(deltaSeconds: number): void {
    this.controls.update()
    const mixer = this.animationMixer
    const action = this.animationDiagnosticAction
    const mixerTimeBefore = mixer?.time ?? 0
    const actionTimeBefore = action?.time ?? 0
    mixer?.update(deltaSeconds)
    this.animationUpdater?.(deltaSeconds)
    this.updateDiagnostics(
      mixer,
      action,
      deltaSeconds,
      mixerTimeBefore,
      actionTimeBefore,
    )
    this.renderer.render(this.scene, this.camera)
  }

  private updateDiagnostics(
    mixer: THREE.AnimationMixer | null,
    action: THREE.AnimationAction | null,
    deltaSeconds: number,
    mixerTimeBefore: number,
    actionTimeBefore: number,
  ): void {
    if (
      !mixer ||
      !action ||
      performance.now() >= this.animationDiagnosticsUntil
    )
      return
    console.info('[AnimationDiagnostics] mixer.update', {
      deltaSeconds,
      deltaPositive: deltaSeconds > 0,
      mixer,
      mixerRoot: mixer.getRoot(),
      mixerTimeBefore,
      mixerTimeAfter: mixer.time,
      action,
      actionTimeBefore,
      actionTimeAfter: action.time,
      actionTimeIncreased: action.time !== actionTimeBefore,
    })
  }
}
