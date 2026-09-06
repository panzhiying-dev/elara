# Utsuwa × Elara 源码架构研究

## 1. 研究范围与方法

研究对象：

- Utsuwa：/Users/panzhiying/Desktop/pull-github/utsuwa-main
- Elara：/Users/panzhiying/Desktop/github/Elara

本报告仅基于源码进行只读研究，追踪入口、实例化关系、调用链、状态流、事件流、Three.js/VRM/Web Audio 生命周期，以及模型切换和异步竞态。本次没有修改任何源码、配置或依赖。

说明：Elara 工作区在研究开始前已存在未提交改动，本报告没有修改这些改动。

## 2. Utsuwa 项目整体理解

### 2.1 类型与技术栈

Utsuwa 是 SvelteKit + Tauri 的 AI 数字人陪伴桌面应用，而非单纯 VRM Viewer。它包含 VRM Avatar、LLM 对话、多 TTS/STT Provider、语义记忆、角色关系状态、事件系统、Photo Mode、AR/XR、多窗口 Overlay 和本地持久化。

证据：utsuwa-main/package.json

- Svelte 5 / SvelteKit
- Tauri 2
- Three.js、Threlte、@pixiv/three-vrm
- @pixiv/three-vrm-animation
- Web Audio API
- Dexie / localforage

主要入口：

- src/routes/+layout.svelte
- src/routes/app/+layout.svelte
- src/routes/app/+page.svelte

app/+page.svelte 是产品组合页面，组合 VrmScene、Chat、Speech Bubble、Event Scene、Photo Mode、Memory Graph、Onboarding 和 Reminder。

### 2.2 状态边界

主要 Store：

- vrmStore：模型、VRM 引用、动作信号、Talking、触摸反应、头部位置、缩略图
- ttsStore：TTS 队列、播放状态、当前 AnalyserNode
- chatStore：聊天消息、加载和错误
- characterStore：情绪、能量、关系数值、时间衰减、事件标记
- modulesStore：Provider 模块注册、启用状态和设置
- displayStore / photomodeStore：显示和摄影状态

这些 Store 按业务域拆分，但 vrmStore 同时承担模型资源状态和动画/反应信号，并非纯粹的模型状态容器。

## 3. Elara 项目整体理解

### 3.1 类型与技术栈

Elara 是 React + Vite + Three.js 的 Avatar Viewer / AI 对话前端，包含 VRM/GLB Avatar、VRMA 动作、表情和情绪、Lip Sync、SSE 流式对话、TTS、Camera Mode、模型切换、屏幕录制和拍照。

入口：

- src/main.tsx：React root
- src/app/App.tsx：UI、Avatar、对话和 Camera 组合

### 3.2 已存在的 Avatar Runtime

Elara 已经有一个实际 Avatar Runtime，核心对象是 AvatarViewer，而不是需要重新创建另一套 Runtime。

AvatarViewer 持有：

- ThreeRenderer
- AvatarLoader
- AnimationManager
- ModelManager
- ModelTransitionController
- AvatarFeatureManager
- AvatarExpressionFeature
- 当前 VRM 和 Mixer
- LipSyncPlayer

## 4. Utsuwa 数字人实际运行机制

### 4.1 真实调用链

    用户输入
      ↓
    app/+page.svelte handleSend()
      ↓
    sendCompanionMessage()
      ↓
    LLM 流式响应
      ├─ chatStore.updateLastMessage()
      ├─ processCompanionTurn()
      │   ├─ parseResponse()
      │   ├─ characterStore.applyUpdates()
      │   ├─ memoryApi
      │   └─ eventsApi
      ├─ vrmStore.startTalking()
      └─ ttsStore.speak()
           ↓
    VoiceOrchestrator
      ├─ 分句
      ├─ TTS 预取
      ├─ 并发限制
      ├─ Web Audio 播放
      └─ AnalyserNode
           ↓
    VrmModel.svelte useTask()
      ├─ mixer.update()
      ├─ Tap Reaction
      ├─ Camera Jiggle
      ├─ vrm.update()
      ├─ Blink
      ├─ Expression
      └─ Lip Sync

### 4.2 数字人核心对象

证据：src/lib/components/vrm/VrmModel.svelte

该组件同时持有：

- 当前 VRM 和 AnimationMixer
- Idle / Talking / Emote / Pose Action
- 眨眼、表情、Tap Reaction、Camera Tracking、Spring Bone 状态
- Lip Sync 分析器
- 模型加载和销毁逻辑

因此 Utsuwa 的实际结构是：

> 以 Svelte 组件承载生命周期，以 Threlte useTask 作为统一每帧协调点的组件型运行时。

源码没有证据表明它使用了独立 AvatarRuntime 类，也不能把它描述成完整 ECS 或传统 MVC。

### 4.3 VRM 生命周期

VrmModel.svelte 的 URL effect：

1. 创建 GLTFLoader 并注册 VRMLoaderPlugin
2. 异步加载 VRM
3. 使用 cancelled 标记淘汰旧加载
4. 优化顶点和骨骼
5. 规范化方向和位置
6. 设置自然 Idle Pose
7. 保存 Spring Bone 基准值
8. 创建 AnimationMixer
9. 写入 vrmStore
10. 启动 Idle 并预加载 Talking

销毁时清理 timeout、停止 Action、释放 Mixer、调用 VRMUtils.deepDispose(vrm.scene)，并清空 Pose/Reaction/表情状态。

### 4.4 动画与行为

Idle 使用多个 VRMA，随机选择、避免连续重复，并在 Talking、Emote、Photo Mode 时推迟切换。

Talking 判断：

    const shouldTalk = $derived(ttsStore.isSpeaking || vrmStore.isTalking)

vrmStore.startTalking(text) 还会按文本长度估算 Talking 时长。这是兼容性方案，但不是精确音频同步。

Emote 由 currentAnimation 变化触发，异步加载 VRMA、淡出 Idle、播放 LoopOnce、监听 finished，完成后恢复 Idle。

Photo Pose 将 Action 暂停在 manifest 指定时刻，避免许多 VRMA 第 0 帧都是中性姿势。

### 4.5 每帧更新顺序

证据：VrmModel.svelte:877-1126

    撤销上一帧 Tap 偏移
      ↓
    AnimationMixer.update()
      ↓
    应用 Tap Reaction
      ↓
    计算 Camera Jiggle
      ↓
    Head Tracking
      ↓
    临时影响胸部/头部
      ↓
    vrm.update()
      ↓
    恢复骨骼主体位置
      ↓
    更新头部屏幕坐标
      ↓
    Blink
      ↓
    ExpressionManager.update()
      ↓
    LipSyncAnalyzer.update()

该顺序保证动画、Spring Bone、表情和 Lip Sync 在同一帧内协调。

### 4.6 Tap Reaction

Scene.svelte 负责 Raycast 和触摸区域判定；VrmModel.svelte 根据关系阶段选择反应规格，然后叠加表情脉冲和骨骼旋转脉冲。脉冲使用衰减曲线，多脉冲可叠加，下一帧撤销上一帧偏移，避免旋转累积。

其抽象是：

    触摸区域 → 关系阶段反应策略 → 表情脉冲 + 骨骼脉冲

### 4.7 Lip Sync

证据：src/lib/services/lipsync/analyzer.ts

Utsuwa 使用 AnalyserNode 读取频谱，将频率带映射到 aa/ee/ih/oh/ou，并用 attack/release 平滑写回 VRM。它是实时估算方案，延迟低，但音素精度低于后端时间轴。

## 5. Utsuwa 隐含的核心架构

Utsuwa 实际由三种机制叠加：

1. 响应式状态驱动：Svelte Rune Store 变化触发 effect。
2. 异步事件驱动：LLM、TTS、动画 finished、提醒和事件回调推动状态变化。
3. 统一帧循环驱动：useTask 每帧执行骨骼、物理、表情和 Lip Sync。

抽象为：

    业务/外部事件
      ↓
    Store 或 Callback
      ↓
    表现意图
      ↓
    VrmModel effect / useTask
      ↓
    VRM 与 Three.js

### VoiceOrchestrator 的核心价值

证据：src/lib/services/voice-orchestrator.ts

核心接口：

    beginSession()
    pushSegment()
    endSession()
    interrupt()

pushSegment 会立即开始合成下一句，播放当前句时预取后续句子；Semaphore 限制并发；AbortController 取消过期会话；Streaming Provider 使用 Web Audio 精确排程。

其目标是避免：

    下载 N → 播放 N → 下载 N+1 → 播放 N+1

造成的句间停顿。

SpeechSegment 预留 emotion、action、language、speed、pitch、volume、voiceId 等字段，VoiceOrchestrator 也定义 onEmotionChange、onAction、onSegmentStart。不过源码搜索显示，主聊天链路当前实际绑定的主要是 onAnalyserUpdate。因此不能断言 Utsuwa 已经完成了 LLM → 情绪 → 动作 → Avatar 的完整闭环。

## 6. Elara 当前数字人架构

### 6.1 ThreeRenderer 更新循环

证据：src/renderer/ThreeRenderer.ts

    requestAnimationFrame
      ↓
    controls.update()
      ↓
    mixer.update(delta)
      ↓
    animationUpdater(delta)
      ├─ vrm.update(delta)
      ├─ LipSyncPlayer.update(audioTime)
      ├─ expression.setLipSyncWeights()
      └─ features.update(delta)
      ↓
    renderer.render()

这是比 Utsuwa 更明确的统一渲染循环。

### 6.2 ModelManager

证据：src/avatar/managers/ModelManager.ts

负责 Registry 查询、异步加载、场景挂载、模型卸载、VRMUtils.deepDispose，以及 idle/loading/ready/disposing/error 生命周期。

### 6.3 ModelTransitionController

证据：src/avatar/transition/ModelTransitionController.ts

明确编排：

    ready → exiting → unload → loading → entering → ready

它还处理重复切换请求复用当前 Promise、加载失败后的旧模型恢复、状态通知和切换期间的并发限制。

### 6.4 AnimationManager

证据：src/avatar/managers/AnimationManager.ts

负责 VRMA 缓存、Clip/Action 创建、淡入淡出、Loop、Root Translation 清理、动作生命周期、异步播放竞态和 Action/Clip 回收。

playRequestId 和 pendingPlayRequestId 防止旧动作加载结果抢占新动作。

### 6.5 表现层 Resolver

证据：src/avatar/features/expression/AvatarPresentationController.ts

Elara 将表现拆为 Motion、Explicit Emotion、Motion Default Emotion、Blink、Mouth、Lip Sync、Micro Expression、Action Expression 和 Explorer Manual Expression，最后统一计算 resolvedExpressions，只有权重变化时才写入 VRM。

这是 Elara 当前明显优于 Utsuwa 的部分。

### 6.6 对话、音频和 Lip Sync

主要模块：

- src/runtime/conversation/ConversationRuntime.ts
- src/audio/AvatarAudioManager.ts
- src/audio/AudioScheduler.ts
- src/lipsync/LipSyncPlayer.ts

Elara 已经具备：

- SSE 事件流
- generationId
- Abort/取消
- Audio 任务优先级
- generation 失效
- Chunk 顺序播放
- 真实音频时间驱动 Lip Sync
- 音频结束后恢复 Idle

LipSyncPlayer 不拥有音频、Timer、RAF 或渲染循环，只根据外部音频时间读取时间轴。这种边界清晰、确定性高、易于测试。

## 7. 两者架构差异

| 维度 | Utsuwa | Elara |
|---|---|---|
| 产品定位 | 完整 AI 陪伴应用 | Avatar + 对话前端 |
| UI | SvelteKit | React + Vite |
| VRM 生命周期 | 组件 effect 管理 | ModelManager |
| 动画管理 | 集中在 VrmModel | AnimationManager |
| 表情管理 | 多处直接写权重 | Presentation Resolver |
| 每帧循环 | VrmModel useTask | ThreeRenderer 统一 RAF |
| TTS | VoiceOrchestrator | AudioScheduler + 后端音频 Chunk |
| Lip Sync | 实时频谱分析 | 后端时间轴驱动 |
| 模型切换 | URL effect + cleanup | Transition Controller |
| 状态 | 多个业务 Store | Avatar Store + assistant-ui |
| 业务状态 | 关系、记忆、事件丰富 | 相对轻量 |
| Runtime 边界 | 隐式存在于组件 | AvatarViewer 显式存在 |
| 动画资源 | URL 和组件逻辑较紧 | Registry + Policy |
| 测试友好度 | 组件耦合较高 | Runtime 类边界更适合单测 |

最大的区别是：Utsuwa 把大量 Avatar 逻辑放在一个组件中；Elara 已经把模型、动画、表现、音频和渲染拆成可管理对象。

## 8. Utsuwa 值得借鉴的设计

### 8.1 P0：TTS 分句预取与连续播放

Utsuwa 在 VoiceOrchestrator.pushSegment 时立即启动后续合成，并限制并发。它解决句间停顿、网络抖动和首句等待问题。

Elara 已有 AudioScheduler、流式 Chunk、generation 取消，但前端预取策略不如 Utsuwa 明确。

建议：基于现有 AudioScheduler 增加 TTS Segment Queue 和后续分段预取，不复制 Utsuwa 的组件实现。成本中等。

### 8.2 P0：generation 贯穿异步表现

Utsuwa 使用 AbortController、Pipeline session 和 interrupt；Elara 已使用 generationId、activeGeneration 和 cancelGeneration，实际上更明确。

建议将 generation 继续扩展到 Conversation、Audio、Lip Sync、Gesture、Emotion、Animation 和 UI 回调。

### 8.3 P0：统一表现层 Resolver

Utsuwa 的多处直接 setValue 说明集中解析的必要性；Elara 的 AvatarPresentationController 已经更成熟。

建议扩展现有 Resolver，而不是新增直接写 VRM 的模块。可统一使用：

    PresentationIntent {
      emotion?
      motion?
      mouth?
      lipSync?
      blink?
      gesture?
      priority?
      generationId?
    }

### 8.4 P1：Provider capability 驱动语音策略

Utsuwa Provider 暴露 streaming、emotion、multilingual、maxConcurrentSynthesis、clientSideSpeed 等能力，编排器根据能力选择策略。

Elara 可逐步建立 VoiceCapabilities：

    supportsStreaming
    supportsLipSync
    supportsEmotion
    supportsChunkPrefetch

### 8.5 P1：Registry + Policy

Elara 的 src/vrma/registry.ts 与 src/avatar/policies/AnimationPolicy.ts 已比 Utsuwa 更清晰：

- Registry 描述资源和元数据
- Policy 决定场景是否允许
- UI 与 Runtime 共享注册信息
- world、unknown、未审核动作可被拦截

不应改回 Utsuwa 的散落 URL 模式。

### 8.6 P1：模型能力 Profile

Elara 已能枚举真实绑定 Expression。未来可扩展 AvatarCapabilities：

    expressions
    mouthExpressions
    blinkExpressions
    humanoidBones
    springBones
    supportedAnimations

### 8.7 P2：Camera 驱动 Spring Bone 反馈

Utsuwa 的 Camera Jiggle 通过相机角速度影响胸部/头部，再让 vrm.update 的 Spring Bone 求解器产生自然摆动。建议未来实现为独立 PhysicsFeature。

### 8.8 P2：交互反应脉冲模型

Utsuwa 的“区域 → 策略 → 表情/骨骼脉冲”适合未来的点击、触摸、语音回应、情绪反馈和视线互动。

### 8.9 P2：模型 Blob 和缩略图持久化

Utsuwa 使用 localforage 保存 VRM Blob 和缩略图。Elara 支持用户上传 Avatar 或模型库时可以借鉴。

### 8.10 P3：跨窗口同步

Utsuwa 通过 Tauri event、storage 和 BroadcastChannel 支持主窗口/Overlay。除非 Elara 进入桌面多窗口阶段，否则不建议现在引入。

## 9. Utsuwa 不值得借鉴的设计

### 9.1 不复制巨型 VrmModel.svelte

它同时承担加载、动画、表情、Lip Sync、物理、摄影、触摸、头部追踪、缩略图和销毁。Elara 当前的 ModelManager、AnimationManager、Feature 和 AudioManager 边界更好。

### 9.2 不复制文本长度估算 Talking

vrmStore.startTalking(text) 无法准确反映语言、TTS 速度、实际音频时长、流式音频和 TTS 错误。Elara 应继续以真实音频生命周期为准。

### 9.3 不复制多处直接写 Expression

Utsuwa 的 Blink、Reaction、Photo Expression、Emote 和 Lip Sync 可能互相覆盖。Elara 的 Resolver 更适合长期扩展。

### 9.4 不复制关系/事件业务模型

Affection、Trust、Dating Stage、Memory Decay 和 Event Completion 是 Utsuwa 产品业务，不是通用 Avatar Runtime。

### 9.5 不复制 Svelte Store、Tauri 同步体系

Elara 使用 React + Zustand。Utsuwa 的 Svelte Rune、Tauri Event、localforage 和 BroadcastChannel 只应在有对应产品需求时引入。

## 10. 最值得借鉴的 TOP 10

| 排名 | 设计 | 优先级 | Elara 建议 |
|---:|---|:---:|---|
| 1 | TTS 分句预取与连续播放 | P0 | 基于 AudioScheduler 增加预取 |
| 2 | generation 贯穿异步响应 | P0 | 扩展到动作、情绪、Lip Sync |
| 3 | 统一表现层 Resolver | P0 | 保持并增强现有 Controller |
| 4 | Provider capability 抽象 | P1 | 统一流式、情绪、Lip Sync 能力 |
| 5 | 统一每帧更新阶段 | P1 | Elara 已具备，继续保持 |
| 6 | 模型加载与渲染解耦 | P1 | Elara 的 ModelManager 方向正确 |
| 7 | 动画 Registry + Policy | P1 | Elara 已优于 Utsuwa |
| 8 | 模型能力 Profile | P1 | 扩展 Expression Descriptor |
| 9 | Camera → Spring Bone 反馈 | P2 | 独立 Physics Feature |
| 10 | 交互反应脉冲模型 | P2 | 用于点击、语音和情绪反馈 |

## 11. 对 Elara 未来扩展性的判断

| 未来能力 | 难度 | 推荐方向 |
|---|---:|---|
| 更自然动作 | 中 | 扩展 Registry 和动作层 |
| 丰富表情 | 低-中 | 继续使用 Resolver |
| TTS | 低 | 现有 AvatarAudioManager 已有基础 |
| Lip Sync | 低 | 保持时间轴驱动 |
| 眼睛/头部跟随 | 中 | 新增 Gaze/HeadTracking Feature |
| 头发/衣服物理 | 中 | 参考 Utsuwa solver 驱动思想 |
| 手势 | 中 | Gesture Command + AnimationManager |
| 情绪 | 低 | 扩展 Emotion Resolver |
| 动作优先级/混合 | 中-高 | 逐步引入分层 Mixer |
| 多 Avatar/热切换 | 低-中 | ModelManager 和 Transition Controller 已有基础 |
| WebSocket/流式 TTS | 中 | 复用 ConversationRuntime 和 AudioScheduler |

## 12. Elara 推荐架构

    React UI
      │
      ├─ ConversationRuntime
      │    ├─ SSE/WebSocket
      │    ├─ generation
      │    └─ response events
      │
      ├─ AvatarAudioManager
      │    ├─ Interaction Voice
      │    ├─ TTS chunks
      │    ├─ AudioScheduler
      │    └─ LipSync timeline
      │
      └─ AvatarViewer Runtime
           ├─ ModelManager
           ├─ ModelTransitionController
           ├─ AnimationManager
           ├─ PresentationController
           ├─ GazeFeature
           ├─ PhysicsFeature
           ├─ InteractionReactionFeature
           └─ ThreeRenderer
                  ├─ mixer.update()
                  ├─ animation layers
                  ├─ vrm.update()
                  ├─ lip sync
                  ├─ features.update()
                  └─ renderer.render()

推荐状态流：

    Conversation Event
      ↓
    Avatar Command / Presentation Intent
      ↓
    AvatarViewer Runtime
      ├─ base motion
      ├─ temporary gesture
      ├─ emotion
      ├─ blink
      ├─ mouth/lip sync
      └─ gaze/physics

ConversationRuntime 不应直接操作骨骼，UI 也不应直接操作 VRM。

## 13. 推荐实施路线

### 阶段一：立即实施

1. 定义统一 AvatarCommand / PresentationIntent 类型。
2. 让所有异步动作携带 generationId。
3. 让 Talking 完全由真实音频生命周期驱动。
4. 在现有 AudioScheduler 上增加分句预取。
5. 保持 Expression Resolver，禁止新增多处直接写权重。

### 阶段二：下一步

1. 增加 TTS Provider capability。
2. 增加 Avatar 能力 Profile。
3. 显式化动作优先级、抢占和恢复策略。
4. 为 Talking Gesture 增加语义事件入口。
5. 增加 Runtime 调试快照和事件日志。

### 阶段三：后续扩展

1. Gaze / Head Tracking Feature
2. Physics / Spring Bone Feature
3. Interaction Reaction Feature
4. 多 Avatar 热切换缓存
5. WebSocket / 流式 TTS

## 14. 风险与注意事项

- 预取不等于无限并发，必须保留并发上限、取消和过期结果丢弃。
- message.complete 不代表音频播放完，进入 Idle 应以最后音频任务结束为准。
- 新增 Gaze、Emotion、Gesture 或 Lip Sync 时不能绕过 Presentation Resolver。
- Idle/Talking 是持续基础动作，Gesture/Emote 是临时动作；临时动作结束后应恢复 Base Motion。
- Camera Jiggle、Spring Bone、头部跟随应放入独立 Feature。
- 必须区分源码事实和设计预留。Utsuwa 的 action/emotion 字段和回调证明接口预留，但不证明完整表现闭环已经接通。

## 15. 最终结论

### 1. Utsuwa 数字人前端最核心的设计思想

通过组件生命周期承载 VRM，通过统一每帧任务协调动画、物理、表情、Lip Sync 和交互，再用 Store 连接业务状态与渲染状态。

### 2. 与 Elara 当前架构最大的区别

Utsuwa 的 Avatar Runtime 隐含在大型 Svelte 组件中；Elara 已拆成 AvatarViewer、AnimationManager、ModelManager、Feature 和 AudioManager。

### 3. Utsuwa 明显更成熟的地方

- 多 Provider TTS
- 分句预取
- Streaming TTS
- 语音并发控制
- 长期陪伴业务
- 记忆和事件系统
- 多窗口同步
- Photo/AR/触摸产品能力

### 4. Elara 不需要学习的部分

- 巨型 VrmModel.svelte
- Dating Sim 状态
- Svelte Store
- 文本长度估算 Talking
- 多处直接修改 Expression
- 当前阶段的 Tauri 多窗口同步

### 5. 最值得借鉴的 3～5 个设计

1. TTS 分句预取与连续播放
2. generation 贯穿所有异步表现
3. Provider capability 抽象
4. Camera/交互驱动 Spring Bone
5. 统一表现命令和每帧更新阶段

### 6. 应立即借鉴的设计

- TTS 预取
- generation 隔离
- 音频生命周期驱动 Talking
- 统一表现命令接口

### 7. 应后续实施的设计

- Gaze
- Spring Bone 反馈
- 互动 Reaction
- 多 Avatar 缓存
- WebSocket 和复杂流式 TTS

### 8. 继续开发 Elara 时优先重构什么

优先建立：

    Conversation Event → Avatar Command → Avatar Runtime

当前不需要重写 AvatarViewer，重点是统一跨模块表现事件协议。

### 9. 是否需要单独形成 Avatar Runtime

概念上已经形成，核心就是 AvatarViewer。不建议再创建第二套 Runtime。

### 10. 最终架构目标

    ConversationRuntime
            ↓
    Avatar Command / Presentation Intent
            ↓
    AvatarViewer Runtime
            ├─ Model Lifecycle
            ├─ Animation Layers
            ├─ Expression Resolver
            ├─ Audio/LipSync Binding
            ├─ Gaze
            ├─ Physics
            ├─ Interaction Reaction
            └─ Unified Render Loop

最终判断：

> Utsuwa 最值得 Elara 学习的是实时表现系统的编排思想，而不是它的组件结构。Elara 应保持现有更清晰的 Runtime 分层，再吸收 Utsuwa 在音频流水线、行为脉冲和物理反馈方面的经验。

## 附录：关键源码证据索引

### Utsuwa

| 文件 | 关键符号 | 实际行为 |
|---|---|---|
| src/routes/app/+page.svelte | handleSend | 组合聊天、VRM、Photo、事件和业务 UI |
| src/lib/components/vrm/VrmScene.svelte | Canvas, Scene | 创建 Threlte 场景和 XR 容器 |
| src/lib/components/vrm/Scene.svelte | VrmModel, useTask | 相机、场景、模型挂载和输入 |
| src/lib/components/vrm/VrmModel.svelte | URL effect | VRM 加载、动画和销毁 |
| src/lib/components/vrm/VrmModel.svelte | useTask | 每帧动画、物理、表情、Lip Sync |
| src/lib/services/voice-orchestrator.ts | beginSession/pushSegment/endSession | TTS Pipeline、预取和流式播放 |
| src/lib/stores/tts.svelte.ts | ttsStore | TTS 状态和 Orchestrator 桥接 |
| src/lib/stores/vrm.svelte.ts | startTalking/requestReaction | Talking 和反应信号 |
| src/lib/services/chat/companion-chat.ts | sendCompanionMessage | LLM、状态、记忆、TTS 总管线 |
| src/lib/services/chat/companion-turn.ts | processCompanionTurn | 解析、状态更新、记忆和事件 |

### Elara

| 文件 | 关键符号 | 实际行为 |
|---|---|---|
| src/main.tsx | createRoot | React 应用入口 |
| src/app/App.tsx | App | UI、Avatar、对话和 Camera 组合 |
| src/avatar/AvatarViewer.ts | AvatarViewer | Avatar Runtime Facade |
| src/avatar/managers/ModelManager.ts | load/unloadCurrent | 模型生命周期和 GPU 资源释放 |
| src/avatar/managers/AnimationManager.ts | play/playRequestId | 动画缓存、竞态和 Action 回收 |
| src/avatar/transition/ModelTransitionController.ts | switchTo | 模型切换流程和错误恢复 |
| src/avatar/features/expression/AvatarPresentationController.ts | applyResolvedWeights | 表情权重解析和冲突处理 |
| src/renderer/ThreeRenderer.ts | renderFrame | 统一 RAF、Mixer、Updater 和 Render |
| src/runtime/conversation/ConversationRuntime.ts | send/cancel | SSE、generation、Thinking 和取消 |
| src/audio/AvatarAudioManager.ts | playResponse/enqueueStreamingChunk | 音频、Talking 和 Lip Sync 桥接 |
| src/audio/AudioScheduler.ts | enqueue/cancelGeneration | 音频优先级、抢占和 generation 隔离 |
| src/lipsync/LipSyncPlayer.ts | update | 外部时间驱动的确定性 Lip Sync |
| src/vrma/registry.ts | registry | 资源元数据和稳定 ID |
| src/avatar/policies/AnimationPolicy.ts | isAnimationAllowed | 使用场景动作白名单 |

