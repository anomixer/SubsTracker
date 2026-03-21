import { formatTimeInTimezone } from '../../core/time.js';

async function sendEmailNotification(title, content, config) {
  try {
    if (!config.RESEND_API_KEY || !config.EMAIL_FROM || !config.EMAIL_TO) {
      console.error('[郵件通知] 通知未配置，缺少必要引數');
      return false;
    }

    console.log('[郵件通知] 開始傳送郵件到: ' + config.EMAIL_TO);

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px 20px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 24px; }
        .content { padding: 30px 20px; }
        .content h2 { color: #333; margin-top: 0; }
        .content p { color: #666; line-height: 1.6; margin: 16px 0; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 14px; }
        .highlight { background-color: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📅 ${title}</h1>
        </div>
        <div class="content">
            <div class="highlight">
                ${content.replace(/\n/g, '<br>')}
            </div>
            <p>此郵件由訂閱管理系統自動傳送，請及時處理相關訂閱事務。</p>
        </div>
        <div class="footer">
            <p>訂閱管理系統 | 傳送時間: ${formatTimeInTimezone(new Date(), config?.TIMEZONE || 'UTC', 'datetime')}</p>
        </div>
    </div>
</body>
</html>`;

    const fromEmail = config.EMAIL_FROM_NAME ?
      `${config.EMAIL_FROM_NAME} <${config.EMAIL_FROM}>` :
      config.EMAIL_FROM;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: config.EMAIL_TO,
        subject: title,
        html: htmlContent,
        text: content
      })
    });

    const result = await response.json();
    console.log('[郵件通知] 傳送結果:', response.status, result);

    if (response.ok && result.id) {
      console.log('[郵件通知] 郵件傳送成功，ID:', result.id);
      return true;
    } else {
      console.error('[郵件通知] 郵件傳送失敗:', result);
      return false;
    }
  } catch (error) {
    console.error('[郵件通知] 傳送郵件失敗:', error);
    return false;
  }
}

export { sendEmailNotification };
