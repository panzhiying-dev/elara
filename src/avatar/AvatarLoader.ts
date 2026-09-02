import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin } from '@pixiv/three-vrm'

interface VRMUserData {
  vrm?: VRM
}

function hasVRM(value: unknown): value is VRMUserData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'vrm' in value &&
    value.vrm instanceof VRM
  )
}

/** Loads a VRM (including VRM 0.x extensions) through GLTFLoader. */
export class AvatarLoader {
  private readonly loader: GLTFLoader

  public constructor() {
    this.loader = new GLTFLoader()
    this.loader.register((parser) => new VRMLoaderPlugin(parser))
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
}

export function loadAvatar(url: string): Promise<VRM> {
  return new AvatarLoader().loadAvatar(url)
}
