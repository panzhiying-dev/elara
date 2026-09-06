# VRM Expression Conflict Analysis

## 1. 数据来源与运行时口径

本报告只分析当前项目中的模型 `src/Model/1112435277841725958.glb`，不修改模型或业务代码。

- VRM 规范：`0.0`（VRM 0.x）。
- three-vrm：`@pixiv/three-vrm` 3.5.5。
- VRM 0.x 的 `blendShapeMaster.blendShapeGroups`：14 组。
- `VRMExpressionLoaderPlugin` 将这 14 组映射为运行时 `VRMExpressionManager` 中的 14 个 Expression。
- Face mesh 共包含 57 个 glTF morph target；只有被 VRM blendShape group bind 的 14 个才是当前 VRM API 可直接控制的 Expression。
- 因此，“可控 Expression”与“模型 Shape Key”不是同一列表。当前未暴露为 VRM Expression 的 morph target 数量为 43 个。

当前 `AvatarExpressionFeature.getAvailableExpressions()` 以运行时 `expressionManager.expressions` 且 `binds.length > 0` 为准，理论上返回下面的 14 项；Explorer UI 不应补充不存在的名称。

## 2. 当前 VRM 实际 Expression 列表

| 运行时 Expression | VRM 0.x 原始 name | presetName | 绑定的 glTF BlendShape |
|---|---|---|---|
| `neutral` | `Neutral` | `neutral` | `Fcl_ALL_Neutral` |
| `aa` | `A` | `a` | `Fcl_MTH_A` |
| `ih` | `I` | `i` | `Fcl_MTH_I` |
| `ou` | `U` | `u` | `Fcl_MTH_U` |
| `ee` | `E` | `e` | `Fcl_MTH_E` |
| `oh` | `O` | `o` | `Fcl_MTH_O` |
| `blink` | `Blink` | `blink` | `Fcl_EYE_Close` |
| `blinkLeft` | `Blink_L` | `blink_l` | `Fcl_EYE_Close_L` |
| `blinkRight` | `Blink_R` | `blink_r` | `Fcl_EYE_Close_R` |
| `angry` | `Angry` | `angry` | `Fcl_ALL_Angry` |
| `relaxed` | `Fun` | `fun` | `Fcl_ALL_Fun` |
| `happy` | `Joy` | `joy` | `Fcl_ALL_Joy` |
| `sad` | `Sorrow` | `sorrow` | `Fcl_ALL_Sorrow` |
| `surprised` | `Surprised` | `unknown` | `Fcl_ALL_Surprised` |

## 3. Expression 对 BlendShape 的实际影响

每个表中的 Expression 当前只有一个 VRM 0.x morph bind，权重由 `VRMExpressionManager.setValue()` 限制在 `0..1`，随后由 `expressionManager.update()` 应用到 Face mesh 的对应 morph target。

- `neutral` → `Fcl_ALL_Neutral`
- `happy` → `Fcl_ALL_Joy`
- `angry` → `Fcl_ALL_Angry`
- `sad` → `Fcl_ALL_Sorrow`
- `relaxed` → `Fcl_ALL_Fun`
- `surprised` → `Fcl_ALL_Surprised`
- `blink` → `Fcl_EYE_Close`（双眼闭合）
- `blinkLeft` → `Fcl_EYE_Close_L`（左眼闭合）
- `blinkRight` → `Fcl_EYE_Close_R`（右眼闭合）
- `aa` → `Fcl_MTH_A`
- `ih` → `Fcl_MTH_I`
- `ou` → `Fcl_MTH_U`
- `ee` → `Fcl_MTH_E`
- `oh` → `Fcl_MTH_O`

`Body` 与 `Hair` mesh 没有 morph target；这些 Expression 的实际变形目标均在 Face mesh。

## 4. 分类

### Emotion

`neutral`、`happy`、`angry`、`sad`、`relaxed`、`surprised`。

其中 `neutral` 是基础面部形态。Emotion Expression 绑定的是 `Fcl_ALL_*`，属于整体脸部变形，不是眼睛或嘴巴的专用通道。

### Eye / Blink

`blink`、`blinkLeft`、`blinkRight`。

当前模型没有单独暴露 `lookUp`、`lookDown`、`lookLeft` 或 `lookRight` 的 VRM Expression bind。

### Mouth / LipSync

`aa`、`ih`、`ou`、`ee`、`oh`，分别对应 VRM 0.x 的 `A/I/U/E/O`。它们是口型通道，可作为 LipSync 的最小音素集合。

### Other

当前运行时没有带有效 bind 的额外 Expression。

## 5. 闭眼与 Blink 分析

明确包含闭眼语义的只有：

- `blink`：`Fcl_EYE_Close`，双眼。
- `blinkLeft`：`Fcl_EYE_Close_L`，左眼。
- `blinkRight`：`Fcl_EYE_Close_R`，右眼。

Emotion 使用 `Fcl_ALL_*`，名称本身不能证明其是否改变眼睛。当前 VRM 0.x 元数据没有声明 `overrideBlink`，导入后的 `happy`、`angry`、`sad`、`relaxed`、`surprised` 通常都是 `overrideBlink: none`。因此：

- 模型 API 不会自动判定“Happy 已闭眼”并阻止 Blink。
- `happy + blink` 在 API 层可以同时有非零权重，但两个 morph 可能在眼周区域发生视觉叠加。
- 是否阻止、降低或延迟 Blink 必须由项目层 Resolver 根据策略决定，不能依赖当前模型的 override 元数据。

`blinkLeft + blinkRight` 可能等效双眼闭合；`blink` 与任一左右 Blink 同时激活也可能重复作用于闭眼区域。建议 Resolver 在同一时刻只选择一种 Blink 形态，或在明确需要左右眼独立控制时只使用左右两项。

## 6. Expression Conflict Matrix

下表描述的是视觉/语义冲突，不表示 `VRMExpressionManager` 会抛出异常。当前管理器允许多个 Expression 同时写入不同 morph target，冲突时最终外观由 morph 叠加结果决定。

| 组合 | API 是否可同时设置 | 风险 | 推荐 Resolver 行为 |
|---|---|---|---|
| Emotion + Emotion（如 `happy + sad`） | 可以 | 两个 `Fcl_ALL_*` 叠加，语义不确定 | 只保留一个主要 Emotion；按优先级平滑切换 |
| Emotion + `blink` | 可以 | `Fcl_ALL_*` 可能影响眼周，闭眼形态叠加 | 若有明确闭眼阻断则暂停/降权 Blink；无元数据时采用项目策略 |
| Emotion + `blinkLeft`/`blinkRight` | 可以 | 单眼闭合与整体脸部形态叠加 | 保留 Emotion，Blink 作为独立眼层并限制权重 |
| `blink` + `blinkLeft`/`blinkRight` | 可以 | 双眼/单眼闭合重复叠加 | 只选整体 Blink 或左右 Blink 方案之一 |
| `blinkLeft` + `blinkRight` | 可以 | 两项合并后等效双眼闭合 | 仅在明确需要左右独立控制时同时使用 |
| Mouth vowel + Mouth vowel | 可以 | `Fcl_MTH_*` 互相竞争，口型不明确 | 同时只保留一个主要 vowel |
| Emotion + Mouth | 可以 | `Fcl_ALL_*` 可能改变嘴部，口型会被整体脸形影响 | Emotion 与 Mouth 分层；口型层保留独立权重 |
| Action Override + 任意基础层 | 可以 | 临时表情覆盖基础表现 | Override 仅在动作期间生效，动作结束清除 |

## 7. Motion → Default Emotion 建议

动作默认情绪应作为 fallback，不应覆盖显式或 AI 情绪。结合当前动作语义，建议默认值如下：

| Motion | Default Emotion | 说明 |
|---|---|---|
| `idle` / `modelPose` | `neutral` | 基础待机/站立姿态 |
| `walkForward` / `walkLoop` / `walkTurnLeft90` | `neutral` | 位移动作不强制快乐表情 |
| `turn` / `turnLeft` / `turnRight` | `neutral` | 转身保持当前显式情绪，否则回退 Neutral |
| `greeting` | `happy` | 问候动作的推荐默认情绪 |
| `peaceSign` | `happy` | 友好手势 |
| `showFullBody` | `neutral` | 展示姿态不强制情绪 |
| `shoot` | `neutral` | 动作本身不决定情绪 |
| `spin` | `happy` | 轻快动作的推荐默认情绪 |
| `squat` | `neutral` | 姿态动作 |
| `SambaDancing` | `happy` | 舞蹈动作的推荐默认情绪 |

优先级必须为：

```text
Explicit Emotion > Motion Default Emotion > Neutral
```

## 8. 推荐 Layer Priority

建议将来源状态保持为独立层，再由 Resolver 统一写入 VRM：

```text
Action Expression Override
        > Explicit Emotion
        > Motion Default Emotion
        > Neutral

Eye/Blink layer：显式眼部覆盖 > 左右 Blink > 整体 Blink > 可用默认 Blink
Mouth layer：LipSync/Mouth 输入独立解析，同一时刻只选一个主要 vowel
```

这只是优先级约定，不要求当前阶段创建大型状态机。Motion、Emotion、Blink、LipSync 不应互相直接调用或直接写 `vrm.expressionManager`。

## 9. 推荐 Resolver 规则

1. 先确定基础 Emotion：显式 Emotion 存在时使用它，否则使用当前 Motion 的 Default Emotion，否则使用 `neutral`。
2. Emotion 同时只保留一个主要项；切换时对旧项降权、新项升权。
3. 读取当前模型的 `overrideBlink`/`overrideMouth`；若没有阻断标记，则使用项目层冲突策略，不假设模型会自动解决。
4. Blink 先处理眼部冲突：整体 `blink` 与左右 Blink 不能无条件同时叠加；有闭眼阻断的 Action/Emotion 时暂停、延迟或降低 Blink。
5. Mouth 单独处理，`aa/ih/ou/ee/oh` 同时最多保留一个主要口型；`none` 时全部清零。
6. Action Expression Override 只在动作上下文有效，动作结束清除，随后恢复 Explicit Emotion 或 Motion Default Emotion。
7. Resolver 只向实际存在且有 bind 的 Expression 写入权重；未知名称安全忽略。

## 10. 当前 VRM 不建议直接叠加的组合

以下组合虽然不会导致 three-vrm API 报错，但不应作为默认行为：

- 两个或更多 Emotion（`happy + sad`、`angry + surprised` 等）。
- `blink` 与 `blinkLeft`/`blinkRight` 的无条件并行。
- `blinkLeft + blinkRight`，除非目标就是明确的左右眼独立控制。
- 两个或更多 Mouth vowel。
- 需要清晰口型时，将高权重 Emotion 与 Mouth 无限制叠加；整体脸部 morph 可能改变口部轮廓。

当前模型没有 VRM 0.x `overrideBlink`/`overrideMouth` 声明，所以不存在由模型元数据保证的安全组合；应由 Resolver 明确裁决。

## 11. Dance + Happy + Blink 示例

推荐状态解析过程：

```text
Motion = SambaDancing
Motion Default Emotion = happy
Explicit Emotion = happy       // 若存在，则优先于默认值
Blink request = blink

Resolver:
  emotion.happy = 1
  其他 Emotion = 0
  检查 happy/action 是否有闭眼阻断
  当前模型 overrideBlink = none，因此按项目策略限制 Blink
  若策略认为存在眼部冲突：blink = 0（或延迟/降权）
  否则：blink 在短时窗口内平滑升降
```

动作结束时清理 Action Override；`happy` 是否保留由 Explicit Emotion 决定，没有显式情绪时回到该 Motion 的默认值或 `neutral`。

## 12. 结论

- 当前 VRM 0.x 运行时实际可控 Expression：14 个：`neutral`、`happy`、`angry`、`sad`、`relaxed`、`surprised`、`blink`、`blinkLeft`、`blinkRight`、`aa`、`ih`、`ou`、`ee`、`oh`。
- 其中 6 个为 Emotion，3 个为 Blink/Eye，5 个为 Mouth/LipSync。
- Face mesh 的 57 个 Shape Key 中，43 个没有 VRM blendShape group bind，不能通过当前 `VRMExpressionManager` 直接控制。
- `happy` 等整体脸部 Emotion 没有 `overrideBlink` 标记；不能仅凭模型元数据判断它们是否闭眼，也不会自动阻止 Blink。
- 最小可靠方向是 `Presentation State → Resolver → VRMExpressionManager`：Emotion、Blink、Mouth、Action Override 各自提供状态，Resolver 统一解决冲突。
- 本阶段只完成分析；未修改 Expression、Motion、Renderer 或其他业务代码。
