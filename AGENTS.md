# OMO Config Editor

一个用来通过网页动态编辑 `oh-my-openagent.json`（OMO agent/category 模型配置）的小工具。

## 功能

- 读取 `~/.config/opencode/oh-my-openagent.json`
- 拉取 `opencode models` 可用模型列表（缓存 5 分钟）
- 网页上给每个 agent / category 选模型 + variant
- 保存后直接写回配置文件（重启 OpenCode 生效）

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

### 2. 启动服务（推荐用 tmux，保证退出终端后仍在运行）

```bash
tmux new-session -d -s omo-editor -c /root/omo-config-editor "node server.js"
```

### 3. 访问

浏览器打开：

```
http://192.168.2.128:3456
```

## 常用操作

**查看是否在运行：**

```bash
tmux has-session -t omo-editor && echo "running" || echo "not running"
curl -s http://127.0.0.1:3456/api/config | head -c 100
```

**重启服务：**

```bash
tmux kill-session -t omo-editor 2>/dev/null
tmux new-session -d -s omo-editor -c /root/omo-config-editor "node server.js"
```

**停止服务：**

```bash
tmux kill-session -t omo-editor
```

**查看日志（进入 tmux 窗口）：**

```bash
tmux attach -t omo-editor
# Ctrl+B 然后按 D 退出但不停止服务
```

## API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/config` | 读取当前 OMO 配置 |
| GET | `/api/models` | 获取可用模型列表（缓存 5 分钟） |
| POST | `/api/config` | 保存配置（JSON body，需包含 `agents` 和 `categories`） |

## 注意事项

- 配置文件路径写死在 `server.js` 里的 `CONFIG_PATH`，默认是 `~/.config/opencode/oh-my-openagent.json`
- 保存后 OpenCode 需要重启才能生效
- 端口固定 `3456`，如需修改改 `server.js` 里的 `PORT`
- **不要用 `node server.js &` 直接扔后台**——shell 会话结束时可能被回收，务必用 `tmux` 或 `nohup` + `disown`
