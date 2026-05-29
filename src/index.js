// @ts-check
/**
 * Worker 入口點
 *
 * fetch handler 委託給 Hono 應用（src/app.js）。
 * scheduled handler 觸發定時任務執行。
 *
 */

import app from './app.js';
import { ensureMigrations } from './data/migrate.js';
import { checkExpiringSubscriptions } from './services/scheduler.js';

export default {
  fetch: app.fetch,

  /**
   * 每小時由 Cron 觸發一次。
   *
   * @param {ScheduledEvent} event
   * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
   * @param {ExecutionContext} ctx
   */
  async scheduled(event, env, ctx) {
    void ctx;
    try {
      await ensureMigrations(env);
    } catch (err) {
      console.error('[index] scheduled 遷移失敗:', err);
    }
    console.log(
      '[Workers] 定時任務觸發',
      'cron:',
      event?.cron || '(unknown)',
      'UTC:',
      new Date().toISOString()
    );
    await checkExpiringSubscriptions(env);
  }
};
