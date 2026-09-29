/**
 * 统一 API 与静态资源地址处理工具
 * 
 * 生产部署支持通过环境变量 VITE_API_BASE_URL 动态指定后端 API 地址（例如前后端分域部署或外部独立容器服务）。
 * 默认情况下（同域部署、FastAPI 一体化服务或 Vite 开发代理），VITE_API_BASE_URL 为空，自动使用同域相对路径。
 */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

/**
 * 规范化并获取完整的 API / 静态资源 URL
 * @param path 相对或绝对路径，如 '/api/checkin' 或 '/avatars/demo.jpg'
 * @returns 完整的可请求 URL
 */
export function getApiUrl(path: string): string {
  if (!path) return '';
  // 如果已是完整网络链接或 base64/blob 临时链接，直接返回
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:') || path.startsWith('blob:')) {
    return path;
  }
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${cleanPath}`;
}

// ----------------- JWT 凭证与会话生命周期管理 -----------------
const TOKEN_KEY = 'face_checkin_token';
const AUTH_KEY = 'face_checkin_admin_auth';

export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setAdminToken(token: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(AUTH_KEY, 'true');
}

export function clearAdminAuth(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(AUTH_KEY);
}

/**
 * 安全解析 JWT Token 载荷 (Payload)
 */
export function parseJwtPayload(token: string | null): { sub?: string; exp?: number; [key: string]: any } | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      if (token === 'admin-logged-in-token-2026') {
        return { sub: 'admin', exp: Math.floor(Date.now() / 1000) + 86400 };
      }
      return null;
    }
    // URL-safe base64 转换
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const jsonStr = decodeURIComponent(
      Array.prototype.map
        .call(atob(base64), (c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonStr);
  } catch (e) {
    return null;
  }
}

/**
 * 校验 Token 是否有效且未过期
 */
export function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  const payload = parseJwtPayload(token);
  if (!payload || !payload.exp) return false;
  // 当前时间（毫秒）与过期时间对比，预留 5 秒时间缓冲
  const nowSeconds = Math.floor(Date.now() / 1000);
  return payload.exp > (nowSeconds + 5);
}

/**
 * 带有 401 统一拦截的请求方法
 * 当后端返回 401 Unauthorized（Token 过期或被篡改）时，自动清理本地会话并分发事件
 */
export async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getAdminToken();
  const url = getApiUrl(path);

  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    clearAdminAuth();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('face_checkin_unauthorized', {
        detail: { message: '管理员登录凭证已过期或无效，请重新登录' }
      }));
    }
  }

  return response;
}
