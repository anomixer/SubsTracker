// @ts-check
/**
 * Server醬 3 通知渠道
 */
import { ok, fail, errorMessage } from './channel.js';

/** @type {import('./channel.js').Channel} */
export const serverChanChannel = {
  name: 'serverchan',

  validateConfig(config) {
    if (!config.SERVERCHAN_SENDKEY) return { ok: false, error: '缺少 SERVERCHAN_SENDKEY' };
    return { ok: true };
  },

  async send(payload, config) {
    const v = serverChanChannel.validateConfig(config);
    if (!v.ok) return fail('serverchan', v.error || '配置無效');

    const endpoint = `https://sctapi.ftqq.com/${config.SERVERCHAN_SENDKEY}.send`;
    const body = new URLSearchParams({
      title: payload.title || '訂閱提醒',
      desp: `## ${payload.title || '訂閱提醒'}\n\n${payload.content || ''}`
    });

    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      });
      const result = await r.json().catch(() => ({}));
      return result && result.code === 0
        ? ok('serverchan', result)
        : fail('serverchan', `Server醬返回 code=${result?.code} ${result?.message || ''}`, result);
    } catch (err) {
      return fail('serverchan', errorMessage(err));
    }
  },

  async test(config) {
    return serverChanChannel.send(
      { title: '訂閱管理 - 測試通知', content: '這是一條 Server醬 測試通知。' },
      config
    );
  }
};

/** @deprecated 舊版相容函數 */
export async function sendServerChanNotification(title, content, config) {
  const r = await serverChanChannel.send({ title, content }, config);
  if (!r.success) console.error('[Server醬]', r.error);
  return r.success;
}
