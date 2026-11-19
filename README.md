# dsh-workspace-sort-fix

**DSH 侧边栏的「排序方式 → 最近更新」其实是半成品：它只排工作区里面的会话，不排工作区分组本身。** 这个插件把缺的那一半补上。

A small DSH client plugin that makes **Sort by → Last updated** reorder the *workspace groups* too, not just the sessions inside them.

---

## 问题出在哪

DSH Web 客户端（`@deepseek-ai/dsh-client-ui-workspace`）里，侧边栏的排序大致是这么写的：

```js
const orderedWorkspaces = useMemo(() => workspaces.map(workspace => {
  const memberIds = workspace.sessionIds
  const baseOrder = orderBy === 'updated'
    ? orderByRecency(memberIds, sessionsById)      // ← 只排「组内会话」
    : reconcileManualOrder(...)
  return { ...workspace, sessionIds: baseOrder }
}), [...])
```

注意是对 `workspaces` 数组做 **`.map()`** —— 它保持输入顺序，所以工作区分组本身的顺序永远是工作区注册表里的**持久顺序**（也就是你拖拽出来的那个顺序），`orderBy` 从头到尾没参与。

后果很具体：

- 你切到「最近更新」，**组与组之间纹丝不动**；
- 组内排序确实变了，但大多数人每个工作区只有一两个会话，**根本看不出来**；
- 于是这个选项看起来完全是坏的。很多人以为是版本没更新，其实更新了也一样。

## 插件做了什么

当视图处于「最近更新」模式（且分组模式不是「单列表」）时：

1. 每 1.2 秒读一次视图状态；
2. 按「组内最新会话的 `updatedAt`」给所有工作区排名（空组退回 `createdAt`）；
3. 顺序不一致时，调用官方的 `workspaces.insertBefore(移动项, 锚点)` 真正写入工作区注册表；
4. 顺序由 DSH 自己持久化，**刷新、重启都保留**；
5. 你切回「手动排序」后插件立刻停手，拖拽顺序原样保留。

只动顺序，不碰任何 DSH 自身文件，也没有 patch 宿主源码。

## 安装

**方式一：插件管理器（推荐）**

```
插件 → 安装 → 输入 github:justjump/dsh-workspace-sort-fix
```

**方式二：命令行**

```bash
# Web / 桌面端 profile 名按你的实际情况换（desktop / web）
dsh plugin --profile desktop add github:justjump/dsh-workspace-sort-fix
```

装完 **重启一次 DSH**（客户端插件是启动时加载的）。

## 用法

装好之后什么都不用配置：只要你在侧边栏选的是 **排序方式 → 最近更新**，工作区分组就会按各组最新活动自动往上走。

想保住自己拖出来的顺序：切成 **手动排序**，插件立即停止干预。

## 设置（可选）

在浏览器控制台里改 `localStorage`，改完刷新页面生效：

| 键 | 默认 | 说明 |
|---|---|---|
| `dsh.workspaceSortFix.settings` | `{}` | JSON，例如 `{"enabled":false,"tickMs":1200,"moveBudget":12}` |

- `enabled:false`：临时关闭插件（保留安装）；
- `tickMs`：轮询间隔，最小 300；
- `moveBudget`：单轮最多移动几个工作区，防止意外反复抖动。

## 兼容性

- 针对 **DSH Desktop 0.2.2-rc.5** 实测；
- 只依赖客户端已有的两个服务 `sessions` / `workspaces`，以及持久化的视图 store `dsh.workspace.view.vN`（插件会自动找当前版本号最高的那个 key）；
- 服务缺失时**静默降级为不动作**，不会报错、不会影响侧边栏；
- 如果上游以后自己修了这个问题，这个插件会变成无害的空转，可以直接卸载。

## 已知取舍

- 这个插件改写的是**持久**的工作区顺序。所以在「最近更新」模式下你手动拖出来的顺序会被它按时间重新覆盖——这正是该模式的语义。要保住自己的顺序请切「手动排序」。
- 工作区很多的话，第一次挂载时可能连续移动十几次（受 `moveBudget` 限制，分几轮完成）。

## License

MIT
