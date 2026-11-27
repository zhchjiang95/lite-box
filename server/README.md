# 轻匣（LiteBox）独立部署服务

基于 Node.js（≥ 20）原生模块实现的零依赖静态部署服务，独立于前端工程运行，无需额外安装 `node_modules`。

## 快速启动

### 方式一：在本仓库内直接托管前端 `dist/`

```bash
# 1. 先在仓库根目录构建前端产物
pnpm build

# 2. 进入独立服务目录启动（默认自动读取 ../dist）
cd server
node index.mjs
# 或 pnpm start
```

### 方式二：单独拷贝 `server/` 目录到服务器部署

1. 在本地执行 `pnpm build` 生成前端 `dist/`；
2. 仅将本 `server/` 目录上传至服务器，并把 `dist/` 内的所有文件拷贝到 `server/public/`；
3. 在服务器启动服务（自动优先识别 `./public`）：

```bash
cd server
PORT=8080 node index.mjs
```

## 配置文件与环境变量说明

推荐直接通过 **`server/config.json`** 进行配置（已加入 `.gitignore`，不会误提交你的口令到 Git）：

```powershell
cd server
copy config.example.json config.json   # macOS / Linux 请使用 cp
```

配置加载优先级：**环境变量（`process.env`） > `server/config.json`（或 `CONFIG_PATH` 指定路径） > 内置默认值**。

| `config.json` 字段 | 对应环境变量 | 默认值 | 说明 |
|---|---|---|---|
| `port` | `PORT` | `3000` | 服务监听端口 |
| `host` | `HOST` | `0.0.0.0` | 服务绑定地址 |
| `distDir` | `DIST_DIR` | 自动探测（`./public` → `../dist`） | 显式指定前端静态产物目录 |
| `enableCompression` | `ENABLE_COMPRESSION` | `true` | 是否开启 Brotli + Gzip 压缩；若前置 Nginx / Cloudflare 已统一压缩可设为 `false` |
| `trustProxy` | `TRUST_PROXY` | `false` | 是否信任反代头 `X-Forwarded-For`；直接端口转发保持 `false` 防伪造 IP 绕过限次，前置 Nginx/Caddy 时设为 `true` |
| `adminToken` | `ADMIN_TOKEN` | 空 | 通用站主主口令（未单独配置 `magnet.token` / `tts.token` / `logging.statsToken` 时自动作为兜底口令） |
| `magnet.enabled` | `ENABLE_MAGNET` | `true` | 是否启用 `/api/magnet/*` 磁力边下边播模块（未安装 `webtorrent` 时自动降级禁用，不影响其他零依赖能力） |
| `magnet.token` | `MAGNET_TOKEN` | 兜底复用 `adminToken` | **严格私有门禁**：无口令直接 `401` 拒绝访问，外网端口转发强烈建议配置 |
| `magnet.cacheDir` | `MAGNET_CACHE_DIR` | 系统临时目录 `litebox-magnet` | 临时缓存目录，Windows 空间紧张时可指向大盘符如 `"D:/LiteBoxMagnetCache"` |
| `magnet.idleMinutes` | `MAGNET_IDLE_MINUTES` | `30` | 单任务无播放/拉流后自动销毁并删除磁盘缓存的超时分钟数 |
| `magnet.maxTasks` | `MAGNET_MAX_TASKS` | `2` | 同时保留的最大磁力任务数（超限时自动清理最久未用任务释放磁盘） |
| `magnet.uploadLimitBytes` | `MAGNET_UPLOAD_LIMIT` | `524288`（512 KB/s） | BT 上传限速字节/秒，防止家用宽带上行被打满（`-1` 为不限速） |
| `magnet.downloadLimitBytes` | `MAGNET_DOWNLOAD_LIMIT` | `-1`（不限速） | BT 下载限速字节/秒 |
| `magnet.ffmpegPath` | `FFMPEG_PATH` | `ffmpeg` | 自定义本机 `ffmpeg` 可执行文件路径（用于 MKV / AC3 / H.265 兼容流式转码） |
| `tts.enabled` | `ENABLE_TTS` | `true` | 是否启用 `/api/tts/*` Edge 神经语音合成模块（未安装 `msedge-tts` 时自动降级禁用） |
| `tts.token` | `TTS_TOKEN` | 兜底复用 `adminToken` | **无限解锁口令**：未输口令按自然天免费限额放行，输入此口令后解除次数与字数限制 |
| `tts.dailyFreeLimit` | `TTS_DAILY_FREE_LIMIT` | `3` | 每 IP 每自然天免费合成次数（持久化于 `logs/quota-YYYY-MM-DD.json`；`0`=纯口令模式，`-1`=不限次） |
| `tts.freeMaxChars` | `TTS_FREE_MAX_CHARS` | `1000` | 未解锁免费体验时的单次合成字数上限 |
| `tts.maxChars` | `TTS_MAX_CHARS` | `15000` | 口令解锁后的单次合成最大字数上限 |
| `stream.enabled` | `ENABLE_STREAM_PROXY` | `true` | 是否启用 `/api/stream/*` 视频与直播流跨域/防盗链代理 |
| `stream.token` | `STREAM_TOKEN` | 兜底复用 `adminToken` | **严格私有门禁**：代理视频/直播流需校验口令，防陌生人白嫖服务器带宽 |
| `stream.allowPrivateIp` | `STREAM_ALLOW_PRIVATE_IP` | `false` | 默认拦截私网/环回 IP 防 SSRF；如需代理局域网摄像头或内网 IPTV 源可设为 `true` |
| `stream.maxConcurrent` | `STREAM_MAX_CONCURRENT` | `16` | 同时活跃的流媒体代理连接上限 |
| `logging.enabled` | `LOG_ENABLED` | `true` | 是否启用访问日志与按 IP/功能维度聚合统计 |
| `logging.dir` | `LOG_DIR` | `./logs`（`server/logs`） | 日志与统计文件落盘目录（Windows 可指向其他盘符如 `"D:/LiteBoxLogs"`） |
| `logging.retentionDays` | `LOG_RETENTION_DAYS` | `14` | 按天轮转并自动清理超过指定天数的过期日志，严控磁盘空间 |
| `logging.console` | `LOG_CONSOLE` | `true` | 是否在终端同步输出单行中文功能访问日志 |
| `logging.logStaticAssets` | `LOG_STATIC_ASSETS` | `false` | 是否记录 `.js/.css/.png` 等静态碎片（默认关闭，仅记录业务接口、工具页、WS 与 4xx/5xx 异常） |
| `logging.statsToken` | `LOG_STATS_TOKEN` | 自动复用 `magnet.token` / `tts.token` | 保护 `/api/admin/logs/summary` 统计查询接口的口令；全未配置时仅允许本机 `127.0.0.1` 访问 |
| — | `CONFIG_PATH` | `server/config.json` | 可选，显式指定外部 JSON 配置文件路径 |

## 目录架构（核心零依赖 + 可选扩展模块化分层）

```text
server/
├─ index.mjs              # 入口：HTTP 服务启动、路由分发、WS 挂载与优雅退出
├─ config.example.json    # 服务端配置模板（复制为 config.json 生效，已在 .gitignore 中忽略）
├─ lib/
│  ├─ config.mjs          # 统一配置加载器（环境变量 > server/config.json > 默认值）
│  ├─ logger.mjs          # 按天轮转访问日志（JSONL 明细 + 按 IP/功能聚合统计 JSON）与运维查询接口
│  ├─ quota.mjs           # 零数据库按自然天 + IP 配额持久化模块（quota-YYYY-MM-DD.json）
│  ├─ http.mjs            # 公共安全头、sendJson/sendText 与并发池控制器
│  ├─ cache.mjs           # 通用 TTL + 容量上限内存缓存（带统计与防阻塞退出定时器）
│  └─ static.mjs          # Brotli/Gzip 静态资源托管、64MB 压缩热缓存与 SPA/PWA 回退
├─ routes/
│  ├─ speedtest.mjs       # /api/speedtest/* 局域网与自建节点网速测试接口
│  ├─ sporttery.mjs       # /api/sporttery/results（兼容 /api/matches/results）体彩赛果代理与缓存
│  ├─ magnet.mjs          # /api/magnet/* 磁力/种子按需流媒体、ffmpeg 兼容转码与省磁盘缓存管理
│  ├─ tts.mjs             # /api/tts/* Edge 神经语音 MP3 合成、多角色拼接与同步 SRT 字幕（零落盘）
│  └─ stream.mjs          # /api/stream/* 视频/直播流跨域与防盗链代理（自动重写 M3U8、SSRF 防护）
└─ signaling.mjs          # /ws/lan 局域网设备发现、WebRTC 信令与极端网络中转兜底
```

## 磁力在线播放（Windows 部署与安全指南）

磁力流媒体依赖可选包 `webtorrent`（需要 Node.js ≥ 22，已内置 `pnpm.onlyBuiltDependencies` 自动拉取预编译二进制，无需装 C++ 编译器）。如不需要磁力功能，直接 `node index.mjs` 即可零依赖运行全部其余能力。

```powershell
# 1. 安装可选依赖（仅首次需要）
cd server
pnpm install

# 2. 复制配置文件模板，用记事本/VSCode 修改 magnet.token（强口令）与 magnet.cacheDir（大空间盘符）
copy config.example.json config.json

# 3. 直接启动服务（自动读取 server/config.json）
node index.mjs
```

`server/config.json` 示例（Windows 路径推荐使用正斜杠 `/` 或双反斜杠 `\\`）：

```json
{
  "port": 3000,
  "host": "0.0.0.0",
  "magnet": {
    "enabled": true,
    "token": "替换为你自己的高强度口令",
    "cacheDir": "D:/LiteBoxMagnetCache",
    "idleMinutes": 20,
    "maxTasks": 2,
    "uploadLimitBytes": 524288
  }
}
```

> **外网端口转发安全与省磁盘提示**：
> - **强口令与安全接入**：端口转发暴露公网时**务必设置 `MAGNET_TOKEN`**，否则被扫到端口会导致宽带与磁盘被他人盗用；如仅自己远程访问，更推荐配合 **Tailscale / ZeroTier** 异地组网或前置 HTTPS（如 Caddy / Nginx）加密传输口令。
> - **省磁盘机制**：添加种子后默认取消全部文件下载，仅在播放选中视频时按需拉取进度附近分片；切集自动释放旧文件优先级，停止任务、空闲超时、服务启动与退出时均自动删除临时缓存文件。
> - **格式兼容**：若本机 PATH 已安装 `ffmpeg`（Windows 可通过 `winget install Gyan.FFmpeg` 一键安装），遇到 MKV / H.265 / AC3 音频浏览器无声或黑屏时可在界面切换「轻转封装」或「H.264 兼容」；也可直接点击页面按钮唤起 **PotPlayer / VLC / IINA** 零转码硬解直连播放。

## 内置特性

- **Brotli（优先）+ Gzip 智能压缩 + 64 MB 内存热缓存**：JS / CSS / WASM / SVG 传输体积减少 70%–80%，重复请求零压缩 CPU 开销。
- **PWA 友好缓存**：`assets/*` 带哈希资源 1 年 `immutable` 强缓存；`index.html`、`sw.js`、`registerSW.js`、`manifest.webmanifest` 禁止强缓存以确保发版即更新。
- **SPA 路由回退**：直接刷新 `/tools/:id`、`/category/:id` 自动回退到 `index.html`，缺失的 `.js/.png` 等资源准确返回 `404`；未知 `/api/*` 请求明确返回 JSON `404`。
- **安全与运维**：路径穿越防护、安全响应头、`ETag` 304 协商缓存、`GET /healthz` 健康检查（含内存缓存与信令实时统计）与 `SIGINT`/`SIGTERM` 优雅退出。
- **零依赖原生 WebSocket 局域网信令（`ws://<host>/ws/lan`）**：见 `signaling.mjs`，支持按 `?channel=` 隔离不同局域网工具频道（`transfer` 隔空快传、`screen` 无线投屏、`clipboard` 共享剪贴板等），提供同局域网自动发现、唯一随机设备代号、投屏直播状态广播、离开即焚的内存剪贴板同步、6 位配对码跨网房间、WebRTC 信令交换以及极端网络下的纯内存二进制流中转兜底（绝不落盘）。若前置使用 Nginx 反向代理，请为 `/ws/lan` 配置 `Upgrade` / `Connection "upgrade"` 与 `X-Forwarded-For` 头。
- **内置局域网/自建服务器测速接口（`/api/speedtest/*`）**：提供 `GET /api/speedtest/ping`（延迟探针）、`GET /api/speedtest/down?bytes=...`（不可压缩随机字节流下行，单次上限 64MB）与 `POST /api/speedtest/up`（纯内存接收丢弃上行），供前端「设备信息与网速测试」工具实测局域网千兆或自建服务器双向带宽。若前置 Nginx 反向代理，建议对该路径关闭 `gzip` 与 `proxy_request_buffering off` 以免影响实时测速精度。
- **体彩赛果大宽表代理接口（`GET /api/sporttery/results`，兼容 `/api/matches/results`）**：代理中国体育彩票官方竞彩网完赛开奖数据，支持 `startDate`、`endDate`、`leagueId`、`pageNo`、`pageSize`、`refresh=1` 参数；内置 90 天最大跨度自动保护、单场 SP 并发池限流（并发 6 + 8s 超时）与双层内存缓存（完赛单场赔率 24 小时、列表分页 5 分钟）。
