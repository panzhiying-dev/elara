import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin } from '@pixiv/three-vrm'
import {
  VRMAnimation,
  VRMAnimationLoaderPlugin,
} from '@pixiv/three-vrm-animation'

interface VRMUserData {
  vrm?: VRM
}

interface VRMAnimationUserData {
  vrmAnimations: VRMAnimation[]
}

function hasVRM(value: unknown): value is VRMUserData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'vrm' in value &&
    value.vrm instanceof VRM
  )
}

function hasVRMAnimations(value: unknown): value is VRMAnimationUserData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'vrmAnimations' in value &&
    Array.isArray(value.vrmAnimations) &&
    value.vrmAnimations.every((animation) => animation instanceof VRMAnimation)
  )
}

/** Loads a VRM (including VRM 0.x extensions) through GLTFLoader. */
export class AvatarLoader {
  private readonly loader: GLTFLoader

  public constructor() {
    this.loader = new GLTFLoader()
    this.loader.register((parser) => new VRMLoaderPlugin(parser))
    this.loader.register((parser) => new VRMAnimationLoaderPlugin(parser))
  }

  public loadAvatar(url: string): Promise<VRM> {
    console.info('Avatar loading...', url)

    return new Promise<VRM>((resolve, reject) => {
      this.loader.load(
        url,
        (gltf: GLTF) => {
          if (!hasVRM(gltf.userData)) {
            const reason =
              'The file was parsed as glTF, but no VRM extension was found.'
            console.error('Avatar loading failed', reason)
            reject(new Error(reason))
            return
          }

          console.info('Avatar loaded successfully')
          resolve(gltf.userData.vrm as VRM)
        },
        undefined,
        (error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error)
          console.error('Avatar loading failed', reason)
          reject(new Error(reason))
        },
      )
    })
  }

  /** 加载一个 VRMA 文件并返回其第一个动作。 */
  public loadAnimation(url: string): Promise<VRMAnimation> {
    console.info('VRMA loading...', url)

    return new Promise<VRMAnimation>((resolve, reject) => {
      this.loader.load(
        url,
        (gltf: GLTF) => {
          if (!hasVRMAnimations(gltf.userData)) {
            const reason = 'The file was parsed as glTF, but no VRMA animation was found.'
            console.error('VRMA loading failed', reason)
            reject(new Error(reason))
            return
          }

          const animations = gltf.userData.vrmAnimations
          if (animations.length === 0) {
            const reason = 'The VRMA file does not contain an animation clip.'
            console.error('VRMA loading failed', reason)
            reject(new Error(reason))
            return
          }

          console.info('VRMA loaded successfully')
          resolve(animations[0])
        },
        undefined,
        (error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error)
          console.error('VRMA loading failed', reason)
          reject(new Error(reason))
        },
      )
    })
  }
}

export function loadAvatar(url: string): Promise<VRM> {
  return new AvatarLoader().loadAvatar(url)
}

export function loadAnimation(url: string): Promise<VRMAnimation> {
  return new AvatarLoader().loadAnimation(url)
}
