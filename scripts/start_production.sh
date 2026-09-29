#!/usr/bin/env bash
set -e

echo "📦 [1/2] 构建前端生产环境静态产物..."
npm run build

echo "🚀 [2/2] 启动 FastAPI 统一生产服务 (托管 API 与前端 SPA 静态页面)..."
PORT=${PORT:-8000}
python -m uvicorn backend.main:app --host 0.0.0.0 --port "$PORT"
