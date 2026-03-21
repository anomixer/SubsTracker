import { getConfig } from '../data/config.js';

async function handleDebug(request, env) {
  try {
    const url = new URL(request.url);
    const config = await getConfig(env);
    const debugInfo = {
      timestamp: new Date().toISOString(),
      pathname: url.pathname,
      kvBinding: !!env.SUBSCRIPTIONS_KV,
      configExists: !!config,
      adminUsername: config.ADMIN_USERNAME,
      hasJwtSecret: !!config.JWT_SECRET,
      jwtSecretLength: config.JWT_SECRET ? config.JWT_SECRET.length : 0
    };

    return new Response(`
<!DOCTYPE html>
<html>
<head>
  <title>除錯資訊</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #f5f5f5; }
    .info { background: white; padding: 15px; margin: 10px 0; border-radius: 5px; }
    .success { color: green; }
    .error { color: red; }
  </style>
</head>
<body>
  <h1>系統除錯資訊</h1>
  <div class="info">
    <h3>基本資訊</h3>
    <p>時間: ${debugInfo.timestamp}</p>
    <p>路徑: ${debugInfo.pathname}</p>
    <p class="${debugInfo.kvBinding ? 'success' : 'error'}">KV繫結: ${debugInfo.kvBinding ? '✓' : '✗'}</p>
  </div>

  <div class="info">
    <h3>配置資訊</h3>
    <p class="${debugInfo.configExists ? 'success' : 'error'}">配置存在: ${debugInfo.configExists ? '✓' : '✗'}</p>
    <p>管理員使用者名稱: ${debugInfo.adminUsername}</p>
    <p class="${debugInfo.hasJwtSecret ? 'success' : 'error'}">JWT金鑰: ${debugInfo.hasJwtSecret ? '✓' : '✗'} (長度: ${debugInfo.jwtSecretLength})</p>
  </div>

  <div class="info">
    <h3>解決方案</h3>
    <p>1. 確保KV名稱空間已正確繫結為 SUBSCRIPTIONS_KV</p>
    <p>2. 嘗試訪問 <a href="/">/</a> 進行登入</p>
    <p>3. 如果仍有問題，請檢查Cloudflare Workers日誌</p>
  </div>
</body>
</html>`, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  } catch (error) {
    return new Response(`除錯頁面錯誤: ${error.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

export { handleDebug };
