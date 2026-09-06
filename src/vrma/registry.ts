import type { AvatarAnimationDefinition, AvatarAnimationName } from './types'

/**
 * Vite 在构建期自动收集 src/vrma 目录下的全部 VRMA 文件。
 *
 * 新增 .vrma 文件后无需手动修改资源导入代码，
 * 只需要在 KNOWN_METADATA 中补充语义信息即可。
 */
const ANIMATION_ASSETS = import.meta.glob('./*.vrma', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/**
 * VRMA 动作的静态元数据。
 *
 * 用于描述动作的稳定 ID、展示名称、分类、循环方式以及审核状态。
 */
interface AnimationMetadata {
  /** 对外暴露的稳定动作 ID。 */
  id: AvatarAnimationName

  /** 动作展示名称。 */
  name: string

  /** 动作所属分类。 */
  category: AvatarAnimationDefinition['category']

  /** 动作默认是否循环播放。 */
  loop: boolean

  /**
   * 动作在 Elara Runtime 中的语义审核状态。
   *
   * verified：
   * 已经确认动作语义以及运行时行为。
   *
   * pending-review：
   * 已注册，但尚未完成完整运行时验证。
   */
  reviewStatus: AvatarAnimationDefinition['reviewStatus']
}

/**
 * 已知 VRMA 文件的语义元数据。
 *
 * 这里负责建立：
 *
 *   VRMA 文件名 → Elara 动作 ID / 分类 / 播放策略
 *
 * 未登记的新 VRMA 文件不会导致注册失败，
 * 而是由下面的 fallback 逻辑自动注册为 unknown。
 */
const KNOWN_METADATA: Record<string, AnimationMetadata> = {
  /**
   * =========================
   * 基础状态
   * =========================
   */

  /** 默认站立待机动作。 */
  'Idle.vrma': {
    id: 'idle',
    name: 'Idle',
    category: 'base',
    loop: true,
    reviewStatus: 'verified',
  },

  /** Utsuwa 风格的自然待机动作池；由 Viewer 低频随机轮换。 */
  'UtsuwaIdle.vrma': {
    id: 'idleUtsuwa1',
    name: 'Natural Idle 1',
    category: 'base',
    loop: true,
    reviewStatus: 'verified',
  },
  'UtsuwaIdle2.vrma': {
    id: 'idleUtsuwa2',
    name: 'Natural Idle 2',
    category: 'base',
    loop: true,
    reviewStatus: 'verified',
  },
  'UtsuwaIdle3.vrma': {
    id: 'idleUtsuwa3',
    name: 'Natural Idle 3',
    category: 'base',
    loop: true,
    reviewStatus: 'verified',
  },
  'UtsuwaIdle4.vrma': {
    id: 'idleUtsuwa4',
    name: 'Natural Idle 4',
    category: 'base',
    loop: true,
    reviewStatus: 'verified',
  },
  'UtsuwaIdle5.vrma': {
    id: 'idleUtsuwa5',
    name: 'Natural Idle 5',
    category: 'base',
    loop: true,
    reviewStatus: 'verified',
  },

  /** Utsuwa 的说话身体循环；口型仍由 Elara LipSyncPlayer 驱动。 */
  'UtsuwaTalking.vrma': {
    id: 'talking',
    name: 'Talking',
    category: 'base',
    loop: true,
    reviewStatus: 'verified',
  },

  /** 跪姿待机动作。 */
  'KneelingIdle.vrma': {
    id: 'KneelingIdle',
    name: 'Kneeling Idle',
    category: 'base',
    loop: true,
    reviewStatus: 'verified',
  },

  /**
   * =========================
   * 转向
   * =========================
   */

  /** 普通转身动作。 */
  'Turn.vrma': {
    id: 'turn',
    name: 'Turn',
    category: 'turning',
    loop: false,
    reviewStatus: 'verified',
  },

  /** 向左转身动作。 */
  'TurnLeft.vrma': {
    id: 'turnLeft',
    name: 'Turn Left',
    category: 'turning',
    loop: false,
    reviewStatus: 'verified',
  },

  /** 向右转身动作。 */
  'TurnRight.vrma': {
    id: 'turnRight',
    name: 'Turn Right',
    category: 'turning',
    loop: false,
    reviewStatus: 'verified',
  },

  /**
   * =========================
   * 移动
   * =========================
   */

  /** 向前行走一次。 */
  'WalkForward.vrma': {
    id: 'walkForward',
    name: 'Walk Forward',
    category: 'movement',
    loop: false,
    reviewStatus: 'verified',
  },

  /** 向左转 90 度并移动。 */
  'WalkTurnLeft90.vrma': {
    id: 'walkTurnLeft90',
    name: 'Walk Turn Left 90°',
    category: 'movement',
    loop: false,
    reviewStatus: 'verified',
  },

  /** 循环行走动作。 */
  'walk.vrma': {
    id: 'walkLoop',
    name: 'Walk Loop',
    category: 'movement',
    loop: true,
    reviewStatus: 'verified',
  },

  /**
   * =========================
   * 情绪
   * =========================
   */

  /** 悲伤状态待机动作。 */
  'SadIdle.vrma': {
    id: 'SadIdle',
    name: 'Sad Idle',
    category: 'emotion',
    loop: true,
    reviewStatus: 'verified',
  },

  /** 思考动作。 */
  'Thinking.vrma': {
    id: 'thinking',
    name: 'Thinking',
    category: 'emotion',
    loop: false,
    reviewStatus: 'pending-review',
  },

  /**
   * =========================
   * 用户回应
   * =========================
   */

  /** 打招呼 / 挥手动作。 */
  'VRMA_02.vrma': {
    id: 'greeting',
    name: '打招呼',
    category: 'response',
    loop: false,
    reviewStatus: 'pending-review',
  },

  /** 比耶动作。 */
  'VRMA_03.vrma': {
    id: 'peaceSign',
    name: '比耶',
    category: 'response',
    loop: false,
    reviewStatus: 'pending-review',
  },

  /** 鼓掌动作。 */
  'Clapping.vrma': {
    id: 'clapping',
    name: 'Clapping',
    category: 'response',
    loop: false,
    reviewStatus: 'pending-review',
  },

  /** 点头表示肯定。 */
  'Head Nod Yes.vrma': {
    id: 'nodYes',
    name: 'Nod Yes',
    category: 'response',
    loop: false,
    reviewStatus: 'pending-review',
  },

  /** 带讽刺意味的点头。 */
  'Sarcastic Head Nod.vrma': {
    id: 'sarcasticNod',
    name: 'Sarcastic Nod',
    category: 'response',
    loop: false,
    reviewStatus: 'pending-review',
  },

  /** 摇头表示否定。 */
  'Shaking Head No.vrma': {
    id: 'shakeHeadNo',
    name: 'Shake Head No',
    category: 'response',
    loop: false,
    reviewStatus: 'pending-review',
  },

  /** 耸肩动作。 */
  'Shrugging.vrma': {
    id: 'shrug',
    name: 'Shrug',
    category: 'response',
    loop: false,
    reviewStatus: 'pending-review',
  },

  /**
   * =========================
   * 一次性动作
   * =========================
   */

  /** 全身展示动作。 */
  'VRMA_01.vrma': {
    id: 'showFullBody',
    name: '全身展示',
    category: 'pose',
    loop: false,
    reviewStatus: 'pending-review',
  },

  /** 射击动作。 */
  'VRMA_04.vrma': {
    id: 'shoot',
    name: '射击',
    category: 'action',
    loop: false,
    reviewStatus: 'pending-review',
  },

  /** 旋转动作。 */
  'VRMA_05.vrma': {
    id: 'spin',
    name: '旋转',
    category: 'action',
    loop: false,
    reviewStatus: 'pending-review',
  },

  /** 模特展示姿势。 */
  'VRMA_06.vrma': {
    id: 'modelPose',
    name: '模特姿势',
    category: 'pose',
    loop: false,
    reviewStatus: 'pending-review',
  },

  /** 下蹲动作。 */
  'VRMA_07.vrma': {
    id: 'squat',
    name: '下蹲',
    category: 'action',
    loop: false,
    reviewStatus: 'pending-review',
  },

  /**
   * =========================
   * 舞蹈
   * =========================
   */

  /** Samba 舞蹈。 */
  'SambaDancing.vrma': {
    id: 'SambaDancing',
    name: 'Samba Dancing',
    category: 'dance',
    loop: true,
    reviewStatus: 'pending-review',
  },

  /** Hip Hop 手臂舞蹈。 */
  'ArmsHipHopDance.vrma': {
    id: 'ArmsHipHopDance',
    name: 'Arms Hip Hop Dance',
    category: 'dance',
    loop: true,
    reviewStatus: 'pending-review',
  },

  /** Hip Hop 舞蹈。 */
  'HipHopDancing.vrma': {
    id: 'HipHopDancing',
    name: 'Hip Hop Dancing',
    category: 'dance',
    loop: true,
    reviewStatus: 'pending-review',
  },

  /** Hip Hop 踏步舞蹈。 */
  'StepHipHopDance.vrma': {
    id: 'StepHipHopDance',
    name: 'Step Hip Hop Dance',
    category: 'dance',
    loop: true,
    reviewStatus: 'pending-review',
  },

  /** Hip Hop 手部动作舞蹈。 */
  'TutHipHopDance.vrma': {
    id: 'TutHipHopDance',
    name: 'Tut Hip Hop Dance',
    category: 'dance',
    loop: true,
    reviewStatus: 'pending-review',
  },

  /** Hip Hop 舞蹈变体。 */
  'Hip Hop Dancing (1).vrma': {
    id: 'hipHopDancingVariant',
    name: 'Hip Hop Dancing Variant',
    category: 'dance',
    loop: true,
    reviewStatus: 'pending-review',
  },
}

/**
 * 将 VRMA 文件路径转换为稳定、可读的动作 ID。
 *
 * 例如：
 *
 *   Cute Wave.vrma
 *   → cuteWave
 *
 *   happy-dance.vrma
 *   → happyDance
 */
function getFallbackId(path: string): string {
  const fileName = path.split('/').pop() ?? path

  return fileName
    .replace(/\.vrma$/i, '')
    .replace(/[^a-zA-Z0-9]+(.)/g, (_match, character: string) =>
      character.toUpperCase(),
    )
    .replace(/^[A-Z]/, (character) => character.toLowerCase())
}

/**
 * 将 VRMA 文件名转换成默认展示名称。
 *
 * 例如：
 *
 *   Cute-Wave.vrma
 *   → Cute Wave
 *
 *   happy_dance.vrma
 *   → happy dance
 */
function getFallbackName(path: string): string {
  const fileName = path.split('/').pop() ?? path

  return fileName.replace(/\.vrma$/i, '').replace(/[-_]+/g, ' ')
}

/**
 * VRMA 资源唯一注册表。
 *
 * Vite 会自动发现 src/vrma 下新增的 VRMA 文件。
 *
 * 已知文件：
 *   使用 KNOWN_METADATA 中的正式定义。
 *
 * 未知文件：
 *   自动生成 fallback ID 和名称，
 *   分类为 unknown，
 *   审核状态为 pending-review。
 *
 * 因此新增 VRMA 文件不会要求立即修改注册表代码，
 * 但正式进入 Elara 动作系统前仍应该补充语义 metadata。
 */
export const ANIMATION_REGISTRY: readonly AvatarAnimationDefinition[] =
  Object.entries(ANIMATION_ASSETS)
    .map(([path, url]) => {
      const fileName = path.split('/').pop() ?? path
      const metadata = KNOWN_METADATA[fileName]

      /**
       * 已知动作直接使用人工定义的语义 metadata。
       */
      if (metadata) {
        return {
          ...metadata,
          url,
          source: fileName,
        }
      }

      /**
       * 未知动作作为安全兜底自动注册。
       *
       * unknown 不代表动作无效，
       * 只代表当前还没有完成语义登记。
       */
      return {
        id: getFallbackId(path),
        name: getFallbackName(path),
        url,
        source: fileName,
        category: 'unknown' as const,
        loop: false,
        reviewStatus: 'pending-review' as const,
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))

/**
 * 按动作 ID 建立 O(1) 查询索引。
 *
 * 避免业务层每次查询动作时遍历整个注册表。
 */
const ANIMATION_BY_ID = new Map(
  ANIMATION_REGISTRY.map((definition) => [definition.id, definition]),
)

/**
 * 返回当前构建中发现的全部 VRMA 动作。
 *
 * 返回值为只读数组，避免业务层直接修改全局注册表。
 */
export function listAnimations(): readonly AvatarAnimationDefinition[] {
  return ANIMATION_REGISTRY
}

/**
 * 按动作 ID 查询 VRMA 注册信息。
 *
 * @param id 要查询的动作 ID。
 * @returns 对应的动作定义；不存在时返回 undefined。
 */
export function getAnimationDefinition(
  id: string,
): AvatarAnimationDefinition | undefined {
  return ANIMATION_BY_ID.get(id)
}
