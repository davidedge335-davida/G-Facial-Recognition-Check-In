# ==========================================
# 阶段 1：构建前端静态产物 (Node.js)
# ==========================================
FROM node:20-slim AS frontend-builder

WORKDIR /app

# 复制前端依赖清单并安装
COPY package*.json ./
RUN npm install

# 复制前端源码并执行 Vite 生产构建
COPY index.html tsconfig*.json vite.config.ts ./
COPY src/ ./src/
COPY public/ ./public/
COPY *.png ./

RUN npm run build

# ==========================================
# 阶段 2：生产运行环境 (Python 3.10 + FastAPI)
# ==========================================
FROM python:3.10-slim

WORKDIR /app

# 安装 OpenCV / InsightFace 运行所需的动态链接库
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 复制 Python 依赖清单并安装
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 复制后端代码
COPY backend/ ./backend/

# 从阶段 1 复制已构建的前端静态产物至 dist 目录
COPY --from=frontend-builder /app/dist ./dist

# 创建持久化数据与头像目录
RUN mkdir -p /app/backend/data/avatars

# 声明对外提供服务的端口
ENV PORT=8000
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# 启动服务：FastAPI 同时承担 API 路由与前端静态 SPA 服务
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
