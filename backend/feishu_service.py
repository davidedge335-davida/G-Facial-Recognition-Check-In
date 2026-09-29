import httpx
import time
from typing import Dict, Any, Tuple, Optional
from datetime import datetime
from .database import get_feishu_config, save_feishu_config

class FeishuService:
    """
    飞书妙搭 / 开放平台集成服务
    - 方案 A（推荐，最轻量）：飞书妙搭工作流 Webhook 触发器
    - 方案 B：飞书多维表格（Bitable）单条记录新增 OpenAPI
    """
    def __init__(self):
        # 方案 B 的 tenant_access_token 内存缓存
        self._tenant_token: Optional[str] = None
        self._token_expire_at: float = 0.0

    async def _get_tenant_access_token(self, app_id: str, app_secret: str) -> Tuple[Optional[str], Optional[str]]:
        """
        获取飞书开放平台自建应用 tenant_access_token（带内存有效期缓存）
        """
        now = time.time()
        # 提前 300 秒刷新缓存
        if self._tenant_token and now < self._token_expire_at - 300:
            return self._tenant_token, None

        token_url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
        payload = {
            "app_id": app_id,
            "app_secret": app_secret
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(token_url, json=payload)
                data = res.json()
                if data.get("code") == 0:
                    self._tenant_token = data.get("tenant_access_token")
                    expire_in = data.get("expire", 7200)
                    self._token_expire_at = now + expire_in
                    return self._tenant_token, None
                else:
                    return None, f"获取飞书 token 失败: {data.get('msg')} (code: {data.get('code')})"
        except Exception as e:
            return None, f"请求飞书鉴权服务网络异常: {str(e)}"

    async def push_via_webhook(self, webhook_url: str, payload_data: Dict[str, Any]) -> Tuple[bool, str, Optional[Dict]]:
        """
        方案 A：向飞书妙搭 Webhook 触发器推送签到数据
        """
        if not webhook_url or not webhook_url.startswith("http"):
            return False, "飞书妙搭 Webhook URL 未配置或格式不合法", None

        # 飞书妙搭 Webhook 标准请求载荷
        body = {
            "event": "face_checkin_success",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "data": payload_data
        }

        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.post(webhook_url, json=body)
                # 兼容 200, 201, 204 等 HTTP 成功状态码
                if 200 <= response.status_code < 300:
                    try:
                        res_json = response.json()
                    except Exception:
                        res_json = {"status_code": response.status_code, "text": response.text}
                    return True, "成功推送到飞书妙搭 Webhook", res_json
                else:
                    return False, f"飞书 Webhook 返回 HTTP 状态异常: {response.status_code}", {"response_text": response.text}
        except httpx.TimeoutException:
            return False, "推送到飞书妙搭超时，请检查网络或 URL 是否有效", None
        except Exception as e:
            return False, f"推送到飞书妙搭发生网络错误: {str(e)}", None

    async def push_via_bitable(
        self,
        app_id: str,
        app_secret: str,
        app_token: str,
        table_id: str,
        payload_data: Dict[str, Any]
    ) -> Tuple[bool, str, Optional[Dict]]:
        """
        方案 B：调用飞书多维表格（Bitable）添加单条记录 API
        API 文档: https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/create
        """
        if not all([app_id, app_secret, app_token, table_id]):
            return False, "飞书多维表格 API 参数不完整（需填写 App ID, App Secret, App Token, Table ID）", None

        token, err = await self._get_tenant_access_token(app_id, app_secret)
        if not token:
            return False, err or "未能获取有效飞书 Access Token", None

        url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8"
        }

        # 映射字段（匹配常见多维表格列名，兼顾中英文字段）
        fields = {
            "姓名": payload_data.get("name"),
            "学号": payload_data.get("student_id"),
            "工号": payload_data.get("student_id"),
            "班级": payload_data.get("department"),
            "部门": payload_data.get("department"),
            "签到时间": payload_data.get("checkin_time"),
            "匹配度": f"{payload_data.get('similarity', 0) * 100:.1f}%",
            "打卡设备": "手机移动端"
        }

        body = {"fields": fields}

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(url, headers=headers, json=body)
                res_json = response.json()
                if res_json.get("code") == 0:
                    return True, "成功写入飞书多维表格", res_json.get("data")
                else:
                    return False, f"写入飞书多维表格失败: {res_json.get('msg')} (code: {res_json.get('code')})", res_json
        except Exception as e:
            return False, f"调用多维表格 API 异常: {str(e)}", None

    async def push_checkin(
        self,
        name: str,
        student_id: str,
        department: str,
        similarity: float,
        checkin_time: str
    ) -> Tuple[bool, str]:
        """
        统一分发入口：根据系统配置模式自动推送
        """
        config = get_feishu_config()
        if not config.get("enabled", True):
            return False, "飞书同步未开启（配置项中已禁用）"

        mode = config.get("mode", "webhook")
        data = {
            "name": name,
            "student_id": student_id,
            "department": department,
            "similarity": round(float(similarity), 4),
            "checkin_time": checkin_time
        }

        if mode == "webhook":
            webhook_url = config.get("webhook_url", "")
            success, msg, _ = await self.push_via_webhook(webhook_url, data)
            return success, msg
        elif mode == "bitable":
            success, msg, _ = await self.push_via_bitable(
                app_id=config.get("app_id", ""),
                app_secret=config.get("app_secret", ""),
                app_token=config.get("app_token", ""),
                table_id=config.get("table_id", ""),
                payload_data=data
            )
            return success, msg
        else:
            return False, f"未知的飞书集成模式: {mode}"

    async def test_connection(self, custom_config: Optional[Dict[str, Any]] = None) -> Tuple[bool, str, Optional[Dict]]:
        """
        测试连通性专用方法
        """
        cfg = custom_config if custom_config else get_feishu_config()
        mode = cfg.get("mode", "webhook")
        test_data = {
            "name": "测试人员",
            "student_id": "TEST_001",
            "department": "系统测试部",
            "similarity": 0.9999,
            "checkin_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }

        if mode == "webhook":
            url = cfg.get("webhook_url", "")
            if not url:
                return False, "测试失败：Webhook URL 不能为空", None
            return await self.push_via_webhook(url, test_data)
        elif mode == "bitable":
            return await self.push_via_bitable(
                app_id=cfg.get("app_id", ""),
                app_secret=cfg.get("app_secret", ""),
                app_token=cfg.get("app_token", ""),
                table_id=cfg.get("table_id", ""),
                payload_data=test_data
            )
        return False, f"不支持的测试模式: {mode}", None

# 全局单例
feishu_service = FeishuService()
