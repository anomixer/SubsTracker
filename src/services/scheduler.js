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
  getDaysBetween,
  getTimezoneDateParts,
  getTimezoneMidnightTimestamp,
  addCalendarPeriodInTimezone,
  getTimestampForTimezoneParts
} from '../core/time.js';
import { formatNotificationContent } from './notify/reminder.js';
import { dispatch } from './notify/dispatch.js';
import { shouldFire } from './notify/reminder-engine.js';
import { lunarCalendar, lunarBiz } from '../core/lunar.js';

const DEDUPE_TTL_SEC = 60 * 60 * 48; // 48h
const LAST_FIRE_TTL_SEC = 60 * 60 * 24 * 60; // 60 天

/**
 * 日级规则（before_expiry/days、on_expiry）按本地日期去重；小时级与 after_expiry 按本地小时。
 * @param {import('../data/reminders.repo.js').ReminderRule} rule
 * @param {{ year: number, month: number, day: number, hourString: string }} nowParts
 */
function buildDedupeBucket(rule, nowParts) {
  const ymd = `${nowParts.year}${String(nowParts.month).padStart(2, '0')}${String(nowParts.day).padStart(2, '0')}`;
  const isDayRule =
    rule.type === 'on_expiry' ||
    (rule.type === 'before_expiry' && rule.unit !== 'hours');
  return isDayRule ? ymd : `${ymd}${nowParts.hourString}`;
}

/**
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @param {string} subId
 * @param {string} ruleId
 */
async function readLastFireAt(env, subId, ruleId) {
  return env.SUBSCRIPTIONS_KV.get(`notify_lastfire:${subId}:${ruleId}`);
}

/**
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @param {string} subId
 * @param {string} ruleId
 * @param {string} iso
 */
async function writeLastFireAt(env, subId, ruleId, iso) {
  await env.SUBSCRIPTIONS_KV.put(`notify_lastfire:${subId}:${ruleId}`, iso, {
    expirationTtl: LAST_FIRE_TTL_SEC
  });
}

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

      // 載入規則；老訂閱沒有規則時，用穩定 id 的 legacy 規則（避免每 tick 新 UUID 打穿 dedupe）
      let rules = await remindersRepo.listForSubscription(env, subscription.id);
      if (rules.length === 0) {
        const legacy = remindersRepo.legacyFieldToRule(subscription);
        legacy.id = `legacy:${subscription.id}`;
        rules = [legacy];
      }

      for (const rule of rules) {
        const lastFireAtIso =
          rule.type === 'after_expiry'
            ? (await readLastFireAt(env, subscription.id, rule.id)) || undefined
            : undefined;
        const decision = shouldFire(rule, {
          daysDiff,
          hoursDiff,
          nowIso: now.utc.toISOString(),
          lastFireAtIso
        });
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
        reason: `當前${timezone} ${now.hourString}點不在允許傳送的小時 [${normalizedHours.join(',') || '未限制=每小時'}] 內（正常跳過，不會發通知）`
      });
      return entry;
    }

    // 在時段：先查重（不預佔），傳送成功後再寫 dedupe / lastFire
    /** @type {Array<{ sub: any, rule: any, daysDiff: number, hoursDiff: number, dedupeKey: string }>} */
    const ready = [];
    const nowParts = {
      year: now.parts.year,
      month: now.parts.month,
      day: now.parts.day,
      hourString: now.hourString
    };
    for (const c of candidates) {
      const bucket = buildDedupeBucket(c.rule, nowParts);
      const dedupeKey = `notify_dedupe:${c.sub.id}:${c.rule.id}:${bucket}`;
      const exists = await env.SUBSCRIPTIONS_KV.get(dedupeKey);
      if (exists) {
        dedupedCount++;
        continue;
      }
      ready.push({ ...c, dedupeKey });
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

    // 仅在至少一渠道成功时写入去重与 lastFire，失败可在后续 tick 重试
    if (dispatchResult.successCount > 0) {
      const firedAt = now.utc.toISOString();
      await Promise.all(
        ready.map(async (c) => {
          await env.SUBSCRIPTIONS_KV.put(c.dedupeKey, '1', { expirationTtl: DEDUPE_TTL_SEC });
          if (c.rule.type === 'after_expiry') {
            await writeLastFireAt(env, c.sub.id, c.rule.id, firedAt);
          }
        })
      );
    }

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
  const tz = timezone || 'UTC';
  let expiryDate = new Date(sub.expiryDate);
  let periodsAdded = 0;
  const nowMidnight = getTimezoneMidnightTimestamp(now, tz);

  /**
   * @param {number} y
   * @param {number} m
   * @param {number} d
   */
  function atTimezoneMidnight(y, m, d) {
    const ts = getTimestampForTimezoneParts(
      { year: y, month: m, day: d, hour: 0, minute: 0, second: 0 },
      tz
    );
    return new Date(ts);
  }

  if (sub.useLunar) {
    let parts = getTimezoneDateParts(expiryDate, tz);
    let lunar = lunarCalendar.solar2lunar(parts.year, parts.month, parts.day);
    while (getTimezoneMidnightTimestamp(expiryDate, tz) <= nowMidnight) {
      if (!lunar) break;
      lunar = lunarBiz.addLunarPeriod(lunar, sub.periodValue, sub.periodUnit);
      const solar = lunarBiz.lunar2solar(lunar);
      if (!solar) break;
      expiryDate = atTimezoneMidnight(solar.year, solar.month, solar.day);
      periodsAdded++;
      if (periodsAdded > 60) break; // 防禦
    }
  } else {
    while (getTimezoneMidnightTimestamp(expiryDate, tz) <= nowMidnight) {
      if (mode === 'reset') {
        // 重置：從「現在」所在本地日重新起算一個週期
        const p = getTimezoneDateParts(now, tz);
        expiryDate = atTimezoneMidnight(p.year, p.month, p.day);
      }
      expiryDate = addCalendarPeriodInTimezone(
        expiryDate,
        sub.periodValue || 1,
        sub.periodUnit || 'month',
        tz,
        { endOfMonth: !!sub.endOfMonth }
      );
      periodsAdded++;
      if (periodsAdded > 120) break;
    }
  }

  if (periodsAdded === 0) return null;

  const newStartDate = mode === 'reset' ? new Date(now) : new Date(sub.expiryDate);
  const newExpiryDate = expiryDate;

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
