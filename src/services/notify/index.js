// @ts-check
/**
 * 通知調度入口
 *
 * 舊 sendNotificationToAllChannels 現在是 dispatch.dispatch 的薄殼，
 * 保留簽名向後相容。新代碼請直接使用 dispatch / testChannel。
 *
 */
import { dispatch } from './dispatch.js';

/**
 * @param {string} title
 * @param {string} commonContent
 * @param {any} config
 * @param {string} [logPrefix='[定時任務]']
 * @param {{ env?: any, subId?: string, ruleId?: string, metadata?: Object }} [options]
 */
export async function sendNotificationToAllChannels(
  title,
  commonContent,
  config,
  logPrefix = '[定時任務]',
  options = {}
) {
  const result = await dispatch(
    { title, content: commonContent },
    config,
    {
      logPrefix,
      env: options.env,
      subId: options.subId,
      ruleId: options.ruleId,
      metadata: options.metadata
    }
  );

  // 舊呼叫方期望的欄位名
  return {
    attempted: result.attempted,
    successCount: result.successCount,
    failedCount: result.failedCount,
    channelResults: result.channelResults
  };
}

export { dispatch, testChannel } from './dispatch.js';
