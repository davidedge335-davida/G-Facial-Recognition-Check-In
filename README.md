# 移动端人脸识别签到系统 (InsightFace + 飞书妙搭集成)

一套适配手机浏览器的移动端人脸识别签到系统，基于开源高精度算法 **InsightFace (ArcFace 模型)** 进行 512 维特征向量提取与余弦相似度极速比对，签到成功后自动同步推送到**飞书妙搭**。

---

## 核心技术特性

1. **向量化底座架构（严禁重复算图）**：
   - 人员照片录入时预先提取 **512 维归一化特征向量（Embedding）**，以紧凑二进制 BLOB 形式持久化至 SQLite。
   - 刷脸打卡时仅从当前截帧提取 1 个特征向量，与内存中的全部底库向量矩阵进行**单次点积（余弦相似度）运算**，毫秒级完成 1:N 比对。
2. **手机浏览器适配 (H5 WebRTC)**：
   - 适配手机竖屏比例，居中椭圆人脸取景参考框、对准十字标与动态扫描线。
   - 优先调起前置摄像头（`facingMode: "user"`），支持一键翻转后置镜头。
   - 截帧时前端自动压缩至 640×480 分辨率并转为轻量 Base64，兼顾移动端带宽与识别性能。
3. **防重复打卡机制**：
   - 默认 5 分钟（300 秒，可配置）冷却期。同一人员在冷却期内重复刷脸，提示“您已签到成功，请勿重复刷脸”，不触发飞书重复推送。
4. **飞书妙搭无缝对接**：
   - **方案 A（推荐，最轻量）**：通过飞书妙搭/工作流 Webhook 触发器，POST 结构化 JSON 数据入库。
   - **方案 B**：调用飞书开放平台“多维表格（Bitable）添加单条记录” API，支持自动获取与刷新 `tenant_access_token`。

---

## 项目工程结构

```text
├── backend/
│   ├── __init__.py
│   ├── config.py           # 系统参数（阈值、防重时间、路径配置）
│   ├── database.py         # SQLite 数据库模型、向量 BLOB 序列化与持久化 CRUD
│   ├── face_engine.py      # 基于 InsightFace 的 512 维向量提取与矩阵比对
│   ├── feishu_service.py   # 飞书妙搭 Webhook / Bitable API 封装
│   ├── main.py             # FastAPI 核心业务接口（/api/checkin, /api/users 等）
│   └── models.py           # Pydantic 数据模型定义
├── src/
│   ├── components/
│   │   ├── CameraView.tsx           # 移动端前置摄像头、椭圆取景框与自动/手动打卡
│   │   ├── CheckinResultModal.tsx   # 签到成功/重复防重/未匹配反馈卡片
│   │   ├── AdminPanel.tsx           # 人员录入/删除、飞书配置测试、流水审计
│   │   └── HttpsGuideModal.tsx      # 手机真机局域网调试与 HTTPS 指引
│   ├── utils/
│   │   └── faceMatcher.ts           # 帧压缩、特征向量提取与余弦比对工具
│   ├── App.tsx                      # 移动端主界面与全局状态
│   └── types.ts                     # TypeScript 类型定义
├── requirements.txt        # Python 依赖清单
└── package.json            # 前端依赖配置
```

---

## 启动与运行指南

### 1. 本地开发调试（前后端双进程）
```bash
# 启动前端开发服务器 (端口 3000)
npm run dev

# 启动 Python FastAPI 后端服务 (端口 8000)
pip install -r requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```
- 前端访问：`http://localhost:3000`（Vite 代理自动将 `/api` 与 `/avatars` 转发至 8000）
- 后端 Swagger 文档：`http://localhost:8000/docs`

---

## 生产环境部署方案（已闭环解决生产连通与初始化依赖问题）

### 方案 A：Docker / 容器化一键部署（推荐）
项目提供了多阶段构建的 `Dockerfile` 与 `docker-compose.yml`：
```bash
# 方式 1：使用 docker-compose 一键启动
docker compose up -d --build

# 方式 2：使用原生 Docker 构建并运行
docker build -t face-attendance .
docker run -d -p 8000:8000 -v $(pwd)/data:/app/backend/data --name face-app face-attendance
```
容器内完成前端静态构建并由 FastAPI 一并托管前端 SPA 与 API 服务，单一端口（8000）即可完整运行。

### 方案 B：统一生产脚本启动
```bash
# 构建前端并以生产模式启动 FastAPI
chmod +x scripts/start_production.sh
./scripts/start_production.sh
```

### 方案 C：Nginx 反向代理拓扑
若采用独立 Web 服务器管理静态资源，参考根目录下的 `nginx.conf`：
- 前端静态文件托管在 `/var/www/html/dist`，配置 `try_files $uri $uri/ /index.html`；
- `/api/` 与 `/avatars/` 统一反向代理至后端 `127.0.0.1:8000`。

### 方案 D：前后端分域/跨域独立部署
若前端部署于 Vercel / Netlify 等云平台，后端部署于独立 VPS：
- 构建前端时配置环境变量：`VITE_API_BASE_URL="https://your-backend-domain.com"`；
- 前端网络请求层已通过 `src/utils/api.ts` 统一管理，会自动拼接该 Base URL。

---

## 启动生命周期与健壮性设计
1. **模块导入解耦**：全局人脸单例 `FaceEngine` 实例化时不查询数据库，避免在全新环境下建表前查询 SQLite 抛出 `no such table: users`。
2. **生命周期保序**：由 FastAPI `lifespan` 严格按顺序执行：先执行 `init_db()` 完成建表与默认配置写入，再执行 `face_engine.reload_cache()` 加载内存向量底库。
3. **容错兜底**：`database.py` 中底层查询若遇到尚未初始化的 SQLite 表，自动捕获 `sqlite3.OperationalError` 并返回空列表，避免进程崩溃。

---

## 手机真机局域网调试注意事项（HTTPS 限制）

W3C 规范要求：除 `localhost` 外，手机浏览器调用 `navigator.mediaDevices.getUserMedia` 必须运行在 **HTTPS** 安全上下文下。

1. **AI Studio 预览**：原生自带 HTTPS 域名，手机扫码或浏览器直接打开即可调用摄像头。
2. **本地电脑局域网测试**：
   - 使用 `mkcert` 为本地 IP（如 `192.168.1.100`）签发自签证书，并在 Vite 中配置 `https: true`。
   - 或在安卓手机 Chrome 访问 `chrome://flags/#unsafely-treat-insecure-origin-as-secure`，将电脑局域网 IP 填入白名单后重启 Chrome。
