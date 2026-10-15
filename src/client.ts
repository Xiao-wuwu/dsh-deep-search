/**
 * dsh-deep-search — client half（浏览器侧设置卡片）。
 *
 * [2026-10-15 本地补丁] 目的：让 `alwaysSearch` 开关出现在
 * **设置 → 插件 → dsh-deep-search（bundle 页）→ 配置区**。
 *
 * ── 权威依据（全部实测，不是推断）────────────────────────────────────
 * ① 官方 plugin-manager 的渲染代码（`@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js`）：
 *      renderSlot("plugins.bundle.config", { view: "page" }, { entryKey: pkg.name })
 *    ⇒ **owner 只传 `{ view }`，不传 `form`**（`PluginConfigViewProps.form` 在 bundle 页
 *      实际为 undefined）⇒ 卡片**必须自己拿状态**，靠 `props.form` 会永远渲染空。
 * ② 真实同类插件 `dsh-plugin-model-proxy`（也用 plugins.bundle.config）的写法：
 *      const inject = ["slots","locale","connection","remote","configForms"]
 *      ctx.effect(() => ctx.configForms.whileServed(["model-proxy"], () => ctx.slots.inject(
 *        "plugins.bundle.config", () => ctx.slots.register(
 *          { name, key: "dsh-plugin-model-proxy", locale, inject: () => ({controller, catalog}) },
 *          ModelProxyCard))))
 *      卡片内 `useSyncExternalStore(controller.subscribe, controller.getSnapshot)` 读 `snap.value`。
 * ③ 真实同类插件 `dsh-plugin-om`：`inject = ["slots","uiConversation","locale","configForms","uiWorkspace"]`。
 * ④ 官方开发指南（asar 内）客户端插件格式：`window.__ModuleLoader__.load({ id, factory(require) {
 *      return { inject: ['slots'], apply(ctx) {...} } } })`
 * ⑤ 官方 client 产物首行即 `window.__ModuleLoader__.load(...)`（非裸 ESM）。
 *
 * ⇒ 因此本文件：不依赖 `props.form`；用自建 form + `hooks` 舱把 store 交给组件；
 *    `export const inject` 声明服务（不声明加载器不激活）。
 * 构建后由 `Tools\NInfer\scripts\postprocess-client.cjs` 包成 ⑤ 的格式。
 */
import { Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import { SettingsFormModel } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsFieldSpec } from '@deepseek-ai/dsh-client-ui-primitives'
// 加载 declare module 增强（ctx.slots ← renderer/client；ctx.configForms ← settings/client）
import type { } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { } from '@deepseek-ai/dsh-client-ui-settings/client'

/** bundle 包名 —— `plugins.bundle.config` 的 key 必须与之一致。 */
const BUNDLE_PACKAGE = 'dsh-deep-search'

/** 本 bundle 在 profile patch 里声明的 row id —— 也是它的 settings 命名空间。 */
const SETTINGS_NAMESPACE = 'deep-search'

/** 被编辑的字段名（对应 host ConfigSchema.alwaysSearch，已标 .volatile()）。 */
const FIELD = 'alwaysSearch'

const LABEL = '搜索默认启用（alwaysSearch）'
const TITLE =
  '勾选：任何需要联网搜索的问题都默认走 deep_search（不再限于时效/争议性事实）。' +
  '取消：恢复原始范围。'

/**
 * 布尔字段规格：官方只提供 settingsTextField / settingsNumberField，没有布尔版 ⇒ 自建。
 * - `format`：存储值 → 草稿文本（未设置 = 默认 true，所以开关初始为"开"）。
 * - `parse`：只接受 "true"/"false"；其它 ⇒ undefined ⇒ invalid ⇒ 阻止保存（官方"不静默改写输入"原则）。
 */
function settingsBooleanField(field: string): SettingsFieldSpec {
  return {
    field,
    format: (value) => (value === false ? 'false' : 'true'),
    parse: (text) => {
      const t = String(text).trim().toLowerCase()
      if (t === 'true') return { kind: 'set', value: true }
      if (t === 'false') return { kind: 'set', value: false }
      return undefined
    },
  }
}

/**
 * 卡片组件。props 由 slot 框架注入：
 * `view`（'summary' | 'page'）+ 我们 `inject()` 返回的面（edit / save）+ hooks 舱合成的
 * `useDeepSearchSettings` 选择器钩子。
 *
 * 注：`Checkbox` 内部无 hooks（已核对官方实现），可直接调用组装元素。
 */
export function SettingsCard(props: any) {
  if (props.view === 'summary') return LABEL

  const snap = props.useDeepSearchSettings((s: any) => s)
  const fieldState = snap?.field ?? { text: 'true', invalid: false }
  const writable = snap?.shell?.writable !== false
  const checked = fieldState.text !== 'false'

  return Checkbox({
    checked,
    disabled: !writable,
    label: LABEL,
    title: TITLE,
    onChange: (next: boolean) => {
      // boolean 开关即时生效：先暂存再保存（单一写点 = form.save()）
      props.edit?.(next ? 'true' : 'false')
      props.save?.()
    },
  })
}

/** 客户端服务声明（必须导出，否则加载器不激活本 client）。 */
export const inject = ['slots', 'configForms'] as const

/** 客户端半入口（package.json exports["./client"] 指向本模块）。 */
export function apply(ctx: any): void {
  const scope = ctx.configForms.get(SETTINGS_NAMESPACE)
  const form = new SettingsFormModel(scope, [settingsBooleanField(FIELD)])
  ctx.effect(() => () => form.dispose(), 'dsh-deep-search: settings form')

  const store = form.bind(() => ({ field: form.field(FIELD), shell: form.shell() }))

  ctx.effect(
    () =>
      ctx.configForms.whileServed([SETTINGS_NAMESPACE], () =>
        ctx.slots.inject('plugins.bundle.config', () =>
          ctx.slots.register(
            {
              name: 'plugins.bundle.config',
              key: BUNDLE_PACKAGE,
              inject: () => ({
                edit: (text: string) => form.actions().edit(FIELD, text),
                save: () => form.actions().save(),
                discard: () => form.actions().discard(),
                // hooks 舱：裸 observable（getSnapshot+subscribe）由框架合成 useDeepSearchSettings
                hooks: { deepSearchSettings: store },
              }),
            } as any,
            SettingsCard as any,
          ),
        ),
      ),
    'dsh-deep-search: settings page',
  )
}

export const name = 'dsh-deep-search-client'
