# Elara Avatar Runtime 动作与视图体验升级实施报告

## 1. 实际结论

本阶段完成基于 Utsuwa 行为的最小迁移，没有复制 Utsuwa Runtime。Elara 继续以 `AvatarViewer` 为 Facade、`AnimationManager` 为唯一 VRMA 播放入口、`AvatarPresentationController` 为唯一 Expression 写入入口，Audio/LipSync/generation/模型生命周期保持不变。

## 2. Utsuwa 实际扫描结果

参考源码：`/Users/panzhiying/Desktop/pull-github/utsuwa-main`。

- `VrmModel.svelte` 使用 5 个 Idle VRMA 随机轮换，避免连续重复；每个动作约完成 1～2 个循环后切换，fade 约 1.2 秒；Talking 使用独立 `talking.vrma`，与 Idle 约 0.3 秒交叉淡化。
- `vrm.svelte.ts` 持有 Idle/Talking 资源池与 speaking 状态。
- 未发现可直接迁移的成熟 Thinking/Idea VRMA 选择算法；Thinking 主要是 UI 状态。
- Utsuwa 的 Blink/呼吸/眼动直接写 VRM expression，本次没有绕过 Elara Controller 迁移。
- Utsuwa 仓库为 AGPL-3.0；本次仅复用动作资源作为已审查资产，没有复制其组件、服务或业务模型。

## 3. 动作资源迁移

新增 `src/vrma/UtsuwaIdle.vrma`、`UtsuwaIdle2.vrma`、`UtsuwaIdle3.vrma`、`UtsuwaIdle4.vrma`、`UtsuwaIdle5.vrma`、`UtsuwaTalking.vrma`，并在 `registry.ts` 注册为 `idleUtsuwa1..5` 与 `talking`。原有 Idle、Thinking、回应动作和 Dance 全部保留。

## 4. Elara 动作行为修改

### Idle

`AvatarViewer` 增加低频 Idle 轮换：随机偏移索引避免连续重复；每个片段至少约 1～2 个循环后切换；使用约 1.2 秒 fade；模型卸载或状态切换会清理 timer/token。

### Talking

联网复核发现 Utsuwa 的 `talking.vrma` 在 Elara 当前模型上包含转身/挥手轨道，因此不再用于 Talking。`playTalkingAnimation()` 暂时复用不转身的 `idleUtsuwa3` 作为稳定说话身体姿态，嘴型仍由 `LipSyncPlayer → AvatarPresentationController` 驱动。原先按音频 Chunk 自动触发 `nodYes` 的路径也已移除。后续若取得许可清晰的 Mixamo `Talking.fbx` 或其他 Talking VRMA，只需替换该动作 ID。

### Thinking

继续使用已有 `Thinking.vrma`，并为 `thinking` 增加 `relaxed` motion emotion。没有引入不存在的 Utsuwa Idea 算法。

### Dance 与优先级

`AvatarViewer` 增加最小优先级判断：Dance 最高；显式 action/pose/response 次之；Thinking/emotion 再次；Talking/Idle 最低。自动 Talking/Idle 不会打断 Dance；对话开始清理 Thinking 时保留 Dance。`AnimationManager` 的 requestId、旧 Action 清理和 Mixer 生命周期未重写。

## 5. Expression 同步

只扩展 `MOTION_DEFAULTS`，没有新增 Expression Writer。emotion、blink、mouth、LipSync、micro expression 仍由 `AvatarPresentationController` 合成写入 VRM；Utsuwa 直接 `expressionManager.setValue()` 没有迁移。

## 6. Camera / Model Transform

修改位置：`src/avatar/AvatarViewer.ts` 的 `frameModel()` 与 `src/renderer/RendererConfig.ts`。

```text
Model position  = (0.000, -0.000, 0.010)
Model rotation  = (0.000, 3.142, 0.000)
Model scale     = (1.000, 1.000, 1.000)
Camera position = (-0.028, 1.532, 1.915)
Camera target   = (-0.005, 1.232, -0.059)
```

不再由包围盒计算覆盖默认产品视图。Model Size 继续由真实 Box3 调试读取。OrbitControls 使用默认相机-目标距离约 `1.9968` 为 `minDistance`，`maxDistance=8`、`enableDamping=true`、`dampingFactor=0.12`、`zoomSpeed=0.35`，默认视图即最小缩放。

## 7. 后端首句切句策略

真实链路为 `ConversationService.stream_message → SpeechPipeline.stream_chunks → TextNormalizer → TextChunker.split → 顺序 TTS → LipSync → message.chunk SSE`。当前 Agent 返回完整 `raw_text` 后才切句，没有 token 到达时间，因此没有伪造 max-wait。

`TextChunker` 新增：

- `FIRST_CHUNK_TARGET_LENGTH=48`
- `FIRST_CHUNK_MAX_LENGTH=120`
- `FIRST_CHUNK_MAX_WAIT_MS=900`（为未来真正 token-streaming 预留，当前不使用等待）

首段适度吸收后续自然语义单元直到目标/上限；后续 chunk 保持原有强标点、弱标点、空格和安全兜底。短回答不会等待额外内容。SSE event name、字段、index、generation/request ID 均未改变。

## 8. 修改文件

前端：`AvatarViewer.ts`、`AnimationManager.ts`、`AvatarPresentationController.ts`、`AvatarAudioManager.ts`、`useAssistantConversation.ts`、`RendererConfig.ts`、`ThreeRenderer.ts`、`vrma/registry.ts`，以及 6 个 VRMA 资源。

后端：`text_chunker.py`、`pipeline.py`、`config.py`、`tests/test_speech.py`。

未修改 AudioScheduler、ConversationRuntime、LipSyncPlayer、ModelManager、ModelTransitionController 的核心生命周期，也未修改后端 SSE 协议。

## 9. 删除/废弃的旧逻辑

- 废弃 `idle-talking` 不存在时回退普通 Idle 的 Talking 路径；当前 Talking 使用 `idleUtsuwa3` 稳定姿态，避免 Utsuwa talking 资源造成转身挥手。
- 废弃 Talking 期间自动 `nodYes` 手势；静止/说话结束只进入 `idleUtsuwa1..5` Idle 池。
- 废弃每次加载按包围盒重置产品默认 Camera/Target 的路径，保留 Box3 仅用于调试读取。
- 没有删除 Dance、旧 Idle、Thinking 或回应资源。

## 10. 测试结果

前端：`npm run typecheck` 通过；`npm run build` 通过。仅有既有 Vite native config 与 bundle size warning。

后端（均使用 `conda run -n qwen3-tts`）：`pytest -q` 通过，17 passed；`python -m compileall -q app tests` 通过；`python -m ruff check app tests` 报项目已有 55 条行长/导入格式问题，本阶段未做无关格式化。

## 11. 运行时验证边界

当前环境没有可操作的浏览器/WebGL 观察窗口，因此不能声称完成 30 秒 Idle、长文本 Talking、Dance、模型切换和滚轮手感的实机视觉验收。代码级验证已覆盖动作注册、异步 token、模型卸载清理、默认数值和构建产物；这些场景仍应在真实浏览器执行。

## 12. 明确未迁移内容

未迁移 Utsuwa VoiceOrchestrator、关系/记忆、Overlay、多 Avatar、第二套 RAF、直接 Expression 写入、LipSync analyzer、独立 GestureController、Gaze、Physics。当前没有源码证据证明需要新增这些边界。`FIRST_CHUNK_MAX_WAIT_MS` 也未伪造成同步 TextChunker 的计时等待。

## 13. 当前架构与遗留问题

```text
React/assistant-ui → ConversationRuntime → AvatarAudioManager
→ AudioScheduler + LipSyncPlayer → AvatarViewer
→ AnimationManager / AvatarPresentationController / ModelManager
→ ThreeRenderer single RAF → VRM
```

遗留：需要真实浏览器验收动作自然度与 OrbitControls 手感；完整文本生成后才切句，TTFA 仍受 Agent/TTS 生成限制；ruff 既有问题未处理。

## 14. 最终判断

本阶段采用“Utsuwa 行为 + Elara ownership”：Idle/Talking 已替换为真实资源与低频切换，Thinking/Expression/Dance 保持稳定边界，Camera 默认视图与最小缩放已固定，首句切句配置化且 SSE 兼容。当前不需要 AvatarCommand、PresentationIntent、EventBus、独立 GestureController、Gaze 或 Physics 层。
