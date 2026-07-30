const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec, execSync, spawnSync } = require('child_process');

const app = express();
const PORT = 34560;

const CONFIG_PATH = path.join(
  process.env.HOME || '/root',
  '.config/opencode/oh-my-openagent.json'
);

const CCR_DB_PATH = process.env.HOME + '/.claude-code-router/config.sqlite';
const CCR_RPC_URL = 'http://127.0.0.1:3458/api/ccr/rpc';

// --- CCR RPC 通信（比直接读写 sqlite 更可靠：自带校验 + 同步网关内存） ---

function ccrToken() {
  // service.json 只在 `ccr start`（detached daemon）模式下才会生成。
  // 我们的部署方式是 systemd 直接跑 `ccr serve --gateway`（前台/foreground 模式），
  // 这种模式不产生 service.json，token 只在启动日志里打印一次，每次重启都会变。
  // （2026-07-30 修复：之前假设 service.json 一定存在，导致 RPC 认证永远失败，
  //  每次保存都 fallback 到直接写 SQLite，这正是触发 CCR 自愈清空配置的高危操作。）
  const servicePath = process.env.HOME + '/.claude-code-router/service.json';
  if (fs.existsSync(servicePath)) {
    const raw = fs.readFileSync(servicePath, 'utf8');
    const token = new URL(JSON.parse(raw).url).searchParams.get('ccr_web_token');
    if (token) return token;
  }
  // Fallback: 从 ccr-gateway 的日志里提取最新一次打印的 token
  const logPath = '/var/log/ccr-gateway.log';
  if (fs.existsSync(logPath)) {
    const lines = fs.readFileSync(logPath, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i].match(/ccr_web_token=([A-Za-z0-9_-]+)/);
      if (m) return m[1];
    }
  }
  throw new Error('CCR web token not found in service.json or ccr-gateway.log');
}

function ccrRpc(method, args) {
  const payload = JSON.stringify({ method, args });
  const tmpFile = path.join(os.tmpdir(), `ccr-rpc-${Date.now()}.json`);
  try {
    fs.writeFileSync(tmpFile, payload);
    const result = execSync(
      `curl -s -X POST ${CCR_RPC_URL} -H "Content-Type: application/json" -H "x-ccr-web-auth: ${ccrToken()}" --data @${tmpFile}`,
      { encoding: 'utf8', timeout: 15000 }
    );
    return JSON.parse(result);
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

// 读取 CCR 配置：优先走 RPC getConfig（网关实时内存），失败则回退到 sqlite 直读
function ccrReadConfig() {
  const rpcResult = ccrRpc('getConfig', []);
  if (rpcResult.ok && rpcResult.value) {
    return rpcResult.value;
  }
  console.warn('CCR RPC 不可达，回退到 sqlite 直读:', rpcResult.error);
  try {
    const result = execSync(
      `sqlite3 "${CCR_DB_PATH}" "SELECT value_json FROM app_config WHERE key='default';"`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    return result ? JSON.parse(result) : null;
  } catch (e) {
    console.error('CCR 读取失败:', e.message);
    return null;
  }
}

// 写入 CCR 配置：强制走 RPC saveConfig（校验 + 同步网关内存）。
// 严禁 fallback 到直接写 SQLite —— 之前的 fallback 逻辑绕过了 CCR 自己的 schema 校验，
// 曾多次触发 CCR 内部自愈逻辑把整个配置清空（Providers 变 0），这是高危操作，禁止使用。
// RPC 失败时直接返回错误，并记录到专门的错误日志，交给人工排查 RPC 为什么不可达，
// 而不是静默降级到一个更危险的写入路径。
const CCR_RPC_ERROR_LOG = '/var/log/omo-config-editor-ccr-errors.log';

function logCcrRpcError(context, error) {
  const line = `[${new Date().toISOString()}] ${context}: ${error}\n`;
  try {
    fs.appendFileSync(CCR_RPC_ERROR_LOG, line);
  } catch (_) {}
  console.error(line.trim());
}

function ccrSaveConfig(config) {
  const rpcResult = ccrRpc('saveConfig', [config]);
  if (rpcResult.ok) {
    return { ok: true, viaRpc: true };
  }
  logCcrRpcError('ccrSaveConfig RPC failed (NOT falling back to sqlite write)', rpcResult.error);
  return { ok: false, viaRpc: false, error: rpcResult.error, rpcFailure: true };
}

// Cache models list (refresh every 5 min)
let modelsCache = null;
let modelsCacheTime = 0;
const MODELS_CACHE_TTL = 5 * 60 * 1000;

function refreshModels(callback) {
  exec('opencode models 2>/dev/null', {
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, PATH: process.env.PATH },
  }, (err, stdout) => {
    if (err) return callback(err);
    const models = stdout.split('\n').map(l => l.trim()).filter(Boolean);
    modelsCache = models;
    modelsCacheTime = Date.now();
    callback(null, models);
  });
}

// Pre-load models on startup
refreshModels((err) => {
  if (err) console.error('Models preload failed:', err.message);
  else console.log(`Cached ${modelsCache.length} models`);
});

// Express setup
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/config — read current config
app.get('/api/config', (req, res) => {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const config = JSON.parse(raw);
    res.json({ ok: true, config, path: CONFIG_PATH });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// GET /api/models — list available models (cached)
// 刷新失败时保留旧缓存，避免因为 opencode CLI 一时不可用导致前端拿不到任何模型列表
app.get('/api/models', (req, res) => {
  if (modelsCache && (Date.now() - modelsCacheTime < MODELS_CACHE_TTL)) {
    return res.json({ ok: true, models: modelsCache });
  }
  refreshModels((err, models) => {
    if (err) {
      if (modelsCache) {
        console.warn('Models refresh failed, returning stale cache:', err.message);
        return res.json({ ok: true, models: modelsCache, stale: true });
      }
      return res.json({ ok: false, error: err.message });
    }
    res.json({ ok: true, models });
  });
});

// POST /api/config — write config
app.post('/api/config', (req, res) => {
  try {
    const config = req.body;
    if (!config.agents || !config.categories) {
      return res.json({ ok: false, error: 'Missing agents or categories' });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
    res.json({ ok: true, message: 'Config saved', path: CONFIG_PATH });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// GET /api/ccr/config — read CCR config from SQLite
app.get('/api/ccr/config', (req, res) => {
  const config = ccrReadConfig();
  if (!config) {
    return res.json({ ok: false, error: 'CCR config not found or unavailable' });
  }
  res.json({ ok: true, config });
});

// POST /api/ccr/config — write CCR config via RPC saveConfig（自动同步网关）
app.post('/api/ccr/config', (req, res) => {
  const config = req.body;
  if (!config) {
    return res.json({ ok: false, error: 'No config provided' });
  }
  const result = ccrSaveConfig(config);
  if (result.ok) {
    const msg = result.viaRpc
      ? 'CCR config saved (via RPC, gateway synced live)'
      : 'CCR config saved (via sqlite fallback — restart CCR to apply: ccr stop && ccr start)';
    res.json({ ok: true, message: msg, viaRpc: result.viaRpc });
  } else {
    res.json({ ok: false, error: result.error });
  }
});

// GET /api/ccr/providers — list all providers from CCR config
app.get('/api/ccr/providers', (req, res) => {
  const config = ccrReadConfig();
  if (!config) {
    return res.json({ ok: false, error: 'CCR config not found' });
  }
  const providers = config.Providers || [];
  res.json({ ok: true, providers });
});

// GET /api/ccr/routes — get current route rules
app.get('/api/ccr/routes', (req, res) => {
  const config = ccrReadConfig();
  if (!config) {
    return res.json({ ok: false, error: 'CCR config not found' });
  }
  const routes = config.Router?.rules || [];
  res.json({ ok: true, routes });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OMO Config Editor running at http://0.0.0.0:${PORT}`);
  console.log(`Config file: ${CONFIG_PATH}`);
  console.log(`CCR database: ${CCR_DB_PATH}`);
});
