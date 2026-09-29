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
