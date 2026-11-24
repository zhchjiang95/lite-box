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

## 环境变量说明

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 服务监听端口 |
| `HOST` | `0.0.0.0` | 服务绑定地址 |
| `DIST_DIR` | 自动探测（`./public` → `../dist`） | 显式指定前端静态产物目录 |
| `ENABLE_COMPRESSION` | `true` | 是否开启 Brotli + Gzip 压缩；若前置 Nginx / Cloudflare 已统一压缩可设为 `false` |

## 目录架构（零第三方依赖模块化分层）

```text
server/
├─ index.mjs              # 入口：HTTP 服务启动、路由分发、WS 挂载与优雅退出
├─ lib/
│  ├─ http.mjs            # 公共安全头、sendJson/sendText 与并发池控制器
│  ├─ cache.mjs           # 通用 TTL + 容量上限内存缓存（带统计与防阻塞退出定时器）
│  └─ static.mjs          # Brotli/Gzip 静态资源托管、64MB 压缩热缓存与 SPA/PWA 回退
├─ routes/
│  ├─ speedtest.mjs       # /api/speedtest/* 局域网与自建节点网速测试接口
│  └─ sporttery.mjs       # /api/sporttery/results（兼容 /api/matches/results）体彩赛果代理与缓存
└─ signaling.mjs          # /ws/lan 局域网设备发现、WebRTC 信令与极端网络中转兜底
```

## 内置特性

- **Brotli（优先）+ Gzip 智能压缩 + 64 MB 内存热缓存**：JS / CSS / WASM / SVG 传输体积减少 70%–80%，重复请求零压缩 CPU 开销。
- **PWA 友好缓存**：`assets/*` 带哈希资源 1 年 `immutable` 强缓存；`index.html`、`sw.js`、`registerSW.js`、`manifest.webmanifest` 禁止强缓存以确保发版即更新。
- **SPA 路由回退**：直接刷新 `/tools/:id`、`/category/:id` 自动回退到 `index.html`，缺失的 `.js/.png` 等资源准确返回 `404`；未知 `/api/*` 请求明确返回 JSON `404`。
- **安全与运维**：路径穿越防护、安全响应头、`ETag` 304 协商缓存、`GET /healthz` 健康检查（含内存缓存与信令实时统计）与 `SIGINT`/`SIGTERM` 优雅退出。
- **零依赖原生 WebSocket 局域网信令（`ws://<host>/ws/lan`）**：见 `signaling.mjs`，支持按 `?channel=` 隔离不同局域网工具频道（`transfer` 隔空快传、`screen` 无线投屏、`clipboard` 共享剪贴板等），提供同局域网自动发现、唯一随机设备代号、投屏直播状态广播、离开即焚的内存剪贴板同步、6 位配对码跨网房间、WebRTC 信令交换以及极端网络下的纯内存二进制流中转兜底（绝不落盘）。若前置使用 Nginx 反向代理，请为 `/ws/lan` 配置 `Upgrade` / `Connection "upgrade"` 与 `X-Forwarded-For` 头。
- **内置局域网/自建服务器测速接口（`/api/speedtest/*`）**：提供 `GET /api/speedtest/ping`（延迟探针）、`GET /api/speedtest/down?bytes=...`（不可压缩随机字节流下行，单次上限 64MB）与 `POST /api/speedtest/up`（纯内存接收丢弃上行），供前端「设备信息与网速测试」工具实测局域网千兆或自建服务器双向带宽。若前置 Nginx 反向代理，建议对该路径关闭 `gzip` 与 `proxy_request_buffering off` 以免影响实时测速精度。
- **体彩赛果大宽表代理接口（`GET /api/sporttery/results`，兼容 `/api/matches/results`）**：代理中国体育彩票官方竞彩网完赛开奖数据，支持 `startDate`、`endDate`、`leagueId`、`pageNo`、`pageSize`、`refresh=1` 参数；内置 90 天最大跨度自动保护、单场 SP 并发池限流（并发 6 + 8s 超时）与双层内存缓存（完赛单场赔率 24 小时、列表分页 5 分钟）。
