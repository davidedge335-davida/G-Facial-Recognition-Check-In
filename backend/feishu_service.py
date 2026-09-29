import httpx
import time
import hashlib
import re
import asyncio
from typing import Dict, Any, Tuple, Optional, List
from datetime import datetime
from .database import (
    get_feishu_config, save_feishu_config,
    get_attendance_log_by_id, get_failed_attendance_logs,
    mark_attendance_log_synced, mark_attendance_log_failed
)

# ----------------- 飞书多维表格字段语义对齐词表 -----------------
SEMANTIC_FIELD_PATTERNS = {
    "serial": [
        "流水号", "流水id", "记录id", "流水编号", "考勤编号", "打卡单号", "序号", "编号", "单号",
        "serial", "serialno", "serial_no", "logid", "log_id", "recordid", "idempotency_key"
    ],
    "name": [
        "姓名", "人员姓名", "打卡人", "员工姓名", "学生姓名", "人员", "名字", "签到人", "用户姓名",
        "打卡人员", "签到人员", "考勤人员",
        "name", "person", "username", "staff_name", "user_name", "full_name", "fullname"
    ],
    "student_id": [
        "学号", "工号", "学号/工号", "工号/学号", "学工号", "员工号", "人员编号", "卡号", "证件号", "员工编号", "学生编号",
        "student_id", "studentid", "employee_id", "employeeid", "badge_no", "user_id", "job_number", "id_number"
    ],
    "department": [
        "部门", "班级", "部门/班级", "班级/部门", "所属部门", "学院", "所属班级", "科室", "组织", "单位", "系部", "专业",
        "department", "dept", "class", "organization", "org", "division", "team"
    ],
    "checkin_time": [
        "签到时间", "打卡时间", "考勤时间", "签到时刻", "时间", "打卡日期", "签到日期", "打卡时刻", "记录时间", "日期时间",
        "checkin_time", "checkintime", "attendance_time", "timestamp", "time", "datetime", "date"
    ],
    "similarity": [
        "匹配度", "相似度", "置信度", "识别率", "人脸匹配度", "人脸相似度", "比对得分", "相似比率", "相似度(%)", "得分",
        "similarity", "score", "confidence", "match_rate"
    ],
    "device": [
        "打卡设备", "设备", "考勤设备", "打卡方式", "终端类型", "打卡终端", "来源", "设备名称",
        "device", "terminal", "source", "client"
    ],
    "status": [
        "签到状态", "打卡状态", "考勤状态", "状态", "打卡结果", "签到结果", "是否签到", "是否打卡",
        "status", "checkin_status", "result"
    ]
}

def normalize_field_name(s: str) -> str:
    """去除特殊符号、空格并转小写用于语义对齐"""
    if not s:
        return ""
    return re.sub(r'[\s\-_/\\()（）·:：]+', '', s).lower()

class BitableSchemaAdapter:
    """
    飞书多维表格完整 Schema 适配器：
    1. 分页动态拉取多维表格全部字段定义（支持 has_more / page_token，彻底解决 100 字段截断隐患）
    2. 字段语义模糊与精确分级对齐（姓名、工号、部门、时间、匹配度、设备、流水号、状态）
    3. 严密类型转换（日期时间戳毫秒数转换、数值/百分比类型适配、单选多选下拉项匹配、复选框布尔适配）
    4. 自动过滤公式与只读系统字段 (Formula, CreatedTime, ModifiedTime, AutoNumber 等)
    5. 主列类型智能保护（主键必填防空，支持文本与数值主键自适配）
    """
    def __init__(self):
        # 缓存：(app_token, table_id) -> {"fields": [...], "expire_at": float}
        self._schema_cache: Dict[Tuple[str, str], Dict[str, Any]] = {}

    def clear_cache(self, app_token: Optional[str] = None, table_id: Optional[str] = None):
        if app_token and table_id:
            self._schema_cache.pop((app_token, table_id), None)
        else:
            self._schema_cache.clear()

    async def fetch_table_fields(
        self,
        client: httpx.AsyncClient,
        token: str,
        app_token: str,
        table_id: str
    ) -> List[Dict[str, Any]]:
        """分页获取多维表格全部字段元数据（带 300 秒 TTL 缓存）"""
        cache_key = (app_token, table_id)
        now = time.time()
        cached = self._schema_cache.get(cache_key)
        if cached and now < cached.get("expire_at", 0):
            return cached.get("fields", [])

        url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8"
        }

        all_fields: List[Dict[str, Any]] = []
        page_token = None

        while True:
            params: Dict[str, Any] = {"page_size": 100}
            if page_token:
                params["page_token"] = page_token

            try:
                res = await client.get(url, headers=headers, params=params, timeout=5.0)
                if res.status_code != 200:
                    break
                data = res.json()
                if data.get("code") != 0:
                    break
                items = data.get("data", {}).get("items", [])
                all_fields.extend(items)
                has_more = data.get("data", {}).get("has_more", False)
                page_token = data.get("data", {}).get("page_token")
                if not has_more or not page_token:
                    break
            except Exception:
                break

        if all_fields:
            self._schema_cache[cache_key] = {
                "fields": all_fields,
                "expire_at": now + 300.0
            }

        return all_fields

    def find_field_for_slot(self, fields_meta: List[Dict[str, Any]], target_slot: str) -> Optional[Dict[str, Any]]:
        """在字段列表中查找指定语义槽（例如 'serial'）的最佳匹配字段"""
        if not fields_meta or target_slot not in SEMANTIC_FIELD_PATTERNS:
            return None

        aliases = SEMANTIC_FIELD_PATTERNS[target_slot]
        # 1. 优先精确匹配
        for f in fields_meta:
            norm_f = normalize_field_name(f.get("field_name", ""))
            for a in aliases:
                if norm_f == normalize_field_name(a):
                    return f

        # 2. 次选包含匹配
        for f in fields_meta:
            norm_f = normalize_field_name(f.get("field_name", ""))
            for a in aliases:
                norm_a = normalize_field_name(a)
                if len(norm_a) >= 2 and (norm_a in norm_f or norm_f in norm_a):
                    return f
        return None

    def adapt_payload(self, fields_meta: List[Dict[str, Any]], payload_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        根据飞书多维表格真实字段元数据与类型系统进行智能映射与类型转换
        """
        log_id = payload_data.get("log_id")
        log_id_str = f"CHK_{log_id}" if log_id else "CHK_MANUAL"
        name = str(payload_data.get("name") or "")
        student_id = str(payload_data.get("student_id") or "")
        department = str(payload_data.get("department") or "")
        checkin_time_str = str(payload_data.get("checkin_time") or datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        similarity = float(payload_data.get("similarity") or 0.0)
        device = "手机移动端"

        if not fields_meta:
            # 降级模式：无元数据时，使用多别名全覆盖字典
            return {
                "流水号": log_id_str,
                "姓名": name,
                "学号": student_id,
                "工号": student_id,
                "班级": department,
                "部门": department,
                "签到时间": checkin_time_str,
                "匹配度": f"{similarity * 100:.1f}%",
                "打卡设备": device
            }

        # 计算毫秒级时间戳
        try:
            dt = datetime.strptime(checkin_time_str, "%Y-%m-%d %H:%M:%S")
            time_ms = int(dt.timestamp() * 1000)
        except Exception:
            time_ms = int(time.time() * 1000)

        adapted_fields: Dict[str, Any] = {}

        for f in fields_meta:
            field_name = f.get("field_name", "")
            field_type = f.get("type", 1)
            is_hidden = f.get("is_hidden", False)
            property_meta = f.get("property", {}) or {}

            # 排除只读与计算字段
            # 20: 公式, 1001: 创建时间, 1002: 修改时间, 1003: 创建人, 1004: 修改人, 1005: 自动编号, 18/21: 关联
            if field_type in (20, 1001, 1002, 1003, 1004, 1005, 18, 21) or is_hidden:
                continue

            norm_f = normalize_field_name(field_name)

            # 1. 优先精确匹配语义槽
            detected_slot = None
            for slot, aliases in SEMANTIC_FIELD_PATTERNS.items():
                for alias in aliases:
                    if norm_f == normalize_field_name(alias):
                        detected_slot = slot
                        break
                if detected_slot:
                    break

            # 2. 次选包含匹配
            if not detected_slot:
                for slot, aliases in SEMANTIC_FIELD_PATTERNS.items():
                    for alias in aliases:
                        norm_alias = normalize_field_name(alias)
                        if len(norm_alias) >= 2 and (norm_alias in norm_f or norm_f in norm_alias):
                            detected_slot = slot
                            break
                    if detected_slot:
                        break

            # 3. 主列兜底映射
            if not detected_slot and f.get("is_primary"):
                detected_slot = "name"

            if not detected_slot:
                continue

            val: Any = None
            if detected_slot == "serial":
                if field_type == 2:
                    val = int(log_id) if log_id else 1
                else:
                    val = log_id_str

            elif detected_slot == "name":
                if field_type == 11:
                    # 人员类型需 open_id，未授权人员跳过防报错
                    val = None
                elif field_type == 2:
                    val = int(log_id) if log_id else 1
                else:
                    val = name

            elif detected_slot == "student_id":
                if field_type == 2:
                    val = int(student_id) if student_id.isdigit() else None
                else:
                    val = student_id

            elif detected_slot == "department":
                options = property_meta.get("options", [])
                matched_opt = None
                for opt in options:
                    if normalize_field_name(opt.get("name", "")) == normalize_field_name(department):
                        matched_opt = opt.get("name")
                        break
                dept_val = matched_opt or department
                if field_type == 3:  # 单选
                    val = dept_val if dept_val else None
                elif field_type == 4:  # 多选
                    val = [dept_val] if dept_val else None
                else:
                    val = dept_val

            elif detected_slot == "checkin_time":
                if field_type == 5:  # 日期时间字段必须传毫秒时间戳
                    val = time_ms
                elif field_type == 2:
                    val = time_ms
                else:
                    val = checkin_time_str

            elif detected_slot == "similarity":
                if field_type == 2:  # 数值/百分比
                    formatter = property_meta.get("formatter", "")
                    if "%" in formatter or "percent" in str(formatter).lower():
                        val = round(similarity, 4)
                    else:
                        val = round(similarity * 100, 2)
                else:
                    val = f"{similarity * 100:.1f}%"

            elif detected_slot == "device":
                options = property_meta.get("options", [])
                matched_opt = None
                for opt in options:
                    if normalize_field_name(opt.get("name", "")) == normalize_field_name(device):
                        matched_opt = opt.get("name")
                        break
                dev_val = matched_opt or device
                if field_type == 3:
                    val = dev_val
                elif field_type == 4:
                    val = [dev_val]
                else:
                    val = dev_val

            elif detected_slot == "status":
                if field_type == 7:  # 复选框
                    val = True
                elif field_type in (3, 4):  # 单选/多选
                    options = property_meta.get("options", [])
                    matched_opt = "正常"
                    for opt in options:
                        opt_n = opt.get("name", "")
                        if any(k in opt_n for k in ("正常", "成功", "已签到", "出席")):
                            matched_opt = opt_n
                            break
                    val = [matched_opt] if field_type == 4 else matched_opt
                else:
                    val = "正常"

            if val is not None:
                adapted_fields[field_name] = val

        # 保证主列必有值（防止飞书因主键缺失报错，同时适配主列字段类型）
        for f in fields_meta:
            fname = f.get("field_name")
            if f.get("is_primary") and fname not in adapted_fields:
                if f.get("type") == 2:
                    adapted_fields[fname] = int(log_id) if log_id else 1
                else:
                    adapted_fields[fname] = name or log_id_str

        return adapted_fields


class FeishuService:
    """
    飞书妙搭 / 开放平台集成服务
    - 方案 A（推荐，最轻量）：飞书妙搭工作流 Webhook 触发器
    - 方案 B：飞书多维表格（Bitable）单条记录新增 OpenAPI
    - 企业级高可用与最终一致性加固：
      1. 凭据级多应用隔离 Token 缓存（基于 app_id 与 secret_hash 复合键）
      2. 具备动态多页解析与类型系统转换的 BitableSchemaAdapter
      3. 写入前唯一流水号幂等对账（search before create）
      4. 外发队列 Outbox 自动重试与手工补录机制
    """
    def __init__(self):
        # 方案 B 的凭据级 Token 缓存字典: {app_id: {"token": str, "expire_at": float, "secret_hash": str}}
        self._token_cache: Dict[str, Dict[str, Any]] = {}
        self.schema_adapter = BitableSchemaAdapter()

    def clear_token_cache(self, app_id: Optional[str] = None):
        """清除指定应用或全部已缓存的飞书 access_token 及表格 Schema 缓存"""
        if app_id:
            self._token_cache.pop(app_id, None)
        else:
            self._token_cache.clear()
        self.schema_adapter.clear_cache()

    async def _get_tenant_access_token(self, app_id: str, app_secret: str) -> Tuple[Optional[str], Optional[str]]:
        """
        获取飞书开放平台自建应用 tenant_access_token（凭据级内存有效期缓存）
        严格绑定 app_id 与 app_secret，切换或修改应用后自动拉取对应应用新 Token
        """
        if not app_id or not app_secret:
            return None, "缺少飞书 App ID 或 App Secret"

        now = time.time()
        secret_hash = hashlib.sha256(app_secret.encode('utf-8')).hexdigest()[:16]

        cached = self._token_cache.get(app_id)
        if cached:
            if cached.get("secret_hash") == secret_hash and now < cached.get("expire_at", 0) - 300:
                return cached["token"], None

        token_url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
        payload = {
            "app_id": app_id,
            "app_secret": app_secret
        }

        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                res = await client.post(token_url, json=payload)
                data = res.json()
                if data.get("code") == 0:
                    token = data.get("tenant_access_token")
                    expire_in = data.get("expire", 7200)
                    self._token_cache[app_id] = {
                        "token": token,
                        "expire_at": now + expire_in,
                        "secret_hash": secret_hash
                    }
                    return token, None
                else:
                    return None, f"获取飞书 token 失败: {data.get('msg')} (code: {data.get('code')})"
        except httpx.TimeoutException:
            return None, "请求飞书鉴权服务网络超时（4秒超时）"
        except Exception as e:
            return None, f"请求飞书鉴权服务网络异常: {str(e)}"

    async def search_existing_record(
        self,
        client: httpx.AsyncClient,
        token: str,
        app_token: str,
        table_id: str,
        log_id: int,
        serial_field_name: str = "流水号",
        serial_field_type: int = 1
    ) -> Optional[str]:
        """
        在飞书多维表格中按真实流水号字段对账检索（保证重试与网络抖动时的绝对幂等性）
        """
        if not log_id or not serial_field_name:
            return None
        search_url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/search"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8"
        }
        val = int(log_id) if serial_field_type == 2 else f"CHK_{log_id}"
        payload = {
            "filter": {
                "conjunction": "or",
                "conditions": [
                    {
                        "field_name": serial_field_name,
                        "operator": "is",
                        "value": [val]
                    }
                ]
            }
        }
        try:
            res = await client.post(search_url, headers=headers, json=payload, timeout=3.5)
            if res.status_code == 200:
                data = res.json()
                if data.get("code") == 0:
                    items = data.get("data", {}).get("items", [])
                    if items and len(items) > 0:
                        return items[0].get("record_id")
        except Exception:
            pass
        return None

    async def push_via_webhook(self, webhook_url: str, payload_data: Dict[str, Any]) -> Tuple[bool, str, Optional[Dict]]:
        """
        方案 A：向飞书妙搭 Webhook 触发器推送签到数据（带唯一幂等键与超时控制）
        """
        if not webhook_url or not webhook_url.startswith("http"):
            return False, "飞书妙搭 Webhook URL 未配置或格式不合法", None

        log_id = payload_data.get("log_id", "0")
        student_id = payload_data.get("student_id", "")

        body = {
            "event": "face_checkin_success",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "idempotency_key": f"chk_{log_id}_{student_id}",
            "data": payload_data
        }

        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                response = await client.post(webhook_url, json=body)
                if 200 <= response.status_code < 300:
                    try:
                        res_json = response.json()
                    except Exception:
                        res_json = {"status_code": response.status_code, "text": response.text}
                    return True, "成功推送到飞书妙搭 Webhook", res_json
                else:
                    return False, f"飞书 Webhook 返回 HTTP 状态异常: {response.status_code}", {"response_text": response.text}
        except httpx.TimeoutException:
            return False, "推送到飞书妙搭网络超时（已进入本地可靠重试队列）", None
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
        方案 B：调用飞书多维表格（Bitable）单条记录新增 OpenAPI
        支持 Schema Adapter 动态类型转换与流水幂等对账
        """
        if not all([app_id, app_secret, app_token, table_id]):
            return False, "飞书多维表格 API 参数不完整（需填写 App ID, App Secret, App Token, Table ID）", None

        token, err = await self._get_tenant_access_token(app_id, app_secret)
        if not token:
            return False, err or "未能获取有效飞书 Access Token", None

        log_id = payload_data.get("log_id")

        async with httpx.AsyncClient(timeout=4.5) as client:
            # 1. 先动态解析表格 Schema
            fields_meta = await self.schema_adapter.fetch_table_fields(client, token, app_token, table_id)

            # 2. 对账检查：根据表格真实流水号字段对账检索，若已存在直接认定成功，不再重复插入
            if log_id:
                serial_field = self.schema_adapter.find_field_for_slot(fields_meta, "serial")
                if serial_field:
                    s_name = serial_field.get("field_name", "流水号")
                    s_type = serial_field.get("type", 1)
                    existing_record_id = await self.search_existing_record(
                        client, token, app_token, table_id, log_id,
                        serial_field_name=s_name, serial_field_type=s_type
                    )
                    if existing_record_id:
                        return True, "飞书多维表格已存在该流水记录（幂等对账成功）", {"record_id": existing_record_id}

            # 3. 智能字段类型适配
            fields_body = self.schema_adapter.adapt_payload(fields_meta, payload_data)

            # 4. 提交写入
            url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records"
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json; charset=utf-8"
            }
            body = {"fields": fields_body}

            try:
                response = await client.post(url, headers=headers, json=body)
                res_json = response.json()
                # 若飞书反馈 Token 无效或过期，主动驱逐该应用 Token 缓存并重试一次
                if res_json.get("code") in (99991663, 99991664, 99991668):
                    self.clear_token_cache(app_id)
                    new_token, tok_err = await self._get_tenant_access_token(app_id, app_secret)
                    if new_token:
                        headers["Authorization"] = f"Bearer {new_token}"
                        response = await client.post(url, headers=headers, json=body)
                        res_json = response.json()

                if res_json.get("code") == 0:
                    return True, "成功写入飞书多维表格", res_json.get("data")
                else:
                    return False, f"写入飞书多维表格失败: {res_json.get('msg')} (code: {res_json.get('code')})", res_json
            except httpx.TimeoutException:
                return False, "调用多维表格 API 网络超时（已进入本地可靠重试队列）", None
            except Exception as e:
                return False, f"调用多维表格 API 异常: {str(e)}", None

    async def push_checkin(
        self,
        name: str,
        student_id: str,
        department: str,
        similarity: float,
        checkin_time: str,
        log_id: Optional[int] = None
    ) -> Tuple[bool, str]:
        """
        统一分发入口：根据系统配置模式异步推送
        """
        config = get_feishu_config()
        if not config.get("enabled", True):
            return False, "飞书同步未开启（配置项中已禁用）"

        mode = config.get("mode", "webhook")
        data = {
            "log_id": log_id,
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
        """测试连通性专用方法"""
        cfg = custom_config if custom_config else get_feishu_config()
        mode = cfg.get("mode", "webhook")
        test_data = {
            "log_id": 0,
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
            # 测试时刷新对应表格的 Schema 缓存，确保获取最新字段
            self.schema_adapter.clear_cache(cfg.get("app_token", ""), cfg.get("table_id", ""))
            return await self.push_via_bitable(
                app_id=cfg.get("app_id", ""),
                app_secret=cfg.get("app_secret", ""),
                app_token=cfg.get("app_token", ""),
                table_id=cfg.get("table_id", ""),
                payload_data=test_data
            )
        return False, f"不支持的测试模式: {mode}", None

    # ----------------- Outbox 外发队列可靠同步与重试引擎 -----------------
    async def sync_single_log(self, log_id: int) -> Tuple[bool, str, Optional[str]]:
        """
        重试同步单条签到流水至飞书（支持管理端手动触发与后台队列自愈）
        """
        log = get_attendance_log_by_id(log_id)
        if not log:
            return False, "未找到该签到流水记录", None

        if log.get("feishu_status") == "SUCCESS":
            return True, "该记录已成功同步飞书，无需重复推送", log.get("feishu_record_id")

        success, msg = await self.push_checkin(
            name=log["name"],
            student_id=log["student_id"],
            department=log["department"],
            similarity=log["similarity"],
            checkin_time=log["checkin_time"],
            log_id=log["id"]
        )

        if success:
            mark_attendance_log_synced(log["id"])
            return True, f"重试同步成功: {msg}", None
        else:
            mark_attendance_log_failed(log["id"], msg, increment_retry=True)
            return False, f"重试同步失败: {msg}", None

    async def sync_all_failed_logs(self, limit: int = 50) -> Dict[str, Any]:
        """
        批量重试所有失败流水记录（最终一致性补偿）
        """
        failed_logs = get_failed_attendance_logs(limit=limit)
        if not failed_logs:
            return {
                "total": 0,
                "succeeded": 0,
                "failed": 0,
                "message": "当前暂无同步失败的记录"
            }

        succeeded = 0
        failed = 0
        details: List[Dict[str, Any]] = []

        for log in failed_logs:
            ok, msg, _ = await self.sync_single_log(log["id"])
            if ok:
                succeeded += 1
            else:
                failed += 1
            details.append({
                "log_id": log["id"],
                "name": log["name"],
                "success": ok,
                "message": msg
            })
            await asyncio.sleep(0.05)

        return {
            "total": len(failed_logs),
            "succeeded": succeeded,
            "failed": failed,
            "details": details,
            "message": f"批量补录完成：成功 {succeeded} 条，失败 {failed} 条"
        }

# 全局单例
feishu_service = FeishuService()
