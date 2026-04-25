import {
  getAllSubscriptions,
  getSubscription,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  manualRenewSubscription,
  deletePaymentRecord,
  updatePaymentRecord,
  toggleSubscriptionStatus
} from '../../data/subscriptions.js';
import { getConfig } from '../../data/config.js';
import { sendNotificationToAllChannels } from '../../services/notify/index.js';
import { lunarCalendar } from '../../core/lunar.js';
import { formatTimeInTimezone, formatTimezoneDisplay } from '../../core/time.js';
import { extractTagsFromSubscriptions } from '../utils.js';

async function testSingleSubscriptionNotification(id, env) {
  try {
    const subscription = await getSubscription(id, env);
    if (!subscription) {
      return { success: false, message: '未找到該訂閱' };
    }
    const config = await getConfig(env);

    const title = `手動測試通知: ${subscription.name}`;

    const showLunar = config.SHOW_LUNAR === true;
    let lunarExpiryText = '';

    if (showLunar) {
      const expiryDateObj = new Date(subscription.expiryDate);
      const lunarExpiry = lunarCalendar.solar2lunar(expiryDateObj.getFullYear(), expiryDateObj.getMonth() + 1, expiryDateObj.getDate());
      lunarExpiryText = lunarExpiry ? ` (農曆: ${lunarExpiry.fullStr})` : '';
    }

    const timezone = config?.TIMEZONE || 'UTC';
    const formattedExpiryDate = formatTimeInTimezone(new Date(subscription.expiryDate), timezone, 'date');
    const currentTime = formatTimeInTimezone(new Date(), timezone, 'datetime');

    const calendarType = subscription.useLunar ? '農曆' : '公曆';
    const autoRenewText = subscription.autoRenew ? '是' : '否';
    const currencySymbols = {
      CNY: '¥', USD: '$', HKD: 'HK$', TWD: 'NT$',
      JPY: '¥', EUR: '€', GBP: '£', KRW: '₩', TRY: '₺'
    };
    const amountConfigured = subscription.amount !== null && subscription.amount !== undefined && !Number.isNaN(Number(subscription.amount));
    const amountCurrency = currencySymbols[subscription.currency || 'CNY'] || '¥';
    const amountText = amountConfigured ? `\n金額: ${amountCurrency}${Number(subscription.amount).toFixed(2)}/週期` : '';

    const categoryText = subscription.category ? subscription.category : '未分類';

    const commonContent = `**訂閱詳情**
型別: ${subscription.customType || '其他'}${amountText}
分類: ${categoryText}
日曆型別: ${calendarType}
到期日期: ${formattedExpiryDate}${lunarExpiryText}
自動續期: ${autoRenewText}
備註: ${subscription.notes || '無'}
傳送時間: ${currentTime}
當前時區: ${formatTimezoneDisplay(timezone)}`;

    const tags = extractTagsFromSubscriptions([subscription]);
    const notifyResult = await sendNotificationToAllChannels(title, commonContent, config, '[手動測試]', {
      metadata: { tags }
    });

    const attempted = notifyResult?.attempted || 0;
    const successCount = notifyResult?.successCount || 0;
    const failedCount = notifyResult?.failedCount || 0;

    if (attempted === 0) {
      return { success: false, message: '未啟用任何通知渠道，請先在系統配置中開啟至少一種通知方式' };
    }

    if (successCount === 0) {
      return { success: false, message: `測試通知傳送失敗（已嘗試 ${attempted} 個渠道）` };
    }

    if (failedCount > 0) {
      return { success: true, message: `測試通知已傳送：成功 ${successCount} 個，失敗 ${failedCount} 個渠道` };
    }

    return { success: true, message: `測試通知傳送成功（共 ${successCount} 個渠道）` };
  } catch (error) {
    console.error('[手動測試] 傳送失敗:', error);
    return { success: false, message: '傳送時發生錯誤: ' + error.message };
  }
}

async function handleSubscriptions(request, env, path) {
  const method = request.method;

  if (path === '/subscriptions') {
    if (method === 'GET') {
      const subscriptions = await getAllSubscriptions(env);
      return new Response(JSON.stringify(subscriptions), { headers: { 'Content-Type': 'application/json' } });
    }

    if (method === 'POST') {
      const subscription = await request.json();
      const result = await createSubscription(subscription, env);
      return new Response(JSON.stringify(result), {
        status: result.success ? 201 : 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (path.startsWith('/subscriptions/')) {
    const parts = path.split('/');
    const id = parts[2];

    if (parts[3] === 'toggle-status' && method === 'POST') {
      const body = await request.json();
      const result = await toggleSubscriptionStatus(id, body.isActive, env);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (parts[3] === 'test-notify' && method === 'POST') {
      const result = await testSingleSubscriptionNotification(id, env);
      return new Response(JSON.stringify(result), { status: result.success ? 200 : 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (parts[3] === 'renew' && method === 'POST') {
      let options = {};
      try {
        const body = await request.json();
        options = body || {};
      } catch (e) {
        // empty
      }
      const result = await manualRenewSubscription(id, env, options);
      return new Response(JSON.stringify(result), { status: result.success ? 200 : 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (parts[3] === 'payments' && method === 'GET') {
      const subscription = await getSubscription(id, env);
      if (!subscription) {
        return new Response(JSON.stringify({ success: false, message: '訂閱不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: true, payments: subscription.paymentHistory || [] }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (parts[3] === 'payments' && parts[4] && method === 'DELETE') {
      const paymentId = parts[4];
      const result = await deletePaymentRecord(id, paymentId, env);
      return new Response(JSON.stringify(result), { status: result.success ? 200 : 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (parts[3] === 'payments' && parts[4] && method === 'PUT') {
      const paymentId = parts[4];
      const paymentData = await request.json();
      const result = await updatePaymentRecord(id, paymentId, paymentData, env);
      return new Response(JSON.stringify(result), { status: result.success ? 200 : 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (method === 'GET') {
      const subscription = await getSubscription(id, env);
      return new Response(JSON.stringify(subscription), { headers: { 'Content-Type': 'application/json' } });
    }

    if (method === 'PUT') {
      const subscription = await request.json();
      const result = await updateSubscription(id, subscription, env);
      return new Response(JSON.stringify(result), { status: result.success ? 200 : 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (method === 'DELETE') {
      const result = await deleteSubscription(id, env);
      return new Response(JSON.stringify(result), { status: result.success ? 200 : 400, headers: { 'Content-Type': 'application/json' } });
    }
  }

  return null;
}

export { handleSubscriptions };
