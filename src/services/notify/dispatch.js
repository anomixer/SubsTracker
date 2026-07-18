// @ts-check
/**
 * 通知排程器：把一條通知併發分發到所有啟用的渠道，並把結果寫入通知日誌。
 *
 * 呼叫方：
 * - services/scheduler.js（定時到期檢查）
 * - api/handlers/test-notification.js（手動測試單個渠道）
 * - api/handlers/notify.js（第三方 /api/notify/{token}）
 *
 */

import { telegramChannel } from './telegram.js';
import { notifyxChannel } from './notifyx.js';
import { webhookChannel } from './webhook.js';
import { wecomChannel } from './wechat.js';
import { emailChannel } from './email.js';
import { barkChannel } from './bark.js';
import { gotifyChannel } from './gotify.js';
import { serverChanChannel } from './serverchan.js';
import { pushplusChannel } from './pushplus.js';
import { ntfyChannel } from './ntfy.js';
import { writeLog } from '../../data/notification-logs.repo.js';

/** 名字到渠道實例的映射；新增渠道在此註冊即可 */
export const ALL_CHANNELS = {
  telegram: telegramChannel,
  notifyx: notifyxChannel,
  webhook: webhookChannel,
  wechatbot: wecomChannel,
  email: emailChannel,
  bark: barkChannel,
  gotify: gotifyChannel,
  serverchan: serverChanChannel,
  pushplus: pushplusChannel,
  ntfy: ntfyChannel
};

/**
 * @typedef {Object} DispatchOptions
 * @property {any} [env] 若提供，會同時把每條結果寫入 notify_log
 * @property {string} [subId] 關聯的訂閱 ID（寫日誌用）
 * @property {string} [ruleId] 觸發的提醒規則 ID（寫日誌用）
 * @property {Object} [metadata] 附加給 channel.send 的 metadata
 * @property {string} [logPrefix] console 日誌前綴
 */

/**
 * 把一條通知發到所有啟用渠道。
 *
 * @param {{ title: string, content: string }} payload
 * @param {any} config 系統配置（含 ENABLED_NOTIFIERS 與各渠道欄位）
 * @param {DispatchOptions} [options]
 * @returns {Promise<{
 *   attempted: number,
 *   successCount: number,
 *   failedCount: number,
 *   results: import('./channel.js').ChannelResult[],
 *   channelResults: Record<string, boolean>
 * }>}
 */
export async function dispatch(payload, config, options = {}) {
  const enabled = Array.isArray(config.ENABLED_NOTIFIERS) ? config.ENABLED_NOTIFIERS : [];
  const prefix = options.logPrefix || '[定時任務]';

  const channels = enabled
    .map((name) => ALL_CHANNELS[name])
    .filter((ch) => ch != null);

  if (channels.length === 0) {
    console.log(`${prefix} 未啟用任何通知渠道`);
    return { attempted: 0, successCount: 0, failedCount: 0, results: [], channelResults: {} };
  }

  const settled = await Promise.allSettled(
    channels.map((ch) =>
      ch.send({ ...payload, metadata: options.metadata }, config).catch((err) => ({
        success: false,
        channel: ch.name,
        error: err && err.message ? err.message : String(err)
      }))
    )
  );

  /** @type {import('./channel.js').ChannelResult[]} */
  const results = settled.map((r, idx) => {
    if (r.status === 'fulfilled') {
      return /** @type {any} */ (r.value);
    }
    return {
      success: false,
      channel: channels[idx].name,
      error: r.reason && r.reason.message ? r.reason.message : String(r.reason)
    };
  });

  /** @type {Record<string, boolean>} */
  const channelResults = {};
  let successCount = 0;
  let failedCount = 0;
  for (const r of results) {
    channelResults[r.channel] = r.success;
    if (r.success) {
      successCount++;
      console.log(`${prefix} 傳送 ${r.channel} 通知成功`);
    } else {
      failedCount++;
      console.log(`${prefix} 傳送 ${r.channel} 通知失敗: ${r.error}`);
    }

    // 寫通知日誌（帶 env 時）
    if (options.env && options.subId) {
      try {
        await writeLog(options.env, {
          subId: options.subId,
          ruleId: options.ruleId || null,
          channel: r.channel,
          status: r.success ? 'success' : 'failed',
          title: payload.title,
          content: payload.content,
          error: r.error,
          raw: r.raw
        });
      } catch (err) {
        console.warn(`${prefix} 寫入通知日誌失敗:`, err);
      }
    }
  }

  return {
    attempted: results.length,
    successCount,
    failedCount,
    results,
    channelResults
  };
}

/**
 * 測試某個渠道（用於配置頁"測試發送"按鈕）。
 *
 * @param {string} channelName
 * @param {any} config
 * @returns {Promise<import('./channel.js').ChannelResult>}
 */
export async function testChannel(channelName, config) {
  const ch = ALL_CHANNELS[channelName];
  if (!ch) {
    return {
      success: false,
      channel: channelName,
      error: `未知渠道: ${channelName}`
    };
  }
  try {
    return await ch.test(config);
  } catch (err) {
    return {
      success: false,
      channel: channelName,
      error: err && err.message ? err.message : String(err)
    };
  }
}
