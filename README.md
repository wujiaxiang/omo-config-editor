# OMO Config Editor

一个 Web UI 工具，用来编辑 OpenCode 的 agent/category 模型映射（OMO JSON）和 Claude Code Router 的路由降级链配置（CCR SQLite）。

## 项目背景

这个工具运行在 **CT105**（Proxmox VE LXC 容器，IP `192.168.2.128`）上，是该环境内 Claude Code + CCR 网关体系的一部分。

### 架构位置

```
用户
  │
  ├── OpenCode (OMOC) ← 主对话框架
  │     └── OMO JSON (~/.config/opencode/oh-my-openagent.json)
  │           ↑ 本工具编辑此文件
  │
  └── Claude Code Router (CCR) ← 模型路由网关
        └── Config SQLite (~/.claude-code-router/config.sqlite)
              ↑ 本工具也编辑此文件（通过 RPC）
```

- **OpenCode**：当前正在运行的主 AI 对话框架（替代传统 Claude Code）
- **OMO (oh-my-openagent)**：OpenCode 的 agent 模型映射系统，用 JSON 强约束每个 agent 使用哪个模型
- **CCR (Claude Code Router)**：模型路由网关，接收上游请求路由到具体 provider（qclaw / opencode-go / bmwcopilot 等），并支持失败降级链

### 为什么需要这个工具

1. OMO JSON 手动编辑麻烦且容易格式错误
2. CCR 的 SQLite 不能直接手写（绕过 schema 校验会触发自愈清空）
3. 两个配置分别在两个地方，分开查效率低且容易配错
4. 需要一个可视化界面统一管理"哪个 agent 用哪个模型"和"这个模型走哪个 provider / 有没有降级"

## 功能

- **OMO Config tab**：编辑 `~/.config/opencode/oh-my-openagent.json`
  - 列出所有 agent / category
  - 为每个条目选择模型 + variant（从 `opencode models` 实时拉取）
  - 模型列表缓存 5 分钟
- **CCR Models tab**：编辑 CCR 的路由规则和降级链
  - Opus / Sonnet / Haiku 三条降级链的可视化编辑
  - Provider → Model 两级联动选择器
  - 自动补全 condition（`==` + 全名）、rewrites（激活规则所必需）、profile 映射
  - 重试次数（retryCount）可调

## 文件结构

```
omo-config-editor/
├── README.md           ← 本文件（背景 + 快速参考）
├── AGENTS.md           ← Agent 用文档（字段设计原因 + 技术细节）
├── server.js           ← Express 后端，提供 API
├── public/
│   └── index.html      ← 前端页面（纯 HTML/JS，无需构建）
└── package.json
```

## 快速启动

```bash
# 安装依赖（只需一次）
cd /root/omo-config-editor
npm install

# systemd 管理（推荐）
systemctl restart omo-config-editor

# 访问
# http://192.168.2.128:34560
```

## 参考文档（不在本 Git 库内）

以下文档位于 CT105 环境中，提供完整的背景知识：

| 文档 | 位置 | 内容 |
|---|---|---|
| 环境总览 | `/root/CT105-README.md` | 容器索引、PVE 命令、已知坑 |
| CCR 配置详解 | `/root/CT105-docs/containers/ccr-claude-code-router.md` | Provider / Rules / Profile 完整字段说明、8 个已知坑、架构边界 |
| 排查方法论 | `/root/CT105-docs/系统化排查方法论.md` | 复杂问题排查的标准流程、证据金字塔、反模式 |
| OpenCode 配置 | `~/.config/opencode/oh-my-openagent.json` | OMO JSON 原始文件 |

## 架构约束（重要）

- ✅ 通过 CCR RPC 读写 SQLite（saveConfig / getConfig）
- ✅ 通过 HTTP API 读写 OMO JSON
- ❌ **不直接写 SQLite**（绕过 schema 校验会触发 CCR 自愈清空）
- ❌ **不写 `~/.claude/settings.json`**（越界，应通过 CCR gateway 启动时自动同步）
- ❌ **不作为通用管理后台**——只管理 CCR 配置和 OMO 配置，不管理 CC 客户端

## 设计决策摘要

| 决策 | 原因 |
|---|---|
| condition 用 `==` + 全名 | CCR 的 `Nm()` 不识别 `ends-with`，会 strip 成 null |
| 每条 rule 自动补 rewrites | condition 规则无 rewrites 则 `active=false`，整个规则被跳过 |
| retryCount 可调 | 控制每个模型失败后的 HTTP 重试次数，只对 5xx/超时生效，429 不重试 |
| 降级链 models 用全名 | 避免裸名路由回绕到已失败的 provider |
| RPC 优先，SQLite 只用做读 fallback | 直接写 SQLite 绕过了 schema 校验，曾多次触发自愈清空 |

详见 `AGENTS.md` 逐字段解释。
