// @ts-check
/**
 * Telegram 通知渠道
 *
 * 介面：MarkdownV2 + 失敗時降級純文字兜底。
 * 關鍵修復（#81）：訂閱名含 `_*` 等特殊字元時不再炸。
 */
import { escapeMarkdownV2, ok, fail, errorMessage } from './channel.js';

/** @type {import('./channel.js').Channel} */
/**
 * 可选 Topic ID（Forum 群组 message_thread_id）。空字符串视为未配置。
 * @param {any} config
 * @returns {number|undefined}
 */
function resolveTopicId(config) {
  const raw = config && config.TG_TOPIC_ID != null ? String(config.TG_TOPIC_ID).trim() : '';
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * @param {any} config
 * @param {string} text
 * @param {string} [parseMode]
 */
function buildSendBody(config, text, parseMode) {
  /** @type {Record<string, any>} */
  const body = {
    chat_id: config.TG_CHAT_ID,
    text
  };
  if (parseMode) body.parse_mode = parseMode;
  const topicId = resolveTopicId(config);
  if (topicId !== undefined) body.message_thread_id = topicId;
  return body;
}

export const telegramChannel = {
  name: 'telegram',

  validateConfig(config) {
    if (!config.TG_BOT_TOKEN) return { ok: false, error: '缺少 TG_BOT_TOKEN' };
    if (!config.TG_CHAT_ID) return { ok: false, error: '缺少 TG_CHAT_ID' };
    return { ok: true };
  },

  async send(payload, config) {
    const v = telegramChannel.validateConfig(config);
    if (!v.ok) return fail('telegram', v.error || '配置無效');

    const url = `https://api.telegram.org/bot${config.TG_BOT_TOKEN}/sendMessage`;
    const fullText = payload.title
      ? `*${payload.title}*\n\n${payload.content}`
      : String(payload.content || '');
    const escaped = escapeMarkdownV2(fullText);

    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSendBody(config, escaped, 'MarkdownV2'))
      });
      const result = await r.json();

      if (result.ok) return ok('telegram', result);

      // 兜底：MarkdownV2 仍解析失敗時降級純文字
      if (result.description && /parse entities/i.test(result.description)) {
        const r2 = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildSendBody(config, fullText))
        });
        const result2 = await r2.json();
        return result2.ok
          ? ok('telegram', result2)
          : fail('telegram', `Telegram 拒絕: ${result2.description || '未知'}`, result2);
      }

      return fail('telegram', `Telegram 拒絕: ${result.description || '未知'}`, result);
    } catch (err) {
      return fail('telegram', errorMessage(err));
    }
  },

  async test(config) {
    return telegramChannel.send(
      {
        title: '訂閱管理 - 測試通知',
        content: '這是一條來自訂閱管理系統的測試訊息。如果你收到此訊息，說明 Telegram 配置正常。'
      },
      config
    );
  }
};

/**
 * 舊的匯出函數：調用方傳 `*title*\n\n...` 拼好的 message。
 *
 * @deprecated 新代碼請用 telegramChannel.send
 * @param {string} message
 * @param {any} config
 * @returns {Promise<boolean>}
 */
export async function sendTelegramNotification(message, config) {
  // 舊調用方傳入的 message 已經是組合好的 `*title*\n\ncontent`
  // 這裡把它整體作為 content，title 留空避免重複加包裝
  const r = await telegramChannel.send({ title: '', content: message }, config);
  if (!r.success) console.error('[Telegram]', r.error);
  return r.success;
}

export { escapeMarkdownV2 };
