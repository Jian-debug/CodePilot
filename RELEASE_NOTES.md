## CodePilot v0.55.0

> Swarm 多 Agent 全自动编排模式 — 支持层级/流水线/自主循环三种拓扑，执行中支持用户实时干预，完成后通过飞书/应用内通知推送结果，并附带完整的工具、Skill、外部能力调用统计。

### 新增功能

- **Swarm 多 Agent 编排** — 在聊天页面底部新增 Swarm 按钮，支持三种拓扑模式：自主循环（默认）、层级（Planner → Coder）、流水线。配置模型、最大迭代次数、跳过确认等参数后一键启动
- **运行时编排面板** — 实时显示 Agent 卡片状态、任务管线进度、通信日志（支持批量渲染、过滤、时间戳、hover 暂停滚动）
- **执行中实时干预** — Swarm 运行面板底部新增输入框，用户可随时发送指令，Agent 在下一轮迭代中响应
- **飞书通知** — Swarm 完成/失败/停止时自动通过飞书发送通知，复用现有飞书 outbound 通道，支持 post 格式富文本渲染
- **执行统计** — 完成后展示完整的统计明细：工具调用（次数/成功/失败/平均耗时）、Skill 调用列表、外部能力明细、Agent 分维度统计
- **执行历史** — localStorage 存储最近 10 次 Swarm 执行记录，对话框中可查看过往执行摘要
- **NVIDIA Provider** — 新增 NVIDIA API Catalog 服务商预设

### 修复问题

- **Stats 收集为空** — `tool_use` 和 `tool_result` 的 key 不匹配导致工具调用统计丢失，统一按 `tool_use_id` 匹配
- **迭代计数始终为 0** — 通知回调中字段名拼写错误，改为 `iterationCount`
- **飞书通知中文乱码** — Feishu client 缺少 `domain` 参数，且绕过 `sendMessage` 直接调 SDK 导致编码异常
- **post 格式缺少 title** — `sendAsPost` 函数中 `zh_cn` 对象缺少 title 字段，飞书渲染异常
- **新对话页 Swarm 按钮 disabled** — 无消息时按钮被禁用，改为可用并引导用户先发消息

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.55.0/CodePilot-0.55.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.55.0/CodePilot-0.55.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.55.0/CodePilot.Setup.0.55.0.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

---

## CodePilot v0.54.0

> 本版本补齐服务商生态：新增 DeepSeek 独立预设，OpenAI OAuth 加入 GPT-5.5，小米 MiMo 两个套餐升级到 V2.5-Pro，同时修掉切换服务商时的环境变量残留问题。

### 新增功能

- **DeepSeek 服务商** — 在服务商列表里新增 DeepSeek 独立预设，走官方 Anthropic 兼容端点 `api.deepseek.com/anthropic`，只需填 Key 即用。默认主模型 DeepSeek V4 Pro，Haiku 档位映射到更便宜的 DeepSeek V4 Flash，压缩/总结这类辅助调用能自动走便宜档
- **OpenAI OAuth 支持 GPT-5.5** — ChatGPT Plus/Pro 授权登录后，模型下拉里新增 GPT-5.5（排在 GPT-5.4 之上），新会话未指定模型时默认用 GPT-5.5

### 修复问题

- **切换服务商时环境变量残留** — 之前如果用户在系统环境里设过 DeepSeek 文档里的 `CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK` / `CLAUDE_CODE_EFFORT_LEVEL`，切到其它服务商后这两个变量仍会带到子进程里，影响其它服务商的请求行为。现在切换服务商时会连同这两个 key 一起清掉，避免跨服务商污染

### 优化改进

- **小米 MiMo 升级到 V2.5-Pro** — 按量付费和 Token Plan 两个预设里的默认模型从 `mimo-v2-pro` 全部切到 `mimo-v2.5-pro`，界面上显示名也同步更新为 MiMo-V2.5-Pro

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.54.0/CodePilot-0.54.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.54.0/CodePilot-0.54.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.54.0/CodePilot.Setup.0.54.0.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter 等）
- 推荐安装 Claude Code CLI 以获得完整功能
