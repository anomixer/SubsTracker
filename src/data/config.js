import { getKVJson, putKVJson } from './kv.js';

const DEFAULT_CONFIG = {
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'password',
  TG_BOT_TOKEN: '',
  TG_CHAT_ID: '',
  TG_TOPIC_ID: '',
  NOTIFYX_API_KEY: '',
  WEBHOOK_URL: '',
  WEBHOOK_METHOD: 'POST',
  WEBHOOK_HEADERS: '',
  WEBHOOK_TEMPLATE: '',
  SHOW_LUNAR: false,
  WECHATBOT_WEBHOOK: '',
  WECHATBOT_MSG_TYPE: 'text',
  WECHATBOT_AT_MOBILES: '',
  WECHATBOT_AT_ALL: 'false',
  RESEND_API_KEY: '',
  EMAIL_FROM: '',
  EMAIL_FROM_NAME: '訂閱提醒系統',
  EMAIL_TO: '',
  BARK_DEVICE_KEY: '',
  BARK_SERVER: 'https://api.day.app',
  BARK_IS_ARCHIVE: 'false',
  ENABLED_NOTIFIERS: ['notifyx'],
  THEME_MODE: 'system',
  TIMEZONE: 'Asia/Shanghai',
  NOTIFICATION_HOURS: [],
  THIRD_PARTY_API_TOKEN: '',
  DEBUG_LOGS: false,
  PAYMENT_HISTORY_LIMIT: 100,
  GOTIFY_SERVER_URL: '',
  GOTIFY_APP_TOKEN: '',
  SERVERCHAN_SENDKEY: '',
  PUSHPLUS_TOKEN: '',
  PUSHPLUS_TOPIC: '',
  PUSHPLUS_CHANNEL: '',
  NTFY_SERVER: 'https://ntfy.sh',
  NTFY_TOPIC: '',
  NTFY_TOKEN: ''
};

async function getConfig(env) {
  if (!env.SUBSCRIPTIONS_KV) {
    console.error('[配置] KV儲存未繫結');
    throw new Error('KV儲存未繫結');
  }
  const data = await env.SUBSCRIPTIONS_KV.get('config');
  console.log('[配置] 從KV讀取配置:', data ? '成功' : '空配置');
  const config = data ? JSON.parse(data) : {};

  let jwtSecret = config.JWT_SECRET;
  if (!jwtSecret) {
    console.log('[配置] 生成新的JWT金鑰');
    jwtSecret = crypto.randomUUID();
    const updatedConfig = { ...config, JWT_SECRET: jwtSecret };
    await env.SUBSCRIPTIONS_KV.put('config', JSON.stringify(updatedConfig));
  }

  return {
    ...DEFAULT_CONFIG,
    ...config,
    JWT_SECRET: jwtSecret
  };
}

async function setConfig(env, config) {
  await putKVJson(env, 'config', config);
}

export {
  DEFAULT_CONFIG,
  getConfig,
  setConfig
};
