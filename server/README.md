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

## 内置特性

- **Brotli（优先）+ Gzip 智能压缩 + 64 MB 内存热缓存**：JS / CSS / WASM / SVG 传输体积减少 70%–80%，重复请求零压缩 CPU 开销。
- **PWA 友好缓存**：`assets/*` 带哈希资源 1 年 `immutable` 强缓存；`index.html`、`sw.js`、`registerSW.js`、`manifest.webmanifest` 禁止强缓存以确保发版即更新。
- **SPA 路由回退**：直接刷新 `/tools/:id`、`/category/:id` 自动回退到 `index.html`，缺失的 `.js/.png` 等资源准确返回 `404`。
- **安全与运维**：路径穿越防护、安全响应头、`ETag` 304 协商缓存、`GET /healthz` 健康检查与 `SIGINT`/`SIGTERM` 优雅退出。
