/**
 * dsh-workspace-sort-fix — make DSH's "Sort by → Last updated" actually sort
 * the workspace groups themselves, not just the sessions inside them.
 *
 * Why this exists
 * ---------------
 * In DSH's web client (`@deepseek-ai/dsh-client-ui-workspace`) the sidebar's
 * workspace order is derived like this:
 *
 *     orderedWorkspaces = workspaces.map(workspace => ({
 *       ...workspace,
 *       sessionIds: orderBy === 'updated'
 *         ? orderByRecency(workspace.sessionIds, sessionsById)
 *         : reconcileManualOrder(...),
 *     }))
 *
 * `.map()` preserves the incoming order, so `orderBy` only reorders sessions
 * *inside* each group. The groups themselves always keep the durable registry
 * order (the order you get by dragging). With one or two sessions per
 * workspace — the common case — switching the sort mode looks like a no-op.
 *
 * What this plugin does
 * ---------------------
 * While the view is in "Last updated" mode it ranks every workspace by the
 * most recent activity of its sessions and writes that order through the
 * public `workspaces.insertBefore` remote. The order is persisted by DSH
 * itself, so it survives reloads. Switching to "Manual" stops the plugin
 * immediately and leaves your dragged order alone.
 *
 * Compatibility
 * -------------
 * Built against DSH Desktop 0.2.2-rc.5. It only uses services the client
 * already exposes (`sessions`, `workspaces`) plus the persisted view store;
 * if any of them are missing it degrades to a silent no-op instead of
 * throwing. Nothing in DSH's own files is patched.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-sort-fix',
  factory(require) {
    /** Persisted workspace view store — the version suffix moves between releases. */
    const VIEW_KEY_RE = /^dsh\.workspace\.view\.v(\d+)$/
    const SETTINGS_KEY = 'dsh.workspaceSortFix.settings'
    const DEFAULT_TICK_MS = 1200
    const DEFAULT_MOVE_BUDGET = 12

    let services = null
    let busy = false
    let warned = false

    function readSettings() {
      try {
        const raw = window.localStorage.getItem(SETTINGS_KEY)
        const parsed = raw ? JSON.parse(raw) : {}
        return {
          enabled: parsed.enabled !== false,
          tickMs: Number.isFinite(parsed.tickMs) ? Math.max(300, parsed.tickMs) : DEFAULT_TICK_MS,
          moveBudget: Number.isFinite(parsed.moveBudget) ? Math.max(1, parsed.moveBudget) : DEFAULT_MOVE_BUDGET,
        }
      } catch {
        return { enabled: true, tickMs: DEFAULT_TICK_MS, moveBudget: DEFAULT_MOVE_BUDGET }
      }
    }

    /** Highest-versioned `dsh.workspace.view.vN` key present in localStorage. */
    function viewKey() {
      let best = null
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i)
        if (!key) continue
        const match = VIEW_KEY_RE.exec(key)
        if (!match) continue
        if (best === null || Number(match[1]) > best.version) best = { key, version: Number(match[1]) }
      }
      return best ? best.key : null
    }

    function readView() {
      const key = viewKey()
      if (!key) return null
      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) ?? 'null')
        const state = parsed?.state ?? parsed
        if (!state) return null
        return {
          orderBy: state.orderBy ?? 'updated',
          groupBy: state.groupBy ?? 'workspace',
        }
      } catch {
        return null
      }
    }

    /** Workspace ids ordered by their most recent session activity. */
    function rankWorkspaces() {
      const sessions = services.sessions.list.getSnapshot()
      const spaces = services.workspaces.list.getSnapshot()
      const items = (spaces.items ?? []).slice()
      const byId = sessions.byId ?? {}
      const rankOf = (workspace) => {
        let best = 0
        const ids = workspace.sessionIds ?? []
        for (let i = 0; i < ids.length; i += 1) {
          const updated = byId[ids[i]]?.updatedAt
          if (typeof updated === 'number' && updated > best) best = updated
        }
        if (best === 0 && typeof workspace.createdAt === 'number') best = workspace.createdAt
        return best
      }
      return items
        .map((workspace, index) => ({ workspace, index, rank: rankOf(workspace) }))
        .sort((a, b) => b.rank - a.rank || a.index - b.index)
        .map((entry) => entry.workspace.workspaceId)
    }

    async function applyOrder() {
      if (!services || busy) return
      const settings = readSettings()
      if (!settings.enabled) return

      const view = readView()
      if (!view || view.orderBy !== 'updated') return
      // Flat list already sorts sessions by recency in the host app.
      if (view.groupBy === 'list') return

      busy = true
      try {
        let moves = 0
        for (let guard = 0; guard < settings.moveBudget; guard += 1) {
          const desired = rankWorkspaces()
          const current = (services.workspaces.list.getSnapshot().items ?? []).map((w) => w.workspaceId)
          const mismatch = desired.findIndex((id, index) => id !== current[index])
          if (mismatch === -1) break
          const moving = desired[mismatch]
          const anchor = current[mismatch]
          if (!moving || !anchor || moving === anchor) break
          try {
            await services.workspaces.insertBefore(moving, anchor)
            moves += 1
          } catch (error) {
            console.warn('[workspace-sort-fix] insertBefore rejected:', error)
            break
          }
        }
        if (moves > 0) console.info(`[workspace-sort-fix] reordered ${moves} workspace move(s)`)
      } finally {
        busy = false
      }
    }

    function mount(ctx) {
      ctx.inject(['sessions', 'workspaces'], (child) => {
        services = { sessions: child.sessions, workspaces: child.workspaces }
        warned = false
        console.info('[workspace-sort-fix] mounted — workspace groups now follow "Last updated"')
        void applyOrder()
        return () => {
          services = null
        }
      })
    }

    function apply(ctx) {
      mount(ctx)
      window.__dshWorkspaceSortFix = () => applyOrder()
      window.__dshWorkspaceSortFixDebug = () => {
        if (!services) return { mounted: false, viewKey: viewKey(), view: readView() }
        const items = services.workspaces.list.getSnapshot().items ?? []
        return {
          mounted: true,
          viewKey: viewKey(),
          view: readView(),
          settings: readSettings(),
          current: items.map((w) => w.workspaceId),
          desired: rankWorkspaces(),
          titles: Object.fromEntries(items.map((w) => [w.workspaceId, w.title ?? w.path ?? ''])),
        }
      }
      const settings = readSettings()
      setInterval(() => {
        if (!services) {
          if (!warned) {
            warned = true
            console.info('[workspace-sort-fix] waiting for sessions/workspaces services')
          }
          return
        }
        void applyOrder()
      }, settings.tickMs)
    }

    return { apply }
  },
})
