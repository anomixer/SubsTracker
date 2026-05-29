// 注：本檔案暫不啟用 // @ts-check，因 lunar 庫返回類型分支較多，類型清理推遲到後續 Task。
/**
 * 定時任務排程器
 *
 * ── 修復的核心問題（#91 / #52 / #166 根因）─────────────────
 * 舊排程器把"當前 UTC 時刻的小時"當作"使用者本地小時"來對比 NOTIFICATION_HOURS，
 * 配合"通知時段語義不一致"的文檔表述，造成大量"不響 / 錯時響"。
 *
 * 修復：
 * 1. 統一時區基準：透過 getNowInTimezone(config.TIMEZONE) 取使用者 TZ 下的 hourString
 *    與 NOTIFICATION_HOURS（按使用者 TZ 解釋）比對，語義清晰。
 * 2. 多提醒規則：從 reminders.repo 載入每個訂閱的規則陣列，逐條調
 *    reminder-engine.shouldFire 判斷（不再單點 reminderUnit/reminderValue）。
 * 3. 去重粒度細化：dedupe key 改為 (subId × ruleId × ymdh-local)，避免一條訂閱
 *    多規則相互打架。
 * 4. 結構化日誌：每次執行寫一條 sched_log；每條通知傳送（成功/失敗）寫 notify_log。
 *
 * 數據流：
 *   Cron tick →
 *     ensureMigrations →
 *     load config + subs + rules →
 *     check window →
 *     for each (sub, rule):
 *       - daysDiff/hoursDiff 用 getDaysBetween（按使用者 TZ）算
 *       - 自動續訂（針對 sub 整體，僅算一次）
 *       - shouldFire? → dedupe → dispatch.send → notify_log
 *     → sched_log
 *
 */

import { getConfig } from '../data/config.js';
import { getAllSubscriptions } from '../data/subscriptions.js';
import * as subRepo from '../data/subscriptions.repo.js';
import * as remindersRepo from '../data/reminders.repo.js';
import * as schedulerLogsRepo from '../data/scheduler-logs.repo.js';
import {
  MS_PER_HOUR,
  getNowInTimezone,
  getDaysBetween
} from '../core/time.js';
import { formatNotificationContent } from './notify/reminder.js';
import { dispatch } from './notify/dispatch.js';
import { shouldFire } from './notify/reminder-engine.js';
import { lunarCalendar, lunarBiz } from '../core/lunar.js';

const DEDUPE_TTL_SEC = 60 * 60 * 48; // 48h

/**
 * 入口：被 Cron 觸發的 scheduled() 呼叫。
 *
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @returns {Promise<import('../data/scheduler-logs.repo.js').SchedulerLogEntry|null>}
 */
export async function checkExpiringSubscriptions(env) {
  const startedAtIso = new Date().toISOString();
  try {
    const config = await getConfig(env);
    const timezone = config.TIMEZONE || 'UTC';
    const now = getNowInTimezone(timezone);

    const normalizedHours = Array.isArray(config.NOTIFICATION_HOURS)
      ? config.NOTIFICATION_HOURS
          .map((h) => String(h).trim())
          .filter((h) => h.length > 0)
          .map((h) => {
            const up = h.toUpperCase();
            if (up === '*' || up === 'ALL') return '*';
            // 僅對純數字做兩位補齊；'*' 之類萬用字元保持原樣
            return /^\d+$/.test(h) ? h.padStart(2, '0') : up;
          })
      : [];
    const inWindow =
      normalizedHours.length === 0 ||
      normalizedHours.includes('*') ||
      normalizedHours.includes('ALL') ||
      normalizedHours.includes(now.hourString);

    const subscriptions = await getAllSubscriptions(env);
    let activeCount = 0;
    let matchedCount = 0;
    let dedupedCount = 0;
    let sentCount = 0;
    let autoRenewedCount = 0;

    // 不在通知時段：不傳送但仍跑自動續訂（業務上希望續訂總能發生）
    /** @type {Array<{ sub: any, rule: any, daysDiff: number, hoursDiff: number }>} */
    const candidates = [];

    /** @type {Array<any>} */
    const updatedSubsToSave = [];

    for (const subscription of subscriptions) {
      if (!subscription.isActive) continue;
      activeCount++;

      // 計算到期天數（按使用者 TZ）
      let expiryDate = new Date(subscription.expiryDate);
      let daysDiff = getDaysBetween(now.utc, expiryDate, timezone);
      let hoursDiff = (expiryDate.getTime() - now.utc.getTime()) / MS_PER_HOUR;

      // 自動續訂：已過期 + autoRenew=true → 推進到期日並寫支付記錄
      if (subscription.autoRenew && daysDiff < 0) {
        const renewed = autoRenew(subscription, now.utc, timezone, config);
        if (renewed) {
          updatedSubsToSave.push(renewed.next);
          autoRenewedCount++;
          // 續訂後重算 diff
          expiryDate = new Date(renewed.next.expiryDate);
          daysDiff = getDaysBetween(now.utc, expiryDate, timezone);
          hoursDiff = (expiryDate.getTime() - now.utc.getTime()) / MS_PER_HOUR;
          // 用續訂後的物件作後續判斷
          subscription.expiryDate = renewed.next.expiryDate;
          subscription.startDate = renewed.next.startDate;
          subscription.lastPaymentDate = renewed.next.lastPaymentDate;
          subscription.paymentHistory = renewed.next.paymentHistory;
        }
      }

      // 載入規則；老訂閱沒有規則時，用 legacyFieldToRule 現場轉一條
      let rules = await remindersRepo.listForSubscription(env, subscription.id);
      if (rules.length === 0) {
        rules = [remindersRepo.legacyFieldToRule(subscription)];
      }

      for (const rule of rules) {
        const decision = shouldFire(rule, { daysDiff, hoursDiff, nowIso: now.utc.toISOString() });
        if (!decision.fire) continue;
        matchedCount++;
        candidates.push({ sub: subscription, rule, daysDiff, hoursDiff });
      }
    }

    // 持久化自動續訂結果
    if (updatedSubsToSave.length > 0) {
      await subRepo.saveMany(env, updatedSubsToSave);
      console.log(`[定時任務] 已自動續訂 ${updatedSubsToSave.length} 個訂閱`);
    }

    // 不在通知時段 → 寫日誌後返回
    if (!inWindow) {
      const entry = await schedulerLogsRepo.writeLog(env, {
        startedAt: startedAtIso,
        finishedAt: new Date().toISOString(),
        timezone,
        currentHour: now.hourString,
        configuredHours: normalizedHours,
        inWindow: false,
        checkedCount: activeCount,
        matchedCount,
        dedupedCount: 0,
        sentCount: 0,
        autoRenewedCount,
        status: 'skipped',
        reason: `當前使用者 TZ 小時 ${now.hourString} 不在配置時段 [${normalizedHours.join(',') || '空'}] 內`
      });
      return entry;
    }

    // 在時段：去重 + 傳送
    /** @type {Array<{ sub: any, rule: any, daysDiff: number, hoursDiff: number }>} */
    const ready = [];
    const ymdhLocal = `${now.parts.year}${String(now.parts.month).padStart(2, '0')}${String(
      now.parts.day
    ).padStart(2, '0')}${now.hourString}`;
    for (const c of candidates) {
      const dedupeKey = `notify_dedupe:${c.sub.id}:${c.rule.id}:${ymdhLocal}`;
      const exists = await env.SUBSCRIPTIONS_KV.get(dedupeKey);
      if (exists) {
        dedupedCount++;
        continue;
      }
      await env.SUBSCRIPTIONS_KV.put(dedupeKey, '1', { expirationTtl: DEDUPE_TTL_SEC });
      ready.push(c);
    }

    if (ready.length === 0) {
      const entry = await schedulerLogsRepo.writeLog(env, {
        startedAt: startedAtIso,
        finishedAt: new Date().toISOString(),
        timezone,
        currentHour: now.hourString,
        configuredHours: normalizedHours,
        inWindow: true,
        checkedCount: activeCount,
        matchedCount,
        dedupedCount,
        sentCount: 0,
        autoRenewedCount,
        status: matchedCount > 0 ? 'skipped' : 'ok',
        reason:
          matchedCount > 0
            ? `命中 ${matchedCount} 條規則但全部在去重視窗內（跳過 ${dedupedCount}）`
            : '本次未命中任何提醒規則'
      });
      return entry;
    }

    // 排序：按剩餘天數升序，更緊迫的在前
    ready.sort((a, b) => a.daysDiff - b.daysDiff);

    // 一次性聚合所有訂閱成一條通知（與既有渠道契約一致）
    // notify_log 按 (subId, ruleId, channel) 維度落，仍可細粒度查詢
    const enrichedSubs = ready.map((c) => ({
      ...c.sub,
      daysRemaining: c.daysDiff,
      hoursRemaining: Math.round(c.hoursDiff)
    }));
    const content = formatNotificationContent(enrichedSubs, config);
    const title = '訂閱到期/續費提醒';

    // 給 dispatch 提供主 subId+ruleId（聚合通知用第一條做歸屬）
    const primary = ready[0];
    const dispatchResult = await dispatch(
      { title, content },
      config,
      {
        env,
        subId: primary.sub.id,
        ruleId: primary.rule.id,
        logPrefix: '[定時任務]',
        metadata: {
          tags: enrichedSubs.map((s) => s.name),
          daysRemaining: primary.daysDiff,
          ruleType: primary.rule.type,
          ruleValue: primary.rule.value
        }
      }
    );
    sentCount = dispatchResult.successCount;

    const entry = await schedulerLogsRepo.writeLog(env, {
      startedAt: startedAtIso,
      finishedAt: new Date().toISOString(),
      timezone,
      currentHour: now.hourString,
      configuredHours: normalizedHours,
      inWindow: true,
      checkedCount: activeCount,
      matchedCount,
      dedupedCount,
      sentCount,
      autoRenewedCount,
      status: dispatchResult.failedCount > 0 && sentCount === 0 ? 'error' : 'ok',
      reason:
        dispatchResult.attempted > 0
          ? `發送到 ${dispatchResult.attempted} 個渠道，成功 ${dispatchResult.successCount} / 失敗 ${dispatchResult.failedCount}`
          : '未啟用任何通知渠道',
      extra: {
        candidates: ready.map((c) => ({
          subId: c.sub.id,
          subName: c.sub.name,
          ruleId: c.rule.id,
          ruleType: c.rule.type,
          ruleValue: c.rule.value,
          daysDiff: c.daysDiff
        })),
        channelResults: dispatchResult.channelResults
      }
    });
    return entry;
  } catch (error) {
    console.error('[定時任務] 執行失敗:', error);
    return schedulerLogsRepo.writeLog(env, {
      startedAt: startedAtIso,
      finishedAt: new Date().toISOString(),
      timezone: 'UTC',
      currentHour: '00',
      configuredHours: [],
      inWindow: false,
      checkedCount: 0,
      matchedCount: 0,
      dedupedCount: 0,
      sentCount: 0,
      autoRenewedCount: 0,
      status: 'error',
      reason: '執行異常: ' + (error && error.message ? error.message : String(error)),
      extra: { stack: error && error.stack }
    });
  }
}

/**
 * 自動續訂：把已過期的訂閱按週期推進，生成 auto 類型支付記錄。
 *
 * 按"cycle / reset 模式 + 公曆 / 農曆分支。
 *
 * @param {any} sub
 * @param {Date} now UTC 時刻
 * @param {string} timezone
 * @param {any} config
 * @returns {{ next: any } | null}
 */
function autoRenew(sub, now, timezone, config) {
  const mode = sub.subscriptionMode || 'cycle';
  let expiryDate = new Date(sub.expiryDate);
  let periodsAdded = 0;

  if (sub.useLunar) {
    let lunar = lunarCalendar.solar2lunar(
      expiryDate.getFullYear(),
      expiryDate.getMonth() + 1,
      expiryDate.getDate()
    );
    while (expiryDate <= now) {
      lunar = lunarBiz.addLunarPeriod(lunar, sub.periodValue, sub.periodUnit);
      const solar = lunarBiz.lunar2solar(lunar);
      expiryDate = new Date(solar.year, solar.month - 1, solar.day);
      periodsAdded++;
      if (periodsAdded > 60) break; // 防禦
    }
  } else {
    while (expiryDate <= now) {
      if (mode === 'reset') expiryDate = new Date(now);
      if (sub.periodUnit === 'day') expiryDate.setDate(expiryDate.getDate() + sub.periodValue);
      else if (sub.periodUnit === 'month') expiryDate.setMonth(expiryDate.getMonth() + sub.periodValue);
      else if (sub.periodUnit === 'year') expiryDate.setFullYear(expiryDate.getFullYear() + sub.periodValue);
      periodsAdded++;
      if (periodsAdded > 120) break;
    }
  }

  if (periodsAdded === 0) return null;

  const newStartDate = mode === 'reset' ? new Date(now) : new Date(sub.expiryDate);
  const newExpiryDate = expiryDate;
  void timezone;

  const paymentRecord = {
    id: Date.now().toString(),
    date: now.toISOString(),
    amount: sub.amount || 0,
    type: 'auto',
    note: `自動續訂 (${mode === 'reset' ? '重置模式' : '接續模式'}${
      periodsAdded > 1 ? ', 補齊' + periodsAdded + '週期' : ''
    })`,
    periodStart: newStartDate.toISOString(),
    periodEnd: newExpiryDate.toISOString()
  };

  const paymentHistoryLimit = Number(config.PAYMENT_HISTORY_LIMIT) || 100;
  const ph = [...(sub.paymentHistory || []), paymentRecord];
  const trimmed = ph.length > paymentHistoryLimit ? ph.slice(-paymentHistoryLimit) : ph;

  return {
    next: {
      ...sub,
      startDate: newStartDate.toISOString(),
      expiryDate: newExpiryDate.toISOString(),
      lastPaymentDate: now.toISOString(),
      paymentHistory: trimmed
    }
  };
}
