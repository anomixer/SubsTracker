// 注：本檔案暫不啟用 // @ts-check，因 lunar 庫返回類型分支較多，類型清理推遲到後續 Task。
/**
 * 訂閱業務層
 *
 * 本檔案負責"訂閱生命週期"相關的業務規則（建立時自動推算到期日、續訂生成支付記錄、
 * 刪除支付記錄回退週期、農曆週期推算、初始支付記錄等）。
 *
 * 重構：
 * - 數據儲存從單 Key 陣列改為 sub:{id} 多 Key（見 subscriptions.repo.js）
 * - 單條讀寫透過 repo.getById / repo.save，不再載入整個陣列，降低併發風險
 * - 業務邏輯保持相容，外部 API 簽名不變
 *
 * 注意：reminderUnit/reminderValue 欄位保留相容，Task 8 會在新 API 引入
 * 多提醒規則（reminder_rules:{id}），屆時 Service 層會同步兩邊。
 */

import { getConfig } from './config.js';
import {
  addCalendarPeriodInTimezone,
  getNowInTimezone,
  getTimezoneDateParts,
  getTimezoneMidnightTimestamp,
  parseDateInputInTimezone
} from '../core/time.js';
import { lunarCalendar, lunarBiz } from '../core/lunar.js';
import { resolveReminderSetting } from '../services/notify/reminder.js';
import * as subRepo from './subscriptions.repo.js';
import { addCategory } from './categories.js';

/**
 * 裁切支付歷史，保留 1 條 initial + 最近 N 條其他記錄。
 *
 * @param {Array} records
 * @param {number} limit
 * @returns {Array}
 */
function trimPaymentHistory(records = [], limit = 100) {
  const safeLimit = Math.min(1000, Math.max(10, Number(limit) || 100));
  if (!Array.isArray(records)) return [];
  if (records.length <= safeLimit) return records;

  const initialRecords = records.filter((item) => item && item.type === 'initial');
  const otherRecords = records.filter((item) => item && item.type !== 'initial');
  const keptOther = otherRecords.slice(-(safeLimit - Math.min(initialRecords.length, 1)));
  const keptInitial = initialRecords.length > 0 ? [initialRecords[0]] : [];
  return [...keptInitial, ...keptOther];
}

/**
 * @param {string | Date | number | null | undefined} value
 * @param {string} timezone
 * @returns {Date | null}
 */
function parseOptionalDateInTimezone(value, timezone) {
  if (value == null || value === '') return null;
  const parsed = parseDateInputInTimezone(value, timezone);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @param {string} timezone
 * @returns {Date}
 */
function buildTimezoneDate(year, month, day, timezone) {
  return parseDateInputInTimezone(
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    timezone
  );
}

/**
 * 獲取所有訂閱（從新 repo 讀取）。
 *
 * @param {any} env
 * @returns {Promise<Array<any>>}
 */
async function getAllSubscriptions(env) {
  try {
    return await subRepo.listAll(env);
  } catch (error) {
    console.error('[subscriptions] 讀取列表失敗:', error);
    return [];
  }
}

/**
 * 按 ID 獲取單條訂閱。
 *
 * @param {string} id
 * @param {any} env
 */
async function getSubscription(id, env) {
  return subRepo.getById(env, id);
}

/**
 * 建立訂閱。
 *
 * @param {any} subscription 來自前端的欄位集
 * @param {any} env
 * @returns {Promise<{success: boolean, message?: string, subscription?: any}>}
 */
async function createSubscription(subscription, env) {
  try {
    if (!subscription.name || !subscription.expiryDate) {
      return { success: false, message: '缺少必填欄位' };
    }

    const config = await getConfig(env);
    const timezone = config.TIMEZONE || 'Asia/Shanghai';
    const now = getNowInTimezone(timezone);
    const todayMidnight = getTimezoneMidnightTimestamp(now.utc, timezone);
    const startDate = parseOptionalDateInTimezone(subscription.startDate, timezone);
    let expiryDate = parseOptionalDateInTimezone(subscription.expiryDate, timezone);
    if (!expiryDate) {
      return { success: false, message: '到期日期格式無效' };
    }

    let useLunar = !!subscription.useLunar;
    if (useLunar) {
      const expiryParts = getTimezoneDateParts(expiryDate, timezone);
      let lunar = lunarCalendar.solar2lunar(
        expiryParts.year,
        expiryParts.month,
        expiryParts.day
      );

      if (lunar && subscription.periodValue && subscription.periodUnit) {
        while (getTimezoneMidnightTimestamp(expiryDate, timezone) < todayMidnight) {
          lunar = lunarBiz.addLunarPeriod(lunar, subscription.periodValue, subscription.periodUnit);
          const solar = lunarBiz.lunar2solar(lunar);
          expiryDate = buildTimezoneDate(solar.year, solar.month, solar.day, timezone);
        }
      }
    } else {
      if (getTimezoneMidnightTimestamp(expiryDate, timezone) < todayMidnight && subscription.periodValue && subscription.periodUnit) {
        while (getTimezoneMidnightTimestamp(expiryDate, timezone) < todayMidnight) {
          expiryDate = addCalendarPeriodInTimezone(
            expiryDate,
            subscription.periodValue,
            subscription.periodUnit,
            timezone
          );
        }
      }
    }

    const reminderSetting = resolveReminderSetting(subscription);
    const normalizedStartDate = startDate ? startDate.toISOString() : null;
    const normalizedExpiryDate = expiryDate.toISOString();

    const initialPaymentDate = normalizedStartDate || now.utc.toISOString();
    const newSubscription = {
      id: Date.now().toString(),
      name: subscription.name,
      subscriptionMode: subscription.subscriptionMode || 'cycle',
      customType: subscription.customType || '',
      category: subscription.category ? subscription.category.trim() : '',
      startDate: normalizedStartDate,
      expiryDate: normalizedExpiryDate,
      periodValue: subscription.periodValue || 1,
      periodUnit: subscription.periodUnit || 'month',
      reminderUnit: reminderSetting.unit,
      reminderValue: reminderSetting.value,
      reminderDays: reminderSetting.unit === 'day' ? reminderSetting.value : undefined,
      reminderHours: reminderSetting.unit === 'hour' ? reminderSetting.value : undefined,
      notes: subscription.notes || '',
      amount:
        subscription.amount !== undefined && subscription.amount !== null
          ? subscription.amount
          : null,
      currency: subscription.currency || 'CNY',
      lastPaymentDate: initialPaymentDate,
      paymentHistory:
        subscription.amount !== undefined && subscription.amount !== null
          ? [
              {
                id: Date.now().toString(),
                date: initialPaymentDate,
                amount: subscription.amount,
                currency: subscription.currency || 'CNY',
                type: 'initial',
                note: '初始訂閱',
                periodStart: normalizedStartDate || initialPaymentDate,
                periodEnd: normalizedExpiryDate
              }
            ]
          : [],
      isActive: subscription.isActive !== false,
      autoRenew: subscription.autoRenew !== false,
      useLunar: useLunar,
      createdAt: new Date().toISOString()
    };

    await subRepo.save(env, newSubscription);
    if (newSubscription.category) await addCategory(env, newSubscription.category);

    return { success: true, subscription: newSubscription };
  } catch (error) {
    console.error('建立訂閱異常：', error && error.stack ? error.stack : error);
    return { success: false, message: error && error.message ? error.message : '建立訂閱失敗' };
  }
}

/**
 * 更新訂閱。
 *
 * @param {string} id
 * @param {any} subscription
 * @param {any} env
 */
async function updateSubscription(id, subscription, env) {
  try {
    const existing = await subRepo.getById(env, id);
    if (!existing) {
      return { success: false, message: '訂閱不存在' };
    }

    if (!subscription.name || !subscription.expiryDate) {
      return { success: false, message: '缺少必填欄位' };
    }

    const config = await getConfig(env);
    const timezone = config.TIMEZONE || 'Asia/Shanghai';
    const now = getNowInTimezone(timezone);
    const todayMidnight = getTimezoneMidnightTimestamp(now.utc, timezone);
    const incomingStartDate = parseOptionalDateInTimezone(subscription.startDate, timezone);
    let expiryDate = parseOptionalDateInTimezone(subscription.expiryDate, timezone);
    if (!expiryDate) {
      return { success: false, message: '到期日期格式無效' };
    }

    let useLunar = !!subscription.useLunar;
    if (useLunar) {
      const expiryParts = getTimezoneDateParts(expiryDate, timezone);
      let lunar = lunarCalendar.solar2lunar(
        expiryParts.year,
        expiryParts.month,
        expiryParts.day
      );
      if (!lunar) {
        return { success: false, message: '農曆日期超出支援範圍（1900-2100年）' };
      }
      if (lunar && getTimezoneMidnightTimestamp(expiryDate, timezone) < todayMidnight && subscription.periodValue && subscription.periodUnit) {
        do {
          lunar = lunarBiz.addLunarPeriod(lunar, subscription.periodValue, subscription.periodUnit);
          const solar = lunarBiz.lunar2solar(lunar);
          expiryDate = buildTimezoneDate(solar.year, solar.month, solar.day, timezone);
        } while (getTimezoneMidnightTimestamp(expiryDate, timezone) < todayMidnight);
      }
    } else {
      if (getTimezoneMidnightTimestamp(expiryDate, timezone) < todayMidnight && subscription.periodValue && subscription.periodUnit) {
        while (getTimezoneMidnightTimestamp(expiryDate, timezone) < todayMidnight) {
          expiryDate = addCalendarPeriodInTimezone(
            expiryDate,
            subscription.periodValue,
            subscription.periodUnit,
            timezone
          );
        }
      }
    }

    const reminderSource = {
      reminderUnit:
        subscription.reminderUnit !== undefined ? subscription.reminderUnit : existing.reminderUnit,
      reminderValue:
        subscription.reminderValue !== undefined ? subscription.reminderValue : existing.reminderValue,
      reminderHours:
        subscription.reminderHours !== undefined ? subscription.reminderHours : existing.reminderHours,
      reminderDays:
        subscription.reminderDays !== undefined ? subscription.reminderDays : existing.reminderDays
    };
    const reminderSetting = resolveReminderSetting(reminderSource);

    const newAmount = subscription.amount !== undefined ? subscription.amount : existing.amount;
    let paymentHistory = existing.paymentHistory || [];

    const hasInitialPayment = paymentHistory.some((p) => p.type === 'initial');
    const amountChanged = newAmount !== existing.amount ||
      (subscription.currency !== undefined && subscription.currency !== existing.currency);

    if (amountChanged && hasInitialPayment) {
      const idx = paymentHistory.findIndex((p) => p.type === 'initial');
      paymentHistory[idx] = {
        ...paymentHistory[idx],
        amount: newAmount,
        currency: subscription.currency || existing.currency || 'CNY'
      };
    } else if (!hasInitialPayment && newAmount !== null && newAmount !== undefined && newAmount > 0) {
      const initialDate = existing.startDate || existing.createdAt || new Date().toISOString();
      paymentHistory.unshift({
        id: Date.now().toString(),
        date: initialDate,
        amount: newAmount,
        currency: subscription.currency || existing.currency || 'CNY',
        type: 'initial',
        note: '初始訂閱',
        periodStart: existing.startDate || initialDate,
        periodEnd: existing.expiryDate || initialDate
      });
    }

    const merged = {
      ...existing,
      name: subscription.name,
      subscriptionMode: subscription.subscriptionMode || existing.subscriptionMode || 'cycle',
      customType: subscription.customType || existing.customType || '',
      category:
        subscription.category !== undefined
          ? subscription.category.trim()
          : existing.category || '',
      startDate:
        subscription.startDate !== undefined
          ? incomingStartDate
            ? incomingStartDate.toISOString()
            : existing.startDate
          : existing.startDate,
      expiryDate: expiryDate.toISOString(),
      periodValue: subscription.periodValue || existing.periodValue || 1,
      periodUnit: subscription.periodUnit || existing.periodUnit || 'month',
      reminderUnit: reminderSetting.unit,
      reminderValue: reminderSetting.value,
      reminderDays: reminderSetting.unit === 'day' ? reminderSetting.value : undefined,
      reminderHours: reminderSetting.unit === 'hour' ? reminderSetting.value : undefined,
      notes: subscription.notes || '',
      amount: newAmount,
      currency: subscription.currency || existing.currency || 'CNY',
      lastPaymentDate:
        existing.lastPaymentDate ||
        existing.startDate ||
        existing.createdAt ||
        now.utc.toISOString(),
      paymentHistory,
      isActive: subscription.isActive !== undefined ? subscription.isActive : existing.isActive,
      autoRenew:
        subscription.autoRenew !== undefined
          ? subscription.autoRenew
          : existing.autoRenew !== undefined
            ? existing.autoRenew
            : true,
      useLunar: useLunar,
      updatedAt: new Date().toISOString()
    };

    await subRepo.save(env, merged);
    if (merged.category) await addCategory(env, merged.category);

    return { success: true, subscription: merged };
  } catch (error) {
    console.error('[subscriptions] 更新訂閱失敗:', error);
    return { success: false, message: '更新訂閱失敗' };
  }
}

/**
 * 刪除訂閱。
 *
 * @param {string} id
 * @param {any} env
 */
async function deleteSubscription(id, env) {
  try {
    const ok = await subRepo.deleteById(env, id);
    if (!ok) return { success: false, message: '訂閱不存在' };
    return { success: true };
  } catch (error) {
    console.error('[subscriptions] 刪除訂閱失敗:', error);
    return { success: false, message: '刪除訂閱失敗' };
  }
}

/**
 * 手動續訂訂閱。
 *
 * 業務規則：
 * - reset 模式：以支付日期為新開始
 * - cycle 模式：現到期日 > 支付日 時接續，否則以支付日為新開始
 * - 農曆模式按農曆週期推算
 *
 * @param {string} id
 * @param {any} env
 * @param {{ paymentDate?: string|Date, amount?: number, periodMultiplier?: number, note?: string }} options
 */
async function manualRenewSubscription(id, env, options = {}) {
  try {
    const subscription = await subRepo.getById(env, id);
    if (!subscription) return { success: false, message: '訂閱不存在' };

    if (!subscription.periodValue || !subscription.periodUnit) {
      return { success: false, message: '訂閱未設定續訂週期' };
    }

    const config = await getConfig(env);
    const timezone = config.TIMEZONE || 'Asia/Shanghai';
    const now = getNowInTimezone(timezone);

    const paymentDate = options.paymentDate
      ? parseDateInputInTimezone(options.paymentDate, timezone)
      : now.utc;
    const amount = options.amount !== undefined ? options.amount : subscription.amount || 0;
    const periodMultiplier = options.periodMultiplier || 1;
    const note = options.note || '手動續訂';
    const mode = subscription.subscriptionMode || 'cycle';

    let newStartDate;
    const currentExpiryDate = new Date(subscription.expiryDate);

    if (mode === 'reset') {
      newStartDate = new Date(paymentDate);
    } else {
      newStartDate =
        currentExpiryDate.getTime() > paymentDate.getTime()
          ? new Date(currentExpiryDate)
          : new Date(paymentDate);
    }

    let newExpiryDate;
    if (subscription.useLunar) {
      const solarStart = getTimezoneDateParts(newStartDate, timezone);
      let lunar = lunarCalendar.solar2lunar(solarStart.year, solarStart.month, solarStart.day);
      let nextLunar = lunar;
      for (let i = 0; i < periodMultiplier; i++) {
        nextLunar = lunarBiz.addLunarPeriod(nextLunar, subscription.periodValue, subscription.periodUnit);
      }
      const solar = lunarBiz.lunar2solar(nextLunar);
      newExpiryDate = buildTimezoneDate(solar.year, solar.month, solar.day, timezone);
    } else {
      const totalPeriodValue = subscription.periodValue * periodMultiplier;
      newExpiryDate = addCalendarPeriodInTimezone(
        newStartDate,
        totalPeriodValue,
        subscription.periodUnit,
        timezone
      );
    }

    const paymentRecord = {
      id: Date.now().toString(),
      date: paymentDate.toISOString(),
      amount,
      currency: subscription.currency || 'CNY',
      type: 'manual',
      note,
      periodStart: newStartDate.toISOString(),
      periodEnd: newExpiryDate.toISOString()
    };

    const paymentHistoryLimit = config.PAYMENT_HISTORY_LIMIT || 100;
    const paymentHistory = [...(subscription.paymentHistory || []), paymentRecord];
    const trimmedPaymentHistory = trimPaymentHistory(paymentHistory, paymentHistoryLimit);

    const updated = {
      ...subscription,
      startDate: newStartDate.toISOString(),
      expiryDate: newExpiryDate.toISOString(),
      lastPaymentDate: paymentDate.toISOString(),
      paymentHistory: trimmedPaymentHistory
    };

    await subRepo.save(env, updated);

    return { success: true, subscription: updated, message: '續訂成功' };
  } catch (error) {
    console.error('手動續訂失敗:', error);
    return { success: false, message: '續訂失敗: ' + (error && error.message ? error.message : error) };
  }
}

/**
 * 刪除一條支付記錄（刪除時回退到期日）。
 *
 * @param {string} subscriptionId
 * @param {string} paymentId
 * @param {any} env
 */
async function deletePaymentRecord(subscriptionId, paymentId, env) {
  try {
    const subscription = await subRepo.getById(env, subscriptionId);
    if (!subscription) return { success: false, message: '訂閱不存在' };

    const paymentHistory = subscription.paymentHistory || [];
    const paymentIndex = paymentHistory.findIndex((p) => p.id === paymentId);
    if (paymentIndex === -1) return { success: false, message: '支付記錄不存在' };

    const deletedPayment = paymentHistory[paymentIndex];
    paymentHistory.splice(paymentIndex, 1);

    let newExpiryDate = subscription.expiryDate;
    let newLastPaymentDate = subscription.lastPaymentDate;

    if (paymentHistory.length > 0) {
      const sortedByPeriodEnd = [...paymentHistory].sort((a, b) => {
        const dateA = a.periodEnd ? new Date(a.periodEnd) : new Date(0);
        const dateB = b.periodEnd ? new Date(b.periodEnd) : new Date(0);
        return Number(dateB) - Number(dateA);
      });

      if (sortedByPeriodEnd[0].periodEnd) {
        newExpiryDate = sortedByPeriodEnd[0].periodEnd;
      }

      const sortedByDate = [...paymentHistory].sort(
        (a, b) => Number(new Date(b.date)) - Number(new Date(a.date))
      );
      newLastPaymentDate = sortedByDate[0].date;
    } else {
      if (deletedPayment.periodStart) newExpiryDate = deletedPayment.periodStart;
      newLastPaymentDate =
        subscription.startDate || subscription.createdAt || subscription.expiryDate;
    }

    const updated = {
      ...subscription,
      expiryDate: newExpiryDate,
      paymentHistory,
      lastPaymentDate: newLastPaymentDate
    };

    await subRepo.save(env, updated);

    return { success: true, subscription: updated, message: '支付記錄已刪除' };
  } catch (error) {
    console.error('刪除支付記錄失敗:', error);
    return {
      success: false,
      message: '刪除失敗: ' + (error && error.message ? error.message : error)
    };
  }
}

/**
 * 更新支付記錄。
 *
 * @param {string} subscriptionId
 * @param {string} paymentId
 * @param {{ date?: string, amount?: number, currency?: string, note?: string }} paymentData
 * @param {any} env
 */
async function updatePaymentRecord(subscriptionId, paymentId, paymentData, env) {
  try {
    const subscription = await subRepo.getById(env, subscriptionId);
    if (!subscription) return { success: false, message: '訂閱不存在' };
    const config = await getConfig(env);
    const timezone = config.TIMEZONE || 'Asia/Shanghai';

    const paymentHistory = subscription.paymentHistory || [];
    const paymentIndex = paymentHistory.findIndex((p) => p.id === paymentId);
    if (paymentIndex === -1) return { success: false, message: '支付記錄不存在' };

    const normalizedPaymentDate = parseOptionalDateInTimezone(paymentData.date, timezone);

    paymentHistory[paymentIndex] = {
      ...paymentHistory[paymentIndex],
      date: normalizedPaymentDate ? normalizedPaymentDate.toISOString() : paymentHistory[paymentIndex].date,
      amount:
        paymentData.amount !== undefined ? paymentData.amount : paymentHistory[paymentIndex].amount,
      currency:
        paymentData.currency ||
        paymentHistory[paymentIndex].currency ||
        subscription.currency ||
        'CNY',
      note: paymentData.note !== undefined ? paymentData.note : paymentHistory[paymentIndex].note
    };

    const sortedPayments = [...paymentHistory].sort(
      (a, b) => Number(new Date(b.date)) - Number(new Date(a.date))
    );
    const newLastPaymentDate = sortedPayments[0].date;

    const updated = {
      ...subscription,
      paymentHistory,
      lastPaymentDate: newLastPaymentDate
    };

    await subRepo.save(env, updated);

    return { success: true, subscription: updated, message: '支付記錄已更新' };
  } catch (error) {
    console.error('更新支付記錄失敗:', error);
    return {
      success: false,
      message: '更新失敗: ' + (error && error.message ? error.message : error)
    };
  }
}

/**
 * 啟用/停用訂閱。
 *
 * @param {string} id
 * @param {boolean} isActive
 * @param {any} env
 */
async function toggleSubscriptionStatus(id, isActive, env) {
  try {
    const existing = await subRepo.getById(env, id);
    if (!existing) return { success: false, message: '訂閱不存在' };

    const updated = {
      ...existing,
      isActive: !!isActive,
      updatedAt: new Date().toISOString()
    };
    await subRepo.save(env, updated);

    return { success: true, subscription: updated };
  } catch (error) {
    console.error('[subscriptions] 切換狀態失敗:', error);
    return { success: false, message: '更新訂閱狀態失敗' };
  }
}

export {
  getAllSubscriptions,
  getSubscription,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  manualRenewSubscription,
  deletePaymentRecord,
  updatePaymentRecord,
  toggleSubscriptionStatus
};
