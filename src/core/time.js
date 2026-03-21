// 時間與時區工具
const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;

function getCurrentTimeInTimezone(timezone = 'UTC') {
  try {
    return new Date();
  } catch (error) {
    console.error(`時區轉換錯誤: ${error.message}`);
    return new Date();
  }
}

function getTimestampInTimezone(timezone = 'UTC') {
  return getCurrentTimeInTimezone(timezone).getTime();
}

function convertUTCToTimezone(utcTime, timezone = 'UTC') {
  try {
    return new Date(utcTime);
  } catch (error) {
    console.error(`時區轉換錯誤: ${error.message}`);
    return new Date(utcTime);
  }
}

function getTimezoneDateParts(date, timezone = 'UTC') {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = formatter.formatToParts(date);
    const pick = (type) => {
      const part = parts.find(item => item.type === type);
      return part ? Number(part.value) : 0;
    };
    return {
      year: pick('year'),
      month: pick('month'),
      day: pick('day'),
      hour: pick('hour'),
      minute: pick('minute'),
      second: pick('second')
    };
  } catch (error) {
    console.error(`解析時區(${timezone})失敗: ${error.message}`);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds()
    };
  }
}

function getTimezoneMidnightTimestamp(date, timezone = 'UTC') {
  const { year, month, day } = getTimezoneDateParts(date, timezone);
  return Date.UTC(year, month - 1, day, 0, 0, 0);
}

function formatTimeInTimezone(time, timezone = 'UTC', format = 'full') {
  try {
    const date = new Date(time);

    if (format === 'date') {
      return date.toLocaleDateString('zh-CN', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    } else if (format === 'datetime') {
      return date.toLocaleString('zh-CN', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } else {
      return date.toLocaleString('zh-CN', {
        timeZone: timezone
      });
    }
  } catch (error) {
    console.error(`時間格式化錯誤: ${error.message}`);
    return new Date(time).toISOString();
  }
}

function getTimezoneOffset(timezone = 'UTC') {
  try {
    const now = new Date();
    const { year, month, day, hour, minute, second } = getTimezoneDateParts(now, timezone);
    const zonedTimestamp = Date.UTC(year, month - 1, day, hour, minute, second);
    return Math.round((zonedTimestamp - now.getTime()) / MS_PER_HOUR);
  } catch (error) {
    console.error(`獲取時區偏移量錯誤: ${error.message}`);
    return 0;
  }
}

function formatTimezoneDisplay(timezone = 'UTC') {
  try {
    const offset = getTimezoneOffset(timezone);
    const offsetStr = offset >= 0 ? `+${offset}` : `${offset}`;

    const timezoneNames = {
      'UTC': '世界標準時間',
      'Asia/Shanghai': '中國標準時間',
      'Asia/Hong_Kong': '香港時間',
      'Asia/Taipei': '臺北時間',
      'Asia/Singapore': '新加坡時間',
      'Asia/Tokyo': '日本時間',
      'Asia/Seoul': '韓國時間',
      'America/New_York': '美國東部時間',
      'America/Los_Angeles': '美國太平洋時間',
      'America/Chicago': '美國中部時間',
      'America/Denver': '美國山地時間',
      'Europe/London': '英國時間',
      'Europe/Paris': '巴黎時間',
      'Europe/Berlin': '柏林時間',
      'Europe/Moscow': '莫斯科時間',
      'Australia/Sydney': '悉尼時間',
      'Australia/Melbourne': '墨爾本時間',
      'Pacific/Auckland': '奧克蘭時間'
    };

    const timezoneName = timezoneNames[timezone] || timezone;
    return `${timezoneName} (UTC${offsetStr})`;
  } catch (error) {
    console.error('格式化時區顯示失敗:', error);
    return timezone;
  }
}

function formatBeijingTime(date = new Date(), format = 'full') {
  return formatTimeInTimezone(date, 'Asia/Shanghai', format);
}

function extractTimezone(request) {
  const url = new URL(request.url);
  const timezoneParam = url.searchParams.get('timezone');

  if (timezoneParam) return timezoneParam;

  const timezoneHeader = request.headers.get('X-Timezone');
  if (timezoneHeader) return timezoneHeader;

  const acceptLanguage = request.headers.get('Accept-Language');
  if (acceptLanguage) {
    if (acceptLanguage.includes('zh')) return 'Asia/Shanghai';
    if (acceptLanguage.includes('en-US')) return 'America/New_York';
    if (acceptLanguage.includes('en-GB')) return 'Europe/London';
  }

  return 'UTC';
}

function isValidTimezone(timezone) {
  try {
    new Date().toLocaleString('en-US', { timeZone: timezone });
    return true;
  } catch (error) {
    return false;
  }
}

export {
  MS_PER_HOUR,
  MS_PER_DAY,
  getCurrentTimeInTimezone,
  getTimestampInTimezone,
  convertUTCToTimezone,
  getTimezoneDateParts,
  getTimezoneMidnightTimestamp,
  formatTimeInTimezone,
  getTimezoneOffset,
  formatTimezoneDisplay,
  formatBeijingTime,
  extractTimezone,
  isValidTimezone
};
