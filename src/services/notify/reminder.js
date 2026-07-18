import { formatTimeInTimezone, formatTimezoneDisplay, getTimezoneDateParts } from '../../core/time.js';
import { lunarCalendar } from '../../core/lunar.js';
import { formatAmount } from '../../core/currency-format.js';

/**
 * 按使用者時區把到期日轉成農曆展示文案，避免用 Date 本地分量導致差一天。
 *
 * @param {Date | string | number} expiry
 * @param {string} timezone
 * @returns {string} 空字串表示無法轉換或不展示
 */
function formatLunarExpiryText(expiry, timezone) {
  const parts = getTimezoneDateParts(expiry, timezone || 'UTC');
  const lunarExpiry = lunarCalendar.solar2lunar(parts.year, parts.month, parts.day);
  return lunarExpiry ? `\n農曆日期: ${lunarExpiry.fullStr}` : '';
}

function resolveReminderSetting(subscription) {
  const defaultDays = subscription && subscription.reminderDays !== undefined ? Number(subscription.reminderDays) : 7;
  let unit = subscription && subscription.reminderUnit === 'hour' ? 'hour' : 'day';

  let value;
  if (unit === 'hour') {
    if (subscription && subscription.reminderValue !== undefined && subscription.reminderValue !== null && !isNaN(Number(subscription.reminderValue))) {
      value = Number(subscription.reminderValue);
    } else if (subscription && subscription.reminderHours !== undefined && subscription.reminderHours !== null && !isNaN(Number(subscription.reminderHours))) {
      value = Number(subscription.reminderHours);
    } else {
      value = 0;
    }
  } else {
    if (subscription && subscription.reminderValue !== undefined && subscription.reminderValue !== null && !isNaN(Number(subscription.reminderValue))) {
      value = Number(subscription.reminderValue);
    } else if (!isNaN(defaultDays)) {
      value = Number(defaultDays);
    } else {
      value = 7;
    }
  }

  if (value < 0 || isNaN(value)) {
    value = 0;
  }

  return { unit, value };
}

function shouldTriggerReminder(reminder, daysDiff, hoursDiff) {
  if (!reminder) {
    return false;
  }
  if (reminder.unit === 'hour') {
    if (reminder.value === 0) {
      return hoursDiff >= 0 && hoursDiff < 1;
    }
    return hoursDiff >= 0 && hoursDiff <= reminder.value;
  }
  if (reminder.value === 0) {
    return daysDiff === 0;
  }
  return daysDiff >= 0 && daysDiff <= reminder.value;
}

function formatNotificationContent(subscriptions, config) {
  const showLunar = config.SHOW_LUNAR === true;
  const timezone = config?.TIMEZONE || 'UTC';
  let content = '';

  for (const sub of subscriptions) {
    const typeText = sub.customType || '其他';
    const periodText = (sub.periodValue && sub.periodUnit) ? `(週期: ${sub.periodValue} ${ { day: '天', month: '月', year: '年' }[sub.periodUnit] || sub.periodUnit})` : '';
    const categoryText = sub.category ? sub.category : '未分類';
    const reminderSetting = resolveReminderSetting(sub);

    const expiryDateObj = new Date(sub.expiryDate);
    const formattedExpiryDate = formatTimeInTimezone(expiryDateObj, timezone, 'date');

    let lunarExpiryText = '';
    if (showLunar) {
      lunarExpiryText = formatLunarExpiryText(expiryDateObj, timezone);
    }

    let statusText = '';
    let statusEmoji = '';
    if (sub.daysRemaining === 0) {
      statusEmoji = '⚠️';
      statusText = '今天到期！';
    } else if (sub.daysRemaining < 0) {
      statusEmoji = '🚨';
      statusText = `已過期 ${Math.abs(sub.daysRemaining)} 天`;
    } else {
      statusEmoji = '📅';
      statusText = `將在 ${sub.daysRemaining} 天後到期`;
    }

    const reminderSuffix = reminderSetting.value === 0
      ? '（僅到期時提醒）'
      : (reminderSetting.unit === 'hour' ? '（小時級提醒）' : '');
    const reminderText = reminderSetting.unit === 'hour'
      ? `提醒策略: 提前 ${reminderSetting.value} 小時${reminderSuffix}`
      : `提醒策略: 提前 ${reminderSetting.value} 天${reminderSuffix}`;

    const calendarType = sub.useLunar ? '農曆' : '公曆';
    const autoRenewText = sub.autoRenew ? '是' : '否';
    const formattedAmt = formatAmount(sub.amount, sub.currency || 'CNY');
    const amountText = formattedAmt ? `\n金額: ${formattedAmt}/週期` : '';

    const subscriptionContent = `${statusEmoji} **${sub.name}**
類型: ${typeText} ${periodText}
分類: ${categoryText}${amountText}
日曆類型: ${calendarType}
到期日期: ${formattedExpiryDate}${lunarExpiryText}
自動續期: ${autoRenewText}
${reminderText}
到期狀態: ${statusText}`;

    let finalContent = sub.notes ? 
      subscriptionContent + `\n備註: ${sub.notes}` : 
      subscriptionContent;

    content += finalContent + '\n\n';
  }

  const currentTime = formatTimeInTimezone(new Date(), timezone, 'datetime');
  content += `傳送時間: ${currentTime}\n當前時區: ${formatTimezoneDisplay(timezone)}`;

  return content;
}

export { resolveReminderSetting, shouldTriggerReminder, formatNotificationContent };
