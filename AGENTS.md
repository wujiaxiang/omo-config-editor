# OMO Config Editor

一个双用途的 Web UI 配置编辑器：

1. **OMO Agent/Category 配置**：编辑 `~/.config/opencode/oh-my-openagent.json`
2. **CCR 路由降级链配置**：编辑 CCR 的 Provider/Profile/Rules（通过 RPC → SQLite）

---

## 背景：为什么需要这两个功能在一起

OMO（oh-my-openagent）是 OpenCode 的 agent 编排系统，CCR（Claude Code Router）是模型路由网关。OMO Config Editor 把它们放在一个 UI 里是因为：

- **用户需要在一个地方看到"哪个 agent 用了哪个模型"和"这个模型走哪个 provider / 有没有降级"**
- 分开查 OMO 的 JSON 和 CCR 的 SQLite 效率很低，且容易配错（改了一边忘了改另一边）
- **边界约束**：OMO 只通过 CCR RPC 写 CCR 配置，不直接写 SQLite（绕过 schema 校验会触发 CCR 自愈清空），不写 `~/.claude/settings.json`（越界）

---

## 各字段保存的背景和原因

### CCR 降级链部分（CCR Models tab）

每个模型（Opus/Sonnet/Haiku）有一个 rules 条目，保存时写入以下字段：

| 字段 | 为什么要存 | 背景知识 |
|---|---|---|
| `condition` | 匹配 CC 发来的请求模型名 | 必须用 `==` + 全名（如 `opencode-zen/mimo-v2.5-free`），不能用 `ends-with`。CCR 的 `Nm()` 只认 `==`，`ends-with` 会被 strip 成 null。 |
| `fallback.models` | primary 失败时按顺序尝试的模型 | 用全名（含 provider 前缀），避免裸名路由回绕到已失败的 provider。 |
| `rewrites` | **激活 condition 规则** | CCR 的 `pTe()` 中，condition 规则无 `rewrites` 则 `active=false`，整个规则（含 fallback）被跳过。所以必须加一条无害 rewrite，如 `{"key":"request.body.model","operation":"set","value":"..."}`。 |
| `retryCount` | 每个模型失败后的 HTTP 重试次数 | 仅对可恢复错误（5xx/超时）生效。429（额度不足）直接跳过重试换下一个模型。 |
| `profile.claudeCode.xxModel` | CC 读取的模型别名映射 | CC 通过这个字段知道 "haiku 对应哪个模型"。必须填全名（如 `opencode-zen/mimo-v2.5-free`），不能填裸名。 |

### 为什么不写 `~/.claude/settings.json`

CCR 的 `saveConfig` RPC 不负责同步 settings.json。settings.json 只在 gateway 启动时（`Sr.start → Mi → C5`）由 `C5` 做差异比对后同步写入。OMO 作为 CCR 的配置编辑器，**不应越界写 CC 客户端的配置**。

正确的做法是：CC 始终发固定的模型名，路由逻辑全在 CCR 条件链里做，settings.json 不需要改。

---

## 目录结构

```
omo-config-editor/
├── server.js        # Express 后端，提供 API
├── public/
│   └── index.html   # 前端页面（纯 HTML/JS，无需构建）
└── package.json
```

## 启动方式

### 1. 安装依赖（只需一次）

```bash
cd /root/omo-config-editor
npm install
```

### 2. 启动服务

```bash
# systemd 管理（推荐）
systemctl restart omo-config-editor

# 或 tmux（调试用）
tmux new-session -d -s omo-editor -c /root/omo-config-editor "node server.js"
```

### 3. 访问

浏览器打开：
```
http://192.168.2.128:34560
```

## 常用操作

**查看是否在运行：**
```bash
systemctl is-active omo-config-editor
curl -s http://127.0.0.1:34560/api/config | head -c 100
```

**重启服务：**
```bash
systemctl restart omo-config-editor
```

**查看日志：**
```bash
journalctl -u omo-config-editor --no-pager -n 50
systemctl status omo-config-editor
```

## API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 前端页面 |
| GET | `/api/config` | 读取当前 OMO 配置 |
| GET | `/api/models` | 获取可用模型列表（缓存 5 分钟） |
| POST | `/api/config` | 保存 OMO 配置（JSON body，需包含 `agents` 和 `categories`） |
| GET | `/api/ccr/config` | 读取 CCR 配置（通过 RPC getConfig → SQLite fallback） |
| POST | `/api/ccr/config` | 保存 CCR 配置（通过 RPC saveConfig，不走 SQLite 直写） |
| GET | `/api/ccr/providers` | 获取 CCR provider 列表 |
| GET | `/api/ccr/routes` | 获取 CCR 路由规则列表 |

## 注意事项

- RPC token 来自 `/var/log/ccr-gateway.log`（每次 gateway 重启变化），`server.js` 自动提取
- **禁止直接写 SQLite**，必须通过 RPC（绕过 schema 校验会触发 CCR 自愈清空配置）
- 端口 `34560`，如需修改改 `server.js` 里的 `PORT`
- 详细 CCR 配置字段说明见 `CT105-docs/containers/ccr-claude-code-router.md`
