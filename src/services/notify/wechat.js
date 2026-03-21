async function sendWechatBotNotification(title, content, config) {
  try {
    if (!config.WECHATBOT_WEBHOOK) {
      console.error('[企業微信機器人] 通知未配置，缺少Webhook URL');
      return false;
    }

    console.log('[企業微信機器人] 開始傳送通知到: ' + config.WECHATBOT_WEBHOOK);

    let messageData;
    const msgType = config.WECHATBOT_MSG_TYPE || 'text';

    if (msgType === 'markdown') {
      const markdownContent = `# ${title}\n\n${content}`;
      messageData = {
        msgtype: 'markdown',
        markdown: { content: markdownContent }
      };
    } else {
      const textContent = `${title}\n\n${content}`;
      messageData = {
        msgtype: 'text',
        text: { content: textContent }
      };
    }

    if (config.WECHATBOT_AT_ALL === 'true') {
      if (msgType === 'text') {
        messageData.text.mentioned_list = ['@all'];
      }
    } else if (config.WECHATBOT_AT_MOBILES) {
      const mobiles = config.WECHATBOT_AT_MOBILES.split(',').map(m => m.trim()).filter(m => m);
      if (mobiles.length > 0) {
        if (msgType === 'text') {
          messageData.text.mentioned_mobile_list = mobiles;
        }
      }
    }

    console.log('[企業微信機器人] 傳送訊息資料:', JSON.stringify(messageData, null, 2));

    const response = await fetch(config.WECHATBOT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messageData)
    });

    const responseText = await response.text();
    console.log('[企業微信機器人] 響應狀態:', response.status);
    console.log('[企業微信機器人] 響應內容:', responseText);

    if (response.ok) {
      try {
        const result = JSON.parse(responseText);
        if (result.errcode === 0) {
          console.log('[企業微信機器人] 通知傳送成功');
          return true;
        } else {
          console.error('[企業微信機器人] 傳送失敗，錯誤碼:', result.errcode, '錯誤資訊:', result.errmsg);
          return false;
        }
      } catch (parseError) {
        console.error('[企業微信機器人] 解析響應失敗:', parseError);
        return false;
      }
    } else {
      console.error('[企業微信機器人] HTTP請求失敗，狀態碼:', response.status);
      return false;
    }
  } catch (error) {
    console.error('[企業微信機器人] 傳送通知失敗:', error);
    return false;
  }
}

export { sendWechatBotNotification };
