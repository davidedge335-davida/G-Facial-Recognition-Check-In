import os
import uuid
import asyncio
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from .config import settings, KNOWN_INSECURE_SECRET_KEYS
from .models import (
    UserCreate, UserResponse,
    CheckinRequest, CheckinResponse, MatchedUserInfo,
    FeishuConfig, FeishuConfigResponse, FeishuConfigUpdate, FeishuTestResponse,
    AttendanceLog, AdminLogin, TokenResponse,
    ChangePasswordRequest, AdminUserResponse,
    SyncRetryResponse, BatchSyncRetryResponse, SyncStatsResponse
)
from .database import (
    init_db, add_user, get_user_by_student_id, get_all_users, delete_user,
    is_recent_duplicate_checkin, add_attendance_log, get_recent_attendance_logs,
    atomic_record_checkin, update_attendance_log_feishu_status,
    get_feishu_config, save_feishu_config, clear_all_attendance_logs,
    verify_admin_password, update_admin_password, get_admin_credentials,
    get_or_create_jwt_secret, is_using_default_password, get_sync_statistics
)
from .face_engine import face_engine
from .feishu_service import feishu_service
from .auth import create_access_token, decode_access_token

security = HTTPBearer(auto_error=False)

async def verify_admin(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> Dict[str, Any]:
    """验证管理员 Bearer Token（严格校验签名和有效截止时间 exp），保护后台敏感接口"""
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少管理员 Token，请先登录后台",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_access_token(credentials.credentials)
    return payload

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时初始化数据库、人脸内存缓存并执行安全防伪自检"""
    print("🚀 启动人脸识别签到系统后台...")
    init_db()
    face_engine.reload_cache()

    # 1. 安全防伪自检：确保持久化实例级强随机 JWT 密钥，阻断公开仓库默认密钥伪造 Token 漏洞
    active_secret = get_or_create_jwt_secret()
    if settings.SECRET_KEY in KNOWN_INSECURE_SECRET_KEYS:
        print("🔒 [安全防护] 未检测到有效的环境变量 SECRET_KEY，系统已自动启用并持久化 SQLite 实例级 256 位防伪密钥，杜绝离线伪造 JWT。")

    # 2. 初始弱口令检查
    if is_using_default_password():
        print("⚠️ [安全预警] 系统当前正使用默认初始密码 (admin123)，请进入管理后台及时修改密码！")

    # 3. 启动后台 Outbox 同步自愈 Worker（每 30 秒轮询补偿同步网络抖动失败的记录）
    async def background_sync_worker():
        while True:
            try:
                await asyncio.sleep(30)
                cfg = get_feishu_config()
                if cfg.get("enabled", True):
                    await feishu_service.sync_all_failed_logs(limit=20)
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"后台同步队列扫描异常: {e}")

    sync_task = asyncio.create_task(background_sync_worker())

    yield

    sync_task.cancel()
    try:
        await sync_task
    except asyncio.CancelledError:
        pass
    print("🛑 正在关闭人脸识别签到系统后台...")

app = FastAPI(
    title=settings.APP_NAME,
    description="基于 InsightFace 512 维特征向量比对与飞书妙搭集成的移动端刷脸签到系统",
    version="1.0.0",
    lifespan=lifespan
)

# 允许跨域请求（方便局域网手机浏览器及开发环境调用）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载静态头像目录
app.mount("/avatars", StaticFiles(directory=settings.AVATARS_DIR), name="avatars")

# ----------------- 健康检查 -----------------
@app.get("/api/health")
async def health_check():
    return {
        "status": "online",
        "app_name": settings.APP_NAME,
        "cached_users_count": len(face_engine.cached_user_list),
        "similarity_threshold": settings.SIMILARITY_THRESHOLD,
        "timestamp": datetime.now().isoformat()
    }

# ----------------- 核心业务：移动端刷脸签到接口 -----------------
@app.post("/api/checkin", response_model=CheckinResponse)
async def checkin(request: CheckinRequest):
    """
    移动端人脸识别打卡接口
    1. 前端截取 640x480 单帧图像 Base64 上传
    2. 后端 InsightFace 提取 512 维特征向量
    3. 内存矩阵余弦相似度极速比对（杜绝重复读底库）
    4. 防重复打卡判定（5 分钟内重复签到提示且不推飞书）
    5. 异步推送到飞书妙搭（Webhook 或 多维表格 API）
    """
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 1. 提取当前人脸特征向量
    query_embedding, err = face_engine.extract_embedding(request.image_base64)
    if err or query_embedding is None:
        return CheckinResponse(
            success=False,
            code=400,
            message=err or "未能在画面中检测到有效人脸，请正对手机摄像头"
        )

    # 2. 余弦相似度比对
    threshold = request.threshold or settings.SIMILARITY_THRESHOLD
    matched_user, similarity, match_msg = face_engine.match_face(query_embedding, threshold=threshold)

    if not matched_user:
        return CheckinResponse(
            success=False,
            code=404,
            message="未匹配到人员，请联系管理员录入照片底库",
            similarity=round(similarity, 4)
        )

    user_info = MatchedUserInfo(
        id=matched_user["id"],
        name=matched_user["name"],
        student_id=matched_user["student_id"],
        department=matched_user["department"]
    )

    # 3. 数据库事务级原子防重判定与即时入库（多进程/多 Worker 强并发保护，无全局锁，绝不串行阻塞其他人员）
    is_duplicate, log_id, checkin_time, last_time = atomic_record_checkin(
        user_id=matched_user["id"],
        name=matched_user["name"],
        student_id=matched_user["student_id"],
        department=matched_user["department"],
        similarity=similarity,
        cooldown_seconds=settings.REPEAT_CHECKIN_COOLDOWN_SECONDS
    )

    if is_duplicate:
        return CheckinResponse(
            success=True,
            code=201,
            message=f"您已签到成功（上次签到时间：{last_time}），请勿重复刷脸！",
            user=user_info,
            similarity=round(similarity, 4),
            checkin_time=checkin_time,
            is_repeated=True,
            feishu_synced=False,
            feishu_message="处于防重复冷却期内，无需重复同步飞书"
        )

    # 4. 首次签到成功：推送至飞书妙搭（附带唯一流水 log_id 作为幂等键，各人并发独立异步处理）
    feishu_ok, feishu_msg = await feishu_service.push_checkin(
        name=matched_user["name"],
        student_id=matched_user["student_id"],
        department=matched_user["department"],
        similarity=similarity,
        checkin_time=checkin_time,
        log_id=log_id
    )

    # 5. 更新本地流水记录的最终飞书状态
    update_attendance_log_feishu_status(
        log_id=log_id,
        feishu_status="SUCCESS" if feishu_ok else "FEISHU_PUSH_FAILED",
        error_msg=None if feishu_ok else feishu_msg
    )

    return CheckinResponse(
        success=True,
        code=200,
        message="签到成功！",
        user=user_info,
        similarity=round(similarity, 4),
        checkin_time=checkin_time,
        is_repeated=False,
        feishu_synced=feishu_ok,
        feishu_message=feishu_msg
    )

# ----------------- 管理后台：人员底库管理 -----------------
@app.post("/api/users", response_model=UserResponse, dependencies=[Depends(verify_admin)])
async def create_user(user_in: UserCreate):
    """
    录入人员底库信息（需管理员鉴权）
    1. 校验学号/工号唯一性
    2. 检测人脸并提取 512 维特征向量（若未识别人脸直接拒绝并提示）
    3. 保存原图留档，存入 SQLite 并重载内存向量矩阵
    """
    # 检查学号是否已存在
    existing = get_user_by_student_id(user_in.student_id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"学号/工号 [{user_in.student_id}] 已存在，无法重复录入"
        )

    # 提取特征向量
    embedding, err = face_engine.extract_embedding(user_in.photo_base64)
    if err or embedding is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"照片人脸校验失败: {err or '未检测到清晰人脸，请上传正面免冠照片'}"
        )

    # 保存照片到本地目录
    avatar_filename = f"{user_in.student_id}_{uuid.uuid4().hex[:8]}.jpg"
    avatar_path = os.path.join(settings.AVATARS_DIR, avatar_filename)
    try:
        img_bgr = face_engine.base64_to_cv2(user_in.photo_base64)
        if img_bgr is not None:
            import cv2
            cv2.imwrite(avatar_path, img_bgr)
    except Exception as e:
        print(f"保存头像原图异常（不影响入库）: {e}")

    # 存入数据库
    user_id = add_user(
        name=user_in.name,
        student_id=user_in.student_id,
        department=user_in.department,
        avatar_path=avatar_path,
        embedding=embedding
    )

    # 立即热重载内存缓存（使新增人员无需重启服务立即可刷脸）
    face_engine.reload_cache()

    return UserResponse(
        id=user_id,
        name=user_in.name,
        student_id=user_in.student_id,
        department=user_in.department,
        avatar_url=f"/avatars/{avatar_filename}",
        created_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    )

@app.get("/api/users", response_model=List[UserResponse])
async def list_users():
    """获取所有录入人员列表"""
    users = get_all_users()
    res = []
    for u in users:
        avatar_url = None
        if u.get("avatar_path"):
            fname = os.path.basename(u["avatar_path"])
            avatar_url = f"/avatars/{fname}"
        res.append(UserResponse(
            id=u["id"],
            name=u["name"],
            student_id=u["student_id"],
            department=u["department"],
            avatar_url=avatar_url,
            created_at=str(u.get("created_at", ""))
        ))
    return res

@app.delete("/api/users/{user_id}", dependencies=[Depends(verify_admin)])
async def remove_user(user_id: int):
    """删除人员信息（连同特征向量与头像，需管理员鉴权）"""
    ok = delete_user(user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="未找到该人员")
    face_engine.reload_cache()
    return {"success": True, "message": "人员已成功删除"}

# ----------------- 管理后台：飞书妙搭配置与连通性测试 -----------------
@app.get("/api/config/feishu", response_model=FeishuConfigResponse, dependencies=[Depends(verify_admin)])
async def get_feishu_configuration():
    """
    读取当前飞书配置（需管理员鉴权）
    安全保护：严格脱敏，不向浏览器返回明文 app_secret，仅返回脱敏状态 has_app_secret
    """
    cfg = get_feishu_config()
    secret = cfg.get("app_secret", "")
    has_secret = bool(secret and len(str(secret).strip()) > 0)
    return FeishuConfigResponse(
        mode=cfg.get("mode", "webhook"),
        enabled=cfg.get("enabled", True),
        webhook_url=cfg.get("webhook_url", ""),
        app_id=cfg.get("app_id", ""),
        has_app_secret=has_secret,
        app_secret_masked="************" if has_secret else None,
        app_token=cfg.get("app_token", ""),
        table_id=cfg.get("table_id", "")
    )

@app.post("/api/config/feishu", dependencies=[Depends(verify_admin)])
async def update_feishu_configuration(config: FeishuConfigUpdate):
    """
    更新保存飞书配置（需管理员鉴权）
    只写型敏感凭据保护：若 app_secret 为空或脱敏符号，后端自动保留已有安全存储的密钥
    主动清空飞书 token 缓存，确保切换应用时立即生效
    """
    save_feishu_config(config.model_dump())
    feishu_service.clear_token_cache()
    return {"success": True, "message": "飞书配置已成功保存！应用密钥已安全隔离保存在服务端。"}

@app.post("/api/feishu/test", response_model=FeishuTestResponse, dependencies=[Depends(verify_admin)])
async def test_feishu_integration(custom_cfg: Optional[FeishuConfigUpdate] = None):
    """
    测试飞书妙搭 Webhook 或多维表格 API 连通性（需管理员鉴权）
    若测试载荷未包含 app_secret，自动使用服务端持久化的已有密钥
    """
    cfg_dict = custom_cfg.model_dump() if custom_cfg else None
    if cfg_dict:
        incoming_secret = cfg_dict.get("app_secret")
        if not incoming_secret or incoming_secret == "************":
            saved_cfg = get_feishu_config()
            cfg_dict["app_secret"] = saved_cfg.get("app_secret", "")

    success, message, data = await feishu_service.test_connection(cfg_dict)
    return FeishuTestResponse(
        success=success,
        message=message,
        response_data=data
    )

# ----------------- 管理后台：流水审计与统计 -----------------
@app.get("/api/logs", response_model=List[AttendanceLog], dependencies=[Depends(verify_admin)])
async def get_logs(limit: int = 50):
    """查询最近的签到流水日志（需管理员鉴权）"""
    logs = get_recent_attendance_logs(limit=limit)
    return [AttendanceLog(**log) for log in logs]

@app.delete("/api/logs", dependencies=[Depends(verify_admin)])
async def clear_logs():
    """清空全部打卡流水记录（需管理员鉴权）"""
    clear_all_attendance_logs()
    return {"success": True, "message": "已成功清空所有签到流水记录"}

# ----------------- 外发队列 (Outbox) 与飞书同步补偿管理 -----------------
@app.post("/api/logs/{log_id}/retry", response_model=SyncRetryResponse, dependencies=[Depends(verify_admin)])
async def retry_single_log(log_id: int):
    """
    手动重试同步单条签到流水记录至飞书（支持幂等对账与 Schema 适配）
    """
    success, message, record_id = await feishu_service.sync_single_log(log_id)
    return SyncRetryResponse(
        success=success,
        message=message,
        record_id=record_id
    )

@app.post("/api/logs/retry-all", response_model=BatchSyncRetryResponse, dependencies=[Depends(verify_admin)])
async def retry_all_failed_logs():
    """
    一键批量重试所有因网络抖动失败的签到流水（Outbox 自愈补偿）
    """
    res = await feishu_service.sync_all_failed_logs(limit=50)
    return BatchSyncRetryResponse(
        total=res.get("total", 0),
        succeeded=res.get("succeeded", 0),
        failed=res.get("failed", 0),
        details=res.get("details", []),
        message=res.get("message", "")
    )

@app.get("/api/sync/status", response_model=SyncStatsResponse, dependencies=[Depends(verify_admin)])
async def get_sync_status():
    """获取签到与飞书同步全链路统计指标（用于对账与看板展示）"""
    stats = get_sync_statistics()
    return SyncStatsResponse(**stats)

# ----------------- 管理员认证与安全管理 -----------------
@app.post("/api/auth/login", response_model=TokenResponse)
async def login(auth: AdminLogin):
    """管理员登录验证：校验 SQLite 数据库中的账号密码，并签发标准 24 小时 HS256 JWT"""
    if not verify_admin_password(auth.username, auth.password):
        raise HTTPException(status_code=401, detail="账号或密码错误，请核对后重试")

    expires_delta = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    token = create_access_token(
        data={"sub": auth.username},
        expires_delta=expires_delta
    )
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    )

@app.get("/api/auth/me", response_model=AdminUserResponse)
async def get_current_admin(current_user: Dict[str, Any] = Depends(verify_admin)):
    """获取当前登录管理员信息、JWT Token 有效期及弱口令安全风险标记"""
    username = current_user.get("sub", settings.ADMIN_USERNAME)
    return AdminUserResponse(
        username=username,
        authenticated=True,
        expires_at=current_user.get("exp"),
        is_default_password=is_using_default_password()
    )

@app.post("/api/auth/change-password")
async def change_admin_password(
    req: ChangePasswordRequest,
    current_user: Dict[str, Any] = Depends(verify_admin)
):
    """
    修改管理员密码：
    1. 需携带有效 JWT Bearer Token
    2. 校验旧密码
    3. 将全新加盐哈希保存至 SQLite 数据库
    """
    ok, msg = update_admin_password(req.old_password, req.new_password)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"success": True, "message": msg}

# ----------------- 生产环境：挂载前端构建产物 (dist) 与 SPA 路由支持 -----------------
FRONTEND_DIST_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dist"))

if os.path.isdir(FRONTEND_DIST_DIR):
    # 挂载 Vite 生成的 assets 目录
    assets_path = os.path.join(FRONTEND_DIST_DIR, "assets")
    if os.path.isdir(assets_path):
        app.mount("/assets", StaticFiles(directory=assets_path), name="frontend_assets")

    @app.get("/{full_path:path}")
    async def serve_spa_frontend(full_path: str):
        """
        统一提供前端 SPA 页面服务：
        1. 排除 /api、/avatars、/docs 等后端路由，避免 404 被误吞
        2. 命中存在的静态文件直接返回
        3. 其余路径回退至 index.html
        """
        if (
            full_path.startswith("api/")
            or full_path == "api"
            or full_path.startswith("avatars/")
            or full_path.startswith("docs")
            or full_path.startswith("openapi.json")
            or full_path.startswith("redoc")
        ):
            raise HTTPException(status_code=404, detail="Not Found")

        file_path = os.path.join(FRONTEND_DIST_DIR, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)

        index_file = os.path.join(FRONTEND_DIST_DIR, "index.html")
        if os.path.isfile(index_file):
            return FileResponse(index_file)

        raise HTTPException(status_code=404, detail="前端产物 index.html 未找到，请先构建前端 (npm run build)")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
