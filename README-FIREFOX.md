# GeoMirror for Firefox

上游项目 [Azurboy/geomirror](https://github.com/Azurboy/geomirror)（Chrome MV3）的 Firefox 移植版。
功能与上游一致：检测当前出口 IP 的地理位置，让浏览器呈现的**地理位置、时区、语言 / Intl locale、
Accept-Language 请求头、区域字体信号**与出口 IP 保持一致，避免"IP 在东京、浏览器却像在上海"
这类被风控识别的矛盾信号。

兼容 Firefox **128+**（依赖 MV3 `world: "MAIN"` 内容脚本与 declarativeNetRequest），
在最新版（如 157.x）上可用。

## 安装（临时加载）

1. 打开 `about:debugging#/runtime/this-firefox`
2. 点击 **「Load Temporary Add-on… / 临时载入附加组件」**
3. 选择本目录下的 `manifest.json`
4. 工具栏出现 GeoMirror 图标，点开应显示 Exit IP / IP location / Spoofed timezone / Spoofed language

> 临时加载的扩展重启 Firefox 后会消失，重新加载一次即可。要长期使用需经
> [addons.mozilla.org](https://addons.mozilla.org/developers/) 签名或用 Firefox Developer Edition /
> Nightly 的 `xpinstall.signatures.required=false`。

## 授予站点访问权限（重要）

Firefox 127 起，MV3 扩展的 host 权限**默认不自动授予**。如果点开弹出窗口顶部出现红色提示
"Site access is not granted yet"，点击 **Grant site access** 按钮授权；
也可以在扩展面板（拼图图标 → 齿轮）里选择"在所有网站上运行"。
未授权时内容脚本不会注入、Accept-Language 头也不会被改写。

## 用 https://fuck-claude.vercel.app/ 验证

上游仓库的 `docs/images/` 里自带该站的前后对比截图，验证方法相同：

1. 先连接代理 / VPN（扩展读取的是**出口 IP**，本机直连时只能看到本地结果）
2. 打开 https://fuck-claude.vercel.app/
3. 检查页面的 Intl 检测项，应全部与出口 IP 所在国家一致：
   - `Intl.DateTimeFormat().resolvedOptions().locale` → 出口国语言（如出口在日本 → `ja-JP`）
   - `Intl.DateTimeFormat().resolvedOptions().timeZone` → 出口国时区（如 `Asia/Tokyo`）
   - `Intl.NumberFormat().resolvedOptions().locale`、`Intl.Collator().resolvedOptions().locale`
   - `navigator.language` / `navigator.languages`
   - `new Date().getTimezoneOffset()`（DST 感知）
   - 地理位置坐标 → 出口 IP 附近的住宅街道点
4. 如页面已开过，**刷新（Ctrl+Shift+R 强刷）**后再看——注入发生在 document_start
5. 上游截图显示一致性评分可从 72/100 降到 1/100（特定环境的一次结果，仅供参考）

其他可交叉验证的页面：browserleaks.com/javascript（Intl/时区）、browserleaks.com/geolocation、
browserleaks.com/fonts。

## 相对上游的 Firefox 适配

| Chrome 版 | Firefox 版 |
|---|---|
| `background.service_worker` + `importScripts()` | MV3 事件页 `background.scripts`，lib 按序加载 |
| `chrome.*` 回调式 API | `browser.*` Promise 式 API |
| `onMessage` + `sendResponse` + `return true` | 监听器直接返回 Promise |
| host_permissions 仅列 IP 服务商 | `<all_urls>`（DNR modifyHeaders 需要），popup 内置一键授权 |
| `minimum_chrome_version` | `browser_specific_settings.gecko`（id + strict_min_version 128） |

`content-inject.js`（MAIN world 注入器）、`lib/`（时区 / 地理 / locale / 字体掩码）与上游逐字节一致，
仅 background / bridge / popup 三处按 Firefox API 形态改写；DNR 规则加了 `urlFilter:'*'`
不被接受时的降级重试。

## 已知限制（与上游相同）

- 不影响操作系统设置、Claude Code / CLI 等浏览器外的进程，以及 DNS / TLS 指纹
- Web Workers 内的 `Intl` / `Date` 不会被改写（内容脚本不进入 worker）
- `Date.prototype.toString()` 的时区缩写仍取本机（上游同样未覆盖；fuck-claude 站以 `Intl` 为准）
- `about:` 等特权页面不注入

## 测试

```bash
node test/run-tests.js     # 12 个单测：时区偏移、locale 推断、字体掩码、manifest 结构
node test/inject-smoke.js  # 注入器冒烟：同步 bootstrap 不泄漏本机时区
```
